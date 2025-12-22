import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { logger } from './lib/logger.js';
import { LeaseRequestedEventSchema, type LeaseRequestedEvent } from './lib/types.js';
import { createEventBridgeService, type EventBridgeService } from './services/eventbridge.js';
import {
  ApprovalState,
  createInitialContext,
  createStateMachineOrchestrator,
  type StateContext,
  type StateMachineOrchestrator,
  type StateMachineConfig,
  type StateMachineLogger,
} from './state-machine/index.js';
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

// State machine configuration
const stateMachineConfig: StateMachineConfig = {
  autoApproveThreshold: parseInt(process.env.AUTO_APPROVE_THRESHOLD || '20', 10),
};

// Create orchestrator (can be overridden in tests via dependency injection)
let orchestrator: StateMachineOrchestrator = createStateMachineOrchestrator({
  stateMachineConfig,
  logger: logger as StateMachineLogger,
});

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
 * Allows overriding the state machine orchestrator for testing purposes.
 */
export const setOrchestrator = (newOrchestrator: StateMachineOrchestrator): void => {
  orchestrator = newOrchestrator;
};

/**
 * Resets to the default orchestrator (for test cleanup).
 */
export const resetOrchestrator = (): void => {
  orchestrator = createStateMachineOrchestrator({
    stateMachineConfig,
    logger: logger as StateMachineLogger,
  });
};

/**
 * Prepares the initial state context from a validated event.
 */
const prepareContext = (event: LeaseRequestedEvent): StateContext => {
  const { detail } = event;
  const { leaseId, templateId, budgetAmount, leaseDurationHours, requiresManualApproval, comments } =
    detail;

  return {
    ...createInitialContext(),
    leaseId: leaseId.uuid,
    userEmail: leaseId.userEmail,
    templateId,
    budgetAmount,
    leaseDurationHours,
    requiresManualApproval,
    comments,
  };
};

/**
 * Processes LeaseRequested events using the state machine for decision orchestration.
 * Side effects (EventBridge emission) are handled in this handler, not in the state machine.
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

  // Prepare context and run state machine
  const initialContext = prepareContext(validatedEvent);
  const result = orchestrator.run(ApprovalState.RECEIVED, initialContext);

  // Handle state machine result
  if (!result.success) {
    // State machine ended in ERROR state
    logger.error('State machine failed', {
      finalState: result.finalState,
      error: result.context.error,
      leaseId: leaseId.uuid,
      userEmail: leaseId.userEmail,
    });
    return {
      statusCode: 500,
      body: 'Processing failed - request queued for manual review',
    };
  }

  // Handle based on decision
  const { decision, approvedBy, reason, score } = result.context;

  if (decision === 'approved') {
    // Emit LeaseApproved event (side effect - not in state machine)
    const approvalParams = {
      leaseId: leaseId.uuid,
      userEmail: leaseId.userEmail,
      approvedBy: approvedBy ?? 'approver-service@system',
      score,
      reason: reason ?? 'Stub approval - scoring not implemented',
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
  }

  if (decision === 'escalated') {
    // For now, escalated requests are logged but still processed
    // Full escalation handling comes in later stories
    logger.info('Request escalated for manual review', {
      action: 'escalated',
      timestamp: new Date().toISOString(),
      leaseId: leaseId.uuid,
      userEmail: leaseId.userEmail,
      score,
      reason,
    });

    // TODO: In Story 5.2, this will send Slack notification
    // For now, treat as approved for backward compatibility with Story 2.1
    const approvalParams = {
      leaseId: leaseId.uuid,
      userEmail: leaseId.userEmail,
      approvedBy: 'approver-service@system',
      score,
      reason: 'Escalated - manual review pending (stub: auto-approved)',
    };

    try {
      await eventBridgeService.emitLeaseApproved(approvalParams);
    } catch (error) {
      logger.error('Failed to emit LeaseApproved event for escalated request', {
        error: error instanceof Error ? error.message : String(error),
        leaseId: leaseId.uuid,
        userEmail: leaseId.userEmail,
      });
      return {
        statusCode: 500,
        body: 'Failed to emit approval event',
      };
    }

    return {
      statusCode: 200,
      body: 'OK',
    };
  }

  if (decision === 'denied') {
    // Denied requests are logged for future implementation
    // Full denial handling comes in Story 2.4
    logger.info('Request denied', {
      action: 'denied',
      timestamp: new Date().toISOString(),
      leaseId: leaseId.uuid,
      userEmail: leaseId.userEmail,
      score,
      reason,
    });

    // TODO: In Story 2.4, this will emit LeaseDenied event
    // For now, return error as denied is not fully implemented
    return {
      statusCode: 500,
      body: 'Denied requests not yet implemented',
    };
  }

  // Unexpected decision
  logger.warn('Unexpected decision from state machine', {
    decision,
    finalState: result.finalState,
  });

  return {
    statusCode: 500,
    body: 'Unexpected processing state',
  };
};
