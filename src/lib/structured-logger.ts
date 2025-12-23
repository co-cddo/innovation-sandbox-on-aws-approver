/**
 * Structured Logger (Story 5.3)
 *
 * Provides enhanced structured logging with consistent schema for
 * CloudWatch JSON logs. Wraps AWS Lambda Powertools Logger with
 * domain-specific methods for lease processing.
 */

import { Logger } from '@aws-lambda-powertools/logger';
import type { LogLevel } from '@aws-lambda-powertools/logger/types';

// Decision actions for logging
export type LoggableAction =
  | 'received'
  | 'scoring'
  | 'approved'
  | 'denied'
  | 'escalated'
  | 'delayed'
  | 'expired'
  | 'error';

// Attribution info for audit logs
export interface Attribution {
  approvedBy: string;
  approvalMethod: 'automatic' | 'manual' | 'allow-list';
}

// State transition info
export interface StateTransition {
  from: string;
  to: string;
  durationMs: number;
}

// Decision log parameters
export interface DecisionLogParams {
  action: LoggableAction;
  score: number;
  scoreBreakdown: Record<string, number>;
  attribution: Attribution;
  processingTimeMs: number;
  templateId?: string;
}

// Lease context for correlation
export interface LeaseContext {
  leaseId: string;
  userEmail?: string;
  domain?: string;
  templateId?: string;
}

/**
 * Structured logger interface
 */
export interface StructuredLogger {
  /**
   * Append lease-specific context to all subsequent logs
   */
  appendLeaseContext: (context: Partial<LeaseContext>) => void;

  /**
   * Log a state machine transition with duration
   */
  logStateTransition: (transition: StateTransition) => void;

  /**
   * Log a decision with full audit trail
   */
  logDecision: (params: DecisionLogParams) => void;

  /**
   * Log event received
   */
  logEventReceived: (eventType: string, source?: string) => void;

  /**
   * Log scoring completed
   */
  logScoringCompleted: (
    score: number,
    breakdown: Record<string, number>,
    durationMs: number
  ) => void;

  /**
   * Get the correlation/trace ID
   */
  getTraceId: () => string;

  // Standard logger methods (delegated to Powertools)
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
  debug: (message: string, data?: Record<string, unknown>) => void;
}

/**
 * Create a structured logger instance for a specific request
 */
export const createStructuredLogger = (
  leaseId: string,
  eventId: string,
  serviceName: string = 'approver',
  logLevel?: LogLevel
): StructuredLogger => {
  const logger = new Logger({
    serviceName,
    logLevel: logLevel ?? (process.env.LOG_LEVEL as LogLevel) ?? 'INFO',
  });

  // Generate correlation ID for tracing
  const traceId = `${leaseId}:${eventId}`;

  // Initialize with base context
  logger.appendKeys({
    leaseId,
    eventId,
    traceId,
  });

  return {
    appendLeaseContext: (context: Partial<LeaseContext>): void => {
      const keys: Record<string, string | undefined> = {};
      if (context.userEmail) keys.userEmail = context.userEmail;
      if (context.domain) keys.domain = context.domain;
      if (context.templateId) keys.templateId = context.templateId;
      logger.appendKeys(keys);
    },

    logStateTransition: (transition: StateTransition): void => {
      logger.info('State transition', {
        stateTransition: {
          from: transition.from,
          to: transition.to,
          durationMs: transition.durationMs,
        },
      });
    },

    logDecision: (params: DecisionLogParams): void => {
      logger.info('Decision made', {
        action: params.action,
        score: params.score,
        scoreBreakdown: params.scoreBreakdown,
        attribution: params.attribution,
        processingTimeMs: params.processingTimeMs,
        templateId: params.templateId,
      });
    },

    logEventReceived: (eventType: string, source?: string): void => {
      logger.info('Event received', {
        action: 'received' as LoggableAction,
        eventType,
        source,
      });
    },

    logScoringCompleted: (
      score: number,
      breakdown: Record<string, number>,
      durationMs: number
    ): void => {
      logger.info('Scoring completed', {
        action: 'scoring' as LoggableAction,
        score,
        scoreBreakdown: breakdown,
        scoringDurationMs: durationMs,
      });
    },

    getTraceId: (): string => traceId,

    // Delegate standard methods to Powertools logger
    info: (message: string, data?: Record<string, unknown>): void => {
      if (data) {
        logger.info(message, data);
      } else {
        logger.info(message);
      }
    },

    warn: (message: string, data?: Record<string, unknown>): void => {
      if (data) {
        logger.warn(message, data);
      } else {
        logger.warn(message);
      }
    },

    error: (message: string, data?: Record<string, unknown>): void => {
      if (data) {
        logger.error(message, data);
      } else {
        logger.error(message);
      }
    },

    debug: (message: string, data?: Record<string, unknown>): void => {
      if (data) {
        logger.debug(message, data);
      } else {
        logger.debug(message);
      }
    },
  };
};

/**
 * System attribution for automatic decisions
 */
export const SYSTEM_ATTRIBUTION: Attribution = {
  approvedBy: 'approver-service@system',
  approvalMethod: 'automatic',
};

/**
 * Allow-list attribution for allow-list overrides
 */
export const ALLOWLIST_ATTRIBUTION: Attribution = {
  approvedBy: 'approver-service@system',
  approvalMethod: 'allow-list',
};

/**
 * Create manual attribution for operator decisions
 */
export const createManualAttribution = (operatorEmail: string): Attribution => ({
  approvedBy: operatorEmail,
  approvalMethod: 'manual',
});
