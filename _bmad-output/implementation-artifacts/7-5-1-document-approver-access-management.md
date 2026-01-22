# Story 7.5.1: Document Approver Access Management

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **team lead**,
I want to manage approvers through Slack channel membership,
So that I can control who can approve/deny requests without a separate permission system.

## Acceptance Criteria

### AC1: Add Approvers via Channel Invite
**Given** a team lead wants to add a new approver
**When** they invite the user to the `#isb-approvals` Slack channel
**Then** that user can see notifications and click Approve/Deny buttons
**And** no additional AWS configuration is required

### AC2: Remove Approvers via Channel Removal
**Given** a team lead wants to remove an approver
**When** they remove the user from the `#isb-approvals` Slack channel
**Then** that user can no longer see notifications or take actions
**And** no additional AWS configuration is required

### AC3: Private Channel Requirement
**Given** the approvals channel
**When** it is created/configured
**Then** it must be a private, invite-only channel (NFR9)
**And** this is documented in the setup guide

### AC4: Quarterly Access Audit Process
**Given** approver access should be reviewed periodically
**When** this story is complete
**Then** documentation includes a quarterly audit checklist:
- Review channel membership list
- Verify all members still require access
- Remove departed team members
- Document audit completion date

## Tasks / Subtasks

- [x] Task 1: Create approver access management documentation (AC: #1, #2, #3)
  - [x] 1.1: Create `docs/approver-access-management.md`
  - [x] 1.2: Document how Slack channel membership = approver access
  - [x] 1.3: Explain the private channel requirement (NFR9)
  - [x] 1.4: Provide step-by-step instructions for adding approvers
  - [x] 1.5: Provide step-by-step instructions for removing approvers

- [x] Task 2: Document quarterly access audit process (AC: #4)
  - [x] 2.1: Create quarterly audit checklist section
  - [x] 2.2: Document how to export channel membership list
  - [x] 2.3: Create audit log template for tracking completion
  - [x] 2.4: Document escalation for stale access

- [x] Task 3: Add security considerations section
  - [x] 3.1: Document why private channel is required
  - [x] 3.2: Document what approvers can do (approve/deny leases)
  - [x] 3.3: Document audit trail (CloudWatch logs, correlation IDs)
  - [x] 3.4: Document principle of least privilege

- [x] Task 4: Cross-reference related documentation
  - [x] 4.1: Link to custom action runbook (`docs/runbooks/custom-action-configuration.md`)
  - [x] 4.2: Link to incident response runbook (`docs/runbooks/slack-action-alarms.md`)
  - [x] 4.3: Reference Story 7.5.2 (operator onboarding canvas - to be created)

## Dev Notes

### CRITICAL: This is a Documentation-Only Story

This story does **NOT** involve any code changes. The entire deliverable is a Markdown documentation file that explains how approver access works with the Amazon Q Developer Slack integration.

**Key insight from NFR6:** "Operator authorization must be derived from Slack channel membership (no separate permission system)"

This means:
- No AWS IAM users/roles to manage for individual approvers
- No DynamoDB table tracking approver permissions
- Channel membership IS the access control mechanism
- Team leads manage access via standard Slack channel management

### Files to Create

| File | Purpose |
|------|---------|
| `docs/approver-access-management.md` | Main documentation for access management |

### Files to Reference (Do NOT Modify)

| File | Reference Purpose |
|------|-------------------|
| `docs/runbooks/custom-action-configuration.md` | Link to for technical details |
| `docs/runbooks/slack-action-alarms.md` | Link to for incident response |
| `_bmad-output/epics-amazon-q-slack.md` | Source requirements (NFR6, NFR9, FR20, FR21) |

### Documentation Structure

The documentation should follow this outline:

```markdown
# Approver Access Management

## Overview
Brief explanation of how access works

## How Access Control Works
- Slack channel membership = approval authority
- No separate AWS permissions needed
- Private channel ensures security

## Adding New Approvers
Step-by-step guide with screenshots if helpful

## Removing Approvers
Step-by-step guide

## Security Considerations
- Private channel requirement
- Audit trail in CloudWatch
- What approvers can do

## Quarterly Access Audit
- Why audit is needed
- Checklist template
- How to export membership
- Where to log completion

## Related Documentation
Links to runbooks and other docs
```

### Slack Channel Management Commands

For the documentation, include these standard Slack operations:

**Adding a member:**
1. Navigate to `#isb-approvals` channel
2. Click channel name in header → "Settings" → "Add people"
3. Search for user, click "Add"
4. User immediately gains access to notifications and buttons

**Removing a member:**
1. Navigate to `#isb-approvals` channel
2. Click channel name in header → "Settings" → "Members"
3. Find user, click "..." → "Remove from channel"
4. User immediately loses access

**Exporting membership (for audit):**
1. Navigate to `#isb-approvals` channel
2. Click channel name → "Members" tab
3. List all current members
4. Compare against approved approver list

### Quarterly Audit Template

Include a template like this in the documentation:

```markdown
## Quarterly Access Audit Log

| Date | Reviewer | Members Audited | Changes Made | Notes |
|------|----------|-----------------|--------------|-------|
| 2026-Q1 | [Name] | 5 | Removed: john.doe | Left company |
| 2026-Q2 | [Name] | 6 | Added: jane.smith | New team member |
```

### Security Context from Architecture

From `_bmad-output/architecture.md`:
- NFR6: "Operator authorization must be derived from Slack channel membership (no separate permission system)"
- NFR9: "Slack channel must be private and invite-only"

From `_bmad-output/epics-amazon-q-slack.md`:
- FR20: "Team lead can add approvers by inviting them to the Slack channel"
- FR21: "Team lead can remove approvers by removing them from the Slack channel"

### Existing Runbook Pattern

Follow the established pattern from `docs/runbooks/custom-action-configuration.md`:
- Clear section headers
- Prerequisites listed upfront
- Step-by-step instructions
- Troubleshooting section
- Related documentation links
- Revision history table

### Project Structure Notes

**Location:** Create in `docs/` directory at root level (not in `docs/runbooks/`)

**Rationale:** This is operational guidance for team leads, not an incident response runbook. Runbooks are for when things break; this is for day-to-day access management.

### Previous Story Intelligence (Epic 7.4)

From Story 7.4.2:
- Incident response runbook created at `docs/runbooks/slack-action-alarms.md`
- CloudWatch Insights queries documented for audit trail
- All actions logged with correlation ID, operator, timestamp

This logging information should be referenced in the security considerations section.

### Architecture Compliance

**From `_bmad-output/epics-amazon-q-slack.md` requirements:**
- FR20 → AC1 (add approvers via channel)
- FR21 → AC2 (remove approvers via channel)
- NFR9 → AC3 (private channel requirement)
- Stakeholder enhancement → AC4 (quarterly audit process)

**From architecture principles:**
- Zero configuration for approver management
- Audit trail via CloudWatch logs
- Fail-closed security model

### Git Commit Pattern

From recent commits:
```
1ad6585 docs: add custom action configuration runbook
```

**Suggested commit message:**
```
docs: add approver access management guide

- Document Slack channel membership as access control (Story 7.5.1 AC1, AC2)
- Explain private channel security requirement (Story 7.5.1 AC3)
- Include quarterly access audit process (Story 7.5.1 AC4)
- Link to related runbooks for troubleshooting

Story: 7.5.1
```

### Definition of Done

- [x] `docs/approver-access-management.md` created
- [x] Adding approvers documented with clear steps
- [x] Removing approvers documented with clear steps
- [x] Private channel requirement explained
- [x] Quarterly audit checklist included
- [x] Security considerations documented
- [x] Links to related documentation included
- [x] Markdown renders correctly (preview before commit)

### References

- [Source: _bmad-output/epics-amazon-q-slack.md#Story 7.5.1]
- [Source: _bmad-output/epics-amazon-q-slack.md#FR20, FR21, NFR6, NFR9]
- [Source: _bmad-output/architecture.md#Slack Integration]
- [Source: docs/runbooks/custom-action-configuration.md - Pattern reference]
- [Source: docs/runbooks/slack-action-alarms.md - Audit trail reference]
- [Source: _bmad-output/implementation-artifacts/7-4-2-configure-cloudwatch-alarms.md - Logging context]

---

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

N/A - Documentation-only story, no debugging required

### Completion Notes List

- Created comprehensive approver access management documentation at `docs/approver-access-management.md`
- Documented channel-based access control (AC1, AC2): Adding/removing approvers via Slack channel membership
- Explained private channel security requirement (AC3, NFR9)
- Included step-by-step instructions with clear formatting
- Created quarterly access audit checklist and log template (AC4)
- Added security considerations section covering: private channel requirement, approver capabilities, CloudWatch audit trail, principle of least privilege
- Cross-referenced existing runbooks: custom-action-configuration.md, slack-action-alarms.md
- Referenced upcoming Story 7.5.2 (operator onboarding canvas)
- Followed established documentation pattern from existing runbooks

### File List

| File | Action | Description |
|------|--------|-------------|
| `docs/approver-access-management.md` | Created | Main approver access management documentation |

### Change Log

| Date | Change | Story |
|------|--------|-------|
| 2026-01-21 | Created approver access management guide with channel-based access control, quarterly audit process, and security considerations. Status: ready-for-dev → review | 7.5.1 |
| 2026-01-21 | Code review fixes: Definition of Done checked, architecture diagram corrected, prerequisites added, link paths fixed, CloudWatch query improved, audit template date format clarified | 7.5.1 |

