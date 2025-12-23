/**
 * Metrics Service (Story 5.3)
 *
 * Provides CloudWatch metrics emission using AWS Lambda Powertools.
 * Emits custom metrics for decisions, scoring, latency, and per-rule triggers.
 */

import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

// Metric names
export const METRIC_NAMES = {
  DECISIONS: 'ApproverDecisions',
  SCORE: 'ApproverScore',
  LATENCY: 'ApproverLatency',
  RULE_TRIGGER: 'ApproverRuleTrigger',
} as const;

// Decision action types
export type DecisionAction =
  | 'approved'
  | 'denied'
  | 'escalated'
  | 'delayed'
  | 'expired'
  | 'error';

// Latency stage types
export type LatencyStage = 'total' | 'scoring' | 'bedrock' | 'domain_lookup';

// Score breakdown type (rule name -> points)
export type ScoreBreakdown = Record<string, number>;

/**
 * Logger interface for metrics service
 */
export interface MetricsLogger {
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
}

/**
 * Metrics service interface
 */
export interface MetricsService {
  /**
   * Record a decision metric
   */
  recordDecision: (action: DecisionAction) => void;

  /**
   * Record a score value metric
   */
  recordScore: (score: number) => void;

  /**
   * Record latency for a specific stage
   */
  recordLatency: (stage: LatencyStage, durationMs: number) => void;

  /**
   * Record rule triggers from score breakdown
   * Only records rules with non-zero contribution
   */
  recordRuleTriggers: (breakdown: ScoreBreakdown) => void;

  /**
   * Publish all stored metrics to CloudWatch
   * Call this at the end of request processing
   */
  publishMetrics: () => void;

  /**
   * Add a custom dimension to all subsequent metrics
   */
  addDimension: (name: string, value: string) => void;

  /**
   * Clear all stored metrics without publishing
   */
  clearMetrics: () => void;
}

// Default namespace for all metrics
const DEFAULT_NAMESPACE = 'Approver';
const DEFAULT_SERVICE_NAME = 'approver';

/**
 * Create a metrics service instance
 */
export const createMetricsService = (
  logger?: MetricsLogger,
  namespace: string = DEFAULT_NAMESPACE,
  serviceName: string = DEFAULT_SERVICE_NAME
): MetricsService => {
  const metrics = new Metrics({
    namespace,
    serviceName,
  });

  const log = logger ?? {
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  return {
    recordDecision: (action: DecisionAction): void => {
      try {
        metrics.addDimension('action', action);
        metrics.addMetric(METRIC_NAMES.DECISIONS, MetricUnit.Count, 1);
        log.info('Recorded decision metric', { action });
      } catch (error) {
        log.warn('Failed to record decision metric', {
          action,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    recordScore: (score: number): void => {
      try {
        metrics.addMetric(METRIC_NAMES.SCORE, MetricUnit.Count, score);
        log.info('Recorded score metric', { score });
      } catch (error) {
        log.warn('Failed to record score metric', {
          score,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    recordLatency: (stage: LatencyStage, durationMs: number): void => {
      try {
        metrics.addDimension('stage', stage);
        metrics.addMetric(METRIC_NAMES.LATENCY, MetricUnit.Milliseconds, durationMs);
        log.info('Recorded latency metric', { stage, durationMs });
      } catch (error) {
        log.warn('Failed to record latency metric', {
          stage,
          durationMs,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    recordRuleTriggers: (breakdown: ScoreBreakdown): void => {
      try {
        const triggeredRules = Object.entries(breakdown).filter(
          ([, points]) => points !== 0
        );

        for (const [ruleName, points] of triggeredRules) {
          metrics.addDimension('rule', ruleName);
          metrics.addMetric(METRIC_NAMES.RULE_TRIGGER, MetricUnit.Count, 1);
          log.info('Recorded rule trigger metric', { ruleName, points });
        }
      } catch (error) {
        log.warn('Failed to record rule trigger metrics', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    publishMetrics: (): void => {
      try {
        metrics.publishStoredMetrics();
        log.info('Published metrics to CloudWatch');
      } catch (error) {
        log.warn('Failed to publish metrics', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    addDimension: (name: string, value: string): void => {
      try {
        metrics.addDimension(name, value);
      } catch (error) {
        log.warn('Failed to add dimension', {
          name,
          value,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    clearMetrics: (): void => {
      try {
        metrics.clearMetrics();
        log.info('Cleared stored metrics');
      } catch (error) {
        log.warn('Failed to clear metrics', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
};

// Export the Metrics class and MetricUnit for testing
export { Metrics, MetricUnit };
