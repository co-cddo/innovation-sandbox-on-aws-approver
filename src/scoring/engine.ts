/**
 * Scoring Engine Orchestrator
 *
 * Runs all 16 rules and returns composite score with breakdown.
 * Uses factory pattern for dependency injection.
 */

import type { StateMachineLogger } from '../state-machine/orchestrator.js';
import {
  DEFAULT_RULE_WEIGHTS,
  type ScoringContext,
  type ScoringResult,
  type ScoringRuleResult,
  type ScoringEngineConfig,
  type RuleId,
} from './types.js';
import { ALL_RULES } from './rules.js';

/**
 * Scoring engine interface.
 */
export interface ScoringEngine {
  /**
   * Calculate the composite score for a lease request.
   * Runs all 16 rules and returns total score with breakdown.
   *
   * @param context - Scoring context with request and history data
   * @returns ScoringResult with totalScore, breakdown, and timing
   */
  calculateScore: (context: ScoringContext) => ScoringResult;
}

/**
 * Create a scoring engine with the given configuration.
 * Uses factory pattern for dependency injection of logger and config.
 *
 * @param config - Scoring engine configuration (weights, threshold)
 * @param logger - Logger for structured logging
 * @returns ScoringEngine instance
 */
export const createScoringEngine = (
  config: ScoringEngineConfig,
  logger: StateMachineLogger
): ScoringEngine => {
  /**
   * Get the weight for a rule, using override or default.
   */
  const getWeight = (ruleId: RuleId): number => {
    return config.weights[ruleId] ?? DEFAULT_RULE_WEIGHTS[ruleId];
  };

  /**
   * Calculate the composite score.
   */
  const calculateScore = (context: ScoringContext): ScoringResult => {
    const startTime = Date.now();
    const breakdown: ScoringRuleResult[] = [];

    // Run all 16 rules
    for (const rule of ALL_RULES) {
      const weight = getWeight(rule.ruleId);
      const result = rule.fn(context, weight);
      breakdown.push(result);
    }

    // Calculate totals
    const totalScore = breakdown.reduce((sum, r) => sum + r.points, 0);
    const durationMs = Date.now() - startTime;

    // Log score breakdown
    const rulesTriggered = breakdown.filter((r) => r.triggered).length;
    const rulesFallback = breakdown.filter((r) => r.fallbackUsed).length;

    logger.info('Score calculated', {
      totalScore,
      durationMs,
      rulesTriggered,
      rulesFallback,
      breakdown: breakdown.map((r) => ({
        ruleId: r.ruleId,
        points: r.points,
        triggered: r.triggered,
        fallbackUsed: r.fallbackUsed,
      })),
    });

    return {
      totalScore,
      breakdown,
      durationMs,
    };
  };

  return { calculateScore };
};
