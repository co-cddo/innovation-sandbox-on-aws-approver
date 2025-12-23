# Story 4.1: Business Hours Detection

Status: done

## Story

As a **lease requester submitting outside business hours**,
I want **my request to be held until the next business day**,
So that **approvals happen during working hours when operators are available**.

## Acceptance Criteria

1. **AC1: Business hours definition**
   - Given business hours are defined (FR22)
   - When checking if current time is within business hours
   - Then business hours are 7am-7pm London time (Europe/London timezone)
   - And business days are Monday-Friday
   - And UK bank holidays are excluded

2. **AC2: Timezone handling**
   - Given timezone handling is required (FR25)
   - When determining current London time
   - Then use `Europe/London` timezone (handles BST/GMT automatically)
   - And do NOT hardcode UTC offsets

3. **AC3: UK bank holidays detection**
   - Given UK bank holidays need detection
   - When checking if today is a business day
   - Then fetch UK bank holidays from `https://www.gov.uk/bank-holidays/england-and-wales.ics`
   - And parse ICS format to extract holiday dates
   - And cache the list in memory with 24 hour TTL

4. **AC4: Within business hours**
   - Given a request arrives during business hours
   - When the state machine checks timing
   - Then proceed immediately to scoring
   - And log `businessHoursCheck: "within"`

5. **AC5: Outside business hours**
   - Given a request arrives outside business hours (FR23)
   - When the state machine checks timing
   - Then calculate next business day processing window
   - And transition to DELAYED state
   - And store request in delay queue (SQS with visibility timeout)
   - And log `businessHoursCheck: "outside", nextProcessingTime: "<timestamp>"`

6. **AC6: End-of-window urgency bonus**
   - Given end-of-window urgency bonus applies (FR24)
   - When request arrives between 5pm-7pm London time on a business day
   - Then apply -2 bonus (rule #10)
   - And log `endOfWindowBonus: true`

## Tasks / Subtasks

- [x] Task 1: Create business hours utilities
  - [x] Create `src/lib/business-hours.ts` module
  - [x] Implement `isWithinBusinessHours(date: Date): boolean`
  - [x] Implement `getNextBusinessHoursStart(date: Date): Date`
  - [x] Implement `isBusinessDay(date: Date): boolean`
  - [x] Handle Europe/London timezone with DST transitions
  - [x] Write unit tests for all timezone edge cases

- [x] Task 2: Implement UK bank holidays service
  - [x] Create `src/services/bank-holidays.ts`
  - [x] Fetch ICS from gov.uk endpoint
  - [x] Parse ICS format (VEVENT with DTSTART)
  - [x] Cache holidays with 24-hour TTL
  - [x] Handle fetch failures gracefully (use empty list)
  - [x] Write unit tests with mock ICS data

- [x] Task 3: Integrate business hours into state machine
  - [x] Add TIMING_CHECK state to state machine
  - [x] Add DELAYED state for out-of-hours requests
  - [x] Wire business hours check before scoring
  - [x] Update orchestrator to handle delayed path

- [x] Task 4: Implement end-of-window bonus (Rule #10)
  - [x] Update scoring engine with rule #10 logic
  - [x] Check if time is between 5pm-7pm London time
  - [x] Apply -2 bonus when in end-of-window
  - [x] Write tests for end-of-window detection

- [x] Task 5: Update handler for delayed requests
  - [x] When outside business hours, send to SQS delay queue
  - [x] Log business hours check result
  - [x] Handle SQS send failures (fail-closed to escalation)

## Dev Notes

### Timezone Handling

Use JavaScript's native Intl API for timezone-safe date handling:

```typescript
const londonFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour: 'numeric',
  minute: 'numeric',
  hour12: false,
});

// Get current hour in London time
const londonTime = new Date().toLocaleString('en-GB', {
  timeZone: 'Europe/London'
});
```

### ICS Format Parsing

Bank holidays ICS example:
```
BEGIN:VEVENT
DTSTART;VALUE=DATE:20251225
SUMMARY:Christmas Day
END:VEVENT
```

Parse with regex or simple line-by-line parser.

### Existing Infrastructure

- SQS delay queue already created in CDK (Story 1.2)
- Environment variables: `BUSINESS_HOURS_START`, `BUSINESS_HOURS_END`, `BUSINESS_HOURS_TZ`
- State machine already has DELAYED placeholder

### Dependencies

- Rule #10 (end-of-window) must integrate with existing scoring engine
- SQS delay queue from CDK stack

## References

- [Source: epics.md#Story-4.1] - Full acceptance criteria
- [Source: architecture.md#Timing] - Business hours architecture
- [Source: prd.md#FR22-FR25] - Timing requirements

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

### Completion Notes List

- Business hours: 7am-7pm London time (Europe/London timezone), weekdays only
- UK bank holidays fetched from gov.uk ICS endpoint with 24-hour caching
- DST handled automatically via JavaScript Intl API
- End-of-window bonus (5-7pm London) integrated into scoring engine
- TIMING_CHECK and DELAYED states added to state machine
- SQS delay queue integration for out-of-hours requests
- Fail-closed behavior: escalates to manual review if delay queue unavailable

### File List

**New files:**
- src/lib/business-hours.ts - Timezone-aware business hours detection
- src/services/bank-holidays.ts - UK bank holiday service with ICS parsing
- src/services/sqs.ts - SQS delay queue service
- test/lib/business-hours.test.ts - 30 tests for business hours utilities
- test/services/bank-holidays.test.ts - 14 tests for bank holiday service
- test/services/sqs.test.ts - 8 tests for SQS service

**Modified files:**
- src/state-machine/types.ts - Added TIMING_CHECK, DELAYED states and timing context fields
- src/state-machine/handlers.ts - Added TIMING_CHECK and DELAYED handlers
- src/scoring/types.ts - Added isEndOfWindow to ScoringContext
- src/scoring/rules.ts - Updated end_of_window rule to use pre-calculated context
- src/handler.ts - Integrated business hours check and SQS delay queue
- test/scoring/rules.test.ts - Added 3 tests for pre-calculated isEndOfWindow
- test/state-machine/types.test.ts - Updated for 11 states and 5 terminal states
- test/state-machine/handlers.test.ts - Added tests for TIMING_CHECK and DELAYED
- test/handler.test.ts - Added SQS mock and bank holiday service setup
