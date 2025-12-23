import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
// makeIdempotent import prepared for future full integration (Story 2.4 deferred handler wrapping)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { makeIdempotent as _makeIdempotent } from '@aws-lambda-powertools/idempotency';
import { logger } from './lib/logger.js';
import { LeaseRequestedEventSchema, type LeaseRequestedEvent } from './lib/types.js';
import { createEventBridgeService, type EventBridgeService } from './services/eventbridge.js';
import { createIsbLambdaService, type IsbLambdaService } from './services/isb-lambda.js';
import { createDynamoDBService, type DynamoDBService } from './services/dynamodb.js';
import { extractDomain } from './lib/domain.js';
import type { LeaseHistoryRecord } from './scoring/types.js';
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

// Lambda client for direct ISB Lambda invocation
const lambdaClient = new LambdaClient({
  region: process.env.AWS_REGION || 'us-west-2',
});

// ISB Lambda service configuration
const isbLambdaConfig = {
  functionName: process.env.ISB_LEASES_LAMBDA_NAME || 'ISB-LeasesLambdaFunction-ndx',
};

// Create ISB Lambda service (can be overridden in tests via dependency injection)
let isbLambdaService: IsbLambdaService = createIsbLambdaService(lambdaClient, isbLambdaConfig);

// DynamoDB client for user history queries (ISB Leases table)
const dynamoDBClient = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-west-2',
});
const dynamoDBDocClient = DynamoDBDocumentClient.from(dynamoDBClient);

// DynamoDB service configuration
const dynamoDBConfig = {
  tableName: process.env.ISB_LEASES_TABLE_NAME || '',
};

// Create DynamoDB service (can be overridden in tests via dependency injection)
let dynamoDBService: DynamoDBService | undefined = dynamoDBConfig.tableName
  ? createDynamoDBService(dynamoDBDocClient, dynamoDBConfig)
  : undefined;

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
 * Allows overriding the ISB Lambda service for testing purposes.
 */
export const setIsbLambdaService = (service: IsbLambdaService): void => {
  isbLambdaService = service;
};

/**
 * Resets to the default ISB Lambda service (for test cleanup).
 */
export const resetIsbLambdaService = (): void => {
  isbLambdaService = createIsbLambdaService(lambdaClient, isbLambdaConfig);
};

/**
 * Allows overriding the DynamoDB service for testing purposes.
 */
export const setDynamoDBService = (service: DynamoDBService | undefined): void => {
  dynamoDBService = service;
};

/**
 * Resets to the default DynamoDB service (for test cleanup).
 */
export const resetDynamoDBService = (): void => {
  dynamoDBService = dynamoDBConfig.tableName
    ? createDynamoDBService(dynamoDBDocClient, dynamoDBConfig)
    : undefined;
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
 * Queries user lease history from DynamoDB with pessimistic fallback on error.
 * If DynamoDB is not configured or query fails, returns empty array (pessimistic fallback).
 */
const queryUserHistory = async (userEmail: string): Promise<LeaseHistoryRecord[]> => {
  if (!dynamoDBService) {
    logger.warn('DynamoDB service not configured - using pessimistic fallback', {
      userEmail,
    });
    return [];
  }

  try {
    const history = await dynamoDBService.getUserLeaseHistory(userEmail);
    logger.info('User history retrieved', {
      userEmail,
      leaseCount: history.length,
    });
    return history;
  } catch (error) {
    // Log error but use pessimistic fallback (empty history)
    // This triggers first_time_user penalty and skips bonuses
    logger.error('Failed to query user history - using pessimistic fallback', {
      error: error instanceof Error ? error.message : String(error),
      userEmail,
    });
    return [];
  }
};

/**
 * Queries organization lease history from DynamoDB with pessimistic fallback on error.
 * Returns leases from OTHER users at the same domain (excludes current user).
 * If DynamoDB is not configured or query fails, returns empty array (pessimistic fallback).
 */
const queryOrgHistory = async (userEmail: string): Promise<LeaseHistoryRecord[]> => {
  if (!dynamoDBService) {
    logger.warn('DynamoDB service not configured - skipping org history', {
      userEmail,
    });
    return [];
  }

  try {
    const domain = extractDomain(userEmail);
    const history = await dynamoDBService.getOrgLeaseHistory(domain, userEmail);
    logger.info('Org history retrieved', {
      domain,
      leaseCount: history.length,
    });
    return history;
  } catch (error) {
    // Pessimistic fallback - empty history means no penalties or bonuses
    logger.error('Failed to query org history - using pessimistic fallback', {
      error: error instanceof Error ? error.message : String(error),
      userEmail,
    });
    return [];
  }
};

/**
 * Prepares the initial state context from a validated event.
 */
const prepareContext = (
  event: LeaseRequestedEvent,
  userLeaseHistory: LeaseHistoryRecord[],
  orgLeaseHistory: LeaseHistoryRecord[]
): StateContext => {
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
    userLeaseHistory,
    orgLeaseHistory,
  };
};

/**
 * Emits a LeaseEscalated event for fail-closed error handling.
 * This ensures the request is queued for manual review even when errors occur.
 */
const emitEscalationOnError = async (
  leaseId: { userEmail: string; uuid: string },
  reason: string,
  errorCode: string,
  score?: number
): Promise<void> => {
  try {
    await eventBridgeService.emitLeaseEscalated({
      leaseId,
      reason,
      errorCode,
      score,
    });
    logger.info('LeaseEscalated event emitted for error handling', {
      action: 'escalated',
      errorCode,
      leaseId: leaseId.uuid,
      userEmail: leaseId.userEmail,
    });
  } catch (emitError) {
    // Log the failure but don't throw - we still want to throw the original error for DLQ
    logger.error('Failed to emit LeaseEscalated event', {
      error: emitError instanceof Error ? emitError.message : String(emitError),
      leaseId: leaseId.uuid,
      userEmail: leaseId.userEmail,
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

  // Extract domain for org-level queries and logging (AC5: cross-org security review)
  let domain: string;
  try {
    domain = extractDomain(leaseId.userEmail);
  } catch {
    domain = 'unknown';
  }

  // Add correlation context for structured logging (AC5: include domain)
  logger.appendKeys({
    leaseId: leaseId.uuid,
    userEmail: leaseId.userEmail,
    templateId,
    eventId,
    idempotencyKey,
    domain,
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
    // Query user and org history before running state machine
    const userLeaseHistory = await queryUserHistory(leaseId.userEmail);
    const orgLeaseHistory = await queryOrgHistory(leaseId.userEmail);

    // Prepare context and run state machine
    const initialContext = prepareContext(validatedEvent, userLeaseHistory, orgLeaseHistory);
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
        leaseId,
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

      // Approve lease via direct ISB Lambda invocation
      const approverEmail = approvedBy ?? 'ndx+try-automated-approver@dsit.gov.uk';
      const approvalResult = await isbLambdaService.approveLease({
        leaseId,
        approverEmail,
      });

      if (!approvalResult.success) {
        logger.error('ISB Lambda approval failed', {
          leaseId: leaseId.uuid,
          userEmail: leaseId.userEmail,
          statusCode: approvalResult.statusCode,
          error: approvalResult.error,
        });

        // Escalate on approval failure
        await emitEscalationOnError(
          leaseId,
          `ISB Lambda approval failed: ${approvalResult.error}`,
          'ISB_APPROVAL_FAILED',
          score
        );

        throw new ProcessingError(
          approvalResult.error ?? 'ISB approval failed',
          'ISB_APPROVAL_FAILED',
          leaseId.uuid,
          leaseId.userEmail,
          score
        );
      }

      logger.info('Lease approved via ISB Lambda', {
        action: 'approved',
        timestamp: new Date().toISOString(),
        leaseId: leaseId.uuid,
        userEmail: leaseId.userEmail,
        approvedBy: approverEmail,
        score,
        scoreBreakdown: result.context.scoreBreakdown,
        reason: reason ?? 'Auto-approved',
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
        scoreBreakdown: result.context.scoreBreakdown,
        reason,
      });

      // TODO: In Story 5.2, this will send Slack notification
      // For now, treat as approved for backward compatibility with Story 2.1
      const approverEmail = 'ndx+try-automated-approver@dsit.gov.uk';
      const approvalResult = await isbLambdaService.approveLease({
        leaseId,
        approverEmail,
      });

      if (!approvalResult.success) {
        logger.error('ISB Lambda approval failed for escalated request', {
          leaseId: leaseId.uuid,
          userEmail: leaseId.userEmail,
          statusCode: approvalResult.statusCode,
          error: approvalResult.error,
        });

        await emitEscalationOnError(
          leaseId,
          `ISB Lambda approval failed (escalated): ${approvalResult.error}`,
          'ISB_APPROVAL_FAILED',
          score
        );

        throw new ProcessingError(
          approvalResult.error ?? 'ISB approval failed',
          'ISB_APPROVAL_FAILED',
          leaseId.uuid,
          leaseId.userEmail,
          score
        );
      }

      logger.info('Escalated lease approved via ISB Lambda (stub)', {
        action: 'escalated_approved',
        timestamp: new Date().toISOString(),
        leaseId: leaseId.uuid,
        userEmail: leaseId.userEmail,
        approvedBy: approverEmail,
        score,
        scoreBreakdown: result.context.scoreBreakdown,
        reason: 'Escalated - manual review pending (stub: auto-approved)',
      });

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
        scoreBreakdown: result.context.scoreBreakdown,
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
      leaseId,
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
