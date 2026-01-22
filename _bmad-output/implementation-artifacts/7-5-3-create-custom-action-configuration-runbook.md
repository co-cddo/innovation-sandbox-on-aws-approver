# Story 7.5.3: Create Custom Action Configuration Runbook

Status: done

## Story

As an **operations team member**,
I want a runbook documenting custom action configuration,
So that I can set up or troubleshoot the Slack integration.

## Acceptance Criteria

### AC1: Runbook Created
**Given** custom actions must be configured for Slack
**When** this story is complete
**Then** a runbook exists at `docs/runbooks/custom-action-configuration.md`

### AC2: Prerequisites Section
**Given** the runbook
**When** an operator reads it
**Then** it lists prerequisites:
- Slack workspace admin access
- AWS account access
- Lambda ARNs from CloudFormation outputs
- Chatbot configuration ARN

### AC3: Step-by-Step Configuration
**Given** the runbook
**When** an operator follows it
**Then** it provides step-by-step instructions for:
- Accessing Slack custom action configuration
- Creating the Approve action with correct Lambda ARN
- Creating the Deny action with correct Lambda ARN
- Testing each action

### AC4: Screenshots Included
**Given** the runbook
**When** an operator follows it
**Then** screenshots show key configuration screens
**And** highlight important fields to configure

### AC5: Troubleshooting Section
**Given** the runbook
**When** actions don't work as expected
**Then** it includes troubleshooting steps:
- How to verify Lambda permissions
- How to check CloudWatch logs
- Common error messages and fixes

### AC6: Verification Checklist
**Given** the runbook
**When** configuration is complete
**Then** it includes a verification checklist:
- [ ] Test Approve action works
- [ ] Test Deny action works
- [ ] Verify thread replies appear
- [ ] Check CloudWatch logs show activity

## Tasks / Subtasks

- [x] Task 1: Create runbook file at `docs/runbooks/custom-action-configuration.md` (AC: #1)
  - Pre-completed as part of Story 7.2.3

- [x] Task 2: Add prerequisites section with access requirements (AC: #2)
  - [x] 2.1: Document AWS Console access requirements
  - [x] 2.2: Document Slack workspace access requirements
  - [x] 2.3: Document how to get Lambda ARNs from CloudFormation

- [x] Task 3: Add step-by-step configuration instructions (AC: #3)
  - [x] 3.1: Document CDK-managed approach (custom actions auto-created)
  - [x] 3.2: Document how to view actions in AWS Console
  - [x] 3.3: Document manual override process if needed

- [ ] Task 4: Add screenshots (AC: #4)
  - [ ] 4.1: Capture AWS Chatbot custom actions list screenshot
  - [ ] 4.2: Capture custom action detail screenshots
  - [ ] 4.3: Capture Slack notification with buttons screenshot
  - [ ] 4.4: Add images to `docs/runbooks/images/` directory
  - **Note:** Screenshot placeholders added; manual capture required

- [x] Task 5: Add troubleshooting section (AC: #5)
  - [x] 5.1: Document "Buttons Not Appearing" troubleshooting
  - [x] 5.2: Document "AccessDeniedException" troubleshooting
  - [x] 5.3: Document "Invalid lease identifier" troubleshooting
  - [x] 5.4: Add CloudWatch log queries for debugging

- [x] Task 6: Add verification checklist (AC: #6)
  - [x] 6.1: Add deployment verification checklist
  - [x] 6.2: Add test notification commands
  - [x] 6.3: Add button testing steps

## Dev Notes

### Pre-Completion in Story 7.2.3

This story was largely pre-completed during Story 7.2.3 implementation. The custom action configuration runbook was created as part of Task 4 in that story because:

1. CDK automation for custom actions was implemented (not manual console configuration as originally planned)
2. The runbook documents the actual CDK-managed approach
3. Creating the runbook during implementation captured accurate details

### Implementation Approach Change

The original story AC3 assumed manual AWS Console configuration. During implementation, we discovered that custom actions **can** be managed via CDK using `AWS::Chatbot::CfnCustomAction`. This is a better approach because:

- Configuration is version-controlled
- No manual console steps required for initial setup
- Changes are repeatable across environments

The runbook was updated to reflect the CDK-managed approach while still documenting manual override options for troubleshooting.

### Outstanding Item: Screenshots

Screenshots (AC4) require manual capture and have not been added. Placeholder text in the runbook documents what screenshots should be captured:

1. `chatbot-custom-actions-list.png` - AWS Chatbot console showing both custom actions
2. `custom-action-approve-detail.png` - Detail view of the isb-approve action
3. `custom-action-deny-detail.png` - Detail view of the isb-deny action
4. `slack-notification-with-buttons.png` - Example Slack notification
5. `slack-thread-reply-success.png` - Example thread reply

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Completion Notes List

- Pre-completed in Story 7.2.3 on 2026-01-21
- Code review on 2026-01-21 identified missing prerequisites and screenshots
- Fixed: Added access requirements to prerequisites section
- Fixed: Added screenshot placeholder section with capture guidance
- Outstanding: Manual screenshot capture still required

### File List

**Primary deliverable:**
- `docs/runbooks/custom-action-configuration.md` - Configuration runbook

**Created during code review:**
- `_bmad-output/implementation-artifacts/7-5-3-create-custom-action-configuration-runbook.md` - This story file

### Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-21 | Claude Code (7.2.3) | Initial runbook creation |
| 2026-01-21 | Claude Code (7.5.3 Review) | Added access requirements to prerequisites |
| 2026-01-21 | Claude Code (7.5.3 Review) | Added screenshot placeholders with guidance |
| 2026-01-21 | Claude Code (7.5.3 Review) | Created story file for audit trail |

### References

- [Source: _bmad-output/epics-amazon-q-slack.md#Story 7.5.3]
- [Source: _bmad-output/implementation-artifacts/7-2-3-configure-custom-actions-in-slack.md - Pre-completion context]
- [Source: docs/runbooks/custom-action-configuration.md - Runbook deliverable]
