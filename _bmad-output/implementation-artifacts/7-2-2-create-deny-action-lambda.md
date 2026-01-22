# Story 7.2.2: Create Deny Action Lambda

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an **operator**,
I want to deny a lease request by clicking the Deny button in Slack,
So that I can reject inappropriate requests without leaving my workflow.

## Acceptance Criteria

### AC1: Lambda Function Creation
**Given** the ApproverStack CDK is deployed
**When** the stack synthesizes
**Then** a Deny Lambda function `ApproverSlackDeny` is created
**And** it uses Node.js 20.x runtime
**And** timeout is set to 30 seconds

### AC2: Invoke ISB Leases Lambda
**Given** an operator clicks the Deny button in Slack
**When** the Deny Lambda receives the custom action payload
**Then** it extracts the leaseId from the payload
**And** invokes ISB Leases Lambda with action: "Deny"
**And** includes proper authorization header for automated approver

### AC3: Handle ISB Lambda Success
**Given** ISB Leases Lambda returns success (2xx)
**When** the Deny Lambda processes the response
**Then** it returns success status for thread reply processing

### AC4: Handle ISB Lambda Failure
**Given** ISB Leases Lambda returns an error (4xx/5xx)
**When** the Deny Lambda processes the response
**Then** it fails closed (request remains pending)
**And** returns error status with reference ID for troubleshooting

### AC5: Shared Infrastructure with Approve Lambda
**Given** the Deny Lambda is created
**When** reviewing the CDK code
**Then** it shares the same IAM role pattern as Approve Lambda
**And** uses the same environment variable configuration pattern

## Tasks / Subtasks

- [x] Task 1: Create Deny Lambda handler (AC: #2, #3, #4)
  - [x] 1.1: Create `src/handlers/slack-deny.ts` with handler function (COPY and adapt from slack-approve.ts)
  - [x] 1.2: Reuse `CustomActionEvent` and `CustomActionResponse` types from `slack-action-types.ts`
  - [x] 1.3: Reuse `decodeLeaseCompositeKey()` from `slack-action-types.ts`
  - [x] 1.4: Use existing `IsbLambdaService.denyLease()` to invoke ISB Lambda
  - [x] 1.5: Change success message to: `🚫 **Denied** by <@{slackUserId}> at {timestamp}`
  - [x] 1.6: Reuse error response and already processed response patterns

- [x] Task 2: Create CDK construct for Deny Lambda (AC: #1, #5)
  - [x] 2.1: Create `cdk/lib/constructs/slack-deny-lambda.ts` construct (COPY and adapt from slack-approve-lambda.ts)
  - [x] 2.2: Configure Node.js 20.x runtime with 30s timeout
  - [x] 2.3: Add IAM permissions for ISB Lambda invocation (same pattern)
  - [x] 2.4: Set environment variables (ISB_LEASES_LAMBDA_NAME, SNS_TOPIC_ARN, APPROVER_EMAIL)
  - [x] 2.5: Use same esbuild bundling configuration
  - [x] 2.6: Use same 7-year log retention for audit compliance

- [x] Task 3: Integrate into ApproverStack (AC: #1, #5)
  - [x] 3.1: Import and instantiate SlackDenyLambda construct in approver-stack.ts
  - [x] 3.2: Add stack output for Deny Lambda ARN (for custom action configuration)
  - [x] 3.3: Verify guardrail policy includes the new Lambda ARN pattern (already permits `ApproverSlack*`)

- [x] Task 4: Write unit tests (AC: #1-5)
  - [x] 4.1: Create `test/handlers/slack-deny.test.ts` (COPY and adapt from slack-approve.test.ts)
  - [x] 4.2: Test payload parsing (valid, invalid, missing leaseId)
  - [x] 4.3: Test ISB Lambda success path (denyLease call)
  - [x] 4.4: Test ISB Lambda failure paths (4xx, 5xx, timeout)
  - [x] 4.5: Test Slack User ID sanitization (already validated in approve tests)
  - [x] 4.6: Create `cdk/test/constructs/slack-deny-lambda.test.ts` (COPY and adapt)

- [x] Task 5: Run validation and CDK synth (AC: #1-5)
  - [x] 5.1: Run `npm run test` - all tests pass (1201 tests)
  - [x] 5.2: Run `npx cdk synth` - CDK synthesizes correctly
  - [x] 5.3: Verify CloudFormation output includes Deny Lambda ARN

## Dev Notes

### CRITICAL: This is a Near-Duplicate of Story 7.2.1

**The Deny Lambda is nearly identical to the Approve Lambda.** The primary differences are:
1. Handler calls `isbService.denyLease()` instead of `approveLease()`
2. Success message shows `🚫 **Denied**` instead of `✅ **Approved**`
3. Function name is `ApproverSlackDeny` instead of `ApproverSlackApprove`
4. Log group is `/aws/lambda/ApproverSlackDeny`

**DO NOT REINVENT ANYTHING.** Copy the existing files and make minimal changes:
- `src/handlers/slack-approve.ts` → `src/handlers/slack-deny.ts`
- `cdk/lib/constructs/slack-approve-lambda.ts` → `cdk/lib/constructs/slack-deny-lambda.ts`
- `test/handlers/slack-approve.test.ts` → `test/handlers/slack-deny.test.ts`
- `cdk/test/constructs/slack-approve-lambda.test.ts` → `cdk/test/constructs/slack-deny-lambda.test.ts`

### Existing ISB Lambda Service - REUSE!

The project already has `IsbLambdaService.denyLease()` method in `src/services/isb-lambda.ts`:

```typescript
// From src/services/isb-lambda.ts (existing)
interface IsbLambdaService {
  approveLease(params: { leaseId: LeaseId; approverEmail: string }): Promise<IsbLambdaResponse>;
  denyLease(params: { leaseId: LeaseId; denierEmail: string; reason?: string }): Promise<IsbLambdaResponse>;
  // ... other methods
}
```

**The service is already tested** and handles:
- Composite leaseId encoding
- Fake JWT creation for Lambda-to-Lambda invocation
- API Gateway event payload construction
- JSend response parsing

### Handler Differences from Approve Lambda

| Aspect | Approve Lambda | Deny Lambda |
|--------|---------------|-------------|
| ISB method | `approveLease()` | `denyLease()` |
| Success emoji | ✅ | 🚫 |
| Success text | **Approved** | **Denied** |
| Service name | `slack-approve` | `slack-deny` |
| Function name | `ApproverSlackApprove` | `ApproverSlackDeny` |

### Deny Lambda Handler Changes (from slack-approve.ts)

```typescript
// Key changes for slack-deny.ts:

// 1. Logger service name
const logger = new Logger({
  serviceName: 'slack-deny',  // Changed from 'slack-approve'
  logLevel: (process.env.LOG_LEVEL as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR') ?? 'INFO',
});

// 2. Success response message
const createSuccessResponse = (slackUserId: string): CustomActionResponse => {
  const timestamp = formatTimestamp(new Date());
  const safeUserId = sanitizeSlackUserId(slackUserId);
  return {
    version: '1.0',
    status: 'success',
    message: `🚫 **Denied** by <@${safeUserId}> at ${timestamp}`,  // Changed from ✅ **Approved**
  };
};

// 3. ISB Lambda invocation
const result = await getIsbLambdaService().denyLease({  // Changed from approveLease
  leaseId,
  denierEmail: getApproverEmail(),  // Note: parameter name is denierEmail, not approverEmail
});

// 4. Correlation ID prefix
const correlationId = `deny-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;  // Changed from 'approve-'

// 5. Log messages - change "Approve" to "Deny" and "approved" to "denied"
logger.info('Deny action received', { correlationId });
logger.info('Processing deny action', { ... });
logger.info('Lease denied successfully', { ... });
```

### CDK Construct Changes (from slack-approve-lambda.ts)

```typescript
// Key changes for slack-deny-lambda.ts:

export class SlackDenyLambda extends Construct {  // Changed class name
  // ...

  constructor(scope: Construct, id: string, props: SlackDenyLambdaProps) {
    // Log group name
    this.logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: '/aws/lambda/ApproverSlackDeny',  // Changed from ApproverSlackApprove
      retention: logs.RetentionDays.SEVEN_YEARS,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Function name and entry
    this.function = new nodejs.NodejsFunction(this, 'Function', {
      functionName: 'ApproverSlackDeny',  // Changed from ApproverSlackApprove
      entry: 'src/handlers/slack-deny.ts',  // Changed from slack-approve.ts
      // ... rest stays the same
    });

    // Tags
    cdk.Tags.of(this.function).add('Story', '7.2.2');  // Changed from 7.2.1
  }
}
```

### Stack Integration (approver-stack.ts)

Add after the existing `SlackApproveLambda`:

```typescript
// Import at top
import { SlackDenyLambda } from './constructs/slack-deny-lambda.js';

// In ApproverStack constructor, after SlackApproveLambda:
const slackDenyLambda = new SlackDenyLambda(this, 'SlackDenyLambda', {
  isbLeasesLambdaName: isbLeasesLambdaName,
  approverEmail: approverEmail,
  snsTopicArn: notificationTopic.topicArn,
  logLevel: 'INFO',
});

// Add output for custom action configuration
new cdk.CfnOutput(this, 'SlackDenyLambdaArn', {
  value: slackDenyLambda.function.functionArn,
  description: 'ARN of the Slack Deny Lambda for custom action configuration',
  exportName: 'ApproverSlackDenyLambdaArn',
});
```

### Environment Variables (same as Approve Lambda)

| Variable | Value | Purpose |
|----------|-------|---------|
| `ISB_LEASES_LAMBDA_NAME` | From config | ISB Lambda function name |
| `APPROVER_EMAIL` | From config | `ndx+try-automated-approver@dsit.gov.uk` |
| `SNS_TOPIC_ARN` | From stack | For thread replies (Story 7.3.x) |
| `LOG_LEVEL` | `INFO` | Logging verbosity |

### Guardrail Policy Already Permits New Lambda

From `approver-stack.ts` (line ~132):
```typescript
const slackLambdaInvokePolicy = new iam.Policy(this, 'ApproverSlackLambdaInvoke', {
  statements: [
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunction'],
      resources: [`arn:aws:lambda:${this.region}:${this.account}:function:ApproverSlack*`],
    }),
  ],
});
```

This already permits functions matching `ApproverSlack*`, so `ApproverSlackDeny` is automatically allowed.

### Test Adaptation Guide

**For `test/handlers/slack-deny.test.ts`:**

1. Copy `test/handlers/slack-approve.test.ts`
2. Find/replace:
   - `slack-approve` → `slack-deny`
   - `approveLease` → `denyLease`
   - `approverEmail` → `denierEmail` (in mock expectations)
   - `Approved` → `Denied`
   - `✅` → `🚫`
   - `approve-` → `deny-` (correlation ID prefix)

3. Update imports:
   ```typescript
   import { handler, setIsbLambdaService, resetIsbLambdaService } from '../../src/handlers/slack-deny.js';
   ```

**For `cdk/test/constructs/slack-deny-lambda.test.ts`:**

1. Copy `cdk/test/constructs/slack-approve-lambda.test.ts`
2. Find/replace:
   - `SlackApproveLambda` → `SlackDenyLambda`
   - `ApproverSlackApprove` → `ApproverSlackDeny`
   - `slack-approve` → `slack-deny`

### Project Structure Notes

**New files to create:**
- `src/handlers/slack-deny.ts` - Handler entry point (copy from slack-approve.ts)
- `cdk/lib/constructs/slack-deny-lambda.ts` - CDK construct (copy from slack-approve-lambda.ts)
- `test/handlers/slack-deny.test.ts` - Unit tests (copy from slack-approve.test.ts)
- `cdk/test/constructs/slack-deny-lambda.test.ts` - CDK tests (copy from slack-approve-lambda.test.ts)

**Modified files:**
- `cdk/lib/approver-stack.ts` - Import and instantiate SlackDenyLambda, add outputs
- `cdk/test/approver-stack.test.ts` - Add integration tests for Deny Lambda

**Alignment with existing patterns:**
- Follow `src/handlers/slack-approve.ts` structure exactly
- Follow `cdk/lib/constructs/slack-approve-lambda.ts` construct pattern exactly
- Use existing logger from `@aws-lambda-powertools/logger`
- Import `.js` extensions for ESM compatibility

### Testing Standards

From Architecture document and Story 7.2.1:
- Unit test coverage: 80%+ for handlers
- Use Vitest with mocked AWS clients
- Factory pattern enables DI for testing

**Test Cases Required (same as 7.2.1):**

1. **Payload parsing:**
   - Valid payload extracts leaseId and slackUserId correctly
   - Missing `originalNotification` throws/returns error
   - Missing `additionalContext.leaseId` throws/returns error
   - Invalid base64 leaseId throws/returns error

2. **ISB Lambda invocation:**
   - Success path returns formatted success message (with `🚫 **Denied**`)
   - ISB 4xx returns already processed message
   - ISB 5xx returns error message with retry guidance
   - Timeout scenario handled gracefully

3. **Response formatting:**
   - Success message includes `🚫 **Denied**`, operator, and timestamp
   - Error message includes correlation ID

4. **CDK construct:**
   - Lambda created with correct runtime (Node.js 20.x)
   - Timeout set to 30 seconds
   - IAM role has lambda:InvokeFunction permission
   - Environment variables configured

5. **Slack User ID sanitization:**
   - Valid IDs pass through unchanged
   - Invalid IDs replaced with 'unknown-user'
   - (Reuse same tests from approve handler)

### Previous Story Intelligence (7.2.1)

**From Story 7.2.1 Implementation:**
- `CustomActionEvent` and `CustomActionResponse` types are in `src/lib/slack-action-types.ts`
- `decodeLeaseCompositeKey()` is in `src/lib/slack-action-types.ts`
- `formatTimestamp()` is in `src/services/sns-notification.ts`
- `sanitizeSlackUserId()` and `isValidSlackUserId()` were added during code review
- Lazy initialization pattern for ISB service (`getIsbLambdaService()`)
- Required env var validation (`getApproverEmail()`)
- Test helpers: `setIsbLambdaService()` and `resetIsbLambdaService()`

**Code Review Items Already Addressed in 7.2.1:**
- Slack User ID validation/sanitization
- Environment variable validation
- Lazy service initialization

### Git Intelligence

**Recent commit patterns:**
- `feat(scope): description (#PR)` format
- Atomic commits per story

**Suggested commit message:**
```
feat(slack): create deny action Lambda for Slack button clicks (#N)

- Add ApproverSlackDeny Lambda handler with ISB integration
- Create CDK construct with Node.js 20.x and 30s timeout
- Reuse existing IsbLambdaService for denial invocation
- Add comprehensive unit tests (adapted from approve handler)

Story: 7.2.2
```

### References

- [Source: _bmad-output/epics-amazon-q-slack.md#Story 7.2.2]
- [Source: _bmad-output/implementation-artifacts/7-2-1-create-approve-action-lambda.md - COPY THIS]
- [Source: src/handlers/slack-approve.ts - COPY THIS FOR HANDLER]
- [Source: cdk/lib/constructs/slack-approve-lambda.ts - COPY THIS FOR CONSTRUCT]
- [Source: src/services/isb-lambda.ts - Existing denyLease() method]
- [Source: src/lib/slack-action-types.ts - Existing types and decode function]
- [Source: cdk/lib/approver-stack.ts - Stack integration point]
- [Source: https://docs.aws.amazon.com/chatbot/latest/adminguide/custom-actions.html]

### Pre-Implementation Checklist

Before starting implementation, verify:
- [ ] You've read `src/handlers/slack-approve.ts` (SOURCE TO COPY)
- [ ] You've read `cdk/lib/constructs/slack-approve-lambda.ts` (SOURCE TO COPY)
- [ ] You understand this is essentially a copy with minimal changes
- [ ] You've verified `IsbLambdaService.denyLease()` exists in isb-lambda.ts
- [ ] You know the existing test count (run `npm test` first)

### Implementation Order

1. **Task 1** - Handler implementation (copy slack-approve.ts, change to denyLease)
2. **Task 4.1-4.5** - Unit tests (copy and adapt from approve tests)
3. **Task 2** - CDK construct (copy slack-approve-lambda.ts)
4. **Task 4.6** - CDK tests (copy and adapt)
5. **Task 3** - Stack integration
6. **Task 5** - Validation and synth

### Estimated Effort

**Very Low** - This is a copy-paste-modify exercise:
- ~90% code reuse from Story 7.2.1
- Only changes: method name, emoji, log messages, function names
- No new patterns or architecture decisions

---

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

N/A - No debugging issues encountered

### Completion Notes List

- ✅ Created `src/handlers/slack-deny.ts` - Deny action Lambda handler with ISB integration
- ✅ Created `cdk/lib/constructs/slack-deny-lambda.ts` - CDK construct with Node.js 20.x, 30s timeout
- ✅ Created `test/handlers/slack-deny.test.ts` - 32 unit tests for handler logic
- ✅ Created `cdk/test/constructs/slack-deny-lambda.test.ts` - 18 CDK construct tests
- ✅ Integrated SlackDenyLambda into ApproverStack with outputs for ARN and function name
- ✅ All 1211 tests pass (including 60 new tests for deny functionality)
- ✅ CDK synth successful - CloudFormation output includes SlackDenyLambdaArn and SlackDenyLambdaName
- ✅ Guardrail policy pattern `ApproverSlack*` automatically permits `ApproverSlackDeny`

### File List

**New files:**
- src/handlers/slack-deny.ts
- cdk/lib/constructs/slack-deny-lambda.ts
- test/handlers/slack-deny.test.ts
- cdk/test/constructs/slack-deny-lambda.test.ts

**Modified files:**
- cdk/lib/approver-stack.ts
- cdk/test/approver-stack.test.ts
- _bmad-output/implementation-artifacts/sprint-status.yaml

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-01-20 | Story implemented - Created Deny Lambda handler, CDK construct, tests, and stack integration | Claude Opus 4.5 |
| 2026-01-21 | Code review fixes: Added 8 integration tests to approver-stack.test.ts, strengthened approverEmail assertion, added 2 env var validation tests, fixed AC6→AC5 typo | Claude Opus 4.5 |

