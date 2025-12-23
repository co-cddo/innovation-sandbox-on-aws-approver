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
export const LeaseRequestedDetailSchema = z.object({
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
  requiresManualApproval: z.boolean().optional().default(false),
}).transform((data) => ({
  ...data,
  // Normalize template: prefer leaseTemplateId > originalLeaseTemplateUuid > templateId
  templateId: data.leaseTemplateId ?? data.originalLeaseTemplateUuid ?? data.templateId ?? 'unknown',
  // Normalize budget: prefer maxSpend over budgetAmount (default 100)
  budgetAmount: data.maxSpend ?? data.budgetAmount ?? 100,
  // Normalize duration: prefer leaseDurationInHours > expiresInHours > leaseDurationHours (default 24)
  leaseDurationHours: data.leaseDurationInHours ?? data.expiresInHours ?? data.leaseDurationHours ?? 24,
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
  source: z.string().refine(
    (s) => s.toLowerCase().startsWith('innovationsandbox') || s.toLowerCase().startsWith('innovation-sandbox'),
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

// Note: Additional internal types (LeaseRequest, ApprovalDecision) will be added
// when implementing the full scoring engine in Story 2.3
