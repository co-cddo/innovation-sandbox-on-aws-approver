---
stepsCompleted: [1, 2, 3]
inputDocuments: []
session_topic: 'Edge case handling - error conditions in Innovation Sandbox Approver'
session_goals: 'Identify all error conditions we need to handle gracefully'
selected_approach: 'AI-Recommended Techniques'
techniques_used: ['Reverse Brainstorming', 'Chaos Engineering', 'Decision Tree Mapping']
ideas_generated: [47]
context_file: '_bmad-output/approver-requirements.md'
---

# Brainstorming Session Results

**Facilitator:** Cns
**Date:** 2025-12-22

## Session Overview

**Topic:** Edge case handling - error conditions in Innovation Sandbox Approver

**Goals:** Identify all error conditions we need to handle gracefully

### Context Guidance

This session builds on the existing Approver requirements:
- **Scoring system:** 16 rules with auto-approve threshold < 20
- **Integration points:** EventBridge events, DynamoDB tables, Bedrock AI, Slack webhooks
- **External dependencies:** UK Bank Holidays API, WHOIS lookups, HTTPS certificate checks
- **Processing rules:** UK business hours, account availability queue, allow-list

### Session Setup

**Approach Selected:** AI-Recommended Techniques

## Technique Selection

**Approach:** AI-Recommended Techniques
**Analysis Context:** Edge case handling with focus on identifying all error conditions

**Recommended Techniques:**

| Phase | Technique | Purpose |
|-------|-----------|---------|
| 1 | Reverse Brainstorming | Find all failure scenarios by asking "What could go wrong?" |
| 2 | Chaos Engineering | Stress-test each component - deliberate breakage exploration |
| 3 | Decision Tree Mapping | Organize into handling matrix with detection/recovery paths |

**AI Rationale:** Error condition discovery benefits from systematic failure-focused thinking (Reverse Brainstorming), followed by stress-testing each integration point (Chaos Engineering), then organizing findings into actionable structure (Decision Tree Mapping).

## Technique Execution Results

### Phase 1: Reverse Brainstorming

**Focus:** "What could go wrong?" across all system components

#### Event Ingestion Layer
| Failure | Impact |
|---------|--------|
| Duplicate evaluation / double approval | ISB deploys twice, allocates two accounts |
| Manual + auto approval race condition | Conflicting approval states, audit confusion |
| Timezone misalignment | Unintended delays or lack of delay |
| DST transitions | Business hours logic fails at boundary |
| Event timestamp vs processing time | Different time governs decision |

#### DynamoDB Operations
| Failure | Impact |
|---------|--------|
| Large domain query (thousands of users) | Timeout, memory exhaustion, throttling |
| Throttling during scoring | Incomplete score calculation |
| Eventually consistent read | Miss recent lease conclusion |
| Write conflict on comments | User sees stale message |
| Partition hot-spotting | Popular domains cause bottlenecks |

#### Bedrock AI Calls
| Failure | Impact |
|---------|--------|
| Non-deterministic outcomes | Same input scores differently on retry |
| Names that look like teams | False positive on legitimate individuals |
| Local gov naming conventions | Role-based emails misclassified |
| Cost runaway | Retry storms, large pages, burst traffic |
| Bedrock timeout/throttle | Scoring incomplete |
| Prompt injection from external data | AI manipulated by crafted content |
| Model response format unexpected | JSON parsing fails |

#### External APIs
| Failure | Impact |
|---------|--------|
| Prompt injection via webpage/WHOIS | Attacker crafts content to pass verification |
| Incorrect/stale information | Wrong holidays, old WHOIS data |
| Bank Holiday API down | Unknown if business day |
| WHOIS rate limited | Can't verify domain |
| Webpage 403/404/redirect loop | Verification fails |
| Slack webhook revoked/429 | Silent notification failure |
| DNS resolution failure | Transient vs permanent unclear |

#### Scoring Logic
| Failure | Impact |
|---------|--------|
| Gaming open source rules | Bad actors optimize scores |
| Threshold boundary (exactly 20) | Ambiguous outcome |
| Negative score possibility | Over-trusted users |
| Null/undefined in calculation | NaN breaks comparison |
| Cumulative surprise scenarios | Unexpected approve/deny |

#### Queue Management
| Failure | Impact |
|---------|--------|
| Delay to lower scrutiny time | Weekend/holiday processing without oversight |
| Thundering herd at 7am Monday | Burst overwhelms system |
| Message expires in queue | Request silently dropped |
| FIFO ordering violated | Unfair processing |
| User cancels while queued | Wasted account allocation |
| State changed while queued | Score now different |
| DLQ not monitored | Failed messages pile up |

### Phase 2: Chaos Engineering

**Focus:** Deliberately break components - what cascades? How do we recover?

#### Core Failure Response Decisions

| Component Type | Failure Response | Rationale |
|----------------|------------------|-----------|
| Scoring infrastructure (DynamoDB, Bedrock) | Fail closed → manual queue | Security over availability |
| External APIs (Bank Holidays, WHOIS, web fetch) | Fail closed → manual queue | Can't score accurately without data |
| Notifications (Slack) | Continue processing, log CloudTrail | Not scoring-critical |

#### Partial Data Strategy

| Rule Type | If Data Unavailable | Example |
|-----------|---------------------|---------|
| Penalty rules (+points) | Apply worst case | Bedrock timeout → assume +20 suspicious |
| Trust bonus rules (-points) | Don't apply | Org query failed → no -2 bonus |

**Result:** Pessimistic scoring pushes toward manual review on failures.

#### Operational Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Timestamp source | Processing time | Actual decision time, avoids stale/manipulated events |
| Bulk recovery | Burst process | User experience priority, fail-closed handles overload |
| Allow-list during outage | Still auto-approve | Trusted users unaffected by infrastructure issues |

#### Cascade Scenarios Explored

| Scenario | Outcome |
|----------|---------|
| Bedrock down 2hrs | All requests queue for manual review |
| DynamoDB throttled | All requests queue for manual review |
| Slack webhook dead | Processing continues, CloudTrail audit |
| All external APIs down | Fail closed, queue for manual |
| Lambda delayed processing | Use current time, user comms explain |
| Total 4hr outage | Burst recovery, fail-closed self-regulates |

### Phase 3: Decision Tree Mapping

**Focus:** Organize errors into actionable handling matrix

#### Category 1: Infrastructure Failures

| Error | Detection | Handling | User Comms | Ops Alert |
|-------|-----------|----------|------------|-----------|
| Bedrock unavailable | 503/timeout after retry | Fail closed, queue | "Request requires manual review" | CloudWatch alarm |
| Bedrock throttled | 429 response | Fail closed, queue | "Request requires manual review" | CloudWatch alarm |
| DynamoDB throttled | ProvisionedThroughputExceeded | Fail closed, queue | "Request requires manual review" | CloudWatch alarm |
| DynamoDB timeout | Timeout error | Fail closed, queue | "Request requires manual review" | CloudWatch alarm |

#### Category 2: External API Failures

| Error | Detection | Handling | User Comms | Ops Alert |
|-------|-----------|----------|------------|-----------|
| Bank Holiday API down | HTTP error/timeout | Fail closed, queue | "Request requires manual review" | CloudWatch alarm |
| Bank Holiday API stale | Compare year in response | Fail closed, queue | "Request requires manual review" | Alert + investigate |
| WHOIS lookup failed | Timeout/rate limit | Pessimistic score (+5 ambiguous) | Score reflects uncertainty | Log only |
| WHOIS rate limited | 429 response | Pessimistic score (+5) | Score reflects uncertainty | Daily digest |
| Webpage fetch failed | 403/404/timeout | Pessimistic score (+5) | Score reflects uncertainty | Log only |
| Webpage redirect loop | Max redirects exceeded | Pessimistic score (+5) | Score reflects uncertainty | Log only |
| Slack webhook failed | Non-2xx response | Continue, log CloudTrail | (none - not user-facing) | CloudWatch alarm |
| Slack webhook revoked | 404 response | Continue, log CloudTrail | (none) | **Immediate alert** |

#### Category 3: Scoring & Data Issues

| Error | Detection | Handling | User Comms | Ops Alert |
|-------|-----------|----------|------------|-----------|
| Bedrock non-deterministic | N/A (can't detect) | Cache results per email/domain | (none - transparent) | Log for analysis |
| Bedrock unexpected format | JSON parse error | Pessimistic score (assume worst) | Score reflects uncertainty | CloudWatch alarm |
| Prompt injection suspected | N/A (hard to detect) | Sanitize inputs, limit context | (none) | Log patterns |
| Large domain query timeout | Query timeout | Pessimistic score (skip org bonus) | Score reflects uncertainty | Alert if frequent |
| Score exactly 20 | Score === 20 | Treat as >= threshold (manual) | "Request requires manual review" | (none) |
| Negative score calculated | Score < 0 | Floor at 0, log anomaly | Auto-approve | Log for review |
| NaN/undefined in score | isNaN check | Fail closed, queue | "Request requires manual review" | **Immediate alert** |

#### Category 4: Concurrency & Race Conditions

| Error | Detection | Handling | User Comms | Ops Alert |
|-------|-----------|----------|------------|-----------|
| Duplicate event processing | Idempotency key check | Skip if already processed | (none - transparent) | Log duplicate |
| Double approval emitted | Check lease state before emit | Skip if already approved | (none) | Log anomaly |
| Manual + auto race | Check approval state before emit | First wins, skip second | (none) | Log race detected |
| State changed while queued | Re-score on processing | Use fresh data | Score may differ from queue time | (none) |
| User cancelled while queued | Check lease status before processing | Skip cancelled | (none) | Log skipped |

#### Category 5: Queue & Timing Issues

| Error | Detection | Handling | User Comms | Ops Alert |
|-------|-----------|----------|------------|-----------|
| Message expires in queue | SQS message age | Fail closed, notify user | "Request expired, please resubmit" | Alert + review TTL settings |
| FIFO ordering violated | Timestamp comparison | Log anomaly, process anyway | (none) | Log for investigation |
| Thundering herd (7am Monday) | Request rate spike | Let burst, fail-closed regulates | Some may queue for manual | CloudWatch alarm on rate |
| DLQ messages accumulating | DLQ depth metric | Investigate cause | (none) | **Immediate alert** |
| Delayed to low-oversight time | N/A (by design) | Accept risk, CloudTrail audit | (none) | Daily digest of overnight approvals |

#### Category 6: Time & Timezone Issues

| Error | Detection | Handling | User Comms | Ops Alert |
|-------|-----------|----------|------------|-----------|
| DST transition edge | Check for clock change day | Use Europe/London consistently | May delay unexpectedly | Log edge cases |
| Lambda timezone misconfigured | Unit test | Fail deployment | (none - pre-prod) | CI/CD failure |
| Processing vs event time skew | Compare timestamps | Use processing time always | "Processed at [time]" in comments | Log if >5min skew |
| Bank holiday not in cache | Missing date in API response | Fail closed, queue | "Request requires manual review" | Alert to check API |

#### Category 7: Security & Abuse

| Error | Detection | Handling | User Comms | Ops Alert |
|-------|-----------|----------|------------|-----------|
| Gaming detected (pattern) | Analytics on scoring patterns | Flag for review | (none - don't reveal detection) | Weekly digest |
| Prompt injection attempt | Input sanitization | Sanitize, log attempt | (none) | Log for security review |
| Cost runaway (Bedrock) | CloudWatch billing alarm | Circuit breaker at threshold | Fail closed, queue | **Immediate alert** |
| Allow-list abuse | Manual review | N/A (trusted users) | (none) | Periodic audit |

---

## Session Summary

**Goal:** Identify all error conditions we need to handle gracefully
**Result:** 47 error conditions identified and mapped ✅

### Key Design Decisions Made

| Decision | Choice |
|----------|--------|
| Scoring infrastructure failure | Fail closed → manual queue |
| External API failure | Fail closed → manual queue |
| Notification failure | Continue processing, CloudTrail audit |
| Partial scoring data | Pessimistic (apply penalties, skip bonuses) |
| Timestamp source | Processing time, not event time |
| Bulk recovery | Burst process, let fail-closed regulate |
| Score threshold boundary | Score = 20 treated as manual review |
| Negative scores | Floor at 0 |

### Monitoring Requirements

**Immediate Alerts:**
- Slack webhook revoked (404)
- NaN/undefined in score calculation
- DLQ messages accumulating
- Bedrock cost threshold exceeded

**CloudWatch Alarms:**
- Bedrock 503/429 errors
- DynamoDB throttling
- Bank Holiday API failures
- Request rate spikes

**Daily Digests:**
- WHOIS rate limiting frequency
- Overnight approval summary
- Gaming pattern analysis

### Implementation Priorities

1. **Idempotency** - Prevent duplicate processing/approval
2. **Pessimistic scoring** - Safe defaults on partial data
3. **Circuit breakers** - Bedrock cost, external API failures
4. **CloudTrail logging** - Audit trail when Slack fails
5. **Input sanitization** - Prevent prompt injection

---

*Session completed: 2025-12-22*
*Techniques: Reverse Brainstorming → Chaos Engineering → Decision Tree Mapping*
