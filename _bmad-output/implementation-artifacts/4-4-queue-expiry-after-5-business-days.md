# Story 4.4: Queue Expiry After 5 Business Days

Status: done

## Story

As an **operator**,
I want **queued requests to expire after 5 business days**,
So that **stale requests don't clog the system**.

## Acceptance Criteria

1. **AC1: Queue expiry detection**
   - Given queue expiry is required (FR43)
   - When a request has been in queue for 5 business days
   - Then it is automatically expired
   - And a `LeaseDenied` event is emitted with reason `queue_timeout`
   - And lease comments are updated with expiry message

2. **AC2: Business day calculation**
   - Given business day calculation for expiry
   - When calculating 5 business days
   - Then exclude weekends
   - And exclude UK bank holidays (from gov.uk ICS)
   - And start counting from the day after request was queued

3. **AC3: Expiry check during scheduled job**
   - Given expiry check timing
   - When the 30-minute scheduled job runs
   - Then check all queued requests for expiry
   - And expire any that have exceeded 5 business days
   - And process remaining valid requests

4. **AC4: Expiry message format**
   - Given a request is expired
   - When updating the lease
   - Then set comments to neutral, user-friendly message
   - And include expiry reason and reference number

5. **AC5: Expiry logging**
   - Given expiry logging
   - When a request expires
   - Then log structured event with action, leaseId, queuedAt, expiredAt, businessDaysInQueue, reason

## Tasks / Subtasks

- [x] Task 1: Add business days calculation utility (AC: 2)
  - [x] Create `countBusinessDays(startDate, endDate)` function
  - [x] Integrate with existing bank-holidays service
  - [x] Exclude weekends (Saturday, Sunday)
  - [x] Exclude UK bank holidays
  - [x] Return count of business days between dates

- [x] Task 2: Add expiry threshold configuration (AC: 1)
  - [x] Add `QUEUE_EXPIRY_DAYS` to environment config (default: 5)
  - [x] CDK stack already has env var support from Story 4.2
  - [x] Add to handler configuration

- [x] Task 3: Implement queue expiry check (AC: 1, 3)
  - [x] Add `isQueueExpired(queuedAt, maxBusinessDays)` function
  - [x] Filter requests exceeding 5 business days
  - [x] Return boolean indicating if expired

- [x] Task 4: Implement expiry processing (AC: 1, 4)
  - [x] Create `processExpiredMessage(message)` function
  - [x] Emit LeaseDenied event with reason `queue_timeout`
  - [x] Log expiry message (Story 5.1 will add lease comments update)
  - [x] Include reference number in format ISB-{YYYY}-{NNNN}

- [x] Task 5: Integrate expiry check into scheduled handler (AC: 3)
  - [x] Add expiry check before processing delayed queue
  - [x] Expire stale requests first
  - [x] Then process remaining valid requests
  - [x] Log summary of expired vs processed

- [x] Task 6: Write unit tests (AC: 1-5)
  - [x] Test business day calculation (weekends excluded)
  - [x] Test business day calculation (bank holidays excluded)
  - [x] Test expiry detection at exactly 5 days
  - [x] Test expiry detection at 6+ days
  - [x] Test non-expiry at 4 days
  - [x] Test expiry message emits LeaseDenied event
  - [x] Test structured logging output

- [x] Task 7: Add LeaseDenied event type (AC: 1)
  - [x] Add LeaseDeniedDetail type to types.ts
  - [x] Add emitLeaseDenied method to EventBridge service
  - [x] Add tests for emitLeaseDenied

## Dev Notes

### Business Day Calculation

Used the existing `business-hours.ts` infrastructure which already has:
- UK bank holiday fetching from gov.uk ICS
- London timezone handling
- Weekend detection

Added new functions:
- `isSameDay(date1, date2)` - Compares dates ignoring time
- `countBusinessDays(startDate, endDate, bankHolidays, timezone)` - Counts business days
- `isQueueExpired(queuedAt, maxBusinessDays, bankHolidays, currentDate, timezone)` - Checks if expired

### Expiry Message Template

```
Your lease request has expired after 5 business days in queue.
This may have occurred because no sandbox accounts were available.
Please submit a new request if you still need access.
Reference: ISB-{YYYY}-{NNNN}
```

### Integration with Scheduled Handler

The scheduled job now:
1. Fetches message from delay queue
2. Gets bank holidays
3. Checks if message has expired (5+ business days)
4. If expired: emit LeaseDenied, delete message
5. If not expired: process normally

### Structured Logging

```typescript
logger.info('Expired message processed and deleted', {
  action: 'expired',
  leaseId: request.leaseId,
  userEmail: request.userEmail,
  queuedAt: request.receivedAt,
  expiredAt: new Date().toISOString(),
  businessDaysInQueue: 5,
  reason: 'queue_timeout',
  referenceNumber: 'ISB-2025-XXXX',
});
```

### LeaseDenied Event

Emits to EventBridge with:
```typescript
{
  source: 'innovation-sandbox',
  detailType: 'LeaseDenied',
  detail: {
    leaseId: { userEmail, uuid },
    reason: 'queue_timeout',
    deniedBy: 'system',
    timestamp: new Date().toISOString(),
  }
}
```

### Project Structure Notes

Files modified:
- `src/lib/business-hours.ts` - Added business day counting functions
- `src/lib/types.ts` - Added LeaseDeniedDetail type
- `src/handler.ts` - Added expiry check and processing
- `src/services/eventbridge.ts` - Added emitLeaseDenied method
- `test/lib/business-hours.test.ts` - Added 14 new tests
- `test/services/eventbridge.test.ts` - Added 5 new tests
- `test/handler.test.ts` - Added 2 expiry tests, fixed date issues

### References

- [Source: epics.md#Story-4.4] - Story acceptance criteria
- [Source: prd.md#FR43] - Queue expiry requirement
- [Source: src/lib/business-hours.ts] - Existing business hours logic
- [Source: src/services/bank-holidays.ts] - Bank holiday fetching

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

### Completion Notes List

- Implemented `countBusinessDays` and `isQueueExpired` functions in business-hours.ts
- Added `LeaseDeniedDetail` type and `emitLeaseDenied` method
- Integrated expiry check into delay queue processing
- Added reference number generation (ISB-YYYY-NNNN format)
- Lease comments update deferred to Story 5.1 (logged message instead)
- Fixed existing handler tests that used stale 2024 dates

**Code Review Fixes (M1, L1, S2, L4):**
- Fixed M1: Added `emitLeaseDenied` to mock EventBridge service in handler tests
- Fixed L1: Removed unused `isSameDay` function and its tests (was using UTC instead of London timezone)
- Fixed S2: Added JSDoc examples for `countBusinessDays` and `isQueueExpired`
- Fixed L4: Added documentation comment about reference number collision risk for high-volume
- All 669 tests pass

### File List

- `src/lib/business-hours.ts` - Added countBusinessDays, isQueueExpired (removed unused isSameDay)
- `src/lib/types.ts` - Added LeaseDeniedDetailSchema and LeaseDeniedDetail
- `src/services/eventbridge.ts` - Added EmitLeaseDeniedParams and emitLeaseDenied
- `src/handler.ts` - Added processExpiredMessage, generateReferenceNumber, expiry check
- `test/lib/business-hours.test.ts` - Added 12 tests for new functions (removed 2 isSameDay tests)
- `test/services/eventbridge.test.ts` - Added 5 tests for emitLeaseDenied
- `test/handler.test.ts` - Added 2 expiry tests, fixed date issues, added emitLeaseDenied to mock
