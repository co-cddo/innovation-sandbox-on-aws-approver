# Story 7.2.4: Implement Idempotency for Action Lambdas

Status: dropped

## Drop Decision

**Date:** 2026-01-21
**Decision:** Story dropped - ISB handles idempotency natively

### Rationale

After party-mode discussion with Architect (Winston), Developer (Amelia), Test Architect (Murat), Scrum Master (Bob), and PM (John), the team concluded:

1. **ISB Leases Lambda already handles idempotency** - Returns 409 Conflict when a lease is already approved/denied
2. **Current implementation already handles ISB's response gracefully** - `isAlreadyProcessedResult()` in `slack-action-base.ts:212-221` detects 409 and returns friendly "Already processed" message
3. **User experience is identical** - Operator sees same message whether we prevent the call or ISB rejects it
4. **The real requirement is preventing duplicate approvals** (which ISB guarantees), not preventing duplicate API calls (which is just optimization)

### What This Story Would Have Added
- DynamoDB-based idempotency check BEFORE calling ISB
- Prevents the second ISB call entirely in race conditions

### Why It's Not Needed
- ISB's state machine IS the authoritative idempotency source (as AC6 stated)
- Adding Lambda-layer idempotency would be defense-in-depth for a problem that doesn't exist
- Adds complexity (DynamoDB permissions, env vars, tests) without functional benefit

### Test Coverage Already Validates Current Behavior
- `test/handlers/slack-approve.test.ts:328-340` - ISB 409 conflict handling
- `test/handlers/slack-approve.test.ts:342-354` - "already" keyword detection
- Same coverage exists for deny handler

### Future Consideration
If ISB's idempotency becomes unreliable, this story can be revisited. The implementation plan is preserved below for reference.

---

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an **operator**,
I want duplicate button clicks to be handled gracefully,
So that accidentally clicking twice doesn't cause problems.

## Acceptance Criteria

### AC1: Idempotency Check Before ISB Call
**Given** an operator clicks Approve or Deny
**When** the action Lambda receives the request
**Then** it checks idempotency BEFORE calling ISB Leases Lambda
**And** uses leaseId as the idempotency key

### AC2: Duplicate Click Returns Already Processed
**Given** a lease has already been approved or denied
**When** another operator (or same operator) clicks a button
**Then** the Lambda returns "already processed" status
**And** does NOT call ISB Leases Lambda again

### AC3: Race Condition Handling
**Given** two operators click buttons simultaneously
**When** both requests arrive at the Lambda
**Then** only one ISB Leases Lambda call is made
**And** the second request receives "already processed" response

### AC4: Test Coverage - Duplicate Clicks
**Given** the idempotency implementation
**When** running unit tests
**Then** tests verify duplicate clicks return correct response
**And** tests verify ISB Lambda is called exactly once

### AC5: Test Coverage - Race Conditions
**Given** the idempotency implementation
**When** running integration tests
**Then** concurrent requests are tested
**And** only one ISB Lambda invocation occurs

### AC6: Idempotency State Storage
**Given** idempotency needs to persist across Lambda invocations
**When** checking for duplicates
**Then** state is checked via ISB Leases Lambda (which returns "already processed" for completed requests)
**And** no separate idempotency store is required - ISB's existing state is the source of truth

## Tasks / Subtasks

- [ ] Task 1: Implement idempotency via AWS Powertools Idempotency (AC: #1, #3)
  - [ ] 1.1: Add `@aws-lambda-powertools/idempotency` as a runtime dependency (if not already present)
  - [ ] 1.2: Create idempotency table in CDK stack (or reuse existing `IdempotencyTable`)
  - [ ] 1.3: Wrap ISB Lambda invocation with `makeIdempotent()` in `slack-action-base.ts`
  - [ ] 1.4: Configure idempotency key to use `leaseId`
  - [ ] 1.5: Set appropriate TTL (24 hours matches ISB's lease processing window)

- [ ] Task 2: Update handlers to use idempotent service call (AC: #1, #2)
  - [ ] 2.1: Extract ISB invocation into separate function for idempotency wrapper
  - [ ] 2.2: Ensure idempotency check occurs BEFORE ISB Lambda is invoked
  - [ ] 2.3: Return cached response for duplicate requests
  - [ ] 2.4: Log idempotency cache hits for audit trail (FR15)

- [ ] Task 3: Add CDK infrastructure for idempotency (AC: #1)
  - [ ] 3.1: Grant DynamoDB permissions for idempotency table to action Lambdas
  - [ ] 3.2: Add `IDEMPOTENCY_TABLE_NAME` environment variable to both Lambdas
  - [ ] 3.3: Update CDK tests for new permissions and environment variables

- [ ] Task 4: Write unit tests for duplicate clicks (AC: #4)
  - [ ] 4.1: Test that second call with same leaseId returns "already processed"
  - [ ] 4.2: Test that ISB Lambda mock is called exactly once for duplicate requests
  - [ ] 4.3: Test different leaseIds are processed independently
  - [ ] 4.4: Test approve after deny (and vice versa) still makes ISB call

- [ ] Task 5: Write integration tests for race conditions (AC: #5)
  - [ ] 5.1: Create concurrent request test with Promise.all()
  - [ ] 5.2: Verify only one ISB Lambda invocation via mock call count
  - [ ] 5.3: Verify second concurrent request gets "already processed" response
  - [ ] 5.4: Test with realistic timing (slight delay between requests)

- [ ] Task 6: Validate existing "already processed" handling works (AC: #2, #6)
  - [ ] 6.1: Verify `isAlreadyProcessedResult()` correctly identifies ISB 409 responses
  - [ ] 6.2: Verify existing test coverage for ISB "already processed" scenarios
  - [ ] 6.3: Add test proving ISB's existing state is the ultimate source of truth

- [ ] Task 7: Run validation and CDK synth (AC: #1-6)
  - [ ] 7.1: Run `npm run test` - all tests pass
  - [ ] 7.2: Run `npx cdk synth` - CDK synthesizes correctly
  - [ ] 7.3: Verify test count increased with idempotency tests

## Dev Notes

### Architecture Decision: AWS Powertools Idempotency vs ISB-Only Approach

**The PRD and AC6 state ISB's existing state is the source of truth.** However, this approach has a critical flaw:

**Problem:** If two operators click simultaneously:
1. Request A arrives at Lambda, starts processing
2. Request B arrives at Lambda, starts processing (Lambda is concurrent)
3. Request A calls ISB Lambda → Success
4. Request B calls ISB Lambda → Already processed (409)

Both Lambda invocations CALL ISB. AC3 explicitly requires "only one ISB Leases Lambda call is made."

**Solution: Use AWS Powertools Idempotency**

The project already uses `@aws-lambda-powertools/idempotency` in the main approver handler (see `src/handler.ts:35`). The same pattern should be applied here:

```typescript
// From existing src/handler.ts
import { makeIdempotent } from '@aws-lambda-powertools/idempotency';
import { DynamoDBPersistenceLayer } from '@aws-lambda-powertools/idempotency/dynamodb';

const persistenceStore = new DynamoDBPersistenceLayer({
  tableName: process.env.IDEMPOTENCY_TABLE_NAME!,
});
```

**Idempotency Key Strategy:**

The key should be `{leaseId}` only (not including action type), because:
- A lease can only be approved OR denied once
- If operator A approves and operator B tries to deny the same lease, both should NOT go to ISB
- The first action wins; subsequent actions for the same lease should return "already processed"

However, this creates a consideration: Should approve and deny share the same idempotency key?
- **Yes:** Prevents race between approve and deny for same lease
- **No:** Allows both actions to be attempted (ISB handles the conflict)

**Recommendation:** Use `{leaseId}` as the key. Both approve and deny on the same lease should be idempotent together - the first action wins.

### Existing Idempotency Infrastructure

From the codebase analysis:

**DynamoDB Table (already exists):**
```typescript
// From cdk/lib/approver-stack.ts
const idempotencyTable = new dynamodb.Table(this, 'IdempotencyTable', {
  tableName: 'ApproverIdempotency',
  partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
  timeToLiveAttribute: 'expiration',
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});
```

**The table exists and can be reused.** Action Lambdas just need:
1. IAM permissions to access it
2. `IDEMPOTENCY_TABLE_NAME` environment variable

### Implementation Pattern

**Current flow (NOT idempotent for concurrent requests):**
```
Lambda receives event
  → Validate payload
  → Decode leaseId
  → Call ISB Lambda (ALWAYS)
  → Check if "already processed" in response
  → Return appropriate response
```

**Proposed flow (truly idempotent):**
```
Lambda receives event
  → Validate payload
  → Decode leaseId
  → Idempotency check via Powertools (uses DynamoDB)
    → If idempotent key exists: return cached response (NO ISB call)
    → If new key: proceed
  → Call ISB Lambda
  → Store result in idempotency table
  → Return response
```

### Code Changes Required

**1. Update `slack-action-base.ts`:**

```typescript
import { makeIdempotent } from '@aws-lambda-powertools/idempotency';
import { DynamoDBPersistenceLayer } from '@aws-lambda-powertools/idempotency/dynamodb';

// Create persistence layer (lazy initialization)
let persistenceStore: DynamoDBPersistenceLayer | null = null;
const getPersistenceStore = (): DynamoDBPersistenceLayer => {
  if (!persistenceStore) {
    const tableName = process.env.IDEMPOTENCY_TABLE_NAME;
    if (!tableName) {
      throw new Error('IDEMPOTENCY_TABLE_NAME environment variable is required');
    }
    persistenceStore = new DynamoDBPersistenceLayer({ tableName });
  }
  return persistenceStore;
};

// Idempotent wrapper for ISB invocation
const invokeIsbWithIdempotency = async (
  leaseId: string,
  isbService: IsbLambdaService,
  actionType: 'approve' | 'deny',
  approverEmail: string
): Promise<IsbLambdaResult> => {
  // ... ISB invocation logic
};

// Wrap with idempotency
const idempotentInvokeIsb = makeIdempotent(invokeIsbWithIdempotency, {
  persistenceStore: getPersistenceStore(),
  dataKeywordArgument: 'leaseId', // Use leaseId as the idempotency key
  keyPrefix: 'slack-action',
  expiresAfterSeconds: 86400, // 24 hours
});
```

**2. Update CDK constructs (`slack-approve-lambda.ts`, `slack-deny-lambda.ts`):**

```typescript
// Add environment variable
environment: {
  // ... existing vars
  IDEMPOTENCY_TABLE_NAME: props.idempotencyTableName,
},

// Grant permissions
props.idempotencyTable.grantReadWriteData(this.function);
```

**3. Update ApproverStack to pass idempotency table:**

```typescript
// Pass idempotency table to action Lambda constructs
const slackApproveLambda = new SlackApproveLambda(this, 'SlackApproveLambda', {
  // ... existing props
  idempotencyTableName: idempotencyTable.tableName,
  idempotencyTable: idempotencyTable,
});
```

### Test Strategy

**Unit Tests (Task 4):**
- Mock DynamoDB persistence layer
- Test that second call with same leaseId returns cached response without ISB call
- Test call count on ISB service mock

**Integration Tests (Task 5):**
- Use `Promise.all()` to simulate concurrent requests
- Use a spy on ISB Lambda invocation
- Verify exactly one ISB call for concurrent same-leaseId requests

**Example test structure:**
```typescript
describe('idempotency', () => {
  it('handles duplicate clicks without calling ISB twice', async () => {
    const isbService = {
      approveLease: vi.fn().mockResolvedValue({ success: true, statusCode: 200 }),
    };
    setIsbLambdaService(isbService);

    // First call
    await handler(validEvent);
    // Second call with same leaseId
    await handler(validEvent);

    expect(isbService.approveLease).toHaveBeenCalledTimes(1);
  });

  it('handles race conditions with concurrent requests', async () => {
    const isbService = {
      approveLease: vi.fn().mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve({ success: true, statusCode: 200 }), 100))
      ),
    };
    setIsbLambdaService(isbService);

    // Concurrent calls
    const [result1, result2] = await Promise.all([
      handler(validEvent),
      handler(validEvent),
    ]);

    expect(isbService.approveLease).toHaveBeenCalledTimes(1);
    expect(result2.message).toContain('Already processed');
  });
});
```

### Logging Requirements (FR15)

AC6 and FR15 require logging idempotency cache hits:

```typescript
logger.info('Idempotency cache hit', {
  correlationId,
  leaseId,
  action: 'approve', // or 'deny'
  outcome: 'cached_response_returned',
});
```

### Project Structure Notes

**Files to modify:**
- `src/handlers/slack-action-base.ts` - Add idempotency wrapper
- `cdk/lib/constructs/slack-approve-lambda.ts` - Add table access and env var
- `cdk/lib/constructs/slack-deny-lambda.ts` - Add table access and env var
- `cdk/lib/approver-stack.ts` - Pass idempotency table to constructs
- `test/handlers/slack-approve.test.ts` - Add idempotency tests
- `test/handlers/slack-deny.test.ts` - Add idempotency tests
- `cdk/test/constructs/slack-approve-lambda.test.ts` - Test new permissions
- `cdk/test/constructs/slack-deny-lambda.test.ts` - Test new permissions

**No new files required** - this is enhancement of existing infrastructure.

### Testing Standards

From Architecture document:
- Unit test coverage: 80%+ for handlers
- Use Vitest with mocked AWS clients
- Factory pattern enables DI for testing

**Test Cases Required:**

1. **Duplicate click handling:**
   - Sequential duplicate calls → ISB called once
   - Different leaseIds → ISB called for each
   - Approve then deny same lease → ISB called once (first wins)

2. **Race condition handling:**
   - Concurrent calls with same leaseId → ISB called once
   - Concurrent calls with different leaseIds → ISB called for each

3. **Cache hit logging:**
   - Verify log entry on idempotency cache hit

4. **CDK infrastructure:**
   - Idempotency table permissions granted
   - Environment variable set

### References

- [Source: _bmad-output/epics-amazon-q-slack.md#Story 7.2.4]
- [Source: _bmad-output/prd-amazon-q-slack.md#Idempotency & Audit - FR13, FR15, NFR3]
- [Source: src/handlers/slack-action-base.ts - Current action handler implementation]
- [Source: src/handler.ts:35 - Existing Powertools idempotency usage]
- [Source: cdk/lib/approver-stack.ts - Idempotency table definition]
- [Source: https://docs.powertools.aws.dev/lambda/typescript/latest/utilities/idempotency/]

### Previous Story Intelligence (7.2.1, 7.2.2, 7.2.3)

**From Story 7.2.1 (Approve Lambda):**
- `slack-action-base.ts` contains shared handler logic
- `isAlreadyProcessedResult()` checks for ISB 409/error messages
- `createAlreadyProcessedResponse()` formats the "already processed" thread reply

**From Story 7.2.2 (Deny Lambda):**
- Identical handler structure to approve
- Shares `slack-action-base.ts` logic
- Same ISB invocation pattern

**From Story 7.2.3 (Custom Actions):**
- Custom actions configured via CDK (CfnCustomAction)
- End-to-end verification confirmed action flow works
- ISB successfully returns 409 for already-processed leases

**Key Insight:** The current implementation DOES handle "already processed" from ISB correctly. The gap is that it still makes the ISB call. True idempotency (AC1, AC3) requires preventing the duplicate call entirely.

### Git Intelligence

**Recent commit patterns:**
- `feat(scope): description (#PR)` format
- Atomic commits per story

**Suggested commit message:**
```
feat(slack): implement idempotency for action Lambdas (#N)

- Add AWS Powertools idempotency to prevent duplicate ISB Lambda calls
- Grant idempotency table access to Approve and Deny Lambdas
- Add unit tests for duplicate click handling
- Add integration tests for race condition scenarios
- Log idempotency cache hits for audit trail

Story: 7.2.4
```

### Pre-Implementation Checklist

Before starting implementation, verify:
- [ ] You've read `src/handlers/slack-action-base.ts` (handler to modify)
- [ ] You've read `src/handler.ts` (existing idempotency pattern to follow)
- [ ] You've read the AWS Powertools idempotency documentation
- [ ] You understand the existing `IdempotencyTable` in approver-stack.ts
- [ ] You know the existing test count (run `npm test` first)

### Implementation Order

1. **Task 3** - CDK infrastructure (add permissions and env var first)
2. **Task 1** - Implement idempotency wrapper in slack-action-base.ts
3. **Task 2** - Update handlers to use idempotent service call
4. **Task 4** - Unit tests for duplicate clicks
5. **Task 5** - Integration tests for race conditions
6. **Task 6** - Validate existing "already processed" handling
7. **Task 7** - Validation and synth

### Estimated Effort

**Medium** - This story involves:
- Understanding AWS Powertools idempotency (existing pattern in codebase)
- Modifying shared handler logic
- Adding CDK permissions
- Writing comprehensive tests

The architecture is clear; implementation follows established patterns.

### Edge Cases to Consider

1. **Idempotency table unavailable:** Should fail closed (no approval without idempotency guarantee)
2. **Partial completion:** Powertools handles this with IN_PROGRESS status
3. **TTL expiry:** After 24h, same leaseId can be processed again (acceptable - ISB still handles conflicts)
4. **Lambda cold starts:** Persistence layer is lazily initialized

---

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

