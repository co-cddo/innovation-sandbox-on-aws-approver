# Slack Action Alarms Incident Response Runbook

## Overview

This runbook covers incident response for CloudWatch alarms related to the Slack action integration (Epic 7). These alarms monitor the health of the approve/deny button functionality in Slack and notification delivery.

**Alarms Covered:**

| Alarm Name | Purpose | Threshold |
|------------|---------|-----------|
| `Approver-SlackApprove-Error-Rate` | Approve button Lambda errors | >1% over 5 min |
| `Approver-SlackDeny-Error-Rate` | Deny button Lambda errors | >1% over 5 min |
| `Approver-SNS-Delivery-Failures` | Notification delivery to Slack | >0 failures |

**Key Principle:** Slack actions are a convenience - the 30-minute scheduled queue check and ISB console remain available as fallbacks. No lease requests are lost; they just require manual processing.

---

## Alarm: Approver-SlackApprove-Error-Rate

### What Triggers It

This alarm fires when >1% of Approve Lambda invocations fail over a 5-minute period.

### Immediate Impact

- Operators clicking "Approve" in Slack see an error message
- Lease requests remain in pending state
- Manual approval via ISB console is still available

### Diagnosis Steps

1. **Check CloudWatch Logs**
   ```
   Log Group: /aws/lambda/ApproverSlackApprove
   ```

2. **Find recent errors using CloudWatch Insights**
   ```
   fields @timestamp, correlationId, action, outcome, error, leaseId, userEmail
   | filter @logStream like /ApproverSlackApprove/
   | filter outcome = 'error'
   | sort @timestamp desc
   | limit 50
   ```

3. **Check for ISB Lambda availability**
   - Verify ISB Leases Lambda is running
   - Check ISB Leases Lambda CloudWatch logs for errors
   - Look for 5xx responses or timeouts

4. **Check for permission issues**
   - Verify Lambda execution role has `lambda:InvokeFunction` permission
   - Check for any IAM policy changes

### Common Causes and Fixes

| Cause | Symptoms | Resolution |
|-------|----------|------------|
| ISB Lambda unavailable | `ISB Lambda invocation failed` in logs | Check ISB deployment status |
| Permission denied | `AccessDeniedException` in logs | Verify IAM role permissions |
| Timeout | `Task timed out` | Check ISB Lambda duration, increase timeout if needed |
| Invalid leaseId | `Failed to decode leaseId` | Check notification payload format |
| Network issues | Connection timeouts | Check VPC configuration if applicable |

### Escalation Path

1. **Level 1 (On-call):** Check logs, restart Lambda if needed
2. **Level 2 (Platform team):** Investigate IAM/network issues
3. **Level 3 (ISB team):** If ISB Lambda issues identified

---

## Alarm: Approver-SlackDeny-Error-Rate

### What Triggers It

This alarm fires when >1% of Deny Lambda invocations fail over a 5-minute period.

### Immediate Impact

- Operators clicking "Deny" in Slack see an error message
- Lease requests remain in pending state
- Manual denial via ISB console is still available

### Diagnosis Steps

1. **Check CloudWatch Logs**
   ```
   Log Group: /aws/lambda/ApproverSlackDeny
   ```

2. **Find recent errors using CloudWatch Insights**
   ```
   fields @timestamp, correlationId, action, outcome, error, leaseId, userEmail
   | filter @logStream like /ApproverSlackDeny/
   | filter outcome = 'error'
   | sort @timestamp desc
   | limit 50
   ```

3. **Follow same diagnosis steps as Approve alarm**

### Common Causes and Fixes

Same as Approver-SlackApprove-Error-Rate - the Lambdas share the same architecture and dependencies.

### Escalation Path

Same as Approver-SlackApprove-Error-Rate.

---

## Alarm: Approver-SNS-Delivery-Failures

### What Triggers It

This alarm fires when any SNS notification fails to deliver to the Slack channel subscription.

### Immediate Impact

- New lease requests requiring manual approval don't appear in Slack
- Lease requests are NOT lost - they remain pending
- The 30-minute scheduled queue check will still process them
- Operators can check ISB console directly for pending requests

### Diagnosis Steps

1. **Check SNS topic metrics**
   - Navigate to CloudWatch > Metrics > SNS
   - Select `isb-approval-notifications` topic
   - Check `NumberOfNotificationsFailed` and `NumberOfNotificationsDelivered`

2. **Verify Chatbot subscription**
   ```bash
   # List subscriptions on the notification topic
   # Get account ID dynamically to avoid hardcoding
   ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --profile NDX/InnovationSandboxHub)
   aws sns list-subscriptions-by-topic \
     --topic-arn "arn:aws:sns:us-west-2:${ACCOUNT_ID}:isb-approval-notifications" \
     --profile NDX/InnovationSandboxHub
   ```

3. **Check Chatbot status**
   - Navigate to AWS Chatbot console
   - Verify `ISBApproverSlack` configuration is active
   - Check Chatbot CloudWatch logs if enabled

4. **Test Slack connectivity**
   - Send a test notification manually
   - Verify it appears in the Slack channel

### Common Causes and Fixes

| Cause | Symptoms | Resolution |
|-------|----------|------------|
| Chatbot subscription removed | No subscription listed for Chatbot | Re-subscribe Chatbot to SNS topic |
| Slack workspace disconnected | Chatbot shows disconnected status | Re-authorize Slack workspace in AWS Console |
| Invalid notification format | Chatbot can't parse message | Check notification payload format |
| Slack API issues | Intermittent delivery failures | Wait for Slack to recover (external issue) |
| IAM permission changes | Delivery access denied | Verify Chatbot IAM role permissions |

### Verify Chatbot Subscription

```bash
# Get Chatbot configuration details
# Note: Chatbot ARNs use double-colon (::) before account ID (no region)
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --profile NDX/InnovationSandboxHub)
aws chatbot describe-slack-channel-configurations \
  --chat-configuration-arn "arn:aws:chatbot::${ACCOUNT_ID}:chat-configuration/slack-channel/ISBApproverSlack" \
  --profile NDX/InnovationSandboxHub
```

### Re-subscribe Chatbot to SNS Topic

If subscription was lost, redeploy the stack:
```bash
npm run cdk:deploy -- ApproverStack
```

Or manually via console:
1. Navigate to AWS Chatbot > ISBApproverSlack
2. Click "Configure notifications"
3. Add `isb-approval-notifications` SNS topic

### Escalation Path

1. **Level 1 (On-call):** Verify subscription, send test notification
2. **Level 2 (Platform team):** Investigate Chatbot/IAM issues, redeploy if needed
3. **Level 3 (AWS Support):** If Chatbot service issues suspected

---

## Fallback Mechanisms

Even when all alarms are firing, lease processing continues:

### 30-Minute Scheduled Queue Check

The `ApproverQueueCheck` EventBridge schedule runs every 30 minutes and processes any pending requests. This ensures:
- Requests are not lost even if Slack integration is completely down
- Maximum delay is 30 minutes for any pending request

### ISB Console Access

Operators can always access pending requests directly:
- Navigate to ISB Console
- View pending lease requests
- Approve or deny manually

### Approver Lambda Still Processing

The main Approver Lambda continues to:
- Receive LeaseRequested events
- Process automatic approvals (score < threshold)
- Queue requests for manual review

Only the Slack notification and button interaction is affected by these alarms.

---

## CloudWatch Insights Queries

### All Action Attempts (Last 24h)

```
fields @timestamp, correlationId, action, outcome, leaseId, userEmail, operator
| filter @logStream like /ApproverSlackApprove|ApproverSlackDeny/
| filter @message like /success|already_processed|error/
| sort @timestamp desc
| limit 100
```

### Success Rate by Action Type

```
fields action, outcome
| filter @logStream like /ApproverSlackApprove|ApproverSlackDeny/
| filter outcome in ['success', 'error', 'already_processed']
| stats count() as total by action, outcome
```

### Error Details with Stack Traces

```
fields @timestamp, correlationId, action, error, stack
| filter @logStream like /ApproverSlackApprove|ApproverSlackDeny/
| filter outcome = 'error'
| sort @timestamp desc
| limit 20
```

### ISB Lambda Response Analysis

```
fields @timestamp, correlationId, statusCode, error
| filter @logStream like /ApproverSlackApprove|ApproverSlackDeny/
| filter @message like /ISB Lambda/
| sort @timestamp desc
| limit 50
```

---

## Testing Alarm Response

### Send Test Notification

```bash
# Create test notification payload
cat > /tmp/test-alarm-notification.json << 'EOF'
{
  "version": "1.0",
  "source": "custom",
  "id": "alarm-test",
  "content": {
    "textType": "client-markdown",
    "title": ":test_tube: *Alarm Test Notification*",
    "description": "Testing alarm response procedures.\n\nThis is a test notification to verify Slack delivery.",
    "nextSteps": ["Click Approve to test", "Click Deny to test"]
  },
  "metadata": {
    "summary": "Alarm test notification",
    "enableCustomActions": true,
    "additionalContext": {
      "leaseId": "eyJ1c2VyRW1haWwiOiJ0ZXN0QGV4YW1wbGUuY29tIiwidXVpZCI6InRlc3QtdXVpZCJ9"
    }
  }
}
EOF

# Publish to SNS topic
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --profile NDX/InnovationSandboxHub)
aws sns publish \
  --topic-arn "arn:aws:sns:us-west-2:${ACCOUNT_ID}:isb-approval-notifications" \
  --message file:///tmp/test-alarm-notification.json \
  --profile NDX/InnovationSandboxHub
```

### Manually Trigger Lambda for Testing

```bash
# Test Approve Lambda
aws lambda invoke \
  --function-name ApproverSlackApprove \
  --payload '{"leaseId": "eyJ1c2VyRW1haWwiOiJ0ZXN0QGV4YW1wbGUuY29tIiwidXVpZCI6InRlc3QtdXVpZCJ9"}' \
  /tmp/approve-response.json \
  --profile NDX/InnovationSandboxHub

cat /tmp/approve-response.json
```

---

## Contacts

> **TODO:** Update placeholder contacts with actual team contacts before production use.

| Role | Contact | When to Escalate |
|------|---------|------------------|
| On-call | #ndx-sandbox-alerts Slack channel | First response |
| Platform Team | NDX Platform Team (via Slack) | IAM/infrastructure issues |
| ISB Team | NDX ISB Team (via Slack) | ISB Lambda/API issues |
| AWS Support | AWS Console | Chatbot service issues |

---

## Revision History

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-21 | Claude Code | Initial version (Story 7.4.2) |
