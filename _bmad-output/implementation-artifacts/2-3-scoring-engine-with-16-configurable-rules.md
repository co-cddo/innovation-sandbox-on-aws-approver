# Story 2.3: Scoring Engine with 16 Configurable Rules

Status: done

## Story

As a **lease requester**,
I want **my request scored against 16 risk rules with configurable weights**,
So that **low-risk requests are auto-approved while high-risk ones are escalated**.

## Acceptance Criteria

1. **AC1: Scoring engine calculates composite score from 16 rules**
   - Given the scoring engine is invoked
   - When calculating a score
   - Then it applies all 16 rules with their configured weights
   - And returns total score plus breakdown per rule

2. **AC2: Rule weights are configurable via environment variable**
   - Given rule weights are configurable
   - When the Lambda starts
   - Then it reads `RULE_WEIGHTS` from environment variable (JSON string)
   - And falls back to defaults if not set or invalid
   - And logs which weights are being used

3. **AC3: Threshold comparison determines decision**
   - Given the threshold is configurable (FR2)
   - When comparing score to threshold
   - Then it reads `AUTO_APPROVE_THRESHOLD` from environment (default: 20)
   - And score < threshold → APPROVED
   - And score >= threshold → ESCALATED

4. **AC4: Deterministic scoring for identical inputs (FR4)**
   - Given scoring must be deterministic
   - When the same inputs are provided
   - Then the same score is produced every time
   - And rule order does not affect final score

5. **AC5: Pessimistic scoring when data unavailable (FR3)**
   - Given data is unavailable for a rule
   - When calculating that rule's contribution
   - Then pessimistic scoring applies:
     - Skip bonuses (negative weights)
     - Apply penalties (positive weights)
   - And log which rules used fallback

6. **AC6: Scoring completes within performance budget (FR5)**
   - Given performance requirements
   - When calculating the full score
   - Then scoring completes in <2 seconds (NFR-PERF-03)
   - And timing is logged for observability

7. **AC7: Complete score breakdown logging (FR6)**
   - Given score breakdown logging is required
   - When a score is calculated
   - Then structured log includes:
     - Total score
     - Each rule's contribution
     - Which rules triggered
     - Which rules used fallback
     - Scoring duration in milliseconds

## The 16 Scoring Rules

| # | Rule Name | Default Weight | Condition |
|---|-----------|----------------|-----------|
| 1 | `expired_leases` | +2 each | Leases in last 30 days with status `Expired` |
| 2 | `budget_exceeded` | +5 each | Leases in last 30 days with status `BudgetExceeded` |
| 3 | `first_time_user` | +5 | No previous leases in system |
| 4 | `first_time_suspicious` | +20 | First lease AND group mailbox pattern |
| 5 | `verified_gov_domain` | -5 | Domain in ukps-domains allowlist |
| 6 | `familiar_template` | -1 | Previously used this template successfully |
| 7 | `template_hopper` | +2 | 3+ leases and never repeated a template |
| 8 | `budget_amount` | +1 per $10 | Higher budget = higher scrutiny |
| 9 | `duration_requested` | +1 per 8hrs | Longer duration = more exposure |
| 10 | `end_of_window` | -2 | Request in final 2 hours (5-7pm London) |
| 11 | `cooldown_violation` | +10 | Request within 1hr of previous lease end |
| 12 | `outside_target_audience` | +10 | Domain clearly not local gov (AI-determined in Story 3.4) |
| 13 | `manual_early_termination` | -2 each | User terminated leases early (responsible) |
| 14 | `org_recent_negative` | +3 | Same domain had issues in last 30 days |
| 15 | `org_clean_record` | -2 | Same domain clean for 90 days |
| 16 | `group_mailbox_detected` | +20 | AI detected group email pattern (Story 3.4) |

**Note for this story:** Rules 4, 5, 12, 16 depend on external data (user history, domain list, AI). In this story, implement the scoring engine structure with **stub data sources**:
- User history: Return empty array (no history)
- Domain list: Return empty set (no verified domains)
- AI analysis: Skip (handled in Story 3.4)

This means some rules will always apply pessimistically or be skipped in this story. Full integration comes in Epic 3.

## Tasks / Subtasks

- [x] Task 1: Create scoring engine types and interfaces (AC: 1, 4, 7)
  - [x] Create `src/scoring/types.ts` with:
    - `RuleId` type union for all 16 rule identifiers
    - `RuleResult` interface for individual rule outcomes
    - `ScoringResult` interface for total score + breakdown
    - `ScoringContext` interface for request data
    - `RuleWeights` type for configurable weights
    - `DEFAULT_RULE_WEIGHTS` constant with default values
  - [x] Export types from `src/scoring/index.ts`

- [x] Task 2: Implement individual scoring rules as pure functions (AC: 1, 4)
  - [x] Create `src/scoring/rules.ts` with:
    - One pure function per rule: `(context: ScoringContext, weight: number) => RuleResult`
    - Rules that need external data accept optional stubs
    - Each rule returns `{ ruleId, points, triggered, reason?, fallbackUsed? }`
  - [x] Implement stub versions for rules 4, 5, 12, 16 (external data not available yet)
  - [x] Unit test each rule in isolation

- [x] Task 3: Create scoring engine orchestrator (AC: 1, 5, 6, 7)
  - [x] Create `src/scoring/engine.ts` with:
    - `createScoringEngine(config, logger)` factory function
    - `calculateScore(context)` method that runs all 16 rules
    - Timing measurement for performance logging
    - Accumulates total score from all rule results
    - Returns `ScoringResult` with breakdown
  - [x] Implement pessimistic fallback logic for unavailable data
  - [x] Add structured logging for score breakdown

- [x] Task 4: Add configurable weights support (AC: 2)
  - [x] Create `src/scoring/config.ts` with:
    - `parseRuleWeights(json: string)` function with Zod validation
    - `loadScoringConfig()` to read from environment
    - Fallback to defaults on parse error
    - Log warning if custom weights applied
  - [x] Add `RULE_WEIGHTS` to CDK environment variables (JSON string)

- [x] Task 5: Integrate scoring engine with state machine (AC: 3)
  - [x] Update `src/state-machine/handlers.ts`:
    - `handleScoring` now calls scoring engine
    - Passes `ScoringContext` from `StateContext`
    - Stores `score` and `scoreBreakdown` in context
  - [x] Update `handleDeciding` to use actual score vs threshold
  - [x] Update state machine types if needed

- [x] Task 6: Add comprehensive unit tests (AC: 1, 2, 3, 4, 5)
  - [x] Create `test/scoring/types.test.ts` - verify type exports and defaults
  - [x] Create `test/scoring/rules.test.ts` - test each rule with edge cases
  - [x] Create `test/scoring/engine.test.ts` - test full scoring flow
  - [x] Create `test/scoring/config.test.ts` - test weight parsing/loading
  - [x] Verify deterministic output for same inputs
  - [x] Test pessimistic fallback behavior
  - [x] Target 100% branch coverage on scoring logic

- [x] Task 7: Update handler tests (AC: 5)
  - [x] Update `test/handler.test.ts` for scoring integration
  - [x] Test approval path (score < threshold)
  - [x] Test escalation path (score >= threshold)
  - [x] Verify score breakdown in logs

## Dev Notes

### Architecture Patterns & Constraints

**From Architecture Document:**
- **Scoring Engine:** Pure functions for testability, deterministic output
- **DI Pattern:** Factory functions for all services (no DI framework)
- **Error Handling:** Result types for expected failures, fail-closed philosophy
- **Logging:** AWS Lambda Powertools for structured JSON logging
- **Performance:** Scoring must complete in <2 seconds
- **Module System:** CommonJS (format: cjs in esbuild - required for Lambda)

### Scoring Engine Design

**Pure Function Pattern:**
```typescript
// Each rule is a pure function
type ScoringRule = (context: ScoringContext, weight: number) => RuleResult;

interface RuleResult {
  ruleId: RuleId;
  points: number;           // Actual contribution to score
  triggered: boolean;       // Whether condition was met
  reason?: string;         // Human-readable explanation
  fallbackUsed?: boolean;  // If pessimistic fallback was applied
}

interface ScoringResult {
  totalScore: number;
  breakdown: RuleResult[];
  durationMs: number;
  thresholdApplied: number;
  decision: 'approved' | 'escalated';
}
```

**Factory Pattern for Engine:**
```typescript
export const createScoringEngine = (
  config: ScoringEngineConfig,
  logger: StateMachineLogger
) => ({
  calculateScore: (context: ScoringContext): ScoringResult => {
    const startTime = Date.now();
    const breakdown: RuleResult[] = [];

    // Run all 16 rules
    for (const rule of RULES) {
      const weight = config.weights[rule.id] ?? DEFAULT_WEIGHTS[rule.id];
      const result = rule.fn(context, weight);
      breakdown.push(result);
    }

    const totalScore = breakdown.reduce((sum, r) => sum + r.points, 0);
    const decision = totalScore < config.threshold ? 'approved' : 'escalated';

    return {
      totalScore,
      breakdown,
      durationMs: Date.now() - startTime,
      thresholdApplied: config.threshold,
      decision,
    };
  },
});
```

### Project Structure Notes

**New files to create:**
```
src/
├── scoring/
│   ├── types.ts          # RuleId, RuleResult, ScoringResult, etc.
│   ├── rules.ts          # 16 rule functions
│   ├── engine.ts         # ScoringEngine factory
│   ├── config.ts         # Weight parsing/loading
│   └── index.ts          # Public exports

test/
├── scoring/
│   ├── types.test.ts
│   ├── rules.test.ts
│   ├── engine.test.ts
│   └── config.test.ts
```

**Files to modify:**
- `src/state-machine/handlers.ts` - integrate scoring engine in SCORING state
- `src/state-machine/types.ts` - add scoreBreakdown to StateContext (if not already)
- `cdk/lib/approver-stack.ts` - add RULE_WEIGHTS environment variable

### Previous Story Learnings (Story 2.2)

**From Story 2.2 Implementation:**
- State machine pattern established with pure function handlers
- StateContext already has `score: number` and `scoreBreakdown: RuleResult[]`
- Handler delegates to orchestrator, keeps side effects out of state machine
- DI pattern via `setOrchestrator`/`resetOrchestrator` works for testing
- Mock hoisting requires inline mock definitions in `vi.mock()`
- TypeScript strict mode requires careful handling of array access with `!` assertions
- StateMachineLogger interface uses rest params for AWS Powertools compatibility

**Key Files from Story 2.2:**
- `src/state-machine/types.ts` - Already has RuleResult interface and score fields
- `src/state-machine/handlers.ts` - handleScoring currently returns stub score 0
- `src/state-machine/orchestrator.ts` - Logs transitions with timing

### Git Intelligence

**Recent commits:**
- `feat(story-2.2): implement state machine with decision orchestration`
- `feat(story-2.1): implement minimal vertical slice - event to approval`

**Code patterns established:**
- Factory functions for services (`createEventBridgeService`, `createStateMachineOrchestrator`)
- DI via setter/resetter functions for testing
- Zod for runtime validation
- Structured logging with `logger.appendKeys()` and `logger.info()`
- Fail-closed error handling with try/catch
- 100% coverage thresholds enforced

### Testing Strategy

**Unit Tests Required:**

1. `types.test.ts`
   - DEFAULT_RULE_WEIGHTS has all 16 rules defined
   - RuleId type matches all rule identifiers
   - Type exports work correctly

2. `rules.test.ts`
   - Each of 16 rules tested in isolation
   - Rule returns correct points when triggered
   - Rule returns 0 when not triggered
   - Edge cases (boundary values)
   - Deterministic output for same input

3. `engine.test.ts`
   - Full scoring run with all rules
   - Custom weights override defaults
   - Pessimistic fallback when data unavailable
   - Timing is measured and included
   - Score breakdown is complete
   - Decision matches threshold comparison

4. `config.test.ts`
   - Valid JSON parsed correctly
   - Invalid JSON falls back to defaults
   - Missing keys use defaults
   - Environment variable integration

**Coverage Targets:**
- Lines: 90%+ (current threshold)
- Branches: 100% on scoring logic (PRD requirement)

### Critical Warnings

1. **DO NOT change esbuild format** - Must be `cjs` for Lambda compatibility
2. **DO NOT use external data sources yet** - Stub user history, domain list, AI
3. **MUST use pure functions** - All rules must be deterministic
4. **MUST maintain backward compatibility** - All Story 2.1/2.2 tests must pass
5. **MUST log score breakdown** - Structured JSON with all rule contributions
6. **Side effects in handler only** - Scoring engine is pure logic

### Stub Data Sources for This Story

Since Epic 3 adds actual data sources, use these stubs:

```typescript
// Stub context for scoring (data unavailable)
interface ScoringContext {
  // From event (available)
  leaseId: string;
  userEmail: string;
  templateId: string;
  budgetAmount: number;
  leaseDurationHours: number;
  requestTimestamp: Date;

  // From user history (stubbed - empty)
  userLeaseHistory: never[];  // Empty in this story

  // From domain verification (stubbed - unverified)
  isVerifiedGovDomain: false;  // Always false in this story

  // From AI analysis (stubbed - not available)
  aiAnalysis?: undefined;  // Not available in this story
}
```

### Rule Implementation Notes

**Rules that work fully in this story (no external data needed):**
- Rule 8: `budget_amount` - Uses budgetAmount from event
- Rule 9: `duration_requested` - Uses leaseDurationHours from event
- Rule 10: `end_of_window` - Uses requestTimestamp

**Rules that use pessimistic fallback (external data stubbed):**
- Rule 1: `expired_leases` - No history = skip (no contribution)
- Rule 2: `budget_exceeded` - No history = skip (no contribution)
- Rule 3: `first_time_user` - No history = assume first-time (+5)
- Rule 4: `first_time_suspicious` - Skip (needs AI analysis)
- Rule 5: `verified_gov_domain` - Not verified = skip bonus (0)
- Rule 6: `familiar_template` - No history = skip bonus (0)
- Rule 7: `template_hopper` - No history = skip (0)
- Rule 11: `cooldown_violation` - No history = skip (0)
- Rule 12: `outside_target_audience` - Skip (needs AI)
- Rule 13: `manual_early_termination` - No history = skip (0)
- Rule 14: `org_recent_negative` - No history = skip (0)
- Rule 15: `org_clean_record` - No history = skip (0)
- Rule 16: `group_mailbox_detected` - Skip (needs AI)

**Expected score for typical request (no history, no AI):**
- first_time_user: +5 (assumed first-time)
- budget_amount: +N (based on budgetAmount / 10)
- duration_requested: +N (based on leaseDurationHours / 8)
- end_of_window: -2 or 0 (based on time)

### References

- [Source: architecture.md#Implementation-Patterns] - Pure function pattern
- [Source: architecture.md#Testing-Strategy] - 100% branch coverage on scoring
- [Source: epics.md#Story-2.3] - Full acceptance criteria
- [Source: 2-2-state-machine-with-decision-orchestration.md] - Previous story patterns

## Dev Agent Record

### Agent Model Used

claude-opus-4-5-20251101

### Debug Log References

### Completion Notes List

- Implemented 16-rule scoring engine with pure functions
- All rules deterministic and testable in isolation
- Pessimistic scoring for unavailable data (AI, history)
- Configurable weights via RULE_WEIGHTS environment variable
- Integrated with state machine SCORING handler
- 100% branch coverage achieved

### File List

**Created:**
- `src/scoring/types.ts` - RuleId, RuleWeights, ScoringContext, ScoringResult types
- `src/scoring/rules.ts` - 16 rule pure functions
- `src/scoring/engine.ts` - ScoringEngine factory with calculateScore
- `src/scoring/config.ts` - parseRuleWeights, loadScoringConfig with Zod validation
- `src/scoring/index.ts` - Public exports
- `test/scoring/types.test.ts` - Type and default weight tests
- `test/scoring/rules.test.ts` - 49 tests for all 16 rules
- `test/scoring/engine.test.ts` - Engine integration tests
- `test/scoring/config.test.ts` - Config parsing tests

**Modified:**
- `src/state-machine/handlers.ts` - Integrated scoring engine in SCORING handler
- `test/state-machine/handlers.test.ts` - Added HandlerConfig tests, updated score expectations
- `test/handler.test.ts` - Updated score expectations from stub to actual

