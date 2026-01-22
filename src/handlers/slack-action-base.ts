/**
 * Shared Logic for Slack Action Lambda Handlers (Stories 7.2.1, 7.2.2)
 *
 * Contains common functionality for Approve and Deny action handlers:
 * - Event validation
 * - Slack user ID sanitization
 * - Response formatting
 * - Error handling
 *
 * @see https://docs.aws.amazon.com/chatbot/latest/adminguide/custom-actions.html
 */

import { LambdaClient } from '@aws-sdk/client-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { createIsbLambdaService, type IsbLambdaService } from '../services/isb-lambda.js';
import { type CustomActionResponse, decodeLeaseCompositeKey } from '../lib/slack-action-types.js';

/**
 * Action type for the handler.
 */
export type ActionType = 'approve' | 'deny';

/**
 * Valid outcome values for action log entries (Story 7.4.1).
 * Used for audit trail and CloudWatch Insights queries.
 */
export const ACTION_LOG_OUTCOMES = ['success', 'already_processed', 'error'] as const;

/**
 * Type for action log outcomes derived from the constant.
 */
export type ActionLogOutcome = (typeof ACTION_LOG_OUTCOMES)[number];

/**
 * Configuration for a Slack action handler.
 */
export interface SlackActionConfig {
  /** Action type */
  actionType: ActionType;
  /** Logger service name */
  serviceName: string;
  /** Success message emoji */
  successEmoji: string;
  /** Success message verb (past tense) */
  successVerb: string;
  /** Error message for failed action */
  failureMessage: string;
}

/**
 * Represents a validated event with extracted leaseId and optional slackUserId.
 */
export interface ValidatedPayload {
  leaseId: string;
  slackUserId: string;
}

/**
 * Result from ISB Lambda service.
 */
export interface IsbLambdaResult {
  success: boolean;
  statusCode?: number;
  error?: string;
}

/**
 * Validates Slack User ID format.
 * Slack user IDs follow the pattern: U followed by alphanumeric characters (e.g., U12345678, UABCD1234XYZ)
 *
 * @param slackUserId - The Slack user ID to validate
 * @returns true if valid, false otherwise
 */
export const isValidSlackUserId = (slackUserId: string): boolean => {
  // Slack user IDs: U followed by 8-11 alphanumeric characters
  return /^U[A-Z0-9]{8,11}$/i.test(slackUserId);
};

/**
 * Sanitizes Slack User ID for safe inclusion in response messages.
 * Returns a safe fallback if the ID doesn't match expected format.
 *
 * @param slackUserId - The Slack user ID to sanitize
 * @returns Sanitized user ID or fallback
 */
export const sanitizeSlackUserId = (slackUserId: string): string => {
  if (isValidSlackUserId(slackUserId)) {
    return slackUserId;
  }
  // Return a safe fallback for unexpected formats
  return 'unknown-user';
};

/**
 * Creates a success response for thread reply.
 *
 * Simplified format: just emoji + action verb (e.g., "✅ Approved")
 * The operator identity is not included because Amazon Q custom actions
 * don't pass Slack user ID to the Lambda payload.
 *
 * @param _slackUserId - Unused (kept for API compatibility)
 * @param config - Action configuration
 * @returns CustomActionResponse with success message
 */
export const createSuccessResponse = (
  _slackUserId: string,
  config: SlackActionConfig
): CustomActionResponse => {
  return {
    version: '1.0',
    status: 'success',
    message: `${config.successEmoji} ${config.successVerb}`,
  };
};

/**
 * Creates an error response for thread reply.
 *
 * @param errorMessage - Error message to display
 * @param correlationId - Reference ID for troubleshooting
 * @returns CustomActionResponse with error message
 */
export const createErrorResponse = (
  errorMessage: string,
  correlationId: string
): CustomActionResponse => {
  return {
    version: '1.0',
    status: 'error',
    message: `❌ Error: ${errorMessage} (ref: ${correlationId})`,
  };
};

/**
 * Creates an "already processed" response for thread reply.
 *
 * @param _slackUserId - Unused (kept for API compatibility)
 * @returns CustomActionResponse with already processed message
 */
export const createAlreadyProcessedResponse = (_slackUserId: string): CustomActionResponse => {
  return {
    version: '1.0',
    status: 'error',
    message: `ℹ️ Already processed - This request was already approved or denied`,
  };
};

/**
 * Validates the custom action event payload.
 *
 * Supports two payload formats:
 * 1. Direct lambda invoke format (from CDK custom action):
 *    {"leaseId": "base64-encoded-value"}
 *
 * 2. Full notification context format (original design):
 *    {"originalNotification": {"additionalContext": {"leaseId": "..."}}, "slackUserId": "U..."}
 *
 * @param event - The incoming event
 * @returns Validation result with extracted payload or error message
 */
export const validateEvent = (
  event: unknown
): { valid: true; payload: ValidatedPayload } | { valid: false; error: string } => {
  if (!event || typeof event !== 'object') {
    return { valid: false, error: 'Event is not an object' };
  }

  const e = event as Record<string, unknown>;

  // Format 1: Direct lambda invoke from custom action (Story 7.2.3)
  // Payload: {"leaseId": "base64-encoded-value"}
  if (typeof e.leaseId === 'string' && e.leaseId.length > 0) {
    // When invoked via custom action, we don't have slackUserId in payload
    // Use a default value - the user context is logged by Amazon Q
    return {
      valid: true,
      payload: {
        leaseId: e.leaseId,
        slackUserId: 'operator', // Generic since we don't have the actual user ID in this format
      },
    };
  }

  // Format 2: Full notification context format (original design)
  // Payload: {"originalNotification": {"additionalContext": {"leaseId": "..."}}, "slackUserId": "U..."}
  if (e.originalNotification && typeof e.originalNotification === 'object') {
    const on = e.originalNotification as Record<string, unknown>;

    if (!on.additionalContext || typeof on.additionalContext !== 'object') {
      return { valid: false, error: 'Missing additionalContext in originalNotification' };
    }

    const ac = on.additionalContext as Record<string, unknown>;

    if (!ac.leaseId || typeof ac.leaseId !== 'string') {
      return { valid: false, error: 'Missing or invalid leaseId in additionalContext' };
    }

    const slackUserId = typeof e.slackUserId === 'string' ? e.slackUserId : 'operator';

    return {
      valid: true,
      payload: {
        leaseId: ac.leaseId,
        slackUserId,
      },
    };
  }

  return {
    valid: false,
    error:
      'Missing leaseId - expected either {leaseId: "..."} or {originalNotification: {additionalContext: {leaseId: "..."}}}',
  };
};

/**
 * Checks if the ISB Lambda result indicates an "already processed" scenario.
 *
 * @param result - Result from ISB Lambda service
 * @returns true if the lease was already processed
 */
export const isAlreadyProcessedResult = (result: IsbLambdaResult): boolean => {
  // ISB returns 409 when lease is already approved/denied
  // Also check error message for explicit "already" or "processed" keywords
  // Note: 400 alone doesn't mean "already processed" - could be "Invalid uuid" etc.
  return Boolean(
    result.statusCode === 409 ||
    result.error?.toLowerCase().includes('already') ||
    result.error?.toLowerCase().includes('processed') ||
    result.error?.toLowerCase().includes('invalid state')
  );
};

/**
 * Gets a user-friendly error message based on the ISB Lambda result.
 *
 * @param result - Result from ISB Lambda service
 * @param config - Action configuration
 * @returns User-friendly error message
 */
export const getUserFriendlyErrorMessage = (
  result: IsbLambdaResult,
  config: SlackActionConfig
): string => {
  if (result.statusCode !== undefined && result.statusCode >= 500) {
    return 'Service temporarily unavailable, please try again';
  }
  return result.error ?? config.failureMessage;
};

/**
 * State for the Slack action handler factory.
 */
interface SlackActionHandlerState {
  lambdaClient: LambdaClient;
  isbLambdaService: IsbLambdaService | null;
  logger: Logger;
  config: SlackActionConfig;
}

/**
 * Creates a Slack action handler with the given configuration.
 *
 * @param config - Action configuration
 * @returns Handler function and test utilities
 */
export const createSlackActionHandler = (config: SlackActionConfig) => {
  const state: SlackActionHandlerState = {
    lambdaClient: new LambdaClient({
      region: process.env.AWS_REGION,
    }),
    isbLambdaService: null,
    logger: new Logger({
      serviceName: config.serviceName,
      logLevel: (process.env.LOG_LEVEL as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR') ?? 'INFO',
    }),
    config,
  };

  /**
   * Gets or creates the ISB Lambda service.
   * Validates required environment variables on first call.
   */
  const getIsbLambdaService = (): IsbLambdaService => {
    if (state.isbLambdaService) {
      return state.isbLambdaService;
    }

    const functionName = process.env.ISB_LEASES_LAMBDA_NAME;
    if (!functionName) {
      throw new Error('ISB_LEASES_LAMBDA_NAME environment variable is required');
    }

    state.isbLambdaService = createIsbLambdaService(state.lambdaClient, { functionName });
    return state.isbLambdaService;
  };

  /**
   * Gets the approver email from environment.
   * Validates the environment variable is set.
   */
  const getApproverEmail = (): string => {
    const email = process.env.APPROVER_EMAIL;
    if (!email) {
      throw new Error('APPROVER_EMAIL environment variable is required');
    }
    return email;
  };

  /**
   * Main handler for Slack action.
   *
   * Flow:
   * 1. Validate and parse the custom action payload
   * 2. Extract and decode the leaseId from additionalContext
   * 3. Invoke ISB Lambda via existing service to approve/deny the lease
   * 4. Return formatted response for thread reply
   *
   * @param event - Custom action event from Amazon Q Developer
   * @returns CustomActionResponse for thread reply
   */
  const handler = async (event: unknown): Promise<CustomActionResponse> => {
    const correlationId = `${config.actionType}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    // Track decoded lease info for error logging (Story 7.4.1 AC1)
    let decodedLeaseId: { userEmail: string; uuid: string } | undefined;
    let operatorId: string | undefined;

    state.logger.info(`${config.successVerb.charAt(0).toUpperCase() + config.successVerb.slice(1).replace('ed', '')} action received`, {
      correlationId,
    });

    try {
      // 1. Validate event structure
      const validation = validateEvent(event);
      if (!validation.valid) {
        state.logger.error('Invalid event payload', {
          correlationId,
          error: validation.error,
        });
        return createErrorResponse(validation.error, correlationId);
      }

      const { leaseId: encodedLeaseId, slackUserId } = validation.payload;
      operatorId = slackUserId;

      state.logger.info(`Processing ${config.actionType} action`, {
        correlationId,
        slackUserId,
      });

      // 2. Decode the composite lease ID
      let leaseId: { userEmail: string; uuid: string };
      try {
        leaseId = decodeLeaseCompositeKey(encodedLeaseId);
        decodedLeaseId = leaseId; // Store for error logging
      } catch (decodeError) {
        state.logger.error('Failed to decode leaseId', {
          correlationId,
          error: decodeError instanceof Error ? decodeError.message : String(decodeError),
        });
        return createErrorResponse('Invalid lease identifier', correlationId);
      }

      state.logger.info('Decoded leaseId', {
        correlationId,
        leaseId: leaseId.uuid,
        userEmail: leaseId.userEmail,
        slackUserId,
      });

      // 3. Invoke ISB Lambda to approve/deny the lease
      const isbService = getIsbLambdaService();
      const result =
        config.actionType === 'approve'
          ? await isbService.approveLease({
              leaseId,
              approverEmail: getApproverEmail(),
            })
          : await isbService.denyLease({
              leaseId,
              approverEmail: getApproverEmail(),
            });

      // 4. Handle response
      if (result.success) {
        state.logger.info(`Lease ${config.actionType}d successfully`, {
          correlationId,
          action: config.actionType,
          outcome: 'success' as ActionLogOutcome,
          leaseId: leaseId.uuid,
          userEmail: leaseId.userEmail,
          operator: slackUserId,
          statusCode: result.statusCode,
        });
        return createSuccessResponse(slackUserId, config);
      }

      // Check for "already processed" scenarios
      if (isAlreadyProcessedResult(result)) {
        state.logger.info('Lease already processed', {
          correlationId,
          action: config.actionType,
          outcome: 'already_processed' as ActionLogOutcome,
          leaseId: leaseId.uuid,
          userEmail: leaseId.userEmail,
          operator: slackUserId,
          statusCode: result.statusCode,
          error: result.error,
        });
        return createAlreadyProcessedResponse(slackUserId);
      }

      // Other errors - fail closed (request remains pending)
      state.logger.error('ISB Lambda returned error', {
        correlationId,
        action: config.actionType,
        outcome: 'error' as ActionLogOutcome,
        leaseId: leaseId.uuid,
        userEmail: leaseId.userEmail,
        operator: slackUserId,
        statusCode: result.statusCode,
        error: result.error,
      });

      return createErrorResponse(getUserFriendlyErrorMessage(result, config), correlationId);
    } catch (error) {
      // Log error at ERROR level (without stack trace for production visibility)
      state.logger.error(`Unexpected error in ${config.actionType} handler`, {
        correlationId,
        action: config.actionType,
        outcome: 'error' as ActionLogOutcome,
        error: error instanceof Error ? error.message : String(error),
        // Include lease info when available (Story 7.4.1 AC1)
        ...(decodedLeaseId && { leaseId: decodedLeaseId.uuid, userEmail: decodedLeaseId.userEmail }),
        ...(operatorId && { operator: operatorId }),
      });

      // Log stack trace at DEBUG level per AC4 requirement
      if (error instanceof Error && error.stack) {
        state.logger.debug(`Stack trace for ${correlationId}`, {
          correlationId,
          stack: error.stack,
        });
      }

      return createErrorResponse('Unexpected error, please try again', correlationId);
    }
  };

  /**
   * Allows overriding the ISB Lambda service for testing purposes.
   */
  const setIsbLambdaService = (service: IsbLambdaService): void => {
    state.isbLambdaService = service;
  };

  /**
   * Resets to the default ISB Lambda service (for test cleanup).
   * The service will be lazily re-created on next handler invocation.
   */
  const resetIsbLambdaService = (): void => {
    state.isbLambdaService = null;
  };

  return {
    handler,
    setIsbLambdaService,
    resetIsbLambdaService,
  };
};
