/**
 * Scoring Configuration
 *
 * Parses rule weights from environment variable and loads scoring config.
 */

import { z } from 'zod';
import type { StateMachineLogger } from '../state-machine/orchestrator.js';
import { RULE_IDS, type RuleId, type ScoringEngineConfig } from './types.js';

/**
 * Default threshold for auto-approval.
 * Score must be strictly less than this to auto-approve.
 */
const DEFAULT_THRESHOLD = 20;

/**
 * Zod schema for partial rule weights.
 * Only allows valid rule IDs with numeric values.
 * Uses strict mode to reject unknown keys.
 */
export const RuleWeightsSchema = z
  .object(
    Object.fromEntries(RULE_IDS.map((id) => [id, z.number()])) as Record<RuleId, z.ZodNumber>
  )
  .partial()
  .strict();

/**
 * Parse rule weights from JSON string.
 * Returns empty object on parse error (falls back to defaults).
 *
 * @param json - JSON string containing rule weights
 * @param logger - Logger for warnings
 * @returns Parsed weights or empty object
 */
export const parseRuleWeights = (
  json: string,
  logger: StateMachineLogger
): Partial<Record<RuleId, number>> => {
  try {
    const parsed = JSON.parse(json);
    const result = RuleWeightsSchema.safeParse(parsed);

    if (!result.success) {
      logger.warn('Failed to parse RULE_WEIGHTS, using defaults', {
        error: result.error.message,
      });
      return {};
    }

    if (Object.keys(result.data).length > 0) {
      logger.info('Custom rule weights applied', {
        customWeights: result.data,
      });
    }

    return result.data as Partial<Record<RuleId, number>>;
  } catch (error) {
    logger.warn('Failed to parse RULE_WEIGHTS, using defaults', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
};

/**
 * Load scoring configuration from environment variables.
 *
 * Environment variables:
 * - AUTO_APPROVE_THRESHOLD: Score threshold (default: 20)
 * - RULE_WEIGHTS: JSON string of weight overrides
 *
 * @param logger - Logger for warnings
 * @returns ScoringEngineConfig
 */
export const loadScoringConfig = (logger: StateMachineLogger): ScoringEngineConfig => {
  // Parse threshold
  let threshold = DEFAULT_THRESHOLD;
  const thresholdEnv = process.env.AUTO_APPROVE_THRESHOLD;

  if (thresholdEnv !== undefined) {
    const parsed = parseInt(thresholdEnv, 10);
    if (isNaN(parsed)) {
      logger.warn('Invalid AUTO_APPROVE_THRESHOLD, using default', {
        value: thresholdEnv,
        default: DEFAULT_THRESHOLD,
      });
    } else {
      threshold = parsed;
    }
  }

  // Parse weights
  const weightsEnv = process.env.RULE_WEIGHTS;
  const weights = weightsEnv ? parseRuleWeights(weightsEnv, logger) : {};

  return {
    threshold,
    weights,
  };
};
