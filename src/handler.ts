import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
// makeIdempotent import prepared for future full integration (Story 2.4 deferred handler wrapping)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { makeIdempotent as _makeIdempotent } from '@aws-lambda-powertools/idempotency';
import { logger } from './lib/logger.js';
import { LeaseRequestedEventSchema, type LeaseRequestedEvent } from './lib/types.js';
import { createEventBridgeService, type EventBridgeService } from './services/eventbridge.js';
import {
  createPersistenceLayer,
  createIdempotencyConfig,
  generateIdempotencyKey,
} from './lib/idempotency.js';
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

/**
 * Error class for unrecoverable processing errors.
 * These errors trigger fail-closed behavior and DLQ routing.
 */
export class ProcessingError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly leaseId?: string,
    public readonly userEmail?: string,
    public readonly score?: number
  ) {
    super(message);
    this.name = 'ProcessingError';
  }
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

// Idempotency configuration - lazy initialized to allow testing without DynamoDB
// These variables are prepared for full handler wrapping (deferred in Story 2.4)
let idempotencyEnabled = false;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let _persistenceLayer: ReturnType<typeof createPersistenceLayer> | undefined;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let _idempotencyConfig: ReturnType<typeof createIdempotencyConfig> | undefined;

/**
 * Initializes idempotency if IDEMPOTENCY_TABLE_NAME is set.
 * Call this lazily to allow testing without DynamoDB.
 */
/* c8 ignore start - idempotency initialization requires actual DynamoDB in AWS */
const initializeIdempotency = (): boolean => {
  if (idempotencyEnabled) return true;
  if (!process.env.IDEMPOTENCY_TABLE_NAME) return false;

  try {
    _persistenceLayer = createPersistenceLayer();
    _idempotencyConfig = createIdempotencyConfig();
    idempotencyEnabled = true;
    return true;
  } catch {
    logger.warn('Failed to initialize idempotency - continuing without it');
    return false;
  }
};
/* c8 ignore stop */

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
 * Emits a LeaseEscalated event for fail-closed error handling.
 * This ensures the request is queued for manual review even when errors occur.
 */
const emitEscalationOnError = async (
  leaseId: string,
  userEmail: string,
  reason: string,
  errorCode: string,
  score?: number
): Promise<void> => {
  try {
    await eventBridgeService.emitLeaseEscalated({
      leaseId,
      userEmail,
      reason,
      errorCode,
      score,
    });
    logger.info('LeaseEscalated event emitted for error handling', {
      action: 'escalated',
      errorCode,
      leaseId,
      userEmail,
    });
  } catch (emitError) {
    // Log the failure but don't throw - we still want to throw the original error for DLQ
    logger.error('Failed to emit LeaseEscalated event', {
      error: emitError instanceof Error ? emitError.message : String(emitError),
      leaseId,
      userEmail,
      originalError: reason,
    });
  }
};

/**
 * Processes LeaseRequested events using the state machine for decision orchestration.
 * Side effects (EventBridge emission) are handled in this handler, not in the state machine.
 *
 * Implements fail-closed error handling:
 * - On unrecoverable errors, emits LeaseEscalated event
 * - Then throws to route to DLQ for investigation
 */
export const handler = async (
  event: EventBridgeEvent<string, unknown>,
  context: Context
): Promise<ApproverResponse> => {
  logger.addContext(context);

  // Track event ID for idempotency key generation
  const eventId = event.id;

  // Initialize idempotency if configured
  initializeIdempotency();

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
      eventId,
    });
    return {
      statusCode: 400,
      body: 'Invalid event schema',
    };
  }

  const validatedEvent: LeaseRequestedEvent = parseResult.data;
  const { leaseId, templateId } = validatedEvent.detail;

  // Generate idempotency key for deduplication tracking
  const idempotencyKey = generateIdempotencyKey(leaseId.uuid, eventId);

  // Add correlation context for structured logging
  logger.appendKeys({
    leaseId: leaseId.uuid,
    userEmail: leaseId.userEmail,
    templateId,
    eventId,
    idempotencyKey,
  });

  logger.info('LeaseRequested event received', {
    detailType: validatedEvent['detail-type'],
    budgetAmount: validatedEvent.detail.budgetAmount,
    leaseDurationHours: validatedEvent.detail.leaseDurationHours,
    requiresManualApproval: validatedEvent.detail.requiresManualApproval,
  });

  // Track score for error reporting (populated after state machine runs)
  let currentScore: number | undefined;

  try {
    // Prepare context and run state machine
    const initialContext = prepareContext(validatedEvent);
    const result = orchestrator.run(ApprovalState.RECEIVED, initialContext);

    // Capture score for error handling
    currentScore = result.context.score;

    // Handle state machine result
    if (!result.success) {
      // State machine ended in ERROR state - fail-closed behavior
      const errorMessage = result.context.error?.message ?? 'Unknown error';
      const errorCode = result.context.error?.code ?? 'UNKNOWN_ERROR';

      logger.error('State machine failed - triggering fail-closed escalation', {
        finalState: result.finalState,
        error: result.context.error,
        leaseId: leaseId.uuid,
        userEmail: leaseId.userEmail,
      });

      // Emit LeaseEscalated event before throwing for DLQ
      await emitEscalationOnError(
        leaseId.uuid,
        leaseId.userEmail,
        `State machine error: ${errorMessage}`,
        errorCode,
        result.context.score
      );

      // Throw to route to DLQ - fail-closed behavior
      throw new ProcessingError(
        errorMessage,
        errorCode,
        leaseId.uuid,
        leaseId.userEmail,
        result.context.score
      );
    }

    // Handle based on decision
    const { decision, approvedBy, reason, score, allowListOverride } = result.context;

    if (decision === 'approved') {
      // Log allow-list override if applicable
      if (allowListOverride) {
        // Note: For allow-list override, score is 0 as scoring was bypassed
        // The calculated score for reference would require running the scoring engine
        // which is intentionally skipped for performance. Logging score=0 with override flag.
        logger.info('ALLOW-LIST-OVERRIDE applied', {
          action: 'approved',
          allowListOverride: true,
          userEmail: leaseId.userEmail,
          score: score, // Will be 0 for allow-list override
          reason: 'Scoring bypassed for allow-listed user',
        });
      }

      // Emit LeaseApproved event (side effect - not in state machine)
      const approvalParams = {
        leaseId: leaseId.uuid,
        userEmail: leaseId.userEmail,
        approvedBy: approvedBy ?? 'approver-service@system',
        score,
        reason: reason ?? 'Auto-approved',
      };

      await eventBridgeService.emitLeaseApproved(approvalParams);

      logger.info('Approval emitted', {
        action: 'approved',
        timestamp: new Date().toISOString(),
        leaseId: leaseId.uuid,
        userEmail: leaseId.userEmail,
        approvedBy: approvalParams.approvedBy,
        score: approvalParams.score,
        reason: approvalParams.reason,
        allowListOverride,
      });

      return {
        statusCode: 200,
        body: 'OK',
      };
    }

    if (decision === 'escalated') {
      // Log escalation
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

      await eventBridgeService.emitLeaseApproved(approvalParams);

      return {
        statusCode: 200,
        body: 'OK',
      };
    }

    if (decision === 'denied') {
      // Denied requests are logged for future implementation
      logger.info('Request denied', {
        action: 'denied',
        timestamp: new Date().toISOString(),
        leaseId: leaseId.uuid,
        userEmail: leaseId.userEmail,
        score,
        reason,
      });

      // TODO: In future story, this will emit LeaseDenied event
      // For now, return error as denied is not fully implemented
      return {
        statusCode: 500,
        body: 'Denied requests not yet implemented',
      };
    }

    // Unexpected decision - log warning but don't fail-closed
    logger.warn('Unexpected decision from state machine', {
      decision,
      finalState: result.finalState,
    });

    return {
      statusCode: 500,
      body: 'Unexpected processing state',
    };
  } catch (error) {
    // If it's already a ProcessingError, re-throw for DLQ routing
    if (error instanceof ProcessingError) {
      throw error;
    }

    // Unexpected error - apply fail-closed behavior
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Unexpected error - triggering fail-closed escalation', {
      error: errorMessage,
      leaseId: leaseId.uuid,
      userEmail: leaseId.userEmail,
    });

    // Emit LeaseEscalated event before throwing for DLQ
    await emitEscalationOnError(
      leaseId.uuid,
      leaseId.userEmail,
      `Unexpected error: ${errorMessage}`,
      'UNEXPECTED_ERROR',
      currentScore
    );

    // Throw to route to DLQ
    throw new ProcessingError(
      errorMessage,
      'UNEXPECTED_ERROR',
      leaseId.uuid,
      leaseId.userEmail,
      currentScore
    );
  }
};
