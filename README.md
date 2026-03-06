# Innovation Sandbox on AWS - Approver

Automated lease approval system for the [Innovation Sandbox on AWS (ISB)](https://github.com/co-cddo/innovation-sandbox-on-aws). This service transforms manual approval bottlenecks into an intelligent, score-based system that gives legitimate users instant approval while reliably catching edge cases for manual review.

## Overview

The ISB Approver listens for `LeaseRequested` events from the Innovation Sandbox and makes automated approval decisions using a 19-rule scoring engine. Most users receive instant approval ("preapproved" experience), while higher-risk requests are escalated to operators with full context for quick manual review.

**Core Philosophy:** Most users are acting in good faith. The system provides instant access with no waiting while due diligence happens invisibly behind the scenes.

### Key Outcomes

| Metric | Target |
|--------|--------|
| Instant approvals | 80%+ of legitimate requests |
| Manual review reduction | From 100% to ~20% of requests |
| False negative rate | Less than 5% (bad actors caught) |
| Request reliability | Zero lost requests |

## Features

### Intelligent Risk Scoring
- **19 configurable scoring rules** evaluating risk from multiple angles
- Rules cover: user history, organization reputation, domain verification, email patterns, timing, budget/duration
- Deterministic scoring with complete breakdown logging
- Configurable threshold for auto-approval vs escalation (default: 20 points)

### Domain Verification
- Verified UK local government domains from `ukps-domains` list receive trust bonus
- Cached from S3 with 1-hour TTL for performance
- Unverified domains scored neutrally

### AI-Powered Email Analysis
- Amazon Bedrock (Nova Micro) detects group/shared mailbox patterns
- Circuit breaker with 60-second recovery for resilience
- Graceful fallback to rule-based heuristics when AI unavailable

### Business Hours & Queue Management
- Out-of-hours requests (outside 7am-7pm London, weekdays) delayed until next business day
- UK bank holidays automatically detected via gov.uk calendar
- Requests queued when no sandbox accounts available (FIFO processing)
- Queue expiry after 5 business days with automatic denial

### Operator Workflows
- Slack Workflow Webhook notifications for escalated requests
- Direct ISB console deep links for manual review/approval
- Complete score breakdown visible to operators
- Reference numbers (ISB-YYYY-NNNN) for tracking

### User Communication
- Lease comments updated with clear, neutral-language status messages
- Different messages for auto-approved, escalated, delayed, queued, and expired requests

### Reliability & Resilience
- Idempotent processing (AWS Lambda Powertools with DynamoDB backend)
- Dead Letter Queue (DLQ) for failed events
- Fail-closed error handling (queues for manual review on infrastructure failures)
- Zero lost requests guarantee

### Operational Visibility
- Structured JSON CloudWatch logging
- Custom metrics: decisions, scores, latency, per-rule triggers
- CloudWatch alarms for DLQ depth, error rate, latency
- GDPR-compliant 7-year audit trail

### Account Availability

**Queue Management:**
- Requests queue FIFO when no accounts are available
- Users receive queue position notification
- Queued requests expire after 5 business days
- `AccountCleanupSucceeded` events trigger queue processing

**High Demand:**
- All accounts Active triggers high-demand messaging
- Ops team receives throttled alerts (max 1 per hour)

## Architecture

### Technology Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 20 with TypeScript 5.3 (strict mode) |
| Infrastructure | AWS CDK (L3 constructs) |
| Testing | Vitest with 800+ tests |
| CI/CD | GitHub Actions with OIDC (no long-lived credentials) |

### AWS Services

| Service | Purpose |
|---------|---------|
| Lambda | Single function, multiple EventBridge triggers |
| EventBridge | Event-driven architecture (LeaseRequested, AccountCleanupSucceeded, scheduler) |
| DynamoDB | Lease/account data, user history queries, idempotency tracking |
| SQS | Delay queue for out-of-hours processing |
| S3 | Domain allowlist caching |
| Bedrock | Amazon Nova Micro for email/domain analysis |
| IAM Identity Center | Pre-approved group membership checks (cross-account) |
| Secrets Manager | Slack webhook URL |
| CloudWatch | Structured logging, metrics, alarms |

### Decision Flow

```
LeaseRequested Event
        │
        ▼
┌───────────────────┐
│   RECEIVED        │ Parse and validate event
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│   TIMING_CHECK    │ Within business hours?
└─────────┬─────────┘
          │
    ┌─────┴─────┐
    │           │
    ▼           ▼
 DELAYED    Continue
 (to SQS)       │
                ▼
┌─────────────────────────┐
│ ACCOUNT_AVAILABILITY_CHECK │ Account available?
└───────────┬─────────────┘
            │
      ┌─────┴─────┐
      │           │
      ▼           ▼
   QUEUED     Continue
 (with ETA)       │
                  ▼
┌───────────────────┐
│     SCORING       │ Run 19 scoring rules
└─────────┬─────────┘     (allow-list override applied here)
          │
          ▼
┌───────────────────┐
│     DECIDING      │ Score < threshold?
└─────────┬─────────┘
          │
    ┌─────┴─────┐
    │           │
    ▼           ▼
 APPROVED   ESCALATED
            (Slack + manual review)
```

## Scoring Engine

The scoring engine evaluates 19 rules, each contributing positive (penalty) or negative (bonus) points:

### Penalty Rules (increase risk score)

| Rule | Weight | Trigger |
|------|--------|---------|
| `expired_leases` | +2 each | Expired lease in last 30 days |
| `budget_exceeded` | +5 each | Budget exceeded in last 30 days |
| `first_time_user` | +5 | No previous leases |
| `first_time_user_group_mailbox_compound` | +20 | First lease + group mailbox |
| `cooldown_violation` | +10 | Request within 1hr of previous lease end |
| `outside_target_audience` | +50 | Non-local-gov domain |
| `group_mailbox_detected` | +20 | AI-detected group mailbox |
| `org_recent_negative` | +3 | Same domain issues in last 30 days |
| `template_hopper` | +2 | 3+ leases never repeating template |
| `end_of_window` | +2 | Request in final 2 hours (5-7pm London) |
| `user_rate_limit` | +5 per | Excess requests beyond 2/hour |
| `org_rate_limit` | +3 | 5+ different users from org in last hour |

### Bonus Rules (decrease risk score)

| Rule | Weight | Trigger |
|------|--------|---------|
| `allow_list_override` | -100 | User in pre-approved Identity Center group (`ndx-IsbPreapprovedGroup`) |
| `verified_gov_domain` | -5 | Domain in ukps-domains allowlist |
| `familiar_template` | -1 | Previously used template successfully |
| `manual_early_termination` | -2 each | Early termination (responsible behavior) |
| `org_clean_record` | -2 | Domain clean for 90 days with 5+ leases |

### Per-Unit Rules

| Rule | Weight | Calculation |
|------|--------|-------------|
| `budget_amount` | +1 per $10 | Higher budgets = more scrutiny |
| `duration_requested` | +1 per 8 hours | Longer durations = more scrutiny |

**Threshold:** Requests scoring below 20 points are auto-approved; 20+ are escalated.

## Project Structure

```
innovation-sandbox-on-aws-approver/
├── src/
│   ├── handler.ts              # Lambda entry point
│   ├── scoring/                # 19-rule scoring engine
│   │   ├── engine.ts           # Score calculation orchestrator
│   │   ├── rules.ts            # Rule implementations
│   │   ├── types.ts            # Scoring types
│   │   └── config.ts           # Weight configuration
│   ├── state-machine/          # Decision orchestration
│   │   ├── orchestrator.ts     # State machine executor
│   │   ├── handlers.ts         # State handlers
│   │   └── types.ts            # State definitions
│   ├── services/               # AWS service integrations
│   │   ├── bedrock.ts          # AI email analysis
│   │   ├── dynamodb.ts         # User/org history queries
│   │   ├── eventbridge.ts      # Event emission
│   │   ├── identity-store.ts   # Identity Center group checks (cross-account)
│   │   ├── isb-lambda.ts       # Direct ISB Lambda calls
│   │   ├── slack.ts            # Escalation notifications
│   │   ├── sqs.ts              # Delay queue management
│   │   ├── metrics.ts          # CloudWatch metrics
│   │   └── domain-allowlist.ts # S3 domain cache
│   └── lib/                    # Utilities
│       ├── logger.ts           # Structured logging
│       ├── business-hours.ts   # London timezone handling
│       ├── circuit-breaker.ts  # Resilient service calls
│       ├── lease-comments.ts   # User-facing messages
│       └── types.ts            # Event schemas (Zod)
├── cdk/                        # Infrastructure as Code
│   ├── bin/approver.ts         # CDK app entry
│   ├── lib/approver-stack.ts   # Main stack
│   └── config/environments.ts  # Environment configuration
├── test/                       # 800+ tests
├── _bmad-output/               # Project documentation
└── .github/workflows/          # CI/CD pipelines
```

## Getting Started

### Prerequisites

- Node.js 20+
- AWS CLI configured with appropriate credentials
- AWS CDK CLI (`npm install -g aws-cdk`)

### Installation

```bash
npm install
```

### Build

```bash
npm run build
```

### Test

```bash
npm test              # Run all tests
npm run test:coverage # With coverage report
```

### Deploy

```bash
# Deploy infrastructure
cd cdk && npx cdk deploy ApproverStack --profile YOUR_PROFILE

# Or use the GitHub Actions workflow (recommended)
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AUTO_APPROVE_THRESHOLD` | Score threshold for auto-approval | `20` |
| `BUSINESS_HOURS_START` | Start of business hours (24h) | `7` |
| `BUSINESS_HOURS_END` | End of business hours (24h) | `19` |
| `BUSINESS_HOURS_TZ` | Timezone for business hours | `Europe/London` |
| `RULE_WEIGHTS` | JSON object of rule weights | See defaults |
| `ISB_CONSOLE_URL` | ISB console base URL | - |
| `ISB_LEASES_TABLE_NAME` | DynamoDB leases table | - |
| `ISB_ACCOUNTS_TABLE_NAME` | DynamoDB accounts table | - |
| `ISB_LEASES_LAMBDA_NAME` | ISB Lambda for approvals | - |
| `SLACK_WEBHOOK_SECRET_ARN` | Secrets Manager ARN for Slack | - |
| `BEDROCK_MODEL_ID` | Bedrock model for AI analysis | `us.amazon.nova-micro-v1:0` |
| `DELAY_QUEUE_URL` | SQS queue for delayed requests | - |
| `DOMAIN_ALLOWLIST_BUCKET` | S3 bucket for domain list | - |
| `IDENTITY_STORE_ID` | Identity Store ID for pre-approved group | `d-9267e1e371` |
| `IDENTITY_CENTER_ROLE_ARN` | Cross-account role ARN for Identity Center | - |
| `IDENTITY_CENTER_GROUP_ID` | Group ID for pre-approved users | - |

### Rule Weight Customization

Override default weights via the `RULE_WEIGHTS` environment variable:

```json
{
  "firstTimeUser": 5,
  "groupMailboxDetected": 20,
  "verifiedGovDomain": -5,
  "outsideTargetAudience": 50
}
```

## Documentation

Detailed project documentation is available in the `_bmad-output/` directory:

| Document | Description |
|----------|-------------|
| [Product Requirements](./_bmad-output/prd.md) | Full PRD with success metrics |
| [Architecture](./_bmad-output/architecture.md) | Technical design and patterns |
| [Epics & Stories](./_bmad-output/epics.md) | 6 epics, 24 stories breakdown |
| [ISB Integration](./_bmad-output/isb-integration-reference.md) | Integration with Innovation Sandbox |
| [Implementation Artifacts](./_bmad-output/implementation-artifacts/) | Story-level implementation details |
| [ADR-001: Identity Center Pre-approval](./docs/adr/001-identity-center-group-preapproval.md) | Decision to replace hardcoded allow-list |
| [Pre-approved Group Runbook](./docs/runbooks/preapproved-group-management.md) | Managing the pre-approved Identity Center group |
| [Approver Access Management](./docs/approver-access-management.md) | Slack operator and pre-approval access |

### Epics Overview

| Epic | Focus | Stories |
|------|-------|---------|
| 1 | Project Foundation & Infrastructure | 4 |
| 2 | Core Approval Flow | 5 |
| 3 | Intelligent Scoring | 5 |
| 4 | Timing & Queue Management | 4 |
| 5 | Communications & Operations | 5 |
| 6 | Account Availability | 1 |

## Integration with Innovation Sandbox

This approver integrates with the main [Innovation Sandbox on AWS](https://github.com/co-cddo/innovation-sandbox-on-aws):

- **Events:** Subscribes to `LeaseRequested` events from ISB EventBridge
- **Approvals:** Invokes ISB Lambda directly for lease approval/denial
- **Data:** Queries ISB DynamoDB tables for user/org history
- **Console:** Deep links to ISB console for operator actions

## License

[MIT License](./LICENSE) - Crown (Government Digital Service) 2025
