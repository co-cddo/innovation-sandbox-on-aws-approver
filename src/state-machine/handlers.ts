/**
 * State Handlers - Pure functions for each state in the approval state machine.
 *
 * Design Principles (per architecture.md):
 * - Single handler per state (pure functions)
 * - Each handler returns { nextState, context }
 * - No side effects - side effects handled by orchestrator
 * - Easy to test without mocks
 */

import {
  ApprovalState,
  type StateContext,
  type StateHandlerResult,
  type StateHandler,
  type StateMachineConfig,
} from './types.js';

/**
 * Default configuration - can be overridden via environment or DI
 */
const DEFAULT_CONFIG: StateMachineConfig = {
  autoApproveThreshold: 20,
};

/**
 * Creates state handlers with the given configuration.
 * Uses factory pattern for dependency injection of config.
 */
export const createStateHandlers = (
  config: StateMachineConfig = DEFAULT_CONFIG
): Record<ApprovalState, StateHandler> => ({
  /**
   * RECEIVED state handler.
   * Initial state - validates that we have a context and transitions to VALIDATING.
   */
  [ApprovalState.RECEIVED]: (context: StateContext): StateHandlerResult => {
    // RECEIVED is just the entry point, immediately transition to VALIDATING
    return {
      nextState: ApprovalState.VALIDATING,
      context: {
        ...context,
        // Context is passed through unchanged - validation happens in VALIDATING
      },
    };
  },

  /**
   * VALIDATING state handler.
   * Validates that required fields are present.
   * In the real implementation, this receives data from the event parsing.
   * Here we just validate that the context has the required data.
   */
  [ApprovalState.VALIDATING]: (context: StateContext): StateHandlerResult => {
    // Validate required fields are present
    if (!context.leaseId || !context.userEmail || !context.templateId) {
      return {
        nextState: ApprovalState.ERROR,
        context: {
          ...context,
          error: {
            message: 'Missing required fields: leaseId, userEmail, or templateId',
            code: 'VALIDATION_ERROR',
            state: ApprovalState.VALIDATING,
          },
        },
      };
    }

    // All validation passed - move to scoring
    return {
      nextState: ApprovalState.SCORING,
      context: {
        ...context,
        // Context validated and ready for scoring
      },
    };
  },

  /**
   * SCORING state handler.
   * Calculates the risk score.
   * STUB: Returns score 0 - full scoring engine comes in Story 2.3.
   */
  [ApprovalState.SCORING]: (context: StateContext): StateHandlerResult => {
    // STUB: Score is always 0 until Story 2.3 implements the scoring engine
    const score = 0;
    const scoreBreakdown = [
      {
        rule: 'stub',
        points: 0,
        triggered: true,
        reason: 'Stub scoring - full engine not implemented',
      },
    ];

    return {
      nextState: ApprovalState.DECIDING,
      context: {
        ...context,
        score,
        scoreBreakdown,
      },
    };
  },

  /**
   * DECIDING state handler.
   * Compares score to threshold and decides approval/denial/escalation.
   */
  [ApprovalState.DECIDING]: (context: StateContext): StateHandlerResult => {
    const { score, requiresManualApproval } = context;
    const threshold = config.autoApproveThreshold;

    // If manual approval was explicitly requested, escalate
    if (requiresManualApproval) {
      return {
        nextState: ApprovalState.ESCALATED,
        context: {
          ...context,
          decision: 'escalated',
          reason: 'Manual approval requested by user',
        },
      };
    }

    // Compare score to threshold
    if (score < threshold) {
      // Auto-approve
      return {
        nextState: ApprovalState.APPROVED,
        context: {
          ...context,
          decision: 'approved',
          approvedBy: 'approver-service@system',
          reason: `Score ${score} below threshold ${threshold}`,
        },
      };
    } else {
      // Escalate for manual review
      return {
        nextState: ApprovalState.ESCALATED,
        context: {
          ...context,
          decision: 'escalated',
          reason: `Score ${score} meets or exceeds threshold ${threshold}`,
        },
      };
    }
  },

  /**
   * APPROVED state handler.
   * Terminal state - no further transitions.
   */
  [ApprovalState.APPROVED]: (context: StateContext): StateHandlerResult => {
    // Terminal state - return same state
    return {
      nextState: ApprovalState.APPROVED,
      context: {
        ...context,
        decision: context.decision ?? 'approved',
        approvedBy: context.approvedBy ?? 'approver-service@system',
      },
    };
  },

  /**
   * DENIED state handler.
   * Terminal state - no further transitions.
   */
  [ApprovalState.DENIED]: (context: StateContext): StateHandlerResult => {
    // Terminal state - return same state
    return {
      nextState: ApprovalState.DENIED,
      context: {
        ...context,
        decision: 'denied',
      },
    };
  },

  /**
   * ESCALATED state handler.
   * Terminal state - no further transitions.
   */
  [ApprovalState.ESCALATED]: (context: StateContext): StateHandlerResult => {
    // Terminal state - return same state
    return {
      nextState: ApprovalState.ESCALATED,
      context: {
        ...context,
        decision: 'escalated',
      },
    };
  },

  /**
   * ERROR state handler.
   * Terminal state - captures error details for investigation.
   */
  [ApprovalState.ERROR]: (context: StateContext): StateHandlerResult => {
    // Terminal state - return same state with error preserved
    return {
      nextState: ApprovalState.ERROR,
      context: {
        ...context,
        // Error should already be set by the transition that led here
      },
    };
  },
});

/**
 * Get the handler for a specific state.
 * Convenience function for orchestrator use.
 */
export const getStateHandler = (
  state: ApprovalState,
  config: StateMachineConfig = DEFAULT_CONFIG
): StateHandler => {
  const handlers = createStateHandlers(config);
  return handlers[state];
};
