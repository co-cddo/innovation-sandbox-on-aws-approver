---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - '_bmad-output/prd.md'
  - '_bmad-output/architecture.md'
workflowType: 'epics-and-stories'
lastStep: 4
project_name: 'innovation-sandbox-on-aws-approver'
user_name: 'Cns'
date: '2025-12-22'
workflowComplete: true
---

# innovation-sandbox-on-aws-approver - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for innovation-sandbox-on-aws-approver, decomposing the requirements from the PRD and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

**Request Scoring (FR1-FR7)**
- FR1: System can calculate a composite risk score from multiple weighted rules
- FR2: System can apply configurable threshold to determine auto-approve vs escalate
- FR3: System can apply pessimistic scoring (skip bonuses, apply penalties) when data unavailable
- FR4: System can produce deterministic scores for identical inputs
- FR5: System can calculate score within performance budget (<5 seconds total)
- FR6: System can log complete score breakdown for each decision
- FR7: System can apply different rule weights based on configuration

**Domain Verification (FR8-FR11)**
- FR8: System can verify email domain against ukps-domains allowlist
- FR9: System can apply trust bonus (-5) to verified government domains
- FR10: System can treat unverified domains neutrally (no penalty)
- FR11: System can cache domain list from S3 with configurable TTL (default 1hr)

**Email Analysis (FR12-FR14)**
- FR12: System can detect group mailbox patterns via Bedrock AI
- FR13: System can detect suspicious email patterns via Bedrock AI
- FR14: System can fall back to rule-based scoring when Bedrock unavailable

**User History (FR15-FR18)**
- FR15: System can query DynamoDB for user's previous lease requests
- FR16: System can apply returning user bonus (0) vs first-time penalty (+5)
- FR17: System can apply template familiarity bonus (-1) for previously used templates
- FR18: System can detect and flag users with prior negative outcomes

**Organization Reputation (FR19-FR21)**
- FR19: System can query organization history from DynamoDB
- FR20: System can apply temporary penalty (+3 for 30 days) after org-level negative events
- FR21: System can track cross-organization activity patterns for security review

**Timing & Business Hours (FR22-FR25)**
- FR22: System can determine if request arrives during business hours (7am-7pm London, weekdays)
- FR23: System can delay processing for out-of-hours requests until next business day
- FR24: System can apply end-of-window urgency bonus (-2) for requests in final 2 hours
- FR25: System can handle timezone conversions correctly (UK time)

**Rate Limiting (FR26-FR27)**
- FR26: System can track request frequency per user
- FR27: System can apply rate limit penalty for burst requests from same user/org

**Event Processing (FR28-FR32)**
- FR28: System can listen for LeaseRequested events on EventBridge
- FR29: System can emit LeaseApproved events with approvedBy attribution
- FR30: System can emit LeaseDenied events with reason
- FR31: System can process events idempotently (no duplicate approvals)
- FR32: System can route failed events to DLQ for manual investigation

**User Communication (FR33-FR36)**
- FR33: System can update lease comments in DynamoDB with status messages
- FR34: System can provide user-facing status using neutral language
- FR35: System can include reference number for tracking (ISB-YYYY-NNNN format)
- FR36: System can notify users of approval via existing ISB notification mechanism

**Operator Workflows (FR37-FR43)**
- FR37: System can send Slack notification on escalation with full context
- FR38: Operators can view complete score breakdown in Slack message
- FR39: Operators can approve escalated request via ISB console (Slack link)
- FR40: Operators can deny escalated request via ISB console (Slack link)
- FR41: System can attribute approval/denial to operator email
- FR42: System can display pending review queue summary
- FR43: System can expire queued requests after configurable timeout (default: 5 business days)

**System Reliability (FR44-FR47)**
- FR44: System can fail-closed (queue for manual) on infrastructure errors
- FR45: System can retry failed operations with exponential backoff
- FR46: System can apply circuit breaker for Bedrock throttling
- FR47: System can process events from DLQ after recovery

**Configuration (FR48-FR51)**
- FR48: Operators can adjust auto-approve threshold (via redeployment with CDK params)
- FR49: Operators can adjust individual rule weights (via redeployment with CDK params)
- FR50: Operators can update business hours (via redeployment with CDK params)
- FR51: System reads config from Lambda environment variables (CDK-deployed), secrets from Secrets Manager (pre-created via AWS CLI)

**Observability & Compliance (FR52-FR57)**
- FR52: System can emit structured JSON logs to CloudWatch
- FR53: System can emit CloudWatch metrics for scoring distribution
- FR54: System can track per-rule trigger frequency
- FR55: System can retain decision logs for GDPR compliance (audit trail)
- FR56: System can produce audit trail of all approval/denial decisions
- FR57: System can flag post-incident whether original score indicated risk

### Non-Functional Requirements

**Performance**
- NFR-PERF-01: End-to-end latency (p95) <5 seconds
- NFR-PERF-02: End-to-end latency (p99) <8 seconds
- NFR-PERF-03: Scoring calculation <2 seconds
- NFR-PERF-04: Bedrock response <3 seconds (with timeout fallback)
- NFR-PERF-05: Cold start (after 15min idle) <4 seconds

**Reliability**
- NFR-REL-01: Zero lost requests (DLQ + idempotent retry)
- NFR-REL-02: Fail-closed on errors (queue for manual review)
- NFR-REL-03: No duplicate decisions (idempotency keyed on leaseId:eventId)
- NFR-REL-04: Graceful degradation when Bedrock unavailable
- NFR-REL-05: System continues when any single dependency fails
- NFR-REL-06: Recovery time objective: 4 business hours

**Security**
- NFR-SEC-01: IAM execution roles (no external API surface)
- NFR-SEC-02: IAM resource policies for all AWS services
- NFR-SEC-03: Secrets Manager for Slack webhook URL
- NFR-SEC-04: Secrets rotation effective within 60 seconds
- NFR-SEC-05: Least-privilege IAM policies
- NFR-SEC-06: All decisions logged with attribution

**Scalability**
- NFR-SCALE-01: 500 requests/day without architecture changes
- NFR-SCALE-02: 20 concurrent requests sustained burst
- NFR-SCALE-03: DynamoDB on-demand auto-scaling
- NFR-SCALE-04: Circuit breaker prevents Bedrock cascade

**Observability**
- NFR-OBS-01: Structured JSON logging to CloudWatch
- NFR-OBS-02: CloudWatch metrics for scoring distribution
- NFR-OBS-03: DLQ depth >5 or error rate >1% alerts
- NFR-OBS-04: Dashboard for scoring trends and queue depth

**Maintainability**
- NFR-MAINT-01: Config changes effective via redeployment (CDK params)
- NFR-MAINT-02: 90% line coverage, 100% branch on thresholds
- NFR-MAINT-03: Contract tests with ISB EventBridge schema

### Additional Requirements

**From Architecture Document:**

- **Starter Template:** Manual setup following Deployer patterns (no CLI template)
- **Runtime:** Node.js 20.x with TypeScript 5.3+ (strict mode)
- **Bundler:** esbuild for Lambda packaging
- **Test Framework:** Vitest 4.x
- **IaC:** AWS CDK with L3 constructs
- **Region:** us-west-2 (co-located with ISB)
- **AI Model:** Amazon Nova Micro for text classification
- **Slack Integration:** One-way webhook with ISB console deep links
- **AppConfig Integration:** Read ISB console URL from existing AppConfig
- **Delayed Processing:** Event-driven (AccountCleanupSucceeded) + 30min scheduled check
- **Business Hours:** 30-min schedule checks if within 7am-7pm London
- **Idempotency:** AWS Powertools with DynamoDB backend
- **Circuit Breaker:** Custom in-memory class (3 failures, 60s recovery)
- **State Machine:** Enum-based with pure function handlers
- **DI Pattern:** Factory functions for all AWS service clients

**CDK Resources Required:**
- ApproverFunction (Lambda with config via environment variables)
- LeaseRequestedRule (EventBridge)
- CleanupSucceededRule (EventBridge)
- QueueCheckSchedule (EventBridge Scheduler - every 30min)
- DelayQueue (SQS)
- IdempotencyTable (DynamoDB)
- DomainListBucket (S3)
- ApproverAlarms (CloudWatch)

**Secrets (pre-created via AWS CLI, referenced in CDK):**
- `/approver/slack-webhook-url` (Secrets Manager)
  - ARN: `arn:aws:secretsmanager:us-west-2:568672915267:secret:/approver/slack-webhook-url-FXJl1d`

### FR Coverage Map

| FR | Epic | Description |
|----|------|-------------|
| FR1-FR7 | Epic 2 | Request Scoring |
| FR8-FR11 | Epic 3 | Domain Verification |
| FR12-FR14 | Epic 3 | Email Analysis |
| FR15-FR18 | Epic 3 | User History |
| FR19-FR21 | Epic 3 | Organization Reputation |
| FR22-FR25 | Epic 4 | Timing & Business Hours |
| FR26-FR27 | Epic 4 | Rate Limiting |
| FR28-FR32 | Epic 2 | Event Processing |
| FR33-FR36 | Epic 5 | User Communication |
| FR37-FR42 | Epic 5 | Operator Workflows |
| FR43 | Epic 4 | Queue Expiry |
| FR44-FR45, FR47 | Epic 2 | System Reliability |
| FR46 | Epic 3 | Circuit Breaker (Bedrock) |
| FR48-FR51 | Epic 5 | Configuration |
| FR52-FR57 | Epic 5 | Observability & Compliance |

## Epic List

### Epic 1: Project Foundation & Infrastructure
Establish the project with all CDK infrastructure and CI/CD pipeline, enabling development and automated deployment of all features.

**User Outcome:** Development team can build, test, and deploy the Approver service automatically.

**Stories:**
- 1.1: Project setup, dependencies, TypeScript config
- 1.2: CDK stack (Lambda, EventBridge rules, SQS, DynamoDB, S3)
- 1.3: GitHub Actions CI/CD with OIDC (tests pass → deploy to prod)
- 1.4: **E2E Milestone: Infrastructure Verification** ← `<promise>STOP</promise>`

**FRs covered:** Infrastructure foundation (enables all FRs)

---

### Epic 2: Core Approval Flow
Enable end-to-end lease approval from event reception to decision emission with configurable scoring rules.

**User Outcome:** Lease requests receive instant approval/denial decisions based on scoring rules.

**Stories:**
- 2.1: Minimal vertical slice (event → hardcoded approve → emit)
- 2.2: State machine with decision orchestration
- 2.3: Scoring engine with 16 configurable rules
- 2.4: Idempotency, DLQ, fail-closed error handling
- 2.5: **E2E Milestone: Core Flow Validation** ← `<promise>STOP</promise>`

**FRs covered:** FR1-7, FR28-32, FR44-45, FR47 (16 FRs)

---

### Epic 3: Intelligent Scoring
Enrich scoring with user history, organization reputation, domain verification, and AI-powered email analysis.

**User Outcome:** Scoring incorporates full context - returning users get credit, verified gov domains get trust bonus, suspicious email patterns flagged.

**Stories:**
- 3.1: DynamoDB user history queries
- 3.2: Organization reputation tracking
- 3.3: Domain verification (S3 cache from ukps-domains)
- 3.4: Bedrock AI email analysis with circuit breaker
- 3.5: **E2E Milestone: Intelligent Scoring Validation** ← `<promise>STOP</promise>`

**FRs covered:** FR8-21, FR46 (15 FRs)

---

### Epic 4: Timing & Queue Management
Handle business hours delays, account availability queuing, and rate limiting.

**User Outcome:** Out-of-hours requests processed at next 30-min check during business hours; requests queued when no accounts available; burst requests rate-limited.

**Stories:**
- 4.1: Business hours detection (7am-7pm London, weekdays, UK bank holidays)
- 4.2: Delayed processing (30min schedule, AccountCleanupSucceeded trigger)
- 4.3: Rate limiting per user/org
- 4.4: Queue expiry after 5 business days

**FRs covered:** FR22-27, FR43 (7 FRs)

---

### Epic 5: Communications & Operations
Keep users informed, enable operator review via Slack + ISB console, and provide operational visibility.

**User Outcome:** Users see clear status messages; operators receive Slack alerts with full context and ISB console links for manual review; team has dashboards for monitoring.

**Stories:**
- 5.1: Lease comments updates (neutral language, reference numbers)
- 5.2: Slack notifications with score breakdown and ISB console deep links
- 5.3: CloudWatch structured logging & metrics
- 5.4: Per-rule trigger tracking and audit trail
- 5.5: **E2E Milestone: Full System Validation** ← `<promise>STOP</promise>`

**FRs covered:** FR33-42, FR52-57 (16 FRs)
**Note:** FR48-51 (Configuration) now handled via CDK environment variables in Epic 1

---

## Epic Definition of Done

Each epic is complete when:
- ✅ All stories complete
- ✅ Unit tests passing (coverage targets met)
- ✅ Integration tests passing
- ✅ E2E milestone passed (where applicable)
- ✅ No critical/high bugs open

## E2E Milestone Summary

| Milestone | After | Duration | Scope |
|-----------|-------|----------|-------|
| 1. Infrastructure Verification | Epic 1 | ~10 min | Lambda triggers on event |
| 2. Core Flow Validation | Epic 2 | ~30 min | Full scoring loop |
| 3. Intelligent Scoring Validation | Epic 3 | ~20 min | Bedrock + domain verification |
| 4. Full System Validation | Epic 5 | ~30 min | Timing, Slack, queues |

**E2E Protocol:** Output `<promise>STOP</promise>` to halt automation loop for interactive testing with Cns via ISB UI.

---

## Epic 1: Project Foundation & Infrastructure

Establish the project with all CDK infrastructure and CI/CD pipeline, enabling development and automated deployment of all features.

**User Outcome:** Development team can build, test, and deploy the Approver service automatically.

### Story 1.1: Project Initialization with TypeScript and Testing Framework

As a **developer**,
I want **a fully configured Node.js 20 TypeScript project with Vitest testing and ESLint/Prettier**,
So that **I can begin implementing Lambda handler code with type safety and automated quality checks**.

**Acceptance Criteria:**

**Given** a fresh clone of the repository
**When** I run `npm install`
**Then** all dependencies install without errors
**And** the project structure follows Deployer patterns:
```
/
├── src/
│   └── handlers/
│       └── approver.ts (stub handler)
├── test/
│   └── handlers/
│       └── approver.test.ts (passing stub test)
├── infra/
│   └── (CDK stack - Story 1.2)
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── eslint.config.mjs
└── .prettierrc
```

**Given** the project is set up
**When** I run `npm run build`
**Then** TypeScript compiles successfully with strict mode enabled
**And** esbuild bundles the Lambda handler

**Given** the project is set up
**When** I run `npm test`
**Then** Vitest runs the stub test and passes
**And** coverage report is generated with thresholds configured (90% line, 100% branch on scoring logic)

**Given** the project is set up
**When** I run `npm run lint`
**Then** ESLint checks pass
**And** Prettier formatting is verified

**Given** the stub handler is invoked
**When** it receives any event
**Then** it logs the event as structured JSON
**And** returns `{ statusCode: 200, body: "OK" }`

---

### Story 1.2: CDK Infrastructure Stack

As a **developer**,
I want **a CDK stack that deploys all AWS resources required by the Approver service**,
So that **the Lambda and its triggers, queues, and storage are provisioned in us-west-2**.

**Prerequisites:**
- Secrets created via AWS CLI before first deploy: ✅ DONE
  - ARN: `arn:aws:secretsmanager:us-west-2:568672915267:secret:/approver/slack-webhook-url-FXJl1d`

**Acceptance Criteria:**

**Given** the CDK stack is defined
**When** I run `cdk synth`
**Then** CloudFormation template is generated without errors
**And** the following resources are defined:
- ApproverFunction (Lambda, Node.js 20, 30s timeout, 512MB)
- LeaseRequestedRule (EventBridge rule for `LeaseRequested` events)
- CleanupSucceededRule (EventBridge rule for `AccountCleanupSucceeded` events)
- QueueCheckSchedule (EventBridge Scheduler - every 30 minutes)
- DelayQueue (SQS with DLQ)
- IdempotencyTable (DynamoDB for Powertools idempotency)
- DomainListBucket (S3 for ukps-domains cache)

**Given** configuration is required
**When** the Lambda is deployed
**Then** non-secret config is passed via Lambda environment variables:
- `AUTO_APPROVE_THRESHOLD` (default: 20)
- `BUSINESS_HOURS_START` (default: 7)
- `BUSINESS_HOURS_END` (default: 19)
- `BUSINESS_HOURS_TZ` (default: Europe/London)
- `ISB_CONSOLE_URL` (from AppConfig or hardcoded)
- `ISB_LEASES_TABLE_NAME` (cross-stack reference)
- `ISB_ACCOUNTS_TABLE_NAME` (cross-stack reference)
- `RULE_WEIGHTS` (JSON string of 16 rule weights)

**Given** secrets are required
**When** the Lambda accesses Slack webhook
**Then** it reads from Secrets Manager ARN: `arn:aws:secretsmanager:us-west-2:*:secret:/approver/slack-webhook-url`
**And** the secret is pre-created via AWS CLI (not managed by CDK)

**Given** ISB integration is required
**When** referencing ISB DynamoDB tables
**Then** table names are read from ISB stack exports or hardcoded as environment variables
**And** IAM permissions grant read access to ISB Leases table
**And** IAM permissions grant read access to ISB SandboxAccount table
**And** IAM permissions grant write access to ISB Leases table (comments field via condition if possible)

**Given** the CDK stack is deployed
**When** the Lambda function exists
**Then** it has IAM permissions to:
- Read/Write IdempotencyTable
- Read DomainListBucket
- Put events to EventBridge (source: `innovation-sandbox`)
- Read Secrets Manager (`/approver/*`)
- Invoke Bedrock (Nova Micro in us-west-2)

**Given** the stack is synthesized
**When** I inspect the IAM policies
**Then** least-privilege is enforced (no `*` resources except where required by service)

**Note:** Initial ukps-domains file uploaded manually to DomainListBucket after deployment.

---

### Story 1.3: GitHub Actions CI/CD with OIDC

As a **developer**,
I want **GitHub Actions workflows that test and deploy on push to main using OIDC authentication**,
So that **deployments happen automatically without long-lived AWS credentials**.

**Prerequisites:**
- AWS IAM OIDC identity provider configured for GitHub Actions
- IAM role `GitHubActionsApproverRole` with trust policy for this repo and CDK deploy permissions

**Acceptance Criteria:**

**Given** a push to the `main` branch
**When** GitHub Actions workflow triggers
**Then** the following steps execute in sequence:
1. Checkout code
2. Setup Node.js 20
3. Install dependencies (`npm ci`)
4. Run linting (`npm run lint`)
5. Run tests with coverage (`npm test -- --coverage`)
6. Verify coverage thresholds pass (90% lines, 100% branch on scoring)
7. If all pass: Authenticate via OIDC to AWS
8. Deploy CDK stack (`cdk deploy --require-approval never`)

**Given** OIDC authentication is configured
**When** the workflow authenticates to AWS
**Then** it assumes `GitHubActionsApproverRole` via OpenID Connect
**And** no long-lived secrets (access keys) are stored in GitHub

**Given** tests or coverage thresholds fail
**When** the workflow reaches those steps
**Then** deployment is skipped
**And** the workflow fails with clear error output

**Given** deployment succeeds
**When** the workflow completes
**Then** the Lambda function is updated in us-west-2
**And** the workflow reports success with stack outputs

---

### Story 1.4: E2E Milestone - Infrastructure Verification

As a **developer**,
I want **to verify the deployed infrastructure receives events and the Lambda executes**,
So that **I have confidence the foundation is working before building features**.

**Story Type:** Verification/Spike (no code changes, testing only)

**Acceptance Criteria:**

**Given** the CDK stack is deployed
**When** a `LeaseRequested` event is published to EventBridge (via ISB UI by Cns)
**Then** the Lambda function is invoked
**And** CloudWatch logs show the event was received with structured JSON

**Given** the stub handler is invoked
**When** I check CloudWatch logs
**Then** I see the full event payload logged
**And** the handler returns 200

**Given** the scheduled trigger needs verification
**When** I manually invoke the Lambda with a test event `{ "source": "aws.scheduler" }`
**Then** logs show the scheduled execution path was hit
**And** handler returns 200

**E2E Protocol:**
Output `<promise>STOP</promise>` to halt automation loop. Interactive testing with Cns via ISB UI will:
1. Cns triggers a lease request in ISB UI
2. Verify Lambda invocation in CloudWatch
3. Confirm EventBridge rule fired correctly
4. Verify environment variables are populated

---

## Epic 2: Core Approval Flow

Enable end-to-end lease approval from event reception to decision emission with configurable scoring rules.

**User Outcome:** Lease requests receive instant approval/denial decisions based on scoring rules.

### Story 2.1: Minimal Vertical Slice - Event to Approval

As a **lease requester**,
I want **my lease request to be automatically approved when received**,
So that **I can verify the end-to-end event flow works before adding scoring logic**.

**Acceptance Criteria:**

**Given** a `LeaseRequested` event is received from EventBridge
**When** the handler processes the event
**Then** it extracts `leaseId`, `userEmail`, and `templateId` from the event payload
**And** it emits a `LeaseApproved` event to EventBridge with:
- `source`: `innovation-sandbox`
- `detail-type`: `LeaseApproved`
- `detail.leaseId`: the original leaseId
- `detail.approvedBy`: `approver-service@system`
- `detail.score`: 0
- `detail.reason`: `Stub approval - scoring not implemented`

**Given** the event schema must match ISB expectations
**When** ISB receives the `LeaseApproved` event
**Then** it processes it without errors (schema-compatible)

**Given** CloudWatch logging is required (FR52)
**When** the handler processes an event
**Then** structured JSON logs include:
- `leaseId`
- `userEmail`
- `action`: `approved`
- `timestamp`

---

### Story 2.2: State Machine with Decision Orchestration

As a **developer**,
I want **a state machine that orchestrates the approval decision flow**,
So that **the handler logic is testable, predictable, and extensible for future scoring rules**.

**Acceptance Criteria:**

**Given** the Architecture specifies enum-based state machine
**When** implementing the orchestration
**Then** the state machine has these states:
```typescript
enum ApprovalState {
  RECEIVED = 'RECEIVED',
  VALIDATING = 'VALIDATING',
  SCORING = 'SCORING',
  DECIDING = 'DECIDING',
  APPROVED = 'APPROVED',
  DENIED = 'DENIED',
  ESCALATED = 'ESCALATED',
  ERROR = 'ERROR'
}
```

**Given** each state transition
**When** a state handler is invoked
**Then** it is a pure function that:
- Takes current state + context
- Returns next state + updated context
- Has no side effects (side effects handled by orchestrator)

**Given** the orchestrator processes a request
**When** moving through states
**Then** it logs each state transition with timing
**And** the full state history is available for audit

**Given** an error occurs in any state
**When** the error is caught
**Then** the state machine transitions to ERROR state
**And** context includes error details for DLQ processing

---

### Story 2.3: Scoring Engine with 16 Configurable Rules

As a **lease requester**,
I want **my request scored against 16 risk rules with configurable weights**,
So that **low-risk requests are auto-approved while high-risk ones are escalated**.

**Acceptance Criteria:**

**Given** the scoring engine is invoked
**When** calculating a score
**Then** it applies these 16 rules with default weights:

| # | Rule | Default Weight | Condition |
|---|------|----------------|-----------|
| 1 | Expired leases (time) | +2 each | Leases in last 30 days with status `Expired` |
| 2 | Budget exceeded | +5 each | Leases in last 30 days with status `BudgetExceeded` |
| 3 | First-time user | +5 | No previous leases in system |
| 4 | First-time + suspicious email | +20 | First lease AND group mailbox pattern |
| 5 | Verified gov domain | -5 | Domain in ukps-domains allowlist |
| 6 | Familiar template | -1 | Previously used this template successfully |
| 7 | Template hopper | +2 | Never repeats templates |
| 8 | Budget requested | +1 per $10 | Higher budget = higher scrutiny |
| 9 | Duration requested | +1 per 8hrs | Longer duration = more exposure |
| 10 | End-of-window request | -2 | Request in final 2 hours (5-7pm) |
| 11 | Cooldown violation | +10 | Request within 1hr of previous lease |
| 12 | Outside target audience | +10 | Domain clearly not local gov |
| 13 | Manual early termination | -2 each | User terminated leases early |
| 14 | Org recent negative | +3 | Same domain had issues (30 days) |
| 15 | Org clean record | -2 | Same domain clean (90 days) |
| 16 | Group mailbox detected | +20 | AI detected group email pattern |

**Given** rule weights are configurable
**When** the Lambda starts
**Then** it reads `RULE_WEIGHTS` from environment variable (JSON)
**And** falls back to defaults if not set or invalid

**Given** the threshold is configurable (FR2)
**When** comparing score to threshold
**Then** it reads `AUTO_APPROVE_THRESHOLD` from environment (default: 20)
**And** score < threshold → APPROVED
**And** score >= threshold → ESCALATED

**Given** scoring must be deterministic (FR4)
**When** the same inputs are provided
**Then** the same score is produced every time

**Given** data is unavailable for a rule (FR3)
**When** calculating that rule's contribution
**Then** pessimistic scoring applies:
- Skip bonuses (negative weights)
- Apply penalties (positive weights)
**And** log which rules used fallback

**Given** performance requirements (FR5)
**When** calculating the full score
**Then** scoring completes in <2 seconds (NFR-PERF-03)

**Given** score breakdown logging (FR6)
**When** a score is calculated
**Then** structured log includes:
- Total score
- Each rule's contribution
- Which rules triggered
- Which rules used fallback

---

### Story 2.4: Idempotency, DLQ, and Fail-Closed Error Handling

As an **operator**,
I want **the system to handle failures gracefully without losing requests or duplicating decisions**,
So that **I can trust the system even when components fail**.

**Acceptance Criteria:**

**Given** idempotency is required (FR31)
**When** the same event is received multiple times
**Then** only one decision is made
**And** subsequent invocations return the cached result
**And** idempotency key is `{leaseId}:{eventId}`

**Given** AWS Powertools idempotency is specified
**When** implementing idempotency
**Then** use `@aws-lambda-powertools/idempotency` with DynamoDB backend
**And** TTL is set to 24 hours

**Given** an infrastructure error occurs (FR44)
**When** the handler catches an unrecoverable error
**Then** it transitions to ERROR state
**And** emits `LeaseEscalated` event (queue for manual review)
**And** logs the error with full context
**And** does NOT emit LeaseApproved or LeaseDenied

**Given** retry logic is needed (FR45)
**When** a retryable error occurs (DynamoDB throttle, network timeout)
**Then** exponential backoff is applied (100ms, 200ms, 400ms, max 3 retries)
**And** if all retries fail, transition to ERROR state

**Given** DLQ processing is required (FR32, FR47)
**When** an event fails all retries
**Then** it routes to the DLQ
**And** includes full context for investigation
**And** the DLQ can be reprocessed after recovery

**Given** the allow-list exists
**When** a request comes from an allow-listed email
**Then** it bypasses scoring and auto-approves
**And** logs `ALLOW-LIST-OVERRIDE` with calculated score for reference
**And** allow-list emails are:
- `chris.nesbitt-smith@digital.cabinet-office.gov.uk`
- `chris.nesbitt-smith@dsit.gov.uk`
- `ndx+test@dsit.gov.uk`
- `benjamin.bennett@dsit.gov.uk`
- `dimitris.perdikou@dsit.gov.uk`
- `edward.mccutcheon@dsit.gov.uk`

---

### Story 2.5: E2E Milestone - Core Flow Validation

As a **developer**,
I want **to verify the complete scoring loop works end-to-end**,
So that **I have confidence before adding intelligent scoring features**.

**Story Type:** Verification/Spike (testing only)

**Acceptance Criteria:**

**Given** Stories 2.1-2.4 are deployed
**When** Cns triggers a lease request via ISB UI
**Then** the Lambda:
1. Receives the event
2. Runs through state machine
3. Calculates score (will be 0 or minimal without history data)
4. Emits LeaseApproved or LeaseEscalated event
5. Logs complete score breakdown

**Given** an allow-listed email is used
**When** the request is processed
**Then** it auto-approves with `ALLOW-LIST-OVERRIDE` logged

**Given** idempotency is tested
**When** the same event is sent twice (via manual invoke)
**Then** only one decision is logged
**And** second invocation returns cached result

**E2E Protocol:**
Output `<promise>STOP</promise>` to halt automation loop. Interactive testing with Cns via ISB UI will:
1. Trigger lease request with allow-listed email → verify auto-approve
2. Trigger lease request with non-allow-listed email → verify scoring runs
3. Check CloudWatch logs for score breakdown
4. Verify ISB receives and processes the approval event
5. Test idempotency by re-invoking with same event

---

## Epic 3: Intelligent Scoring

Enrich scoring with user history, organization reputation, domain verification, and AI-powered email analysis.

**User Outcome:** Scoring incorporates full context - returning users get credit, verified gov domains get trust bonus, suspicious email patterns flagged.

### Story 3.1: DynamoDB User History Queries

As a **returning user**,
I want **my previous successful lease history to count in my favor**,
So that **I'm rewarded for being a trusted user of the system**.

**Acceptance Criteria:**

**Given** a lease request is received (FR15)
**When** the scoring engine queries user history
**Then** it queries ISB Leases table by `userEmail` (GSI)
**And** retrieves leases from the last 90 days

**Given** user history is retrieved
**When** calculating first-time user rule (#3)
**Then** if no previous leases exist → apply +5 penalty
**And** if previous leases exist → apply 0 (no penalty)

**Given** user has previous leases
**When** calculating expired leases rule (#1)
**Then** count leases with status `Expired` in last 30 days
**And** apply +2 per expired lease

**Given** user has previous leases
**When** calculating budget exceeded rule (#2)
**Then** count leases with status `BudgetExceeded` in last 30 days
**And** apply +5 per exceeded lease

**Given** user has previous leases
**When** calculating familiar template rule (#6)
**Then** if current templateId matches any previous successful lease → apply -1 bonus
**And** "successful" means status in [`Completed`, `Terminated`]

**Given** user has previous leases
**When** calculating template hopper rule (#7)
**Then** if user has 3+ leases and never repeated a template → apply +2 penalty

**Given** user has previous leases
**When** calculating manual early termination rule (#13)
**Then** count leases with status `Terminated` (user-initiated) in last 90 days
**And** apply -2 per early termination (responsible behavior)

**Given** user has previous leases
**When** calculating cooldown violation rule (#11)
**Then** find most recent lease end time
**And** if current request is within 1 hour of that end time → apply +10 penalty

**Given** DynamoDB query fails
**When** calculating user history rules
**Then** pessimistic scoring applies (skip bonuses, apply penalties)
**And** log the failure with error details

---

### Story 3.2: Organization Reputation Tracking

As an **operator**,
I want **organization-wide patterns to influence individual scores**,
So that **a problematic user from an organization affects their colleagues' scores temporarily**.

**Acceptance Criteria:**

**Given** a lease request is received (FR19)
**When** the scoring engine queries organization history
**Then** it extracts the domain from `userEmail` (e.g., `@councilname.gov.uk`)
**And** queries ISB Leases table by domain pattern (email contains `@domain`)

**Given** organization history is retrieved (FR20)
**When** calculating org recent negative rule (#14)
**Then** count leases from OTHER users at same domain with status `BudgetExceeded` or `Expired` in last 30 days
**And** if count > 0 → apply +3 penalty (temporary org penalty)

**Given** organization history is retrieved
**When** calculating org clean record rule (#15)
**Then** if domain has 5+ leases in last 90 days AND zero negative outcomes → apply -2 bonus

**Given** cross-organization tracking is required (FR21)
**When** logging scoring decisions
**Then** include `domain` in structured logs for security review
**And** enable querying by domain for pattern detection

**Given** organization query fails
**When** calculating org rules
**Then** pessimistic scoring applies (skip bonuses, apply penalties)
**And** log the failure

---

### Story 3.3: Domain Verification from S3 Cache

As a **UK local government user**,
I want **my verified government domain to earn a trust bonus**,
So that **legitimate government users are fast-tracked**.

**Data Source:**
- GitHub: `https://github.com/govuk-digital-backbone/ukps-domains`
- File: `data/user_domains.json`
- **Note:** Until PR #1 is merged, use contributor branch: `https://raw.githubusercontent.com/chrisns/ukps-domains/feat/localgov-crawler-and-tests/data/user_domains.json`

**CRITICAL: Filtering Requirement:**
The `user_domains.json` contains multiple organisation types. We MUST filter to only `organisation_type_id: "local_authority"` entries. Other types to EXCLUDE:
- `central_gov` (already have access via normal channels)
- `nhs`, `police`, `military`, `devolved`, `ndpb` (not target audience)

**Acceptance Criteria:**

**Given** domain verification is required (FR8)
**When** checking if domain is trusted
**Then** load ukps-domains allowlist from S3 bucket
**And** filter entries to only those with `organisation_type_id: "local_authority"`
**And** cache the filtered list in memory with 1 hour TTL (FR11)

**Given** the domain list is loaded
**When** checking `userEmail` domain
**Then** extract domain (e.g., `councilname.gov.uk`)
**And** check if domain exists in filtered local_authority list

**Given** domain is in local_authority list (FR9)
**When** calculating verified gov domain rule (#5)
**Then** apply -5 trust bonus

**Given** domain is NOT in local_authority list (FR10)
**When** calculating the rule
**Then** apply 0 (neutral, no penalty)
**And** do NOT apply outside target audience penalty here (that's AI-determined)

**Given** S3 load fails
**When** attempting domain verification
**Then** skip the bonus (pessimistic)
**And** log the S3 error
**And** continue with scoring (don't fail the whole request)

**Given** cache TTL expires
**When** next request needs domain verification
**Then** reload from S3
**And** if reload fails, use stale cache with warning log

**Given** JSON parsing succeeds
**When** filtering by organisation_type_id
**Then** only include entries where `organisation_type_id === "local_authority"`
**And** extract `domain_pattern` field for matching

---

### Story 3.4: Bedrock AI Email Analysis with Circuit Breaker

As an **operator**,
I want **AI to detect suspicious email patterns like group mailboxes**,
So that **shared/team emails are flagged for manual review**.

**Acceptance Criteria:**

**Given** email analysis is required (FR12, FR13)
**When** scoring a lease request
**Then** invoke Amazon Bedrock (Nova Micro) with prompt:
```
Analyze this email address: {userEmail}

Determine:
1. Is this likely a group/shared mailbox? (team@, info@, contact@, admin@, etc.)
2. Does the domain appear to be UK local government?

Respond in JSON format:
{
  "isGroupMailbox": boolean,
  "confidence": "high" | "medium" | "low",
  "isLocalGovernment": boolean,
  "reasoning": "brief explanation"
}
```

**Given** Bedrock returns `isGroupMailbox: true` with high/medium confidence
**When** calculating group mailbox rule (#16)
**Then** apply +20 penalty
**And** if user is also first-time, rule #4 applies instead (same +20, not doubled)

**Given** Bedrock returns `isLocalGovernment: false` with high confidence
**When** calculating outside target audience rule (#12)
**Then** apply +10 penalty
**And** this is independent of ukps-domains verification

**Given** Bedrock response time (NFR-PERF-04)
**When** invoking Bedrock
**Then** timeout after 3 seconds
**And** if timeout, fall back to rule-based scoring

**Given** circuit breaker is required (FR46)
**When** Bedrock fails 3 times consecutively
**Then** open circuit breaker for 60 seconds
**And** during open state, skip Bedrock and use fallback
**And** log circuit breaker state changes

**Given** circuit breaker is open
**When** 60 seconds have passed
**Then** allow one test request (half-open state)
**And** if test succeeds, close circuit
**And** if test fails, reset 60 second timer

**Given** Bedrock is unavailable (FR14)
**When** falling back to rule-based scoring
**Then** check email prefix patterns: `team`, `info`, `contact`, `admin`, `support`, `helpdesk`, `enquiries`
**And** if prefix matches → apply +20 penalty
**And** log that fallback was used

---

### Story 3.5: E2E Milestone - Intelligent Scoring Validation

As a **developer**,
I want **to verify intelligent scoring features work end-to-end**,
So that **I have confidence in the full scoring context before adding timing features**.

**Story Type:** Verification/Spike (testing only)

**Acceptance Criteria:**

**Given** Stories 3.1-3.4 are deployed
**When** Cns triggers lease requests with different scenarios
**Then** verify each intelligent scoring rule:

| Test Case | Expected Behavior |
|-----------|-------------------|
| First-time user, verified domain | Score: +5 (first time) -5 (domain) = 0 |
| Returning user, clean history | Score: 0 (returning) + any bonuses |
| User with expired lease in history | Score includes +2 for expired |
| Email `team@council.gov.uk` | AI detects group mailbox, +20 |
| Domain not in ukps-domains, AI says not local gov | +10 penalty |

**Given** Bedrock circuit breaker needs testing
**When** Bedrock is simulated as unavailable (or naturally fails)
**Then** verify fallback to rule-based scoring
**And** verify circuit breaker opens after 3 failures

**Given** S3 domain cache needs testing
**When** domain list is in S3
**Then** verify it's loaded and cached
**And** verify verified domains get -5 bonus

**E2E Protocol:**
Output `<promise>STOP</promise>` to halt automation loop. Interactive testing with Cns via ISB UI will:
1. Create user with history (previous leases) and verify history rules
2. Test with verified gov domain → verify -5 bonus
3. Test with suspicious email pattern → verify AI detection
4. Verify CloudWatch logs show complete scoring breakdown
5. Optional: Test circuit breaker by intentionally failing Bedrock (if feasible)

---

## Epic 4: Timing & Queue Management

Handle business hours delays, account availability queuing, and rate limiting.

**User Outcome:** Out-of-hours requests processed at next 30-min check during business hours; requests queued when no accounts available; burst requests rate-limited.

### Story 4.1: Business Hours Detection

As a **lease requester submitting outside business hours**,
I want **my request to be held until the next business day**,
So that **approvals happen during working hours when operators are available**.

**Acceptance Criteria:**

**Given** business hours are defined (FR22)
**When** checking if current time is within business hours
**Then** business hours are 7am-7pm London time (Europe/London timezone)
**And** business days are Monday-Friday
**And** UK bank holidays are excluded

**Given** timezone handling is required (FR25)
**When** determining current London time
**Then** use `Europe/London` timezone (handles BST/GMT automatically)
**And** do NOT hardcode UTC offsets

**Given** UK bank holidays need detection
**When** checking if today is a business day
**Then** fetch UK bank holidays from `https://www.gov.uk/bank-holidays/england-and-wales.ics`
**And** parse ICS format to extract holiday dates
**And** cache the list in memory with 24 hour TTL

**Given** a request arrives during business hours
**When** the state machine checks timing
**Then** proceed immediately to scoring
**And** log `businessHoursCheck: "within"`

**Given** a request arrives outside business hours (FR23)
**When** the state machine checks timing
**Then** calculate next business day processing window
**And** transition to DELAYED state
**And** store request in delay queue (SQS with visibility timeout)
**And** log `businessHoursCheck: "outside", nextProcessingTime: "<timestamp>"`

**Given** end-of-window urgency bonus applies (FR24)
**When** request arrives between 5pm-7pm London time on a business day
**Then** apply -2 bonus (rule #10)
**And** log `endOfWindowBonus: true`

---

### Story 4.2: Delayed Processing with 30-Minute Schedule

As an **operator**,
I want **delayed requests to be processed reliably via scheduled checks**,
So that **no request is left in the queue indefinitely**.

**Acceptance Criteria:**

**Given** the 30-minute schedule (replaces 7am cron)
**When** EventBridge Scheduler fires every 30 minutes
**Then** the Lambda is invoked with `source: "scheduled.queue-check"`
**And** it checks the delay queue for processable requests
**And** processes any that are now within business hours and have accounts available

**Given** an `AccountCleanupSucceeded` event is received
**When** an account becomes available
**Then** the Lambda is invoked with the event
**And** it checks if any requests are waiting in the queue
**And** if yes, processes the oldest request (FIFO)

**Given** a request is in the delay queue
**When** processing the queue
**Then** check if current time is within business hours
**And** check if accounts are available (query ISB SandboxAccount table)
**And** if both conditions met → process the request
**And** if not → leave in queue for next trigger

**Given** queue processing order
**When** multiple requests are waiting
**Then** process in FIFO order (oldest first)
**And** log queue depth before and after processing

**Given** SQS message visibility
**When** a message is picked up for processing
**Then** set visibility timeout to 5 minutes (longer than max processing time)
**And** delete message only after successful processing
**And** if processing fails, message returns to queue after visibility timeout

---

### Story 4.3: Rate Limiting per User and Organization

As an **operator**,
I want **burst requests from the same user or organization to be rate-limited**,
So that **one user can't monopolize sandbox accounts**.

**Acceptance Criteria:**

**Given** rate limiting is required (FR26)
**When** a request is received
**Then** check user's request frequency in last hour
**And** check organization's (domain) request frequency in last hour

**Given** user rate limit check (FR27)
**When** user has submitted 2+ requests in last hour
**Then** apply rate limit penalty: +5 per additional request beyond 2
**And** log `rateLimitPenalty: { user: <count>, penalty: <points> }`

**Given** organization rate limit check
**When** organization (domain) has submitted 5+ requests in last hour from different users
**Then** apply org rate limit penalty: +3
**And** log `rateLimitPenalty: { org: <count>, penalty: <points> }`

**Given** rate limit tracking
**When** tracking request frequency
**Then** use DynamoDB with TTL for efficient cleanup
**Or** use in-memory counting with Lambda invocation scope
**And** requests older than 1 hour are not counted

**Given** a request is rate-limited but not blocked
**When** the score is calculated
**Then** rate limit penalty is added to total score
**And** request may still auto-approve if total score < threshold
**And** or escalate if total score >= threshold

---

### Story 4.4: Queue Expiry After 5 Business Days

As an **operator**,
I want **queued requests to expire after 5 business days**,
So that **stale requests don't clog the system**.

**Acceptance Criteria:**

**Given** queue expiry is required (FR43)
**When** a request has been in queue for 5 business days
**Then** it is automatically expired
**And** a `LeaseDenied` event is emitted with reason `queue_timeout`
**And** lease comments are updated with expiry message

**Given** business day calculation for expiry
**When** calculating 5 business days
**Then** exclude weekends
**And** exclude UK bank holidays (from gov.uk ICS)
**And** start counting from the day after request was queued

**Given** expiry check timing
**When** the 30-minute scheduled job runs
**Then** check all queued requests for expiry
**And** expire any that have exceeded 5 business days
**And** process remaining valid requests

**Given** a request is expired
**When** updating the lease
**Then** set comments to:
```
Your lease request has expired after 5 business days in queue.
This may have occurred because no sandbox accounts were available.
Please submit a new request if you still need access.
Reference: ISB-{YYYY}-{NNNN}
```

**Given** expiry logging
**When** a request expires
**Then** log structured event with:
- `action`: `expired`
- `leaseId`
- `queuedAt`
- `expiredAt`
- `businessDaysInQueue`: 5
- `reason`: `queue_timeout`

---

## Epic 5: Communications & Operations

Keep users informed, enable operator review via Slack + ISB console, and provide operational visibility.

**User Outcome:** Users see clear status messages; operators receive Slack alerts with full context and ISB console links for manual review; team has dashboards for monitoring.

### Story 5.1: Lease Comments Updates with Neutral Language

As a **lease requester**,
I want **clear status messages in my lease comments**,
So that **I understand what's happening with my request without needing to contact support**.

**Acceptance Criteria:**

**Given** a lease decision is made (FR33)
**When** updating the lease in DynamoDB
**Then** update the `comments` field with status message

**Given** request is auto-approved
**When** updating comments
**Then** set message:
```
Your lease request has been automatically approved.
Score: {score} (threshold: 20)
Reference: ISB-{YYYY}-{NNNN}
```

**Given** request is approved via allow-list
**When** updating comments
**Then** set message:
```
Your lease request has been automatically approved (ALLOW-LIST-OVERRIDE).
Score: {score} (for reference only)
Reference: ISB-{YYYY}-{NNNN}
```

**Given** request requires manual approval (escalated)
**When** updating comments (FR34)
**Then** set message using neutral language:
```
Your lease request requires additional review.
Score: {score} (threshold: 20)

Score breakdown:
{foreach rule that contributed}
- {rule name}: {points}
{endforeach}

Your request has been forwarded to the NDX team who may be in touch
to discuss your requirements before approving.
Reference: ISB-{YYYY}-{NNNN}
```

**Given** request is delayed (outside business hours)
**When** updating comments
**Then** set message:
```
Your lease request has been received. As it was submitted outside of our
processing hours (7am-7pm London time, weekdays), it will be processed
during the next available window.
Reference: ISB-{YYYY}-{NNNN}
```

**Given** request is queued (no accounts available)
**When** updating comments
**Then** set message:
```
Your lease request has been received. All sandbox accounts are currently in use.
Your request has been queued and will be processed when an account becomes available.
Queue position: {position}
Reference: ISB-{YYYY}-{NNNN}
```

**Given** reference number format (FR35)
**When** generating reference number
**Then** format is `ISB-{YYYY}-{NNNN}` where:
- YYYY = current year
- NNNN = sequential number (daily or global counter)

---

### Story 5.2: Slack Workflow Webhook Notifications

As an **operator**,
I want **Slack notifications via Workflow Webhook when requests need review**,
So that **I can quickly assess and act on escalated requests**.

**Acceptance Criteria:**

**Given** a lease is escalated (FR37)
**When** sending Slack notification
**Then** POST to Slack Workflow Webhook URL from Secrets Manager (`/approver/slack-webhook-url`)
**And** URL format is `https://hooks.slack.com/triggers/[randomized]`

**Given** webhook payload format (flat JSON, no nesting)
**When** constructing the payload
**Then** send:
```json
{
  "user_email": "sarah.jones@council.gov.uk",
  "lease_id": "abc123-def456-ghi789",
  "reference": "ISB-2025-0042",
  "score": "25",
  "threshold": "20",
  "template_id": "bedrock-basic",
  "score_breakdown": "• First-time user: +5\n• Group mailbox detected: +20",
  "console_url": "https://isb-console.example.com/leases/abc123-def456-ghi789",
  "queue_depth": "3"
}
```

**Given** variable definitions for Slack Workflow Builder
**When** user configures their workflow
**Then** they create these variables:

| Variable | Slack Type | Description |
|----------|------------|-------------|
| `user_email` | User email | Requester's email |
| `lease_id` | Text | UUID of the lease |
| `reference` | Text | ISB-YYYY-NNNN reference |
| `score` | Text | Numeric score as string |
| `threshold` | Text | Auto-approve threshold |
| `template_id` | Text | Requested template name |
| `score_breakdown` | Text | Multi-line breakdown (newline-separated) |
| `console_url` | Text | Full ISB console deep link |
| `queue_depth` | Text | Number of pending reviews |

**Given** score breakdown formatting
**When** building `score_breakdown` string
**Then** format as newline-separated bullet points:
```
• {rule_name}: {points}
• {rule_name}: {points}
```
**And** include only rules with non-zero contribution
**And** sort by absolute contribution (highest impact first)

**Given** ISB console URL is required (FR39, FR40)
**When** generating `console_url`
**Then** read `ISB_CONSOLE_URL` from environment variable
**And** append `/leases/{leaseId}` for direct navigation

**Given** pending review queue summary (FR42)
**When** counting pending requests
**Then** query delay queue depth
**And** include in `queue_depth` field

**Given** Slack webhook fails
**When** the POST returns error or times out (3s timeout)
**Then** log the failure with response details
**And** do NOT fail the overall request processing
**And** request remains escalated (operator can find via ISB console)

**Given** rate limiting
**When** sending webhook requests
**Then** respect 1 request/second limit
**And** queue if burst of escalations occur

---

### Story 5.3: CloudWatch Structured Logging and Metrics

As an **operator**,
I want **structured logs and metrics for operational visibility**,
So that **I can monitor system health and investigate issues**.

**Acceptance Criteria:**

**Given** structured logging is required (FR52, NFR-OBS-01)
**When** logging any event
**Then** use JSON format with consistent schema:
```json
{
  "timestamp": "ISO8601",
  "level": "INFO|WARN|ERROR",
  "message": "Human readable message",
  "leaseId": "uuid",
  "userEmail": "email",
  "domain": "extracted domain",
  "action": "received|scoring|approved|denied|escalated|delayed|expired|error",
  "score": 15,
  "scoreBreakdown": { "rule1": 5, "rule2": 10 },
  "stateTransition": { "from": "SCORING", "to": "DECIDING", "durationMs": 150 },
  "traceId": "correlation id"
}
```

**Given** CloudWatch metrics are required (FR53, NFR-OBS-02)
**When** a decision is made
**Then** emit custom metrics:
- `ApproverDecisions` (count, dimensions: action=[approved|denied|escalated])
- `ApproverScore` (value, for histogram/percentile analysis)
- `ApproverLatency` (milliseconds, dimensions: stage=[total|scoring|bedrock])

**Given** per-rule tracking is required (FR54)
**When** a rule contributes to a score
**Then** emit metric:
- `ApproverRuleTrigger` (count, dimensions: rule=[rule_name])

**Given** alerting thresholds (NFR-OBS-03)
**When** configuring CloudWatch alarms
**Then** CDK creates alarms for:
- DLQ depth > 5 messages
- Error rate > 1% over 5 minutes
- Escalation rate > 50% over 1 hour (anomaly detection)

---

### Story 5.4: Per-Rule Trigger Tracking and Audit Trail

As a **compliance officer**,
I want **complete audit trail of all decisions**,
So that **I can demonstrate GDPR compliance and investigate incidents**.

**Acceptance Criteria:**

**Given** audit trail is required (FR55, FR56)
**When** any decision is made
**Then** log includes:
- Full input (leaseId, userEmail, templateId, timestamp)
- Full scoring breakdown (every rule, every contribution)
- Final decision (approved/denied/escalated)
- Attribution (system or operator email)
- Processing time

**Given** GDPR compliance (FR55)
**When** storing audit logs
**Then** CloudWatch log retention is set to meet data retention requirements
**And** logs can be exported to S3 for long-term archive if needed

**Given** post-incident analysis (FR57)
**When** investigating an incident
**Then** logs enable querying:
- "Show all decisions for user X"
- "Show all decisions with score > 15"
- "Show all decisions where rule Y triggered"

**Given** operator attribution (FR41)
**When** an operator approves/denies via ISB console
**Then** ISB sends event with operator email
**And** Approver logs the attribution:
```json
{
  "action": "approved",
  "approvedBy": "operator@example.gov.uk",
  "approvalMethod": "manual"
}
```

**Given** system attribution
**When** auto-approval occurs
**Then** log attribution as:
```json
{
  "action": "approved",
  "approvedBy": "approver-service@system",
  "approvalMethod": "automatic"
}
```

---

### Story 5.5: E2E Milestone - Full System Validation

As a **developer**,
I want **to verify the complete system works end-to-end including all communications**,
So that **I have confidence the system is production-ready**.

**Story Type:** Verification/Spike (testing only)

**Acceptance Criteria:**

**Given** all stories 1.1-5.4 are deployed
**When** Cns triggers various lease request scenarios via ISB UI
**Then** verify complete system behavior:

| Scenario | Expected Behavior |
|----------|-------------------|
| Low-risk request (score < 20) | Auto-approve, comments updated, no Slack |
| High-risk request (score >= 20) | Escalate, comments updated, Slack workflow triggered |
| Out-of-hours request | Delayed, comments updated, processed at next 30-min check |
| Allow-listed email | Auto-approve with ALLOW-LIST-OVERRIDE |

**Given** Slack notification testing
**When** a request is escalated
**Then** Slack workflow is triggered with correct payload
**And** message appears in configured channel
**And** ISB console deep link works
**And** score breakdown is accurate

**Given** CloudWatch verification
**When** checking logs and metrics
**Then** structured JSON logs are visible
**And** custom metrics appear in CloudWatch
**And** alarms are configured correctly

**Given** lease comments verification
**When** checking ISB UI
**Then** comments show correct status messages
**And** reference numbers are formatted correctly

**E2E Protocol:**
Output `<promise>STOP</promise>` to halt automation loop. Interactive testing with Cns via ISB UI will:
1. Trigger low-risk request → verify auto-approve, check comments
2. Trigger high-risk request → verify Slack workflow triggered, check message
3. Trigger out-of-hours request → verify delay message, wait for 30-min check
4. Verify CloudWatch logs and metrics
5. Test full manual approval flow via ISB console
