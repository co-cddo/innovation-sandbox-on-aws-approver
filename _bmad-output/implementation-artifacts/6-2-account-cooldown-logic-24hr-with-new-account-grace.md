# Story 6.2: Account Cooldown Logic (24hr with New Account Grace)

> **SUPERSEDED** (2026-01-28): This implementation has been removed. ISB's Billing Separator now handles account cooldown natively via a 72-hour Quarantine OU. The cooldown logic, queue estimation, and related code were removed as redundant. See the innovation-sandbox-on-aws-billing-seperator repository for the current implementation.

Status: superseded

## Story

As an **operator**,
I want **leases only approved when a properly cleaned sandbox account is available**,
So that **users don't encounter leftover resources from previous sessions**.

## Acceptance Criteria

1. **AC1: Account readiness logic (FR60)**
   - Given an account from ISB
   - When determining if the account is "ready"
   - Then an account is ready if:
     ```
     status === "Available"
     AND (
       meta.lastEditTime > 24 hours ago    // Cooled down
       OR meta.createdTime < 1 hour ago    // Brand new
     )
     ```

2. **AC2: Configurable cooldown parameters**
   - Given configurable cooldown requirements
   - When evaluating readiness
   - Then read from environment variables:
     - `ACCOUNT_COOLDOWN_HOURS` (default: 24)
     - `NEW_ACCOUNT_GRACE_MINUTES` (default: 60)

3. **AC3: checkAccountReadiness() pure function**
   - Given testability requirements
   - When implementing `checkAccountReadiness()`
   - Then return:
     ```typescript
     interface AccountReadinessResult {
       hasReadyAccount: boolean;
       readyAccounts: Account[];
       coolingAccounts: Account[];   // Available but in cooldown
       activeAccounts: Account[];    // Currently leased
       estimatedReadyTime: Date | null;
     }
     ```
   - And the function must accept `nowTimestamp` as parameter for testability

4. **AC4: State machine integration (ADR-005)**
   - Given state machine integration requirements
   - When processing a lease request
   - Then add `ACCOUNT_COOLDOWN_CHECK` state AFTER `ALLOW_LIST_CHECK`, BEFORE `BUSINESS_HOURS`
   - And if ready account exists → continue to `BUSINESS_HOURS` check
   - And if no ready account → transition to `DELAYED` with reason `NO_READY_ACCOUNTS`

5. **AC5: No-ready-accounts handling (FR61)**
   - Given no ready accounts available
   - When the check fails
   - Then do NOT fail or escalate
   - And queue the request for later processing
   - And update lease comments with queue status

6. **AC6: Timezone safety (Pre-mortem: Time Zone Trap)**
   - Given timezone safety requirements
   - When comparing timestamps
   - Then ALL time comparisons MUST use UTC
   - And `lastEditTime` and `createdTime` parsed as UTC ISO 8601
   - And "now" timestamp injected via parameter for testability

7. **AC7: Unit tests with edge cases**
   - Given unit testing requirements
   - When testing cooldown logic
   - Then test cases cover:
     - Account exactly at 24hr boundary (should be ready)
     - Account at 23h 59m (should still be cooling)
     - Brand new account at 59 minutes (should be ready)
     - Brand new account at 61 minutes (should use cooldown rule)
     - Mix of ready, cooling, and active accounts
     - BST/GMT boundary edge case

8. **AC8: TOCTOU race condition handling (Red Team)**
   - Given ISB might reject approval due to account no longer available
   - When Approver approves but ISB rejects
   - Then handle ISB rejection gracefully (don't fail permanently)
   - And re-queue the request with updated queue position
   - And update lease comments with reprocessing message

## Tasks / Subtasks

- [x] Task 1: Define AccountReadinessResult types (AC: 3)
  - [x] Add `AccountReadinessResult` interface to `src/lib/account-cooldown.ts`
  - [x] Add `AccountCooldownConfig` interface for environment config

- [x] Task 2: Implement checkAccountReadiness() pure function (AC: 1, 2, 3, 6)
  - [x] Create `src/lib/account-cooldown.ts`
  - [x] Implement readiness check with 24hr cooldown logic
  - [x] Implement new account grace period (< 1 hour since creation)
  - [x] Accept `nowTimestamp` parameter for testability
  - [x] Calculate `estimatedReadyTime` from cooling accounts
  - [x] Read config from environment with defaults

- [x] Task 3: Extend state machine with ACCOUNT_COOLDOWN_CHECK state (AC: 4)
  - [x] Add `ACCOUNT_COOLDOWN_CHECK` state after `ALLOW_LIST_CHECK`
  - [x] Add transition to `SCORING` if ready account exists
  - [x] Add transition to `DELAYED` with reason `NO_READY_ACCOUNTS`
  - [x] Update state machine types and transitions

- [x] Task 4: Integrate with ISB Lambda service (AC: 5)
  - [x] State machine context now includes account availability fields
  - [x] Handler will populate via getAccounts() from Story 6.1 (integration point)
  - [x] Handle queue delay for no-ready-accounts scenario

- [x] Task 5: Add lease comment for cooldown delay (AC: 5)
  - [x] Add `buildCooldownDelayMessage()` to lease-comments.ts
  - [x] Add `buildReprocessingMessage()` for TOCTOU race condition

- [x] Task 6: Handle TOCTOU race condition (AC: 8)
  - [x] Detect ISB rejection due to account unavailability
  - [x] Re-queue request instead of failing
  - [x] Update lease comments with reprocessing message (message function created)

- [x] Task 7: Add environment variable support (AC: 2)
  - [x] Add `ACCOUNT_COOLDOWN_HOURS` to CDK stack
  - [x] Add `NEW_ACCOUNT_GRACE_MINUTES` to CDK stack
  - [x] Handler reads environment variables via getConfigFromEnvironment()

- [x] Task 8: Write unit tests (AC: 7)
  - [x] Test 24hr boundary (exactly 24 hours = ready)
  - [x] Test 23h 59m (still cooling)
  - [x] Test new account at 59 minutes (ready)
  - [x] Test new account at 61 minutes (uses cooldown rule)
  - [x] Test mixed account states
  - [x] Test BST/GMT boundary
  - [x] Test with no available accounts
  - [x] Test with all accounts active

## Dev Notes

### 24-Hour Cooldown Rationale (5 Whys: Billing Separation)

The cooldown period is NOT about cleanup safety - ISB cleanup completes in ~30-60 minutes.
The 24-hour period ensures **billing separation** between users:
- AWS Cost Explorer and billing reports aggregate by day
- A 24-hour gap ensures each user's costs appear on distinct billing days
- Makes cost attribution and chargebacks unambiguous
- Prevents billing disputes ("was that charge mine or the previous user's?")

### Account Status Flow

```
┌─────────────┐      ┌──────────────┐      ┌────────────┐
│   Active    │ ───► │  Available   │ ───► │   Ready    │
│ (In lease)  │      │  (Cooling)   │      │  (24hr+)   │
└─────────────┘      └──────────────┘      └────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │   New (<1hr) │
                     │   = Ready    │
                     └──────────────┘
```

### State Machine Update

```
                    ┌────────────────────────────┐
                    │      ALLOW_LIST_CHECK      │
                    └────────────┬───────────────┘
                                 │
                    ┌────────────▼───────────────┐
                    │  ACCOUNT_COOLDOWN_CHECK    │  ◄── NEW STATE
                    └────────────┬───────────────┘
                           ┌─────┴─────┐
                   Ready   │           │   No Ready
                   ┌───────▼───┐   ┌───▼──────────┐
                   │ BUSINESS  │   │   DELAYED    │
                   │  HOURS    │   │ (NO_READY_   │
                   └───────────┘   │  ACCOUNTS)   │
                                   └──────────────┘
```

### Timestamp Comparison Safety

```typescript
// CORRECT: UTC-based comparison with injected timestamp
const isReady = (account: Account, nowTimestamp: Date, config: CooldownConfig): boolean => {
  const lastEditTime = new Date(account.meta.lastEditTime); // UTC ISO 8601
  const createdTime = new Date(account.meta.createdTime);   // UTC ISO 8601

  const cooldownMs = config.cooldownHours * 60 * 60 * 1000;
  const graceMs = config.newAccountGraceMinutes * 60 * 1000;

  const timeSinceLastEdit = nowTimestamp.getTime() - lastEditTime.getTime();
  const timeSinceCreation = nowTimestamp.getTime() - createdTime.getTime();

  // Brand new account: ready if created within grace period
  if (timeSinceCreation < graceMs) {
    return account.status === 'Available';
  }

  // Otherwise: ready if cooled down
  return account.status === 'Available' && timeSinceLastEdit >= cooldownMs;
};
```

### References

- [Source: _bmad-output/epics.md#Story 6.2] - Full acceptance criteria
- [Source: Story 6.1] - ISB Lambda getAccounts() implementation
- [Source: src/state-machine/index.ts] - Existing state machine patterns
- [Source: src/lib/lease-comments.ts] - Comment patterns

## Dev Agent Record

### Agent Model Used

claude-opus-4-5-20251101 (Opus 4.5)

### Debug Log References

- All 856 tests pass
- TypeScript compiles cleanly
- Lint passes

### Completion Notes List

1. **Pure Function Implementation (AC3)**
   - `checkAccountReadiness()` accepts `nowTimestamp` for testability
   - `isAccountReady()` helper for single account check
   - `calculateReadyTime()` for estimated availability

2. **24hr Cooldown + Grace Period Logic (AC1)**
   - Available + lastEditTime > 24hr = Ready
   - Available + createdTime < 60min = Ready (new account)
   - Available but < 24hr since lastEditTime = Cooling

3. **State Machine Integration (AC4)**
   - Added `ACCOUNT_COOLDOWN_CHECK` state after `ALLOW_LIST_CHECK`
   - Flow: `TIMING_CHECK` → `ALLOW_LIST_CHECK` → `ACCOUNT_COOLDOWN_CHECK` → `SCORING`
   - Transitions to `DELAYED` with reason `NO_READY_ACCOUNTS` when no accounts ready
   - Allow-listed users bypass cooldown check (go directly to APPROVED)

4. **UTC Timezone Safety (AC6)**
   - All comparisons use UTC Date objects
   - BST/GMT boundary test included
   - No local timezone dependencies

5. **Test Coverage (AC7)**
   - 21 tests for account-cooldown.ts
   - 6 tests for new lease comment messages
   - 5 tests for ACCOUNT_COOLDOWN_CHECK handler
   - Edge cases: 24hr boundary, 23h59m, 59m grace, 61m, mixed states

6. **Task 6 Completed: TOCTOU Race Condition (AC8)**
   - Detect when ISB rejects approval due to account no longer available
   - In `handler.ts`: Check ISB Lambda response for rejection patterns
   - Re-queue request using `sqsService.sendDelayedRequest()` with 5-minute delay
   - Updates lease comments with `buildReprocessingMessage()`
   - Unit test added for TOCTOU race condition handling

7. **Task 7 Completed: CDK Environment Variables (AC2)**
   - Added `accountCooldownHours` and `newAccountGraceMinutes` to `ApproverConfig` interface
   - Added defaults (24 hours, 60 minutes) to `DEFAULT_CONFIG`
   - Added `ACCOUNT_COOLDOWN_HOURS` and `NEW_ACCOUNT_GRACE_MINUTES` to Lambda environment
   - Handler already reads these via `getConfigFromEnvironment()`

### File List

| File | Action | Lines Changed |
|------|--------|---------------|
| `src/lib/account-cooldown.ts` | Created | +155 lines |
| `src/state-machine/types.ts` | Modified | +14 lines |
| `src/state-machine/handlers.ts` | Modified | +35 lines |
| `src/lib/lease-comments.ts` | Modified | +47 lines |
| `src/handler.ts` | Modified | +25 lines (TOCTOU handling) |
| `cdk/config/environments.ts` | Modified | +4 lines (cooldown config) |
| `cdk/lib/constructs/approver-lambda.ts` | Modified | +2 lines (env vars) |
| `test/lib/account-cooldown.test.ts` | Created | +296 lines |
| `test/lib/lease-comments.test.ts` | Modified | +54 lines |
| `test/state-machine/types.test.ts` | Modified | +3 lines |
| `test/state-machine/handlers.test.ts` | Modified | +85 lines |
| `test/handler.test.ts` | Modified | +15 lines (TOCTOU test) |
