# Story 7.2.1: Create Approve Action Lambda

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an **operator**,
I want to approve a lease request by clicking the Approve button in Slack,
So that I can grant sandbox access without leaving my workflow.

## Acceptance Criteria

### AC1: Lambda Function Creation
**Given** the ApproverStack CDK is deployed
**When** the stack synthesizes
**Then** an Approve Lambda function `ApproverSlackApprove` is created
**And** it uses Node.js 20.x runtime
**And** timeout is set to 30 seconds

### AC2: Invoke ISB Leases Lambda
**Given** an operator clicks the Approve button in Slack
**When** the Approve Lambda receives the custom action payload
**Then** it extracts the leaseId from the payload
**And** invokes ISB Leases Lambda with action: "Approve"
**And** includes proper authorization header for automated approver

### AC3: Handle ISB Lambda Success
**Given** ISB Leases Lambda returns success (2xx)
**When** the Approve Lambda processes the response
**Then** it returns success status for thread reply processing

### AC4: Handle ISB Lambda Failure
**Given** ISB Leases Lambda returns an error (4xx/5xx)
**When** the Approve Lambda processes the response
**Then** it fails closed (request remains pending)
**And** returns error status with reference ID for troubleshooting

### AC5: IAM Permissions
**Given** the Approve Lambda execution role
**When** invoking ISB Leases Lambda
**Then** the invocation succeeds with appropriate `lambda:InvokeFunction` permission

### AC6: Environment Configuration
**Given** the Approve Lambda is deployed
**When** it executes
**Then** ISB Leases Lambda name is available via environment variable
**And** SNS topic ARN is available for thread replies

## Tasks / Subtasks

- [x] Task 1: Create Approve Lambda handler (AC: #2, #3, #4)
  - [x] 1.1: Create `src/handlers/slack-approve.ts` with handler function
  - [x] 1.2: Define custom action payload interface (Amazon Q format)
  - [x] 1.3: Extract leaseId from `additionalContext` in payload
  - [x] 1.4: Use existing `IsbLambdaService.approveLease()` to invoke ISB Lambda
  - [x] 1.5: Return success/error response with operator identity

- [x] Task 2: Create CDK construct for Approve Lambda (AC: #1, #5, #6)
  - [x] 2.1: Create `cdk/lib/constructs/slack-approve-lambda.ts` construct
  - [x] 2.2: Configure Node.js 20.x runtime with 30s timeout
  - [x] 2.3: Add IAM permissions for ISB Lambda invocation
  - [x] 2.4: Set environment variables (ISB_LEASES_LAMBDA_NAME, SNS_TOPIC_ARN, APPROVER_EMAIL)
  - [x] 2.5: Add esbuild bundling configuration

- [x] Task 3: Integrate into ApproverStack (AC: #1, #5)
  - [x] 3.1: Import and instantiate SlackApproveLambda construct in approver-stack.ts
  - [x] 3.2: Add stack output for Lambda ARN (for custom action configuration)
  - [x] 3.3: Verify guardrail policy includes the new Lambda ARN pattern

- [x] Task 4: Create response formatter for thread replies (AC: #3, #4)
  - [x] 4.1: Define response format interface matching Amazon Q thread reply format
  - [x] 4.2: Create success response: `✅ **Approved by {operator}** at {timestamp}`
  - [x] 4.3: Create error response: `❌ **Error** - {message} (ref: {correlationId})`
  - [x] 4.4: Handle ISB "already processed" response gracefully

- [x] Task 5: Write unit tests (AC: #1-6)
  - [x] 5.1: Test payload parsing (valid, invalid, missing leaseId)
  - [x] 5.2: Test ISB Lambda success path
  - [x] 5.3: Test ISB Lambda failure paths (4xx, 5xx, timeout)
  - [x] 5.4: Test response format generation
  - [x] 5.5: Add CDK construct tests (Lambda creation, IAM permissions)

- [x] Task 6: Run validation and CDK synth (AC: #1-6)
  - [x] 6.1: Run `npm run test` - all tests pass (1146 tests)
  - [x] 6.2: Run `npx cdk synth` - CDK synthesizes correctly
  - [x] 6.3: Verify CloudFormation output includes Lambda ARN

## Dev Notes

### Amazon Q Custom Action Payload Format

When an operator clicks a custom action button in Slack, Amazon Q Developer (AWS Chatbot) invokes the configured Lambda with a specific payload format. Based on AWS documentation and the POC validation:

```typescript
/**
 * Amazon Q Custom Action Lambda Event
 * @see https://docs.aws.amazon.com/chatbot/latest/adminguide/custom-actions.html
 */
interface CustomActionEvent {
  /** Action name from Slack button (e.g., "approve", "deny") */
  actionName: string;
  /** Slack workspace ID */
  slackWorkspaceId: string;
  /** Slack channel ID where action was triggered */
  slackChannelId: string;
  /** Slack user who clicked the button */
  slackUserId: string;
  /** Original notification metadata */
  originalNotification: {
    /** threadId from the notification metadata */
    threadId: string;
    /** additionalContext from the notification */
    additionalContext: {
      leaseId: string;  // Base64-encoded composite key
      userEmail: string;
      score: string;
      threshold: string;
      templateId: string;
      reference: string;
      timestamp?: string;
    };
  };
}
```

**Critical:** The `leaseId` in `additionalContext` is a base64-encoded JSON containing `{userEmail, uuid}`. This matches the existing `encodeLeaseCompositeKey()` format from Story 7.1.1/7.1.3.

### Decoding the Composite LeaseId

```typescript
/**
 * Decodes the base64 composite key back to LeaseId
 */
export const decodeLeaseCompositeKey = (encoded: string): LeaseId => {
  const json = Buffer.from(encoded, 'base64').toString('utf8');
  const parsed = JSON.parse(json);
  return {
    userEmail: parsed.userEmail,
    uuid: parsed.uuid,
  };
};
```

### Existing ISB Lambda Integration (Reuse!)

**CRITICAL:** The project already has a fully functional ISB Lambda client in `src/services/isb-lambda.ts`. This service:
- Handles the composite leaseId encoding
- Creates the fake JWT for Lambda-to-Lambda invocation
- Constructs the API Gateway event payload
- Parses ISB's JSend response format
- Has full test coverage (37 tests)

**DO NOT REINVENT THIS.** Use `createIsbLambdaService()` directly:

```typescript
// In slack-approve.ts handler
import { LambdaClient } from '@aws-sdk/client-lambda';
import { createIsbLambdaService } from '../services/isb-lambda.js';

const lambdaClient = new LambdaClient({});
const isbService = createIsbLambdaService(lambdaClient, {
  functionName: process.env.ISB_LEASES_LAMBDA_NAME!,
});

// Then simply:
const result = await isbService.approveLease({
  leaseId: { userEmail, uuid },
  approverEmail: process.env.APPROVER_EMAIL!,
});
```

### Operator Identity from Slack

The custom action event includes `slackUserId`. For the thread reply, we need to identify the operator. Options:

1. **Simple:** Use `slackUserId` directly in thread reply (Slack will render as @mention)
2. **Mapped:** Lookup email from Slack user ID (requires Slack API call - adds complexity)
3. **From notification:** The `additionalContext.userEmail` is the REQUESTER, not the operator

**Recommendation:** Use `slackUserId` for MVP. The thread reply shows who approved, and Slack handles rendering. The CloudWatch logs capture full audit trail with `slackUserId`.

### Lambda Response Format

For custom action Lambdas, AWS Chatbot expects a specific response format for thread replies:

```typescript
interface CustomActionResponse {
  /** Response version */
  version: '1.0';
  /** Status of the action */
  status: 'success' | 'error';
  /** Message to post as thread reply */
  message: string;
  /** Optional: Additional metadata */
  metadata?: Record<string, string>;
}
```

**Success response:**
```json
{
  "version": "1.0",
  "status": "success",
  "message": "✅ **Approved** by <@U12345678> at 20 Jan 2026 at 14:30"
}
```

**Error response:**
```json
{
  "version": "1.0",
  "status": "error",
  "message": "❌ **Error** - Service temporarily unavailable, please try again (ref: abc-123)"
}
```

### Already Processed Handling

ISB Leases Lambda returns a specific response when a lease has already been approved/denied. From `parseResponse()` in isb-lambda.ts:

- Success (2xx): `{ success: true, statusCode: 2xx, message: 'success' }`
- Already processed (4xx): `{ success: false, statusCode: 4xx, error: 'Lease already processed' }` (or similar)

Check the `statusCode` to distinguish between retriable errors (5xx) and permanent rejections (4xx).

### Environment Variables

| Variable | Value | Purpose |
|----------|-------|---------|
| `ISB_LEASES_LAMBDA_NAME` | From config | ISB Lambda function name |
| `APPROVER_EMAIL` | From config | `ndx+try-automated-approver@dsit.gov.uk` |
| `SNS_TOPIC_ARN` | From stack | For thread replies (Story 7.3.x) |
| `LOG_LEVEL` | `INFO` | Logging verbosity |

### Project Structure Notes

**New files to create:**
- `src/handlers/slack-approve.ts` - Handler entry point
- `cdk/lib/constructs/slack-approve-lambda.ts` - CDK construct
- `test/handlers/slack-approve.test.ts` - Unit tests
- `cdk/test/constructs/slack-approve-lambda.test.ts` - CDK tests

**Alignment with existing patterns:**
- Follow `src/handler.ts` structure (factory pattern, DI)
- Follow `cdk/lib/constructs/approver-lambda.ts` construct pattern
- Use existing logger from `src/lib/logger.ts`
- Import `.js` extensions for ESM compatibility

**CDK Integration Points:**
- Add to `cdk/lib/approver-stack.ts` after the main ApproverLambda
- Export Lambda ARN as stack output (used for custom action configuration)
- Existing `slackLambdaInvokePolicy` already permits `ApproverSlack*` functions (line 132)

### Testing Standards

From Architecture document:
- Unit test coverage: 80%+ for handlers
- Use Vitest with mocked AWS clients
- Factory pattern enables DI for testing

**Test Cases Required:**

1. **Payload parsing:**
   - Valid payload extracts leaseId and slackUserId correctly
   - Missing `originalNotification` throws/returns error
   - Missing `additionalContext.leaseId` throws/returns error
   - Invalid base64 leaseId throws/returns error

2. **ISB Lambda invocation:**
   - Success path returns formatted success message
   - ISB 4xx returns error message (not retriable)
   - ISB 5xx returns error message with retry guidance
   - Timeout scenario handled gracefully

3. **Response formatting:**
   - Success message includes operator and timestamp
   - Error message includes correlation ID

4. **CDK construct:**
   - Lambda created with correct runtime (Node.js 20.x)
   - Timeout set to 30 seconds
   - IAM role has lambda:InvokeFunction permission
   - Environment variables configured

### Code Pattern Examples

**Handler structure (follow existing pattern):**
```typescript
// src/handlers/slack-approve.ts
import type { CustomActionEvent, CustomActionResponse } from '../lib/slack-action-types.js';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { createIsbLambdaService } from '../services/isb-lambda.js';
import { createStructuredLogger } from '../lib/structured-logger.js';

const lambdaClient = new LambdaClient({});
const logger = createStructuredLogger('slack-approve');

export const handler = async (event: CustomActionEvent): Promise<CustomActionResponse> => {
  const correlationId = `approve-${Date.now()}`;
  logger.info('Approve action received', { correlationId, slackUserId: event.slackUserId });

  try {
    // 1. Extract and decode leaseId
    const encodedLeaseId = event.originalNotification?.additionalContext?.leaseId;
    if (!encodedLeaseId) {
      throw new Error('Missing leaseId in payload');
    }
    const leaseId = decodeLeaseCompositeKey(encodedLeaseId);

    // 2. Call ISB Lambda via existing service
    const isbService = createIsbLambdaService(lambdaClient, {
      functionName: process.env.ISB_LEASES_LAMBDA_NAME!,
    });

    const result = await isbService.approveLease({
      leaseId,
      approverEmail: process.env.APPROVER_EMAIL!,
    });

    // 3. Format response based on result
    if (result.success) {
      const timestamp = formatTimestamp(new Date());
      return {
        version: '1.0',
        status: 'success',
        message: `✅ **Approved** by <@${event.slackUserId}> at ${timestamp}`,
      };
    }

    // 4. Handle ISB errors
    logger.error('ISB Lambda returned error', { correlationId, error: result.error });
    return {
      version: '1.0',
      status: 'error',
      message: `❌ **Error** - ${result.error} (ref: ${correlationId})`,
    };
  } catch (error) {
    logger.error('Unexpected error in approve handler', { correlationId, error });
    return {
      version: '1.0',
      status: 'error',
      message: `❌ **Error** - Unexpected error, please try again (ref: ${correlationId})`,
    };
  }
};
```

### CDK Construct Pattern

```typescript
// cdk/lib/constructs/slack-approve-lambda.ts
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface SlackApproveLambdaProps {
  isbLeasesLambdaName: string;
  approverEmail: string;
  snsTopicArn: string;
}

export class SlackApproveLambda extends Construct {
  public readonly function: lambda.IFunction;

  constructor(scope: Construct, id: string, props: SlackApproveLambdaProps) {
    super(scope, id);

    this.function = new nodejs.NodejsFunction(this, 'Function', {
      functionName: 'ApproverSlackApprove',
      entry: 'src/handlers/slack-approve.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        ISB_LEASES_LAMBDA_NAME: props.isbLeasesLambdaName,
        APPROVER_EMAIL: props.approverEmail,
        SNS_TOPIC_ARN: props.snsTopicArn,
        NODE_OPTIONS: '--enable-source-maps',
      },
      bundling: {
        format: nodejs.OutputFormat.ESM,
        minify: true,
        sourceMap: true,
        target: 'node20',
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Grant permission to invoke ISB Leases Lambda
    this.function.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [
          `arn:aws:lambda:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:function:${props.isbLeasesLambdaName}`,
        ],
      })
    );
  }
}
```

### References

- [Source: _bmad-output/epics-amazon-q-slack.md#Story 7.2.1]
- [Source: _bmad-output/prd-amazon-q-slack.md#API Backend Specific Requirements]
- [Source: _bmad-output/architecture.md#Implementation Patterns - DI, Factory Functions]
- [Source: src/services/isb-lambda.ts - Existing ISB Lambda client (REUSE THIS)]
- [Source: src/services/sns-notification.ts#encodeLeaseCompositeKey - Encoding function to match]
- [Source: cdk/lib/approver-stack.ts - Stack integration point (line 163)]
- [Source: cdk/lib/approver-stack.ts#slackLambdaInvokePolicy - Already permits ApproverSlack*]
- [Source: _bmad-output/implementation-artifacts/7-1-3-format-rich-notification-with-action-buttons.md - Previous story patterns]
- [Source: https://docs.aws.amazon.com/chatbot/latest/adminguide/custom-actions.html - Amazon Q custom actions docs]

### Previous Story Intelligence (7.1.1, 7.1.2, 7.1.3)

**From Story 7.1.1:**
- SNS topic `isb-approval-notifications` created
- Notification includes `additionalContext.leaseId` as base64-encoded composite key
- `encodeLeaseCompositeKey()` in sns-notification.ts matches ISB's expected format

**From Story 7.1.2:**
- Guardrail policy `ApproverSlackLambdaInvoke` already allows `ApproverSlack*` Lambdas
- SlackChannelConfiguration ARN available for custom action setup

**From Story 7.1.3:**
- Rich notification format includes all context for approval decision
- `formatTimestamp()` helper available for consistent time formatting
- Thread correlation uses `leaseId` as `threadId` in notification metadata

### Git Intelligence

**Recent commit patterns:**
- `feat(scope): description (#PR)` format
- Atomic commits per story

**Suggested commit message:**
```
feat(slack): create approve action Lambda for Slack button clicks (#N)

- Add ApproverSlackApprove Lambda handler with ISB integration
- Create CDK construct with Node.js 20.x and 30s timeout
- Reuse existing IsbLambdaService for approval invocation
- Add comprehensive unit tests for payload parsing and error handling

Story: 7.2.1
```

### Pre-Implementation Checklist

Before starting implementation, verify:
- [ ] You've read `src/services/isb-lambda.ts` (MUST reuse this)
- [ ] You understand the composite leaseId encoding
- [ ] You've reviewed the Amazon Q custom action documentation
- [ ] You understand the thread reply response format
- [ ] You know the existing test count (run `npm test` first)

### Implementation Order

1. **Task 1** - Handler implementation (most critical, reuse isb-lambda.ts)
2. **Task 4** - Response formatter (needed by handler)
3. **Task 5** - Unit tests (verify handler works)
4. **Task 2** - CDK construct (infrastructure)
5. **Task 3** - Stack integration
6. **Task 6** - Validation and synth

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-5-20251101

### Debug Log References

N/A

### Completion Notes List

- All acceptance criteria validated via unit tests
- Reused existing `IsbLambdaService.approveLease()` - no duplication
- Response formatter included in handler file (not separate module - simpler)
- Logger uses simple `Logger` from Powertools (matches project patterns)
- CDK construct follows existing `approver-lambda.ts` patterns
- 7-year log retention for GDPR compliance
- Guardrail policy already permits `ApproverSlack*` pattern - no changes needed

### File List

**New Files Created:**
- `src/handlers/slack-approve.ts` - Lambda handler for Approve action
- `src/lib/slack-action-types.ts` - Type definitions and decode helper
- `cdk/lib/constructs/slack-approve-lambda.ts` - CDK construct
- `test/handlers/slack-approve.test.ts` - Handler unit tests (32 tests, includes 5 sanitization tests from review)
- `test/lib/slack-action-types.test.ts` - Type and decode tests (12 tests)
- `cdk/test/constructs/slack-approve-lambda.test.ts` - CDK construct tests (18 tests)

**Modified Files:**
- `cdk/lib/approver-stack.ts` - Import and instantiate SlackApproveLambda, add outputs
- `cdk/test/approver-stack.test.ts` - Integration tests for stack (9 new tests)

---

## Senior Developer Review (AI)

**Reviewed:** 20 Jan 2026 at 23:42 UTC
**Reviewer:** claude-opus-4-5-20251101
**Outcome:** ✅ Approved with fixes applied

### Review Summary

All 6 Acceptance Criteria validated. All tasks marked `[x]` confirmed as implemented.
Total tests after review: 1151 (added 5 new sanitization tests).

### Issues Found and Fixed

| # | Severity | Issue | Resolution |
|---|----------|-------|------------|
| 1 | MEDIUM | Hardcoded defaults could mask env var misconfiguration | Refactored to require env vars with clear error messages |
| 2 | MEDIUM | Slack User ID not validated before interpolation into response | Added `sanitizeSlackUserId()` with regex validation |
| 3 | MEDIUM | Duplicate LeaseId encoding/decoding logic | Added explicit sync comment pointing to compatibility test |
| 4 | LOW | Global mutable state for ISB service | Kept as standard Lambda pattern; added lazy initialization |

### Changes Applied During Review

1. **`src/handlers/slack-approve.ts`:**
   - Added `getIsbLambdaService()` with lazy initialization and env var validation
   - Added `getApproverEmail()` with required env var validation
   - Added `isValidSlackUserId()` and `sanitizeSlackUserId()` functions
   - Updated response functions to use sanitized Slack User IDs

2. **`src/lib/slack-action-types.ts`:**
   - Added IMPORTANT comment documenting sync requirement with `encodeLeaseCompositeKey()`

3. **`test/handlers/slack-approve.test.ts`:**
   - Added 5 new tests for Slack User ID sanitization
   - Added env var setup in `beforeAll`/`afterAll` hooks

### Remaining Low-Priority Items (not blocking)

- Response status for "already processed" returns `error` (UX clarity only)
- Correlation ID uses weak randomness (sufficient for logging)
- CDK log group name is hardcoded (maintenance burden only)

