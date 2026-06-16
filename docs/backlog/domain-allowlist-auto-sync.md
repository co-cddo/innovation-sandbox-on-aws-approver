# Backlog: Auto-sync ukps-domains allowlist

## Problem

The `cdk/assets/user_domains.json` file is a static copy of the upstream
[ukps-domains](https://github.com/gds-dtx/ukps-domains) dataset.
It only updates when a developer manually copies the file and redeploys. The
current architecture also introduces an unnecessary S3 layer — the CDK deploys
the file to S3, the Lambda reads it back from S3 with a 1-hour in-memory cache,
but the S3 copy itself is never independently updated.

## Current architecture

```
git commit (cdk/assets/user_domains.json)
  → CDK deploy (s3deploy.BucketDeployment)
    → S3 bucket (approver-domain-list-{account})
      → Lambda reads from S3 (1h cache TTL)
        → Filters to organisation_type_id === 'local_authority'
```

**Files involved:**
- `cdk/assets/user_domains.json` — static copy of upstream data (3,949 lines, 493 domains, 383 local authorities)
- `cdk/lib/approver-stack.ts` — S3 bucket + BucketDeployment (lines 64-82)
- `src/services/domain-allowlist.ts` — S3 reader with 1h cache
- `src/lib/domain-verification.ts` — domain matching logic (exact + wildcard)
- `src/handler.ts` — wires it into scoring

## Proposed approach: fetch directly from GitHub at runtime

Remove the S3 intermediary entirely. Have the Lambda fetch the JSON directly
from the public GitHub raw URL at runtime, with the same caching strategy.

### Target architecture

```
Lambda cold start / cache expiry
  → fetch https://raw.githubusercontent.com/gds-dtx/ukps-domains/main/data/user_domains.json
    → In-memory cache (1h TTL, stale-while-revalidate)
      → Filter to local_authority
```

### Changes required

#### 1. Replace S3 fetch with HTTPS fetch in `domain-allowlist.ts`

- Replace `S3Client` / `GetObjectCommand` with a simple `fetch()` call (Node 18+ native fetch)
- URL: `https://raw.githubusercontent.com/gds-dtx/ukps-domains/main/data/user_domains.json`
- Make the URL configurable via `DOMAIN_ALLOWLIST_URL` env var (for testing/overrides)
- Keep the exact same caching and stale-while-revalidate logic
- Keep the same filtering to `organisation_type_id === 'local_authority'`
- Add a reasonable fetch timeout (5s) so cold starts aren't unbounded

#### 2. Remove S3 infrastructure from CDK stack

In `cdk/lib/approver-stack.ts`:
- Remove the `DomainListBucket` S3 bucket
- Remove the `DomainListDeployment` BucketDeployment
- Remove the S3 read permissions granted to the Lambda
- Add the new env var `DOMAIN_ALLOWLIST_URL` to the Lambda

#### 3. Delete the static asset

- Delete `cdk/assets/user_domains.json` (or the whole `cdk/assets/` dir if nothing else is in it)
- Remove `DOMAIN_ALLOWLIST_BUCKET` and `DOMAIN_ALLOWLIST_KEY` env vars from Lambda config

#### 4. Update tests

- `test/services/domain-allowlist.test.ts` — mock `fetch()` instead of S3 client
- CDK snapshot tests — will need updating for removed S3 resources
- Integration/handler tests that reference domain allowlist config

#### 5. Update `DomainAllowlistConfig` interface

```typescript
// Before
export interface DomainAllowlistConfig {
  bucketName: string;
  objectKey: string;
}

// After
export interface DomainAllowlistConfig {
  url: string;
  timeoutMs?: number; // default 5000
}
```

### Risks and mitigations

| Risk | Mitigation |
|------|------------|
| GitHub raw URL is down | Stale-while-revalidate cache (already implemented). Lambda continues serving last-known-good data. |
| GitHub rate limiting | Raw URLs have generous limits. 1h cache TTL means ~24 fetches/day per Lambda instance. |
| Upstream data is malformed | Existing JSON parse error handling + stale cache fallback covers this. |
| Cold start latency increase | ~200-500ms for HTTPS fetch vs ~100-200ms for S3 GetObject. Marginal and only on cold start or cache miss. |
| Upstream repo goes away | Env var URL makes it easy to point elsewhere. Could fall back to a forked copy. |

### Alternative approaches considered

#### A. GitHub Actions to auto-update the static file
- Add a scheduled GH Action that pulls the upstream file weekly and opens a PR
- Pros: no runtime change, keeps S3 architecture
- Cons: still requires merge + deploy, adds CI complexity, data still stale between runs

#### B. S3 bucket with a scheduled Lambda updater
- Keep S3 but add a CloudWatch Events rule + Lambda to periodically sync from GitHub
- Pros: keeps S3 read path, adds freshness
- Cons: more infrastructure, more moving parts, S3 layer is still redundant

#### C. Direct fetch (recommended, described above)
- Simplest approach, removes infrastructure, always fresh within cache TTL
- The upstream repo is public and stable

### Estimated scope

- ~2-3 hours implementation
- Files to modify: 4-5
- Files to delete: 1
- Net lines of code: likely negative (removing S3 infra)

### Acceptance criteria

- [ ] Lambda fetches domain list from GitHub raw URL (configurable via env var)
- [ ] 1-hour in-memory cache with stale-while-revalidate preserved
- [ ] S3 bucket, BucketDeployment, and static asset file removed
- [ ] All existing tests pass (updated for new fetch mechanism)
- [ ] Domain verification behaviour unchanged (same filtering, same matching)
- [ ] Cold start time regression < 500ms
