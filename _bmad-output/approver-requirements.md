# Innovation Sandbox Approver - Requirements Summary

This document captures the requirements for the Approver service as specified by the user.

## Overview

The Approver is a score-based lease approval system that integrates with Innovation Sandbox on AWS. It intercepts lease requests, calculates a risk score, and either auto-approves, delays, or escalates to manual approval.

## Scoring System

### Base Score: 0 (lower = better)

**Auto-Approve Threshold:** Score < 20

### Scoring Rules

#### Original Rules

| Rule | Points | Condition |
|------|--------|-----------|
| Expired leases (time) | +2 each | Leases in last 30 days with status `Expired` |
| Budget exceeded | +5 each | Leases in last 30 days with status `BudgetExceeded` |
| First-time user | +5 | No previous leases in system |
| First-time + suspicious email | +20 | First lease AND email looks like group/alias (AI-determined) |
| Local government domain | -5 | Domain appears to be UK local government (AI-determined) |

#### Additional Rules (from Brainstorming Session 2025-12-22)

| Rule | Points | Condition | Data Source |
|------|--------|-----------|-------------|
| Familiar template | -1 | Requesting a template they've previously used successfully | Lease history |
| Template hopper | +2 | User never/rarely repeats templates | Lease history |
| Budget requested | +1 per $10 | Higher budget = higher scrutiny | Lease template |
| Duration requested | +1 per 8hrs | Longer duration = more exposure | Lease template |
| End-of-window request | -5 | Request submitted 6-7pm London (genuine urgency) | Request time |
| Cooldown violation | Block or +X | Request within 1hr of previous lease conclusion | Request time + history |
| Outside target audience | +10 | Domain clearly not local government | Email domain |
| Manual early termination | -2 each | User has manually terminated leases early (responsible) | Lease history |
| Org recent negative outcomes | +3 | Other users from same domain had issues (30 days) | Domain-wide history |
| Org clean track record | -2 | Other users from same domain have clean records (90 days) | Domain-wide history |

### AI Analysis (Bedrock)

Three AI checks using Amazon Bedrock:

1. **Group Mailbox Detection** (+20 points if suspicious)
   - Detect non-individual emails: `contact@`, `team@`, `info@`, `admin@`, etc.
   - Use Claude model to analyze email address patterns

2. **Local Government Detection** (-5 points if confirmed)
   - Detect UK local government domains
   - Examples: `*.gov.uk` council domains
   - Exclude central government (they're already in)

3. **Enhanced Domain Verification** (from Brainstorming Session)
   - **For `*.gov.uk` domains:** HTTP GET homepage → Bedrock analyzes if page "looks like local authority"
   - **For non-gov.uk domains:** WHOIS lookup + HTTPS certificate info → Bedrock analyzes ownership
   - **Scoring outcomes:**
     - Verified local authority: -5 (trust bonus)
     - Ambiguous/unverifiable: +5 (needs review)
     - Clearly outside target audience: +10 (unexpected user)
   - **Rationale:** Not all local councils use `*.gov.uk` (some use `councilname.org.uk`), and not all `*.gov.uk` users are local government

## Processing Rules

### Time-Based Processing

| Condition | Action |
|-----------|--------|
| UK business hours (7am-7pm London, working days) | Process immediately |
| Outside business hours | Delay until next business day |
| UK bank holidays | Delay until next business day |

**Note:** "London time" = Europe/London timezone (handles BST/GMT automatically)

### Account Availability

| Condition | Action |
|-----------|--------|
| Accounts available | Proceed with approval decision |
| No accounts available | Delay and add to FIFO queue |
| Account becomes available | Process queue oldest-first |

### Allow List

The following emails bypass scoring (always auto-approve) but still generate scores/messages with `ALLOW-LIST-OVERRIDE` suffix:

- `chris.nesbitt-smith@digital.cabinet-office.gov.uk`
- `chris.nesbitt-smith@dsit.gov.uk`
- `ndx+test@dsit.gov.uk`
- `benjamin.bennett@dsit.gov.uk`
- `dimitris.perdikou@dsit.gov.uk`
- `edward.mccutcheon@dsit.gov.uk`

**Matching:** Case-insensitive

## User Communication

### Lease Comments Updates

Update the `comments` field on the lease record to inform users:

**On Delay (outside hours):**
```
Your lease request has been received. As it was submitted outside of our processing
hours (7am-7pm London time, weekdays), it will be automatically processed on
[next business day] at approximately 7am.
```

**On Delay (no accounts):**
```
Your lease request has been received. All sandbox accounts are currently in use.
Your request has been queued and will be processed when an account becomes available.
Estimated wait time: [estimate based on queue position and average lease duration].
```

**On Manual Approval Required:**
```
Your lease request requires manual approval. Your approval score was [X]
(threshold: 20).

Score breakdown:
- [Rule]: [points]
- [Rule]: [points]
...

Your request has been forwarded to the NDX team who may be in touch to
discuss your requirements before approving.
```

**On Auto-Approve:**
```
Your lease request has been automatically approved. Score: [X] / 20.
```

**On Allow-List Override:**
```
Your lease request has been automatically approved (ALLOW-LIST-OVERRIDE).
Score: [X] (for reference only).
```

## Slack Notifications

When a lease is **not immediately auto-approved**, send a Slack webhook notification:

**Payload:**
```json
{
  "text": "Lease approval required",
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Lease Approval Required*\n\nUser: user@example.gov.uk\nLease ID: uuid-here\nScore: 25 (threshold: 20)"
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Score Breakdown:*\n• First-time user: +5\n• Suspicious email pattern: +20"
      }
    }
  ]
}
```

## Event Flow

```
LeaseRequested Event
       │
       ▼
┌──────────────────┐
│ Parse Event      │
│ (userEmail, uuid)│
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Check Allow List │
└────────┬─────────┘
         │
    ┌────┴────┐
    │ On List │
    └────┬────┘
         │ Yes                          No
         ▼                               │
┌──────────────────┐                     │
│ Auto-Approve     │                     │
│ (with override   │                     │
│  notation)       │                     │
└──────────────────┘                     │
                                         ▼
                            ┌──────────────────┐
                            │ Check Accounts   │
                            │ Available?       │
                            └────────┬─────────┘
                                     │
                                ┌────┴────┐
                                │ None    │
                                └────┬────┘
                                     │ Yes
                                     ▼
                            ┌──────────────────┐
                            │ Queue for Later  │
                            │ Update Comments  │
                            └──────────────────┘
                                     │ No
                                     ▼
                            ┌──────────────────┐
                            │ Check Business   │
                            │ Hours (UK)?      │
                            └────────┬─────────┘
                                     │
                                ┌────┴────┐
                                │ Outside │
                                └────┬────┘
                                     │ Yes
                                     ▼
                            ┌──────────────────┐
                            │ Schedule for     │
                            │ Next Business Day│
                            │ Update Comments  │
                            └──────────────────┘
                                     │ No
                                     ▼
                            ┌──────────────────┐
                            │ Calculate Score  │
                            │ (all rules)      │
                            └────────┬─────────┘
                                     │
                            ┌────────┴────────┐
                            │ Score < 20?      │
                            └────────┬─────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    │ Yes                             │ No
                    ▼                                 ▼
            ┌──────────────────┐             ┌──────────────────┐
            │ Auto-Approve     │             │ Update Comments  │
            │ Emit LeaseApproved│            │ Send Slack       │
            │ Update Comments  │             │ (wait for manual)│
            └──────────────────┘             └──────────────────┘
```

## Implementation Notes

### Cooldown Rule Decision Needed

Rule 6 (Cooldown) requires a decision:
- **Option A: Hard block** - User cannot submit within 1hr of previous lease conclusion
- **Option B: Soft scoring** - User can submit but receives penalty points

Recommendation: Option B provides intelligence about who attempts to circumvent cooldowns.

### Future Feature Opportunities

- **Self-service lease termination** - Would generate more signal about responsible users (currently users ask team to terminate)
- **User justification capture** - Not currently collected in UI, but would provide rich context for AI analysis

---

*Generated: 2025-12-22*
*Updated: 2025-12-22 (Brainstorming session added 11 new rules)*
*Source: User requirements conversation + Brainstorming session*
