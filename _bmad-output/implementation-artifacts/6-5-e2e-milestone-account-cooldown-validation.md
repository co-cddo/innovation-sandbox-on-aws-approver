# Story 6.5: E2E Milestone - Account Cooldown Validation

Status: partial-complete

## Story

As a **developer**,
I want **to verify the account cooldown feature works end-to-end**,
So that **I have confidence the feature is production-ready**.

**Story Type:** Verification/Spike (testing only)

## Acceptance Criteria

1. **AC1: Ready account available scenario**
   - Given Stories 6.1-6.4 deployed
   - When a ready account exists
   - Then immediate approval occurs (after scoring passes)

2. **AC2: All accounts in cooldown scenario**
   - Given all accounts are Available but in cooldown
   - When a lease request arrives
   - Then request is queued with position and estimated time

3. **AC3: Brand new account scenario**
   - Given a new account (<1hr old)
   - When checking readiness
   - Then it's treated as ready (grace period bypass)

4. **AC4: Capacity crunch scenario**
   - Given all accounts are Active (none Available)
   - When a lease request arrives
   - Then queue with 36-48hr message
   - And Slack alert sent to operators

5. **AC5: AccountCleanupSucceeded trigger**
   - Given queued requests exist
   - When an account cleanup succeeds
   - Then oldest queued request is processed

## Test Scenarios

| Scenario | Expected Behavior |
|----------|-------------------|
| Ready account available | Immediate approval (after scoring passes) |
| All accounts in cooldown | Queue with position and estimated time |
| Brand new account (<1hr) | Treated as ready, immediate approval |
| Capacity crunch (all Active) | Queue with 36-48hr message, Slack alert |
| Account cleanup succeeded | Oldest queued request processed |

## E2E Test Plan

### Pre-requisites
- [ ] Stories 6.1-6.4 deployed to AWS
- [ ] ISB Lambda accessible
- [ ] Slack webhook configured

### Test Steps

1. **Check current account pool status**
   - [ ] Query `/api/accounts` via ISB Lambda
   - [ ] Document current state (how many Active, Available, cooling)

2. **Test Ready Account Scenario** (if ready accounts exist)
   - [ ] Submit a lease request via ISB UI
   - [ ] Verify immediate approval or scoring-based decision
   - [ ] Check CloudWatch logs for account readiness decision

3. **Test Cooldown Scenario** (if accounts are cooling)
   - [ ] Submit a lease request via ISB UI
   - [ ] Verify queue message with estimated time in lease comments
   - [ ] Verify queue position shown

4. **Verify CloudWatch Logs**
   - [ ] Check structured logs show account readiness check
   - [ ] Verify cooldown decision logged

5. **Optional: Capacity Crunch Test** (if all accounts active)
   - [ ] Verify Slack alert sent
   - [ ] Verify 36-48hr message in lease comments

6. **Optional: Queue Processing Test**
   - [ ] Wait for account to become ready
   - [ ] Verify oldest queued request processed first

## Implementation Status

### Stories Completed
- [x] 6.1: ISB Lambda `/api/accounts` integration with pagination
- [x] 6.2: Account cooldown logic (24hr cooldown, new account grace period)
- [x] 6.3: Queue position estimation and user messaging
- [x] 6.4: Capacity crunch detection and operator alerts
- [x] 6.5 prep: Main handler integration complete (7101945)

### Integration Completed
The main handler (`src/handler.ts`) now:
1. Calls ISB Lambda to fetch all accounts via `checkAccountReadinessNow()`
2. Applies 24hr cooldown logic from `checkAccountReadiness()`
3. Passes account readiness data to state machine context
4. Uses `buildCooldownDelayMessage()` for account cooldown delays
5. Differentiates delay reasons in logs and user messages

### Remaining Integration (deferred to future work)
1. **DynamoDB Queue Persistence**
   - Store queue position for FIFO processing
   - Track lastCapacityCrunchAlert for throttling

2. **Slack Capacity Crunch Alert**
   - buildCapacityCrunchAlert() ready
   - Needs trigger point when capacity crunch detected

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Completion Notes List

1. **E2E Testing Executed** (2025-12-30):
   - Approver Lambda deployed and operational
   - Account pool: 8 accounts (1 Active, 7 Available/Ready)
   - State machine correctly includes `ACCOUNT_COOLDOWN_CHECK` state

2. **Blocking Dependency Identified**:
   - ISB Lambda does not have `/api/accounts` endpoint
   - Approver correctly calls ISB, but receives "Route does not exist"
   - Fallback behavior works - proceeds to scoring with warning logged

3. **Verified Working**:
   - ✅ Approver calls `checkAccountReadinessNow()` at startup
   - ✅ `ACCOUNT_COOLDOWN_CHECK` state executes in state machine
   - ✅ Transition to SCORING with reason "Ready sandbox account available"
   - ✅ Unit tests pass for all cooldown logic (Stories 6.2-6.4)
   - ✅ Graceful fallback when ISB Lambda fails

4. **Blocked Pending ISB Implementation**:
   - ⏸️ AC2: Cannot test cooldown scenario without real account data
   - ⏸️ AC3: Cannot test new account grace period without real account data
   - ⏸️ AC4: Cannot test capacity crunch without real account data

### Test Results

#### E2E Test Execution (2025-12-30)

**Environment:**
- AWS Profile: `NDX/InnovationSandboxHub`
- Region: `us-west-2`
- Approver Lambda: `ApproverStack-ApproverLambdaFunction33A7CB39-9JruMLOrGbb5`
- Log Group: `/aws/lambda/approver`
- Event Bus: `InnovationSandboxComputeISBEventBus6697FE33`
- Accounts Table: `ndx-try-isb-data-SandboxAccountTableEFB9C069-198TPLJI6Z9KV`

**Account Pool Status:**
| Account ID | Name | Status | lastEditTime | Cooldown State |
|------------|------|--------|--------------|----------------|
| 404584456509 | pool-006 | Active | 2025-12-29 | In use |
| 680464296760 | pool-005 | Available | 2025-12-24 | Ready (~6 days) |
| 417845783913 | pool-007 | Available | 2025-12-23 | Ready (~7 days) |
| 221792773038 | pool-008 | Available | 2025-12-23 | Ready (~7 days) |
| 982203978489 | pool-004 | Available | 2025-12-23 | Ready (~7 days) |
| 831494785845 | pool-002 | Available | 2025-12-23 | Ready (~7 days) |
| 340601547583 | pool-003 | Available | 2025-12-23 | Ready (~7 days) |
| 449788867583 | pool-001 | Available | 2025-12-23 | Ready (~7 days) |

**Test Request Sent:**
```json
{
  "leaseId": {"userEmail": "ndx+test@dsit.gov.uk", "uuid": "66a2e03b-a24c-4e6b-89e5-88972db331ac"},
  "leaseTemplateId": "web-hosting",
  "maxSpend": 100,
  "leaseDurationInHours": 24
}
```

**Key Log Entries:**
1. `LeaseRequested event received` ✅
2. `Business hours check: within` ✅
3. `Failed to fetch accounts from ISB Lambda - proceeding to scoring` ⚠️
   - Error: "Route does not exist"
4. State transitions:
   - RECEIVED → VALIDATING → TIMING_CHECK → ALLOW_LIST_CHECK
   - `ALLOW_LIST_CHECK → ACCOUNT_COOLDOWN_CHECK` ✅
   - `ACCOUNT_COOLDOWN_CHECK → SCORING` with reason **"Ready sandbox account available"** ✅
   - SCORING → DECIDING → ESCALATED (score 83)
5. Final state: `ESCALATED` (domain not in allowlist + group mailbox detected)

**Results Summary:**
| AC | Test | Result | Notes |
|----|------|--------|-------|
| AC1 | Ready account | ⚠️ Partial | State machine executes correctly, ISB endpoint missing |
| AC2 | Cooldown scenario | ⏸️ Blocked | Requires ISB `/api/accounts` endpoint |
| AC3 | New account grace | ⏸️ Blocked | Requires ISB `/api/accounts` endpoint |
| AC4 | Capacity crunch | ⏸️ Blocked | Requires ISB `/api/accounts` endpoint |
| AC5 | Queue processing | ⏸️ Deferred | Requires DynamoDB queue implementation |

### Dependency for Full E2E

The ISB Lambda needs to implement the `/api/accounts` endpoint that returns:
```json
{
  "accounts": [
    {
      "awsAccountId": "123456789012",
      "name": "pool-001",
      "status": "Available",
      "meta": {
        "createdTime": "2025-12-01T10:00:00.000Z",
        "lastEditTime": "2025-12-29T10:00:00.000Z"
      }
    }
  ],
  "nextPageIdentifier": null
}
```

Until this endpoint is available, the cooldown logic uses fallback behavior (proceeds to scoring).
