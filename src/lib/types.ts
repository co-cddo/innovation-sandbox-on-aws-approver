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
 */
export const LeaseRequestedDetailSchema = z.object({
  leaseId: LeaseIdSchema,
  templateId: z.string(),
  budgetAmount: z.number(),
  leaseDurationHours: z.number(),
  comments: z.string().optional(),
  requiresManualApproval: z.boolean(),
});

export type LeaseRequestedDetail = z.infer<typeof LeaseRequestedDetailSchema>;

/**
 * Full EventBridge event for LeaseRequested
 */
export const LeaseRequestedEventSchema = z.object({
  version: z.string(),
  id: z.string(),
  'detail-type': z.literal('LeaseRequested'),
  source: z.literal('innovation-sandbox'),
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
 */
export const LeaseApprovedDetailSchema = z.object({
  leaseId: z.string().uuid(),
  userEmail: z.string().email(),
  approvedBy: z.string(),
  score: z.number(),
  reason: z.string(),
  timestamp: z.string(),
});

export type LeaseApprovedDetail = z.infer<typeof LeaseApprovedDetailSchema>;

/**
 * EventBridge PutEvents entry for LeaseApproved
 */
export interface LeaseApprovedEventEntry {
  Source: 'innovation-sandbox';
  DetailType: 'LeaseApproved';
  Detail: string; // JSON stringified LeaseApprovedDetail
  EventBusName: string;
}

/**
 * LeaseEscalated event detail for emission (fail-closed error handling)
 */
export const LeaseEscalatedDetailSchema = z.object({
  leaseId: z.string().uuid(),
  userEmail: z.string().email(),
  reason: z.string(),
  errorCode: z.string(),
  score: z.number().optional(),
  timestamp: z.string(),
});

export type LeaseEscalatedDetail = z.infer<typeof LeaseEscalatedDetailSchema>;

/**
 * EventBridge PutEvents entry for LeaseEscalated
 */
export interface LeaseEscalatedEventEntry {
  Source: 'innovation-sandbox';
  DetailType: 'LeaseEscalated';
  Detail: string; // JSON stringified LeaseEscalatedDetail
  EventBusName: string;
}

// Note: Additional internal types (LeaseRequest, ApprovalDecision) will be added
// when implementing the full scoring engine in Story 2.3
