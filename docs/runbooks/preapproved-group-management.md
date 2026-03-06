# Pre-Approved Group Management Runbook

## Overview

The `ndx-IsbPreapprovedGroup` in AWS IAM Identity Center controls which users receive automatic pre-approval (-100 scoring bonus) when requesting Innovation Sandbox leases. Users in this group bypass normal scoring thresholds and are auto-approved.

This replaces the previous hardcoded allow-list in code. See [ADR-001](../adr/001-identity-center-group-preapproval.md) for background.

## Prerequisites

- AWS CLI access to the management account (`NDX/orgManagement` profile)
- Identity Store ID: `d-9267e1e371`
- Group ID: `689153b0-60e1-7069-55f3-5e7779a3cc6d`
- Region: `us-west-2`

All commands below use `--profile NDX/orgManagement --region us-west-2`.

## Adding a User

```bash
# 1. Find the user's Identity Store UserId
aws identitystore list-users \
  --identity-store-id d-9267e1e371 \
  --filters '[{"AttributePath":"UserName","AttributeValue":"user@example.gov.uk"}]' \
  --profile NDX/orgManagement --region us-west-2

# 2. Add to group (replace <USER_ID> with UserId from step 1)
aws identitystore create-group-membership \
  --identity-store-id d-9267e1e371 \
  --group-id 689153b0-60e1-7069-55f3-5e7779a3cc6d \
  --member-id UserId=<USER_ID> \
  --profile NDX/orgManagement --region us-west-2
```

## Removing a User

```bash
# 1. List group memberships to find the MembershipId
aws identitystore list-group-memberships \
  --identity-store-id d-9267e1e371 \
  --group-id 689153b0-60e1-7069-55f3-5e7779a3cc6d \
  --profile NDX/orgManagement --region us-west-2

# 2. Delete the membership (replace <MEMBERSHIP_ID>)
aws identitystore delete-group-membership \
  --identity-store-id d-9267e1e371 \
  --membership-id <MEMBERSHIP_ID> \
  --profile NDX/orgManagement --region us-west-2
```

## Listing Current Members

```bash
aws identitystore list-group-memberships \
  --identity-store-id d-9267e1e371 \
  --group-id 689153b0-60e1-7069-55f3-5e7779a3cc6d \
  --profile NDX/orgManagement --region us-west-2
```

## Verifying Membership

```bash
# Find user ID
USER_ID=$(aws identitystore list-users \
  --identity-store-id d-9267e1e371 \
  --filters '[{"AttributePath":"UserName","AttributeValue":"user@example.gov.uk"}]' \
  --query 'Users[0].UserId' --output text \
  --profile NDX/orgManagement --region us-west-2)

# Check membership
aws identitystore is-member-in-groups \
  --identity-store-id d-9267e1e371 \
  --member-id UserId=$USER_ID \
  --group-ids 689153b0-60e1-7069-55f3-5e7779a3cc6d \
  --profile NDX/orgManagement --region us-west-2
```

## Troubleshooting

### User added to group but not getting pre-approved

1. **Propagation delay**: Identity Store changes are near-instant but STS credentials are cached for up to 15 minutes. Wait and retry.
2. **Email mismatch**: The UserName in Identity Center must exactly match the email in the lease request. Check with `list-users`.
3. **Lambda not configured**: Verify `IDENTITY_STORE_ID`, `IDENTITY_CENTER_ROLE_ARN`, and `IDENTITY_CENTER_GROUP_ID` env vars are set on the Lambda.

### Identity Store API errors in Lambda logs

1. **Cross-account role issues**: Check that `ApproverIdentityCenterReadRole` exists in the management account (955063685555) and trusts the Hub account (568672915267).
2. **Permission denied**: Verify the role has `identitystore:ListUsers` and `identitystore:IsMemberInGroups` permissions.
3. **Lambda IAM policy**: Verify the Lambda's execution role has `sts:AssumeRole` for the cross-account role ARN.

### Checking CloudWatch logs

Search for pre-approval check results in the approver Lambda logs:
```
fields @timestamp, @message
| filter @message like /Pre-approved group check|isPreapproved|checkPreapprovedGroup/
| sort @timestamp desc
| limit 20
```

## Architecture

```
Hub Account (568672915267)              Management Account (955063685555)
+-------------------------------+       +----------------------------------+
| Approver Lambda               |       | IAM Identity Center              |
|   STSClient                   |       |   ndx-IsbPreapprovedGroup        |
|     AssumeRole ---------------+------>| ApproverIdentityCenterReadRole   |
|   IdentitystoreClient         |       |   identitystore:ListUsers        |
|     ListUsers (find user)     |       |   identitystore:IsMemberInGroups |
|     IsMemberInGroups (check)  |       +----------------------------------+
+-------------------------------+
```

## Related

- [ADR-001: Identity Center Group Pre-approval](../adr/001-identity-center-group-preapproval.md)
- [Approver Access Management](../approver-access-management.md)
