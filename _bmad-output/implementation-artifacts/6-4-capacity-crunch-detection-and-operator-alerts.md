# Story 6.4: Capacity Crunch Detection and Operator Alerts

Status: done

## Story

As an **operator**,
I want **to be alerted when all sandbox accounts are in active use**,
So that **I can provision additional capacity if demand is high**.

## Acceptance Criteria

1. **AC1: Capacity crunch detection (FR64)**
   - Given account pool check
   - When checking account status
   - Then detect capacity crunch if:
     - Zero accounts with `status: "Available"`
     - All accounts are `status: "Active"`
   - And this is distinct from normal cooldown (where some are Available but cooling)

2. **AC2: Capacity crunch user messaging (FR65)**
   - Given user-facing message requirements
   - When updating lease comments for capacity crunch
   - Then set message:
     ```
     Your request has been received. All sandbox sessions are currently in active use.
     Based on current demand, your request may take 36-48 hours to fulfill. Our support
     team is aware of high demand and is working to add capacity. You'll be notified
     as soon as a session becomes available.
     Reference: ISB-{YYYY}-{NNNN}
     ```

3. **AC3: Operator Slack alert for capacity crunch (FR66)**
   - Given capacity crunch detected
   - When alerting operators
   - Then send Slack notification with:
     ```json
     {
       "alert_type": "capacity_crunch",
       "active_accounts": 8,
       "available_accounts": 0,
       "pending_requests": 5,
       "soonest_available_hours": 6,
       "message": "All sandbox accounts are in active use. Soonest availability in ~6 hours. Consider provisioning additional capacity."
     }
     ```

4. **AC4: Alert throttling (Pre-mortem: Capacity Crunch Storm)**
   - Given capacity crunch persists
   - When determining whether to send alert
   - Then only send alert once per hour (avoid spam)
   - And track last alert time (for throttling)

5. **AC5: Capacity crunch resolved**
   - Given capacity crunch resolved
   - When an account becomes available
   - Then normal processing resumes
   - And no additional "resolved" alert needed

## Tasks / Subtasks

- [x] Task 1: Define CapacityStatus and CapacityCrunchAlert interfaces
  - [x] Add to capacity-crunch.ts

- [x] Task 2: Implement analyzeCapacityStatus()
  - [x] Accept AccountReadinessResult and pending request count
  - [x] Calculate isCapacityCrunch flag
  - [x] Return status with all counts

- [x] Task 3: Implement shouldSendCapacityCrunchAlert()
  - [x] Accept isCapacityCrunch, lastAlertTime, nowTimestamp
  - [x] Default throttle period: 60 minutes
  - [x] Return boolean for whether alert should be sent

- [x] Task 4: Implement buildCapacityCrunchAlert()
  - [x] Accept CapacityStatus
  - [x] Build Slack alert payload
  - [x] Include soonest availability estimate

- [x] Task 5: Implement buildCapacityCrunchMessage()
  - [x] User-facing message for 36-48 hour wait
  - [x] Avoid technical jargon

- [x] Task 6: Write comprehensive tests
  - [x] Capacity crunch detection tests
  - [x] Alert throttling tests
  - [x] Alert building tests
  - [x] Message building tests

- [x] Task 7: DynamoDB throttle state persistence
  - [x] Add lastCapacityCrunchAlert to state table (QueuePosition table)
  - [x] Update on alert sent

## Dev Notes

### Capacity Crunch vs Normal Cooldown

```
Capacity Crunch:                  Normal Cooldown:
┌─────────────────────┐          ┌─────────────────────┐
│ Active: 8           │          │ Active: 5           │
│ Available: 0        │          │ Available: 3        │
│   - Ready: 0        │          │   - Ready: 0        │
│   - Cooling: 0      │          │   - Cooling: 3      │
│ isCapacityCrunch: T │          │ isCapacityCrunch: F │
└─────────────────────┘          └─────────────────────┘
```

### Alert Throttling Logic

```typescript
shouldSendCapacityCrunchAlert(
  isCapacityCrunch: boolean,
  lastAlertTime: Date | null,
  nowTimestamp: Date,
  throttleMinutes: number = 60
): boolean
```

- If not in capacity crunch → false
- If never alerted (null) → true
- If last alert >= throttleMinutes ago → true
- Otherwise → false

### References

- [Source: _bmad-output/epics.md#Story 6.4]
- [Source: Story 6.2] - Account cooldown logic
- [Source: Story 6.3] - Queue estimation (capacity crunch detection reused)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

N/A - All tests passed first run

### Completion Notes List

1. **Core Functionality Implemented**:
   - `analyzeCapacityStatus()` - analyzes pool and returns capacity status
   - `shouldSendCapacityCrunchAlert()` - throttling logic (60 min default)
   - `buildCapacityCrunchAlert()` - Slack alert payload builder
   - `buildCapacityCrunchMessage()` - user-friendly message for 36-48hr wait

2. **AC Deviations**:
   - DynamoDB persistence for throttle state (Task 7) deferred to integration phase
   - Currently pure functions - state machine will handle persistence

3. **Design Decisions**:
   - Reuses `AccountReadinessResult` from Story 6.2
   - Pure functions with injected timestamps for testability
   - Throttle period configurable (default 60 minutes)
   - Alert includes `soonestAvailableHours` calculated from estimated ready time

4. **Test Coverage**: 16 tests covering:
   - Capacity crunch detection (all active, some cooling, some ready)
   - Soonest availability hours calculation
   - Throttle logic (never alerted, recently alerted, throttle passed)
   - Custom throttle periods
   - Boundary conditions
   - Alert building (all fields, unknown availability)
   - User message format (jargon-free)

### Completed Implementation

**Task 7: DynamoDB throttle state persistence (Completed)**
- Added `getLastCapacityCrunchAlertTime()` to queue-position.ts
- Added `updateLastCapacityCrunchAlertTime()` to queue-position.ts
- Uses fixed key `__SYSTEM__#capacityCrunchLastAlert` in QueuePosition table
- 7-day TTL for automatic cleanup

**Handler Integration (Completed)**
- Imported `capacity-crunch.ts` functions into `src/handler.ts`
- Added `notifyCapacityCrunch()` method to SlackService interface
- Integrated alert sending when `isCapacityCrunch` detected
- Throttle check before sending (once per hour)
- Updates `lastCapacityCrunchAlert` timestamp after successful alert
- Graceful error handling (doesn't fail request on alert failure)

### File List

| File | Action | Description |
|------|--------|-------------|
| `src/lib/capacity-crunch.ts` | Created | Capacity crunch detection and alerts |
| `src/services/slack.ts` | Modified | Added `notifyCapacityCrunch()` method |
| `src/services/queue-position.ts` | Created | Queue position service with throttle state persistence |
| `src/handler.ts` | Modified | Integrated capacity crunch alert logic |
| `cdk/config/environments.ts` | Modified | Added cooldown config (Story 6.2) |
| `cdk/lib/constructs/approver-lambda.ts` | Modified | Added env vars (Story 6.2) |
| `test/lib/capacity-crunch.test.ts` | Created | 16 tests |
| `test/services/slack.test.ts` | Modified | +4 tests for capacity crunch alerts |
| `test/services/queue-position.test.ts` | Created | Queue position tests including throttle state |
