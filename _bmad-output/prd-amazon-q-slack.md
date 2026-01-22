---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
inputDocuments:
  - '_bmad-output/amazon-q-slack-poc-summary.md'
  - '_bmad-output/prd.md'
  - '_bmad-output/architecture.md'
documentCounts:
  briefs: 0
  research: 0
  brainstorming: 0
  projectDocs: 3
workflowType: 'prd'
lastStep: 11
project_name: 'innovation-sandbox-on-aws-approver'
feature_name: 'Amazon Q Developer Slack Integration'
user_name: 'Cns'
date: '2026-01-20'
---

# Product Requirements Document - Amazon Q Developer Slack Integration

**Author:** Cns
**Date:** 2026-01-20

## Executive Summary

This PRD defines the replacement of one-way Slack webhook notifications with Amazon Q Developer (AWS Chatbot) integration, enabling interactive approve/deny actions directly within Slack.

**Core principle:** Approval should happen where operators already are, not where the system wants them to be.

**Business outcome:** Faster approvals with zero context switching, simplified approver management via Slack channel membership, and richer operator context for decision-making.

**Timing:** Implementing before production launch avoids operator retraining and ensures the approval workflow is optimized from day one.

**Expected volume:** 2-10 escalations per day (based on ~20% escalation rate of 10-50 daily requests)

### What Makes This Special

Unlike the current webhook approach that requires authentication to the ISB console:

- **Zero-friction approval** - Operators approve or deny with a single button click, no SSO journey required
- **Richer context** - Full score breakdown, requester email for direct contact, risk factors highlighted in the notification
- **Simplified access control** - Add/remove approvers by managing Slack channel membership, no ISB admin permissions needed
- **Thread-based workflow** - Action confirmations posted to the same thread; operators should check the thread before acting to see if someone else has already responded
- **Safe duplicate handling** - Idempotent processing ensures clicking a button twice (or two people clicking) doesn't cause duplicate approvals
- **Full audit trail** - CloudWatch and DynamoDB logging continues alongside Slack thread history
- **Graceful migration** - Existing webhook code removed after validation

**Fallback:** If Amazon Q/Slack is unavailable, the existing 30-minute scheduled queue check continues processing. Requests are never lost.

**Scope:** Replace FR37-FR43 (Slack webhook notifications) with SNS + Amazon Q Developer integration, validated by POC.

### Success Metrics

| Metric | Target |
|--------|--------|
| Median time from notification to decision | <5 minutes |
| Operator adoption | 100% of approvals via Slack buttons |
| Action Lambda error rate | <1% |
| Stale requests (>4 hours pending) | <5% of escalations |

### Key Architectural Decisions

| ADR | Decision | Rationale |
|-----|----------|-----------|
| **ADR-001** | SNS + Amazon Q Developer for notifications | Interactive buttons, AWS-managed reliability, IAM-only auth |
| **ADR-002** | Slack Custom Action → Lambda for approvals | Single-click approval, no context switching, mobile-friendly |
| **ADR-003** | Thread replies for confirmation | Amazon Q limitation; visible audit trail for team |
| **ADR-004** | Channel membership for access control | Simple approver management, decoupled from ISB admin |

**Alternatives considered:** Direct Slack webhook (no interactivity), custom Slack bot (higher complexity), ISB console approval (high friction), message editing (not supported by Amazon Q).

### Scope & Assumptions

- **POC validated** - SNS notifications, custom action buttons, thread updates all proven working
- **Manual AWS Console step** - Custom actions must be configured manually (not CDK-manageable)
- **Dedicated private channel** - Approvals-only Slack channel, private, invite-only for security
- **Channel-based permissions** - Approver access controlled via Slack channel membership with quarterly audit
- **Button persistence** - Buttons remain visible after action (Amazon Q limitation); thread updates indicate status
- **Alerting requirements** - CloudWatch alarms on action Lambda errors and stale request thresholds
- **Runbook documentation** - Custom action configuration documented with screenshots for reproducibility
- **Operator onboarding** - Approver guidance published as Slack canvas in the approvals channel (markdown format)
- **Webhook removal criteria** - Successful approve and successful deny manually confirmed, then remove webhook code

## Project Classification

| Attribute | Value |
|-----------|-------|
| **Technical Type** | `api_backend` (event-driven Lambda) |
| **Domain** | `govtech` |
| **Complexity** | Medium |
| **Project Context** | Brownfield - extending existing Approver system |

**Integration approach:** Replaces direct Slack webhook with SNS topic publishing. Amazon Q Developer (AWS Chatbot) subscribes to SNS and delivers rich notifications to a dedicated private Slack channel with full score breakdowns. Custom actions invoke intermediary Lambdas that call ISB Leases API, with thread updates confirming outcomes. Operators should check the thread for existing responses before taking action.

## Success Criteria

### Philosophy

Speed and adoption are means, not ends. The end is **good decisions with appropriate effort**. We optimize for decision quality, not decision speed.

### User Success

**Operator (Approver):**
- **Key moment:** "I had everything I needed to decide, right there in Slack"
- **Friction eliminated:** No console navigation, no context switching between applications
- **Confidence:** Notification contains sufficient context to make an informed decision
- **Clarity:** Thread updates confirm actions taken; easy to see what's been handled

**Requester (Lease Applicant):**
- **Appropriate turnaround:** Requests handled promptly without rushing operator decisions
- **No change to their experience:** Transparent improvement - they get appropriate attention

**Team Lead:**
- **Simpler access management:** Add/remove approvers via Slack channel membership
- **Visibility:** Can see approval activity in the channel without needing reports
- **Quality assurance:** Can review decision patterns and identify training needs

### Business Success

| Timeframe | Success Indicator |
|-----------|-------------------|
| **Week 1** | Successful approve and deny manually confirmed; webhook code removed |
| **Week 2** | Baseline metrics established for ongoing comparison |
| **Month 1** | Operators report having sufficient context to decide |
| **Month 3** | Stable deny rate; no increase in post-lease issues; positive operator feedback |

**Feedback mechanism:** Operator feedback collected at 2-week and 1-month marks:
- "Did you have enough information to decide?" (confidence)
- "Did you need to look elsewhere for context?" (notification completeness)
- "Any requests where you felt rushed or uncertain?" (quality concern)

**Failure signals:**
- Operators reporting insufficient context in notifications
- Increase in stale requests (>4 hours pending)
- Post-lease issues correlating to quick approvals
- Operators bypassing Slack to check console directly (investigate why)

### Technical Success

| Dimension | Target | Rationale |
|-----------|--------|-----------|
| **Zero missed escalations** | No requests lost due to notification failure | Reliability is fundamental |
| **Zero duplicate approvals** | Idempotency verified via logged cache hits | No new failure modes |
| **Thread update success** | >99% | Operators need confirmation |
| **Notification delivery** | 100% to SNS; Chatbot delivery AWS-managed | Trust but verify |

### Decision Quality (Leading Indicators)

Since we can't directly measure "did we approve the right requests," we track:

| Indicator | What It Tells Us | How Measured |
|-----------|------------------|--------------|
| Operator confidence | "I had enough info to decide" | Survey (1-5 scale) |
| Notification completeness | Did operator need to look elsewhere? | Survey (yes/no) |
| Post-lease issues | Leases that caused problems | Manual retrospective analysis initially; automated in Growth |
| Deny rate stability | Sudden changes may indicate issues | Weekly trend monitoring |

### Measurable Outcomes

| Outcome | Measurement | Purpose |
|---------|-------------|---------|
| Reliability | Missed escalations due to notification failure | **Success metric:** Must be zero |
| Operator engagement | Time from notification to first thread activity | **Operational monitoring:** Awareness, not a target |
| Response time | p95 time from notification to decision | **Operational monitoring:** Track for awareness, not optimized |
| Operator behaviour | % using Slack buttons vs proactively checking console | **Diagnostic:** Investigate if console-seeking is high |
| Decision confidence | Survey: "Had enough info to decide" | **Success metric:** Target >4.0 / 5.0 average |

**Baseline establishment:** First 2 weeks in production establish baseline metrics for ongoing comparison.

**Notification path clarification:** After webhook removal, ISB console remains accessible for operators to proactively check pending requests, but notifications only come via Slack. "Preference" tracking measures whether operators use Slack buttons or seek out the console independently - high console-seeking indicates a problem to investigate, not an alternative to support.

## Product Scope

### MVP - Minimum Viable Product

**In scope:**
- SNS topic for notification publishing
- Amazon Q Developer (Chatbot) configuration for Slack channel
- Approve Lambda - handles approve button clicks, calls ISB Leases API
- Deny Lambda - handles deny button clicks, calls ISB Leases API
- Thread updates confirming action outcomes
- Rich notification format with score breakdown, requester email, risk factors - **sufficient for decision without looking elsewhere**
- CloudWatch alarms on action Lambda errors and SNS delivery failures
- Runbook documenting custom action configuration
- Operator onboarding Slack canvas (markdown)
- Removal of existing Slack webhook code after validation
- Idempotency logging to verify duplicate prevention is working
- 2-week and 1-month operator feedback surveys (confidence + completeness questions)

**Out of scope for MVP:**
- Message editing (Amazon Q limitation - accepted)
- Button disabling after click (Amazon Q limitation - accepted)
- Automated channel membership auditing (manual quarterly review)
- Automated post-lease issue correlation (manual analysis initially)

**Deferred to Growth (with rationale):**
- "Request More Info" action - Operators can contact requester via email shown in notification; assess need based on feedback

### Growth Features (Post-MVP)

- "Request More Info" action if feedback indicates need
- Daily digest of pending requests for visibility
- Automated post-lease issue correlation to approval path (decision quality feedback loop)
- Integration with Slack workflows for escalation paths
- Metrics dashboard for approval patterns and decision quality indicators

### Vision (Future)

- Self-service approver onboarding via Slack workflow
- Decision quality ML: flag approvals that match patterns of past problematic leases
- Cross-channel notifications for urgent escalations

## User Journeys

### Journey 1: Priya Patel - The Slack Approve
*(Operator - Happy Path)*

Priya is on the NDX team. It's Tuesday at 10:15am and she's deep in a Slack conversation with a colleague about an upcoming workshop when a notification appears in the `#isb-approvals` channel.

She glances at the message without leaving her current conversation:

> **🔔 Lease Review Required**
> **Requester:** sarah.chen@westshire.gov.uk
> **Score:** 22 (threshold: 20)
> **Key factors:** First-time template (+3), modest budget (+1), end-of-day (+0)
> **Template:** Web Application Hosting (48h, £50)
> **Comment:** "Testing Lambda + API Gateway for citizen feedback form"
>
> `[Approve]` `[Deny]`

Priya recognizes Westshire District Council - they've had several successful sandbox users. The request is small, the comment is sensible, and the score is just barely over threshold. She clicks **Approve**.

A thread reply appears instantly:
> ✅ **Approved by priya.patel@ndx.gov.uk** at 10:16am

Priya returns to her workshop conversation. Total interruption: 45 seconds. Sarah Chen receives her sandbox credentials before her coffee gets cold.

**What Priya didn't have to do:**
- Open a new browser tab
- Navigate to ISB console
- Authenticate via SSO
- Find the pending request
- Click through a confirmation dialog

### Journey 2: Priya Patel - The Already Handled
*(Operator - Edge Case)*

It's Monday morning. Priya opens Slack to find three notifications from the weekend in `#isb-approvals`. She starts with the oldest one - a request from Friday evening.

She clicks **Approve** on the first request, but the thread reply says:
> ℹ️ **Already processed** - This request was approved by david.chen@ndx.gov.uk on Monday at 9:02am

Priya checks the thread and sees David's approval confirmation from earlier. She'd missed it in the Monday morning Slack catch-up. No harm done - the system handled the duplicate click gracefully.

She moves to the second request and sees it already has a thread reply showing it was denied. She skips to the third.

**What the system handled:**
- Idempotent processing prevented double-approval
- Clear feedback explained what happened
- Thread history showed the full audit trail

### Journey 3: James Morrison - The Monday Cover
*(Ad-hoc Approver - First Time)*

James is a senior engineer on the platform team. Priya is on holiday this week, and the team lead Sarah has asked him to cover approvals. On Friday, Sarah added him to the `#isb-approvals` channel and pinned a Slack canvas titled "Approver Guide."

Monday morning, James reads the canvas:
> **Quick Guide for Approvers**
> - Notifications appear when requests need review
> - Check the score breakdown - anything over 20 needs human review
> - Click Approve or Deny directly in Slack
> - Check the thread first to see if someone else already handled it
> - When in doubt, check the requester's email domain and comment

His first notification arrives at 9:30am. It's a contractor with an unverified domain requesting a large budget. James reads the score breakdown carefully - the +20 for high budget is the main factor. The comment mentions "NHS data warehouse POC" and the email is from a legitimate-looking consultancy.

He's not sure. He copies the requester's email from the notification and sends a quick message asking for more context. Twenty minutes later, with confirmation that this is a known NHS contractor, he clicks **Approve**.

Thread reply: ✅ **Approved by james.morrison@ndx.gov.uk** at 9:52am

**What made this possible:**
- Channel membership = approval authority (no IT tickets)
- Slack canvas provided just-in-time guidance
- Requester email visible for direct contact
- No specialized training or console access needed

### Journey 4: Sarah Mitchell - The New Approver
*(Team Lead - Onboarding)*

Sarah is the NDX team lead. A new team member, Aisha, is joining the on-call rotation and needs approval authority.

**Old process (ISB console):**
1. Submit access request ticket to IT
2. Wait for approval (1-2 days)
3. IT grants ISB admin permissions
4. Schedule training on ISB console
5. Aisha shadows Priya for a week
6. Aisha handles first approval with supervision

**New process (Amazon Q):**
1. Sarah types `/invite @aisha.johnson` in `#isb-approvals`
2. Sarah points Aisha to the pinned Approver Guide canvas
3. Aisha is ready to handle approvals

Total time: 30 seconds.

When Aisha's rotation ends in a month, Sarah removes her from the channel. No IT tickets, no permission cleanup, no audit trail gaps.

**What this enables:**
- Flexible rotation coverage
- No coupling to ISB admin permissions
- Self-service access management
- Clear audit trail via Slack channel membership

### Journey 5: Platform Team - The Silent Alert
*(Operations - Error Scenario)*

It's 2am. The Approve Lambda throws an error - the ISB Leases Lambda is returning 503s due to a deployment issue.

**What happens automatically:**
1. Lambda error triggers CloudWatch alarm
2. Alarm sends to PagerDuty via SNS
3. On-call engineer (James) receives alert: "ApproveActionLambda error rate >1%"

**What James sees:**
- CloudWatch logs show 503 responses from ISB
- The approval request is still pending (fail-closed)
- No approvals were lost or duplicated

**What James does:**
- Checks ISB deployment status
- Confirms ISB team is addressing the issue
- Monitors until ISB recovers
- The queued approval succeeds on the next operator click

**The user (operator) experience:**
- They clicked Approve but didn't see the thread confirmation
- They check the thread and see: ❌ **Error - please try again** with a reference ID
- They try again once the issue is resolved, and it works

### Journey Requirements Summary

| Journey | Capabilities Revealed |
|---------|----------------------|
| Priya (Happy Path) | Rich notifications with all decision context, one-click approve, instant thread confirmation |
| Priya (Already Handled) | Idempotent processing, clear duplicate feedback, thread-based audit trail |
| James (First Time) | Channel-based access, Slack canvas onboarding, requester email for contact |
| Sarah (Onboarding) | Channel invite = authority, no IT dependencies, self-service access management |
| Platform (Error) | CloudWatch alerting, fail-closed behaviour, error feedback to operators, retry capability |

## API Backend Specific Requirements

### Project-Type Overview

This feature adds event-driven Lambda components to the existing ISB Approver system:
- **SNS Topic** for notification publishing (replaces direct Slack webhook)
- **Approve Lambda** invoked by Amazon Q custom action
- **Deny Lambda** invoked by Amazon Q custom action

All components integrate with the existing ISB Leases Lambda API and follow established patterns from POC validation.

### SNS Notification Schema

**Topic:** `isb-approval-notifications` (or environment-specific naming)

**Message Payload:**
```json
{
  "requestId": "uuid",
  "requesterEmail": "user@domain.gov.uk",
  "score": 22,
  "threshold": 20,
  "scoreBreakdown": [
    { "factor": "First-time template", "points": 3 },
    { "factor": "Modest budget", "points": 1 }
  ],
  "template": {
    "name": "Web Application Hosting",
    "duration": "48h",
    "budget": "£50"
  },
  "comment": "Testing Lambda + API Gateway for citizen feedback form",
  "timestamp": "ISO8601"
}
```

Amazon Q Developer formats this into rich Slack notification with approve/deny buttons.

### Action Lambda Interfaces

**Approve Lambda:**
- **Trigger:** Amazon Q custom action button click
- **Input:** Request ID, operator Slack identity (mapped to email)
- **Processing:**
  1. Check idempotency (has this request already been actioned?)
  2. Call ISB Leases Lambda approve endpoint
  3. Return thread reply content
- **Outputs:**
  - Success: `✅ Approved by {operator}@{domain} at {time}`
  - Already processed: `ℹ️ Already processed - This request was {action} by {previous_operator} on {date} at {time}`
  - Error: `❌ Error - please try again (ref: {error_id})`

**Deny Lambda:**
- **Trigger:** Amazon Q custom action button click
- **Input:** Request ID, operator Slack identity
- **Processing:** Same pattern as Approve Lambda
- **Outputs:** Same pattern with "Denied" messaging

### Error Handling

| Scenario | Response | Logging |
|----------|----------|---------|
| Success | Thread confirmation message | CloudWatch + DynamoDB audit |
| Already actioned | Informational thread reply | CloudWatch (cache hit logged) |
| ISB Leases API error | Error message with reference ID | CloudWatch alarm trigger |
| Invalid request ID | Error message | CloudWatch warning |
| Timeout | Error message with retry guidance | CloudWatch alarm trigger |

### Rate Limits

No explicit rate limiting required. Human interaction rates (2-10 escalations/day, single-click actions) are well within Lambda and ISB Leases API capacity. Standard AWS service limits apply.

### Integration Points

| Component | Integration | Protocol |
|-----------|-------------|----------|
| Scoring Lambda → SNS | Publish notification on escalation | AWS SDK |
| Amazon Q → Action Lambdas | Custom action invocation | AWS Chatbot |
| Action Lambdas → ISB Leases | Approve/Deny API calls | HTTPS/Lambda invoke |
| Action Lambdas → DynamoDB | Idempotency + audit logging | AWS SDK |

## Functional Requirements

### Notification Publishing

- **FR1:** Scoring system can publish escalation notifications to SNS topic when requests exceed threshold
- **FR2:** Notification can include requester email, score, score breakdown, template details, comment, and request ID
- **FR3:** Amazon Q Developer can receive SNS notifications and deliver to configured Slack channel
- **FR4:** Notification can render as rich formatted message with approve/deny action buttons

### Approval Actions

- **FR5:** Operator can approve a lease request by clicking the Approve button in Slack
- **FR6:** Operator can deny a lease request by clicking the Deny button in Slack
- **FR7:** Approve action can invoke ISB Leases Lambda approve endpoint with request ID and operator identity
- **FR8:** Deny action can invoke ISB Leases Lambda deny endpoint with request ID and operator identity

### Confirmation & Feedback

- **FR9:** System can post thread reply confirming successful approval with operator identity and timestamp
- **FR10:** System can post thread reply confirming successful denial with operator identity and timestamp
- **FR11:** System can post thread reply indicating request was already processed by another operator
- **FR12:** System can post thread reply indicating error with reference ID when action fails

### Idempotency & Audit

- **FR13:** System can detect duplicate action attempts on already-processed requests
- **FR14:** System can log all action attempts to CloudWatch for audit trail
- **FR15:** System can log idempotency cache hits for duplicate verification
- **FR16:** System can store action outcomes in DynamoDB for audit persistence

### Operational Monitoring

- **FR17:** CloudWatch can alarm when action Lambda error rate exceeds threshold
- **FR18:** CloudWatch can alarm when SNS delivery fails
- **FR19:** Platform team can receive alerts via existing alerting integration when alarms trigger

### Access Control & Onboarding

- **FR20:** Team lead can add approvers by inviting them to the Slack channel
- **FR21:** Team lead can remove approvers by removing them from the Slack channel
- **FR22:** Operators can access onboarding guidance via pinned Slack canvas in the approvals channel
- **FR23:** Operations team can access runbook documenting custom action configuration

### Migration & Fallback

- **FR24:** Existing Slack webhook code can be removed after successful approve and deny manually confirmed
- **FR25:** Existing 30-minute scheduled queue check remains operational as fallback mechanism

## Non-Functional Requirements

### Reliability

- **NFR1:** SNS notifications must be delivered with AWS-managed reliability (no self-managed retry logic required)
- **NFR2:** Action Lambda failures must fail closed - request remains pending, never auto-approved or auto-denied
- **NFR3:** Idempotency must be guaranteed - duplicate button clicks must never result in duplicate ISB Leases API calls
- **NFR4:** Thread reply delivery must succeed >99% of action attempts
- **NFR5:** Existing 30-minute scheduled queue check must remain operational as fallback mechanism

### Security

- **NFR6:** Operator authorization must be derived from Slack channel membership (no separate permission system)
- **NFR7:** Request IDs must be non-guessable (UUIDs, not sequential integers)
- **NFR8:** All action attempts must be logged to immutable audit trail (CloudWatch + DynamoDB)
- **NFR9:** Slack channel must be private and invite-only

### Integration

- **NFR10:** ISB Leases Lambda API integration must handle transient failures with appropriate error messaging
- **NFR11:** End-to-end action latency (button click → thread reply) must be acceptable for interactive use (<5 seconds typical)
- **NFR12:** SNS message format must be compatible with Amazon Q Developer notification rendering

