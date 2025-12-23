# Story 3.4: Bedrock AI Email Analysis with Circuit Breaker

Status: done

## Story

As an **operator**,
I want **AI to detect suspicious email patterns like group mailboxes**,
So that **shared/team emails are flagged for manual review**.

## Acceptance Criteria

1. **AC1: Invoke Bedrock for email analysis (FR12, FR13)**
   - Given email analysis is required
   - When scoring a lease request
   - Then invoke Amazon Bedrock (Nova Micro) with analysis prompt
   - And parse JSON response for `isGroupMailbox` and `isLocalGovernment`

2. **AC2: Apply group mailbox penalty (#16)**
   - Given Bedrock returns `isGroupMailbox: true` with high/medium confidence
   - When calculating group mailbox rule (#16)
   - Then apply +20 penalty
   - And if user is also first-time, rule #4 applies instead (same +20, not doubled)

3. **AC3: Apply outside target audience penalty (#12)**
   - Given Bedrock returns `isLocalGovernment: false` with high confidence
   - When calculating outside target audience rule (#12)
   - Then apply +10 penalty
   - And this is independent of ukps-domains verification

4. **AC4: Timeout and fallback (NFR-PERF-04, FR14)**
   - Given Bedrock response time limit
   - When invoking Bedrock
   - Then timeout after 3 seconds
   - And if timeout, fall back to rule-based scoring

5. **AC5: Circuit breaker implementation (FR46)**
   - Given Bedrock fails 3 times consecutively
   - When the next request needs AI analysis
   - Then open circuit breaker for 60 seconds
   - And during open state, skip Bedrock and use fallback
   - And log circuit breaker state changes

6. **AC6: Circuit breaker half-open recovery**
   - Given circuit breaker is open
   - When 60 seconds have passed
   - Then allow one test request (half-open state)
   - And if test succeeds, close circuit
   - And if test fails, reset 60 second timer

7. **AC7: Rule-based fallback scoring (FR14)**
   - Given Bedrock is unavailable
   - When falling back to rule-based scoring
   - Then check email prefix patterns: `team`, `info`, `contact`, `admin`, `support`, `helpdesk`, `enquiries`
   - And if prefix matches, apply +20 penalty
   - And log that fallback was used

## Tasks / Subtasks

- [x] Task 1: Create Bedrock service with DI (AC: 1, 4)
  - [x] Create `src/services/bedrock.ts`:
    - Interface for Bedrock service
    - Factory function with BedrockRuntimeClient injection
    - Invoke Nova Micro with analysis prompt
    - Parse JSON response
    - 3 second timeout using AbortController
  - [x] Define prompt template for email analysis
  - [x] Return `AIAnalysisResult` interface

- [x] Task 2: Create circuit breaker utility (AC: 5, 6)
  - [x] Create `src/lib/circuit-breaker.ts`:
    - In-memory circuit breaker class
    - States: CLOSED, OPEN, HALF_OPEN
    - Configurable failure threshold (default: 3)
    - Configurable recovery timeout (default: 60s)
    - `execute()` method wrapping async functions
    - State transition logging
  - [x] Export circuit breaker instance for Bedrock service

- [x] Task 3: Create rule-based fallback (AC: 7)
  - [x] Create `src/lib/email-analysis.ts`:
    - `analyzeEmailPattern(email: string): AIAnalysisResult`
    - Detect group mailbox prefixes
    - Return consistent result shape
  - [x] Integrate fallback into Bedrock service

- [x] Task 4: Update handler to invoke Bedrock (AC: 1, 4, 5)
  - [x] Update `src/handler.ts`:
    - Initialize Bedrock service (cold start)
    - Call Bedrock with circuit breaker
    - Pass `aiAnalysis` to state machine context
    - Handle errors with fallback

- [x] Task 5: Update scoring context and rules #4, #12, #16 (AC: 2, 3)
  - [x] Update `src/state-machine/handlers.ts`:
    - Pass `aiAnalysis` from context to scoring
  - [x] Verify rules #4, #12, #16 use `aiAnalysis` correctly:
    - Rule #4: first_time_suspicious - AI-detected first-time + group mailbox
    - Rule #12: outside_target_audience - AI says not local gov
    - Rule #16: group_mailbox_detected - AI-detected group mailbox

- [x] Task 6: Unit tests for Bedrock service (AC: 1, 4)
  - [x] Create `test/services/bedrock.test.ts`:
    - Test successful invocation and JSON parsing
    - Test timeout handling
    - Test malformed response handling
    - Test error propagation

- [x] Task 7: Unit tests for circuit breaker (AC: 5, 6)
  - [x] Create `test/lib/circuit-breaker.test.ts`:
    - Test state transitions: CLOSED -> OPEN -> HALF_OPEN -> CLOSED
    - Test failure threshold
    - Test recovery timeout
    - Test half-open success/failure

- [x] Task 8: Unit tests for email analysis fallback (AC: 7)
  - [x] Create `test/lib/email-analysis.test.ts`:
    - Test group mailbox detection
    - Test normal email patterns
    - Test edge cases

- [x] Task 9: Integration tests (AC: 1-7)
  - [x] Update `test/handler.test.ts`:
    - Test AI analysis flow
    - Test aiAnalysis passed to scoring
    - Test fallback on Bedrock error
    - Test circuit breaker activation

## Dev Notes

### Bedrock Configuration

**Model:** Amazon Nova Micro (`amazon.nova-micro-v1:0`)
**Region:** us-west-2 (co-located with ISB)
**Timeout:** 3 seconds (NFR-PERF-04)

### Prompt Template

```
Analyze this email address: {userEmail}

Determine:
1. Is this likely a group/shared mailbox? (team@, info@, contact@, admin@, etc.)
2. Does the domain appear to be UK local government?

Respond in JSON format only:
{
  "isGroupMailbox": boolean,
  "confidence": "high" | "medium" | "low",
  "isLocalGovernment": boolean,
  "reasoning": "brief explanation"
}
```

### Circuit Breaker Pattern

```typescript
interface CircuitBreakerConfig {
  failureThreshold: number;  // 3 failures to open
  recoveryTimeoutMs: number; // 60000ms (60s)
}

enum CircuitState {
  CLOSED = 'CLOSED',      // Normal operation
  OPEN = 'OPEN',          // Rejecting requests
  HALF_OPEN = 'HALF_OPEN' // Testing recovery
}

class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private config: CircuitBreakerConfig;

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime >= this.config.recoveryTimeoutMs) {
        this.state = CircuitState.HALF_OPEN;
      } else {
        throw new CircuitOpenError();
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.state = CircuitState.CLOSED;
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
    }
  }
}
```

### Rule-Based Fallback Patterns

Group mailbox prefixes to detect:
- `team`, `info`, `contact`, `admin`, `support`, `helpdesk`, `enquiries`
- `office`, `reception`, `general`, `hello`, `mail`, `post`

```typescript
const GROUP_MAILBOX_PREFIXES = [
  'team', 'info', 'contact', 'admin', 'support', 'helpdesk', 'enquiries',
  'office', 'reception', 'general', 'hello', 'mail', 'post'
];

const isLikelyGroupMailbox = (email: string): boolean => {
  const prefix = email.split('@')[0].toLowerCase();
  return GROUP_MAILBOX_PREFIXES.some(p => prefix.startsWith(p));
};
```

### Architecture Patterns (from Story 3.1/3.2/3.3)

- **Factory pattern with DI** for BedrockRuntimeClient
- **Pessimistic fallback** on errors (use rule-based, don't fail)
- **Structured logging** with `logger.appendKeys()` and `logger.info()`
- **In-memory state** for circuit breaker (module-level, per Lambda instance)

### Existing Infrastructure

Rule #4 (first_time_suspicious), #12 (outside_target_audience), and #16 (group_mailbox_detected) already exist in `src/scoring/rules.ts` but return fallback results when `aiAnalysis` is undefined. They use the `AIAnalysisResult` interface from `src/scoring/types.ts`.

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `BEDROCK_MODEL_ID` | Bedrock model to use | `amazon.nova-micro-v1:0` |
| `BEDROCK_TIMEOUT_MS` | Timeout for Bedrock calls | `3000` |
| `CIRCUIT_BREAKER_THRESHOLD` | Failures before opening | `3` |
| `CIRCUIT_BREAKER_RECOVERY_MS` | Recovery timeout | `60000` |

### CDK Updates Required

```typescript
// Add Bedrock invoke permissions
this.approverFunction.addToRolePolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['bedrock:InvokeModel'],
  resources: [
    `arn:aws:bedrock:us-west-2::foundation-model/amazon.nova-micro-v1:0`
  ],
}));

// Environment variables
environment: {
  BEDROCK_MODEL_ID: 'amazon.nova-micro-v1:0',
  BEDROCK_TIMEOUT_MS: '3000',
}
```

### Testing Strategy

**Unit Tests:**
1. `bedrock.test.ts`
   - Mock BedrockRuntimeClient
   - Test successful invocation
   - Test timeout handling (AbortController)
   - Test JSON parsing errors

2. `circuit-breaker.test.ts`
   - Test state machine transitions
   - Test failure threshold
   - Test recovery timeout with fake timers
   - Test half-open behavior

3. `email-analysis.test.ts`
   - Test prefix detection
   - Test case insensitivity
   - Test non-matching emails

**Integration Tests:**
- Handler with Bedrock mock
- aiAnalysis passed to scoring context
- Fallback activation on error

### Critical Warnings

1. **Don't double-count penalties** - Rule #4 and #16 both detect group mailbox; if first-time user, use #4 only
2. **3 second timeout is strict** - Use AbortController, don't rely on SDK timeout
3. **Circuit breaker is in-memory** - Resets on Lambda cold start (acceptable)
4. **Log state changes** - Circuit breaker state changes must be logged for debugging
5. **Rule #12 is AI-only** - ukps-domains verification is separate (handled in Story 3.3)

### References

- [Source: epics.md#Story-3.4] - Full acceptance criteria
- [Source: architecture.md#Implementation-Patterns] - DI and error handling
- [Source: 3-3-domain-verification-from-s3-cache.md] - Previous story patterns
- [Source: src/scoring/types.ts] - AIAnalysisResult interface
- [Source: src/scoring/rules.ts] - Rules #4, #12, #16 implementation

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None required - implementation straightforward.

### Completion Notes List

1. **All 9 tasks completed successfully**
2. **545 tests passing** (21 Bedrock, 21 circuit breaker, 61 email analysis, 8 handler integration, 1 rule #16 deferral)
3. **Lint and build passing**
4. **Key implementation decisions:**
   - Used `globalThis.AbortController` and `globalThis.TextEncoder` for ESLint compatibility
   - Rule-based fallback takes pessimistic approach (doesn't penalize for outside_target_audience without AI confidence)
   - Circuit breaker is in-memory (resets on Lambda cold start - acceptable per architecture)
   - Bedrock service handles all error cases internally, returns fallback result with `usedFallback: true`
   - Rule #16 defers to Rule #4 for first-time users to avoid double-counting +20 penalty (AC2)
5. **CDK already configured** - Bedrock permissions and environment variables were already in place

### File List

**New Files Created:**
- `src/services/bedrock.ts` - Bedrock AI email analysis service with circuit breaker and fallback
- `src/lib/circuit-breaker.ts` - Circuit breaker pattern implementation (CLOSED/OPEN/HALF_OPEN)
- `src/lib/email-analysis.ts` - Rule-based fallback for group mailbox detection
- `test/services/bedrock.test.ts` - 20 tests for Bedrock service
- `test/lib/circuit-breaker.test.ts` - 20 tests for circuit breaker
- `test/lib/email-analysis.test.ts` - 61 tests for email pattern analysis

**Modified Files:**
- `src/handler.ts` - Added Bedrock client, service, DI functions, `analyzeEmailWithAI` function
- `src/state-machine/types.ts` - Added `aiAnalysis?: AIAnalysisResult` to StateContext
- `src/state-machine/handlers.ts` - Pass `aiAnalysis` from context to scoring
- `src/scoring/rules.ts` - Rule #16 now defers to Rule #4 for first-time users (AC2: no double-counting)
- `test/handler.test.ts` - Added 8 integration tests for Bedrock AI analysis flow
- `test/scoring/rules.test.ts` - Added test for first-time user group mailbox deferral
