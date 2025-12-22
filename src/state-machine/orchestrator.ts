/**
 * State Machine Orchestrator
 *
 * Manages state transitions, logging, and error handling.
 * Side effects (EventBridge emission, etc.) are NOT handled here.
 * The orchestrator only manages pure state transitions.
 */

import {
  ApprovalState,
  isTerminalState,
  type StateContext,
  type StateTransition,
  type StateMachineResult,
  type StateMachineConfig,
  type StateHandler,
} from './types.js';
import { createStateHandlers } from './handlers.js';

/**
 * Logger interface for state machine logging.
 * Compatible with AWS Lambda Powertools Logger.
 */
export interface StateMachineLogger {
  info: (message: string, ...extraInput: unknown[]) => void;
  warn: (message: string, ...extraInput: unknown[]) => void;
  error: (message: string, ...extraInput: unknown[]) => void;
}

/**
 * Orchestrator configuration
 */
export interface OrchestratorConfig {
  /** State machine config (thresholds, etc.) */
  stateMachineConfig: StateMachineConfig;
  /** Logger for state transitions */
  logger: StateMachineLogger;
  /** Maximum number of state transitions before forced stop (prevents infinite loops) */
  maxTransitions?: number;
}

/**
 * Default orchestrator configuration
 */
const DEFAULT_ORCHESTRATOR_CONFIG: Omit<OrchestratorConfig, 'logger'> = {
  stateMachineConfig: {
    autoApproveThreshold: 20,
  },
  maxTransitions: 10,
};

/**
 * State Machine Orchestrator
 * Manages the execution of state handlers and tracks transitions.
 */
export interface StateMachineOrchestrator {
  /**
   * Run the state machine from a starting state to completion.
   * @param startState - Initial state to start from (usually RECEIVED)
   * @param initialContext - Initial context with event data
   * @returns Final result with state, context, and success flag
   */
  run: (startState: ApprovalState, initialContext: StateContext) => StateMachineResult;
}

/**
 * Creates a state machine orchestrator with the given configuration.
 * Uses factory pattern for dependency injection of logger and config.
 *
 * @param config - Orchestrator configuration
 * @returns StateMachineOrchestrator instance
 */
export const createStateMachineOrchestrator = (
  config: OrchestratorConfig
): StateMachineOrchestrator => {
  const { stateMachineConfig, logger, maxTransitions = DEFAULT_ORCHESTRATOR_CONFIG.maxTransitions } =
    config;

  // Create handlers with the provided config
  const handlers = createStateHandlers(stateMachineConfig);

  /**
   * Record a state transition with timing
   */
  const recordTransition = (
    context: StateContext,
    from: ApprovalState,
    to: ApprovalState,
    durationMs: number,
    reason?: string
  ): StateContext => ({
    ...context,
    stateHistory: [
      ...context.stateHistory,
      {
        from,
        to,
        timestamp: new Date().toISOString(),
        durationMs,
        reason,
      },
    ],
  });

  /**
   * Log a state transition
   */
  const logTransition = (transition: StateTransition): void => {
    logger.info('State transition', {
      from: transition.from,
      to: transition.to,
      durationMs: transition.durationMs,
      reason: transition.reason,
    });
  };

  /**
   * Run the state machine
   */
  const run = (startState: ApprovalState, initialContext: StateContext): StateMachineResult => {
    let currentState = startState;
    let context = { ...initialContext };
    let transitionCount = 0;

    logger.info('State machine started', {
      startState,
      leaseId: context.leaseId,
      userEmail: context.userEmail,
    });

    // Process states until we reach a terminal state or max transitions
    const effectiveMaxTransitions = maxTransitions as number; // Type assertion safe due to default value
    while (!isTerminalState(currentState) && transitionCount < effectiveMaxTransitions) {
      const handler: StateHandler = handlers[currentState];
      const startTime = Date.now();

      try {
        // Execute the state handler
        const result = handler(context);
        const durationMs = Date.now() - startTime;

        // Determine transition reason
        const reason =
          result.context.error?.message ?? result.context.reason ?? 'State handler completed';

        // Record the transition
        context = recordTransition(result.context, currentState, result.nextState, durationMs, reason);

        // Log the transition (safe to assert - we just added it)
        const lastTransition = context.stateHistory[context.stateHistory.length - 1]!;
        logTransition(lastTransition);

        // Move to next state
        currentState = result.nextState;
        transitionCount++;
      } catch (error) {
        // Unexpected error in state handler - transition to ERROR
        const durationMs = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);

        context = recordTransition(
          {
            ...context,
            error: {
              message: errorMessage,
              code: 'HANDLER_ERROR',
              state: currentState,
            },
          },
          currentState,
          ApprovalState.ERROR,
          durationMs,
          `Handler error: ${errorMessage}`
        );

        logger.error('State handler error', {
          state: currentState,
          error: errorMessage,
          leaseId: context.leaseId,
        });

        currentState = ApprovalState.ERROR;
        transitionCount++;
      }
    }

    // Check for max transitions exceeded
    if (transitionCount >= effectiveMaxTransitions && !isTerminalState(currentState)) {
      logger.warn('Max transitions exceeded', {
        maxTransitions,
        currentState,
        transitionCount,
      });

      context = recordTransition(
        {
          ...context,
          error: {
            message: `Max transitions (${maxTransitions}) exceeded`,
            code: 'MAX_TRANSITIONS',
            state: currentState,
          },
        },
        currentState,
        ApprovalState.ERROR,
        0,
        'Max transitions exceeded'
      );
      currentState = ApprovalState.ERROR;
    }

    const success = isTerminalState(currentState) && currentState !== ApprovalState.ERROR;

    logger.info('State machine completed', {
      finalState: currentState,
      success,
      totalTransitions: context.stateHistory.length,
      decision: context.decision,
      score: context.score,
    });

    return {
      finalState: currentState,
      context,
      success,
    };
  };

  return { run };
};
