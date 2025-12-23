# Innovation Sandbox on AWS (ISB) - Integration Reference

This document provides the essential integration points for building services that interact with the Innovation Sandbox on AWS solution. It is the primary reference for the Approver service.

**Last Updated:** 2025-12-23 (Post Epic 2 Retrospective - verified against ISB codebase)

## Overview

ISB is an AWS Solution (SO0284) that manages temporary sandbox AWS accounts with:
- Lease lifecycle management (request → approval → active → expiration)
- Budget and duration monitoring
- Account cleanup and recycling
- Identity Center (IDC) integration for SSO

**Repository:** `../innovation-sandbox-on-aws`
**Version:** 1.1.4

## CRITICAL: Lease Approval Integration

> **WARNING:** ISB does NOT process `LeaseApproved` events from EventBridge. Approval must be done via **direct Lambda invocation**.

### Correct Approval Pattern (Direct Lambda Invocation)

ISB's LeasesLambdaFunction exposes an API Gateway-style interface. To approve a lease:

```typescript
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

// 1. Encode the lease ID as base64 composite key
const encodeLeaseId = (userEmail: string, uuid: string): string => {
  const json = JSON.stringify({ userEmail, uuid });
  return Buffer.from(json).toString('base64');
};

// 2. Create JWT with approver identity (decoded but not verified by ISB)
const createApproverJwt = (approverEmail: string): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const payload = Buffer.from(JSON.stringify({
    user: { email: approverEmail, roles: ['Admin'] }
  })).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${header}.${payload}.directinvoke`;
};

// 3. Invoke Lambda with API Gateway event structure
const approveLease = async (userEmail: string, uuid: string, approverEmail: string) => {
  const leaseIdB64 = encodeLeaseId(userEmail, uuid);
  const jwt = createApproverJwt(approverEmail);

  const payload = {
    httpMethod: 'POST',
    path: `/leases/${leaseIdB64}/review`,
    pathParameters: { leaseId: leaseIdB64 },
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'Approve' }), // or 'Deny'
  };

  const command = new InvokeCommand({
    FunctionName: 'ISB-LeasesLambdaFunction-xxx', // Get from environment
    Payload: Buffer.from(JSON.stringify(payload)),
  });

  const response = await lambdaClient.send(command);
  // Parse response.Payload for result
};
```

### What Happens After Approval

When ISB processes the approval:
1. Assigns an available sandbox account from the pool
2. Updates lease status to `Active` in DynamoDB
3. Grants IDC user access to the sandbox account
4. **Emits `LeaseApproved` event to EventBridge** (for notifications, not for triggering approval)

## EventBridge Integration

### Event Bus

ISB publishes events to the **default EventBridge bus**. The event source is `innovation-sandbox`.

### Events We Listen To

| Event | Trigger | Purpose |
|-------|---------|---------|
| `LeaseRequested` | User submits lease request | **PRIMARY** - Triggers our approval workflow |

### Events ISB Emits (for reference)

| Event | When Emitted |
|-------|--------------|
| `LeaseApproved` | After ISB processes approval (via API) |
| `LeaseDenied` | After ISB processes denial (via API) |
| `LeaseBudgetExceeded` | Lease terminated due to budget |
| `LeaseExpired` | Lease expired naturally |
| `LeaseTerminated` | Lease manually terminated |
| `LeaseFrozen` | Lease frozen |
| `LeaseUnfrozen` | Lease unfrozen |
| `LeaseBudgetThresholdAlert` | Budget threshold breached |
| `LeaseDurationThresholdAlert` | Duration threshold breached |
| `AccountCleanupSucceeded` | Account cleanup completed |
| `AccountCleanupFailed` | Account cleanup failed |

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
    "templateId": "template-uuid",
    "budgetAmount": 100,
    "leaseDurationHours": 24,
    "comments": "Optional user comments",
    "requiresManualApproval": true
  }
}
```

## DynamoDB Tables

### Lease Table

**Table:** `InnovationSandbox-Data-LeaseTable*` (exact name from CloudFormation outputs)

**Key Schema:**
- Partition Key: `userEmail` (String)
- Sort Key: `uuid` (String)

**Global Secondary Index:** `StatusIndex`
- Partition Key: `status`
- Sort Key: `originalLeaseTemplateUuid`

**Important:** The lease ID in events is just the `uuid`, but lookups require BOTH `userEmail` AND `uuid`.

### Lease Status Values

```typescript
type LeaseStatus =
  | "PendingApproval"      // Awaiting approval
  | "ApprovalDenied"       // Request denied
  | "Active"               // Currently active
  | "Frozen"               // Temporarily frozen
  | "Expired"              // Naturally expired (duration exceeded)
  | "BudgetExceeded"       // Terminated due to budget
  | "ManuallyTerminated"   // User or admin terminated early
  | "AccountQuarantined"   // Account quarantined
  | "Ejected";             // Account ejected
```

### Lease Schema

```typescript
// Source: source/common/data/lease/lease.ts

// Pending Lease (what we receive in LeaseRequested)
interface PendingLease {
  userEmail: string;                    // Partition key
  uuid: string;                         // Sort key (this is the leaseId)
  status: "PendingApproval";
  originalLeaseTemplateUuid: string;
  originalLeaseTemplateName: string;
  comments?: string;
  createdBy?: string;
  maxSpend: number;                     // Budget in USD
  leaseDurationInHours: number;
  budgetThresholds: number[];
  durationThresholds: number[];
  costReportGroup?: string;
  schemaVersion: number;
  created: string;                      // ISO datetime
  lastEdit: string;                     // ISO datetime
}

// Active/Monitored Lease (after approval)
interface MonitoredLease extends PendingLease {
  status: "Active" | "Frozen";
  awsAccountId: string;                 // 12-digit AWS account ID
  approvedBy: string | "AUTO_APPROVED";
  startDate: string;                    // ISO datetime
  expirationDate?: string;              // ISO datetime
  lastCheckedDate: string;              // ISO datetime
  totalCostAccrued: number;
}

// Terminal Lease (expired/terminated)
interface ExpiredLease extends MonitoredLease {
  status: "Expired" | "BudgetExceeded" | "ManuallyTerminated" | "AccountQuarantined" | "Ejected";
  endDate: string;                      // ISO datetime
  ttl: number;                          // Unix timestamp for DynamoDB TTL
}
```

### Querying Lease History for Scoring

```typescript
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

// Query all leases for a user
const command = new QueryCommand({
  TableName: leaseTableName,
  KeyConditionExpression: 'userEmail = :email',
  ExpressionAttributeValues: {
    ':email': userEmail
  }
});

// Filter for recent leases (last 30 days) in application code
const thirtyDaysAgo = new Date();
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

const recentLeases = items.filter(lease => {
  const created = new Date(lease.created);
  return created >= thirtyDaysAgo;
});

// Score based on terminal status
const expiredByTime = recentLeases.filter(l => l.status === 'Expired');
const expiredByBudget = recentLeases.filter(l => l.status === 'BudgetExceeded');
const manuallyTerminated = recentLeases.filter(l => l.status === 'ManuallyTerminated');
```

### Sandbox Account Table

**Table:** `InnovationSandbox-Data-SandboxAccountTable*`

**Key Schema:**
- Partition Key: `awsAccountId` (String)

**Account Status Values:**
- `Available` - Ready for allocation
- `Active` - Currently assigned to a lease
- `Frozen` - Lease frozen
- `CleanUp` - Being cleaned up
- `Quarantine` - Quarantined due to issues

## Greenfield Integrations (Not in ISB)

The following integrations do NOT exist in ISB and must be built fresh:

### S3 Domain Verification

ISB has no domain verification mechanism. For scoring rule 5 (`verified_gov_domain`), we need to:
- Create S3 bucket for domain allowlist
- Populate with UKPS/gov.uk domains
- Query during scoring

### Bedrock AI Analysis

ISB has no AI integration. For scoring rules 4, 12, 16 (group mailbox detection, target audience), we need to:
- Integrate Bedrock Runtime
- Implement email pattern analysis
- Add circuit breaker for AI failures

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `ISB_LEASES_LAMBDA_NAME` | ISB LeasesLambdaFunction name for direct invocation |
| `LEASE_TABLE_NAME` | DynamoDB lease table name (for history queries) |
| `SANDBOX_ACCOUNT_TABLE_NAME` | DynamoDB sandbox account table name |
| `EVENT_BUS_NAME` | EventBridge bus (usually "default") |
| `AWS_REGION` | AWS region |

## Leases API Endpoints (Reference)

ISB's LeasesLambdaFunction exposes these endpoints:

| Path | Method | Purpose |
|------|--------|---------|
| `/leases` | GET | List leases (with optional userEmail filter) |
| `/leases` | POST | Request new lease |
| `/leases/{leaseId}` | GET | Get single lease |
| `/leases/{leaseId}` | PATCH | Update lease fields |
| `/leases/{leaseId}/review` | POST | **Approve/Deny lease** |
| `/leases/{leaseId}/freeze` | POST | Freeze active lease |
| `/leases/{leaseId}/unfreeze` | POST | Unfreeze frozen lease |
| `/leases/{leaseId}/terminate` | POST | Terminate lease |

**Note:** `{leaseId}` is base64-encoded composite key: `{ userEmail, uuid }`

## Critical Integration Notes

1. **Lease ID Format:** The `leaseId` in events is just the UUID. To lookup or approve a lease, encode both `userEmail` AND `uuid` as base64 JSON.

2. **Direct Lambda Invocation:** Use Lambda invoke, not EventBridge, for approvals. ISB's API Gateway auth is bypassed when invoking Lambda directly.

3. **JWT for Identity:** Create a simple JWT with approver email and Admin role. ISB decodes but doesn't verify the signature for direct Lambda calls.

4. **Event Source:** ISB uses `innovation-sandbox` as the source. Our `LeaseEscalated` events use the same source for consistency.

5. **Auto-Approval Value:** Use `"AUTO_APPROVED"` or an email address for the `approvedBy` field.

---

*Generated: 2025-12-23*
*Source: Innovation Sandbox on AWS v1.1.4*
*Verified: Against actual ISB codebase via Explore agent analysis*
