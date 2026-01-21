---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments:
  - '_bmad-output/prd.md'
  - '_bmad-output/index.md'
  - '_bmad-output/isb-integration-reference.md'
  - '_bmad-output/deployer-pattern-reference.md'
  - '_bmad-output/approver-requirements.md'
  - '_bmad-output/analysis/brainstorming-session-2025-12-22.md'
  - '_bmad-output/analysis/brainstorming-session-2025-12-22-edge-cases.md'
  - '_bmad-output/analysis/research/technical-approver-implementation-research-2025-12-22.md'
workflowType: 'architecture'
lastStep: 6
project_name: 'innovation-sandbox-on-aws-approver'
user_name: 'Cns'
date: '2025-12-22'
hasProjectContext: false
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
57 FRs across 13 capability areas defining a score-based lease approval system. Core capabilities include event-driven processing, multi-rule scoring engine with AI analysis, domain verification, business hours enforcement, and one-way Slack notifications with ISB console deep links.

**Non-Functional Requirements:**
- Performance: p95 <5s, p99 <8s end-to-end, cold start <4s
- Reliability: Zero lost requests, fail-closed, RTO 4 business hours
- Scalability: 500 requests/day without architecture changes, 20 concurrent burst
- Maintainability: 90% scoring engine coverage, 100% branch on thresholds
- Observability: Structured JSON logging, per-rule metrics, DLQ alerting

**Scale & Complexity:**
- Primary domain: Backend (event-driven Lambda)
- Complexity level: Medium
- Estimated architectural components: 10+ modules in single Lambda function

### Technical Constraints & Dependencies

| Constraint | Source | Impact |
|------------|--------|--------|
| EventBridge schema | ISB Integration | Fixed event contracts (LeaseRequested/Approved/Denied) |
| DynamoDB schema | ISB Integration | Composite key (userEmail + uuid), existing table structure |
| Node.js 20 + TypeScript | Deployer Pattern | Runtime and language standardization |
| esbuild bundling | Deployer Pattern | Lambda packaging approach |
| Vitest testing | Deployer Pattern | Test framework standardization |
| IAM-only auth | Security model | Lambda execution role for AWS services |

### Lambda Function Boundaries

| Function | Trigger | Purpose |
|----------|---------|---------|
| `approver` | EventBridge: `LeaseRequested` | Process new lease requests, calculate score, emit decision |
| `approver` | EventBridge: `AccountCleanupSucceeded` | Check queue after account becomes available |
| `approver` | SQS (delay queue) | Process delayed queue checks (30s delay) |
| `approver` | EventBridge Scheduler: `rate(30 minutes)` | Fallback queue processing |
| `approver` | EventBridge Scheduler: `cron(0 7 ? * MON-FRI *)` | 7am London business hours processing |
| `slack-callback` | API Gateway: POST `/slack/interactions` | Handle Slack button callbacks (approve/deny) |

**Note:** Two Lambda functions - `approver` for event processing, `slack-callback` for Slack interactive buttons. The callback handler verifies Slack signing secret, processes approve/deny actions, emits appropriate EventBridge events, and updates the Slack message with confirmation.

### Cross-Cutting Concerns Identified

| Concern | Affected Components | Architectural Approach |
|---------|---------------------|------------------------|
| Idempotency | Event processing, scoring, notifications | AWS Powertools utility keyed on `{leaseId}:{eventId}` |
| Error Handling | All components | Fail-closed to manual queue, structured error types |
| Configuration | Scoring weights, thresholds, business hours | SSM Parameter Store + ISB AppConfig with 5-minute cache TTL |
| Observability | All components | Structured JSON logging, CloudWatch metrics |
| Testing | Scoring engine priority | Pure functions for deterministic testing |
| Decision State Machine | Event processing, scoring | Explicit state enum, single handler per state |
| Testability | All AWS integrations | Dependency injection for AWS clients |
| Infrastructure as Code | All AWS resources | CDK with L3 constructs, type-safe config |

### Testing Strategy Boundaries

| Component | Test Type | Coverage Target | Approach |
|-----------|-----------|-----------------|----------|
| Scoring rules | Unit | 100% | Pure functions, deterministic |
| Scoring engine | Unit | 90% line, 100% branch on thresholds | DI for testability |
| Event processing | Integration | 80% | AWS mocks, happy path focus |
| Bedrock integration | Contract | N/A | Mock in tests, can't unit test AI |
| Slack notifications | Contract | N/A | Mock external service |
| CDK stacks | Snapshot + Fine-grained | All stacks | Security-sensitive resources verified |

### Project Structure

```
innovation-sandbox-on-aws-approver/
├── src/                           # Lambda source code
│   ├── handlers/
│   │   ├── approver.ts            # EventBridge handler (main processing)
│   │   └── slack-callback.ts      # API Gateway handler (Slack buttons)
│   ├── state-machine.ts           # Decision orchestration
│   ├── scoring/
│   │   ├── engine.ts              # Orchestrates rules
│   │   ├── rules.ts               # All 16 rules
│   │   └── types.ts
│   ├── services/
│   │   ├── dynamodb.ts
│   │   ├── eventbridge.ts
│   │   ├── bedrock.ts
│   │   ├── slack.ts               # Interactive webhook notifications
│   │   └── domain-cache.ts
│   └── lib/
│       ├── config.ts              # SSM + AppConfig
│       ├── logger.ts
│       ├── slack-signature.ts     # Slack signing secret verification
│       ├── business-hours.ts
│       └── types.ts
├── cdk/                           # Infrastructure as Code
│   ├── bin/
│   │   └── approver.ts            # CDK app entry point
│   ├── lib/
│   │   ├── approver-stack.ts      # Main stack
│   │   └── constructs/
│   │       ├── approver-lambda.ts # Approver Lambda + EventBridge rules
│   │       ├── slack-api.ts       # API Gateway + Slack callback Lambda
│   │       ├── config-params.ts   # SSM parameters
│   │       └── monitoring.ts      # Alarms, dashboards, DLQ
│   ├── config/
│   │   └── environments.ts        # Type-safe environment config
│   └── test/
│       └── approver-stack.test.ts
├── cdk.json                       # CDK configuration
├── package.json                   # Unified dependencies
├── tsconfig.json                  # Shared TypeScript config
├── vitest.config.ts
└── README.md
```

## Starter Template Evaluation

### Primary Technology Domain

AWS Lambda (serverless backend) with event-driven architecture, following established ISB Deployer patterns.

### Approach: Manual Setup Following Deployer Patterns

**Rationale:**
- Consistency with existing ISB Deployer codebase
- Proven patterns already documented
- CDK for infrastructure matches organizational standards
- No learning curve for different tooling

**Not using a starter template CLI** - this is a brownfield project following established organizational patterns.

### Initialization Commands

```bash
# Project structure (simplified for MVP)
mkdir -p src/{handlers,scoring,services,lib}
mkdir -p cdk/{bin,lib/constructs,config,test/constructs}

# Initialize npm
npm init -y

# Runtime dependencies
npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb \
  @aws-sdk/client-eventbridge @aws-sdk/client-bedrock-runtime \
  @aws-sdk/client-s3 @aws-sdk/client-sqs @aws-sdk/client-appconfigdata \
  @aws-lambda-powertools/idempotency @aws-lambda-powertools/logger \
  @aws-lambda-powertools/parameters \
  zod

# Dev dependencies
npm install -D typescript@^5.3 vitest@^4.0 @vitest/coverage-v8 \
  esbuild@^0.27 eslint@^8.55 prettier@^3.1 \
  @types/node@^20 @types/aws-lambda \
  @typescript-eslint/eslint-plugin@^6 \
  aws-cdk aws-cdk-lib constructs \
  tsx dotenv
```

### Final Project Structure

```
innovation-sandbox-on-aws-approver/
├── src/
│   ├── handlers/
│   │   ├── approver.ts            # EventBridge handler (main processing)
│   │   └── slack-callback.ts      # API Gateway handler (Slack buttons)
│   ├── state-machine.ts           # Decision orchestration
│   ├── scoring/
│   │   ├── engine.ts              # Orchestrates rules
│   │   ├── rules.ts               # All 16 rules
│   │   └── types.ts
│   ├── services/
│   │   ├── dynamodb.ts
│   │   ├── eventbridge.ts
│   │   ├── bedrock.ts
│   │   ├── slack.ts               # Interactive webhook notifications
│   │   └── domain-cache.ts
│   ├── lib/
│   │   ├── config.ts              # SSM + Secrets + AppConfig
│   │   ├── logger.ts
│   │   ├── slack-signature.ts     # Slack signing secret verification
│   │   ├── business-hours.ts
│   │   └── types.ts
├── cdk/
│   ├── bin/
│   │   └── approver.ts
│   ├── lib/
│   │   ├── approver-stack.ts
│   │   └── constructs/
│   │       ├── approver-lambda.ts
│   │       ├── slack-api.ts       # API Gateway + Slack callback Lambda
│   │       ├── config-params.ts
│   │       └── monitoring.ts
│   ├── config/
│   │   └── environments.ts
│   └── test/
├── cdk.json
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .env.example
└── README.md
```

### Package.json Scripts

```json
{
  "scripts": {
    "build": "esbuild src/handler.ts --bundle --platform=node --target=node20 --outdir=dist --format=esm --external:@aws-sdk/*",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src cdk --ext .ts",
    "typecheck": "tsc --noEmit",
    "cdk:synth": "cdk synth",
    "cdk:diff": "cdk diff",
    "cdk:deploy": "cdk deploy",
    "check": "npm run typecheck && npm run lint && npm run test"
  }
}
```

### Architectural Decisions Locked In

| Decision | Choice | Source |
|----------|--------|--------|
| Language | TypeScript 5.3+ (strict) | Deployer pattern |
| Runtime | Node.js 20.x | Deployer pattern |
| Module system | ES Modules | Deployer pattern |
| Bundler | esbuild | Deployer pattern |
| Test framework | Vitest 4.x | Deployer pattern |
| Schema validation | Zod | ISB pattern |
| IaC | AWS CDK | Organizational standard |
| Observability | AWS Lambda Powertools | Best practice |
| SSM caching | Powertools Parameters | 5-minute TTL requirement |

### Key Dependencies

| Package | Purpose |
|---------|---------|
| `@aws-lambda-powertools/idempotency` | Duplicate event handling |
| `@aws-lambda-powertools/logger` | Structured JSON logging |
| `@aws-lambda-powertools/parameters` | SSM/Secrets/AppConfig caching with TTL |
| `@aws-sdk/client-appconfigdata` | ISB console URL from AppConfig |
| `@aws-sdk/client-bedrock-runtime` | AI email/domain analysis |
| `zod` | Runtime event/config validation |
| `@aws-sdk/client-s3` | Domain list cache |

**Note:** Project initialization should be the first implementation story.

## Core Architectural Decisions

### Deployment & Resilience

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Region | us-west-2 | Co-located with existing ISB deployment |
| Multi-region | No | Single region sufficient for requirements |
| DR strategy | N/A | RTO 4 business hours acceptable |

### AI Model Selection

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Bedrock model | Amazon Nova Micro | Cheapest for text classification (~$0.05-$0.47/month) |
| Model ID | `amazon.nova-micro-v1:0` | Text-only, 128K context, optimized for classification |
| Fallback | Rule-based heuristics | Circuit breaker triggers deterministic fallback |

**Pricing comparison (December 2025):**
- Nova Micro: $0.000035/1K input, $0.00014/1K output
- Nova Lite: $0.00006/1K input, $0.00024/1K output
- Claude Haiku 4.5: $0.001/1K input, $0.005/1K output

Nova Micro is ~30x cheaper than Claude Haiku for our use case (50-500 requests/day).

### Slack Integration

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Notification type | Interactive webhook | Approve/deny directly from Slack |
| Callback handling | API Gateway + Lambda | Process Slack button interactions |
| Message format | Block Kit with action buttons | Rich formatting + approve/deny CTAs |
| Fallback | ISB console deep link | Link included for context/edge cases |

**Interactive Slack buttons require:**
- API Gateway endpoint for Slack callbacks
- Slack signing secret verification (request authenticity)
- Button payload processing (approve/deny actions)
- Response URL for message updates (confirmation feedback)

### ISB AppConfig Integration

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Console URL source | ISB AppConfig | Existing config, single source of truth |
| Application ID | `InnovationSandboxData-Config-Application-82ABA210` | Existing ISB app |
| Configuration ID | `InnovationSandboxData-Config-GlobalConfigHostedConfiguration-C30DF39C` | Global config |
| Config path | `auth.webAppUrl` | ISB console base URL |
| Cache TTL | 5 minutes | Match SSM caching strategy |

```typescript
// AppConfig integration example
import { getAppConfig } from '@aws-lambda-powertools/parameters/appconfig';

const isbConfig = await getAppConfig<{ auth: { webAppUrl: string } }>(
  'InnovationSandboxData-Config-GlobalConfigHostedConfiguration-C30DF39C',
  {
    application: 'InnovationSandboxData-Config-Application-82ABA210',
    environment: 'default',
    maxAge: 300,
  }
);
const consoleUrl = isbConfig.auth.webAppUrl;
```

### IAM Permissions Required

**Approver Lambda:**

| Service | Actions | Resource |
|---------|---------|----------|
| DynamoDB | GetItem, Query, UpdateItem, PutItem | Lease table, Sandbox Account table, Idempotency table |
| EventBridge | PutEvents | Default event bus |
| Bedrock | InvokeModel | Nova Micro model |
| S3 | GetObject | Domain list bucket |
| SQS | SendMessage, ReceiveMessage, DeleteMessage | Delay queue |
| SSM | GetParameter | Approver config parameters |
| AppConfig | GetConfiguration | ISB config |
| Secrets Manager | GetSecretValue | Slack webhook URL |
| CloudWatch Logs | CreateLogGroup, CreateLogStream, PutLogEvents | Lambda log group |

**Slack Callback Lambda:**

| Service | Actions | Resource |
|---------|---------|----------|
| DynamoDB | GetItem, UpdateItem | Lease table (read request, update status) |
| EventBridge | PutEvents | Default event bus (LeaseApproved/LeaseDenied) |
| Secrets Manager | GetSecretValue | Slack signing secret |
| CloudWatch Logs | CreateLogGroup, CreateLogStream, PutLogEvents | Lambda log group |

### Environment Variables

**Approver Lambda:**

| Variable | Source | Purpose |
|----------|--------|---------|
| `LEASE_TABLE_NAME` | CDK | DynamoDB lease table |
| `SANDBOX_ACCOUNT_TABLE_NAME` | CDK | DynamoDB sandbox accounts |
| `IDEMPOTENCY_TABLE_NAME` | CDK | DynamoDB idempotency table |
| `DELAY_QUEUE_URL` | CDK | SQS queue for delayed processing |
| `EVENT_BUS_NAME` | CDK | EventBridge bus (default) |
| `DOMAIN_LIST_BUCKET` | CDK | S3 bucket for domain cache |
| `SLACK_WEBHOOK_SECRET_ARN` | CDK | Secrets Manager ARN for webhook URL |
| `SSM_CONFIG_PREFIX` | CDK | SSM parameter path prefix |
| `ISB_APPCONFIG_APP` | CDK | ISB AppConfig application ID |
| `ISB_APPCONFIG_CONFIG` | CDK | ISB AppConfig configuration ID |
| `BEDROCK_MODEL_ID` | CDK | `amazon.nova-micro-v1:0` |
| `AUTO_APPROVE_THRESHOLD` | CDK | Score threshold (default: 20) |
| `LOG_LEVEL` | CDK | Logging verbosity |

**Slack Callback Lambda:**

| Variable | Source | Purpose |
|----------|--------|---------|
| `LEASE_TABLE_NAME` | CDK | DynamoDB lease table |
| `EVENT_BUS_NAME` | CDK | EventBridge bus (default) |
| `SLACK_SIGNING_SECRET_ARN` | CDK | Secrets Manager ARN for Slack signing secret |
| `LOG_LEVEL` | CDK | Logging verbosity |

### S3 Domain List Sync

| Decision | Choice | Rationale |
|----------|--------|-----------|
| MVP approach | Manual upload | Simple, no automation overhead |
| File format | JSON array | Easy to parse |
| Update frequency | As needed | Council domains rarely change |
| Future | GitHub Actions sync | Automate from gov.uk registry |

### Circuit Breaker Pattern

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Implementation | Custom in-memory class | Simple, no external dependencies |
| Failure threshold | 3 consecutive failures | Balance between resilience and responsiveness |
| Recovery time | 60 seconds | Allow Bedrock to recover |
| Fallback behavior | Rule-based scoring only | Deterministic, no AI dependency |

## Implementation Patterns

### State Machine Pattern

**Explicit enum-based state machine for decision orchestration:**

```typescript
// state-machine.ts
enum DecisionState {
  RECEIVED = 'RECEIVED',
  TIMING_CHECK = 'TIMING_CHECK',
  ACCOUNT_COOLDOWN_CHECK = 'ACCOUNT_COOLDOWN_CHECK',
  SCORING = 'SCORING',
  DECIDING = 'DECIDING',
  APPROVED = 'APPROVED',
  DENIED = 'DENIED',
  ESCALATED = 'ESCALATED',
  DELAYED = 'DELAYED',
  ERROR = 'ERROR',
}

interface StateContext {
  leaseId: string;
  userEmail: string;
  score: number;
  breakdown: RuleResult[];
  decision?: 'approved' | 'denied' | 'manual';
  // ... additional context
}

type StateHandler = (ctx: StateContext) => Promise<{ nextState: DecisionState; context: StateContext }>;
```

**Design principles:**
- Single handler per state (pure functions)
- Each handler returns `{ nextState, context }`
- State transitions logged with duration metrics
- Easy to test without mocks

### Error Handling Pattern

**Result types for expected failures, exceptions for unexpected:**

```typescript
// lib/types.ts
type ScoringResult =
  | { success: true; score: number; breakdown: RuleResult[] }
  | { success: false; reason: 'bedrock_unavailable' | 'timeout'; fallbackScore: number };

type EmailAnalysisResult =
  | { available: true; isGroupMailbox: boolean; confidence: number }
  | { available: false; reason: 'circuit_open' | 'timeout' | 'error' };
```

**Fail-closed philosophy:**
- All external call failures route to manual queue
- No silent failures or default approvals
- Full context preserved for operator review

### Dependency Injection Pattern

**Factory functions over classes - no DI framework overhead:**

```typescript
// services/dynamodb.ts
export const createDynamoService = (
  client: DynamoDBDocumentClient,
  config: { leaseTable: string; accountTable: string }
) => ({
  getLease: async (email: string, uuid: string): Promise<Lease | null> => { /* ... */ },
  getUserHistory: async (email: string, daysBack: number): Promise<Lease[]> => { /* ... */ },
  getDomainHistory: async (domain: string, daysBack: number): Promise<Lease[]> => { /* ... */ },
  updateLeaseComments: async (email: string, uuid: string, comments: string): Promise<void> => { /* ... */ },
  getAvailableAccounts: async (): Promise<SandboxAccount[]> => { /* ... */ },
});

// services/eventbridge.ts
export const createEventBridgeService = (
  client: EventBridgeClient,
  config: { eventBusName: string; source: string }
) => ({
  emitLeaseApproved: async (leaseId: string, userEmail: string, approvedBy: string): Promise<void> => { /* ... */ },
  emitLeaseDenied: async (leaseId: string, userEmail: string, deniedBy: string, reason: string): Promise<void> => { /* ... */ },
});

// services/bedrock.ts
export const createBedrockService = (
  client: BedrockRuntimeClient,
  config: { modelId: string },
  circuitBreaker: CircuitBreaker
) => ({
  analyzeEmail: async (email: string): Promise<EmailAnalysisResult> => { /* ... */ },
  analyzeDomain: async (domain: string, pageContent?: string): Promise<DomainAnalysisResult> => { /* ... */ },
});

// services/slack.ts
export const createSlackService = (webhookUrl: string, isbConsoleUrl: string) => ({
  notifyManualApproval: async (request: ApprovalNotification): Promise<void> => { /* ... */ },
});
```

**Testing benefit:** `createDynamoService(mockClient, config)` - instant testability.

### Service Dependencies Interface

```typescript
// lib/types.ts
interface ServiceDependencies {
  dynamo: ReturnType<typeof createDynamoService>;
  eventbridge: ReturnType<typeof createEventBridgeService>;
  bedrock: ReturnType<typeof createBedrockService>;
  slack: ReturnType<typeof createSlackService>;
  config: ApproverConfig;
  logger: Logger;
}
```

### Logging Pattern

**Structured JSON logging with correlation IDs:**

```typescript
// lib/logger.ts
import { Logger } from '@aws-lambda-powertools/logger';

export const createLogger = (leaseId: string, eventId: string) => {
  const logger = new Logger({ serviceName: 'approver' });
  logger.appendKeys({
    leaseId,
    eventId,
    correlationId: `${leaseId}:${eventId}`
  });
  return logger;
};
```

**State transition logging:**
```typescript
logger.info('State transition', {
  state: 'SCORING',
  previousState: 'BUSINESS_HOURS',
  durationMs: 45
});
```

**Circuit breaker visibility:**
```typescript
logger.warn('Circuit breaker opened', {
  circuitState: 'open',
  failureCount: 3,
  service: 'bedrock'
});
```

### Circuit Breaker Implementation

```typescript
// lib/circuit-breaker.ts
export class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;

  constructor(
    private readonly threshold: number = 3,
    private readonly recoveryTimeMs: number = 60000
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T | null> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.recoveryTimeMs) {
        this.state = 'half-open';
      } else {
        return null; // Circuit open, skip operation
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.state = 'closed';
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.threshold) {
      this.state = 'open';
    }
  }

  getState(): 'closed' | 'open' | 'half-open' {
    return this.state;
  }
}
```

### Slack Notification Pattern

**Interactive webhook with Block Kit formatting:**

```typescript
// services/slack.ts
const buildBlockKitMessage = (
  request: ApprovalNotification,
  consoleUrl: string
): SlackBlock[] => [
  {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Lease Approval Required*\n\nUser: ${request.userEmail}\nLease ID: ${request.leaseId}\nScore: ${request.score} (threshold: 20)`
    }
  },
  {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Score Breakdown:*\n${request.breakdown.map(r => `• ${r.rule}: ${r.points > 0 ? '+' : ''}${r.points}`).join('\n')}`
    }
  },
  {
    type: 'actions',
    block_id: `approval_${request.leaseId}`,
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Approve' },
        action_id: 'approve_lease',
        value: JSON.stringify({ leaseId: request.leaseId, userEmail: request.userEmail }),
        style: 'primary'
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Deny' },
        action_id: 'deny_lease',
        value: JSON.stringify({ leaseId: request.leaseId, userEmail: request.userEmail }),
        style: 'danger'
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: 'View in ISB Console' },
        url: `${consoleUrl}/leases/${request.leaseId}`
      }
    ]
  }
];
```

**Callback handler pattern:**

```typescript
// handlers/slack-callback.ts
import { createHmac, timingSafeEqual } from 'crypto';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // 1. Verify Slack signature
  const signature = event.headers['x-slack-signature'];
  const timestamp = event.headers['x-slack-request-timestamp'];
  const signingSecret = await getSecret(process.env.SLACK_SIGNING_SECRET_ARN!);

  if (!verifySlackSignature(event.body!, timestamp!, signature!, signingSecret)) {
    return { statusCode: 401, body: 'Invalid signature' };
  }

  // 2. Parse payload
  const payload = JSON.parse(decodeURIComponent(event.body!.replace('payload=', '')));
  const action = payload.actions[0];
  const { leaseId, userEmail } = JSON.parse(action.value);
  const operatorEmail = payload.user.name; // Slack user who clicked

  // 3. Process action
  if (action.action_id === 'approve_lease') {
    await emitLeaseApproved(leaseId, userEmail, operatorEmail);
  } else if (action.action_id === 'deny_lease') {
    await emitLeaseDenied(leaseId, userEmail, operatorEmail, 'Denied by operator');
  }

  // 4. Update Slack message with confirmation
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      replace_original: true,
      text: `Lease ${leaseId} ${action.action_id === 'approve_lease' ? 'approved' : 'denied'} by ${operatorEmail}`
    })
  };
};

function verifySlackSignature(body: string, timestamp: string, signature: string, secret: string): boolean {
  const baseString = `v0:${timestamp}:${body}`;
  const hmac = createHmac('sha256', secret).update(baseString).digest('hex');
  const computed = Buffer.from(`v0=${hmac}`);
  const received = Buffer.from(signature);
  return timingSafeEqual(computed, received);
}
```

**Non-blocking:** Initial Slack notification failures logged but don't block approval flow. Callback failures return 500 to Slack (will retry).

### Testing Strategy

| Component | Test Type | Coverage Target | Approach |
|-----------|-----------|-----------------|----------|
| Scoring rules | Unit | 100% | Pure functions, property-based for edges |
| State machine | Unit | 100% branch | Mock services, test transitions |
| Circuit breaker | Unit | 100% branch | 7 test cases for all states |
| DynamoDB service | Unit + Integration | 80% | Mock client + LocalStack |
| EventBridge service | Unit + Contract | 80% | Mock client + schema validation |
| Bedrock service | Unit + Contract | N/A | Mock responses + prompt format |
| Slack service | Unit + Contract | N/A | Mock fetch + Block Kit schema |
| Slack signature verification | Unit | 100% | Test valid/invalid signatures, timing |
| Slack callback handler | Unit + Integration | 80% | Mock API Gateway events, verify actions |
| Handler (e2e) | Integration | Happy path | Full flow with mocked AWS |

**Circuit breaker test cases:**
1. `closed → stays closed on success`
2. `closed → stays closed on 1-2 failures`
3. `closed → open after 3 failures`
4. `open → returns null immediately`
5. `open → half-open after recovery time`
6. `half-open → closed on success`
7. `half-open → open on failure`

**Contract tests validate shape, not behavior:**
- EventBridge: Event schema matches ISB contract
- Bedrock: Prompts produce parseable responses
- Slack: Block Kit messages validate against schema

### Delayed Processing Pattern

**Problem:** Requests may need to be delayed for:
1. Outside business hours (7am-7pm London, weekdays)
2. No sandbox accounts available

**Solution:** Event-driven with scheduled fallback.

#### EventBridge Triggers

| Rule | Source Event | Action |
|------|--------------|--------|
| Main processing | `LeaseRequested` | Full approval flow |
| Queue check (event) | `AccountCleanupSucceeded` | Process queued requests after 30s delay |
| Queue check (scheduled) | `rate(30 minutes)` | Fallback queue processing |
| Business hours | `cron(0 7 ? * MON-FRI *)` (Europe/London) | Process pending requests |

#### DynamoDB Pending Status

```typescript
// Pending request states
type PendingReason = 'OUTSIDE_BUSINESS_HOURS' | 'NO_ACCOUNTS_AVAILABLE';

interface PendingLease {
  userEmail: string;
  leaseId: string;
  status: 'PENDING';
  pendingReason: PendingReason;
  queuedAt: string; // ISO timestamp for FIFO ordering
  originalEvent: LeaseRequestedEvent; // Preserve full context
}
```

#### Queue Processing Flow

```
AccountCleanupSucceeded event
    ↓
[30s delay via SQS DelaySeconds]
    ↓
Check: Any accounts Available?
    ↓ Yes
Query: Oldest PENDING request (by queuedAt)
    ↓
Process through normal approval flow
    ↓
If approved → emit LeaseApproved
If more pending + more accounts → repeat
```

#### Business Hours Processing Flow

```
7am London (weekday) cron trigger
    ↓
Query: All requests with pendingReason = 'OUTSIDE_BUSINESS_HOURS'
    ↓
For each (oldest first):
    ├─ Check account availability
    ├─ If available → process approval flow
    └─ If not available → change to 'NO_ACCOUNTS_AVAILABLE'
```

#### Implementation Notes

- **30s delay:** Use SQS with `DelaySeconds: 30` for AccountCleanupSucceeded handling
- **FIFO ordering:** Query DynamoDB with `queuedAt` sort key
- **Idempotency:** Same `{leaseId}:{eventId}` key prevents duplicate processing
- **30-minute fallback:** Catches missed events, manual account additions

### Idempotency Pattern

**AWS Powertools Idempotency with DynamoDB backend:**

```typescript
// handler.ts
import { makeIdempotent } from '@aws-lambda-powertools/idempotency';
import { DynamoDBPersistenceLayer } from '@aws-lambda-powertools/idempotency/dynamodb';

const persistenceStore = new DynamoDBPersistenceLayer({
  tableName: process.env.IDEMPOTENCY_TABLE_NAME!,
});

const processLeaseRequest = async (event: LeaseRequestedEvent): Promise<void> => {
  // Main processing logic
};

export const handler = makeIdempotent(processLeaseRequest, {
  persistenceStore,
  dataKeywordArgument: 'event',
  keyPrefix: 'approver',
  // Key: approver#{leaseId}#{eventId}
  eventKeyJmesPath: '[detail.leaseId.uuid, id]',
  expiresAfterSeconds: 86400, // 24 hours
});
```

**Idempotency table schema:**

| Attribute | Type | Purpose |
|-----------|------|---------|
| `id` | String (PK) | `approver#{leaseId}#{eventId}` |
| `status` | String | INPROGRESS, COMPLETED, EXPIRED |
| `expiration` | Number | TTL for auto-cleanup |
| `data` | String | Cached response (if needed) |

### Pattern Summary

| Pattern | Implementation | Rationale |
|---------|----------------|-----------|
| State Machine | Enum + pure handlers | Testable, debuggable |
| Error Handling | Result types + fail-closed | Explicit error paths |
| DI | Factory functions | No framework, easy mocks |
| Circuit Breaker | Custom class | Bedrock resilience |
| Logging | Powertools + correlation ID | Full audit trail |
| Service Layer | Injected clients | Testable integrations |
| Slack | Interactive webhook + API Gateway callback | Approve/deny directly in Slack |
| Delayed Processing | Event + 30min scheduled fallback | Reliability |
| Idempotency | Powertools + DynamoDB | Duplicate prevention |

## Architecture Summary

### System Overview

Two Lambda functions: the main **approver** triggered by EventBridge rules for lease processing, and **slack-callback** triggered by API Gateway for handling interactive Slack button clicks. Together they process lease approval requests through a score-based decision engine with AI-assisted analysis and enable operators to approve/deny directly from Slack.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              EventBridge                                     │
│  ┌─────────────────┐  ┌──────────────────────┐  ┌────────────────────────┐  │
│  │ LeaseRequested  │  │AccountCleanupSucceeded│  │ Scheduler (30min/7am) │  │
│  └────────┬────────┘  └──────────┬───────────┘  └───────────┬────────────┘  │
└───────────┼──────────────────────┼──────────────────────────┼───────────────┘
            │                      │                          │
            │                      ▼                          │
            │              ┌──────────────┐                   │
            │              │  SQS Queue   │                   │
            │              │  (30s delay) │                   │
            │              └──────┬───────┘                   │
            │                     │                           │
            ▼                     ▼                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Approver Lambda                                    │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                        State Machine                                  │   │
│  │  RECEIVED → ALLOW_LIST → ACCOUNTS → HOURS → SCORING → AI → DECISION │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐               │
│  │  Scoring   │ │  Bedrock   │ │   Slack    │ │  Config    │               │
│  │  Engine    │ │  (Nova     │ │  Webhook   │ │  (SSM +    │               │
│  │  (16 rules)│ │  Micro)    │ │(interactive)│ │  AppConfig)│               │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘               │
└─────────────────────────────────────────────────────────────────────────────┘
            │                           │                     │
            ▼                           ▼                     ▼
┌──────────────────┐         ┌──────────────────┐   ┌──────────────────┐
│    DynamoDB      │         │   EventBridge    │   │     Slack        │
│  (Lease table,   │         │  (LeaseApproved/ │   │   (Webhook +     │
│   Accounts,      │         │   LeaseDenied)   │   │    Buttons)      │
│   Idempotency)   │         └──────────────────┘   └────────┬─────────┘
└──────────────────┘                                         │
                                                             │ Button Click
                                                             ▼
                                              ┌──────────────────────────────┐
                                              │     API Gateway (HTTP)       │
                                              │   POST /slack/interactions   │
                                              └──────────────┬───────────────┘
                                                             │
                                                             ▼
                                              ┌──────────────────────────────┐
                                              │   Slack Callback Lambda      │
                                              │  - Verify signing secret     │
                                              │  - Emit LeaseApproved/Denied │
                                              │  - Update Slack message      │
                                              └──────────────────────────────┘
```

### Key Decisions Summary

| Area | Decision |
|------|----------|
| **Architecture** | Two Lambdas: approver (event processing) + slack-callback (button handling) |
| **Region** | us-west-2 (co-located with ISB) |
| **AI Model** | Amazon Nova Micro (~$0.05-$0.47/month) |
| **Slack** | Interactive buttons via webhook + API Gateway callback |
| **Delayed Processing** | Event-driven + 30min scheduled fallback |
| **Queue Processing** | FIFO via DynamoDB `queuedAt` timestamp |
| **Idempotency** | Powertools with DynamoDB backend |
| **Error Handling** | Fail-closed to manual review |
| **Testing** | 100% scoring rules, 80%+ services |

### CDK Resources Created

| Resource | Type | Purpose |
|----------|------|---------|
| `ApproverFunction` | Lambda | Main processing function |
| `SlackCallbackFunction` | Lambda | Handle Slack button interactions |
| `SlackCallbackApi` | API Gateway (HTTP API) | Endpoint for Slack callbacks |
| `LeaseRequestedRule` | EventBridge Rule | Trigger on LeaseRequested |
| `CleanupSucceededRule` | EventBridge Rule | Trigger on AccountCleanupSucceeded |
| `QueueCheckSchedule` | EventBridge Scheduler | Every 30 minutes |
| `BusinessHoursSchedule` | EventBridge Scheduler | 7am London weekdays |
| `DelayQueue` | SQS Queue | 30s delay for queue processing |
| `IdempotencyTable` | DynamoDB Table | Duplicate event prevention |
| `ConfigParams` | SSM Parameters | Scoring weights, thresholds |
| `DomainListBucket` | S3 Bucket | UK council domain cache |
| `SlackSigningSecret` | Secrets Manager | Slack app signing secret |
| `ApproverAlarms` | CloudWatch Alarms | Error rate, DLQ depth |

### Next Steps

1. **Create Epics & Stories** - Break down into implementable units
2. **Implementation Readiness Check** - Validate PRD/Architecture alignment
3. **Sprint Planning** - Prioritize stories for development

---

*Architecture document complete. Ready for epic and story generation.*
