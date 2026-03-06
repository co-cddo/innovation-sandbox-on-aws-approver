# Approver Access Management

## Overview

This guide explains how to manage approver access for the Innovation Sandbox (ISB) lease approval system. Approvers are team members who can approve or deny sandbox lease requests via Slack.

**Key Insight:** Approver access is controlled entirely through Slack channel membership. There is no separate AWS IAM configuration or permission system to manage.

## Prerequisites

Before managing approvers, ensure:

- **Slack workspace access** - You need channel admin or workspace admin permissions
- **Private channel exists** - The `#isb-approvals` channel must already be created as a private channel
- **Amazon Q Developer configured** - The AWS Chatbot integration must be set up (Story 7.1.2)
- **ApproverStack deployed** - The CDK infrastructure must be deployed with SNS topic and action Lambdas

## How Access Control Works

The ISB Approver integration uses Amazon Q Developer to deliver notifications with Approve/Deny buttons to a private Slack channel. Access control is straightforward:

| Action | How It Works |
|--------|--------------|
| **Grant access** | Invite user to the `#isb-approvals` channel |
| **Revoke access** | Remove user from the `#isb-approvals` channel |
| **View approvers** | Check channel membership list |

### Why Channel-Based Access?

This approach provides several benefits:

- **Zero AWS configuration** - No IAM users, roles, or policies to manage per approver
- **Familiar interface** - Team leads use standard Slack channel management
- **Instant effect** - Access changes take effect immediately
- **Self-documenting** - Channel membership IS the approver list
- **Auditability** - Slack Enterprise Grid provides membership audit logs

### Architecture Reference

```
Lease Request → Scoring Lambda → SNS Topic → Amazon Q Developer → #isb-approvals channel
       (score > threshold)                                               ↓
                                                                  [Approve] [Deny]
                                                                         ↓
                                                             Only channel members see this
```

## Adding New Approvers

### Prerequisites

- You must be a channel admin or workspace admin
- The person you're adding must have a Slack account in the workspace

### Step-by-Step Instructions

1. **Open the approvals channel**
   - Navigate to `#isb-approvals` in Slack
   - Or use Cmd/Ctrl+K and search for "isb-approvals"

2. **Access channel settings**
   - Click the channel name in the header (top of the channel)
   - Select the **Settings** tab

3. **Add the new approver**
   - Click **Add people**
   - Search for the user by name or email
   - Click **Add** to confirm

4. **Verify access**
   - The new approver should now see the channel in their sidebar
   - They can immediately see new approval notifications
   - They can click Approve/Deny buttons on any pending request

### What Happens Next

- New approvers see all future notifications immediately
- They can act on any pending requests visible in the channel
- Their actions are logged with their Slack identity (see [Audit Trail](#audit-trail-in-cloudwatch))

## Removing Approvers

### When to Remove Access

- Team member leaves the organization
- Role change - no longer responsible for approvals
- Temporary access removal during leave
- Security incident requiring access review

### Step-by-Step Instructions

1. **Open the approvals channel**
   - Navigate to `#isb-approvals` in Slack

2. **Access member list**
   - Click the channel name in the header
   - Select the **Members** tab

3. **Remove the approver**
   - Find the user in the member list
   - Click the **...** (more options) next to their name
   - Select **Remove from channel**
   - Confirm the removal

4. **Verify removal**
   - The user should no longer appear in the member list
   - They will no longer see the channel or receive notifications

### What Happens After Removal

- User immediately loses access to the channel
- They cannot see new notifications
- They cannot act on any requests (buttons won't work even if they had the channel cached)
- Their previous actions remain in the audit log

## Security Considerations

### Private Channel Requirement

**Critical:** The `#isb-approvals` channel MUST be a private, invite-only channel.

| Requirement | Rationale |
|-------------|-----------|
| **Private channel** | Prevents unauthorized users from seeing approval requests |
| **Invite-only** | Ensures only explicitly authorized users can join |
| **No public links** | Shared channel links won't work for private channels |

To verify your channel is private:
1. Look for the lock icon next to the channel name
2. In channel settings, confirm "Channel type" shows "Private"

### What Approvers Can Do

Approvers have the following capabilities:

| Capability | Description |
|------------|-------------|
| **View notifications** | See all lease approval requests sent to the channel |
| **Approve leases** | Click "Approve" to grant sandbox access |
| **Deny leases** | Click "Deny" to reject sandbox requests |
| **View outcomes** | See thread replies showing action results |

Approvers CANNOT:
- Modify approval thresholds or scoring rules
- Access AWS resources directly through this integration
- Change channel settings (unless they're also channel admins)
- See historical requests before they joined (unless scrolling back in channel)

### Audit Trail in CloudWatch

All approve/deny actions are logged to CloudWatch with:

| Field | Description |
|-------|-------------|
| `correlationId` | Unique ID linking all logs for a request |
| `action` | "approve" or "deny" |
| `operator` | Slack user who clicked the button |
| `leaseId` | The lease being acted upon |
| `userEmail` | Email of the user requesting the lease |
| `timestamp` | When the action occurred |
| `outcome` | "success", "already_processed", or "error" |

**CloudWatch Insights query to view recent actions:**

```
fields @timestamp, correlationId, action, operator, leaseId, userEmail, outcome
| filter @logStream like /ApproverSlackApprove|ApproverSlackDeny/
| sort @timestamp desc
| limit 50
```

> **Tip:** Remove the `outcome` filter to include errors in audit results for complete visibility.

### Principle of Least Privilege

Follow these best practices:

1. **Limit approvers** - Only add team members who need approval authority
2. **Regular reviews** - Conduct quarterly access audits (see below)
3. **Prompt removal** - Remove access immediately when no longer needed
4. **Document changes** - Log who was added/removed and why

## Quarterly Access Audit

### Why Audit?

Regular access reviews ensure:
- Only authorized personnel have approval authority
- Departed team members are removed promptly
- Access aligns with current team structure
- Compliance with security policies

### Audit Checklist

Use this checklist each quarter:

- [ ] **Export current membership** - Get list of all channel members
- [ ] **Verify each member** - Confirm each person still requires access
- [ ] **Check for departures** - Cross-reference with HR records for departures
- [ ] **Review role changes** - Identify anyone who changed roles
- [ ] **Remove stale access** - Remove anyone who no longer needs access
- [ ] **Document findings** - Record audit completion in the log below
- [ ] **Notify team** - Inform team of any access changes

### How to Export Channel Membership

1. Navigate to `#isb-approvals`
2. Click channel name → **Members** tab
3. Review the complete member list
4. For Slack Enterprise Grid: Use Admin Console for detailed export

### Quarterly Audit Log

Record each audit completion here (Date format: YYYY-MM-DD):

| Quarter | Date | Reviewer | Members Count | Changes Made | Notes |
|---------|------|----------|---------------|--------------|-------|
| 2026-Q1 | | | | | |
| 2026-Q2 | | | | | |
| 2026-Q3 | | | | | |
| 2026-Q4 | | | | | |

### Escalation for Stale Access

If you identify concerning access patterns:

1. **Immediate removal** - Remove access for departed employees immediately
2. **Notify security** - Report to security team if access was retained improperly
3. **Review logs** - Check CloudWatch for any actions by the user
4. **Document incident** - Record in audit log with details

## Pre-Approved Group Management

**Important distinction:** Slack channel membership controls who can **manually approve or deny** lease requests. Identity Center group membership controls who gets **automatic pre-approval** (a -100 scoring bonus that bypasses normal escalation thresholds).

The `ndx-IsbPreapprovedGroup` in AWS IAM Identity Center manages pre-approved users. Adding someone to this group means their lease requests are automatically approved without manual review.

For CLI procedures to add/remove users from the pre-approved group, see the [Pre-approved Group Management Runbook](./runbooks/preapproved-group-management.md).

**Note:** Pre-approved users bypass scoring, but this does not affect Slack operator access. A user can be in the pre-approved group (auto-approved) without being a Slack channel member, or vice versa.

## Troubleshooting

### User Can't See the Channel

**Cause:** User hasn't been invited to the private channel

**Resolution:** Follow the [Adding New Approvers](#adding-new-approvers) steps

### User Can't Click Buttons

**Possible causes:**
1. User is not a channel member (verify membership)
2. The lease was already processed (check thread reply)
3. Technical issue with Amazon Q Developer (check [Slack Action Alarms Runbook](runbooks/slack-action-alarms.md))

### Removed User Still Sees Channel

**Cause:** Slack client caching

**Resolution:**
- User should refresh their Slack client
- They won't be able to take actions even if they see cached content
- Verify removal in channel settings → Members

## Related Documentation

- [Custom Action Configuration Runbook](./runbooks/custom-action-configuration.md) - Technical details of the Approve/Deny buttons
- [Slack Action Alarms Runbook](./runbooks/slack-action-alarms.md) - Incident response for Slack integration issues
- [Operator Onboarding Canvas](./operator-onboarding-canvas.md) - Score meanings, decision criteria, contacting requesters

## Revision History

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-21 | Claude Code | Initial version (Story 7.5.1) |
| 2026-01-21 | Claude Code | Code review fixes: Added prerequisites section, corrected architecture diagram, improved CloudWatch query, fixed link paths |
