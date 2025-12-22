# Story 1.2: CDK Infrastructure Stack

Status: done

## Story

As a **developer**,
I want **a CDK stack that deploys all AWS resources required by the Approver service**,
So that **the Lambda and its triggers, queues, and storage are provisioned in us-west-2**.

## Acceptance Criteria

1. **AC1: CDK synthesis succeeds**
   - Given the CDK stack is defined
   - When I run `cdk synth`
   - Then CloudFormation template is generated without errors

2. **AC2: All required resources are defined**
   - Given the CDK stack is synthesized
   - When I inspect the CloudFormation template
   - Then the following resources are defined:
     - ApproverFunction (Lambda, Node.js 20, 30s timeout, 512MB)
     - LeaseRequestedRule (EventBridge rule for `LeaseRequested` events)
     - CleanupSucceededRule (EventBridge rule for `AccountCleanupSucceeded` events)
     - QueueCheckSchedule (EventBridge Scheduler - every 30 minutes)
     - DelayQueue (SQS with DLQ)
     - IdempotencyTable (DynamoDB for Powertools idempotency)
     - DomainListBucket (S3 for ukps-domains cache)

3. **AC3: Configuration via environment variables**
   - Given configuration is required
   - When the Lambda is deployed
   - Then non-secret config is passed via Lambda environment variables:
     - `AUTO_APPROVE_THRESHOLD` (default: 20)
     - `BUSINESS_HOURS_START` (default: 7)
     - `BUSINESS_HOURS_END` (default: 19)
     - `BUSINESS_HOURS_TZ` (default: Europe/London)
     - `ISB_CONSOLE_URL` (from AppConfig or hardcoded)
     - `ISB_LEASES_TABLE_NAME` (cross-stack reference)
     - `ISB_ACCOUNTS_TABLE_NAME` (cross-stack reference)
     - `RULE_WEIGHTS` (JSON string of 16 rule weights)

4. **AC4: Secrets Manager integration**
   - Given secrets are required
   - When the Lambda accesses Slack webhook
   - Then it reads from Secrets Manager ARN: `arn:aws:secretsmanager:us-west-2:*:secret:/approver/slack-webhook-url`
   - And the secret is pre-created via AWS CLI (not managed by CDK)

5. **AC5: ISB table permissions**
   - Given ISB integration is required
   - When referencing ISB DynamoDB tables
   - Then table names are read from ISB stack exports or hardcoded as environment variables
   - And IAM permissions grant read access to ISB Leases table
   - And IAM permissions grant read access to ISB SandboxAccount table
   - And IAM permissions grant write access to ISB Leases table (comments field)

6. **AC6: IAM least-privilege**
   - Given the CDK stack is deployed
   - When the Lambda function exists
   - Then it has IAM permissions to:
     - Read/Write IdempotencyTable
     - Read DomainListBucket
     - Put events to EventBridge (source: `innovation-sandbox`)
     - Read Secrets Manager (`/approver/*`)
     - Invoke Bedrock (Nova Micro in us-west-2)
   - And least-privilege is enforced (no `*` resources except where required by service)

7. **AC7: CDK tests pass**
   - Given the CDK stack is defined
   - When I run `npm test`
   - Then CDK snapshot and fine-grained assertion tests pass

## Tasks / Subtasks

- [x] Task 1: Add CDK dependencies (AC: 1)
  - [x] Add `aws-cdk` and `aws-cdk-lib` to devDependencies
  - [x] Add `constructs` package
  - [x] Create `cdk.json` configuration file
  - [x] Update tsconfig to include cdk/ directory

- [x] Task 2: Create CDK app entry point (AC: 1)
  - [x] Create `cdk/bin/approver.ts` with App instantiation
  - [x] Configure stack for us-west-2 region
  - [x] Add environment configuration support

- [x] Task 3: Create main infrastructure stack (AC: 2, 3)
  - [x] Create `cdk/lib/approver-stack.ts`
  - [x] Define all environment variables
  - [x] Configure cross-stack references for ISB tables

- [x] Task 4: Create Lambda construct (AC: 2, 3, 6)
  - [x] Create `cdk/lib/constructs/approver-lambda.ts`
  - [x] Configure Node.js 20 runtime
  - [x] Set 30s timeout, 512MB memory
  - [x] Bundle with esbuild
  - [x] Add all environment variables

- [x] Task 5: Create EventBridge rules (AC: 2)
  - [x] Create LeaseRequestedRule targeting Lambda
  - [x] Create CleanupSucceededRule targeting Lambda
  - [x] Create QueueCheckSchedule (rate 30 minutes)
  - [x] Configure event patterns correctly

- [x] Task 6: Create SQS delay queue (AC: 2)
  - [x] Create DelayQueue with 30s delay
  - [x] Create DLQ for failed messages
  - [x] Configure redrive policy (3 retries)
  - [x] Grant Lambda permissions

- [x] Task 7: Create DynamoDB idempotency table (AC: 2, 6)
  - [x] Create IdempotencyTable with correct schema
  - [x] Configure TTL attribute
  - [x] Grant Lambda read/write permissions

- [x] Task 8: Create S3 domain list bucket (AC: 2, 6)
  - [x] Create DomainListBucket
  - [x] Configure bucket encryption
  - [x] Grant Lambda read permissions

- [x] Task 9: Configure IAM permissions (AC: 5, 6)
  - [x] Grant ISB Leases table read/write
  - [x] Grant ISB SandboxAccount table read
  - [x] Grant EventBridge put events
  - [x] Grant Secrets Manager read for /approver/*
  - [x] Grant Bedrock invoke for Nova Micro

- [x] Task 10: Create CDK tests (AC: 7)
  - [x] Create `cdk/test/approver-stack.test.ts`
  - [x] Add snapshot test
  - [x] Add fine-grained assertions for security-sensitive resources
  - [x] Verify IAM policies are least-privilege

- [x] Task 11: Add npm scripts for CDK (AC: 1)
  - [x] Add `cdk:synth` script
  - [x] Add `cdk:diff` script
  - [x] Add `cdk:deploy` script
  - [x] Update lint script to include cdk/

## Dev Notes

### Architecture Patterns & Constraints

**From Architecture Document:**
- **Region:** us-west-2 (co-located with existing ISB deployment) - Source: architecture.md#Deployment-&-Resilience
- **IaC:** AWS CDK with L3 constructs - Source: architecture.md#Architectural-Decisions-Locked-In
- **Runtime:** Node.js 20.x - Source: architecture.md#Architectural-Decisions-Locked-In
- **Lambda timeout:** 30 seconds - Source: epics.md#Story-1.2
- **Lambda memory:** 512MB - Source: epics.md#Story-1.2

### CDK Project Structure

**From Architecture:**
```
cdk/
├── bin/
│   └── approver.ts            # CDK app entry point
├── lib/
│   ├── approver-stack.ts      # Main stack
│   └── constructs/
│       ├── approver-lambda.ts # Lambda + EventBridge rule
│       ├── config-params.ts   # SSM parameters (if needed)
│       └── monitoring.ts      # Alarms, dashboards, DLQ (Story 5.3)
├── config/
│   └── environments.ts        # Type-safe environment config
└── test/
    └── approver-stack.test.ts
```

### Prerequisites (Already Done)

**Secrets created via AWS CLI:**
- ARN: `arn:aws:secretsmanager:us-west-2:568672915267:secret:/approver/slack-webhook-url-FXJl1d`

### CDK Resources to Create

| Resource | Type | Purpose |
|----------|------|---------|
| `ApproverFunction` | Lambda | Main processing function |
| `LeaseRequestedRule` | EventBridge Rule | Trigger on LeaseRequested |
| `CleanupSucceededRule` | EventBridge Rule | Trigger on AccountCleanupSucceeded |
| `QueueCheckSchedule` | EventBridge Scheduler | Every 30 minutes |
| `DelayQueue` | SQS Queue | 30s delay for queue processing |
| `IdempotencyTable` | DynamoDB Table | Duplicate event prevention |
| `DomainListBucket` | S3 Bucket | UK council domain cache |

### Environment Variables

| Variable | Source | Default/Value |
|----------|--------|---------------|
| `AUTO_APPROVE_THRESHOLD` | CDK prop | 20 |
| `BUSINESS_HOURS_START` | CDK prop | 7 |
| `BUSINESS_HOURS_END` | CDK prop | 19 |
| `BUSINESS_HOURS_TZ` | CDK prop | Europe/London |
| `ISB_CONSOLE_URL` | CDK prop | TBD from AppConfig |
| `ISB_LEASES_TABLE_NAME` | CDK prop | Cross-stack reference |
| `ISB_ACCOUNTS_TABLE_NAME` | CDK prop | Cross-stack reference |
| `RULE_WEIGHTS` | CDK prop | JSON string |
| `IDEMPOTENCY_TABLE_NAME` | CDK | Created table name |
| `DELAY_QUEUE_URL` | CDK | Created queue URL |
| `DOMAIN_LIST_BUCKET` | CDK | Created bucket name |
| `SLACK_WEBHOOK_SECRET_ARN` | CDK | Pre-created secret ARN |
| `BEDROCK_MODEL_ID` | CDK | amazon.nova-micro-v1:0 |
| `LOG_LEVEL` | CDK | INFO |

### IAM Permissions Required

| Service | Actions | Resource |
|---------|---------|----------|
| DynamoDB | GetItem, Query, UpdateItem, PutItem | ISB Leases table |
| DynamoDB | GetItem, Query | ISB SandboxAccount table |
| DynamoDB | GetItem, PutItem, UpdateItem, DeleteItem | Idempotency table |
| EventBridge | PutEvents | Default event bus |
| Bedrock | InvokeModel | Nova Micro model |
| S3 | GetObject | Domain list bucket |
| SQS | SendMessage, ReceiveMessage, DeleteMessage | Delay queue |
| Secrets Manager | GetSecretValue | /approver/* |
| CloudWatch Logs | Auto-granted by Lambda construct | Lambda log group |

### Idempotency Table Schema

| Attribute | Type | Purpose |
|-----------|------|---------|
| `id` | String (PK) | `approver#{leaseId}#{eventId}` |
| `status` | String | INPROGRESS, COMPLETED, EXPIRED |
| `expiration` | Number | TTL for auto-cleanup |
| `data` | String | Cached response |

### EventBridge Event Patterns

**LeaseRequested:**
```json
{
  "source": ["innovation-sandbox"],
  "detail-type": ["LeaseRequested"]
}
```

**AccountCleanupSucceeded:**
```json
{
  "source": ["innovation-sandbox"],
  "detail-type": ["AccountCleanupSucceeded"]
}
```

### cdk.json Configuration

```json
{
  "app": "npx tsx cdk/bin/approver.ts",
  "watch": {
    "include": ["**"],
    "exclude": ["node_modules", "cdk.out", "dist", "coverage"]
  },
  "context": {
    "@aws-cdk/aws-lambda:recognizeLayerVersion": true,
    "@aws-cdk/core:stackRelativeExports": true
  }
}
```

### Previous Story Learnings (Story 1.1)

**From Story 1.1 implementation:**
- tsconfig.json should NOT use `rootDir` when including both src/ and test/ directories
- ESLint ignores should use `dist/**` pattern, not `*.js`
- Centralized logger at `src/lib/logger.ts` - import using `.js` extension for ESM
- Vitest config should include explicit `include: ['test/**/*.test.ts']`
- All npm scripts must work: build, test, typecheck, lint, check

**Files created in Story 1.1 (don't duplicate):**
- package.json (update for CDK deps)
- tsconfig.json (update for CDK include)
- vitest.config.ts
- eslint.config.mjs (update to include cdk/)
- src/handler.ts
- src/lib/logger.ts
- src/lib/types.ts

### Package.json Updates Required

Add CDK dependencies:
```json
{
  "devDependencies": {
    "aws-cdk": "^2.170.0",
    "aws-cdk-lib": "^2.170.0",
    "constructs": "^10.4.0"
  }
}
```

Add CDK scripts:
```json
{
  "scripts": {
    "cdk:synth": "cdk synth",
    "cdk:diff": "cdk diff",
    "cdk:deploy": "cdk deploy --require-approval never"
  }
}
```

Update lint script:
```json
{
  "scripts": {
    "lint": "eslint src test cdk --ext .ts"
  }
}
```

### References

- [Source: architecture.md#CDK-Resources-Created] - Resource definitions
- [Source: architecture.md#Environment-Variables] - Env var list
- [Source: architecture.md#IAM-Permissions-Required] - IAM permissions
- [Source: epics.md#Story-1.2] - Acceptance criteria details
- [Source: architecture.md#Idempotency-Pattern] - Table schema

### Critical Warnings

1. **DO NOT create secrets in CDK** - Slack webhook secret is pre-created via AWS CLI
2. **DO NOT hardcode AWS account IDs** - Use CDK environment references
3. **DO NOT use Lambda layers** - Bundle with esbuild inline
4. **DO NOT deploy yet** - Story 1.3 sets up CI/CD for deployment
5. **MUST use Node.js 20** - Not 18 or earlier
6. **MUST use us-west-2** - Co-located with ISB

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

- Fixed ESLint error for unused 'expect' import by adding test globals to eslint.config.mjs
- Fixed Prettier formatting issues by running `npm run format`
- Fixed CDK tests not running by adding `cdk/test/**/*.test.ts` to vitest.config.ts include

### Completion Notes List

1. Created complete CDK infrastructure stack with all required AWS resources
2. Implemented ApproverLambda construct with Node.js 20, 30s timeout, 512MB memory, ARM64 architecture
3. Added all environment variables per specification
4. Created IAM policies with least-privilege access for:
   - Bedrock (Nova Micro model invoke)
   - Secrets Manager (/approver/* secrets)
   - EventBridge (PutEvents to default bus)
   - DynamoDB (ISB Leases read/write, ISB Accounts read - no Scan)
   - AppConfig (scoped to account/region - not wildcard)
5. Created DynamoDB IdempotencyTable with TTL on expiration attribute
6. Created S3 DomainListBucket with AES256 encryption and public access blocked
7. Created SQS DelayQueue with 30s delay and DLQ (3 max receives)
8. Created EventBridge rules for LeaseRequested and AccountCleanupSucceeded events
9. Created EventBridge Scheduler for 30-minute queue checks
10. All 27 tests passing (3 handler + 24 CDK assertion tests including snapshot)
11. `npm run check` passes (typecheck, lint, format, test)
12. `npm run cdk:synth` generates valid CloudFormation template

### Code Review Fixes Applied

- **HIGH-1**: Removed wildcard `*` from AppConfig resources - now scoped to account/region
- **HIGH-2**: Added missing snapshot test for CloudFormation template
- **HIGH-3**: Removed excessive `Scan` permission from ISB Accounts table (least-privilege)
- **MEDIUM-1**: Removed hardcoded account ID fallback - now requires CDK_DEFAULT_ACCOUNT
- **MEDIUM-3**: Fixed test isolation by using `beforeAll` for stack creation
- **MEDIUM-4**: Fixed cdk.json watch to not exclude test directory

### File List

Files created:
- cdk.json
- cdk/bin/approver.ts
- cdk/lib/approver-stack.ts
- cdk/lib/constructs/approver-lambda.ts
- cdk/config/environments.ts
- cdk/test/approver-stack.test.ts

Files modified:
- package.json (added CDK dependencies and scripts)
- tsconfig.json (added cdk/ to include, cdk.out to exclude)
- eslint.config.mjs (added cdk/ to lint paths, added test globals)
- vitest.config.ts (added cdk/test/**/*.test.ts to include)
