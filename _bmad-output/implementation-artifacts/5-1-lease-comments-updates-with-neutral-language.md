# Story 5.1: Lease Comments Updates with Neutral Language

Status: done

## Story

As a **lease requester**,
I want **clear status messages in my lease comments**,
so that **I understand what's happening with my request without needing to contact support**.

## Acceptance Criteria

1. **AC1: Update comments on decision (FR33)**
   - Given a lease decision is made
   - When updating the lease in DynamoDB
   - Then update the `comments` field with status message

2. **AC2: Auto-approved message format**
   - Given request is auto-approved
   - When updating comments
   - Then set message:
   ```
   Your lease request has been automatically approved.
   Score: {score} (threshold: 20)
   Reference: ISB-{YYYY}-{NNNN}
   ```

3. **AC3: Allow-list approved message format**
   - Given request is approved via allow-list
   - When updating comments
   - Then set message:
   ```
   Your lease request has been automatically approved (ALLOW-LIST-OVERRIDE).
   Score: {score} (for reference only)
   Reference: ISB-{YYYY}-{NNNN}
   ```

4. **AC4: Escalated message format with neutral language (FR34)**
   - Given request requires manual approval (escalated)
   - When updating comments
   - Then set message using neutral language:
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

5. **AC5: Delayed message format (outside business hours)**
   - Given request is delayed (outside business hours)
   - When updating comments
   - Then set message:
   ```
   Your lease request has been received. As it was submitted outside of our
   processing hours (7am-7pm London time, weekdays), it will be processed
   during the next available window.
   Reference: ISB-{YYYY}-{NNNN}
   ```

6. **AC6: Queued message format (no accounts available)**
   - Given request is queued (no accounts available)
   - When updating comments
   - Then set message:
   ```
   Your lease request has been received. All sandbox accounts are currently in use.
   Your request has been queued and will be processed when an account becomes available.
   Queue position: {position}
   Reference: ISB-{YYYY}-{NNNN}
   ```

7. **AC7: Expired message format**
   - Given request has expired after 5 business days
   - When updating comments
   - Then set message:
   ```
   Your lease request has expired after 5 business days in queue.
   This may have occurred because no sandbox accounts were available.
   Please submit a new request if you still need access.
   Reference: ISB-{YYYY}-{NNNN}
   ```

8. **AC8: Reference number format (FR35)**
   - Given reference number is required
   - When generating reference number
   - Then format is `ISB-{YYYY}-{NNNN}` where:
     - YYYY = current year
     - NNNN = derived from leaseId (deterministic)

## Tasks / Subtasks

- [x] Task 1: Add DynamoDB updateLeaseComments method (AC: 1)
  - [x] Add `updateLeaseComments(leaseId, comments)` to DynamoDB service interface
  - [x] Implement using UpdateCommand with `SET comments = :comments`
  - [x] Return success/failure result type
  - [x] Add tests for successful update
  - [x] Add tests for error handling (pessimistic - log and continue)

- [x] Task 2: Create message builder utilities (AC: 2-7)
  - [x] Create `src/lib/lease-comments.ts` module
  - [x] Add `buildAutoApprovedMessage(score, referenceNumber)` function
  - [x] Add `buildAllowListApprovedMessage(score, referenceNumber)` function
  - [x] Add `buildEscalatedMessage(score, scoreBreakdown, referenceNumber)` function
  - [x] Add `buildDelayedMessage(referenceNumber)` function
  - [x] Add `buildQueuedMessage(queuePosition, referenceNumber)` function
  - [x] Add `buildExpiredMessage(referenceNumber)` function
  - [x] Add tests for each message builder

- [x] Task 3: Integrate reference number generation (AC: 8)
  - [x] Extract `generateReferenceNumber(leaseId)` to `src/lib/reference-number.ts`
  - [x] Export function for use in lease-comments module and handler
  - [x] Ensure deterministic generation (same leaseId = same reference)
  - [x] Add dedicated tests for reference number generation

- [x] Task 4: Integrate comments update into handler (AC: 1-7)
  - [x] Call `updateLeaseComments` after auto-approval
  - [x] Call `updateLeaseComments` after allow-list approval
  - [x] Call `updateLeaseComments` after escalation
  - [x] Call `updateLeaseComments` after delay (outside business hours)
  - [N/A] Call `updateLeaseComments` after queue (no accounts) - Queue position requires Story 5.3 metrics
  - [x] Update existing `processExpiredMessage` to call `updateLeaseComments`

- [x] Task 5: Handle comment update failures gracefully
  - [x] Log warning on failure, do not fail the overall request
  - [x] Include leaseId and error details in log
  - [x] Continue with normal processing

- [x] Task 6: Write unit tests (AC: 1-8)
  - [x] Test each message format
  - [x] Test score breakdown formatting
  - [x] Test reference number consistency
  - [x] Test DynamoDB update call integration
  - [x] Test failure handling (log and continue)

## Dev Notes

### ISB DynamoDB Integration

The ISB Leases table supports updating the `comments` field. According to the ISB Integration Reference:

- **Table:** `InnovationSandbox-Data-LeaseTable*`
- **Key:** Composite key with `userEmail` (PK) and `uuid` (SK)
- **Comments field:** String field that can be updated

The lease API supports PATCH updates via direct Lambda invocation, but for simplicity we'll use DynamoDB UpdateItem directly since we already have DynamoDB access for history queries.

### Message Format Guidelines

All messages should:
- Use neutral, non-accusatory language (FR34)
- Include reference number for tracking
- Be clear about what happens next
- Not expose internal scoring implementation details to users unnecessarily

For escalated messages, the score breakdown helps users understand why additional review was needed without being judgmental (e.g., "First-time user: +5" rather than "Suspicious new user").

### Reference Number Implementation

The `generateReferenceNumber(leaseId)` function already exists in handler.ts (from Story 4.4):

```typescript
const generateReferenceNumber = (leaseId: string): string => {
  const year = new Date().getFullYear();
  const shortRef = leaseId.replace(/-/g, '').slice(-4).toUpperCase();
  const numRef = (parseInt(shortRef, 16) % 10000).toString().padStart(4, '0');
  return `ISB-${year}-${numRef}`;
};
```

This should be extracted to a shared utility for use in the lease-comments module.

### Score Breakdown Formatting

For escalated messages, format score breakdown as:
```
- First-time user: +5
- Group mailbox detected: +20
- Verified gov domain: -5
```

Only include rules with non-zero contribution, sorted by absolute impact (highest first).

### Project Structure Notes

New files:
- `src/lib/lease-comments.ts` - Message builder utilities

Modified files:
- `src/services/dynamodb.ts` - Add updateLeaseComments method
- `src/handler.ts` - Integrate comments updates at decision points

### References

- [Source: prd.md#FR33] - Update lease comments
- [Source: prd.md#FR34] - Neutral language
- [Source: prd.md#FR35] - Reference number format
- [Source: epics.md#Story-5.1] - Full acceptance criteria
- [Source: isb-integration-reference.md] - DynamoDB schema
- [Source: handler.ts:731-738] - Existing generateReferenceNumber function

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

### Completion Notes List

- Implemented `updateLeaseComments` in DynamoDB service with UpdateCommand
- Created lease-comments.ts with 6 message builders for all decision types
- Extracted `generateReferenceNumber` to shared utility (src/lib/reference-number.ts)
- Integrated comments updates into handler for: auto-approved, allow-list, escalated, delayed, expired
- Queue position message (AC6) deferred - requires queue depth tracking from Story 5.3
- Added `ruleResultsToBreakdown` converter to transform state machine RuleResult[] to ScoreBreakdown
- Added `ScoreBreakdown` type export to scoring/types.ts for message builder compatibility
- Fixed all mock DynamoDB services in handler.test.ts to include updateLeaseComments method
- All 711 tests pass, build succeeds, TypeScript strict mode passes

### File List

- `src/lib/lease-comments.ts` - Message builder utilities + ruleResultsToBreakdown (NEW)
- `src/lib/reference-number.ts` - Reference number generation utility (NEW)
- `src/scoring/types.ts` - Added ScoreBreakdown type export
- `src/services/dynamodb.ts` - Added updateLeaseComments method, UpdateCommentsResult type
- `src/handler.ts` - Added updateLeaseComments helper, integrated comments updates for all decisions, uses ruleResultsToBreakdown
- `test/lib/lease-comments.test.ts` - 29 tests for message builders + ruleResultsToBreakdown (NEW)
- `test/lib/reference-number.test.ts` - 8 tests for reference number generation (NEW)
- `test/services/dynamodb.test.ts` - 5 new tests for updateLeaseComments
- `test/handler.test.ts` - Updated all 20+ mock DynamoDB services to include updateLeaseComments
