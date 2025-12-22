# Innovation Sandbox on AWS (ISB) - Integration Reference

This document provides the essential integration points for building services that interact with the Innovation Sandbox on AWS solution. It is the primary reference for the Approver service.

## Overview

ISB is an AWS Solution (SO0284) that manages temporary sandbox AWS accounts with:
- Lease lifecycle management (request → approval → active → expiration)
- Budget and duration monitoring
- Account cleanup and recycling
- Identity Center (IDC) integration for SSO

**Repository:** `../innovation-sandbox-on-aws`
**Version:** 1.1.4

## EventBridge Integration

### Event Bus

ISB publishes events to the **default EventBridge bus**. The event source is `innovation-sandbox`.

### Event Types (DetailType)

| Event | Trigger | Key for Approver |
|-------|---------|------------------|
| `LeaseRequested` | User submits lease request | **PRIMARY** - Listen for this |
| `LeaseApproved` | Lease is approved | Emit this when auto-approving |
| `LeaseDenied` | Lease is denied | Emit this when denying |
| `LeaseBudgetThresholdAlert` | Budget threshold breached | For scoring (past behavior) |
| `LeaseDurationThresholdAlert` | Duration threshold breached | For scoring (past behavior) |
| `LeaseFreezingThresholdAlert` | Freeze threshold breached | For scoring (past behavior) |
| `LeaseBudgetExceeded` | Budget exceeded | For scoring (past behavior) |
| `LeaseExpired` | Lease expired naturally | For scoring (past behavior) |
| `LeaseTerminated` | Lease manually terminated | For scoring |
| `LeaseFrozen` | Lease frozen | Informational |
| `LeaseUnfrozen` | Lease unfrozen | Informational |

### LeaseRequested Event Schema

```typescript
// Source: source/common/events/lease-requested-event.ts
{
  "version": "0",
  "id": "event-uuid",
  "detail-type": "LeaseRequested",
  "source": "innovation-sandbox",
  "account": "hub-account-id",
  "time": "2025-12-22T10:00:00Z",
  "region": "us-west-2",
  "detail": {
    "leaseId": {
      "userEmail": "user@example.gov.uk",
      "uuid": "f2d3eb78-907a-4c20-8127-7ce45758836d"
    },
    "comments": "Optional user comments",
    "userEmail": "user@example.gov.uk",
    "requiresManualApproval": true  // ISB's own flag - we override this
  }
}
```

### LeaseApproved Event Schema (to emit)

```typescript
// Source: source/common/events/lease-approved-event.ts
{
  "source": "innovation-sandbox",  // Use same source as ISB
  "detail-type": "LeaseApproved",
  "detail": {
    "leaseId": "f2d3eb78-907a-4c20-8127-7ce45758836d",
    "approvedBy": "AUTO_APPROVED",  // or admin email
    "userEmail": "user@example.gov.uk"
  }
}
```

### LeaseDenied Event Schema (to emit)

```typescript
// Source: source/common/events/lease-denied-event.ts
{
  "source": "innovation-sandbox",
  "detail-type": "LeaseDenied",
  "detail": {
    "leaseId": "f2d3eb78-907a-4c20-8127-7ce45758836d",
    "deniedBy": "approver-system@internal",
    "userEmail": "user@example.gov.uk"
  }
}
```

## DynamoDB Tables

### Lease Table

**Table:** `InnovationSandbox-Data-LeaseTable*` (exact name from CloudFormation outputs)

**Key Schema:**
- Partition Key: `userEmail` (String)
- Sort Key: `uuid` (String)

**Important:** The lease ID in events is just the `uuid`, but lookups require BOTH `userEmail` AND `uuid`.

### Lease Schema (Zod)

```typescript
// Source: source/common/data/lease/lease.ts

// Status values
type LeaseStatus =
  | "PendingApproval"      // Awaiting approval
  | "ApprovalDenied"       // Request denied
  | "Active"               // Currently active
  | "Frozen"               // Temporarily frozen
  | "Expired"              // Naturally expired
  | "BudgetExceeded"       // Terminated due to budget
  | "ManuallyTerminated"   // User or admin terminated
  | "AccountQuarantined"   // Account quarantined
  | "Ejected";             // Account ejected

// Pending Lease (what we receive in LeaseRequested)
interface PendingLease {
  userEmail: string;           // Partition key
  uuid: string;                // Sort key (this is the leaseId)
  status: "PendingApproval";
  originalLeaseTemplateUuid: string;
  originalLeaseTemplateName: string;
  comments?: string;
  createdBy?: string;
  maxSpend: number;            // Budget in GBP
  leaseDurationInHours: number;
  budgetThresholds: number[];
  durationThresholds: number[];
  costReportGroup?: string;
  // Metadata
  schemaVersion: number;
  created: string;             // ISO datetime
  lastEdit: string;            // ISO datetime
}

// Active/Monitored Lease (after approval)
interface MonitoredLease extends PendingLease {
  status: "Active" | "Frozen";
  awsAccountId: string;        // 12-digit AWS account ID
  approvedBy: string | "AUTO_APPROVED";
  startDate: string;           // ISO datetime
  expirationDate?: string;     // ISO datetime
  lastCheckedDate: string;     // ISO datetime
  totalCostAccrued: number;
}

// Expired Lease (terminal states)
interface ExpiredLease extends MonitoredLease {
  status: "Expired" | "BudgetExceeded" | "ManuallyTerminated" | "AccountQuarantined" | "Ejected";
  endDate: string;             // ISO datetime
  ttl: number;                 // Unix timestamp for DynamoDB TTL
}
```

### Querying Historical Leases for Scoring

To calculate a user's score based on past behavior, query by `userEmail`:

```typescript
// Query by userEmail to get all leases for a user
const command = new QueryCommand({
  TableName: leaseTableName,
  KeyConditionExpression: 'userEmail = :email',
  ExpressionAttributeValues: {
    ':email': { S: userEmail }
  }
});

// Filter for recent leases (last 30 days) in application code
const thirtyDaysAgo = new Date();
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

const recentLeases = items.filter(lease => {
  const created = new Date(lease.created);
  return created >= thirtyDaysAgo;
});

// Score based on status
const expiredByTime = recentLeases.filter(l => l.status === 'Expired');
const expiredByBudget = recentLeases.filter(l => l.status === 'BudgetExceeded');
```

### Sandbox Account Table

**Table:** `InnovationSandbox-Data-SandboxAccountTable*`

**Key Schema:**
- Partition Key: `awsAccountId` (String)

**Relevant Fields:**
- `awsAccountId`: 12-digit AWS account ID
- `status`: "Available" | "InUse" | "Quarantined" | "Cleaning" | "PendingCleanup"
- `currentLeaseId`: UUID of current lease (if InUse)

### Checking Account Availability

```typescript
// Query for available accounts
const command = new QueryCommand({
  TableName: sandboxAccountTableName,
  IndexName: 'status-index',  // GSI on status
  KeyConditionExpression: 'status = :status',
  ExpressionAttributeValues: {
    ':status': { S: 'Available' }
  }
});

// If no available accounts, delay processing
if (availableAccounts.length === 0) {
  // Delay lease processing until accounts available
}
```

## Updating Lease Comments

To update the comments field on a lease (for user notifications):

```typescript
const command = new UpdateItemCommand({
  TableName: leaseTableName,
  Key: {
    userEmail: { S: userEmail },
    uuid: { S: leaseUuid }
  },
  UpdateExpression: 'SET comments = :comments, lastEdit = :lastEdit',
  ExpressionAttributeValues: {
    ':comments': { S: newComments },
    ':lastEdit': { S: new Date().toISOString() }
  }
});
```

## AWS SDK Clients Used by ISB

```typescript
// Source: source/common/sdk-clients/

// EventBridge
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

// DynamoDB
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

// SSM (for configuration)
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

// Secrets Manager
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
```

## Environment Variables to Expect

Based on ISB's Lambda configuration patterns:

| Variable | Purpose |
|----------|---------|
| `LEASE_TABLE_NAME` | DynamoDB lease table name |
| `SANDBOX_ACCOUNT_TABLE_NAME` | DynamoDB sandbox account table name |
| `EVENT_BUS_NAME` | EventBridge bus (usually "default") |
| `AWS_REGION` | AWS region |
| `LOG_LEVEL` | Logging verbosity |

## Zod Validation

ISB uses Zod for runtime schema validation. Key imports:

```typescript
import { z } from 'zod';

// Reusable schemas from ISB commons
const LeaseKeySchema = z.object({
  userEmail: z.string().email(),
  uuid: z.string().uuid(),
});

const ApprovedBySchema = z.union([
  z.string().email(),
  z.literal("AUTO_APPROVED"),
]);
```

## Critical Integration Notes

1. **Lease ID vs Lease Key**: The `leaseId` in events is just the UUID. To lookup a lease, you need BOTH `userEmail` AND `uuid`.

2. **Event Source**: Use `innovation-sandbox` as the source for emitted events to ensure ISB processes them.

3. **Approval Flow**: When emitting `LeaseApproved`, ISB will:
   - Assign an available sandbox account
   - Update the lease to `Active` status
   - Send notifications to the user

4. **Comments Field**: This is the user-visible field. Update it with polite messages about delays or manual approval requirements.

5. **Auto-Approval**: Use `"AUTO_APPROVED"` as the `approvedBy` value for automated approvals.

---

*Generated: 2025-12-22*
*Source: Innovation Sandbox on AWS v1.1.4*
