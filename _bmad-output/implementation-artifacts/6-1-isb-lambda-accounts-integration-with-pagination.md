# Story 6.1: ISB Lambda `/api/accounts` Integration with Pagination

Status: done

## Story

As a **developer**,
I want **to query the ISB account pool status via direct Lambda invocation**,
So that **the Approver can check which accounts are available and their readiness state**.

## Acceptance Criteria

1. **AC1: Extend existing isb-lambda.ts service (FR58)**
   - Given the existing `src/services/isb-lambda.ts` service
   - When extending the service
   - Then add `getAccounts()` method that:
     - Invokes ISB Lambda with `/api/accounts` path (ADR-001: Direct Lambda)
     - Uses same `createApiGatewayEvent()` pattern as existing methods
     - Returns array of account objects

2. **AC2: Pagination support (FR59)**
   - Given the response includes `nextPageIdentifier`
   - When fetching accounts
   - Then continue fetching until `nextPageIdentifier` is null
   - And aggregate all results into single array
   - And log `totalAccountsFetched` and `pagesTraversed` for debugging

3. **AC3: Account response schema validation**
   - Given the account response from ISB
   - When parsing the response
   - Then extract and validate:
   ```typescript
   interface Account {
     awsAccountId: string;
     name: string;           // e.g., "pool-005"
     status: 'Available' | 'Active';
     meta: {
       createdTime: string;  // ISO 8601
       lastEditTime: string; // ISO 8601
     };
   }
   ```

4. **AC4: Error handling (fail-closed)**
   - Given ISB Lambda invocation fails
   - When handling the error
   - Then fail-closed (queue for manual review)
   - And log error with ISB Lambda response details
   - And do NOT auto-approve without account check

5. **AC5: Unit tests with comprehensive coverage**
   - Given unit testing the service
   - When mocking Lambda client
   - Then test cases cover:
     - Single page response
     - Multi-page pagination (2-3 pages)
     - Empty results
     - Error response
     - Malformed response

6. **AC6: Integration test for 2+ page pagination (Pre-mortem: Pagination Disaster)**
   - Given pagination reliability requirement
   - When testing pagination
   - Then assert: if `nextPageIdentifier` exists in response, MUST fetch next page
   - And integration test MUST include 2+ page mock response

## Tasks / Subtasks

- [x] Task 1: Define Account types (AC: 3)
  - [x] Add `Account` interface to `src/lib/types.ts`
  - [x] Add `GetAccountsResult` interface with pagination info

- [x] Task 2: Create accounts API Gateway event builder (AC: 1)
  - [x] Add `createAccountsApiGatewayEvent()` function following existing patterns
  - [x] Return GET request for `/api/accounts` path
  - [x] Include pagination query parameter for `pageIdentifier`

- [x] Task 3: Extend IsbLambdaService interface (AC: 1)
  - [x] Add `getAccounts()` method signature to interface
  - [x] Return `GetAccountsResult` with accounts array and pagination info

- [x] Task 4: Implement `getAccounts()` with pagination (AC: 1, 2)
  - [x] Implement single page fetch
  - [x] Add loop to handle `nextPageIdentifier`
  - [x] Aggregate results from all pages
  - [x] Return pagination metadata (`totalAccountsFetched`, `pagesTraversed`)

- [x] Task 5: Parse accounts response (AC: 3)
  - [x] Validate account schema using Zod
  - [x] Handle malformed responses gracefully

- [x] Task 6: Implement error handling (AC: 4)
  - [x] Return error result on Lambda failure
  - [x] Include ISB Lambda response details on error
  - [x] Ensure fail-closed behavior (return partial results with error)

- [x] Task 7: Write unit tests (AC: 5, 6)
  - [x] Test single page response
  - [x] Test multi-page pagination (2 pages)
  - [x] Test multi-page pagination (3 pages)
  - [x] Test empty results
  - [x] Test error response (function error, 403, etc.)
  - [x] Test malformed response
  - [x] Test invalid schema
  - [x] Assert pagination loop terminates correctly

## Dev Notes

### Existing Pattern to Follow

The existing `isb-lambda.ts` provides the pattern for direct Lambda invocation:

```typescript
// Existing pattern from src/services/isb-lambda.ts:95-117
const createApiGatewayEvent = (
  leaseIdB64: string,
  action: 'Approve' | 'Deny',
  approverJwt: string
): Record<string, unknown> => ({
  httpMethod: 'POST',
  path: `/leases/${leaseIdB64}/review`,
  // ...
});
```

For accounts, create similar pattern but for GET:

```typescript
const createAccountsApiGatewayEvent = (
  approverJwt: string,
  pageIdentifier?: string
): Record<string, unknown> => ({
  httpMethod: 'GET',
  path: '/api/accounts',
  queryStringParameters: pageIdentifier ? { pageIdentifier } : undefined,
  headers: {
    Authorization: `Bearer ${approverJwt}`,
  },
  requestContext: {
    httpMethod: 'GET',
    path: '/api/accounts',
    extendedRequestId: `approver-accounts-${Date.now()}`,
  },
  resource: '/api/accounts',
  isBase64Encoded: false,
});
```

### Architecture Decision Records (from Epic 6)

| ADR | Decision | Trade-off |
|-----|----------|-----------|
| **ADR-001** | Direct Lambda invoke (not API Gateway) | Coupling for simplicity - reuses existing pattern |
| **ADR-002** | Query ISB fresh each time (no caching) | ~500ms latency for guaranteed consistency |

### Response Schema (from ISB)

Expected ISB `/api/accounts` response:

```json
{
  "statusCode": 200,
  "body": {
    "accounts": [
      {
        "awsAccountId": "123456789012",
        "name": "pool-001",
        "status": "Available",
        "meta": {
          "createdTime": "2025-01-01T00:00:00Z",
          "lastEditTime": "2025-12-28T14:30:00Z"
        }
      }
    ],
    "nextPageIdentifier": "page2token" // null if no more pages
  }
}
```

### Pagination Safety (Pre-mortem Fix)

From the Pre-mortem analysis, ensure pagination is bulletproof:

```typescript
const getAllAccounts = async (): Promise<Account[]> => {
  const allAccounts: Account[] = [];
  let pageIdentifier: string | undefined = undefined;
  let pagesTraversed = 0;

  do {
    const result = await fetchAccountsPage(pageIdentifier);
    allAccounts.push(...result.accounts);
    pageIdentifier = result.nextPageIdentifier ?? undefined;
    pagesTraversed++;

    // Safety: prevent infinite loops
    if (pagesTraversed > 100) {
      throw new Error('Pagination exceeded 100 pages - possible infinite loop');
    }
  } while (pageIdentifier);

  logger.info('Accounts fetched', {
    totalAccountsFetched: allAccounts.length,
    pagesTraversed
  });

  return allAccounts;
};
```

### Project Structure Notes

- Service file: `src/services/isb-lambda.ts` (extend existing)
- Types file: `src/lib/types.ts` (add Account types)
- Test file: `test/services/isb-lambda.test.ts` (extend existing tests)

### Testing Standards

- Coverage target: 90% line, 100% branch on pagination logic
- Use existing mock patterns from `test/services/isb-lambda.test.ts`
- Ensure 2+ page pagination test case exists (Pre-mortem requirement)

### References

- [Source: _bmad-output/epics.md#Story 6.1] - Full acceptance criteria
- [Source: _bmad-output/architecture.md#ISB Integration] - Lambda invoke patterns
- [Source: src/services/isb-lambda.ts] - Existing implementation to extend

## Dev Agent Record

### Agent Model Used

claude-opus-4-5-20251101 (Opus 4.5)

### Debug Log References

- All 32 tests pass in `test/services/isb-lambda.test.ts`
- 14 new tests added for `getAccounts()` method
- Pre-existing 39 handler test failures unrelated to this story

### Completion Notes List

1. **Types Added (src/lib/types.ts:124-176)**
   - `AccountStatusSchema` - Zod enum for 'Available' | 'Active'
   - `AccountMetaSchema` - Zod object for createdTime/lastEditTime
   - `AccountSchema` - Full account object schema
   - `AccountsPageResponseSchema` - Response with pagination
   - `GetAccountsResult` - Interface for service return type

2. **Service Extended (src/services/isb-lambda.ts)**
   - `createAccountsApiGatewayEvent()` - Creates GET event for /api/accounts
   - `MAX_PAGINATION_PAGES = 100` - Safety limit
   - `getAccounts()` - Full implementation with pagination loop
   - `GetAccountsLambdaParams` interface added

3. **Tests Added (test/services/isb-lambda.test.ts:313-700)**
   - Single page response test
   - 2-page pagination test (Pre-mortem requirement)
   - 3-page pagination test
   - Empty results test
   - Lambda function error test
   - Empty payload test
   - Non-2xx status code test
   - Malformed JSON test
   - Invalid schema test
   - Client error propagation test
   - Authorization header test
   - Pagination termination test

4. **Pre-mortem Fixes Applied**
   - MAX_PAGINATION_PAGES (100) prevents infinite loops
   - totalFetched and pagesTraversed returned for debugging
   - Zod schema validation for response

### File List

| File | Action | Lines Changed |
|------|--------|---------------|
| `src/lib/types.ts` | Modified | +54 lines |
| `src/services/isb-lambda.ts` | Modified | +151 lines |
| `test/services/isb-lambda.test.ts` | Modified | +396 lines |
