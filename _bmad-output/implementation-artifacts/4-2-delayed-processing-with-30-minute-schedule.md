# Story 4.2: Delayed Processing with 30-Minute Schedule

Status: done

## Story

As an **operator**,
I want **delayed requests to be processed reliably via scheduled checks**,
So that **no request is left in the queue indefinitely**.

## Acceptance Criteria

1. **AC1: Scheduled queue check**
   - Given the 30-minute schedule triggers
   - When EventBridge Scheduler fires every 30 minutes
   - Then the Lambda is invoked with `source: "scheduled.queue-check"`
   - And it checks the delay queue for processable requests
   - And processes any that are now within business hours and have accounts available

2. **AC2: AccountCleanupSucceeded trigger**
   - Given an `AccountCleanupSucceeded` event is received
   - When an account becomes available
   - Then the Lambda is invoked with the event
   - And it checks if any requests are waiting in the queue
   - And if yes, processes the oldest request (FIFO)

3. **AC3: Queue processing conditions**
   - Given a request is in the delay queue
   - When processing the queue
   - Then check if current time is within business hours
   - And check if accounts are available (query ISB SandboxAccount table)
   - And if both conditions met → process the request
   - And if not → leave in queue for next trigger

4. **AC4: FIFO processing order**
   - Given queue processing order
   - When multiple requests are waiting
   - Then process in FIFO order (oldest first)
   - And log queue depth before and after processing

5. **AC5: SQS message visibility**
   - Given SQS message visibility
   - When a message is picked up for processing
   - Then set visibility timeout to 5 minutes (longer than max processing time)
   - And delete message only after successful processing
   - And if processing fails, message returns to queue after visibility timeout

## Tasks / Subtasks

- [x] Task 1: Handle scheduled queue check event (AC: 1)
  - [x] Add event type detection for `source: "scheduled.queue-check"`
  - [x] Create `handleScheduledQueueCheck()` function in handler
  - [x] Log scheduled invocation with timestamp
  - [x] Exit early if outside business hours

- [x] Task 2: Handle AccountCleanupSucceeded event (AC: 2)
  - [x] Add event type detection for `AccountCleanupSucceeded`
  - [x] Create `handleAccountCleanupSucceeded()` function in handler
  - [x] Log account cleanup event with accountId
  - [x] Trigger queue check after cleanup via `processDelayQueue()`

- [x] Task 3: Implement SQS queue message retrieval (AC: 3, 4, 5)
  - [x] Add `receiveMessages()` to SQS service
  - [x] Configure visibility timeout to 5 minutes
  - [x] Implement FIFO ordering by `SentTimestamp` or message attribute
  - [x] Add `deleteMessage()` after successful processing

- [x] Task 4: Check account availability (AC: 3)
  - [x] Add `getAvailableAccountsCount()` to DynamoDB service
  - [x] Query ISB SandboxAccount table for available accounts
  - [x] Handle query failures gracefully (pessimistic: assume no accounts)
  - [x] Return count of available accounts

- [x] Task 5: Process delayed request from queue (AC: 1, 2, 3)
  - [x] Retrieve oldest message from queue
  - [x] Check business hours (already implemented in 4.1)
  - [x] Check account availability
  - [x] If conditions met, extract original event and process through scoring
  - [x] Delete message only after successful approval/escalation
  - [x] Log queue depth before/after

- [x] Task 6: Write tests for queue processing
  - [x] Test scheduled invocation path
  - [x] Test cleanup succeeded invocation path
  - [x] Test queue message retrieval and deletion
  - [x] Test business hours check in queue processing
  - [x] Test account availability check
  - [x] Test FIFO ordering

## Dev Notes

### Event Detection

The handler must distinguish between three event types:

```typescript
// 1. Scheduled queue check
if (event.source === 'scheduled.queue-check') {
  return handleScheduledQueueCheck(event, context);
}

// 2. Account cleanup succeeded
if (event['detail-type'] === 'AccountCleanupSucceeded') {
  return handleAccountCleanupSucceeded(event, context);
}

// 3. Lease requested (existing flow)
// Continues to main LeaseRequested processing...
```

### Existing Infrastructure (from Story 1.2 CDK)

- **QueueCheckSchedule**: EventBridge Scheduler firing every 30 minutes
  - Input: `{ source: 'scheduled.queue-check', 'detail-type': 'ScheduledQueueCheck', detail: {} }`
- **CleanupSucceededRule**: EventBridge rule for `AccountCleanupSucceeded` events
- **DelayQueue**: SQS queue with 5-minute visibility timeout, 30s delivery delay

### SQS Message Format (from Story 4.1)

Messages sent to delay queue have this structure:
```typescript
interface DelayedLeaseMessage {
  leaseId: { userEmail: string; uuid: string };
  originalEvent: unknown;  // Full LeaseRequested event
  receivedAt: string;      // ISO timestamp
  processAfter: string;    // ISO timestamp (next business hours)
  reason: string;
}
```

### ISB SandboxAccount Table

Query for available accounts:
- Table: `ISB-SandboxAccounts` (from `ISB_ACCOUNTS_TABLE_NAME` env var)
- Filter: `status = 'Available'`
- Returns: List of available sandbox accounts

### Business Hours Check

Reuse `createBusinessHoursChecker()` from `src/lib/business-hours.ts` (Story 4.1).

### Processing Flow

```
Scheduled/Cleanup Trigger
    ↓
Check business hours → Outside hours? → Exit (wait for next trigger)
    ↓
Check account availability → No accounts? → Exit (wait for next trigger)
    ↓
Receive oldest message from queue
    ↓
Process through scoring (existing flow)
    ↓
On success: Delete message
On failure: Leave in queue (visibility timeout returns it)
```

### Error Handling

- Queue retrieval failure: Log error, exit gracefully (next trigger will retry)
- Account check failure: Pessimistic assumption (no accounts available)
- Processing failure: Message returns to queue after visibility timeout
- After 3 failures: Message goes to DLQ

### Existing Files to Modify

- `src/handler.ts` - Add event type detection and queue processing
- `src/services/sqs.ts` - Add `receiveMessages()` and `deleteMessage()`
- `src/services/dynamodb.ts` - Add `getAvailableAccountsCount()`
- `test/handler.test.ts` - Add queue processing tests
- `test/services/sqs.test.ts` - Add receive/delete tests
- `test/services/dynamodb.test.ts` - Add account query tests

### Project Structure Notes

All existing patterns from Story 4.1 apply:
- Factory functions for service creation
- Dependency injection for testability
- Structured logging with correlation context
- Fail-closed error handling

### References

- [Source: epics.md#Story-4.2] - Full acceptance criteria
- [Source: architecture.md#Lambda-Function-Boundaries] - Multi-trigger architecture
- [Source: cdk/lib/approver-stack.ts] - CDK infrastructure for scheduler and rules
- [Source: src/services/sqs.ts] - Existing SQS service (Story 4.1)
- [Source: src/lib/business-hours.ts] - Business hours utilities (Story 4.1)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None required - all tests passing.

### Completion Notes List

- Extended SQS service with `receiveMessages()`, `deleteMessage()`, `getQueueDepth()` methods
- Extended DynamoDB service with `getAvailableAccountsCount()` for account availability checking
- Implemented FIFO ordering by sorting messages by `SentTimestamp` (oldest first)
- Added event routing in handler for `scheduled.queue-check` and `AccountCleanupSucceeded` events
- Implemented `processDelayQueue()` for queue check logic with business hours and account availability checks
- Added pessimistic fallback - returns 0 accounts on query failure
- Queue depth logged before and after processing (AC4)
- Visibility timeout set to 5 minutes (300 seconds) per AC5
- Messages deleted only after successful processing per AC5
- All 635 tests passing

### File List

**Modified files:**
- `src/handler.ts` - Added event routing for queue check and cleanup events, queue processing logic
- `src/services/sqs.ts` - Added `receiveMessages()`, `deleteMessage()`, `getQueueDepth()` methods
- `src/services/dynamodb.ts` - Added `getAvailableAccountsCount()` method and `AvailableAccountsResult` interface
- `test/handler.test.ts` - Added tests for scheduled queue check and updated mocks
- `test/services/sqs.test.ts` - Added 18 tests for new SQS methods
- `test/services/dynamodb.test.ts` - Added 5 tests for account availability
