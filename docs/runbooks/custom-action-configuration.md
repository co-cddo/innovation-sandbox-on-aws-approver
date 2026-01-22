# Custom Action Configuration Runbook

## Purpose

Configure Amazon Q Developer custom actions to enable Approve/Deny buttons in Slack lease approval notifications for the Innovation Sandbox (ISB) Approver.

## Overview

Custom actions allow operators to click "Approve" or "Deny" buttons directly in Slack notifications. When clicked, these buttons invoke Lambda functions that process the lease request.

**Architecture:**
```
Slack Notification → Button Click → Amazon Q Developer → Custom Action → Lambda → ISB Leases API
```

## Configuration Approach

As of Story 7.2.3, custom actions are **managed via CDK** using `AWS::Chatbot::CustomAction` CloudFormation resources. This means:

- Custom actions are created/updated automatically during `cdk deploy`
- No manual console configuration is required for initial setup
- Changes are version-controlled and repeatable

## Prerequisites

### Access Requirements

Before configuring or troubleshooting custom actions, ensure you have:

1. **AWS Console access** - with permissions to view CloudFormation, Lambda, and AWS Chatbot
2. **Slack workspace access** - member of the `#isb-approvals` channel (admin access required for channel configuration changes)

### Infrastructure Requirements

Before custom actions can work, ensure:

1. **ApproverStack is deployed** - provides Lambda functions and custom action definitions
2. **Slack channel configuration exists** - from Story 7.1.2
3. **SNS topic is configured** - notifications must flow to Slack
4. **IAM permissions are in place** - SlackChannelConfiguration role must be able to invoke Lambdas

## CDK-Managed Custom Actions

### What CDK Creates

The `ApproverStack` creates two custom actions:

| Action | Lambda | Button Text | Description |
|--------|--------|-------------|-------------|
| `isb-approve` | `ApproverSlackApprove` | ✅ Approve | Approves the lease request |
| `isb-deny` | `ApproverSlackDeny` | 🚫 Deny | Denies the lease request |

### How It Works

1. **Notification sent to SNS** with `enableCustomActions: true` in metadata
2. **Amazon Q Developer receives notification** and displays it in Slack with buttons
3. **Buttons extract `leaseId`** from `metadata.additionalContext.leaseId`
4. **Button click invokes Lambda** with payload: `{"leaseId": "<base64-encoded-composite-key>"}`
5. **Lambda decodes leaseId**, calls ISB Leases API, returns formatted response
6. **Response appears as thread reply** in Slack

### CDK Configuration

The custom actions are defined in `cdk/lib/approver-stack.ts`:

```typescript
// Approve Custom Action
new chatbot.CfnCustomAction(this, 'ApproveCustomAction', {
  actionName: 'isb-approve',
  definition: {
    commandText: `lambda invoke --function-name ${slackApproveLambda.function.functionName} --payload {"leaseId": "$leaseId"} --region ${this.region}`,
  },
  aliasName: 'approve-lease',
  attachments: [
    {
      buttonText: '✅ Approve',
      notificationType: 'custom',
      variables: {
        leaseId: '$.metadata.additionalContext.leaseId',
      },
      criteria: [
        {
          operator: 'HAS_VALUE',
          variableName: 'leaseId',
        },
      ],
    },
  ],
});
```

Key configuration elements:

| Property | Purpose |
|----------|---------|
| `actionName` | Unique identifier for the action |
| `commandText` | Lambda invoke command with payload template |
| `buttonText` | Text displayed on the button in Slack |
| `variables` | Maps notification fields to Lambda payload |
| `criteria` | Conditions for when button appears (leaseId must exist) |

## Getting Lambda ARNs

If you need to verify Lambda ARNs for troubleshooting:

```bash
# Get all stack outputs
aws cloudformation describe-stacks \
  --stack-name ApproverStack \
  --query 'Stacks[0].Outputs' \
  --output table \
  --profile NDX/InnovationSandboxHub

# Get specific Lambda ARNs
aws cloudformation describe-stacks \
  --stack-name ApproverStack \
  --query 'Stacks[0].Outputs[?OutputKey==`SlackApproveLambdaArn`].OutputValue' \
  --output text \
  --profile NDX/InnovationSandboxHub

aws cloudformation describe-stacks \
  --stack-name ApproverStack \
  --query 'Stacks[0].Outputs[?OutputKey==`SlackDenyLambdaArn`].OutputValue' \
  --output text \
  --profile NDX/InnovationSandboxHub
```

Expected output:
```
arn:aws:lambda:us-west-2:568672915267:function:ApproverSlackApprove
arn:aws:lambda:us-west-2:568672915267:function:ApproverSlackDeny
```

## Viewing Custom Actions in AWS Console

To view the CDK-managed custom actions:

1. Navigate to [AWS Chatbot Console](https://us-west-2.console.aws.amazon.com/chatbot/home?region=us-west-2#/chat-clients)
2. Click **Custom actions** in the left sidebar
3. You should see:
   - `isb-approve` with alias `approve-lease`
   - `isb-deny` with alias `deny-lease`

**Note:** These actions are managed by CloudFormation. Do not edit them manually in the console, as changes will be overwritten on the next `cdk deploy`.

### Screenshots

> **TODO:** Capture and add the following screenshots to `docs/runbooks/images/`:
>
> 1. `chatbot-custom-actions-list.png` - AWS Chatbot console showing both custom actions
> 2. `custom-action-approve-detail.png` - Detail view of the isb-approve action configuration
> 3. `custom-action-deny-detail.png` - Detail view of the isb-deny action configuration
> 4. `slack-notification-with-buttons.png` - Example Slack notification showing Approve/Deny buttons
> 5. `slack-thread-reply-success.png` - Example thread reply after successful action
>
> To capture screenshots:
> 1. Deploy ApproverStack to the target environment
> 2. Navigate to AWS Chatbot console > Custom actions
> 3. Use browser screenshot tools or OS screenshot utilities
> 4. Save images to `docs/runbooks/images/` directory

## Verification Checklist

After deployment, verify custom actions work:

- [ ] ApproverStack deployed successfully (`cdk deploy ApproverStack`)
- [ ] Custom actions visible in AWS Chatbot console
- [ ] Test notification sent to Slack shows Approve/Deny buttons
- [ ] Clicking Approve button:
  - [ ] Does not show permission error
  - [ ] Thread reply appears with result (success or "already processed")
- [ ] Clicking Deny button:
  - [ ] Does not show permission error
  - [ ] Thread reply appears with result (success or "already processed")
- [ ] CloudWatch logs show Lambda invocations

### Send Test Notification

```bash
# Create test notification
cat > /tmp/test-notification.json << 'EOF'
{
  "version": "1.0",
  "source": "custom",
  "id": "test-custom-action",
  "content": {
    "textType": "client-markdown",
    "title": ":test_tube: *Custom Action Test*",
    "description": "Testing Approve and Deny buttons work correctly.\n\nClick either button to verify Lambda invocation.",
    "nextSteps": ["Click Approve to test approval", "Click Deny to test denial"],
    "keywords": ["test", "custom-action"]
  },
  "metadata": {
    "threadId": "test-thread-id",
    "summary": "Custom action button test",
    "enableCustomActions": true,
    "additionalContext": {
      "leaseId": "eyJ1c2VyRW1haWwiOiJ0ZXN0QGV4YW1wbGUuY29tIiwidXVpZCI6InRlc3QtdXVpZCJ9",
      "userEmail": "test@example.com",
      "score": "25",
      "threshold": "20"
    }
  }
}
EOF

# Send to SNS
aws sns publish \
  --topic-arn "arn:aws:sns:us-west-2:568672915267:isb-approval-notifications" \
  --message file:///tmp/test-notification.json \
  --profile NDX/InnovationSandboxHub
```

## Troubleshooting

### Buttons Not Appearing

**Symptom:** Notification appears in Slack but no Approve/Deny buttons

**Causes:**
1. `enableCustomActions: true` not set in notification metadata
2. `additionalContext.leaseId` missing from notification
3. Custom actions not deployed (check AWS Chatbot console)

**Resolution:**
- Verify notification payload includes required metadata
- Run `cdk deploy ApproverStack` to ensure custom actions exist
- Check CloudFormation for custom action resources

### AccessDeniedException on Button Click

**Symptom:** Error message in Slack: "AccessDeniedException"

**Causes:**
1. SlackChannelConfiguration role lacks Lambda invoke permission
2. Lambda resource-based policy doesn't allow Chatbot

**Resolution:**
- Verify `SlackChannelLambdaInvokePolicy` exists on the Slack channel role
- Check Lambda has `chatbot.amazonaws.com` permission

```bash
# Check Lambda permissions
aws lambda get-policy \
  --function-name ApproverSlackApprove \
  --profile NDX/InnovationSandboxHub
```

### "Invalid lease identifier" Error

**Symptom:** Thread reply shows "Invalid lease identifier"

**Causes:**
1. `leaseId` not properly base64-encoded
2. Decoded JSON missing `userEmail` or `uuid` fields

**Resolution:**
- Verify leaseId encoding in notification:
  ```bash
  echo "eyJ1c2VyRW1haWwiOiJ0ZXN0QGV4YW1wbGUuY29tIiwidXVpZCI6InRlc3QtdXVpZCJ9" | base64 -d
  # Should output: {"userEmail":"test@example.com","uuid":"test-uuid"}
  ```

### Lambda Not Invoked

**Symptom:** No CloudWatch logs for Lambda, no thread reply

**Causes:**
1. Custom action command text incorrect
2. Variable mapping not extracting leaseId correctly

**Resolution:**
- Check custom action definition in CloudFormation template
- Verify `criteria` matches notification structure

## CloudWatch Log Queries

### Check Approve Lambda

```
fields @timestamp, @message
| filter @logStream like /ApproverSlackApprove/
| sort @timestamp desc
| limit 50
```

### Check Deny Lambda

```
fields @timestamp, @message
| filter @logStream like /ApproverSlackDeny/
| sort @timestamp desc
| limit 50
```

### Find Errors

```
fields @timestamp, @message
| filter @logStream like /ApproverSlack/
| filter @message like /ERROR/
| sort @timestamp desc
| limit 20
```

## Manual Override (Emergency Only)

If CDK-managed custom actions need manual editing (not recommended):

1. Navigate to AWS Chatbot Console > Custom actions
2. Select the action to edit
3. Make necessary changes
4. **Important:** Document changes and apply to CDK code to prevent overwrite

**Warning:** Manual changes will be overwritten on next `cdk deploy`. Always update CDK code for permanent changes.

## Related Documentation

- [AWS Chatbot Custom Actions Guide](https://docs.aws.amazon.com/chatbot/latest/adminguide/custom-actions.html)
- [Story 7.2.1: Create Approve Action Lambda](../_bmad-output/implementation-artifacts/7-2-1-create-approve-action-lambda.md)
- [Story 7.2.2: Create Deny Action Lambda](../_bmad-output/implementation-artifacts/7-2-2-create-deny-action-lambda.md)
- [Story 7.1.3: Notification Format](../_bmad-output/implementation-artifacts/7-1-3-format-rich-notification-with-action-buttons.md)

## Revision History

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-21 | Claude Code | Initial version - CDK-managed custom actions |
