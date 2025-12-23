# Story 4.3: Rate Limiting per User and Organization

Status: done

## Story

As an **operator**,
I want **burst requests from the same user or organization to be rate-limited**,
So that **one user can't monopolize sandbox accounts**.

## Acceptance Criteria

1. **AC1: User request frequency check**
   - Given rate limiting is required (FR26)
   - When a request is received
   - Then check user's request frequency in last hour
   - And track requests by userEmail

2. **AC2: User rate limit penalty**
   - Given user rate limit check (FR27)
   - When user has submitted 2+ requests in last hour
   - Then apply rate limit penalty: +5 per additional request beyond 2
   - And log `rateLimitPenalty: { user: <count>, penalty: <points> }`

3. **AC3: Organization rate limit check**
   - Given organization rate limit check
   - When organization (domain) has submitted 5+ requests in last hour from different users
   - Then apply org rate limit penalty: +3
   - And log `rateLimitPenalty: { org: <count>, penalty: <points> }`

4. **AC4: Rate limit tracking persistence**
   - Given rate limit tracking
   - When tracking request frequency
   - Then use user lease history from DynamoDB (existing getUserLeaseHistory)
   - And filter to requests within the last hour
   - And requests older than 1 hour are not counted

5. **AC5: Rate limit integration with scoring**
   - Given a request is rate-limited but not blocked
   - When the score is calculated
   - Then rate limit penalty is added to total score
   - And request may still auto-approve if total score < threshold
   - And or escalate if total score >= threshold

## Tasks / Subtasks

- [x] Task 1: Add rate limit rules to scoring types (AC: 1, 2, 3)
  - [x] Add `user_rate_limit` to RULE_IDS array in types.ts
  - [x] Add `org_rate_limit` to RULE_IDS array in types.ts
  - [x] Add default weights: user_rate_limit: 5, org_rate_limit: 3
  - [x] Update RuleWeights type and DEFAULT_RULE_WEIGHTS

- [x] Task 2: Implement user rate limit rule (AC: 1, 2, 4)
  - [x] Create `userRateLimitRule` function in rules.ts
  - [x] Filter userLeaseHistory to requests in last hour (by `created` timestamp)
  - [x] Count requests in time window
  - [x] Apply penalty: if count > 2, add +5 per additional request
  - [x] Return ScoringRuleResult with count and penalty details

- [x] Task 3: Implement organization rate limit rule (AC: 3, 4)
  - [x] Create `orgRateLimitRule` function in rules.ts
  - [x] Filter orgLeaseHistory to requests in last hour
  - [x] Count unique users submitting in time window
  - [x] Apply penalty: if 5+ requests from different users, add +3
  - [x] Return ScoringRuleResult with org count and penalty

- [x] Task 4: Integrate rules into scoring engine (AC: 5)
  - [x] Add `user_rate_limit` rule to ALL_RULES map
  - [x] Add `org_rate_limit` rule to ALL_RULES map
  - [x] Ensure rules are evaluated with existing scoring flow
  - [x] Rate limit penalties added to total score

- [x] Task 5: Update scoring context if needed (AC: 4)
  - [x] Verify userLeaseHistory has `created` timestamp
  - [x] Verify orgLeaseHistory has `created` timestamp
  - [x] No new fields needed - use existing history data

- [x] Task 6: Write unit tests for rate limit rules (AC: 1-5)
  - [x] Test user with 0-2 requests in last hour (no penalty)
  - [x] Test user with 3 requests in last hour (+5 penalty)
  - [x] Test user with 5 requests in last hour (+15 penalty)
  - [x] Test org with <5 users in last hour (no penalty)
  - [x] Test org with 5+ users in last hour (+3 penalty)
  - [x] Test time window boundary (requests exactly 1hr ago excluded)
  - [x] Test integration with total score calculation

- [x] Task 7: Update handler logging (AC: 2, 3)
  - [x] Log rate limit check results in scoring breakdown
  - [x] Include count and penalty in structured logs
  - [x] Follow existing logging patterns

## Dev Notes

### Rate Limit Strategy

This implementation uses **soft scoring penalties** rather than hard blocks:
- Users CAN still submit requests during rate limit
- Penalty points are added to their total score
- High penalties may trigger escalation if score >= threshold
- This provides intelligence about who attempts burst requests

### Time Window Calculation

Use the `created` timestamp from lease history records:
```typescript
const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
const recentRequests = userLeaseHistory.filter(
  lease => new Date(lease.created) > oneHourAgo
);
```

### Rule Weights

| Rule | Weight | Condition |
|------|--------|-----------|
| `user_rate_limit` | +5 per extra | 3rd+ request in last hour |
| `org_rate_limit` | +3 flat | 5+ different users in last hour |

### Penalty Calculation Examples

**User Rate Limit:**
- 1-2 requests/hr: 0 penalty
- 3 requests/hr: +5 (1 extra × 5)
- 4 requests/hr: +10 (2 extra × 5)
- 5 requests/hr: +15 (3 extra × 5)

**Org Rate Limit:**
- <5 unique users/hr: 0 penalty
- 5+ unique users/hr: +3 flat penalty

### Existing Infrastructure to Use

From Story 3.1 and 3.2:
- `getUserLeaseHistory(userEmail)` - returns user's lease history
- `getOrgLeaseHistory(domain, excludeEmail)` - returns org history
- Both return `LeaseHistoryRecord[]` with `created` timestamp

### Implementation Pattern

Follow the existing rule pattern from `src/scoring/rules.ts`:
```typescript
export const userRateLimitRule: ScoringRuleFn = (
  context: ScoringContext,
  weight: number
): ScoringRuleResult => {
  const oneHourAgo = new Date(context.requestTimestamp.getTime() - 60 * 60 * 1000);
  const recentCount = context.userLeaseHistory.filter(
    lease => new Date(lease.created) > oneHourAgo
  ).length;

  const excessRequests = Math.max(0, recentCount - 2);
  const points = excessRequests * weight;

  return {
    ruleId: 'user_rate_limit',
    points,
    triggered: points > 0,
    reason: points > 0
      ? `User submitted ${recentCount} requests in last hour (${excessRequests} over limit)`
      : 'User within rate limit',
  };
};
```

### No DynamoDB Changes Needed

Rate limiting uses existing lease history data:
- User requests tracked via userLeaseHistory query
- Org requests tracked via orgLeaseHistory query
- No new tables or indexes required
- TTL-based cleanup handled by existing ISB infrastructure

### Project Structure Notes

Files to modify:
- `src/scoring/types.ts` - Add new rule IDs and default weights
- `src/scoring/rules.ts` - Add rule implementations
- `src/scoring/engine.ts` - Register new rules
- `test/scoring/rules.test.ts` - Add rule unit tests
- `test/scoring/engine.test.ts` - Add integration tests

### Testing Strategy

1. **Unit tests** for each rule in isolation
2. **Integration tests** verifying rules in scoring engine
3. **Edge cases**: empty history, exactly 1hr boundary, mixed scenarios

### References

- [Source: epics.md#Story-4.3] - Story acceptance criteria
- [Source: prd.md#Rate-Limiting] - FR26, FR27 requirements
- [Source: src/scoring/rules.ts] - Existing rule implementations
- [Source: src/scoring/types.ts] - Rule types and interfaces
- [Source: src/services/dynamodb.ts] - Lease history queries

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

N/A - All tests pass

### Completion Notes List

- Implemented `userRateLimitRule` - +5 per request beyond 2/hour
- Implemented `orgRateLimitRule` - +3 flat if 5+ unique users/hour from same org
- Extended RULE_IDS from 16 to 18 rules
- Added 15 new unit tests covering all edge cases
- Rate limit logging integrated via existing scoring engine breakdown
- No DynamoDB changes needed - uses existing lease history data

### File List

- `src/scoring/types.ts` - Added user_rate_limit, org_rate_limit to RULE_IDS and DEFAULT_RULE_WEIGHTS
- `src/scoring/rules.ts` - Added userRateLimitRule and orgRateLimitRule implementations
- `src/scoring/engine.ts` - Updated comments to reflect 18 rules
- `test/scoring/rules.test.ts` - Added 15 new tests for rate limit rules
- `test/scoring/types.test.ts` - Updated rule count assertions from 16 to 18
- `test/scoring/engine.test.ts` - Updated rule count assertion from 16 to 18
- `test/state-machine/handlers.test.ts` - Updated rule count assertion from 16 to 18
- `_bmad-output/implementation-artifacts/sprint-status.yaml` - Updated story status
