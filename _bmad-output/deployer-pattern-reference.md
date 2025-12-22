# Innovation Sandbox Deployer - Pattern Reference

This document describes the architecture patterns used by the ISB Deployer Lambda that should be adopted for the Approver service.

## Overview

The Deployer is an EventBridge-triggered Lambda that:
1. Listens for `LeaseApproved` events
2. Looks up lease details from DynamoDB
3. Fetches CloudFormation templates from GitHub
4. Deploys stacks to target sub-accounts
5. Emits success/failure events

**Repository:** `../innovation-sandbox-on-aws-deployer`
**Pattern:** Event-driven Lambda with modular architecture

## Project Structure (to adopt)

```
innovation-sandbox-on-aws-approver/
├── src/
│   ├── handler.ts              # Lambda entry point
│   ├── modules/
│   │   ├── config.ts           # Configuration management
│   │   ├── logger.ts           # Structured logging
│   │   ├── event-parser.ts     # Parse LeaseRequested events
│   │   ├── event-emitter.ts    # Emit approval/denial events
│   │   ├── lease-lookup.ts     # DynamoDB lease queries
│   │   ├── lease-updater.ts    # Update lease comments
│   │   ├── scoring-engine.ts   # Score calculation logic
│   │   ├── scoring-rules.ts    # Individual scoring rules
│   │   ├── bedrock-analyzer.ts # AI email/domain analysis
│   │   ├── time-checker.ts     # UK business hours logic
│   │   ├── account-checker.ts  # Check available accounts
│   │   ├── slack-notifier.ts   # Slack webhook integration
│   │   └── queue-manager.ts    # Delayed processing queue
│   └── types/
│       └── index.ts            # TypeScript type definitions
├── infrastructure/
│   ├── template.yaml           # CloudFormation/CDK template
│   └── parameters/
│       ├── dev.json
│       ├── staging.json
│       └── prod.json
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .eslintrc.cjs
├── .prettierrc
└── README.md
```

## Configuration Pattern

```typescript
// src/modules/config.ts
import type { Config, LogLevel } from '../types/index.js';

const DEFAULTS = {
  AWS_REGION: 'eu-west-2',                    // London region
  EVENT_SOURCE: 'innovation-sandbox',          // Match ISB
  LOG_LEVEL: 'INFO' as LogLevel,
  AUTO_APPROVE_THRESHOLD: 20,                  // Score below this = auto-approve
  BUSINESS_HOURS_START: 7,                     // 7 AM London
  BUSINESS_HOURS_END: 19,                      // 7 PM London
  SLACK_WEBHOOK_ENABLED: true,
} as const;

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

function getOptionalEnv(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

export function loadConfig(): Config {
  return {
    leaseTableName: getRequiredEnv('LEASE_TABLE_NAME'),
    sandboxAccountTableName: getRequiredEnv('SANDBOX_ACCOUNT_TABLE_NAME'),
    slackWebhookUrl: getOptionalEnv('SLACK_WEBHOOK_URL', ''),
    awsRegion: getOptionalEnv('AWS_REGION', DEFAULTS.AWS_REGION),
    eventSource: getOptionalEnv('EVENT_SOURCE', DEFAULTS.EVENT_SOURCE),
    logLevel: getOptionalEnv('LOG_LEVEL', DEFAULTS.LOG_LEVEL) as LogLevel,
    autoApproveThreshold: parseInt(getOptionalEnv('AUTO_APPROVE_THRESHOLD', String(DEFAULTS.AUTO_APPROVE_THRESHOLD))),
    allowList: getOptionalEnv('ALLOW_LIST', '').split(',').map(e => e.trim().toLowerCase()),
    bedrockModelId: getOptionalEnv('BEDROCK_MODEL_ID', 'anthropic.claude-3-haiku-20240307-v1:0'),
  };
}

// Singleton pattern
let configInstance: Config | null = null;

export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

export function resetConfig(): void {
  configInstance = null;
}
```

## Logger Pattern

```typescript
// src/modules/logger.ts
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LOG_LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

export class Logger {
  private level: LogLevel;
  private context: Record<string, unknown> = {};

  constructor(level: LogLevel = 'INFO') {
    this.level = level;
  }

  setContext(context: Record<string, unknown>): void {
    this.context = { ...this.context, ...context };
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.context,
      ...data,
    };

    console.log(JSON.stringify(logEntry));
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log('DEBUG', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log('INFO', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log('WARN', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log('ERROR', message, data);
  }
}
```

## Event Parser Pattern

```typescript
// src/modules/event-parser.ts
export interface ParsedLeaseRequest {
  userEmail: string;
  leaseUuid: string;
  comments?: string;
  requiresManualApproval: boolean;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseLeaseRequestEvent(event: unknown): ParsedLeaseRequest {
  if (!isObject(event)) {
    throw new Error('Event must be an object');
  }

  if (!('detail' in event) || !isObject(event.detail)) {
    throw new Error('Event must contain a detail object');
  }

  const detail = event.detail;

  // LeaseRequested has nested leaseId object
  if (!('leaseId' in detail) || !isObject(detail.leaseId)) {
    throw new Error('Event detail must contain a leaseId object');
  }

  const leaseId = detail.leaseId;

  if (!('userEmail' in leaseId) || !isNonEmptyString(leaseId.userEmail)) {
    throw new Error('leaseId must contain a non-empty userEmail');
  }

  if (!('uuid' in leaseId) || !isNonEmptyString(leaseId.uuid)) {
    throw new Error('leaseId must contain a non-empty uuid');
  }

  return {
    userEmail: leaseId.userEmail,
    leaseUuid: leaseId.uuid,
    comments: 'comments' in detail && isNonEmptyString(detail.comments)
      ? detail.comments
      : undefined,
    requiresManualApproval: 'requiresManualApproval' in detail
      ? Boolean(detail.requiresManualApproval)
      : false,
  };
}
```

## Event Emitter Pattern

```typescript
// src/modules/event-emitter.ts
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { getConfig } from './config.js';

let eventBridgeClient: EventBridgeClient | null = null;

function getEventBridgeClient(): EventBridgeClient {
  if (!eventBridgeClient) {
    const config = getConfig();
    eventBridgeClient = new EventBridgeClient({ region: config.awsRegion });
  }
  return eventBridgeClient;
}

export async function emitEvent(detailType: string, detail: object): Promise<void> {
  const config = getConfig();
  const client = getEventBridgeClient();

  const command = new PutEventsCommand({
    Entries: [
      {
        Source: config.eventSource,  // 'innovation-sandbox'
        DetailType: detailType,
        Detail: JSON.stringify(detail),
      },
    ],
  });

  const response = await client.send(command);

  if (response.FailedEntryCount && response.FailedEntryCount > 0) {
    const errorMessage = response.Entries?.[0]?.ErrorMessage || 'Unknown error';
    throw new Error(`Failed to emit event: ${errorMessage}`);
  }
}

export async function emitLeaseApproved(
  leaseUuid: string,
  userEmail: string,
  approvedBy: string = 'AUTO_APPROVED'
): Promise<void> {
  await emitEvent('LeaseApproved', {
    leaseId: leaseUuid,
    userEmail,
    approvedBy,
  });
}

export async function emitLeaseDenied(
  leaseUuid: string,
  userEmail: string,
  deniedBy: string
): Promise<void> {
  await emitEvent('LeaseDenied', {
    leaseId: leaseUuid,
    userEmail,
    deniedBy,
  });
}
```

## DynamoDB Client Pattern

```typescript
// src/modules/lease-lookup.ts
import { DynamoDBClient, GetItemCommand, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall, marshall } from '@aws-sdk/util-dynamodb';
import { getConfig } from './config.js';

let dynamoDBClient: DynamoDBClient | null = null;

function getDynamoDBClient(): DynamoDBClient {
  if (!dynamoDBClient) {
    const config = getConfig();
    dynamoDBClient = new DynamoDBClient({ region: config.awsRegion });
  }
  return dynamoDBClient;
}

export async function getLease(userEmail: string, leaseUuid: string): Promise<Lease> {
  const config = getConfig();
  const client = getDynamoDBClient();

  const command = new GetItemCommand({
    TableName: config.leaseTableName,
    Key: {
      userEmail: { S: userEmail },
      uuid: { S: leaseUuid },
    },
  });

  const response = await client.send(command);

  if (!response.Item) {
    throw new Error(`Lease not found: ${leaseUuid} for user ${userEmail}`);
  }

  return unmarshall(response.Item) as Lease;
}

export async function getUserLeaseHistory(userEmail: string, daysBack: number = 30): Promise<Lease[]> {
  const config = getConfig();
  const client = getDynamoDBClient();

  const command = new QueryCommand({
    TableName: config.leaseTableName,
    KeyConditionExpression: 'userEmail = :email',
    ExpressionAttributeValues: {
      ':email': { S: userEmail },
    },
  });

  const response = await client.send(command);
  const items = response.Items?.map(item => unmarshall(item) as Lease) || [];

  // Filter for recent leases
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  return items.filter(lease => {
    const created = new Date(lease.created);
    return created >= cutoff;
  });
}

export async function updateLeaseComments(
  userEmail: string,
  leaseUuid: string,
  comments: string
): Promise<void> {
  const config = getConfig();
  const client = getDynamoDBClient();

  const command = new UpdateItemCommand({
    TableName: config.leaseTableName,
    Key: {
      userEmail: { S: userEmail },
      uuid: { S: leaseUuid },
    },
    UpdateExpression: 'SET comments = :comments, lastEdit = :lastEdit',
    ExpressionAttributeValues: {
      ':comments': { S: comments },
      ':lastEdit': { S: new Date().toISOString() },
    },
  });

  await client.send(command);
}
```

## Testing Pattern (Vitest)

```typescript
// src/modules/event-parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseLeaseRequestEvent } from './event-parser.js';

describe('parseLeaseRequestEvent', () => {
  it('should parse a valid LeaseRequested event', () => {
    const event = {
      version: '0',
      id: 'event-123',
      'detail-type': 'LeaseRequested',
      source: 'innovation-sandbox',
      detail: {
        leaseId: {
          userEmail: 'user@example.gov.uk',
          uuid: 'f2d3eb78-907a-4c20-8127-7ce45758836d',
        },
        comments: 'Need sandbox for testing',
        requiresManualApproval: true,
      },
    };

    const result = parseLeaseRequestEvent(event);

    expect(result).toEqual({
      userEmail: 'user@example.gov.uk',
      leaseUuid: 'f2d3eb78-907a-4c20-8127-7ce45758836d',
      comments: 'Need sandbox for testing',
      requiresManualApproval: true,
    });
  });

  it('should throw if event is not an object', () => {
    expect(() => parseLeaseRequestEvent(null)).toThrow('Event must be an object');
  });

  it('should throw if detail is missing', () => {
    expect(() => parseLeaseRequestEvent({})).toThrow('Event must contain a detail object');
  });
});
```

## Build Configuration

### package.json

```json
{
  "name": "innovation-sandbox-on-aws-approver",
  "version": "1.0.0",
  "description": "Score-based approval system for Innovation Sandbox leases",
  "type": "module",
  "main": "dist/handler.js",
  "scripts": {
    "build": "esbuild src/handler.ts --bundle --platform=node --target=node20 --outdir=dist --format=cjs --external:@aws-sdk/*",
    "build:prod": "npm run build -- --minify",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src --ext .ts",
    "lint:fix": "eslint src --ext .ts --fix",
    "format": "prettier --write \"src/**/*.ts\"",
    "format:check": "prettier --check \"src/**/*.ts\"",
    "typecheck": "tsc --noEmit",
    "check": "npm run typecheck && npm run lint && npm run test"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "@typescript-eslint/eslint-plugin": "^6.13.0",
    "@typescript-eslint/parser": "^6.13.0",
    "@vitest/coverage-v8": "^4.0.15",
    "esbuild": "^0.27.1",
    "eslint": "^8.55.0",
    "eslint-config-prettier": "^9.1.0",
    "prettier": "^3.1.0",
    "typescript": "^5.3.2",
    "vitest": "^4.0.15"
  },
  "dependencies": {
    "@aws-sdk/client-bedrock-runtime": "^3.460.0",
    "@aws-sdk/client-dynamodb": "^3.460.0",
    "@aws-sdk/client-eventbridge": "^3.460.0",
    "@aws-sdk/util-dynamodb": "^3.460.0"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/'],
    },
  },
});
```

## Key Differences for Approver

| Deployer | Approver |
|----------|----------|
| Listens for `LeaseApproved` | Listens for `LeaseRequested` |
| Deploys CloudFormation | Emits `LeaseApproved`/`LeaseDenied` |
| Fetches from GitHub | Queries Bedrock AI |
| Cross-account STS | Slack webhook |
| Stateless | May need SQS for delayed processing |

---

*Generated: 2025-12-22*
*Source: Innovation Sandbox Deployer*
