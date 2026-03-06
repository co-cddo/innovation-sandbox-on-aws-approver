# ISB Lease Approval Guide

> **Pin this canvas** to `#isb-approvals` for easy operator access

## Quick Start

**What this channel is for:** Operators receive lease approval requests here when the automated system flags something for human review. You have authority to approve or deny these requests.

**Your first action on any notification:**
1. **Check the thread first** - another operator may have already handled it
2. Review the score and breakdown
3. Click **Approve** or **Deny**

**One-click decisions:** Each notification has Approve and Deny buttons. Once clicked, you'll see a confirmation in the thread.

---

## Understanding Scores

### What the Score Means

Every lease request gets a **risk score** from 0-100+. The system automatically approves low-risk requests; higher-risk ones come to you.

| Score | What Happens |
|-------|--------------|
| **Less than 20** | Automatically approved (you won't see these) |
| **20 or more** | Sent here for your review |

**Why this threshold?** A score of 20 represents a typical low-risk request: a returning user from a verified council domain requesting a standard template. Higher scores indicate factors that warrant human judgment.

### The Fail-Closed Safety Model

If anything goes wrong during automated scoring (system errors, timeouts), the request is sent to you rather than auto-approved. **When in doubt, the system asks a human.**

---

## Scoring Factors Explained

The score is calculated from 19 rules. Here's what adds or subtracts points:

### Factors That Increase Score (Higher Risk)

| Factor | Points | What It Means |
|--------|--------|---------------|
| **Non-council domain** | +50 | Email not from a local authority (primary target audience) |
| **First-time user + group mailbox** | +20 | New user with shared email (e.g., team@council.gov.uk) |
| **Group mailbox detected** | +20 | Shared/team email address |
| **Cooldown violation** | +10 | Request within 1 hour of their last one |
| **First-time user** | +5 | No previous sandbox history |
| **Budget exceeded history** | +5 each | Previous sessions that ran over budget |
| **User rate limit** | +5 per extra | More than 2 requests per hour (e.g., 4 requests = +10) |
| **Org recent negative** | +3 | Others at same organization had issues recently |
| **Org rate limit** | +3 | 5+ people from same org requesting in 1 hour |
| **Template hopper** | +2 | Uses different template every time (3+ sessions) |
| **Expired leases** | +2 each | Previous sessions that expired (vs. terminated early) |
| **End of business day** | +2 | Request between 5-7pm London time |
| **Budget amount** | +1 per $10 | Higher budgets = more scrutiny |
| **Duration requested** | +1 per 8h | Longer durations = more scrutiny |

### Factors That Decrease Score (Lower Risk)

| Factor | Points | What It Means |
|--------|--------|---------------|
| **Pre-approved user** | -100 | Member of Identity Center pre-approved group (you won't see these) |
| **Verified gov domain** | -5 | Email from verified council domain list |
| **Org clean record** | -2 | Organization has 5+ sessions with no issues |
| **Early termination history** | -2 each | User ended previous sessions early (responsible) |
| **Familiar template** | -1 | Has used this template successfully before |

### How to Read the Score Breakdown

Each notification shows why the score is what it is. Example:

```
Score: 27 (threshold: 20)

Score Breakdown:
- first_time_user: +5
- group_mailbox_detected: +20
- budget_amount: +2
```

This tells you: new user with a shared mailbox requesting a modest budget. The main concern is the unknown entity with a group email.

---

## When to Approve

### Good Signs (Consider Approving)

- **Verified council domain** - Email is from a known local authority
- **Clear use case** - Request makes sense for a council employee
- **Reasonable parameters** - Budget and duration are appropriate for stated purpose
- **Good organization history** - Others from same council have used responsibly
- **Returning user with clean record** - They've used the system well before

### Common Approval Scenarios

1. **First-time user from verified council** - Score elevated only because they're new. If everything else checks out, approve.

2. **Slightly over threshold** - Score of 21-25 often means one minor flag (like end of day request). Usually safe to approve.

3. **Group mailbox from known team** - Some councils use team emails (e.g., `digital-services@council.gov.uk`). If the domain is verified, this is often legitimate.

---

## Red Flags (Consider Denying)

### Warning Signs

- **Unrecognized domain** - Not a council email, or council you haven't seen before
- **Unusual request pattern** - Very high budget, very long duration, or repeated rapid requests
- **Recent issues** - User or organization has budget exceeded or policy violations
- **Vague or suspicious purpose** - If stated purpose doesn't match typical use
- **Rate limiting triggered** - Multiple requests in short time suggests automation or testing

### When to Deny

1. **Non-council domain with high score** - If they're not our target audience and score is elevated, deny with a note about the program being for local authorities.

2. **Pattern of abuse** - Multiple budget exceeded or policy violations. System should serve responsible users.

3. **Something feels wrong** - Trust your judgment. If a request seems off, it's okay to deny and let them try again with clarification.

### When to Escalate

- **Unsure about domain legitimacy** - Check with the platform team
- **Suspected coordinated abuse** - Multiple accounts from same org behaving unusually
- **Policy questions** - Not sure if use case is within scope
- **Technical issues** - Buttons not working, errors in thread

---

## Need More Information?

### How to Contact Requesters

The notification includes the **requester's email address**. You can email them directly to ask questions before deciding.

**Subject line suggestion:** "Re: Innovation Sandbox Request - Clarification Needed"

### Good Questions to Ask

- "Could you tell me more about what you're planning to build?"
- "Is this for a specific project or learning/exploration?"
- "I see this is a team email - who will be the primary user?"
- "This is a larger budget than typical - can you explain the use case?"

### When Additional Verification is Appropriate

- First-time user with high score
- Unusual domain (not clearly a council)
- Request parameters significantly outside normal range
- Group mailbox where you want to confirm who's responsible

---

## Operational Reminders

### Always Check the Thread First

Before clicking Approve or Deny:

1. Click into the notification thread
2. Check if another operator already handled it
3. Look for any "already processed" messages

**Why?** Multiple operators may see the same notification. The first action wins, but checking avoids confusion.

### What Happens After You Click

| Action | Result |
|--------|--------|
| **Approve** | User gets their sandbox, thread shows "Approved by [you]" |
| **Deny** | User is notified, can reapply, thread shows "Denied by [you]" |
| **Already handled** | Thread shows "This request was already processed" |
| **Error** | Thread shows error message, try again or escalate |

### The 30-Minute Fallback

If a request sits in the queue for 30+ minutes without human action, the system takes over:
- **Score 20-30:** Auto-approved (low-risk threshold breach)
- **Score 31+:** Remains pending until handled

This prevents requests from getting stuck, while ensuring high-risk ones always get human review.

### Pinning This Canvas

To pin this guide for new team members:

1. Open the canvas in Slack
2. Click the **...** menu (top right)
3. Select **Pin to channel**
4. Confirm

New channel members will see it in the pinned items.

---

## Getting Help

### Related Documentation

- [Approver Access Management](./approver-access-management.md) - How to add/remove approvers
- [Custom Action Configuration](./runbooks/custom-action-configuration.md) - Technical details of buttons
- [Slack Action Alarms](./runbooks/slack-action-alarms.md) - Incident response for integration issues

### Who to Escalate To

- **Access issues:** Channel admin / workspace admin
- **Technical problems:** Platform team (see alarms runbook)
- **Policy questions:** Product owner

---

## Revision History

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-21 | Claude Code | Initial version (Story 7.5.2) |
| 2026-01-21 | Claude Code | Code review fixes: Corrected threshold to "<20" (not "≤20"), clarified user rate limit as "+5 per extra", fixed fallback range to "20-30" |
