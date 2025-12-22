# Story 2.2: State Machine with Decision Orchestration

Status: done

## Story

As a **developer**,
I want **a state machine that orchestrates the approval decision flow**,
So that **the handler logic is testable, predictable, and extensible for future scoring rules**.

## Acceptance Criteria

1. **AC1: State machine enum definition**
   - Given the Architecture specifies enum-based state machine
   - When implementing the orchestration
   - Then the state machine has these states:
     - `RECEIVED` - Initial state when event is received
     - `VALIDATING` - Validating event schema and extracting data
     - `SCORING` - Running scoring rules (stub in this story)
     - `DECIDING` - Making approval/denial/escalation decision
     - `APPROVED` - Terminal state for auto-approved requests
     - `DENIED` - Terminal state for denied requests
     - `ESCALATED` - Terminal state for manual review
     - `ERROR` - Terminal state for infrastructure errors

2. **AC2: Pure function state handlers**
   - Given each state transition
   - When a state handler is invoked
   - Then it is a pure function that:
     - Takes current state + context
     - Returns next state + updated context
     - Has no side effects (side effects handled by orchestrator)

3. **AC3: State transition logging**
   - Given the orchestrator processes a request
   - When moving through states
   - Then it logs each state transition with:
     - Previous state
     - Next state
     - Duration in milliseconds
     - Transition reason
   - And the full state history is available for audit

4. **AC4: Error state handling**
   - Given an error occurs in any state
   - When the error is caught
   - Then the state machine transitions to ERROR state
   - And context includes error details for DLQ processing
   - And the original request context is preserved

5. **AC5: Integration with existing handler**
   - Given the current stub handler exists
   - When refactoring to use state machine
   - Then the handler delegates to the state machine orchestrator
   - And existing tests continue to pass
   - And the same approval behavior is maintained (stub approval)

## Tasks / Subtasks

- [x] Task 1: Create state machine types and enums (AC: 1, 2)
  - [x] Create `src/state-machine/types.ts` with ApprovalState enum
  - [x] Define StateContext interface with all required fields
  - [x] Define StateHandler type signature
  - [x] Define StateTransition interface for logging
  - [x] Define StateMachineResult type

- [x] Task 2: Implement state handlers as pure functions (AC: 2)
  - [x] Create `src/state-machine/handlers.ts`
  - [x] Implement `handleReceived` - validates event format
  - [x] Implement `handleValidating` - extracts lease data
  - [x] Implement `handleScoring` - stub: returns score 0
  - [x] Implement `handleDeciding` - compares score to threshold
  - [x] Implement `handleApproved` - prepares approval context
  - [x] Implement `handleError` - captures error details
  - [x] All handlers are pure functions with no side effects

- [x] Task 3: Create state machine orchestrator (AC: 3, 4)
  - [x] Create `src/state-machine/orchestrator.ts`
  - [x] Implement `createStateMachineOrchestrator` factory function
  - [x] Orchestrator manages state transitions via handler map
  - [x] Logs each transition with timing via injected logger
  - [x] Maintains state history array
  - [x] Catches errors and transitions to ERROR state
  - [x] Returns final result with full state history

- [x] Task 4: Integrate state machine with handler (AC: 5)
  - [x] Update `src/handler.ts` to use orchestrator
  - [x] Move event validation to VALIDATING state
  - [x] Keep EventBridge emission as side effect in handler
  - [x] Maintain DI pattern for testability
  - [x] Ensure all existing tests pass

- [x] Task 5: Add comprehensive unit tests (AC: 1, 2, 3, 4)
  - [x] Create `test/state-machine/types.test.ts` for enum validation
  - [x] Create `test/state-machine/handlers.test.ts` for pure function tests
  - [x] Create `test/state-machine/orchestrator.test.ts` for orchestrator tests
  - [x] Test all state transitions
  - [x] Test error handling and ERROR state
  - [x] Test state history logging
  - [x] Verify 100% branch coverage on state transitions

## Dev Notes

### Architecture Patterns & Constraints

**From Architecture Document:**
- **State Machine Pattern:** Explicit enum-based state machine for decision orchestration
- **Design Principles:**
  - Single handler per state (pure functions)
  - Each handler returns `{ nextState, context }`
  - State transitions logged with duration metrics
  - Easy to test without mocks
- **DI Pattern:** Factory functions for all services (no DI framework)
- **Logging:** AWS Lambda Powertools for structured JSON logging
- **Runtime:** Node.js 20.x with TypeScript 5.3+ (strict mode)
- **Module System:** CommonJS (format: cjs in esbuild - required for Lambda)
- **Error Handling:** Result types for expected failures, fail-closed philosophy

### State Machine Design

**State Flow Diagram:**
```
RECEIVED → VALIDATING → SCORING → DECIDING → APPROVED
                                          ↘ DENIED
                                          ↘ ESCALATED
     ↓ (any error)
    ERROR
```

**State Definitions:**
```typescript
enum ApprovalState {
  RECEIVED = 'RECEIVED',       // Event received, initial state
  VALIDATING = 'VALIDATING',   // Schema validation, data extraction
  SCORING = 'SCORING',         // Calculate risk score (stub: 0)
  DECIDING = 'DECIDING',       // Compare score to threshold
  APPROVED = 'APPROVED',       // Auto-approve terminal state
  DENIED = 'DENIED',           // Deny terminal state (future)
  ESCALATED = 'ESCALATED',     // Manual review terminal state
  ERROR = 'ERROR'              // Error terminal state
}
```

**Context Interface:**
```typescript
interface StateContext {
  // Event data
  leaseId: string;
  userEmail: string;
  templateId: string;
  budgetAmount: number;
  leaseDurationHours: number;
  requiresManualApproval: boolean;
  comments?: string;

  // Processing state
  score: number;
  scoreBreakdown: RuleResult[];
  decision?: 'approved' | 'denied' | 'escalated';
  approvedBy?: string;
  reason?: string;

  // Error tracking
  error?: {
    message: string;
    code: string;
    state: ApprovalState;  // State where error occurred
  };

  // State history
  stateHistory: StateTransition[];
}

interface StateTransition {
  from: ApprovalState;
  to: ApprovalState;
  timestamp: string;
  durationMs: number;
  reason?: string;
}

interface RuleResult {
  rule: string;
  points: number;
  triggered: boolean;
  reason?: string;
}
```

**Handler Type Signature:**
```typescript
type StateHandler = (
  context: StateContext
) => { nextState: ApprovalState; context: StateContext };
```

### Project Structure Notes

**New files to create:**
```
src/
├── state-machine/
│   ├── types.ts          # ApprovalState enum, StateContext, types
│   ├── handlers.ts       # Pure function state handlers
│   └── orchestrator.ts   # State machine orchestrator factory

test/
├── state-machine/
│   ├── types.test.ts
│   ├── handlers.test.ts
│   └── orchestrator.test.ts
```

**Existing files to modify:**
- `src/handler.ts` - Refactor to use state machine orchestrator
- `test/handler.test.ts` - Update tests for new structure

### Previous Story Learnings (Story 2.1)

**From Story 2.1 Implementation:**
- Zod schemas work well for runtime validation
- DI pattern via `setEventBridgeService`/`resetEventBridgeService` works for testing
- Mock hoisting requires inline mock definitions in `vi.mock()`
- TypeScript strict mode requires careful handling of `unknown[]` casts
- FailedEntryCount must be checked for EventBridge partial failures
- Error instanceof check needs explicit test for non-Error exceptions

**Key Files from Story 2.1:**
- `src/lib/types.ts` - Event schemas (LeaseRequestedEventSchema, LeaseApprovedDetailSchema)
- `src/services/eventbridge.ts` - EventBridge service factory
- `src/handler.ts` - Current handler with stub approval logic
- `test/handler.test.ts` - Existing test patterns to follow

### Git Intelligence

**Recent commits:**
- `feat(story-2.1): implement minimal vertical slice - event to approval`
- `chore: mark Epic 1 complete - infrastructure foundation verified`
- `fix: bundle Lambda as CommonJS and add build step to CI`

**Code patterns established:**
- Factory functions for services (`createEventBridgeService`)
- DI via setter/resetter functions for testing
- Zod for runtime validation
- Structured logging with `logger.appendKeys()` and `logger.info()`
- Fail-closed error handling with try/catch

### Testing Strategy

**Unit Tests Required:**

1. `types.test.ts`
   - ApprovalState enum has all expected values
   - Terminal states are correctly identified

2. `handlers.test.ts`
   - Each handler is a pure function (no side effects)
   - `handleReceived` → VALIDATING with initial context
   - `handleValidating` → SCORING with extracted data
   - `handleScoring` → DECIDING with score 0 (stub)
   - `handleDeciding` → APPROVED when score < threshold
   - `handleDeciding` → ESCALATED when score >= threshold
   - `handleError` → ERROR with preserved context

3. `orchestrator.test.ts`
   - Full flow: RECEIVED → VALIDATING → SCORING → DECIDING → APPROVED
   - Error handling: any state → ERROR
   - State history is recorded correctly
   - Timing is logged for each transition
   - Orchestrator uses injected logger

4. `handler.test.ts` (updates)
   - All existing tests pass
   - Handler uses state machine for processing
   - Final approval behavior unchanged

**Coverage Targets:**
- Lines: 90%+ (current threshold)
- Branches: 100% on state transitions

### Critical Warnings

1. **DO NOT change esbuild format** - Must be `cjs` for Lambda compatibility
2. **DO NOT modify CDK stack** - Infrastructure is complete from Epic 1
3. **MUST use pure functions** - State handlers have no side effects
4. **MUST maintain backward compatibility** - All Story 2.1 tests must pass
5. **MUST use existing logger** - `src/lib/logger.ts` already configured
6. **Side effects in handler only** - EventBridge emission stays in handler.ts

### Integration Notes

**Stub Scoring (for this story):**
- Score is always 0
- Threshold is 20 (from environment or default)
- All requests auto-approve in this story
- Full scoring engine comes in Story 2.3

**EventBridge Emission:**
- Stays in handler.ts (side effect)
- Not part of state machine (pure logic only)
- State machine returns decision, handler acts on it

### References

- [Source: architecture.md#State-Machine-Pattern] - State machine design
- [Source: architecture.md#Implementation-Patterns] - DI and error patterns
- [Source: epics.md#Story-2.2] - Acceptance criteria
- [Source: 2-1-minimal-vertical-slice-event-to-approval.md] - Previous story learnings

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

- No blocking issues encountered during implementation

### Completion Notes List

1. Created comprehensive state machine types with ApprovalState enum (8 states) and terminal state utilities
2. Implemented pure function state handlers for all 8 states with configurable threshold
3. Created state machine orchestrator with DI pattern, transition logging, and max transitions protection
4. Integrated state machine into handler while maintaining backward compatibility with Story 2.1
5. Added DI support for orchestrator (setOrchestrator/resetOrchestrator) for testing
6. Handler now delegates to state machine for decision logic, keeps EventBridge emission as side effect
7. Escalated requests currently auto-approve for backward compatibility (Slack notification in Story 5.2)
8. All 142 tests pass with 100% coverage (lines, branches, functions, statements)
9. Applied red-green-refactor cycle: tests first, then implementation, then coverage optimization

### Code Review Fixes (Post-Implementation)

1. Added explicit DENIED decision handling in handler.ts (returns 500 with "not yet implemented" - full denial in Story 2.4)
2. Added test for denied decision handling with proper logging assertions
3. Updated "unexpected decision" test to use truly invalid decision value
4. Fixed TypeScript strict mode issues:
   - Added non-null assertions for array access after length checks
   - Made StateMachineLogger interface compatible with AWS Powertools Logger using rest params
   - Used type assertion for logger when creating orchestrator
5. Fixed package.json build script with proper quoting for glob patterns
6. Added missing @eslint/js dependency
7. Updated CDK snapshot after dependency changes

### File List

Files created:
- src/state-machine/types.ts
- src/state-machine/handlers.ts
- src/state-machine/orchestrator.ts
- src/state-machine/index.ts
- test/state-machine/types.test.ts
- test/state-machine/handlers.test.ts
- test/state-machine/orchestrator.test.ts
- test/state-machine/orchestrator-error.test.ts

Files modified:
- src/handler.ts (refactored to use state machine orchestrator)
- test/handler.test.ts (added state machine integration tests)
