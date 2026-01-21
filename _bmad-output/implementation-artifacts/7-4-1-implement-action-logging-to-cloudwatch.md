# Story 7.4.1: Implement Action Logging to CloudWatch

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **platform team member**,
I want all action attempts logged to CloudWatch,
So that I can audit and troubleshoot approval activities.

## Acceptance Criteria

### AC1: Structured JSON Logging
**Given** an operator clicks Approve or Deny
**When** the action Lambda processes the request
**Then** structured JSON logs are written to CloudWatch
**And** logs include: leaseId, action, operator, timestamp, outcome

### AC2: Log Successful Actions
**Given** an action completes successfully
**When** the thread reply is posted
**Then** a log entry records: action=approve/deny, outcome=success, operator={id}

### AC3: Log Already Processed
**Given** a duplicate action is detected
**When** the "already processed" reply is posted
**Then** a log entry records: action=approve/deny, outcome=already_processed

### AC4: Log Errors
**Given** an action fails
**When** the error reply is posted
**Then** a log entry records: action=approve/deny, outcome=error, error={message}
**And** full stack trace is included at DEBUG level

### AC5: Correlation ID for Tracing
**Given** any action attempt
**When** logs are written
**Then** a correlation ID links all log entries for that request
**And** the correlation ID matches the one shown to operators on errors

## Tasks / Subtasks

- [x] Task 1: Audit existing logging implementation (AC: #1, #5)
  - [x] 1.1: Review `src/handlers/slack-action-base.ts` for all logger calls
  - [x] 1.2: Document current logging structure and fields
  - [x] 1.3: Verify correlation ID is consistent across all log entries
  - [x] 1.4: Check if Lambda Powertools Logger produces structured JSON

- [x] Task 2: Verify/enhance success action logging (AC: #2)
  - [x] 2.1: Verify success log at line 371 includes required fields
  - [x] 2.2: Ensure `action` field is consistently named (currently uses `config.actionType`)
  - [x] 2.3: Add `outcome: 'success'` field if not present
  - [x] 2.4: Verify `operator` field uses `slackUserId`

- [x] Task 3: Verify/enhance already-processed logging (AC: #3)
  - [x] 3.1: Verify already-processed log at line 383 includes required fields
  - [x] 3.2: Add `outcome: 'already_processed'` field if not present
  - [x] 3.3: Ensure consistent field naming with success logs

- [x] Task 4: Verify/enhance error logging (AC: #4)
  - [x] 4.1: Verify ISB Lambda error log at line 395 includes required fields
  - [x] 4.2: Verify unexpected error log at line 406 includes stack trace
  - [x] 4.3: Assess if stack trace should be at DEBUG level (AC4 requirement)
  - [x] 4.4: Add `outcome: 'error'` field if not present
  - [x] 4.5: Consider whether to add DEBUG-level stack trace vs ERROR-level

- [x] Task 5: Add structured log type definitions (AC: #1)
  - [x] 5.1: Define TypeScript interface for action log entries
  - [x] 5.2: Ensure all log calls conform to the interface
  - [x] 5.3: Document log entry format in Dev Notes

- [x] Task 6: Add unit tests for logging behavior (AC: #1-5)
  - [x] 6.1: Add test for success action logging structure
  - [x] 6.2: Add test for already-processed logging structure
  - [x] 6.3: Add test for error logging structure
  - [x] 6.4: Add test for correlation ID consistency

- [x] Task 7: Verify CloudWatch log group configuration (AC: #1)
  - [x] 7.1: Check CDK creates log group for action Lambdas
  - [x] 7.2: Verify retention policy is appropriate (30 days recommended)
  - [x] 7.3: Document CloudWatch Insights queries for auditing

## Dev Notes

### CRITICAL: Implementation Already Exists - Enhancement Story

**Good news!** Logging is already implemented in Story 7.2.1/7.2.2. This story is primarily about:
1. Verifying existing logging meets AC1-AC5 requirements
2. Standardizing log entry structure with consistent `outcome` field
3. Documenting the logging format for audit purposes
4. Adding test coverage for logging behavior

### Current Implementation Analysis

**Logger Configuration (`src/handlers/slack-action-base.ts:263-267`):**
```typescript
logger: new Logger({
  serviceName: config.serviceName,
  logLevel: (process.env.LOG_LEVEL as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR') ?? 'INFO',
}),
```

**Correlation ID Generation (`src/handlers/slack-action-base.ts:313`):**
```typescript
const correlationId = `${config.actionType}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
```
- Format: `{action}-{timestamp}-{randomHex}` (e.g., `approve-1705849200000-abc123`)
- Generated once per request, used throughout handler
- Included in error responses for operator troubleshooting

### Current Log Entries Analysis

| Location | Log Level | When | Fields Logged | Gap |
|----------|-----------|------|---------------|-----|
| Line 315 | INFO | Action received | correlationId | Missing: leaseId, action, operator |
| Line 323 | ERROR | Invalid payload | correlationId, error | Missing: outcome field |
| Line 332 | INFO | Processing action | correlationId, slackUserId | Missing: leaseId, action, outcome |
| Line 342 | ERROR | Decode failed | correlationId, error | Missing: outcome field |
| Line 349 | INFO | Decoded leaseId | correlationId, leaseId, userEmail, slackUserId | Good coverage |
| Line 371 | INFO | Success | correlationId, leaseId, userEmail, slackUserId, statusCode | **Missing: action, outcome='success'** |
| Line 383 | INFO | Already processed | correlationId, leaseId, userEmail, slackUserId, statusCode, error | **Missing: outcome='already_processed'** |
| Line 395 | ERROR | ISB Lambda error | correlationId, leaseId, userEmail, slackUserId, statusCode, error | **Missing: outcome='error'** |
| Line 406 | ERROR | Unexpected error | correlationId, error, stack | **Missing: outcome='error', leaseId** |

### Recommended Log Structure

```typescript
interface ActionLogEntry {
  // Required for all log entries
  correlationId: string;      // Links all log entries for this request
  action: 'approve' | 'deny'; // The action being performed

  // Available after payload validation
  leaseId?: string;           // UUID of the lease
  userEmail?: string;         // Email of the requester
  operator?: string;          // Slack user ID of operator

  // Terminal log entries include outcome
  outcome?: 'success' | 'already_processed' | 'error';

  // Additional context
  statusCode?: number;        // ISB Lambda response code
  error?: string;             // Error message if applicable
  stack?: string;             // Stack trace (DEBUG level)
}
```

### Enhancement Plan

**Option A: Minimal Changes (Recommended)**
Add `outcome` field to terminal log entries only:
- Success: Add `outcome: 'success'`
- Already processed: Add `outcome: 'already_processed'`
- Error: Add `outcome: 'error'`

**Option B: Full Restructure**
Create helper function that ensures consistent log structure:
```typescript
const logAction = (level: 'info' | 'error', outcome: string, details: object) => {
  state.logger[level](`Action ${outcome}`, {
    correlationId,
    action: config.actionType,
    outcome,
    ...details,
  });
};
```

**Recommendation:** Option A - minimal invasive changes, preserves existing patterns.

### CloudWatch Insights Queries

**Query: All action attempts in last 24h:**
```
fields @timestamp, correlationId, action, outcome, leaseId, operator
| filter @logStream like /ApproverSlackApprove|ApproverSlackDeny/
| filter @message like /success|already_processed|error/
| sort @timestamp desc
| limit 100
```

**Query: Error rate by action type:**
```
fields @timestamp, correlationId, action, outcome
| filter @logStream like /ApproverSlackApprove|ApproverSlackDeny/
| filter outcome = 'error'
| stats count() by action
```

**Query: Trace specific request:**
```
fields @timestamp, @message
| filter @logStream like /ApproverSlackApprove|ApproverSlackDeny/
| filter @message like "approve-1705849200000-abc123"
| sort @timestamp asc
```

**Query: Audit trail for specific lease:**
```
fields @timestamp, correlationId, action, outcome, operator
| filter @logStream like /ApproverSlackApprove|ApproverSlackDeny/
| filter leaseId = "abc123-def456-789"
| sort @timestamp asc
```

### Project Structure Notes

**Files to modify:**
- `src/handlers/slack-action-base.ts` - Add outcome field to terminal logs
- `test/handlers/slack-action-base.test.ts` - Add logging structure tests

**No new files expected** - this is enhancement of existing functionality.

### Previous Story Intelligence (7.3.1, 7.3.2, 7.3.3)

**Established logging patterns:**
- All logs include `correlationId` for tracing
- ERROR level for failures, INFO level for success/already-processed
- Stack traces included in unexpected error logs
- Lambda Powertools Logger produces structured JSON automatically

**Testing patterns from 7.3.3:**
- Unit tests verify log structure via mock logger
- Tests check required fields are present
- Tests verify correlation ID consistency

### Architecture Compliance

**From `_bmad-output/architecture.md`:**
- Observability: Structured JSON logging, CloudWatch metrics
- Logging: AWS Lambda Powertools Logger with correlation IDs
- Testing: 80%+ coverage for services

**From `_bmad-output/epics-amazon-q-slack.md` (FR14, FR15, NFR8):**
- FR14: Log all action attempts to CloudWatch for audit trail
- FR15: Log idempotency cache hits for duplicate verification (not needed - ISB handles idempotency)
- NFR8: All action attempts must be logged to immutable audit trail

### Technical Requirements

**Lambda Powertools Logger benefits:**
- Automatic structured JSON output
- Built-in timestamp in ISO format
- Lambda context (function name, version, cold start)
- Log level filtering via `LOG_LEVEL` env var

**Log retention:**
- CloudWatch Logs default: Never expire
- Recommended: 30-90 days for operational logs, longer for audit

### CDK Log Group Configuration

**Verify in `cdk/lib/constructs/slack-actions.ts`:**
```typescript
// Expected configuration for action Lambdas
const logGroup = new logs.LogGroup(this, 'ApproveLogGroup', {
  logGroupName: `/aws/lambda/${approveLambda.functionName}`,
  retention: logs.RetentionDays.ONE_MONTH, // 30 days
  removalPolicy: cdk.RemovalPolicy.DESTROY, // or RETAIN for production
});
```

### Git Commit Pattern

From recent commits:
```
b542249 chore: mark story 7.3.2 as done
8cd3ae0 test(slack): verify already-processed thread reply behavior
```

**Suggested commit messages:**
```
feat(slack): add outcome field to action logs for auditing

- Add outcome='success' to successful action logs
- Add outcome='already_processed' to duplicate action logs
- Add outcome='error' to error logs
- Document CloudWatch Insights queries for auditing

Story: 7.4.1
```

```
test(slack): verify action logging structure

- Add tests for success action log structure
- Add tests for already-processed log structure
- Add tests for error log structure with stack trace
- Add tests for correlation ID consistency

Story: 7.4.1
```

### Security Considerations

**Log sanitization:**
- Never log sensitive data (passwords, tokens)
- User email is acceptable (already in notifications)
- Correlation ID is safe (randomized)
- Stack traces should not contain secrets

**Current implementation follows these principles.**

### Risk Assessment

**Low risk** - Enhancement only:
- No new code paths
- Adding fields to existing logs
- Lambda Powertools handles JSON serialization
- Existing tests provide safety net

**Minor considerations:**
- Ensure `outcome` field doesn't conflict with existing fields
- Test that log entries don't exceed CloudWatch line size limits (256KB)

### Implementation Order

1. **Task 1** - Audit existing logging (code review)
2. **Task 5** - Define log structure interface
3. **Task 2-4** - Add outcome field to terminal logs
4. **Task 6** - Add unit tests
5. **Task 7** - Verify CDK log group configuration

### Estimated Effort

**Low** - Primarily verification and minor enhancements:
- Logging already comprehensive
- Main work is adding `outcome` field
- Test coverage for logging behavior
- Document CloudWatch queries

### Definition of Done

- [x] All terminal log entries include `outcome` field
- [x] Correlation ID consistent across all log entries for a request
- [x] Unit tests verify log structure
- [x] CloudWatch Insights queries documented
- [x] Log retention configured appropriately (if not already)
- [x] All existing tests still pass

### References

- [Source: _bmad-output/epics-amazon-q-slack.md#Story 7.4.1]
- [Source: _bmad-output/prd-amazon-q-slack.md#FR14, FR15, NFR8]
- [Source: _bmad-output/architecture.md#Observability]
- [Source: src/handlers/slack-action-base.ts:263-267 - Logger configuration]
- [Source: src/handlers/slack-action-base.ts:313 - Correlation ID generation]
- [Source: src/handlers/slack-action-base.ts:371 - Success logging]
- [Source: src/handlers/slack-action-base.ts:383 - Already processed logging]
- [Source: src/handlers/slack-action-base.ts:395-410 - Error logging]
- [Source: _bmad-output/implementation-artifacts/7-3-3-post-thread-reply-for-errors.md - Previous story patterns]

---

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

- CloudWatch log groups: `/aws/lambda/ApproverSlackApprove`, `/aws/lambda/ApproverSlackDeny`
- Filter patterns documented in Dev Notes section

### Completion Notes List

- Audited existing logging implementation - found comprehensive logging already in place
- Added `ACTION_LOG_OUTCOMES` constant and `ActionLogOutcome` type for type-safe outcomes
- Enhanced terminal log entries with `action`, `outcome`, and `operator` fields
- Added 7 new tests for logging structure verification (73 total tests in file)
- Verified CloudWatch log groups configured with 7-year retention (exceeds 30-day requirement)
- All 1293 tests pass with no regressions
- Implementation follows Option A (minimal changes) as recommended in Dev Notes

### Change Log

- 2026-01-21: Implemented action logging enhancements for Story 7.4.1
  - Added `ACTION_LOG_OUTCOMES` constant and `ActionLogOutcome` type
  - Added `action`, `outcome`, `operator` fields to success, already-processed, and error logs
  - Added 7 unit tests for logging structure verification

- 2026-01-21: Code review fixes (AI Review)
  - **H1 Fixed**: Stack trace now logged at DEBUG level per AC4 requirement (was ERROR)
  - **M3 Fixed**: Unexpected error log now includes `leaseId`, `userEmail`, `operator` when available
  - Test documentation updated to clarify AC4 DEBUG level behavior
  - All 1293 tests pass

### File List

- `src/handlers/slack-action-base.ts` - Added type definitions and enhanced terminal log entries; fixed stack trace log level
- `test/handlers/slack-action-base.test.ts` - Added logging structure tests (Story 7.4.1); updated AC4 documentation

