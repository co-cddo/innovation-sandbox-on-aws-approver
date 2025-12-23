# Story 5.5: E2E Milestone - Full System Validation

Status: done

## Story

As a **developer**,
I want **to verify the complete system works end-to-end including all communications**,
So that **I have confidence the system is production-ready**.

**Story Type:** Verification/Spike (testing only - minimal code changes expected)

## Acceptance Criteria

1. **AC1: Low-risk auto-approval verification**
   - Given Stories 1.1-5.4 are deployed
   - When Cns triggers a low-risk lease request (score < 20) via ISB UI
   - Then request is auto-approved
   - And lease comments are updated with neutral language
   - And no Slack notification is sent

2. **AC2: High-risk escalation verification**
   - Given Stories 1.1-5.4 are deployed
   - When Cns triggers a high-risk lease request (score >= 20) via ISB UI
   - Then request is escalated
   - And lease comments are updated with "Review in progress" message
   - And Slack workflow is triggered with correct payload
   - And Slack message appears in configured channel

3. **AC3: Out-of-hours delay verification**
   - Given Stories 1.1-5.4 are deployed
   - When Cns triggers a request outside business hours (7am-7pm London weekdays)
   - Then request is delayed
   - And lease comments are updated with delay message
   - And request is processed at next 30-minute queue check

4. **AC4: Allow-list override verification**
   - Given Stories 1.1-5.4 are deployed
   - When Cns triggers request with an allow-listed email
   - Then request is auto-approved with ALLOW-LIST-OVERRIDE
   - And lease comments indicate allow-list approval

5. **AC5: Slack notification content verification**
   - Given a request is escalated
   - When Slack workflow is triggered
   - Then message contains:
     - User email
     - Template/budget information
     - Complete score breakdown (all 16 rules)
     - ISB console deep link
     - Reference number (ISB-YYYY-NNNN format)

6. **AC6: CloudWatch logs verification**
   - Given any request is processed
   - When checking CloudWatch logs
   - Then structured JSON logs are visible
   - And logs include leaseId, userEmail, domain, score, scoreBreakdown
   - And logs have correct 7-year retention configured

7. **AC7: CloudWatch metrics verification**
   - Given requests have been processed
   - When checking CloudWatch metrics in namespace "Approver"
   - Then custom metrics appear:
     - ApproverDecisions (with action dimension)
     - ApproverScore
     - ApproverLatency (with stage dimension)
     - ApproverRuleTrigger (with rule dimension)

8. **AC8: CloudWatch alarms verification**
   - Given CDK stack is deployed
   - When checking CloudWatch alarms
   - Then alarms are configured:
     - DLQ depth > 5 messages
     - Error rate > 1% over 5 minutes
     - p95 latency > 5 seconds
   - And alarms route to SNS topic

## Tasks / Subtasks

- [ ] Task 1: Verify deployment prerequisites (AC: All)
  - [ ] Confirm all Stories 5.1-5.4 are deployed successfully
  - [ ] Verify Lambda function is running with correct environment variables
  - [ ] Confirm Slack webhook is configured in Secrets Manager
  - [ ] Check CloudWatch log group exists with 7-year retention

- [ ] Task 2: Prepare test documentation (AC: 1-5)
  - [ ] Document expected scores for each test scenario
  - [ ] Identify test emails for each scenario type
  - [ ] Document expected Slack payload structure

- [ ] Task 3: Execute low-risk auto-approval test (AC: 1)
  - [ ] Trigger lease request via ISB UI
  - [ ] Verify auto-approval occurs
  - [ ] Check lease comments updated correctly
  - [ ] Verify no Slack notification sent

- [ ] Task 4: Execute high-risk escalation test (AC: 2, 5)
  - [ ] Trigger high-risk request (e.g., group mailbox email)
  - [ ] Verify escalation occurs
  - [ ] Check lease comments updated
  - [ ] Verify Slack workflow triggered
  - [ ] Verify Slack message content (all 16 rules shown)
  - [ ] Test ISB console deep link

- [ ] Task 5: Execute out-of-hours delay test (AC: 3)
  - [ ] Trigger request outside 7am-7pm London weekdays
  - [ ] Verify request is delayed (not processed immediately)
  - [ ] Check lease comments show delay message
  - [ ] Wait for 30-minute queue check
  - [ ] Verify processing occurs at next check

- [ ] Task 6: Execute allow-list override test (AC: 4)
  - [ ] Trigger request with allow-listed email
  - [ ] Verify ALLOW-LIST-OVERRIDE approval
  - [ ] Check lease comments show allow-list approval

- [ ] Task 7: Verify CloudWatch logs (AC: 6)
  - [ ] Query CloudWatch Logs Insights for recent decisions
  - [ ] Verify structured JSON format
  - [ ] Verify all required fields present
  - [ ] Confirm 7-year retention policy

- [ ] Task 8: Verify CloudWatch metrics (AC: 7)
  - [ ] Check Approver namespace in CloudWatch
  - [ ] Verify ApproverDecisions metric appears
  - [ ] Verify ApproverScore metric appears
  - [ ] Verify ApproverLatency metric with stage dimensions
  - [ ] Verify ApproverRuleTrigger metric with rule dimensions

- [ ] Task 9: Verify CloudWatch alarms (AC: 8)
  - [ ] Check DLQ depth alarm configuration
  - [ ] Check error rate alarm configuration
  - [ ] Check latency alarm configuration
  - [ ] Verify SNS topic for notifications

- [ ] Task 10: Document E2E test results (AC: All)
  - [ ] Record actual vs expected results for each scenario
  - [ ] Note any discrepancies or issues found
  - [ ] Document any remediation actions needed

## Dev Notes

### E2E Protocol

This is an E2E Milestone story that requires interactive testing:

```
<promise>STOP</promise>
```

**The automation loop must halt here for interactive testing with Cns via ISB UI.**

### Test Scenarios Matrix

| Test Case | Scenario | Expected Score | Expected Outcome | Slack? |
|-----------|----------|----------------|------------------|--------|
| 1 | Low-risk returning user | < 20 | Auto-approve | No |
| 2 | Group mailbox (team@) | >= 20 (+20) | Escalate | Yes |
| 3 | Out-of-hours request | Any | Delayed | Depends |
| 4 | Allow-listed email | Any | Auto-approve (OVERRIDE) | No |
| 5 | First-time user | +5 | Depends on other rules | Depends |

### Allow-Listed Emails for Testing

From `src/lib/allow-list.ts` (Story 2.4):
- `chris.nesbitt-smith@digital.cabinet-office.gov.uk`
- `chris.nesbitt-smith@dsit.gov.uk`
- `ndx+test@dsit.gov.uk`
- `benjamin.bennett@dsit.gov.uk`
- `dimitris.perdikou@dsit.gov.uk`
- `edward.mccutcheon@dsit.gov.uk`

### Slack Workflow Webhook

From Story 5.2:
- **Secret ARN:** `arn:aws:secretsmanager:us-west-2:568672915267:secret:/approver/slack-webhook-url-FXJl1d`
- **Webhook type:** Slack Workflow webhook (not Incoming Webhook)
- **Payload includes:** score, scoreBreakdown (all 16 rules), consoleUrl, referenceNumber

### Lease Comments Format

From Story 5.1:
- **Auto-approved:** "This request has been processed. Reference: ISB-{YYYY}-{NNNN}. Score: {N}/20."
- **Allow-list approved:** "This request was approved via allow-list. Reference: ISB-{YYYY}-{NNNN}."
- **Escalated:** "This request is being reviewed by an operator. Reference: ISB-{YYYY}-{NNNN}. Score: {N}/20."
- **Delayed:** "Request received outside business hours. Processing will resume during the next business window. Reference: ISB-{YYYY}-{NNNN}."
- **Expired:** "Request expired after {N} days without available accounts. Reference: ISB-{YYYY}-{NNNN}. Please submit a new request."

### CloudWatch Queries for Verification

**All decisions for test user:**
```sql
fields @timestamp, action, score, leaseId, templateId
| filter userEmail = "ndx+test@dsit.gov.uk"
| sort @timestamp desc
| limit 100
```

**Score breakdown verification:**
```sql
fields @timestamp, userEmail, action, score, scoreBreakdown
| filter ispresent(scoreBreakdown)
| sort @timestamp desc
| limit 10
```

### Previous Epic Intelligence

**Epic 5 Stories Completed:**
1. Story 5.1: Lease comments updates with neutral language
2. Story 5.2: Slack workflow webhook notifications
3. Story 5.3: CloudWatch structured logging and metrics
4. Story 5.4: Per-rule trigger tracking and audit trail (7-year retention)

### CloudWatch Alarms (from Story 5.3)

| Alarm | Metric | Threshold | Evaluation |
|-------|--------|-----------|------------|
| Approver-DLQ-Depth | DLQ messages visible | > 5 | 1 period (5min) |
| Approver-Error-Rate | (errors/invocations)*100 | > 1% | 1 period (5min) |
| Approver-High-Latency | Duration p95 | > 5000ms | 2 periods (5min) |

### References

- [Source: epics.md#Story-5.5] - Full acceptance criteria
- [Source: 5-4-per-rule-trigger-tracking-and-audit-trail.md] - Previous story
- [Source: 3-5-e2e-milestone-intelligent-scoring-validation.md] - E2E testing pattern
- [Source: architecture.md#Testing-Standards] - E2E testing approach
- [Source: sprint-status.yaml] - Story status tracking

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

