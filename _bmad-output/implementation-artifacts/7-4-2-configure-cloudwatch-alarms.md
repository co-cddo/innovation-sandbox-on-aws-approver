# Story 7.4.2: Configure CloudWatch Alarms

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **platform team member**,
I want alarms when things go wrong,
So that I can respond to issues quickly.

## Acceptance Criteria

### AC1: Action Lambda Error Rate Alarm
**Given** the Approve or Deny Lambda
**When** error rate exceeds threshold (e.g., >1% over 5 minutes)
**Then** a CloudWatch alarm triggers
**And** notification is sent via existing alerting integration

### AC2: SNS Delivery Failure Alarm
**Given** the SNS notification topic (`isb-approval-notifications`)
**When** delivery failures occur
**Then** a CloudWatch alarm triggers
**And** notification is sent via existing alerting integration

### AC3: Alarm Actions Connected
**Given** alarms are configured
**When** an alarm triggers
**Then** it notifies the platform team's existing SNS topic (`ApproverAlarms`)

### AC4: Alarm Descriptions Include Context
**Given** an alarm triggers
**When** the platform team receives the notification
**Then** the alarm description explains what's wrong
**And** suggests initial troubleshooting steps

### AC5: Incident Response Runbook
**Given** alarms may trigger outside business hours
**When** this story is complete
**Then** a runbook documents how to respond to each alarm type
**And** includes common failure scenarios and resolution steps

## Tasks / Subtasks

- [x] Task 1: Add Slack Approve Lambda error rate alarm (AC: #1, #3, #4)
  - [x] 1.1: Create CloudWatch Alarm for `ApproverSlackApprove` function errors
  - [x] 1.2: Use MathExpression for percentage calculation: `(errors / invocations) * 100`
  - [x] 1.3: Set threshold at 1% over 5 minutes (matching existing approver pattern)
  - [x] 1.4: Add descriptive alarm description with troubleshooting context
  - [x] 1.5: Connect to existing `alarmTopic` SNS action

- [x] Task 2: Add Slack Deny Lambda error rate alarm (AC: #1, #3, #4)
  - [x] 2.1: Create CloudWatch Alarm for `ApproverSlackDeny` function errors
  - [x] 2.2: Use same MathExpression pattern as Task 1
  - [x] 2.3: Set threshold at 1% over 5 minutes
  - [x] 2.4: Add descriptive alarm description with troubleshooting context
  - [x] 2.5: Connect to existing `alarmTopic` SNS action

- [x] Task 3: Add SNS notification topic delivery failure alarm (AC: #2, #3, #4)
  - [x] 3.1: Create CloudWatch Alarm for `NumberOfNotificationsFailed` metric
  - [x] 3.2: Set threshold at >0 failures (any failure should alert)
  - [x] 3.3: Use 5-minute evaluation period
  - [x] 3.4: Add descriptive alarm description with troubleshooting steps
  - [x] 3.5: Connect to existing `alarmTopic` SNS action

- [x] Task 4: Create incident response runbook (AC: #5)
  - [x] 4.1: Create `docs/runbooks/slack-action-alarms.md`
  - [x] 4.2: Document each alarm type and what triggers it
  - [x] 4.3: Document step-by-step response procedures
  - [x] 4.4: Include CloudWatch Insights queries for diagnosis
  - [x] 4.5: Document escalation paths and contacts

- [x] Task 5: Add CDK tests for new alarms (AC: #1, #2, #3)
  - [x] 5.1: Add test verifying Approve Lambda error alarm exists
  - [x] 5.2: Add test verifying Deny Lambda error alarm exists
  - [x] 5.3: Add test verifying SNS failure alarm exists
  - [x] 5.4: Add test verifying all alarms connect to alarm topic

- [x] Task 6: Update stack outputs (AC: #1, #2, #3)
  - [x] 6.1: Add output for Approve Lambda alarm ARN
  - [x] 6.2: Add output for Deny Lambda alarm ARN
  - [x] 6.3: Add output for SNS failure alarm ARN

## Dev Notes

### CRITICAL: Existing Alarm Infrastructure Available

**Good news!** The alarm infrastructure is already in place from Story 5.3. This story extends it for Epic 7 Slack action components:

1. **Existing SNS alarm topic:** `ApproverAlarms` topic at `alarmTopic` in `approver-stack.ts:340-343`
2. **Existing alarm patterns:** DLQ depth, error rate, and duration alarms at lines 346-398
3. **Existing CDK imports:** `cloudwatch`, `aws_cloudwatch_actions` already imported

### Files to Modify

| File | Purpose |
|------|---------|
| `cdk/lib/approver-stack.ts` | Add 3 new CloudWatch alarms |
| `cdk/test/approver-stack.test.ts` | Add alarm existence tests |
| `docs/runbooks/slack-action-alarms.md` | New file - incident response |

### CDK Implementation Pattern

Follow existing alarm pattern from `approver-stack.ts:361-383`:

```typescript
// Example: Existing error rate alarm pattern (lines 361-383)
const errorRateAlarm = new cloudwatch.Alarm(this, 'ErrorRateAlarm', {
  alarmName: 'Approver-Error-Rate',
  alarmDescription: 'Lambda error rate exceeded threshold',
  metric: new cloudwatch.MathExpression({
    expression: '(errors / invocations) * 100',
    usingMetrics: {
      errors: approverLambda.function.metricErrors({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      invocations: approverLambda.function.metricInvocations({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
    },
    period: cdk.Duration.minutes(5),
  }),
  threshold: 1,
  evaluationPeriods: 1,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
});
errorRateAlarm.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(alarmTopic));
```

### Slack Lambda Error Rate Alarms

Create alarms for both `ApproverSlackApprove` and `ApproverSlackDeny` Lambdas:

```typescript
// Slack Approve Lambda Error Rate Alarm
const slackApproveErrorAlarm = new cloudwatch.Alarm(this, 'SlackApproveErrorAlarm', {
  alarmName: 'Approver-SlackApprove-Error-Rate',
  alarmDescription: `Slack Approve Lambda error rate exceeded 1%.

WHAT: Approve button clicks in Slack are failing.
IMPACT: Operators cannot approve lease requests via Slack - manual approval via ISB console required.
TROUBLESHOOTING:
1. Check CloudWatch Logs: /aws/lambda/ApproverSlackApprove
2. Look for ERROR entries with correlationId
3. Common causes: ISB Lambda unavailable, permission issues, timeout
RUNBOOK: docs/runbooks/slack-action-alarms.md`,
  metric: new cloudwatch.MathExpression({
    expression: '(errors / invocations) * 100',
    usingMetrics: {
      errors: slackApproveLambda.function.metricErrors({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      invocations: slackApproveLambda.function.metricInvocations({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
    },
    period: cdk.Duration.minutes(5),
  }),
  threshold: 1,
  evaluationPeriods: 1,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
});
slackApproveErrorAlarm.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(alarmTopic));
```

### SNS Delivery Failure Alarm

Use the built-in SNS `metricNumberOfNotificationsFailed`:

```typescript
// SNS Notification Delivery Failure Alarm
const snsDeliveryFailureAlarm = new cloudwatch.Alarm(this, 'SNSDeliveryFailureAlarm', {
  alarmName: 'Approver-SNS-Delivery-Failures',
  alarmDescription: `SNS notification delivery to Slack failed.

WHAT: Approval notifications are not reaching the Slack channel.
IMPACT: Operators won't see lease requests requiring manual approval - they'll queue up.
TROUBLESHOOTING:
1. Check SNS topic metrics in CloudWatch
2. Verify Chatbot subscription is active
3. Check Chatbot/Slack integration status
4. Fallback: 30-minute queue check will catch pending requests
RUNBOOK: docs/runbooks/slack-action-alarms.md`,
  metric: notificationTopic.metricNumberOfNotificationsFailed({
    period: cdk.Duration.minutes(5),
    statistic: 'Sum',
  }),
  threshold: 0,
  evaluationPeriods: 1,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
});
snsDeliveryFailureAlarm.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(alarmTopic));
```

### Where to Add Alarms in approver-stack.ts

Add the new alarms after the Slack Deny Lambda construct (around line 214) and before the EventBridge rules section:

```
Line 213: const slackDenyLambda = new SlackDenyLambda(...)
Line ~218: // ==========================================
          // Slack Action CloudWatch Alarms (Story 7.4.2)
          // ==========================================
          // Add alarms here
```

**Important:** The alarms need access to:
- `slackApproveLambda.function` - created at line 198
- `slackDenyLambda.function` - created at line 209
- `notificationTopic` - created at line 106
- `alarmTopic` - created at line 340

Since `alarmTopic` is created later in the file, you have two options:
1. **Move alarm topic creation earlier** (before Slack Lambda alarms)
2. **Add Slack alarms after the existing alarms** (after line 398)

**Recommendation:** Option 2 - add Slack alarms after line 398 to minimize code movement.

### CDK Test Patterns

Follow existing test pattern from `cdk/test/approver-stack.test.ts`:

```typescript
test('Slack Approve error rate alarm is configured', () => {
  template.hasResourceProperties('AWS::CloudWatch::Alarm', {
    AlarmName: 'Approver-SlackApprove-Error-Rate',
    ComparisonOperator: 'GreaterThanThreshold',
    Threshold: 1,
    EvaluationPeriods: 1,
  });
});

test('SNS delivery failure alarm is configured', () => {
  template.hasResourceProperties('AWS::CloudWatch::Alarm', {
    AlarmName: 'Approver-SNS-Delivery-Failures',
    MetricName: 'NumberOfNotificationsFailed',
    Threshold: 0,
  });
});
```

### Incident Response Runbook Structure

Create `docs/runbooks/slack-action-alarms.md` with:

1. **Overview** - What each alarm monitors
2. **Alarm: Approver-SlackApprove-Error-Rate**
   - What triggers it
   - CloudWatch Insights queries
   - Common causes and fixes
   - Escalation path
3. **Alarm: Approver-SlackDeny-Error-Rate**
   - Same structure as above
4. **Alarm: Approver-SNS-Delivery-Failures**
   - What triggers it
   - How to verify Chatbot subscription
   - Common causes and fixes
5. **Fallback mechanisms** - 30-minute queue check still processes requests
6. **Contacts** - Who to escalate to

### CloudWatch Insights Queries for Runbook

Include these queries in the runbook:

```
# Find errors in Approve Lambda
fields @timestamp, correlationId, action, outcome, error
| filter @logStream like /ApproverSlackApprove/
| filter outcome = 'error'
| sort @timestamp desc
| limit 50

# Find errors in Deny Lambda
fields @timestamp, correlationId, action, outcome, error
| filter @logStream like /ApproverSlackDeny/
| filter outcome = 'error'
| sort @timestamp desc
| limit 50

# All action attempts in last 24h
fields @timestamp, correlationId, action, outcome, leaseId, operator
| filter @logStream like /ApproverSlackApprove|ApproverSlackDeny/
| filter @message like /success|already_processed|error/
| sort @timestamp desc
| limit 100
```

### Project Structure Notes

**Alignment with project patterns:**
- Alarm naming convention: `Approver-{Component}-{Metric}` (matches existing)
- Description format: Multi-line with WHAT/IMPACT/TROUBLESHOOTING/RUNBOOK sections
- Test naming: Descriptive sentences (matches existing test style)
- Runbook location: `docs/runbooks/` directory (matches existing runbook)

### Previous Story Intelligence (7.4.1)

From Story 7.4.1:
- Logging is comprehensive with `outcome` field for filtering
- Correlation IDs link all log entries for a request
- CloudWatch Insights queries documented for audit trail
- Stack traces logged at DEBUG level

These can be referenced in the incident response runbook.

### Architecture Compliance

**From `_bmad-output/architecture.md`:**
- Observability: CloudWatch alarms for error rate, DLQ depth
- Alarm topic: `ApproverAlarms` SNS topic
- Testing: CDK snapshot + fine-grained tests

**From `_bmad-output/epics-amazon-q-slack.md` (FR17, FR18, FR19):**
- FR17: CloudWatch alarm on error rate → AC1
- FR18: CloudWatch alarm on SNS failures → AC2
- FR19: Platform team alerts → AC3

### Technical Requirements

**AWS CDK CloudWatch constructs:**
- `cloudwatch.Alarm` with `metric` and `threshold`
- `cloudwatch.MathExpression` for error rate percentage
- `sns.Topic.metricNumberOfNotificationsFailed()` for SNS failures
- `aws_cloudwatch_actions.SnsAction` for alarm notifications

**Lambda metrics available:**
- `metricErrors()` - count of failed invocations
- `metricInvocations()` - count of all invocations
- `metricDuration()` - execution time

**SNS metrics available:**
- `metricNumberOfNotificationsFailed()` - delivery failures
- `metricNumberOfMessagesPublished()` - successful publishes

### Risk Assessment

**Low risk:**
- No changes to Lambda runtime code
- Only adding alarms (additive change)
- Existing alarm infrastructure proven
- Tests verify alarm configuration

**Minor considerations:**
- Alarm thresholds may need tuning after deployment
- Consider adding "insufficient data" handling if Lambdas rarely invoked

### Git Commit Pattern

From recent commits:
```
1ad6585 docs: add custom action configuration runbook
```

**Suggested commit messages:**
```
feat(monitoring): add CloudWatch alarms for Slack action Lambdas

- Add error rate alarm for ApproverSlackApprove (Story 7.4.2 AC1)
- Add error rate alarm for ApproverSlackDeny (Story 7.4.2 AC1)
- Add SNS delivery failure alarm (Story 7.4.2 AC2)
- Connect all alarms to ApproverAlarms topic (Story 7.4.2 AC3)
- Include troubleshooting context in alarm descriptions (Story 7.4.2 AC4)

Story: 7.4.2
```

```
docs: add Slack action alarms incident response runbook

- Document alarm types and triggers
- Add CloudWatch Insights queries for diagnosis
- Document resolution steps for each failure scenario
- Include escalation paths and fallback mechanisms

Story: 7.4.2 AC5
```

### Definition of Done

- [x] Slack Approve Lambda error rate alarm configured
- [x] Slack Deny Lambda error rate alarm configured
- [x] SNS delivery failure alarm configured
- [x] All alarms connect to ApproverAlarms topic
- [x] Alarm descriptions include actionable troubleshooting
- [x] Incident response runbook created
- [x] CDK tests verify alarm existence
- [x] All existing tests still pass
- [x] `cdk synth` succeeds without errors

### References

- [Source: _bmad-output/epics-amazon-q-slack.md#Story 7.4.2]
- [Source: _bmad-output/epics-amazon-q-slack.md#FR17, FR18, FR19]
- [Source: _bmad-output/architecture.md#CloudWatch Alarms]
- [Source: cdk/lib/approver-stack.ts:340-398 - Existing alarm infrastructure]
- [Source: cdk/lib/approver-stack.ts:198-214 - Slack Lambda constructs]
- [Source: cdk/lib/approver-stack.ts:106 - Notification topic]
- [Source: _bmad-output/implementation-artifacts/7-4-1-implement-action-logging-to-cloudwatch.md - Logging patterns]
- [Source: docs/runbooks/custom-action-configuration.md - Existing runbook pattern]

---

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

- CDK synth: Successful, no errors
- Test suite: 1301 tests passed (including 66 CDK tests with new Story 7.4.2 alarm tests)

### Completion Notes List

- **Task 1:** Created `SlackApproveErrorAlarm` CloudWatch alarm using MathExpression for error rate calculation (>1% over 5 min), connected to `alarmTopic` SNS action with detailed WHAT/IMPACT/TROUBLESHOOTING/RUNBOOK description
- **Task 2:** Created `SlackDenyErrorAlarm` CloudWatch alarm with identical pattern to Task 1
- **Task 3:** Created `SNSDeliveryFailureAlarm` using `metricNumberOfNotificationsFailed` with threshold of 0 (any failure alerts), connected to `alarmTopic`
- **Task 4:** Created comprehensive incident response runbook at `docs/runbooks/slack-action-alarms.md` with diagnosis steps, CloudWatch Insights queries, common causes/fixes, escalation paths, and fallback mechanism documentation
- **Task 5:** Added 8 new CDK tests in two describe blocks: "Slack Action CloudWatch Alarms (Story 7.4.2)" and "Slack Action Alarm Outputs (Story 7.4.2)"
- **Task 6:** Added 3 stack outputs for alarm ARNs: `SlackApproveErrorAlarmArn`, `SlackDenyErrorAlarmArn`, `SNSDeliveryFailureAlarmArn`

### File List

- `cdk/lib/approver-stack.ts` (modified) - Added 3 CloudWatch alarms and 3 stack outputs
- `cdk/test/approver-stack.test.ts` (modified) - Added 8 new tests for alarm configuration
- `docs/runbooks/slack-action-alarms.md` (new) - Incident response runbook
- `src/handlers/slack-action-base.ts` (modified) - Story 7.4.1 logging enhancements (uncommitted from prior story)
- `test/handlers/slack-action-base.test.ts` (modified) - Story 7.4.1 logging tests (uncommitted from prior story)

### Change Log

| Date | Description |
|------|-------------|
| 2026-01-21 | Story 7.4.2: Implemented CloudWatch alarms for Slack action Lambdas and SNS delivery, added incident response runbook |
| 2026-01-21 | Code review: Fixed runbook hardcoded account IDs, updated contacts section, documented uncommitted 7.4.1 files |

---

## Senior Developer Review (AI)

**Reviewed:** 2026-01-21
**Reviewer:** Claude Opus 4.5 (Adversarial Code Review)
**Outcome:** ✅ APPROVED

### Review Summary

All 5 Acceptance Criteria verified as implemented:
- AC1: Lambda error rate alarms with MathExpression >1% threshold ✅
- AC2: SNS delivery failure alarm with threshold 0 ✅
- AC3: All alarms connected to `ApproverAlarms` SNS topic ✅
- AC4: Alarm descriptions include WHAT/IMPACT/TROUBLESHOOTING/RUNBOOK ✅
- AC5: Comprehensive incident response runbook created ✅

### Issues Found & Resolved

| Severity | Issue | Resolution |
|----------|-------|------------|
| MEDIUM | Uncommitted files from 7.4.1 not in File List | Added to File List with attribution |
| LOW | Hardcoded account IDs in runbook | Replaced with dynamic `$(aws sts get-caller-identity)` |
| LOW | Placeholder contact emails | Updated to use Slack channels, added TODO note |

### Verification

- All 1301 tests pass ✅
- `cdk synth` succeeds ✅
- CDK deprecation warnings are pre-existing tech debt (not introduced here)
