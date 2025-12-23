# Story 3.2: Organization Reputation Tracking

Status: done

## Story

As an **operator**,
I want **organization-wide patterns to influence individual scores**,
so that **a problematic user from an organization affects their colleagues' scores temporarily**.

## Acceptance Criteria

1. **AC1: Extract domain from userEmail (FR19)**
   - Given a lease request is received
   - When the scoring engine queries organization history
   - Then it extracts the domain from `userEmail` (e.g., `@councilname.gov.uk`)
   - And handles email formats correctly (case-insensitive domain extraction)

2. **AC2: Query organization history from DynamoDB (FR19)**
   - Given a domain is extracted
   - When querying organization history
   - Then query ISB Leases table for all users matching `@domain` pattern
   - And filter out the current user's own leases (org rules apply to OTHER users)
   - And retrieve leases from the last 90 days

3. **AC3: Org recent negative penalty - Rule #14 (FR20)**
   - Given organization history is retrieved
   - When calculating org_recent_negative rule
   - Then count leases from OTHER users at same domain with status `BudgetExceeded` or `Expired` in last 30 days
   - And if count > 0 → apply +3 penalty (temporary org penalty)

4. **AC4: Org clean record bonus - Rule #15**
   - Given organization history is retrieved
   - When calculating org_clean_record rule
   - Then if domain has 5+ leases in last 90 days AND zero negative outcomes → apply -2 bonus
   - And "negative outcomes" means status in [`BudgetExceeded`, `Expired`]
   - And "successful" means status in [`Active`, `ManuallyTerminated`] (or naturally completed)

5. **AC5: Cross-organization logging for security review (FR21)**
   - Given logging scoring decisions
   - When a decision is made
   - Then include `domain` in structured logs for security review
   - And enable querying by domain for pattern detection

6. **AC6: Pessimistic fallback on organization query failure**
   - Given organization query fails
   - When calculating org rules
   - Then pessimistic scoring applies:
     - Skip bonuses (org_clean_record: 0)
     - Skip penalties (org_recent_negative: 0 - can't penalize without data)
   - And log the failure
   - And continue with scoring (don't fail the entire request)

## Tasks / Subtasks

- [x] Task 1: Create domain extraction utility (AC: 1)
  - [x] Create `src/lib/domain.ts` with:
    - `extractDomain(email: string): string` - extracts domain from email
    - Handles case-insensitivity (lowercase domain)
    - Validates email format
  - [x] Add unit tests in `test/lib/domain.test.ts`

- [x] Task 2: Extend DynamoDB service for organization queries (AC: 2)
  - [x] Update `src/services/dynamodb.ts`:
    - Add `getOrgLeaseHistory(domain: string, excludeEmail?: string): Promise<LeaseHistoryRecord[]>`
    - Query using scan with filter on `userEmail` contains `@domain`
    - OR use GSI if available (check ISB schema)
    - Exclude current user's leases when `excludeEmail` provided
  - [x] Add unit tests for org query

- [x] Task 3: Update handler to query org history (AC: 2, 6)
  - [x] Update `src/handler.ts`:
    - Extract domain from userEmail
    - Query org history after user history
    - Pass org history to state machine context
    - Handle errors with pessimistic fallback

- [x] Task 4: Implement org_recent_negative rule #14 (AC: 3)
  - [x] Update `src/scoring/rules.ts`:
    - Filter orgLeaseHistory to last 30 days
    - Count leases with status `BudgetExceeded` or `Expired`
    - Apply +3 penalty if count > 0
  - [x] Add unit tests for rule #14

- [x] Task 5: Implement org_clean_record rule #15 (AC: 4)
  - [x] Update `src/scoring/rules.ts`:
    - Filter orgLeaseHistory to last 90 days
    - Check if 5+ leases AND zero negative outcomes
    - Apply -2 bonus if clean
  - [x] Add unit tests for rule #15

- [x] Task 6: Add domain to structured logging (AC: 5)
  - [x] Update `src/handler.ts`:
    - Add `domain` to logger context via `logger.appendKeys()`
    - Include domain in decision logs

- [x] Task 7: Integration tests for org-aware scoring (AC: 1-6)
  - [x] Update `test/handler.test.ts`:
    - Test org history query with domain extraction
    - Test org_recent_negative penalty
    - Test org_clean_record bonus
    - Test pessimistic fallback on org query error

## Dev Notes

### Architecture Patterns & Constraints

**From Story 3.1 (Previous Story):**
- Factory pattern with DI for AWS services
- Pure function scoring rules
- Pessimistic fallback on DynamoDB errors
- StateContext extended with `userLeaseHistory` and `orgLeaseHistory`
- `isWithinDays()` helper already exists in `src/services/dynamodb.ts`

**DynamoDB Query Strategy:**

The ISB Leases table has `userEmail` as partition key. To query by domain:

**Option A: Scan with Filter (Simpler, less efficient)**
```typescript
const getOrgLeaseHistory = async (
  domain: string,
  excludeEmail?: string
): Promise<LeaseHistoryRecord[]> => {
  const command = new ScanCommand({
    TableName: tableName,
    FilterExpression: 'contains(userEmail, :domain)',
    ExpressionAttributeValues: {
      ':domain': `@${domain}`,
    },
  });
  const response = await client.send(command);
  // Filter out current user if excludeEmail provided
  return (response.Items ?? [])
    .filter(item => item.userEmail !== excludeEmail)
    .map(item => ({...}));
};
```

**Option B: Check for GSI (Preferred if available)**
If ISB has a GSI on domain or similar, use Query instead of Scan.

**Recommendation:** Start with Scan for correctness, optimize later if needed. For 500 requests/day (NFR-SCALE-01), Scan is acceptable.

### ISB DynamoDB Schema Reference

**From isb-integration-reference.md:**
```typescript
type LeaseStatus =
  | "PendingApproval"
  | "ApprovalDenied"
  | "Active"
  | "Frozen"
  | "Expired"              // Negative outcome
  | "BudgetExceeded"       // Negative outcome
  | "ManuallyTerminated"   // Successful (user-initiated)
  | "AccountQuarantined"
  | "Ejected";
```

**Negative Outcomes:** `Expired`, `BudgetExceeded`
**Successful Outcomes:** `Active`, `ManuallyTerminated`, possibly `Expired` if natural completion (but PRD treats Expired as negative for org rules)

### Domain Extraction

```typescript
// src/lib/domain.ts
export const extractDomain = (email: string): string => {
  const atIndex = email.lastIndexOf('@');
  if (atIndex === -1) {
    throw new Error(`Invalid email format: ${email}`);
  }
  return email.substring(atIndex + 1).toLowerCase();
};

// Example: "sarah.jones@councilname.gov.uk" → "councilname.gov.uk"
```

### Rule #14 Implementation

```typescript
// org_recent_negative rule
export const orgRecentNegativeRule: ScoringRuleFn = (context, weight) => {
  const negativeStatuses: LeaseStatus[] = ['BudgetExceeded', 'Expired'];

  const recentNegative = context.orgLeaseHistory.filter(
    l => negativeStatuses.includes(l.status) &&
         isWithinDays(l.created, 30, context.requestTimestamp)
  );

  const hasNegative = recentNegative.length > 0;

  return {
    ruleId: 'org_recent_negative',
    points: hasNegative ? weight : 0,
    triggered: hasNegative,
    reason: hasNegative
      ? `Organization has ${recentNegative.length} negative outcome(s) in last 30 days`
      : undefined,
  };
};
```

### Rule #15 Implementation

```typescript
// org_clean_record rule
export const orgCleanRecordRule: ScoringRuleFn = (context, weight) => {
  const negativeStatuses: LeaseStatus[] = ['BudgetExceeded', 'Expired'];

  // Filter to last 90 days
  const recentOrg = context.orgLeaseHistory.filter(
    l => isWithinDays(l.created, 90, context.requestTimestamp)
  );

  // Need 5+ leases for this rule
  if (recentOrg.length < 5) {
    return {
      ruleId: 'org_clean_record',
      points: 0,
      triggered: false,
    };
  }

  // Check for any negative outcomes
  const hasNegative = recentOrg.some(l => negativeStatuses.includes(l.status));
  const isClean = !hasNegative;

  return {
    ruleId: 'org_clean_record',
    points: isClean ? weight : 0, // weight is negative (-2 bonus)
    triggered: isClean,
    reason: isClean
      ? `Organization has clean record (${recentOrg.length} leases, 0 negative)`
      : undefined,
  };
};
```

### Handler Updates

```typescript
// In src/handler.ts, after queryUserHistory:

const queryOrgHistory = async (
  userEmail: string
): Promise<LeaseHistoryRecord[]> => {
  if (!dynamoDBService) {
    logger.warn('DynamoDB service not configured - skipping org history');
    return [];
  }

  try {
    const domain = extractDomain(userEmail);
    const history = await dynamoDBService.getOrgLeaseHistory(domain, userEmail);
    logger.info('Org history retrieved', {
      domain,
      leaseCount: history.length,
    });
    return history;
  } catch (error) {
    // Pessimistic fallback - empty history means no penalties or bonuses
    logger.error('Failed to query org history - using pessimistic fallback', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
};
```

### Project Structure Notes

**Files to Create:**
```
src/
├── lib/
│   └── domain.ts          # Domain extraction utility

test/
├── lib/
│   └── domain.test.ts     # Unit tests for domain extraction
```

**Files to Modify:**
- `src/services/dynamodb.ts` - Add `getOrgLeaseHistory()` method
- `src/handler.ts` - Query org history, add domain to logging
- `src/scoring/rules.ts` - Rules #14 and #15 already exist but need real implementation
- `test/services/dynamodb.test.ts` - Add org query tests
- `test/handler.test.ts` - Add org integration tests

### Previous Story Learnings (Story 3.1)

**From Story 3.1 Implementation:**
- `isWithinDays()` helper works well for date filtering
- DynamoDB service uses factory pattern with DI
- Handler queries history before state machine runs
- StateContext already has `orgLeaseHistory: LeaseHistoryRecord[]` field
- Pessimistic fallback returns empty array and logs warning

**Existing Infrastructure:**
- `src/services/dynamodb.ts` has `DynamoDBService` interface
- `src/state-machine/types.ts` has `orgLeaseHistory` field ready
- Rules #14 and #15 exist but use stub data (empty history)

### Testing Strategy

**Unit Tests Required:**

1. `domain.test.ts`
   - Extract domain from valid email
   - Handle various email formats (subdomains, unusual TLDs)
   - Throw on invalid email format

2. `dynamodb.test.ts` (additions)
   - Query org history returns leases for domain
   - Query org history excludes current user
   - Query org history handles empty results
   - Query org history handles DynamoDB errors

3. `rules.test.ts` (additions)
   - org_recent_negative: 0 negative, 1 negative, multiple negative
   - org_recent_negative: only counts last 30 days
   - org_clean_record: <5 leases (no bonus)
   - org_clean_record: 5+ leases with negative (no bonus)
   - org_clean_record: 5+ leases all clean (apply -2 bonus)
   - org_clean_record: only counts last 90 days

4. `handler.test.ts` (additions)
   - Org history query success with domain extraction
   - Org history query failure uses pessimistic fallback
   - Domain added to logger context

**Coverage Targets:**
- Lines: 90%+
- Branches: 90%+

### Critical Warnings

1. **Scan vs Query:** Using Scan for org history is acceptable for current scale but may need GSI optimization later
2. **Exclude current user:** Org rules apply to OTHER users, not the requester
3. **Case sensitivity:** Domain extraction must be case-insensitive (lowercase)
4. **Empty org history:** Don't apply penalties or bonuses if no org history available
5. **Rule #14 and #15 already exist:** They're in rules.ts but using empty stub data - update to use real orgLeaseHistory

### Environment Variables

| Variable | Purpose | Already Exists |
|----------|---------|----------------|
| `ISB_LEASES_TABLE_NAME` | ISB Leases DynamoDB table name | Yes (from Story 3.1) |

No new environment variables required.

### References

- [Source: epics.md#Story-3.2] - Full acceptance criteria
- [Source: isb-integration-reference.md#DynamoDB-Tables] - Lease table schema
- [Source: isb-integration-reference.md#Lease-Status-Values] - Status enum
- [Source: architecture.md#Implementation-Patterns] - DI and error handling
- [Source: 3-1-dynamodb-user-history-queries.md] - Previous story patterns

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

- All 390 tests passing
- Coverage: Lines 98%+, Branches 96%+

### Completion Notes List

- Domain extraction utility created with case-insensitive handling
- DynamoDB service extended with getOrgLeaseHistory() using Scan for domain matching
- Handler updated to query org history and add domain to structured logging
- Rule #14 (org_recent_negative) updated to count negative outcomes with descriptive reason
- Rule #15 (org_clean_record) updated to require 5+ leases before applying bonus
- Integration tests added for org history query and pessimistic fallback
- Code review fixes: Added pagination for DynamoDB Scan, fixed edge case for empty domain

### File List

**New Files:**
- `src/lib/domain.ts` - Domain extraction utility with extractDomain()
- `test/lib/domain.test.ts` - Unit tests for domain extraction (15 tests)

**Modified Files:**
- `src/services/dynamodb.ts` - Added getOrgLeaseHistory() with pagination support
- `src/handler.ts` - Added queryOrgHistory(), domain extraction, and domain logging
- `src/scoring/rules.ts` - Updated rules #14 and #15 with correct logic
- `test/services/dynamodb.test.ts` - Added org history tests (8 tests including pagination)
- `test/scoring/rules.test.ts` - Updated org rule tests (7 tests)
- `test/handler.test.ts` - Added org history integration tests (4 tests)
