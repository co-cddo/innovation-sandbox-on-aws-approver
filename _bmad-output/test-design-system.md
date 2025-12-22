# System-Level Test Design

**Project:** innovation-sandbox-on-aws-approver
**Date:** 2025-12-22
**Mode:** System-Level Testability Review (Phase 3)
**Architecture Reference:** `_bmad-output/architecture.md`

---

## Testability Assessment

### Controllability: PASS

The architecture demonstrates strong controllability through:

| Aspect | Assessment | Evidence |
|--------|------------|----------|
| **State Control** | ✅ Excellent | DynamoDB for all persistent state; idempotency table allows resetting; factory functions for services enable complete mock injection |
| **External Dependencies** | ✅ Excellent | DI pattern with factory functions (`createDynamoService`, `createBedrockService`, etc.) enables full mock substitution |
| **Fault Injection** | ✅ Good | Circuit breaker class is testable in isolation (7 test cases specified); Bedrock failures can be simulated via mock |
| **Configuration Control** | ✅ Excellent | All config via Lambda environment variables; scoring weights passed as JSON; thresholds configurable |

**Controllability Rating:** 9/10 - Pure function state handlers and factory-based DI provide exceptional test controllability.

### Observability: PASS

| Aspect | Assessment | Evidence |
|--------|------------|----------|
| **State Inspection** | ✅ Excellent | State machine logs every transition with duration; structured JSON logging with full context |
| **Deterministic Results** | ✅ Good | Pure function scoring rules produce deterministic output; only AI analysis (Bedrock) introduces non-determinism |
| **NFR Validation** | ✅ Good | CloudWatch metrics for latency, scoring distribution, per-rule triggers; alarms for error rates |
| **Correlation** | ✅ Excellent | Correlation ID (`{leaseId}:{eventId}`) in all logs; traceId propagated through state machine |

**Observability Rating:** 8/10 - Comprehensive logging and metrics. Minor gap: No explicit distributed tracing integration (acceptable for single-Lambda architecture).

### Reliability: PASS

| Aspect | Assessment | Evidence |
|--------|------------|----------|
| **Test Isolation** | ✅ Excellent | State machine handlers are pure functions; DI enables isolated unit testing; no shared mutable state |
| **Reproducibility** | ✅ Good | Idempotency prevents duplicate processing; deterministic scoring for same inputs; circuit breaker has reproducible state transitions |
| **Loose Coupling** | ✅ Excellent | All AWS service interactions behind injected interfaces; Bedrock has explicit fallback path |

**Reliability Rating:** 9/10 - Architecture prioritizes testability through pure functions and explicit dependencies.

---

## Architecturally Significant Requirements (ASRs)

Risk-scored quality requirements that drive architecture and require special test consideration:

| ASR ID | Category | Requirement | Probability | Impact | Score | Test Approach |
|--------|----------|-------------|-------------|--------|-------|---------------|
| ASR-1 | PERF | End-to-end latency p95 <5s, p99 <8s | 2 | 2 | 4 | Unit tests for scoring (<2s); integration timing tests; CloudWatch metric validation |
| ASR-2 | REL | Zero lost requests (DLQ + idempotency) | 2 | 3 | **6** | Integration tests with simulated failures; idempotency retry verification |
| ASR-3 | REL | Fail-closed on all errors | 2 | 3 | **6** | Unit tests for error paths; integration tests with service failures |
| ASR-4 | REL | Graceful degradation when Bedrock unavailable | 3 | 2 | **6** | Circuit breaker unit tests (7 cases); fallback scoring verification |
| ASR-5 | SEC | IAM least-privilege enforcement | 1 | 3 | 3 | CDK snapshot tests with IAM assertion; fine-grained resource tests |
| ASR-6 | DATA | Score breakdown retained for audit | 1 | 2 | 2 | Unit tests for log structure; integration tests verify CloudWatch format |
| ASR-7 | BUS | Auto-approval rate ≥80% | 2 | 2 | 4 | Scoring engine property-based tests; edge case verification |
| ASR-8 | OPS | Config changes effective via redeployment | 1 | 1 | 1 | CDK test verifying env vars; integration test with modified config |

**High-Risk ASRs (Score ≥6):** ASR-2, ASR-3, ASR-4 require immediate mitigation through comprehensive test coverage.

### ASR Mitigations

| ASR | Mitigation Strategy | Owner | Test Type |
|-----|---------------------|-------|-----------|
| ASR-2 (Zero lost requests) | Idempotency unit tests; DLQ integration tests; retry simulation | Dev | Unit + Integration |
| ASR-3 (Fail-closed) | Error path unit tests for every state; integration tests with mock failures | Dev | Unit + Integration |
| ASR-4 (Bedrock degradation) | Circuit breaker 7-case test suite; fallback scoring tests | Dev | Unit |

---

## Test Levels Strategy

Based on architecture (event-driven Lambda backend, no UI):

| Test Level | Allocation | Rationale |
|------------|------------|-----------|
| **Unit** | 70% | Pure function scoring rules (16), state machine handlers, circuit breaker, business hours logic - all highly testable |
| **Integration** | 25% | AWS service mocks (DynamoDB, EventBridge, Bedrock, S3); E2E flows with LocalStack; contract validation |
| **E2E** | 5% | Interactive validation via ISB UI (4 milestones defined in epics); manual smoke tests |

### Test Level Decision Matrix

| Component | Unit | Integration | E2E | Rationale |
|-----------|:----:|:-----------:|:---:|-----------|
| Scoring rules (16) | ✅ 100% | - | - | Pure functions, deterministic, high priority |
| Scoring engine orchestration | ✅ 90% | ✅ | - | DI makes unit testing easy |
| State machine transitions | ✅ 100% | - | - | Pure function handlers |
| Circuit breaker | ✅ 100% | - | - | 7 specific test cases in architecture |
| Business hours detection | ✅ 100% | - | - | Pure function with timezone handling |
| DynamoDB service | ✅ | ✅ 80% | - | Mock client for unit; LocalStack for integration |
| EventBridge service | ✅ | ✅ 80% | - | Mock client for unit; schema validation |
| Bedrock service | ✅ | - | - | Mock responses; can't unit test AI output |
| Slack service | ✅ | - | - | Mock webhook; Block Kit schema validation |
| Handler (full flow) | - | ✅ | ✅ | Integration with mocks; E2E via ISB UI |
| CDK stacks | ✅ Snapshot | ✅ Fine-grained | - | Security-sensitive resources verified |

---

## NFR Testing Approach

### Security

| Requirement | Test Approach | Tools |
|-------------|---------------|-------|
| IAM least-privilege | CDK fine-grained assertions; no `*` resource policies | CDK assertions |
| Secrets Manager usage | Unit test verifies secret retrieval path; no hardcoded secrets | Vitest |
| No external API surface | CDK assertion: no API Gateway, no public endpoints | CDK assertions |

**Security Test Examples:**
```typescript
// CDK security assertion
expect(stack).toHaveResourceLike('AWS::IAM::Policy', {
  PolicyDocument: {
    Statement: Match.arrayWith([
      Match.objectLike({
        Resource: Match.not(Match.stringLikeRegexp('\\*'))
      })
    ])
  }
});
```

### Performance

| Requirement | Test Approach | Tools |
|-------------|---------------|-------|
| Scoring <2s | Unit test timing assertions | Vitest with timing |
| Cold start <4s | Manual verification; CloudWatch metrics | CloudWatch |
| E2E <5s p95 | Integration test timing; CloudWatch alarms | Vitest + CloudWatch |

**Performance Test Examples:**
```typescript
// Scoring engine performance test
test('scoring engine completes within 2 seconds', async () => {
  const start = performance.now();
  const result = await scoringEngine.calculateScore(mockContext);
  const duration = performance.now() - start;

  expect(duration).toBeLessThan(2000);
});
```

### Reliability

| Requirement | Test Approach | Tools |
|-------------|---------------|-------|
| Idempotency | Unit test with duplicate events | Vitest + mock |
| Fail-closed | Unit tests for all error paths | Vitest |
| Circuit breaker | 7 state transition tests | Vitest |
| DLQ handling | Integration test with poison event | LocalStack |

**Reliability Test Examples:**
```typescript
// Circuit breaker test suite
describe('CircuitBreaker', () => {
  test('closed → stays closed on success', ...);
  test('closed → stays closed on 1-2 failures', ...);
  test('closed → open after 3 failures', ...);
  test('open → returns null immediately', ...);
  test('open → half-open after recovery time', ...);
  test('half-open → closed on success', ...);
  test('half-open → open on failure', ...);
});
```

### Maintainability

| Requirement | Test Approach | Tools |
|-------------|---------------|-------|
| 90% line coverage | Coverage enforcement in CI | Vitest coverage |
| 100% branch on thresholds | Coverage thresholds for scoring | Vitest coverage |
| Contract tests | EventBridge schema validation | Zod + Vitest |

---

## Test Environment Requirements

| Environment | Purpose | Infrastructure |
|-------------|---------|---------------|
| **Local Unit** | Fast feedback; pure function tests | Node.js 20, Vitest |
| **Local Integration** | AWS service mocks | LocalStack (Docker) |
| **CI Integration** | Automated verification | GitHub Actions + LocalStack |
| **E2E Validation** | Interactive ISB testing | AWS us-west-2 (production-like) |

### Environment Setup

```bash
# Local development
npm install
npm test              # Unit tests
npm run test:coverage # With coverage

# Integration tests (requires Docker)
docker compose up -d localstack
npm run test:integration

# CI pipeline
npm run lint && npm run typecheck && npm test -- --coverage
cdk deploy
```

---

## Testability Concerns

No critical testability blockers identified. Minor concerns:

| Concern | Severity | Mitigation |
|---------|----------|------------|
| **Bedrock non-determinism** | Low | Mock Bedrock responses in tests; test fallback behavior instead of AI output |
| **Time-dependent business hours** | Low | Inject clock dependency; test with fixed timestamps |
| **UK bank holidays API** | Low | Cache ICS in tests; mock external fetch |
| **SQS delay timing** | Low | Mock SQS; test queue logic in isolation |

---

## Recommendations for Sprint 0

### Priority 1: Test Infrastructure Setup (Story 1.1)

1. **Configure Vitest** with coverage thresholds:
   ```typescript
   // vitest.config.ts
   export default defineConfig({
     test: {
       coverage: {
         provider: 'v8',
         thresholds: {
           lines: 90,
           branches: 100,
           functions: 90,
           statements: 90,
         },
         include: ['src/scoring/**'],
       },
     },
   });
   ```

2. **Create test fixtures** for common patterns:
   - `createMockLeaseEvent()` - EventBridge event factory
   - `createMockDynamoClient()` - DynamoDB mock
   - `createMockBedrockClient()` - Bedrock response mock

3. **Setup contract test schemas** with Zod:
   ```typescript
   // schemas/events.ts
   export const LeaseApprovedEventSchema = z.object({
     source: z.literal('innovation-sandbox'),
     'detail-type': z.literal('LeaseApproved'),
     detail: z.object({
       leaseId: z.string().uuid(),
       userEmail: z.string().email(),
       approvedBy: z.string(),
     }),
   });
   ```

### Priority 2: CDK Test Setup (Story 1.2)

1. **Snapshot tests** for all stacks
2. **Fine-grained assertions** for IAM policies
3. **Security assertions** for least-privilege

### Priority 3: CI Pipeline (Story 1.3)

1. **Coverage gates** - fail if below thresholds
2. **Contract validation** - EventBridge schema tests
3. **Security scan** - CDK Nag or similar

---

## Coverage Targets by Component

| Component | Line Coverage | Branch Coverage | Priority |
|-----------|---------------|-----------------|----------|
| `src/scoring/rules.ts` | 100% | 100% | P0 |
| `src/scoring/engine.ts` | 90% | 100% | P0 |
| `src/state-machine.ts` | 90% | 100% | P0 |
| `src/lib/circuit-breaker.ts` | 100% | 100% | P0 |
| `src/lib/business-hours.ts` | 100% | 100% | P1 |
| `src/services/dynamodb.ts` | 80% | 90% | P1 |
| `src/services/eventbridge.ts` | 80% | 90% | P1 |
| `src/services/bedrock.ts` | 80% | 90% | P2 |
| `src/services/slack.ts` | 80% | 90% | P2 |
| `src/handler.ts` | 70% | 80% | P2 |

---

## Quality Gate Criteria

For implementation-readiness gate check:

- [ ] **Testability Assessment**: All PASS (Controllability, Observability, Reliability)
- [ ] **High-Risk ASRs**: All mitigated (ASR-2, ASR-3, ASR-4)
- [ ] **Test Infrastructure**: Ready for Sprint 0
- [ ] **Coverage Targets**: Defined and enforceable
- [ ] **NFR Testing**: Approaches defined for all categories

**Gate Decision: PASS**

The architecture demonstrates excellent testability through:
1. Pure function scoring rules and state handlers
2. Factory-based dependency injection for all AWS services
3. Explicit circuit breaker with defined test cases
4. Comprehensive logging and metrics for observability
5. No testability blockers identified

---

## Summary

### Risk Assessment Summary

| Category | Count | High (≥6) | Medium (3-5) | Low (1-2) |
|----------|-------|-----------|--------------|-----------|
| PERF | 1 | 0 | 1 | 0 |
| REL | 3 | 3 | 0 | 0 |
| SEC | 1 | 0 | 1 | 0 |
| DATA | 1 | 0 | 0 | 1 |
| BUS | 1 | 0 | 1 | 0 |
| OPS | 1 | 0 | 0 | 1 |
| **Total** | 8 | 3 | 3 | 2 |

### Test Effort Estimate

| Test Level | Scenarios | Effort (hours) |
|------------|-----------|----------------|
| Unit (P0) | ~50 | 25 |
| Unit (P1) | ~30 | 15 |
| Integration | ~20 | 20 |
| E2E Milestones | 4 | 8 |
| **Total** | ~104 | ~68 hours |

### Next Steps

1. **Proceed to Implementation Readiness Check** - Architecture is testable
2. **Sprint 0 Focus** - Test infrastructure, coverage configuration, contract schemas
3. **Epic 1 Testing** - CDK stack tests, CI pipeline validation
4. **Epic 2 Focus** - Scoring engine 100% coverage, circuit breaker 7-case suite

---

*Generated by testarch-test-design workflow (System-Level Mode)*
*Architecture version: 2025-12-22*
