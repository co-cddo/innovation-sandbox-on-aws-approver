---
stepsCompleted: [1, 2, 3, 4, 7, 8, 9, 10, 11]
inputDocuments:
  - '_bmad-output/analysis/research/technical-approver-implementation-research-2025-12-22.md'
  - '_bmad-output/analysis/brainstorming-session-2025-12-22.md'
  - '_bmad-output/analysis/brainstorming-session-2025-12-22-edge-cases.md'
  - '_bmad-output/index.md'
  - '_bmad-output/isb-integration-reference.md'
  - '_bmad-output/deployer-pattern-reference.md'
  - '_bmad-output/approver-requirements.md'
documentCounts:
  briefs: 0
  research: 1
  brainstorming: 2
  projectDocs: 4
workflowType: 'prd'
lastStep: 11
project_name: 'innovation-sandbox-on-aws-approver'
user_name: 'Cns'
date: '2025-12-22'
---

# Product Requirements Document - innovation-sandbox-on-aws-approver

**Author:** Cns
**Date:** 2025-12-22

## Executive Summary

The Innovation Sandbox Approver automates lease approval decisions for the Innovation Sandbox on AWS (ISB), transforming what would otherwise be a manual review bottleneck into an intelligent, score-based system.

**Core principle:** Most users are acting in good faith. The system should give them a "preapproved" experience - instant access with no waiting - while due diligence happens invisibly behind the scenes.

**Business outcome:** Minimal manual approvals required while bad actors and edge cases are reliably caught and escalated.

**Expected scale:** 10-50 requests per day based on current ISB usage patterns.

### What Makes This Special

Unlike a simple approve-all or manual-only approach, this system:

- **Optimizes for good faith users** - Low-risk requests get instant approval, no waiting, no friction
- **Applies invisible due diligence** - 16 scoring rules assess risk from multiple angles (history, timing, domain verification, AI analysis)
- **Resists gaming** - Anomaly detection for coordinated behavior, rate limiting at org level, cross-organization activity logged for security review
- **Stays resilient** - Falls back to rule-based scoring when AI unavailable; queues for manual review when infrastructure fails completely. Requests are never lost.
- **Remains transparent** - Score breakdowns visible to users and reviewers; neutral language ("additional verification needed" not "suspicious")
- **Empowers operators** - Manual escalations include full context; dashboards track scoring distribution and manual review rates

**Initial target:** 80%+ auto-approval rate with reliable escalation of genuine edge cases. Threshold is configurable based on observed outcomes.

The key insight: automation isn't about removing human judgment, it's about reserving human attention for the cases that genuinely need it.

### Scope & Assumptions

- **Scoring rules are hypotheses** - Rules represent initial hypotheses based on domain expertise, designed to be validated and tuned based on operational outcomes.
- **Request scoring, not identity verification** - The system scores requests based on available signals. Credential sharing and sophisticated identity fraud are out of scope, handled by ISB's existing identity controls (Identity Center SSO).
- **Timing rules are additive** - End-of-window urgency bonus applies only within business hours, not as a mechanism to bypass weekend delays.
- **Org reputation is a conscious tradeoff** - One user's negative outcomes affect colleagues' scores temporarily (+3 for 30 days). This incentivizes organizational accountability but may feel unfair to individuals.
- **Ownership** - Owned by NDX team, integrated with existing ISB operational processes.

## Project Classification

| Attribute | Value |
|-----------|-------|
| **Technical Type** | `api_backend` (event-driven Lambda) |
| **Domain** | `govtech` → expanding to general |
| **Complexity** | Medium |
| **Project Context** | Brownfield - extending existing ISB system |

**Integration approach:** The Approver intercepts `LeaseRequested` events, applies scoring logic, and emits `LeaseApproved` or routes to manual review. It operates as a separate service that integrates with ISB via EventBridge events and DynamoDB, following patterns established by the existing ISB Deployer.

**Expansion consideration:** Scoring distinguishes between "verified organizations" (confirmed local government) and "unverified organizations" (other users) rather than framing non-gov users as "outside target audience."

## Success Criteria

### User Success

**Requester (Local Gov User):**
- **Key moment:** "I got instant approval" - experienced by 80%+ of requesters
- **When flagged:** Clear, non-accusatory feedback explaining what factors contributed
- **Reliability:** Request is never lost, even during infrastructure issues

**Operator (NDX Team):**
- **Key moment:** "I only see cases that genuinely need me"
- **Context:** Full information available to make quick decisions
- **Visibility:** Dashboard shows system health and workload trends

### Business Success

| Timeframe | Success Definition |
|-----------|-------------------|
| **3 months** | Working reliably in production, handling 10-50 requests/day |
| **12 months** | Expanded user base, tuned thresholds, evidence of self-improvement |

| Metric | Target | Rationale |
|--------|--------|-----------|
| Auto-approval rate | ≥80% | Most users are good faith |
| False positive rate | ≤50% | Acceptable to over-escalate; safety first |
| False negative rate | ≤5% | Must catch 95%+ of bad actors |
| Bedrock cost optimization | 90% reduction | Via prompt caching on repeated patterns |

**Philosophy:** Prioritize catching bad actors over minimizing operator burden.

### Technical Success

| Dimension | Target |
|-----------|--------|
| **Latency** | <5 seconds from event to decision |
| **Availability** | Serverless (Lambda) - AWS-managed reliability |
| **Cost tracking** | Cost per transaction (1 transaction = 1 user request) |
| **Reliability** | No lost requests; idempotent processing; fail-closed |
| **Observability** | Dashboards for scoring distribution, review rates, infrastructure health |
| **Auditability** | Full decision logging with score breakdown (GDPR compliance) |

### Measurable Outcomes

| Outcome | Measurement | Target |
|---------|-------------|--------|
| Operator time saved | Hours/week on manual approvals | Reduce from 100% to ~20% of requests |
| User satisfaction | Instant approval rate | ≥80% |
| Risk management | Bad actors caught | ≥95% (≤5% false negative) |
| Cost efficiency | Cost per transaction | Track and optimize |
| System reliability | Requests lost | 0 |
| Post-incident validation | When abuse discovered, was score flagged? | Track to validate scoring model |

## Product Scope

### MVP - Minimum Viable Product

- **Scoring engine** - 16 rules calculating risk score
- **EventBridge integration** - Listen for `LeaseRequested`, emit `LeaseApproved`/`LeaseDenied`
- **DynamoDB queries** - User history, org history, account availability
- **Bedrock AI analysis** - Email pattern detection (group mailbox, suspicious patterns)
- **Domain verification** - Lookup against `ukps-domains` list (not AI-based)
  - Source: https://github.com/govuk-digital-backbone/ukps-domains
  - **Note:** Until PR #1 is merged, pull from contributor branch
  - Verified = in list (-5 trust bonus)
  - Unverified = not in list (standard scoring, no penalty)
- **Business hours logic** - Delay processing outside 7am-7pm London, weekdays
- **Slack notifications** - Alert operators on escalations with full context
- **User communications** - Update lease comments with status and score breakdown
- **Fail-safe handling** - Queue for manual review on infrastructure failures
- **Basic logging** - CloudWatch logs for debugging and audit

### Growth Features (Post-MVP)

- **AI domain verification** - Bedrock analysis of WHOIS/certificates for edge cases
- **Operational dashboards** - Scoring distribution, manual review rates, infrastructure health
- **Cost tracking** - Per-transaction cost visibility
- **Threshold tuning** - Interface to adjust auto-approve threshold without deployment
- **Gaming detection** - Refined anomaly detection for coordinated behavior

### Vision (Future)

- **Self-tuning thresholds** - ML-based adjustment based on outcome data
- **Advanced anomaly detection** - Cross-org pattern recognition
- **Expanded user base** - Support for non-gov users with appropriate trust tiers
- **Workflow extensibility** - Pattern reusable for other approval workflows

## User Journeys

### Journey 1: Sarah Chen - The Instant Approval
*(Requester - Happy Path)*

Sarah is a Digital Services Lead at Westshire District Council. She's been tasked with evaluating AWS services for a citizen portal modernization project. Her IT director wants a proof-of-concept by end of month, and she's already behind schedule due to procurement delays.

She logs into the Innovation Sandbox portal at 2pm on a Tuesday, selects the "Web Application Hosting" template she's used twice before, and requests a 48-hour lease with a £50 budget. She adds a brief comment: "Testing Lambda + API Gateway for citizen feedback form."

Within 3 seconds, her request is approved. She receives an email confirming her sandbox is ready, with SSO access already configured. Sarah doesn't know it, but her score was -4: returning user (0), familiar template (-1), verified gov.uk domain (-5), modest budget (+1), short duration (+1). She just experiences "it worked instantly."

By 4pm, she has a working prototype. Her IT director is impressed. She's already planning her next sandbox request.

### Journey 2: Marcus Webb - The Escalation
*(Requester - Edge Case)*

Marcus is a new contractor at Northern Health Authority, brought in to help with cloud migration. It's his first week, and he needs a sandbox to test a data pipeline. He logs in at 6:45pm on a Friday using his `mwebb@nha-consulting.co.uk` email.

He requests a 7-day lease with a £200 budget for the "Data Analytics" template - the largest option available. He's never used the system before.

His request doesn't get instant approval. Instead, he sees: "Your request is being reviewed. You'll receive an update within one business day. Reference: ISB-2024-1847."

What Marcus doesn't see: his score was 28. First-time user (+5), unverified domain (+5 - nha-consulting.co.uk isn't in the gov.uk list), large budget (+20), long duration (+7), end-of-day Friday (+0 - no urgency bonus outside business hours), email looks individual (0). The system queued his request for Monday morning review.

Marcus is mildly frustrated but understands. He messages his manager, who confirms that contractor domains often need verification. He plans to follow up Monday.

### Journey 3: Priya Patel - The Monday Morning Queue
*(Operator - Manual Review)*

Priya is on the NDX team. She starts her Monday at 9am with a coffee and opens Slack. There's a notification: "3 requests pending manual review."

She clicks through to the first one - Marcus Webb's request. The Slack message shows:
- **Score:** 28 (threshold: 20)
- **Key factors:** First-time user (+5), unverified domain (+5), high budget (+20)
- **User:** mwebb@nha-consulting.co.uk
- **Template:** Data Analytics (7 days, £200)
- **Comment:** "Testing Glue + Redshift for NHS data warehouse POC"

Priya recognizes NHS-related work. She does a quick check: Northern Health Authority is a real NHS trust, and they've mentioned using contractors. She approves the request with a note: "Verified via NHS trust website. Approved for contractor."

Total time: 90 seconds. Marcus gets his sandbox before his 9:30 standup.

The second request is clearly suspicious - a `team-sandbox@gmail.com` email requesting maximum budget with no comment. Priya denies it.

The third is from a returning user whose org had a budget overrun last month (+3). Score was 21 - just over threshold. Priya sees their clean history otherwise and approves.

By 9:15am, the queue is clear. Priya moves on to her other work.

### Journey 4: The Silent Partner - ISB Integration
*(System Journey)*

The Innovation Sandbox doesn't know about the Approver - and that's by design.

When a user clicks "Request Sandbox" in the ISB portal, ISB publishes a `LeaseRequested` event to EventBridge with the user's email, requested template, budget, and duration. ISB sets `requiresManualApproval: true` as its default (this flag is intentionally ignored by the Approver - since the Approver IS the "manual approver" from ISB's perspective, scoring alone determines the decision).

The Approver's Lambda triggers on this event. It queries DynamoDB for the user's history, checks the domain list, calls Bedrock to analyze the email pattern, calculates the score, and makes a decision - all within 3-5 seconds.

If approved: The Approver emits `LeaseApproved` with `approvedBy: "AUTO_APPROVED"`. ISB picks this up, assigns a sandbox account, and notifies the user. ISB never knew the Approver existed - it just sees an approval event like any other.

If escalated: The Approver updates the lease's `comments` field with a polite status message, sends a Slack notification, and waits. When Priya approves, the Approver emits `LeaseApproved` with `approvedBy: "priya.patel@ndx.gov.uk"`. Same flow from ISB's perspective.

If denied: The Approver emits `LeaseDenied`. ISB marks the request as rejected.

The integration is invisible to users, transparent to ISB, and gives operators exactly what they need.

### Journey Requirements Summary

| Journey | Capabilities Revealed |
|---------|----------------------|
| Sarah (Happy Path) | Instant scoring, domain verification, template history, score invisibility to users |
| Marcus (Escalation) | Queue management, user-facing status messages, score breakdown for operators |
| Priya (Operator) | Slack notifications with context, approve/deny actions, audit trail |
| ISB Integration | EventBridge listening, event emission, DynamoDB updates, idempotent processing |

## API Backend Specific Requirements

### Project-Type Overview

The Approver is an **event-driven Lambda service** rather than a traditional REST API. It integrates with the Innovation Sandbox ecosystem through EventBridge events and DynamoDB, with no external API surface.

### Event Interface

| Direction | Event | Source/Target | Purpose |
|-----------|-------|---------------|---------|
| **Listen** | `LeaseRequested` | EventBridge (`innovation-sandbox`) | Trigger scoring workflow |
| **Emit** | `LeaseApproved` | EventBridge (`innovation-sandbox`) | Signal approval to ISB |
| **Emit** | `LeaseDenied` | EventBridge (`innovation-sandbox`) | Signal denial to ISB |
| **Write** | Lease comments | DynamoDB (ISB Lease table) | User-facing status messages |

**Event Ordering:** EventBridge does not guarantee ordering. Design assumes idempotent processing - if two events for the same lease arrive out of order, the system handles gracefully via idempotency checks.

### Authentication Model

| Component | Auth Mechanism |
|-----------|---------------|
| Lambda execution | IAM execution role |
| EventBridge | IAM resource policy |
| DynamoDB | IAM role permissions |
| Bedrock | IAM role permissions |
| Secrets Manager | IAM role permissions (Slack webhook URL) |
| Slack | Webhook URL (no auth token required) |

**No external API authentication** - this is an internal service with no public endpoints.

### Data Schemas

**Input:** EventBridge `LeaseRequested` event
```typescript
{
  detail: {
    leaseId: { userEmail: string, uuid: string },
    comments?: string,
    requiresManualApproval: boolean  // IGNORED - scoring determines decisions
  }
}
```

**Output:** EventBridge `LeaseApproved` event
```typescript
{
  detail: {
    leaseId: string,        // UUID only
    userEmail: string,
    approvedBy: string      // "AUTO_APPROVED" or operator email
  }
}
```

**DynamoDB:** Lease record (read for history, write for comments)
- See ISB Integration Reference for full schema

### Error Handling

| Error Category | Handling | User Impact |
|---------------|----------|-------------|
| EventBridge delivery failure | DLQ + CloudWatch alarm | Request retried automatically |
| DynamoDB read failure | Fail-closed (queue for manual) | Delayed approval |
| Bedrock timeout/error | Fallback to rule-based scoring | Instant approval (if rules pass) |
| Bedrock throttle (429) | Exponential backoff + circuit breaker | Brief delay |
| Slack webhook failure | Log to CloudTrail, continue | None (operator alert missed) |
| Scoring calculation error | Fail-closed (queue for manual) | Delayed approval |
| **Lambda partial failure** | Idempotency check on retry; DLQ for poison events | Automatic recovery on retry |

**Partial Failure Recovery:** If Lambda fails mid-execution (e.g., after DynamoDB write but before EventBridge emit), the event will be retried. Idempotency utility ensures no duplicate approvals. If retries exhausted, event goes to DLQ for manual investigation.

### Concurrency & Throttling

| Resource | Limit | Mitigation |
|----------|-------|------------|
| Lambda concurrency | Default (1000) | Monitor, reserve if needed |
| Bedrock requests | Service quotas | Circuit breaker, graceful degradation |
| DynamoDB reads | On-demand scaling | Monitor consumed capacity |
| EventBridge | 10,000 events/sec | N/A (well within limits) |

### Configuration Management

**Operational Config** (changeable by operators without deployment):

| Setting | Storage | Change Process |
|---------|---------|----------------|
| Auto-approve threshold | SSM Parameter Store | Parameter update |
| Scoring rule weights | SSM Parameter Store | Parameter update |
| Business hours | SSM Parameter Store | Parameter update |

**Infrastructure Config** (deployment only):

| Setting | Storage | Change Process |
|---------|---------|----------------|
| Slack webhook URL | Secrets Manager | Secret rotation |
| DynamoDB table names | Environment variable | Redeploy |
| EventBridge bus name | Environment variable | Redeploy |

**Domain Allowlist:**

| Setting | Storage | Change Process |
|---------|---------|----------------|
| UK gov domains | S3 bucket (synced from ukps-domains repo) | S3 upload; Lambda caches with 1hr TTL |

### Implementation Considerations

- **Idempotency:** Use AWS Powertools idempotency utility keyed on `{leaseId.uuid}:{eventId}` to handle retries safely
- **Scoring engine purity:** Scoring calculation must be pure functions (no side effects, deterministic) for testability
- **Cold starts:** Acceptable (<2s); provisioned concurrency not required at 10-50 requests/day
- **Observability:**
  - Structured JSON logging
  - CloudWatch metrics for scoring distribution
  - **Per-rule trigger metrics** - track which rules fire to detect misconfiguration or unused rules
- **Testing:**
  - Unit tests with mocked AWS services (scoring engine is priority target)
  - Integration tests against LocalStack
  - **Contract tests** for EventBridge schema compatibility with ISB

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**MVP Approach:** Problem-Solving MVP - solve the approval bottleneck with minimal, reliable features.

**Resource Requirements:** 1-2 developers, ~4-6 weeks for MVP

**Scope Rationale:** All four user journeys are MVP-essential. The existing scope from Product Scope section covers the minimum viable feature set with no unnecessary additions.

### MVP Validation

| User Journey | MVP Support | Key Capabilities Required |
|--------------|-------------|---------------------------|
| Sarah (Happy Path) | ✅ Full | Scoring engine, domain verification, instant approval |
| Marcus (Escalation) | ✅ Full | Queue management, user messaging, business hours |
| Priya (Operator) | ✅ Full | Slack notifications, approve/deny workflow |
| ISB Integration | ✅ Full | EventBridge events, DynamoDB operations |

### Risk Mitigation Strategy

**Technical Risks:**

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Bedrock unavailability | Medium | High | Graceful degradation to rule-based scoring |
| Domain list staleness | Low | Medium | S3 + 1hr cache TTL, manual refresh |
| EventBridge delivery issues | Low | High | DLQ + CloudWatch alarms, idempotent retry |
| Scoring logic errors | Medium | High | Pure functions, comprehensive unit tests |

**Operational Risks:**

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Queue backup over weekend | Medium | Medium | Monday morning Slack digest, burst processing |
| False negatives (bad actors through) | Low | High | Conservative thresholds initially, post-incident tracking |
| Operator fatigue (too many escalations) | Medium | Medium | Tunable threshold, rule weight adjustment via SSM |

**Resource Risks:**

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Solo developer availability | Medium | Medium | Modular design, good documentation, pair reviews |
| Scope creep | Medium | High | Clear MVP boundaries, defer Growth features |

### Development Phases (Reference)

Detailed feature breakdown in **Product Scope** section:
- **MVP:** Core scoring, integrations, notifications, fail-safe handling
- **Growth:** Dashboards, cost tracking, threshold tuning UI
- **Vision:** Self-tuning, anomaly detection, expanded users

## Functional Requirements

### Request Scoring

- FR1: System can calculate a composite risk score from multiple weighted rules
- FR2: System can apply configurable threshold to determine auto-approve vs escalate
- FR3: System can apply pessimistic scoring (skip bonuses, apply penalties) when data unavailable
- FR4: System can produce deterministic scores for identical inputs
- FR5: System can calculate score within performance budget (<5 seconds total)
- FR6: System can log complete score breakdown for each decision
- FR7: System can apply different rule weights based on configuration

### Domain Verification

- FR8: System can verify email domain against ukps-domains allowlist
- FR9: System can apply trust bonus (-5) to verified government domains
- FR10: System can treat unverified domains neutrally (no penalty)
- FR11: System can cache domain list from S3 with configurable TTL (default 1hr)

### Email Analysis

- FR12: System can detect group mailbox patterns via Bedrock AI
- FR13: System can detect suspicious email patterns via Bedrock AI
- FR14: System can fall back to rule-based scoring when Bedrock unavailable

### User History

- FR15: System can query DynamoDB for user's previous lease requests
- FR16: System can apply returning user bonus (0) vs first-time penalty (+5)
- FR17: System can apply template familiarity bonus (-1) for previously used templates
- FR18: System can detect and flag users with prior negative outcomes

### Organization Reputation

- FR19: System can query organization history from DynamoDB
- FR20: System can apply temporary penalty (+3 for 30 days) after org-level negative events
- FR21: System can track cross-organization activity patterns for security review

### Timing & Business Hours

- FR22: System can determine if request arrives during business hours (7am-7pm London, weekdays)
- FR23: System can delay processing for out-of-hours requests until next business day
- FR24: System can apply end-of-window urgency bonus (-2) for requests in final 2 hours
- FR25: System can handle timezone conversions correctly (UK time)

### Rate Limiting

- FR26: System can track request frequency per user
- FR27: System can apply rate limit penalty for burst requests from same user/org

### Event Processing

- FR28: System can listen for LeaseRequested events on EventBridge
- FR29: System can emit LeaseApproved events with approvedBy attribution
- FR30: System can emit LeaseDenied events with reason
- FR31: System can process events idempotently (no duplicate approvals)
- FR32: System can route failed events to DLQ for manual investigation

### User Communication

- FR33: System can update lease comments in DynamoDB with status messages
- FR34: System can provide user-facing status using neutral language
- FR35: System can include reference number for tracking (ISB-YYYY-NNNN format)
- FR36: System can notify users of approval via existing ISB notification mechanism

### Operator Workflows

- FR37: System can send Slack notification on escalation with full context
- FR38: Operators can view complete score breakdown in Slack message
- FR39: Operators can approve escalated request via Slack interactive button
- FR40: Operators can deny escalated request via Slack interactive button
- FR41: System can attribute approval/denial to operator email
- FR42: System can display pending review queue summary
- FR43: System can expire queued requests after configurable timeout (default: 5 business days)

### System Reliability

- FR44: System can fail-closed (queue for manual) on infrastructure errors
- FR45: System can retry failed operations with exponential backoff
- FR46: System can apply circuit breaker for Bedrock throttling
- FR47: System can process events from DLQ after recovery

### Configuration

- FR48: Operators can adjust auto-approve threshold without deployment
- FR49: Operators can adjust individual rule weights without deployment
- FR50: Operators can update business hours without deployment
- FR51: System can read operational config from SSM Parameter Store (managed via CloudFormation)

### Observability & Compliance

- FR52: System can emit structured JSON logs to CloudWatch
- FR53: System can emit CloudWatch metrics for scoring distribution
- FR54: System can track per-rule trigger frequency
- FR55: System can retain decision logs for GDPR compliance (audit trail)
- FR56: System can produce audit trail of all approval/denial decisions with timestamps and attributions
- FR57: System can flag post-incident whether original score indicated risk (lagging validation)

## Non-Functional Requirements

### Performance

| Requirement | Target | Measurement |
|-------------|--------|-------------|
| End-to-end latency (p95) | <5 seconds | Time from EventBridge trigger to decision emission |
| End-to-end latency (p99) | <8 seconds | With graceful degradation beyond |
| Scoring calculation | <2 seconds | Pure scoring logic execution |
| Bedrock response | <3 seconds | AI email analysis (with timeout fallback) |
| Cold start (after 15min idle) | <4 seconds | Acceptable for Node.js Lambda with SDK init |

### Reliability

| Requirement | Target | Mechanism |
|-------------|--------|-----------|
| Request durability | Zero lost requests | DLQ + idempotent retry |
| Failure mode | Fail-closed | Queue for manual review on errors |
| Idempotency | No duplicate decisions | AWS Powertools keyed on `{leaseId}:{eventId}` |
| Graceful degradation | Rule-based fallback | When Bedrock unavailable |
| Single dependency failure | Graceful degradation | System continues when any one of Bedrock, DynamoDB, or S3 unavailable |
| Recovery time objective | 4 business hours | Manual queue processed after infrastructure recovery |

### Security

| Requirement | Implementation |
|-------------|----------------|
| Authentication | IAM execution roles (no external API surface) |
| Authorization | IAM resource policies for EventBridge, DynamoDB, Bedrock |
| Secrets management | Secrets Manager for Slack webhook URL |
| Secrets rotation | Effective within 60 seconds of manual rotation trigger |
| Data access | Least-privilege IAM policies per resource |
| Audit trail | All decisions logged with attribution |

### Scalability

| Dimension | Current | Growth Target |
|-----------|---------|---------------|
| Daily volume | 10-50 requests | 500 requests/day without architecture changes |
| Sustained burst | N/A | 20 concurrent requests |
| Concurrent execution | Lambda default (1000) | Monitor, reserve if needed |
| DynamoDB capacity | On-demand | Auto-scales with demand |
| Bedrock quota | Service limits | Circuit breaker prevents cascade |

### Data Management

| Requirement | Specification |
|-------------|---------------|
| Decision log retention | 7 years (GDPR audit compliance) |
| Score breakdown retention | With decision logs |
| Domain list freshness | S3 cache with 1hr TTL |
| PII handling | Email addresses in logs (legitimate interest basis) |

### Observability

| Capability | Implementation |
|------------|----------------|
| Logging | Structured JSON to CloudWatch |
| Metrics | Scoring distribution, per-rule triggers, manual review rates |
| Alerting | CloudWatch alarms: DLQ depth >5 or error rate >1% over 5 minutes |
| Dashboards | Scoring trends, queue depth, infrastructure health |

### Maintainability

| Requirement | Approach |
|-------------|----------|
| Configuration changes | Effective within 5 minutes (SSM Parameter Store) |
| Rule weight tuning | Operational config via CloudFormation-managed SSM |
| Scoring engine testability | Pure functions, 90% line coverage, 100% branch coverage on threshold logic |
| Schema compatibility | Contract tests with ISB EventBridge schema |
