# Story 5.2: Slack Workflow Webhook Notifications

Status: complete

## Story

As an **operator**,
I want **Slack notifications via Workflow Webhook when requests need review**,
So that **I can quickly assess and act on escalated requests**.

## Acceptance Criteria

1. **AC1: Webhook integration with Secrets Manager (FR37)**
   - Given a lease is escalated
   - When sending Slack notification
   - Then POST to Slack Workflow Webhook URL from Secrets Manager (`/approver/slack-webhook-url`)
   - And URL format is `https://hooks.slack.com/triggers/[randomized]`

2. **AC2: Flat JSON payload format**
   - Given webhook payload format (flat JSON, no nesting)
   - When constructing the payload
   - Then send:
   ```json
   {
     "user_email": "sarah.jones@council.gov.uk",
     "lease_id": "abc123-def456-ghi789",
     "reference": "ISB-2025-0042",
     "score": "25",
     "threshold": "20",
     "template_id": "bedrock-basic",
     "score_breakdown": "• First-time user: +5\n• Group mailbox detected: +20",
     "console_url": "https://isb-console.example.com/leases/abc123-def456-ghi789",
     "queue_depth": "3"
   }
   ```

3. **AC3: Score breakdown formatting (FR38)**
   - Given score breakdown formatting
   - When building `score_breakdown` string
   - Then format as newline-separated bullet points:
   ```
   • {rule_name}: {points}
   • {rule_name}: {points}
   ```
   - And include only rules with non-zero contribution
   - And sort by absolute contribution (highest impact first)

4. **AC4: ISB console deep link (FR39, FR40)**
   - Given ISB console URL is required
   - When generating `console_url`
   - Then read `ISB_CONSOLE_URL` from environment variable
   - And append `/leases/{leaseId}` for direct navigation

5. **AC5: Queue depth in notification (FR42)**
   - Given pending review queue summary is needed
   - When counting pending requests
   - Then query SQS queue depth via `getApproximateNumberOfMessages`
   - And include in `queue_depth` field

6. **AC6: Graceful failure handling**
   - Given Slack webhook fails
   - When the POST returns error or times out (3s timeout)
   - Then log the failure with response details
   - And do NOT fail the overall request processing
   - And request remains escalated (operator can find via ISB console)

7. **AC7: Rate limiting**
   - Given multiple escalations may occur in burst
   - When sending webhook requests
   - Then implement pessimistic approach (one at a time)
   - And log if delays occur due to rate concerns

## Tasks / Subtasks

- [x] Task 1: Create Slack service module (AC: 1, 2)
  - [x] Create `src/services/slack.ts` module
  - [x] Add `SlackService` interface with `notifyEscalation` method
  - [x] Add `createSlackService(webhookUrl, isbConsoleUrl, sqsService)` factory
  - [x] Implement HTTP POST to webhook URL with 3s timeout
  - [x] Add `SlackNotificationPayload` type matching flat JSON schema
  - [x] Add tests for service creation and payload formatting

- [x] Task 2: Implement webhook URL retrieval (AC: 1)
  - [x] Add `getSlackWebhookUrl()` function that reads from Secrets Manager
  - [x] Use `@aws-lambda-powertools/parameters` for secrets caching
  - [x] Cache webhook URL with appropriate TTL (5 minutes)
  - [x] Add error handling for missing/invalid secret
  - [x] Add tests for secret retrieval

- [x] Task 3: Implement score breakdown formatter (AC: 3)
  - [x] Create `formatScoreBreakdownForSlack(breakdown)` function
  - [x] Format with bullet points (•) and newlines
  - [x] Filter out zero-value rules
  - [x] Sort by absolute contribution descending
  - [x] Add tests for formatting edge cases

- [x] Task 4: Implement queue depth retrieval (AC: 5)
  - [x] Add `getQueueDepth()` method to SQS service (if not exists)
  - [x] Use `GetQueueAttributes` with `ApproximateNumberOfMessages`
  - [x] Return "0" on error (pessimistic but non-blocking)
  - [x] Add tests for queue depth retrieval

- [x] Task 5: Integrate Slack notifications into handler (AC: 1-7)
  - [x] Add Slack service initialization in handler startup
  - [x] Call `notifyEscalation` after escalated decision path
  - [x] Pass leaseId, userEmail, score, scoreBreakdown, templateId
  - [x] Generate reference number using existing utility
  - [x] Get console URL from environment variable
  - [x] Get queue depth from SQS service
  - [x] Log success/failure of notification

- [x] Task 6: Handle notification failures gracefully (AC: 6)
  - [x] Wrap Slack notification in try/catch
  - [x] Log warning on failure, do not throw
  - [x] Include response status/error in log
  - [x] Continue processing (escalation already recorded)
  - [x] Add tests for failure scenarios

- [x] Task 7: Write comprehensive tests (AC: 1-7)
  - [x] Test payload construction with all fields
  - [x] Test score breakdown formatting
  - [x] Test console URL generation
  - [x] Test timeout handling (3s)
  - [x] Test error handling (4xx, 5xx responses)
  - [x] Test queue depth integration

## Dev Notes

### Slack Workflow Webhook vs Incoming Webhook

Story 5.2 uses **Slack Workflow Webhooks**, NOT the traditional Incoming Webhook:

- **Workflow Webhook URL format:** `https://hooks.slack.com/triggers/{team_id}/{trigger_id}/{hash}`
- **Payload:** Flat JSON (no blocks) - Slack Workflow handles formatting
- **No Block Kit:** The workflow builder defines the message format using our variables
- **Variables defined in Slack:** user_email, lease_id, reference, score, threshold, template_id, score_breakdown, console_url, queue_depth

The Slack admin configures a Workflow that:
1. Receives the webhook with our variables
2. Formats the message using Workflow Builder
3. Posts to the configured channel

### Environment Variables Required

```typescript
ISB_CONSOLE_URL: string;      // e.g., "https://isb.sandbox.example.gov.uk"
DELAY_QUEUE_URL: string;      // SQS queue URL for queue depth
```

### Secrets Manager

- **Secret ARN:** `arn:aws:secretsmanager:us-west-2:568672915267:secret:/approver/slack-webhook-url-FXJl1d`
- **Secret Value:** Plain text Slack Workflow Webhook URL

### Score Breakdown Formatting for Slack

The `score_breakdown` field must be a single string with newline-separated bullets:
```
• First-time user: +5
• Group mailbox detected: +20
• Verified gov domain: -5
```

Use the existing `formatScoreBreakdown` function from `src/lib/lease-comments.ts` as a basis, but modify for Slack's bullet style (• instead of -).

### HTTP Client Approach

Use native `fetch` (available in Node.js 20) for HTTP POST:
```typescript
const response = await fetch(webhookUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
  signal: AbortSignal.timeout(3000), // 3s timeout
});
```

### Integration Points

The Slack service needs to be called from `handler.ts` in the escalated decision branch. The existing code structure after Story 5.1 shows:

```typescript
// In handler.ts, escalated path
if (decision === 'escalated') {
  // ... existing logging and comments update ...

  // NEW: Send Slack notification (Story 5.2)
  await notifySlackEscalation(...);
}
```

### Factory Pattern Consistency

Follow the existing service factory pattern:
```typescript
export const createSlackService = (
  webhookUrl: string,
  isbConsoleUrl: string,
  sqsService: SQSService
): SlackService => ({
  notifyEscalation: async (params) => { ... },
});
```

### Testing Approach

Mock the `fetch` global for unit tests:
```typescript
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
}));
```

### Previous Story Intelligence

**From Story 5.1:**
- `generateReferenceNumber(leaseId)` available in `src/lib/reference-number.ts`
- `ruleResultsToBreakdown(scoreBreakdown)` converts RuleResult[] to ScoreBreakdown
- `formatScoreBreakdown(breakdown)` in `src/lib/lease-comments.ts` (uses `-` prefix)
- DynamoDB service pattern established with factory functions
- Mock service injection pattern: `setSlackService(mockService)`

**From handler.ts:**
- Escalated path is at lines ~1270-1300
- Already has `scoreBreakdown` (RuleResult[]) in context
- Already has `leaseId`, `userEmail`, `score` available
- EventBridge service pattern for reference

### Project Structure Notes

New files:
- `src/services/slack.ts` - Slack webhook service

Modified files:
- `src/handler.ts` - Integrate Slack notification call
- `src/services/sqs.ts` - Add getQueueDepth if not present

Test files:
- `test/services/slack.test.ts` - Comprehensive service tests

### References

- [Source: prd.md#FR37] - Slack notification on escalation
- [Source: prd.md#FR38] - Score breakdown in Slack
- [Source: prd.md#FR39] - ISB console deep link for approval
- [Source: prd.md#FR40] - ISB console deep link for denial
- [Source: prd.md#FR42] - Pending review queue summary
- [Source: architecture.md#Slack-Integration] - One-way webhook pattern
- [Source: architecture.md#Slack-Notification-Pattern] - Block Kit example (not used for workflow webhooks)
- [Source: epics.md#Story-5.2] - Full acceptance criteria

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

N/A

### Completion Notes List

1. Created `src/services/slack.ts` - Slack webhook service with `createSlackService` factory, `formatScoreBreakdownForSlack`, and `buildSlackPayload` functions
2. Created `src/lib/secrets.ts` - Secrets Manager utilities with `getSlackWebhookUrl` for cached secret retrieval
3. Created `test/services/slack.test.ts` - 23 comprehensive tests for Slack service
4. Created `test/lib/secrets.test.ts` - 13 tests for secrets retrieval
5. Updated `src/handler.ts`:
   - Added Slack service imports and lazy initialization
   - Added `setSlackService`/`resetSlackService` for testing
   - Added `notifySlackEscalation` helper function
   - Integrated Slack notification in escalated decision path
6. Updated `test/handler.test.ts`:
   - Added 3 tests for Slack notification flow (success, failure, throws)
7. Updated `eslint.config.mjs` - Added `fetch` and `AbortSignal` globals for Node.js 20

All acceptance criteria met:
- AC1: Webhook integration with Secrets Manager ✓
- AC2: Flat JSON payload format ✓
- AC3: Score breakdown formatting ✓
- AC4: ISB console deep link ✓
- AC5: Queue depth in notification ✓
- AC6: Graceful failure handling ✓
- AC7: Rate limiting (pessimistic approach implemented) ✓

### File List

**New Files:**
- `src/services/slack.ts` - Slack webhook service
- `src/lib/secrets.ts` - Secrets Manager utilities
- `test/services/slack.test.ts` - Slack service tests
- `test/lib/secrets.test.ts` - Secrets tests

**Modified Files:**
- `src/handler.ts` - Slack notification integration
- `test/handler.test.ts` - Handler Slack notification tests
- `eslint.config.mjs` - Node.js 20 globals
