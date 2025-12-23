# Story 3.3: Domain Verification from S3 Cache

Status: done

## Story

As a **UK local government user**,
I want **my verified government domain to earn a trust bonus**,
So that **legitimate government users are fast-tracked**.

## Acceptance Criteria

1. **AC1: Load domain allowlist from S3 (FR8)**
   - Given domain verification is required
   - When checking if domain is trusted
   - Then load ukps-domains allowlist from S3 bucket
   - And filter entries to only those with `organisation_type_id: "local_authority"`
   - And cache the filtered list in memory with 1 hour TTL (FR11)

2. **AC2: Check userEmail domain against allowlist**
   - Given the domain list is loaded
   - When checking `userEmail` domain
   - Then extract domain (e.g., `councilname.gov.uk`)
   - And check if domain exists in filtered local_authority list

3. **AC3: Apply trust bonus for verified domains (FR9)**
   - Given domain is in local_authority list
   - When calculating verified_gov_domain rule (#5)
   - Then apply -5 trust bonus
   - And `isVerifiedGovDomain: true` in context

4. **AC4: Neutral for non-verified domains (FR10)**
   - Given domain is NOT in local_authority list
   - When calculating the rule
   - Then apply 0 (neutral, no penalty)
   - And `isVerifiedGovDomain: false` in context

5. **AC5: Pessimistic fallback on S3 failure**
   - Given S3 load fails
   - When attempting domain verification
   - Then skip the bonus (pessimistic)
   - And log the S3 error
   - And continue with scoring (don't fail the whole request)

6. **AC6: Cache TTL and stale cache handling**
   - Given cache TTL expires (1 hour)
   - When next request needs domain verification
   - Then reload from S3
   - And if reload fails, use stale cache with warning log

7. **AC7: Filter by organisation_type_id**
   - Given JSON parsing succeeds
   - When filtering domain list
   - Then only include entries where `organisation_type_id === "local_authority"`
   - And extract `domain_pattern` field for matching

## Tasks / Subtasks

- [x] Task 1: Create S3 domain service with caching (AC: 1, 6, 7)
  - [x] Create `src/services/domain-allowlist.ts`:
    - Interface for domain allowlist service
    - Factory function with S3 client injection
    - Load JSON from S3 bucket/key (from env vars)
    - Filter to `organisation_type_id === "local_authority"`
    - Extract domain patterns for matching
  - [x] Implement in-memory cache with 1 hour TTL
  - [x] Handle stale cache when refresh fails

- [x] Task 2: Create domain verification utility (AC: 2, 3, 4)
  - [x] Create `src/lib/domain-verification.ts`:
    - `isVerifiedGovDomain(domain: string, allowlist: string[]): boolean`
    - Match domain against allowlist patterns
    - Handle wildcards if present in domain_pattern

- [x] Task 3: Update handler to verify domain (AC: 1, 5)
  - [x] Update `src/handler.ts`:
    - Initialize domain allowlist service (cold start)
    - Query domain verification before state machine
    - Pass `isVerifiedGovDomain` to context
    - Handle errors with pessimistic fallback

- [x] Task 4: Update scoring context and rule #5 (AC: 3, 4)
  - [x] Update `src/state-machine/handlers.ts`:
    - Pass `isVerifiedGovDomain` from context to scoring
  - [x] Rule #5 (verified_gov_domain) already uses `isVerifiedGovDomain` flag
    - Verify it applies -5 bonus when true, 0 when false

- [x] Task 5: Unit tests for domain allowlist service (AC: 1, 5, 6, 7)
  - [x] Create `test/services/domain-allowlist.test.ts`:
    - Test S3 load and JSON parsing
    - Test filtering by organisation_type_id
    - Test cache TTL behavior
    - Test stale cache on refresh failure
    - Test S3 error handling

- [x] Task 6: Unit tests for domain verification (AC: 2, 3, 4)
  - [x] Create `test/lib/domain-verification.test.ts`:
    - Test domain matching
    - Test wildcard patterns
    - Test case insensitivity

- [x] Task 7: Integration tests (AC: 1-7)
  - [x] Update `test/handler.test.ts`:
    - Test domain verification flow
    - Test isVerifiedGovDomain passed to scoring
    - Test pessimistic fallback on S3 error

## Dev Notes

### Data Source

**GitHub Repository:** `https://github.com/govuk-digital-backbone/ukps-domains`
**File:** `data/user_domains.json`

**Contributor Branch (until PR merged):**
`https://raw.githubusercontent.com/chrisns/ukps-domains/feat/localgov-crawler-and-tests/data/user_domains.json`

**JSON Structure (expected):**
```json
{
  "domains": [
    {
      "domain_pattern": "councilname.gov.uk",
      "organisation_type_id": "local_authority",
      "organisation_name": "Council Name"
    },
    {
      "domain_pattern": "nhs.uk",
      "organisation_type_id": "nhs"  // EXCLUDE - not target audience
    }
  ]
}
```

### S3 Configuration

The domain list needs to be synced to an S3 bucket. Environment variables:
- `DOMAIN_ALLOWLIST_BUCKET` - S3 bucket name
- `DOMAIN_ALLOWLIST_KEY` - Object key (default: `user_domains.json`)

### Architecture Patterns (from Story 3.1/3.2)

- **Factory pattern with DI** for S3 client
- **Pessimistic fallback** on errors (skip bonus, don't fail)
- **Structured logging** with `logger.appendKeys()` and `logger.info()`
- **Cache pattern**: In-memory with TTL, stale-while-revalidate on failure

### Cache Implementation

```typescript
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  lastFetched: number;
}

// 1 hour TTL
const CACHE_TTL_MS = 60 * 60 * 1000;

let domainCache: CacheEntry<string[]> | null = null;

const getLocalAuthorityDomains = async (): Promise<string[]> => {
  const now = Date.now();

  // Return cached if valid
  if (domainCache && domainCache.expiresAt > now) {
    return domainCache.data;
  }

  try {
    const domains = await fetchFromS3();
    domainCache = {
      data: domains,
      expiresAt: now + CACHE_TTL_MS,
      lastFetched: now,
    };
    return domains;
  } catch (error) {
    // Stale cache fallback
    if (domainCache) {
      logger.warn('Using stale domain cache after S3 error', {
        lastFetched: new Date(domainCache.lastFetched).toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
      return domainCache.data;
    }
    throw error; // No cache available
  }
};
```

### Domain Matching

```typescript
const isVerifiedGovDomain = (
  domain: string,
  allowlist: string[]
): boolean => {
  const lowerDomain = domain.toLowerCase();
  return allowlist.some(pattern => {
    // Handle wildcard patterns like *.gov.uk
    if (pattern.startsWith('*.')) {
      const suffix = pattern.substring(2).toLowerCase();
      return lowerDomain.endsWith(suffix);
    }
    return lowerDomain === pattern.toLowerCase();
  });
};
```

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `DOMAIN_ALLOWLIST_BUCKET` | S3 bucket for domain list | Required |
| `DOMAIN_ALLOWLIST_KEY` | S3 object key | `user_domains.json` |

### CDK Updates Required

```typescript
// Add S3 read permissions for domain allowlist bucket
const domainAllowlistBucket = Bucket.fromBucketName(
  this,
  'DomainAllowlistBucket',
  props.domainAllowlistBucket
);
domainAllowlistBucket.grantRead(this.approverFunction);

// Environment variables
environment: {
  DOMAIN_ALLOWLIST_BUCKET: props.domainAllowlistBucket,
  DOMAIN_ALLOWLIST_KEY: props.domainAllowlistKey ?? 'user_domains.json',
}
```

### Testing Strategy

**Unit Tests:**
1. `domain-allowlist.test.ts`
   - Load and parse JSON from S3
   - Filter by organisation_type_id
   - Cache hit/miss scenarios
   - TTL expiry behavior
   - Stale cache on S3 error

2. `domain-verification.test.ts`
   - Exact domain match
   - Wildcard pattern match
   - Case insensitivity
   - No match returns false

**Integration Tests:**
- Handler with domain verification mock
- isVerifiedGovDomain passed to scoring context
- Pessimistic fallback logging

### Critical Warnings

1. **Filter by local_authority only** - Other types (nhs, police, central_gov) are NOT target audience
2. **Pessimistic on failure** - Skip bonus if S3 fails, don't block scoring
3. **Stale cache is acceptable** - Better than no verification
4. **1 hour TTL** - Balance between freshness and S3 costs
5. **Rule #5 exists** - Just need to wire up `isVerifiedGovDomain` flag

### References

- [Source: epics.md#Story-3.3] - Full acceptance criteria
- [Source: architecture.md#Implementation-Patterns] - DI and error handling
- [Source: 3-1-dynamodb-user-history-queries.md] - Factory pattern examples
- [Source: 3-2-organization-reputation-tracking.md] - Previous story patterns

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

- All 434 tests passing
- Lint and build pass

### Completion Notes List

- Created S3 domain allowlist service with caching (1 hour TTL)
- Implemented stale-while-revalidate pattern for cache failures
- Created domain verification utility with wildcard pattern support
- Updated handler to query domain verification with pessimistic fallback
- Updated state machine handlers to pass isVerifiedGovDomain to scoring context
- Rule #5 (verified_gov_domain) now properly wired to context.isVerifiedGovDomain
- Added 14 unit tests for domain allowlist service
- Added 21 unit tests for domain verification utility
- Added 7 integration tests for domain verification flow in handler

### File List

**New Files:**
- `src/services/domain-allowlist.ts` - S3 domain allowlist service with caching
- `src/lib/domain-verification.ts` - Domain verification utility
- `test/services/domain-allowlist.test.ts` - Unit tests (14 tests)
- `test/lib/domain-verification.test.ts` - Unit tests (21 tests)

**Modified Files:**
- `src/handler.ts` - Added domain allowlist service initialization, checkDomainVerification(), DI functions
- `src/state-machine/types.ts` - Added isVerifiedGovDomain to StateContext
- `src/state-machine/handlers.ts` - Pass isVerifiedGovDomain to scoring context
- `test/handler.test.ts` - Added domain verification integration tests (7 tests)

### Code Review Fixes

- Changed `DomainAllowlistService.getLocalAuthorityDomains()` return type from `string[]` to `DomainAllowlistResult`
  - Added `usedStaleCache: boolean` to indicate stale cache usage
  - Added optional `staleReason: string` for error context
- Handler now logs warning when stale cache is used (AC6 compliance)
- Added integration test for stale cache warning log
- Updated all handler tests to use new interface

