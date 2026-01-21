# Amazon Q Developer Slack Integration POC Summary

## Overview

This POC validated replacing direct Slack webhook notifications with Amazon Q Developer (AWS Chatbot) for the ISB Approver service. The goal was to enable interactive approve/deny buttons in Slack that can trigger lease approval workflows.

## What Was Proven

### 1. SNS-to-Slack Notifications via Amazon Q Developer
- **Status:** ✅ Working
- **Implementation:** SNS topic (`AmazonQSlackPocNotifications`) connected to Slack channel via AWS Chatbot
- **Custom notification format** with markdown support, titles, descriptions, and metadata
- **Thread support** via `metadata.threadId` for grouping related messages

### 2. Custom Action Buttons in Slack
- **Status:** ✅ Working
- **Implementation:** Custom actions configured in AWS Console that invoke Lambda functions
- **Variables passed** from notification `additionalContext` to Lambda via `$additionalContext.fieldName` syntax
- **Minimal payload:** Only `leaseId` needed - Lambda decodes to get `userEmail` and `uuid`

### 3. Intermediary Lambda for ISB Integration
- **Status:** ✅ Working
- **Approve Lambda** (`AmazonQSlackPocApprove`):
  - Receives `leaseId` from custom action
  - Decodes base64 leaseId to extract `userEmail` and `uuid`
  - Constructs authorization header (static approver credentials)
  - Calls `ISB-LeasesLambdaFunction-ndx` with proper payload
  - Posts thread update via SNS with success/failure status
- **Deny Lambda** (`AmazonQSlackPocDeny`): Same pattern with `action: "Deny"`

### 4. Thread Updates After Actions
- **Status:** ✅ Working
- **Implementation:** After ISB Lambda responds, intermediary Lambda publishes follow-up notification to same `threadId`
- **Visual feedback:** ✅ for approved, 🚫 for denied, ❌ for errors

### 5. IAM Permissions Model
- **Status:** ✅ Working
- **Guardrail policies** on Chatbot channel configuration for Lambda invoke
- **Identity-based policies** on channel role for specific Lambda ARNs
- **SNS publish permissions** for intermediary Lambdas to post thread updates

## Architecture Validated

```
┌─────────────────┐     ┌─────────────┐     ┌──────────────────┐
│  Approver       │────▶│  SNS Topic  │────▶│  Amazon Q        │
│  (sends notif)  │     │             │     │  (Slack Channel) │
└─────────────────┘     └─────────────┘     └────────┬─────────┘
                                                     │
                                            ┌────────▼─────────┐
                                            │  Slack Message   │
                                            │  [Approve][Deny] │
                                            └────────┬─────────┘
                                                     │ User clicks
                                            ┌────────▼─────────┐
                                            │  Custom Action   │
                                            │  (AWS Console)   │
                                            └────────┬─────────┘
                                                     │
                                            ┌────────▼─────────┐
                                            │  Approve/Deny    │
                                            │  Lambda          │
                                            └────────┬─────────┘
                                                     │
                                            ┌────────▼─────────┐
                                            │  ISB Leases      │
                                            │  Lambda          │
                                            └────────┬─────────┘
                                                     │
                                            ┌────────▼─────────┐
                                            │  SNS Topic       │──▶ Thread Update
                                            └──────────────────┘
```

## Key Technical Findings

### Notification Format
```javascript
{
  version: '1.0',
  source: 'custom',
  id: 'unique-notification-id',  // Must be unique to avoid deduplication
  content: {
    textType: 'client-markdown',
    title: ':warning: *Lease Review Required*',
    description: 'Markdown content here',
    nextSteps: ['Step 1', 'Step 2'],
    keywords: ['lease', 'review']
  },
  metadata: {
    threadId: 'lease-uuid',  // Groups messages in thread
    summary: 'Short summary',
    additionalContext: {
      // Variables accessible via $additionalContext.fieldName in custom actions
      leaseId: 'base64-encoded-lease-id'
    }
  }
}
```

### Custom Action Definition
```json
{
  "leaseId": "$additionalContext.leaseId"
}
```

### LeaseId Format
Base64-encoded JSON: `{"userEmail":"user@example.gov.uk","uuid":"uuid-here"}`

Lambda decodes this to reconstruct the full ISB API payload.

## Current POC Stack Components

| Resource | Name | Purpose |
|----------|------|---------|
| SNS Topic | `AmazonQSlackPocNotifications` | Notification delivery to Slack |
| Chatbot Config | `AmazonQSlackPoc` | Slack channel integration |
| Lambda | `AmazonQSlackPocTest` | Test notification sender |
| Lambda | `AmazonQSlackPocApprove` | Approve action handler |
| Lambda | `AmazonQSlackPocDeny` | Deny action handler |
| IAM Policy | `AmazonQSlackPocLambdaInvoke` | Guardrail for Lambda invoke |

## Next Steps for Production Implementation

### Phase 1: Integrate SNS Notifications into Approver

**Goal:** Replace direct Slack webhook with SNS publishing

**Tasks:**
1. Add SNS publish capability to the Approver Lambda
2. Create notification builder that formats rich lease review messages with:
   - Score breakdown and risk factors
   - Lease details (template, budget, duration, user email)
   - Deep link to ISB console
   - Reference number
3. Include `leaseId` in `additionalContext` for custom actions
4. Remove or deprecate direct Slack webhook code

### Phase 2: Production-Ready Action Lambdas

**Goal:** Harden the approve/deny Lambdas for production use

**Tasks:**
1. Move inline Lambda code to proper TypeScript files with tests
2. Add idempotency handling (prevent double-approve)
3. Add proper error handling and logging (structured logs)
4. Handle edge cases:
   - Lease already approved/denied
   - Lease expired
   - Lease not found
   - ISB Lambda timeout
5. Add CloudWatch metrics for action success/failure rates

### Phase 3: Consolidate Infrastructure

**Goal:** Merge POC stack into main Approver stack

**Tasks:**
1. Move SNS topic, Chatbot config to `ApproverStack`
2. Rename resources from "POC" to production names
3. Update custom action definitions in AWS Console
4. Add stack outputs for new resources
5. Remove `AmazonQSlackPocStack` and test Lambda

### Phase 4: Enhanced User Experience

**Goal:** Improve Slack notification UX

**Tasks:**
1. Richer notification content matching current webhook format
2. Include requester context (org history, previous leases)
3. Add "View in Console" button/link
4. Consider adding "Request More Info" action
5. Thread-based conversation history for audit trail

### Phase 5: Cleanup and Documentation

**Goal:** Production readiness

**Tasks:**
1. Remove Slack webhook secret and related code
2. Update CLAUDE.md and README with new architecture
3. Document custom action setup in AWS Console (manual step)
4. Add runbook for common issues
5. Update architecture diagrams

## Known Limitations

1. **Custom actions require manual AWS Console configuration** - Cannot be defined via CDK/CloudFormation
2. **Thread updates appear as new messages** - Cannot edit original message like Slack API
3. **No button disable after click** - User can click approve multiple times (need idempotency)
4. **Notification deduplication** - Same `id` may be deduplicated; use unique IDs

## Files Modified/Created in POC

- `cdk/lib/amazon-q-slack-poc-stack.ts` - Full POC stack definition
- `cdk/config/environments.ts` - Added Slack config (workspace/channel IDs)
- `cdk/bin/cdk.ts` - Added POC stack instantiation (if applicable)

## Testing the POC

```bash
# Send test notification
aws lambda invoke --function-name AmazonQSlackPocTest \
  --payload '{"leaseUuid": "actual-uuid", "userEmail": "actual@email.gov.uk", "message": "Test"}' \
  --profile NDX/InnovationSandboxHub \
  --cli-binary-format raw-in-base64-out /dev/stdout

# Check approve Lambda logs
aws logs tail /aws/lambda/AmazonQSlackPocApprove --since 5m --profile NDX/InnovationSandboxHub
```
