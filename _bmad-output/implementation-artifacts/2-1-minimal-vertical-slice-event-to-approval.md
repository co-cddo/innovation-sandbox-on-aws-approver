# Story 2.1: Minimal Vertical Slice - Event to Approval

Status: done

## Story

As a **lease requester**,
I want **my lease request to be automatically approved when received**,
So that **I can verify the end-to-end event flow works before adding scoring logic**.

## Acceptance Criteria

1. **AC1: Event received and processed**
   - Given a `LeaseRequested` event is received from EventBridge
   - When the handler processes the event
   - Then it extracts `leaseId`, `userEmail`, and `templateId` from the event payload
   - And logs the extraction with structured JSON

2. **AC2: Approval event emitted**
   - Given the event is processed successfully
   - When the handler completes
   - Then it emits a `LeaseApproved` event to EventBridge with:
     - `source`: `innovation-sandbox`
     - `detail-type`: `LeaseApproved`
     - `detail.leaseId`: the original leaseId
     - `detail.approvedBy`: `approver-service@system`
     - `detail.score`: 0
     - `detail.reason`: `Stub approval - scoring not implemented`

3. **AC3: Schema compatibility with ISB**
   - Given the event schema must match ISB expectations
   - When ISB receives the `LeaseApproved` event
   - Then it processes it without errors (schema-compatible)

4. **AC4: Structured CloudWatch logging**
   - Given CloudWatch logging is required (FR52)
   - When the handler processes an event
   - Then structured JSON logs include:
     - `leaseId`
     - `userEmail`
     - `action`: `approved`
     - `timestamp`

## Tasks / Subtasks

- [x] Task 1: Define TypeScript types for events (AC: 1, 2, 3)
  - [x] Create `src/lib/types.ts` with ISB event schemas
  - [x] Define `LeaseRequestedEvent` type matching ISB EventBridge schema
  - [x] Define `LeaseApprovedEvent` type for emission
  - [x] Use Zod for runtime validation

- [x] Task 2: Create EventBridge service (AC: 2, 3)
  - [x] Create `src/services/eventbridge.ts`
  - [x] Implement `createEventBridgeService` factory function (DI pattern)
  - [x] Implement `emitLeaseApproved` method
  - [x] Use `PutEventsCommand` from `@aws-sdk/client-eventbridge`
  - [x] Add unit tests with mocked EventBridge client

- [x] Task 3: Update handler to process LeaseRequested events (AC: 1, 4)
  - [x] Update `src/handler.ts` to parse `LeaseRequested` detail-type
  - [x] Extract `leaseId`, `userEmail`, `templateId` from event.detail
  - [x] Validate event payload with Zod schema
  - [x] Add structured logging with AWS Powertools logger

- [x] Task 4: Wire handler to emit approval event (AC: 2, 3)
  - [x] Initialize EventBridge client in handler
  - [x] Call `emitLeaseApproved` with stub data
  - [x] Log approval action with full context

- [x] Task 5: Add integration tests (AC: 1, 2, 3, 4)
  - [x] Test full handler flow with mock EventBridge client
  - [x] Verify event emission payload matches expected schema
  - [x] Verify logging includes required fields

## Dev Notes

### Architecture Patterns & Constraints

**From Architecture Document:**
- **DI Pattern:** Factory functions for all AWS service clients (no DI framework)
- **Logging:** AWS Lambda Powertools for structured JSON logging
- **Runtime:** Node.js 20.x with TypeScript 5.3+ (strict mode)
- **Module System:** CommonJS (format: cjs in esbuild - required for Lambda)
- **Schema Validation:** Zod for runtime event/config validation
- **Error Handling:** Result types for expected failures, fail-closed philosophy

### Project Structure Notes

**New files to create:**
```
src/
├── lib/
│   └── types.ts          # Event types with Zod schemas
├── services/
│   └── eventbridge.ts    # EventBridge service factory
└── handler.ts            # Updated handler (already exists)

test/
├── services/
│   └── eventbridge.test.ts
└── handler.test.ts       # Updated tests (already exists)
```

**Existing files to modify:**
- `src/handler.ts` - Update to process LeaseRequested events and emit approvals

### ISB Event Schema Reference

**Input: LeaseRequested Event (from ISB)**
```typescript
interface LeaseRequestedEvent {
  version: string;
  id: string;
  'detail-type': 'LeaseRequested';
  source: 'innovation-sandbox';
  account: string;
  time: string;
  region: string;
  resources: string[];
  detail: {
    leaseId: {
      userEmail: string;  // Composite key part 1
      uuid: string;       // Composite key part 2
    };
    templateId: string;
    budgetAmount: number;
    leaseDurationHours: number;
    comments?: string;
    requiresManualApproval: boolean;
  };
}
```

**Output: LeaseApproved Event (to ISB)**
```typescript
interface LeaseApprovedEvent {
  Source: 'innovation-sandbox';
  DetailType: 'LeaseApproved';
  Detail: string; // JSON stringified
  EventBusName: 'default';
}

interface LeaseApprovedDetail {
  leaseId: string;        // UUID only
  userEmail: string;
  approvedBy: string;     // "approver-service@system" for auto
  score: number;          // 0 for stub
  reason: string;         // "Stub approval - scoring not implemented"
}
```

### DI Pattern Implementation

**EventBridge Service Factory:**
```typescript
// src/services/eventbridge.ts
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

export interface EventBridgeService {
  emitLeaseApproved: (params: {
    leaseId: string;
    userEmail: string;
    approvedBy: string;
    score: number;
    reason: string;
  }) => Promise<void>;
}

export const createEventBridgeService = (
  client: EventBridgeClient,
  config: { eventBusName: string; source: string }
): EventBridgeService => ({
  emitLeaseApproved: async ({ leaseId, userEmail, approvedBy, score, reason }) => {
    const command = new PutEventsCommand({
      Entries: [{
        Source: config.source,
        DetailType: 'LeaseApproved',
        Detail: JSON.stringify({ leaseId, userEmail, approvedBy, score, reason }),
        EventBusName: config.eventBusName,
      }],
    });
    await client.send(command);
  },
});
```

### Logging Pattern

**Using AWS Powertools Logger:**
```typescript
import { logger } from './lib/logger.js';

// Add correlation context
logger.appendKeys({
  leaseId: event.detail.leaseId.uuid,
  userEmail: event.detail.leaseId.userEmail,
});

// Log with structured data
logger.info('Event received', { detailType: event['detail-type'] });
logger.info('Approval emitted', {
  action: 'approved',
  score: 0,
  approvedBy: 'approver-service@system',
});
```

### Testing Strategy

**Unit Tests Required:**
1. `eventbridge.test.ts` - Test EventBridge service factory
   - Mock `EventBridgeClient.send()`
   - Verify `PutEventsCommand` payload structure
   - Test error handling (service failure)

2. `handler.test.ts` - Update existing tests
   - Mock EventBridge service
   - Test full flow: receive → process → emit
   - Verify logging includes required fields

**Coverage Targets:**
- Lines: 90%+ (current threshold)
- Branches: 100% on approval logic

### Previous Story Learnings (Epic 1)

**From Story 1.2 and 1.3:**
- CDK stack is deployed and working in us-west-2
- Lambda is named `ApproverStack-ApproverLambdaFunction*`
- EventBridge rules already configured:
  - `LeaseRequestedRule` - triggers on `LeaseRequested`
  - `CleanupSucceededRule` - triggers on `AccountCleanupSucceeded`
- Environment variables available:
  - `IDEMPOTENCY_TABLE_NAME`
  - `DELAY_QUEUE_URL`
  - `DOMAIN_LIST_BUCKET`
  - `ISB_APPCONFIG_APPLICATION_ID`
  - `ISB_APPCONFIG_CONFIG_PROFILE_ID`
  - `SLACK_WEBHOOK_SECRET_ARN`
- Lambda has IAM permissions for EventBridge PutEvents

**esbuild configuration:**
- Format: `cjs` (CommonJS) - changed from esm to fix Lambda module error
- Target: `node20`
- Platform: `node`
- External: `@aws-sdk/*`, `@aws-lambda-powertools/*`

**vitest.config.ts:**
- Coverage excludes: `src/**/*.d.ts`, `src/**/types.ts`, `src/lib/logger.ts`
- Thresholds: 90% lines, 100% branches, 90% functions, 90% statements

### Git Intelligence

**Recent commits (relevant context):**
- `fix: bundle Lambda as CommonJS` - Lambda requires CommonJS, not ESM
- `feat: add CDK infrastructure stack` - All infrastructure is deployed
- `feat: initialize project` - TypeScript, Vitest, ESLint configured

### Critical Warnings

1. **DO NOT change esbuild format** - Must be `cjs` for Lambda compatibility
2. **DO NOT modify CDK stack** - Infrastructure is complete from Epic 1
3. **MUST use DI pattern** - Factory functions for testability
4. **MUST validate events with Zod** - Runtime type safety
5. **MUST use existing logger** - `src/lib/logger.ts` already configured
6. **Event bus name is 'default'** - Use default EventBridge bus

### References

- [Source: epics.md#Story-2.1] - Acceptance criteria
- [Source: architecture.md#Event-Interface] - EventBridge integration
- [Source: architecture.md#Dependency-Injection-Pattern] - DI approach
- [Source: architecture.md#Logging-Pattern] - Structured logging
- [Source: prd.md#API-Backend-Specific-Requirements] - Event schemas

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

- No blocking issues encountered during implementation

### Completion Notes List

1. Created comprehensive Zod schemas for LeaseRequested and LeaseApproved events matching ISB EventBridge contracts
2. Implemented EventBridge service using DI pattern (factory function) for testability
3. Updated handler to validate, process, and emit approval events with structured logging
4. Added setEventBridgeService/resetEventBridgeService for test dependency injection
5. All 57 tests pass with 100% coverage on handler.ts and eventbridge.ts
6. Stub approval emits `approvedBy: "approver-service@system"` with score 0

### Code Review Fixes Applied

- HIGH-1: Added try/catch error handling for EventBridge emission with fail-closed pattern
- MEDIUM-1: Added explicit timestamp field to approval log per AC4
- MEDIUM-2: Added test for EventBridge emission failure scenario
- MEDIUM-3: Corrected Dev Notes to reflect CommonJS (cjs) module format
- MEDIUM-4: Added FailedEntryCount check to detect partial failures in EventBridge
- LOW-1: Removed unused LeaseRequest and ApprovalDecision types

### File List

Files created:
- src/services/eventbridge.ts
- test/lib/types.test.ts
- test/services/eventbridge.test.ts

Files modified:
- src/lib/types.ts (added Zod schemas for ISB events)
- src/handler.ts (added event processing, approval emission, error handling)
- test/handler.test.ts (updated tests for new functionality)

### Senior Developer Review (AI)

**Review Date:** 2025-12-22
**Reviewer:** Claude Opus 4.5
**Outcome:** APPROVED (after fixes)

**Issues Found and Fixed:**
- [x] HIGH-1: Missing error handling for EventBridge emission failure
- [x] MEDIUM-1: AC4 incomplete - timestamp not explicitly logged
- [x] MEDIUM-2: Missing test for EventBridge emission failure in handler
- [x] MEDIUM-3: Dev Notes incorrectly stated ESM instead of CJS
- [x] MEDIUM-4: PutEvents FailedEntryCount not checked
- [x] LOW-1: Unused types removed

**Final Status:** All HIGH and MEDIUM issues fixed, 57 tests passing, 100% coverage
