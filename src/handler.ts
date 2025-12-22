import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { logger } from './lib/logger.js';
import { LeaseRequestedEventSchema, type LeaseRequestedEvent } from './lib/types.js';
import { createEventBridgeService, type EventBridgeService } from './services/eventbridge.js';
import type { EventBridgeEvent, Context } from 'aws-lambda';

export interface ApproverResponse {
  statusCode: number;
  body: string;
}

// EventBridge client initialized outside handler for connection reuse across invocations
const eventBridgeClient = new EventBridgeClient({
  region: process.env.AWS_REGION || 'us-west-2',
});

// Default configuration for EventBridge service
const eventBridgeConfig = {
  eventBusName: process.env.EVENT_BUS_NAME || 'default',
  source: 'innovation-sandbox',
};

// Create service instance (can be overridden in tests via dependency injection)
let eventBridgeService: EventBridgeService = createEventBridgeService(
  eventBridgeClient,
  eventBridgeConfig
);

/**
 * Allows overriding the EventBridge service for testing purposes.
 * Uses dependency injection pattern for testability.
 */
export const setEventBridgeService = (service: EventBridgeService): void => {
  eventBridgeService = service;
};

/**
 * Resets to the default EventBridge service (for test cleanup).
 */
export const resetEventBridgeService = (): void => {
  eventBridgeService = createEventBridgeService(eventBridgeClient, eventBridgeConfig);
};

/**
 * Processes LeaseRequested events and emits approvals.
 * Currently implements stub approval - all requests auto-approved.
 */
export const handler = async (
  event: EventBridgeEvent<string, unknown>,
  context: Context
): Promise<ApproverResponse> => {
  logger.addContext(context);

  // Only process LeaseRequested events
  if (event['detail-type'] !== 'LeaseRequested') {
    logger.info('Ignoring non-LeaseRequested event', {
      detailType: event['detail-type'],
    });
    return {
      statusCode: 200,
      body: 'Ignored - not a LeaseRequested event',
    };
  }

  // Validate event against schema
  const parseResult = LeaseRequestedEventSchema.safeParse(event);
  if (!parseResult.success) {
    logger.error('Invalid LeaseRequested event schema', {
      errors: parseResult.error.errors,
    });
    return {
      statusCode: 400,
      body: 'Invalid event schema',
    };
  }

  const validatedEvent: LeaseRequestedEvent = parseResult.data;
  const { leaseId, templateId } = validatedEvent.detail;

  // Add correlation context for structured logging
  logger.appendKeys({
    leaseId: leaseId.uuid,
    userEmail: leaseId.userEmail,
    templateId,
  });

  logger.info('LeaseRequested event received', {
    detailType: validatedEvent['detail-type'],
    budgetAmount: validatedEvent.detail.budgetAmount,
    leaseDurationHours: validatedEvent.detail.leaseDurationHours,
    requiresManualApproval: validatedEvent.detail.requiresManualApproval,
  });

  // Stub approval - emit LeaseApproved event
  const approvalParams = {
    leaseId: leaseId.uuid,
    userEmail: leaseId.userEmail,
    approvedBy: 'approver-service@system',
    score: 0,
    reason: 'Stub approval - scoring not implemented',
  };

  try {
    await eventBridgeService.emitLeaseApproved(approvalParams);
  } catch (error) {
    // Fail-closed: If we can't emit the approval, fail the request
    logger.error('Failed to emit LeaseApproved event', {
      error: error instanceof Error ? error.message : String(error),
      leaseId: leaseId.uuid,
      userEmail: leaseId.userEmail,
    });
    return {
      statusCode: 500,
      body: 'Failed to emit approval event',
    };
  }

  logger.info('Approval emitted', {
    action: 'approved',
    timestamp: new Date().toISOString(),
    leaseId: leaseId.uuid,
    userEmail: leaseId.userEmail,
    approvedBy: approvalParams.approvedBy,
    score: approvalParams.score,
    reason: approvalParams.reason,
  });

  return {
    statusCode: 200,
    body: 'OK',
  };
};
