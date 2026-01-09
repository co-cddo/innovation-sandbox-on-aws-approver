/**
 * Core type definitions for the Innovation Sandbox Approver
 * Event schemas match ISB EventBridge contracts
 */

import { z } from 'zod';

// =============================================================================
// ISB Event Schemas (Input from EventBridge)
// =============================================================================

/**
 * LeaseId composite key from ISB
 */
export const LeaseIdSchema = z.object({
  userEmail: z.string().email(),
  uuid: z.string().uuid(),
});

export type LeaseId = z.infer<typeof LeaseIdSchema>;

/**
 * LeaseRequested event detail from ISB
 * Flexible schema to handle ISB's actual event format
 */
export const LeaseRequestedDetailSchema = z
  .object({
    // ISB sends leaseId as composite object with userEmail and uuid
    leaseId: LeaseIdSchema,
    // ISB uses leaseTemplateId or originalLeaseTemplateUuid, we also accept templateId
    leaseTemplateId: z.string().optional(),
    originalLeaseTemplateUuid: z.string().optional(),
    templateId: z.string().optional(),
    // Budget: ISB uses maxSpend
    budgetAmount: z.number().optional(),
    maxSpend: z.number().optional(),
    // Duration: ISB uses leaseDurationInHours (note the "In")
    leaseDurationHours: z.number().optional(),
    leaseDurationInHours: z.number().optional(),
    expiresInHours: z.number().optional(),
    comments: z.string().optional(),
    // NOTE: ISB always sets requiresManualApproval=true because this approver IS
    // the "manual approver" from ISB's perspective. This field is intentionally
    // IGNORED by the state machine - scoring determines approval decisions.
    requiresManualApproval: z.boolean().optional().default(false),
  })
  .transform((data) => ({
    ...data,
    // Normalize template: prefer leaseTemplateId > originalLeaseTemplateUuid > templateId
    templateId:
      data.leaseTemplateId ?? data.originalLeaseTemplateUuid ?? data.templateId ?? 'unknown',
    // Normalize budget: prefer maxSpend over budgetAmount (default 0 - no penalty if missing)
    budgetAmount: data.maxSpend ?? data.budgetAmount ?? 0,
    // Normalize duration: prefer leaseDurationInHours > expiresInHours > leaseDurationHours (default 0 - no penalty if missing)
    leaseDurationHours:
      data.leaseDurationInHours ?? data.expiresInHours ?? data.leaseDurationHours ?? 0,
  }));

export type LeaseRequestedDetail = z.infer<typeof LeaseRequestedDetailSchema>;

/**
 * Full EventBridge event for LeaseRequested
 * Flexible source matching for different ISB environments
 */
export const LeaseRequestedEventSchema = z.object({
  version: z.string(),
  id: z.string(),
  'detail-type': z.literal('LeaseRequested'),
  // Accept any source starting with InnovationSandbox or innovation-sandbox
  source: z
    .string()
    .refine(
      (s) =>
        s.toLowerCase().startsWith('innovationsandbox') ||
        s.toLowerCase().startsWith('innovation-sandbox'),
      { message: 'Source must start with InnovationSandbox or innovation-sandbox' }
    ),
  account: z.string(),
  time: z.string(),
  region: z.string(),
  resources: z.array(z.string()),
  detail: LeaseRequestedDetailSchema,
});

export type LeaseRequestedEvent = z.infer<typeof LeaseRequestedEventSchema>;

// =============================================================================
// Approver Event Schemas (Output to EventBridge)
// =============================================================================

/**
 * LeaseApproved event detail for emission
 * Uses composite leaseId to match ISB's expected format
 */
export const LeaseApprovedDetailSchema = z.object({
  // Composite leaseId matching ISB format for lease lookup
  leaseId: LeaseIdSchema,
  approvedBy: z.string(),
  score: z.number(),
  reason: z.string(),
  timestamp: z.string(),
});

export type LeaseApprovedDetail = z.infer<typeof LeaseApprovedDetailSchema>;

/**
 * LeaseEscalated event detail for emission (fail-closed error handling)
 * Uses composite leaseId to match ISB's expected format
 */
export const LeaseEscalatedDetailSchema = z.object({
  // Composite leaseId matching ISB format for lease lookup
  leaseId: LeaseIdSchema,
  reason: z.string(),
  errorCode: z.string(),
  score: z.number().optional(),
  timestamp: z.string(),
});

export type LeaseEscalatedDetail = z.infer<typeof LeaseEscalatedDetailSchema>;

/**
 * LeaseDenied event detail for emission (queue timeout, etc.)
 * Uses composite leaseId to match ISB's expected format
 */
export const LeaseDeniedDetailSchema = z.object({
  // Composite leaseId matching ISB format for lease lookup
  leaseId: LeaseIdSchema,
  reason: z.string(),
  deniedBy: z.string(),
  timestamp: z.string(),
});

export type LeaseDeniedDetail = z.infer<typeof LeaseDeniedDetailSchema>;

// =============================================================================
// Account Availability Schemas (Epic 6 - FR58-FR67)
// =============================================================================

/**
 * Account status from ISB /api/accounts endpoint
 */
export const AccountStatusSchema = z.enum(['Available', 'Active']);

export type AccountStatus = z.infer<typeof AccountStatusSchema>;

/**
 * Account metadata from ISB
 */
export const AccountMetaSchema = z.object({
  createdTime: z.string(), // ISO 8601
  lastEditTime: z.string(), // ISO 8601
});

export type AccountMeta = z.infer<typeof AccountMetaSchema>;

/**
 * Single account from ISB /api/accounts endpoint
 */
export const AccountSchema = z.object({
  awsAccountId: z.string(),
  name: z.string(), // e.g., "pool-005"
  status: AccountStatusSchema,
  meta: AccountMetaSchema,
});

export type Account = z.infer<typeof AccountSchema>;

/**
 * Response from ISB /accounts endpoint (JSend format, single page)
 * Example: {"status":"success","data":{"result":[...],"nextPageIdentifier":null}}
 */
export const AccountsPageResponseSchema = z.object({
  status: z.literal('success'),
  data: z.object({
    result: z.array(AccountSchema),
    nextPageIdentifier: z.string().nullable(),
  }),
});

export type AccountsPageResponse = z.infer<typeof AccountsPageResponseSchema>;

/**
 * Result from getAccounts() with pagination info
 */
export interface GetAccountsResult {
  readonly success: boolean;
  readonly accounts: Account[];
  readonly totalFetched: number;
  readonly pagesTraversed: number;
  readonly error?: string;
}

// =============================================================================
// Queue Position Schemas (Story 6.3 - FR62, FR67)
// =============================================================================

/**
 * Queue position record stored in DynamoDB for FIFO processing.
 * Users waiting for sandbox accounts are tracked here.
 */
export interface QueuePositionRecord {
  /** Partition key: composite leaseId as string "userEmail#uuid" */
  readonly leaseId: string;
  /** Position in queue (1-based, lower = earlier) */
  readonly position: number;
  /** ISO 8601 timestamp when queued */
  readonly queuedAt: string;
  /** User email for logging/debugging */
  readonly userEmail: string;
  /** ISO 8601 estimated fulfillment time (null if capacity crunch) */
  readonly estimatedFulfillmentTime: string | null;
  /** Status for GSI query - always "PENDING" until processed */
  readonly positionStatus: 'PENDING';
  /** TTL for automatic cleanup (epoch seconds) - 7 days after queued */
  readonly ttl: number;
}

/**
 * Input for adding a request to the queue
 */
export interface QueuePositionInput {
  readonly leaseId: LeaseId;
  readonly estimatedFulfillmentTime: Date | null;
}

/**
 * Result from queue position operations
 */
export interface QueuePositionResult {
  readonly success: boolean;
  readonly position?: number;
  readonly queueDepth?: number;
  readonly error?: string;
}
