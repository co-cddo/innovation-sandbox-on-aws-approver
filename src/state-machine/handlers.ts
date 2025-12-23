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
  type RuleResult,
} from './types.js';
import {
  createScoringContext,
  createScoringEngine,
  type ScoringEngine,
} from '../scoring/index.js';
import type { StateMachineLogger } from './orchestrator.js';
import { isAllowListed } from '../lib/allow-list.js';

/**
 * Default configuration - can be overridden via environment or DI
 */
const DEFAULT_CONFIG: StateMachineConfig = {
  autoApproveThreshold: 20,
};

/**
 * Create a no-op logger for default case.
 */
const createNoOpLogger = (): StateMachineLogger => ({
  info: () => {},
  warn: () => {},
  error: () => {},
});

/**
 * Handler configuration options.
 */
export interface HandlerConfig {
  /** State machine config (threshold) */
  stateMachineConfig?: StateMachineConfig;
  /** Optional scoring engine (created internally if not provided) */
  scoringEngine?: ScoringEngine;
  /** Logger for scoring engine */
  logger?: StateMachineLogger;
}

/**
 * Creates state handlers with the given configuration.
 * Uses factory pattern for dependency injection of config.
 */
export const createStateHandlers = (
  config: StateMachineConfig | HandlerConfig = DEFAULT_CONFIG
): Record<ApprovalState, StateHandler> => {
  // Normalize config to HandlerConfig
  const handlerConfig: HandlerConfig =
    'autoApproveThreshold' in config ? { stateMachineConfig: config } : config;

  const stateMachineConfig = handlerConfig.stateMachineConfig ?? DEFAULT_CONFIG;
  const logger = handlerConfig.logger ?? createNoOpLogger();

  // Create scoring engine if not provided
  const scoringEngine =
    handlerConfig.scoringEngine ??
    createScoringEngine(
      {
        weights: {},
        threshold: stateMachineConfig.autoApproveThreshold,
      },
      logger
    );

  return {
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

    // All validation passed - move to timing check
    return {
      nextState: ApprovalState.TIMING_CHECK,
      context: {
        ...context,
        // Context validated and ready for timing check
      },
    };
  },

  /**
   * TIMING_CHECK state handler.
   * Checks if request is within business hours.
   * Business hours data is pre-populated in context by the handler before state machine runs.
   */
  [ApprovalState.TIMING_CHECK]: (context: StateContext): StateHandlerResult => {
    const { isWithinBusinessHours, nextProcessingTime } = context;

    // If timing hasn't been checked yet (undefined), proceed to allow-list
    // This allows backwards compatibility and testing without timing setup
    if (isWithinBusinessHours === undefined || isWithinBusinessHours === true) {
      // Within business hours - proceed to allow-list check
      return {
        nextState: ApprovalState.ALLOW_LIST_CHECK,
        context: {
          ...context,
          reason: isWithinBusinessHours === undefined
            ? 'Business hours not checked - proceeding'
            : 'Within business hours',
        },
      };
    }

    // Outside business hours - delay the request
    return {
      nextState: ApprovalState.DELAYED,
      context: {
        ...context,
        decision: 'delayed',
        reason: `Outside business hours. Next processing: ${nextProcessingTime ?? 'unknown'}`,
      },
    };
  },

  /**
   * ALLOW_LIST_CHECK state handler.
   * Checks if the user email is in the allow-list for auto-approval bypass.
   * If allow-listed, skips scoring and goes directly to APPROVED.
   */
  [ApprovalState.ALLOW_LIST_CHECK]: (context: StateContext): StateHandlerResult => {
    const { userEmail } = context;

    if (isAllowListed(userEmail)) {
      // Allow-listed user - bypass scoring and auto-approve
      return {
        nextState: ApprovalState.APPROVED,
        context: {
          ...context,
          score: 0, // Score set to 0 for reference
          decision: 'approved',
          approvedBy: 'ndx+try-automated-approver@dsit.gov.uk',
          reason: 'ALLOW-LIST-OVERRIDE',
          allowListOverride: true,
        },
      };
    }

    // Not allow-listed - proceed to scoring
    return {
      nextState: ApprovalState.SCORING,
      context: {
        ...context,
        allowListOverride: false,
      },
    };
  },

  /**
   * SCORING state handler.
   * Calculates the risk score using the 18-rule scoring engine.
   */
  [ApprovalState.SCORING]: (context: StateContext): StateHandlerResult => {
    // Create scoring context from state context
    const scoringContext = createScoringContext({
      leaseId: context.leaseId,
      userEmail: context.userEmail,
      templateId: context.templateId,
      budgetAmount: context.budgetAmount,
      leaseDurationHours: context.leaseDurationHours,
      requestTimestamp: new Date(), // Use current time for scoring
      // Real history data from handler (Story 3.1 user, Story 3.2 org)
      userLeaseHistory: context.userLeaseHistory,
      orgLeaseHistory: context.orgLeaseHistory,
      // Domain verification from S3 cache (Story 3.3)
      isVerifiedGovDomain: context.isVerifiedGovDomain,
      // AI analysis from Bedrock or fallback (Story 3.4)
      aiAnalysis: context.aiAnalysis,
      // Business hours data (Story 4.1) - pass pre-calculated value
      isEndOfWindow: context.isEndOfWindow,
    });

    // Run the scoring engine
    const result = scoringEngine.calculateScore(scoringContext);

    // Convert ScoringRuleResult to RuleResult for state context
    const scoreBreakdown: RuleResult[] = result.breakdown.map((r) => ({
      rule: r.ruleId,
      points: r.points,
      triggered: r.triggered,
      reason: r.reason,
    }));

    return {
      nextState: ApprovalState.DECIDING,
      context: {
        ...context,
        score: result.totalScore,
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
    const threshold = stateMachineConfig.autoApproveThreshold;

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
          approvedBy: 'ndx+try-automated-approver@dsit.gov.uk',
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
        approvedBy: context.approvedBy ?? 'ndx+try-automated-approver@dsit.gov.uk',
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
   * DELAYED state handler.
   * Terminal state for out-of-hours requests.
   * The request will be sent to SQS delay queue by the main handler.
   */
  [ApprovalState.DELAYED]: (context: StateContext): StateHandlerResult => {
    // Terminal state - return same state
    return {
      nextState: ApprovalState.DELAYED,
      context: {
        ...context,
        decision: 'delayed',
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
};};

/**
 * Get the handler for a specific state.
 * Convenience function for orchestrator use.
 */
export const getStateHandler = (
  state: ApprovalState,
  config: StateMachineConfig | HandlerConfig = DEFAULT_CONFIG
): StateHandler => {
  const handlers = createStateHandlers(config);
  return handlers[state];
};
