---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - '_bmad-output/prd-amazon-q-slack.md'
  - '_bmad-output/architecture.md'
  - 'cdk/lib/amazon-q-slack-poc-stack.ts'
  - 'cdk/bin/approver.ts'
  - 'cdk/config/environments.ts'
project_name: 'innovation-sandbox-on-aws-approver'
feature_name: 'Amazon Q Developer Slack Integration'
epic_number: 7
date: '2026-01-20'
---

# Epic 7: Amazon Q Developer Slack Integration

## Overview

This document provides the epic and story breakdown for replacing Slack webhook notifications with Amazon Q Developer (AWS Chatbot) integration, enabling interactive approve/deny actions directly within Slack.

## Requirements Inventory

### Functional Requirements

FR1: Scoring system can publish escalation notifications to SNS topic when requests exceed threshold
FR2: Notification can include requester email, score, score breakdown, template details, comment, and request ID
FR3: Amazon Q Developer can receive SNS notifications and deliver to configured Slack channel
FR4: Notification can render as rich formatted message with approve/deny action buttons
FR5: Operator can approve a lease request by clicking the Approve button in Slack
FR6: Operator can deny a lease request by clicking the Deny button in Slack
FR7: Approve action can invoke ISB Leases Lambda approve endpoint with request ID and operator identity
FR8: Deny action can invoke ISB Leases Lambda deny endpoint with request ID and operator identity
FR9: System can post thread reply confirming successful approval with operator identity and timestamp
FR10: System can post thread reply confirming successful denial with operator identity and timestamp
FR11: System can post thread reply indicating request was already processed by another operator
FR12: System can post thread reply indicating error with reference ID when action fails
FR13: System can detect duplicate action attempts on already-processed requests
FR14: System can log all action attempts to CloudWatch for audit trail
FR15: System can log idempotency cache hits for duplicate verification
FR16: System can store action outcomes in DynamoDB for audit persistence
FR17: CloudWatch can alarm when action Lambda error rate exceeds threshold
FR18: CloudWatch can alarm when SNS delivery fails
FR19: Platform team can receive alerts via existing alerting integration when alarms trigger
FR20: Team lead can add approvers by inviting them to the Slack channel
FR21: Team lead can remove approvers by removing them from the Slack channel
FR22: Operators can access onboarding guidance via pinned Slack canvas in the approvals channel
FR23: Operations team can access runbook documenting custom action configuration
FR24: Existing Slack webhook code can be removed after successful approve and deny manually confirmed
FR25: Existing 30-minute scheduled queue check remains operational as fallback mechanism

### Non-Functional Requirements

NFR1: SNS notifications must be delivered with AWS-managed reliability (no self-managed retry logic required)
NFR2: Action Lambda failures must fail closed - request remains pending, never auto-approved or auto-denied
NFR3: Idempotency must be guaranteed - duplicate button clicks must never result in duplicate ISB Leases API calls
NFR4: Thread reply delivery must succeed >99% of action attempts
NFR5: Existing 30-minute scheduled queue check must remain operational as fallback mechanism
NFR6: Operator authorization must be derived from Slack channel membership (no separate permission system)
NFR7: Request IDs must be non-guessable (UUIDs, not sequential integers)
NFR8: All action attempts must be logged to immutable audit trail (CloudWatch + DynamoDB)
NFR9: Slack channel must be private and invite-only
NFR10: ISB Leases Lambda API integration must handle transient failures with appropriate error messaging
NFR11: End-to-end action latency (button click → thread reply) must be acceptable for interactive use (<5 seconds typical)
NFR12: SNS message format must be compatible with Amazon Q Developer notification rendering

### Additional Requirements

**Infrastructure (from Architecture + POC):**
- Integrate SNS topic into existing ApproverStack (migrate from POC)
- Configure Amazon Q Developer (Chatbot) for Slack channel
- Create Approve Lambda with ISB Leases Lambda invocation
- Create Deny Lambda with ISB Leases Lambda invocation
- Set up IAM guardrail policies for Lambda invocation
- Thread update capability via SNS publish

**POC Cleanup:**
- Remove `AmazonQSlackPocStack` instantiation from `cdk/bin/approver.ts`
- Remove `SlackConfig` interface and `SLACK_CONFIG` from `cdk/config/environments.ts`
- Delete `cdk/lib/amazon-q-slack-poc-stack.ts` file
- Migrate POC patterns to production ApproverStack

**Manual Configuration:**
- Custom actions must be configured manually in AWS Console (not CDK-manageable)
- Document custom action setup with screenshots in runbook

**Existing Webhook Removal:**
- Remove `slack-callback` Lambda and handler after validation
- Remove API Gateway endpoint for Slack callbacks
- Remove Slack webhook URL secret dependency
- Remove Slack signing secret dependency
- Update approver Lambda to publish to SNS instead of webhook

**Documentation:**
- Create operator onboarding Slack canvas (markdown format)
- Create runbook for custom action configuration
- Update architecture documentation

### FR Coverage Map

| FR | Epic | Description |
|----|------|-------------|
| FR1 | 7.1 | Publish escalation notifications to SNS |
| FR2 | 7.1 | Notification includes full context |
| FR3 | 7.1 | Amazon Q delivers to Slack channel |
| FR4 | 7.1 | Rich message with action buttons |
| FR5 | 7.2 | Approve via Slack button |
| FR6 | 7.2 | Deny via Slack button |
| FR7 | 7.2 | Approve invokes ISB Leases Lambda |
| FR8 | 7.2 | Deny invokes ISB Leases Lambda |
| FR9 | 7.3 | Thread reply confirms approval |
| FR10 | 7.3 | Thread reply confirms denial |
| FR11 | 7.3 | Thread reply for already processed |
| FR12 | 7.3 | Thread reply for errors |
| FR13 | 7.2 | Detect duplicate attempts |
| FR14 | 7.4 | Log all actions to CloudWatch |
| FR15 | 7.4 | Log idempotency cache hits |
| FR16 | **DROPPED** | DynamoDB audit storage - **Decision confirmed:** CloudWatch logging provides sufficient audit trail for this use case |
| FR17 | 7.4 | CloudWatch alarm on error rate |
| FR18 | 7.4 | CloudWatch alarm on SNS failures |
| FR19 | 7.4 | Platform team alerts |
| FR20 | 7.5 | Add approvers via channel invite |
| FR21 | 7.5 | Remove approvers via channel removal |
| FR22 | 7.5 | Operator onboarding canvas |
| FR23 | 7.5 | Custom action runbook |
| FR24 | 7.5 | Remove webhook code after validation |
| FR25 | 7.5 | 30-minute fallback remains |

## Epic 7: Amazon Q Developer Slack Integration

*Goal: Replace one-way Slack webhooks with interactive Amazon Q notifications, enabling operators to approve/deny lease requests directly in Slack with zero context switching.*

### Epic 7.1: Operators Receive Rich Notifications in Slack
Operators get full context for decision-making without leaving Slack. When a lease request exceeds the threshold, operators see a rich notification with requester email, score breakdown, template details, requester comment, and approve/deny buttons.

**FRs covered:** FR1, FR2, FR3, FR4
**NFRs addressed:** NFR1, NFR12

**Stakeholder enhancement:** FR2 story must explicitly include requester's comment field in notification - this often tips the approval decision.

### Epic 7.2: Operators Can Approve or Deny with One Click
Single-click approval/denial directly from Slack notifications. Operators click Approve or Deny button, and the action is processed against ISB Leases Lambda. Duplicate clicks are handled gracefully with idempotency.

**FRs covered:** FR5, FR6, FR7, FR8, FR13
**NFRs addressed:** NFR2, NFR3, NFR10, NFR11

**Stakeholder enhancement:** FR13 story must include explicit test coverage requirements proving idempotency works (duplicate clicks, race conditions) before webhook removal.

### Epic 7.3: Operators Get Clear Action Feedback
Thread replies confirm what happened and who did it. After clicking a button, a thread reply confirms the action with operator identity and timestamp. If already handled or error occurred, clear feedback is shown.

**FRs covered:** FR9, FR10, FR11, FR12
**NFRs addressed:** NFR4

### Epic 7.4: Platform Team Monitors and Audits
Complete audit trail and operational alerting. Platform team has CloudWatch alarms for errors and full audit trail in CloudWatch logs.

**FRs covered:** FR14, FR15, FR17, FR18, FR19
**NFRs addressed:** NFR7, NFR8

**Stakeholder enhancement:** Add incident response runbook covering Lambda failure scenarios (what to do at 2am when Approve Lambda is failing). Alarms should include actionable next steps.

### Epic 7.5: Team Leads Manage Approvers & Migration
Simplified access control, complete documentation, and clean migration. Team leads add/remove approvers via Slack channel membership. Operators have onboarding canvas, ops team has runbook. Old webhook code removed after validation, fallback mechanism preserved.

**FRs covered:** FR20, FR21, FR22, FR23, FR24, FR25
**NFRs addressed:** NFR5, NFR6, NFR9

**Stakeholder enhancements:**
- FR22 story must specify canvas content: score thresholds, factor meanings, decision criteria, how to contact requesters, "check thread first" reminder
- Add AC for documenting quarterly access audit process (how team leads review channel membership)

**Pre-mortem enhancement:**
- FR24 story AC must include: "POC stack verified deleted from AWS account (not just code removed)" - prevents deployment confusion during incidents

---

## Epic 7.1: Operators Receive Rich Notifications in Slack

Operators get full context for decision-making without leaving Slack. When a lease request exceeds the threshold, operators see a rich notification with requester email, score breakdown, template details, requester comment, and approve/deny buttons.

### Story 7.1.1: Integrate SNS Topic into ApproverStack

As an **operator**,
I want lease escalation notifications published to a reliable message queue,
So that notifications can be delivered to Slack without direct webhook coupling.

**Acceptance Criteria:**

**AC1: SNS Topic Creation**
**Given** the ApproverStack CDK is deployed
**When** the stack synthesizes
**Then** an SNS topic `isb-approval-notifications` is created
**And** the topic has appropriate tags for cost tracking

**AC2: Scoring Lambda Publishes to SNS**
**Given** a lease request exceeds the approval threshold (score > 20)
**When** the scoring Lambda determines manual review is needed
**Then** a notification is published to the SNS topic
**And** the publish includes the full notification payload (see FR2)

**AC3: SNS Publish Replaces Webhook Call**
**Given** the Approver Lambda currently calls Slack webhook directly
**When** this story is complete
**Then** the Lambda publishes to SNS instead of calling webhook
**And** the webhook call code is retained but disabled (for FR24 validation later)

**AC4: IAM Permissions**
**Given** the Approver Lambda execution role
**When** attempting to publish to the SNS topic
**Then** the publish succeeds with appropriate `sns:Publish` permission

### Story 7.1.2: Configure Amazon Q Developer for Slack

As an **operator**,
I want Amazon Q Developer configured to deliver notifications to my Slack channel,
So that I receive lease escalation alerts where I already work.

**Acceptance Criteria:**

**AC1: Chatbot Slack Channel Configuration**
**Given** the ApproverStack CDK is deployed
**When** the stack synthesizes
**Then** a SlackChannelConfiguration is created for `#isb-approvals` channel
**And** the configuration uses the existing Slack workspace ID and channel ID from config

**AC2: SNS Subscription**
**Given** the Chatbot configuration exists
**When** SNS topic `isb-approval-notifications` receives a message
**Then** the message is delivered to the configured Slack channel

**AC3: Guardrail Policy for Lambda Invocation**
**Given** the Chatbot configuration
**When** custom actions are configured (in later story)
**Then** the guardrail policy allows `lambda:InvokeFunction` for action Lambdas

**AC4: CDK Outputs for Manual Configuration**
**Given** the stack is deployed
**When** viewing CloudFormation outputs
**Then** the Slack channel configuration ARN is available
**And** instructions reference the custom action console URL

### Story 7.1.3: Format Rich Notification with Action Buttons

As an **operator**,
I want notifications to include all context I need to make a decision,
So that I can approve or deny without looking elsewhere.

**Acceptance Criteria:**

**AC1: Notification Content - Core Fields**
**Given** a lease request is escalated for manual review
**When** the SNS notification is published
**Then** the message includes:
- Requester email address
- Total score and threshold
- Request ID (leaseId)
- Timestamp

**AC2: Notification Content - Score Breakdown**
**Given** a lease request is escalated
**When** the notification is rendered in Slack
**Then** the score breakdown shows each contributing factor with points
**And** risk factors are clearly highlighted

**AC3: Notification Content - Template Details**
**Given** a lease request is escalated
**When** the notification is rendered
**Then** it includes template name, duration, and budget

**AC4: Notification Content - Requester Comment**
**Given** a lease request includes a comment from the requester
**When** the notification is rendered
**Then** the comment is displayed prominently
**And** empty comments show "No comment provided"

**AC5: Action Buttons Displayed**
**Given** the notification is delivered to Slack
**When** an operator views the message
**Then** Approve and Deny buttons are visible
**And** buttons include the leaseId in their payload for action processing

**AC6: Amazon Q Custom Notification Format**
**Given** the SNS message is published
**When** Amazon Q Developer processes it
**Then** the message follows the Amazon Q custom notification schema (version 1.0, source: custom)
**And** metadata includes `threadId` for thread reply correlation
**And** `enableCustomActions: true` is set

---

## Epic 7.2: Operators Can Approve or Deny with One Click

Single-click approval/denial directly from Slack notifications. Operators click Approve or Deny button, and the action is processed against ISB Leases Lambda. Duplicate clicks are handled gracefully with idempotency.

### Story 7.2.1: Create Approve Action Lambda

As an **operator**,
I want to approve a lease request by clicking the Approve button in Slack,
So that I can grant sandbox access without leaving my workflow.

**Acceptance Criteria:**

**AC1: Lambda Function Creation**
**Given** the ApproverStack CDK is deployed
**When** the stack synthesizes
**Then** an Approve Lambda function `ApproverSlackApprove` is created
**And** it uses Node.js 20.x runtime
**And** timeout is set to 30 seconds

**AC2: Invoke ISB Leases Lambda**
**Given** an operator clicks the Approve button in Slack
**When** the Approve Lambda receives the custom action payload
**Then** it extracts the leaseId from the payload
**And** invokes ISB Leases Lambda with action: "Approve"
**And** includes proper authorization header for automated approver

**AC3: Handle ISB Lambda Success**
**Given** ISB Leases Lambda returns success (2xx)
**When** the Approve Lambda processes the response
**Then** it returns success status for thread reply processing

**AC4: Handle ISB Lambda Failure**
**Given** ISB Leases Lambda returns an error (4xx/5xx)
**When** the Approve Lambda processes the response
**Then** it fails closed (request remains pending)
**And** returns error status with reference ID for troubleshooting

**AC5: IAM Permissions**
**Given** the Approve Lambda execution role
**When** invoking ISB Leases Lambda
**Then** the invocation succeeds with appropriate `lambda:InvokeFunction` permission

**AC6: Environment Configuration**
**Given** the Approve Lambda is deployed
**When** it executes
**Then** ISB Leases Lambda name is available via environment variable
**And** SNS topic ARN is available for thread replies

### Story 7.2.2: Create Deny Action Lambda

As an **operator**,
I want to deny a lease request by clicking the Deny button in Slack,
So that I can reject inappropriate requests without leaving my workflow.

**Acceptance Criteria:**

**AC1: Lambda Function Creation**
**Given** the ApproverStack CDK is deployed
**When** the stack synthesizes
**Then** a Deny Lambda function `ApproverSlackDeny` is created
**And** it uses Node.js 20.x runtime
**And** timeout is set to 30 seconds

**AC2: Invoke ISB Leases Lambda**
**Given** an operator clicks the Deny button in Slack
**When** the Deny Lambda receives the custom action payload
**Then** it extracts the leaseId from the payload
**And** invokes ISB Leases Lambda with action: "Deny"
**And** includes proper authorization header for automated approver

**AC3: Handle ISB Lambda Success**
**Given** ISB Leases Lambda returns success (2xx)
**When** the Deny Lambda processes the response
**Then** it returns success status for thread reply processing

**AC4: Handle ISB Lambda Failure**
**Given** ISB Leases Lambda returns an error (4xx/5xx)
**When** the Deny Lambda processes the response
**Then** it fails closed (request remains pending)
**And** returns error status with reference ID for troubleshooting

**AC5: Shared Infrastructure with Approve Lambda**
**Given** the Deny Lambda is created
**When** reviewing the CDK code
**Then** it shares the same IAM role pattern as Approve Lambda
**And** uses the same environment variable configuration pattern

### Story 7.2.3: Configure Custom Actions in Slack

As an **operator**,
I want the Approve and Deny buttons in Slack to invoke the correct Lambdas,
So that my button clicks actually process the lease requests.

**Acceptance Criteria:**

**AC1: Approve Custom Action Configured**
**Given** the ApproverStack is deployed with Approve Lambda
**When** an admin configures custom actions in Slack
**Then** an "Approve" action is created
**And** it invokes the `ApproverSlackApprove` Lambda ARN
**And** it passes `leaseId` parameter from the button payload

**AC2: Deny Custom Action Configured**
**Given** the ApproverStack is deployed with Deny Lambda
**When** an admin configures custom actions in Slack
**Then** a "Deny" action is created
**And** it invokes the `ApproverSlackDeny` Lambda ARN
**And** it passes `leaseId` parameter from the button payload

**AC3: Runbook Documents Configuration Steps**
**Given** custom actions cannot be configured via CDK
**When** this story is complete
**Then** a runbook exists with step-by-step instructions
**And** includes screenshots of the Slack configuration UI
**And** documents the exact Lambda ARNs to use
**And** documents the parameter mapping for leaseId

**AC4: CDK Outputs Support Configuration**
**Given** the ApproverStack is deployed
**When** viewing CloudFormation outputs
**Then** Approve Lambda ARN is displayed
**And** Deny Lambda ARN is displayed

### Story 7.2.4: Implement Idempotency for Action Lambdas

As an **operator**,
I want duplicate button clicks to be handled gracefully,
So that accidentally clicking twice doesn't cause problems.

**Acceptance Criteria:**

**AC1: Idempotency Check Before ISB Call**
**Given** an operator clicks Approve or Deny
**When** the action Lambda receives the request
**Then** it checks idempotency BEFORE calling ISB Leases Lambda
**And** uses leaseId as the idempotency key

**AC2: Duplicate Click Returns Already Processed**
**Given** a lease has already been approved or denied
**When** another operator (or same operator) clicks a button
**Then** the Lambda returns "already processed" status
**And** does NOT call ISB Leases Lambda again

**AC3: Race Condition Handling**
**Given** two operators click buttons simultaneously
**When** both requests arrive at the Lambda
**Then** only one ISB Leases Lambda call is made
**And** the second request receives "already processed" response

**AC4: Test Coverage - Duplicate Clicks**
**Given** the idempotency implementation
**When** running unit tests
**Then** tests verify duplicate clicks return correct response
**And** tests verify ISB Lambda is called exactly once

**AC5: Test Coverage - Race Conditions**
**Given** the idempotency implementation
**When** running integration tests
**Then** concurrent requests are tested
**And** only one ISB Lambda invocation occurs

**AC6: Idempotency State Storage**
**Given** idempotency needs to persist across Lambda invocations
**When** checking for duplicates
**Then** state is checked via ISB Leases Lambda (which returns "already processed" for completed requests)
**And** no separate idempotency store is required - ISB's existing state is the source of truth

---

## Epic 7.3: Operators Get Clear Action Feedback

Thread replies confirm what happened and who did it. After clicking a button, a thread reply confirms the action with operator identity and timestamp. If already handled or error occurred, clear feedback is shown.

### Story 7.3.1: Post Thread Reply for Successful Actions

As an **operator**,
I want to see confirmation in the Slack thread when my action succeeds,
So that I know the request was processed and who handled it.

**Acceptance Criteria:**

**AC1: Approval Confirmation Thread Reply**
**Given** an operator clicks Approve and ISB Leases Lambda succeeds
**When** the Approve Lambda completes processing
**Then** a thread reply is posted to the original notification
**And** the reply shows: ✅ **Approved by {operator}** at {timestamp}

**AC2: Denial Confirmation Thread Reply**
**Given** an operator clicks Deny and ISB Leases Lambda succeeds
**When** the Deny Lambda completes processing
**Then** a thread reply is posted to the original notification
**And** the reply shows: 🚫 **Denied by {operator}** at {timestamp}

**AC3: Thread Correlation**
**Given** the original notification included `threadId` in metadata
**When** posting a thread reply
**Then** the reply is posted to the same thread as the original notification
**And** uses the `threadId` from the original message

**AC4: Operator Identity from Slack**
**Given** the custom action payload includes Slack user information
**When** posting the thread reply
**Then** the operator is identified by their Slack username or email
**And** the identity is logged for audit purposes

**AC5: SNS Publish for Thread Reply**
**Given** thread replies are delivered via SNS → Amazon Q
**When** the action Lambda posts a reply
**Then** it publishes to the same SNS topic
**And** the message format includes the `threadId` for correlation

### Story 7.3.2: Post Thread Reply for Already Processed

As an **operator**,
I want to know when a request was already handled,
So that I don't waste time on something that's resolved.

**Acceptance Criteria:**

**AC1: Already Processed Thread Reply**
**Given** an operator clicks Approve or Deny on an already-processed request
**When** ISB Leases Lambda returns "already processed" (or similar)
**Then** a thread reply is posted
**And** the reply shows: ℹ️ **Already processed** - This request has already been handled

**AC2: Graceful Handling**
**Given** the request was processed via Slack or ISB Console
**When** an operator clicks a button
**Then** the system handles it gracefully without error
**And** the operator sees clear feedback

**AC3: Thread Reply Uses Same Correlation**
**Given** the click is on a notification
**When** posting the "already processed" reply
**Then** it appears in the same thread as the original notification

### Story 7.3.3: Post Thread Reply for Errors

As an **operator**,
I want to know what went wrong with my action,
So that I can understand the issue and try again.

**Acceptance Criteria:**

**AC1: Error Thread Reply with Details**
**Given** an operator clicks Approve or Deny
**When** the action fails (ISB Lambda error, timeout, etc.)
**Then** a thread reply is posted
**And** the reply shows: ❌ **Error** - {error_message}

**AC2: Meaningful Error Messages**
**Given** different failure scenarios
**When** posting the error thread reply
**Then** the message reflects the actual error:
- ISB Lambda 4xx: "Request could not be processed: {reason}"
- ISB Lambda 5xx: "Service temporarily unavailable, please try again"
- Timeout: "Request timed out, please try again"
- Other: "Unexpected error: {exception_message}"

**AC3: Request Remains Pending**
**Given** an error occurs during action processing
**When** the error is handled
**Then** the lease request remains in pending state (fail-closed)
**And** the operator can retry the action

**AC4: Error Logged for Debugging**
**Given** an error occurs
**When** the error thread reply is posted
**Then** full error details are logged to CloudWatch
**And** include correlation ID for tracing

---

## Epic 7.4: Platform Team Monitors and Audits

Complete audit trail and operational alerting. Platform team has CloudWatch alarms for errors and full audit trail in CloudWatch logs.

### Story 7.4.1: Implement Action Logging to CloudWatch

As a **platform team member**,
I want all action attempts logged to CloudWatch,
So that I can audit and troubleshoot approval activities.

**Acceptance Criteria:**

**AC1: Structured JSON Logging**
**Given** an operator clicks Approve or Deny
**When** the action Lambda processes the request
**Then** structured JSON logs are written to CloudWatch
**And** logs include: leaseId, action, operator, timestamp, outcome

**AC2: Log Successful Actions**
**Given** an action completes successfully
**When** the thread reply is posted
**Then** a log entry records: action=approve/deny, outcome=success, operator={id}

**AC3: Log Already Processed**
**Given** a duplicate action is detected
**When** the "already processed" reply is posted
**Then** a log entry records: action=approve/deny, outcome=already_processed

**AC4: Log Errors**
**Given** an action fails
**When** the error reply is posted
**Then** a log entry records: action=approve/deny, outcome=error, error={message}
**And** full stack trace is included at DEBUG level

**AC5: Correlation ID for Tracing**
**Given** any action attempt
**When** logs are written
**Then** a correlation ID links all log entries for that request
**And** the correlation ID matches the one shown to operators on errors

### Story 7.4.2: Configure CloudWatch Alarms

As a **platform team member**,
I want alarms when things go wrong,
So that I can respond to issues quickly.

**Acceptance Criteria:**

**AC1: Action Lambda Error Rate Alarm**
**Given** the Approve or Deny Lambda
**When** error rate exceeds threshold (e.g., >1% over 5 minutes)
**Then** a CloudWatch alarm triggers
**And** notification is sent via existing alerting integration

**AC2: SNS Delivery Failure Alarm**
**Given** the SNS notification topic
**When** delivery failures occur
**Then** a CloudWatch alarm triggers
**And** notification is sent via existing alerting integration

**AC3: Alarm Actions Connected**
**Given** alarms are configured
**When** an alarm triggers
**Then** it notifies the platform team's existing SNS topic or PagerDuty integration

**AC4: Alarm Descriptions Include Context**
**Given** an alarm triggers
**When** the platform team receives the notification
**Then** the alarm description explains what's wrong
**And** suggests initial troubleshooting steps

**AC5: Incident Response Runbook**
**Given** alarms may trigger outside business hours
**When** this story is complete
**Then** a runbook documents how to respond to each alarm type
**And** includes common failure scenarios and resolution steps

---

## Epic 7.5: Team Leads Manage Approvers & Migration

Simplified access control, complete documentation, and clean migration. Team leads add/remove approvers via Slack channel membership. Operators have onboarding canvas, ops team has runbook. Old webhook code removed after validation, fallback mechanism preserved.

### Story 7.5.1: Document Approver Access Management

As a **team lead**,
I want to manage approvers through Slack channel membership,
So that I can control who can approve/deny requests without a separate permission system.

**Acceptance Criteria:**

**AC1: Add Approvers via Channel Invite**
**Given** a team lead wants to add a new approver
**When** they invite the user to the `#isb-approvals` Slack channel
**Then** that user can see notifications and click Approve/Deny buttons
**And** no additional AWS configuration is required

**AC2: Remove Approvers via Channel Removal**
**Given** a team lead wants to remove an approver
**When** they remove the user from the `#isb-approvals` Slack channel
**Then** that user can no longer see notifications or take actions
**And** no additional AWS configuration is required

**AC3: Private Channel Requirement**
**Given** the approvals channel
**When** it is created/configured
**Then** it must be a private, invite-only channel (NFR9)
**And** this is documented in the setup guide

**AC4: Quarterly Access Audit Process**
**Given** approver access should be reviewed periodically
**When** this story is complete
**Then** documentation includes a quarterly audit checklist:
- Review channel membership list
- Verify all members still require access
- Remove departed team members
- Document audit completion date

### Story 7.5.2: Create Operator Onboarding Canvas

As an **operator**,
I want onboarding guidance pinned in the approvals channel,
So that I understand how to evaluate and process requests.

**Acceptance Criteria:**

**AC1: Canvas Created and Pinned**
**Given** the `#isb-approvals` channel is set up
**When** this story is complete
**Then** a Slack canvas is created and pinned to the channel
**And** new channel members can easily find it

**AC2: Canvas Content - Score Thresholds**
**Given** the canvas content
**When** an operator reads it
**Then** it explains the score threshold (e.g., >20 requires review)
**And** describes what automatic approval means for low-risk requests

**AC3: Canvas Content - Factor Meanings**
**Given** the canvas content
**When** an operator reads it
**Then** it explains each scoring factor:
- What factors contribute to the score
- Why certain factors indicate higher risk
- How to interpret the score breakdown

**AC4: Canvas Content - Decision Criteria**
**Given** the canvas content
**When** an operator reads it
**Then** it provides guidance on when to approve vs deny:
- Common reasons to approve
- Red flags that warrant denial
- When to escalate or seek advice

**AC5: Canvas Content - Contacting Requesters**
**Given** the canvas content
**When** an operator needs more information
**Then** the canvas explains how to contact requesters (email from notification)
**And** suggests what questions to ask

**AC6: Canvas Content - Check Thread First**
**Given** the canvas content
**When** an operator sees a notification
**Then** the canvas reminds: "Check the thread first - another operator may have already handled it"

**AC7: Markdown Format for Version Control**
**Given** the canvas content
**When** this story is complete
**Then** a markdown version is stored in the repo (`docs/operator-onboarding-canvas.md`)
**And** can be updated and version controlled

### Story 7.5.3: Create Custom Action Configuration Runbook

As an **operations team member**,
I want a runbook documenting custom action configuration,
So that I can set up or troubleshoot the Slack integration.

**Acceptance Criteria:**

**AC1: Runbook Created**
**Given** custom actions must be configured manually in Slack
**When** this story is complete
**Then** a runbook exists at `docs/runbooks/custom-action-configuration.md`

**AC2: Prerequisites Section**
**Given** the runbook
**When** an operator reads it
**Then** it lists prerequisites:
- Slack workspace admin access
- AWS account access
- Lambda ARNs from CloudFormation outputs
- Chatbot configuration ARN

**AC3: Step-by-Step Configuration**
**Given** the runbook
**When** an operator follows it
**Then** it provides step-by-step instructions for:
- Accessing Slack custom action configuration
- Creating the Approve action with correct Lambda ARN
- Creating the Deny action with correct Lambda ARN
- Testing each action

**AC4: Screenshots Included**
**Given** the runbook
**When** an operator follows it
**Then** screenshots show key configuration screens
**And** highlight important fields to configure

**AC5: Troubleshooting Section**
**Given** the runbook
**When** actions don't work as expected
**Then** it includes troubleshooting steps:
- How to verify Lambda permissions
- How to check CloudWatch logs
- Common error messages and fixes

**AC6: Verification Checklist**
**Given** the runbook
**When** configuration is complete
**Then** it includes a verification checklist:
- [ ] Test Approve action works
- [ ] Test Deny action works
- [ ] Verify thread replies appear
- [ ] Check CloudWatch logs show activity

### Story 7.5.4: Remove Legacy Webhook Code and POC

As a **platform team member**,
I want legacy webhook code and POC artifacts removed,
So that the codebase is clean and there's no deployment confusion.

**Acceptance Criteria:**

**AC1: Manual Validation Before Removal**
**Given** the Amazon Q integration is deployed and configured
**When** preparing to remove legacy code
**Then** manually verify:
- At least 3 successful approve actions via Slack
- At least 3 successful deny actions via Slack
- Thread replies working correctly
- No errors in CloudWatch logs

**AC2: Remove POC Stack Code**
**Given** validation is complete
**When** this story is complete
**Then** the following are removed from the codebase:
- `AmazonQSlackPocStack` import from `cdk/bin/approver.ts`
- `AmazonQSlackPocStack` instantiation from `cdk/bin/approver.ts`
- `SlackConfig` interface from `cdk/config/environments.ts`
- `SLACK_CONFIG` constant from `cdk/config/environments.ts`
- `cdk/lib/amazon-q-slack-poc-stack.ts` file deleted

**AC3: POC Stack Deleted from AWS Account**
**Given** POC code is removed from the codebase
**When** this story is complete
**Then** the POC CloudFormation stack is deleted from the AWS account
**And** deletion is verified via AWS Console or CLI
**And** no orphaned resources remain (SNS topics, Lambdas, IAM roles)

**AC4: Remove Legacy Webhook Code**
**Given** Amazon Q integration is validated
**When** this story is complete
**Then** the following are removed:
- `slack-callback` Lambda handler code
- API Gateway endpoint for Slack callbacks (if exists)
- Slack webhook URL secret reference
- Slack signing secret reference
- Direct webhook call code from Approver Lambda

**AC5: Update Approver Lambda**
**Given** webhook code is removed
**When** this story is complete
**Then** Approver Lambda publishes to SNS only
**And** no webhook fallback code remains

**AC6: Commit Message Documents Removal**
**Given** code is removed
**When** committing changes
**Then** commit message documents what was removed and why
**And** references this story number

### Story 7.5.5: Verify Fallback Mechanism Preserved

As a **platform team member**,
I want the 30-minute scheduled queue check to remain operational,
So that pending requests are still processed if Slack actions fail.

**Acceptance Criteria:**

**AC1: Scheduled Queue Check Unchanged**
**Given** the existing 30-minute scheduled Lambda
**When** Epic 7 is complete
**Then** the scheduled queue check continues to run unchanged
**And** processes any pending requests not yet approved/denied

**AC2: Fallback Covers Slack Failures**
**Given** a Slack action fails or is never clicked
**When** 30 minutes pass
**Then** the scheduled check processes the request
**And** operators are notified via existing mechanisms

**AC3: No Duplicate Processing**
**Given** a request is approved via Slack
**When** the scheduled check runs
**Then** it recognizes the request is already processed
**And** does not attempt duplicate approval

**AC4: Documentation Updated**
**Given** the fallback mechanism exists
**When** this story is complete
**Then** architecture documentation notes the fallback
**And** operator onboarding canvas mentions: "Requests are also checked every 30 minutes as a safety net"

**AC5: Verification Test**
**Given** Epic 7 is deployed
**When** validating the system
**Then** manually verify scheduled check still runs
**And** confirm it can process a pending request

---

## Validation Summary

### FR Coverage

| Status | Count | Details |
|--------|-------|---------|
| ✅ Covered | 24 | FR1-FR15, FR17-FR25 |
| ❌ Dropped | 1 | FR16 (DynamoDB storage - CloudWatch sufficient) |
| **Total** | 25 | 24 implemented, 1 dropped |

### NFR Coverage

| NFR | Status | Addressed In |
|-----|--------|--------------|
| NFR1 | ✅ | 7.1 (SNS reliability) |
| NFR2 | ✅ | 7.2, 7.3 (fail-closed) |
| NFR3 | ✅ | 7.2 (idempotency) |
| NFR4 | ✅ | 7.3 (thread replies) |
| NFR5 | ✅ | 7.5 (fallback mechanism) |
| NFR6 | ✅ | 7.5 (channel membership auth) |
| NFR7 | ✅ | 7.2 (UUIDs) |
| NFR8 | ✅ | 7.4 (CloudWatch audit) |
| NFR9 | ✅ | 7.5 (private channel) |
| NFR10 | ✅ | 7.2 (error handling) |
| NFR11 | ✅ | 7.2 (<5s latency) |
| NFR12 | ✅ | 7.1 (notification format) |

### Story Summary

| Epic | Name | Stories |
|------|------|---------|
| 7.1 | Operators Receive Rich Notifications in Slack | 3 |
| 7.2 | Operators Can Approve or Deny with One Click | 4 |
| 7.3 | Operators Get Clear Action Feedback | 3 |
| 7.4 | Platform Team Monitors and Audits | 2 |
| 7.5 | Team Leads Manage Approvers & Migration | 5 |
| **Total** | | **17** |

### Enhancements Applied

**From Stakeholder Round Table:**
1. ✅ FR2 includes requester comment prominently
2. ✅ FR13 includes explicit idempotency test requirements
3. ✅ FR22 canvas content specified (thresholds, factors, criteria, contact, thread check)
4. ✅ Quarterly access audit process documented
5. ✅ Incident response runbook in 7.4.2

**From Pre-mortem Analysis:**
1. ✅ POC stack verified deleted from AWS account (Story 7.5.4 AC3)

### Document Status

- **Created:** 2026-01-20
- **Steps Completed:** 1, 2, 3, 4
- **Validation:** PASS
- **Ready for:** Sprint planning