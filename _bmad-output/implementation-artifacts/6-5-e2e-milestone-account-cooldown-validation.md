# Story 6.5: E2E Milestone - Account Cooldown Validation

Status: in-progress

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

### Integration Points Needed for Full E2E
Note: The core library functions are complete. Full integration requires:

1. **State Machine Integration** (not yet complete)
   - Connect `ACCOUNT_COOLDOWN_CHECK` handler to ISB Lambda service
   - Wire up account readiness check in orchestrator

2. **DynamoDB Queue Persistence** (deferred)
   - Store queue position for FIFO processing
   - Track lastCapacityCrunchAlert for throttling

3. **Slack Alert Integration** (partial)
   - buildCapacityCrunchAlert() ready
   - Needs wiring to existing Slack service

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Completion Notes List

(To be filled after E2E testing)

### Test Results

(To be filled after E2E testing)
