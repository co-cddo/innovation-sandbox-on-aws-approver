# ADR-001: Replace Hardcoded Pre-Approval List with Identity Center Group Membership

## Status

Accepted

## Context

Pre-approved users (those who receive a -100 scoring bonus for automatic approval) were maintained as a hardcoded list of email addresses in `src/lib/allow-list.ts`. Every change to this list required a code change, PR review, and deployment.

The Innovation Sandbox already uses AWS IAM Identity Center for user authentication. Managing pre-approval membership via Identity Center aligns with existing operational patterns.

## Decision

Replace the hardcoded allow-list with membership in the `ndx-IsbPreapprovedGroup` Identity Center group. The approver Lambda checks group membership at runtime via cross-account API calls to the management account's Identity Store.

### Architecture

```
Hub Account (568672915267)          Management Account (955063685555)
+----------------------------+      +-----------------------------------+
| Approver Lambda            |      | IAM Identity Center               |
|   |                        |      |   ndx-IsbPreapprovedGroup         |
|   +-- STS AssumeRole ------+----->| ApproverIdentityCenterReadRole    |
|   |                        |      |   - identitystore:ListUsers       |
|   +-- ListUsers            |      |   - identitystore:IsMemberInGroups|
|   +-- IsMemberInGroups     |      +-----------------------------------+
+----------------------------+
```

### Configuration

- `IDENTITY_STORE_ID`: `d-9267e1e371`
- `IDENTITY_CENTER_ROLE_ARN`: Cross-account role in management account
- `IDENTITY_CENTER_GROUP_ID`: Group ID for `ndx-IsbPreapprovedGroup`

## Rationale

- **Dynamic management**: Add/remove users via AWS Console or CLI without code changes
- **Leverages existing infrastructure**: Identity Center already manages all user access
- **Centralised identity management**: Single source of truth for user permissions
- **Auditable**: Changes to group membership are logged via CloudTrail

## Trade-offs

- **Cross-account dependency**: Requires management account role and Identity Store availability
- **Additional API latency**: ~200ms for STS AssumeRole + ListUsers + IsMemberInGroups (credentials are cached)
- **Fail-closed behaviour**: If Identity Center is unreachable, the user is NOT pre-approved. This means an Identity Center outage removes the pre-approval bonus, but does not block requests -- they proceed through normal scoring and may be escalated for manual review

## Consequences

- Group management becomes an operational task via AWS Console/CLI (see [runbook](../runbooks/preapproved-group-management.md))
- Lambda requires `sts:AssumeRole` permission to the management account role
- `src/lib/allow-list.ts` is deleted; `isPreapproved` boolean is computed at runtime and passed through the state context
- The `allow_list_override` scoring rule continues to function identically -- only the data source changes
