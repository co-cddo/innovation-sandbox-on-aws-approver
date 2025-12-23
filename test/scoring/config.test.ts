/**
 * Tests for scoring configuration parsing and loading.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseRuleWeights,
  loadScoringConfig,
  RuleWeightsSchema,
} from '../../src/scoring/config.js';
import type { StateMachineLogger } from '../../src/state-machine/orchestrator.js';

// Create mock logger
const createMockLogger = (): StateMachineLogger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe('scoring config', () => {
  describe('RuleWeightsSchema', () => {
    it('should validate valid weights object', () => {
      const weights = { first_time_user: 10, budget_amount: 2 };
      const result = RuleWeightsSchema.safeParse(weights);
      expect(result.success).toBe(true);
    });

    it('should reject invalid rule IDs', () => {
      const weights = { invalid_rule: 10 };
      const result = RuleWeightsSchema.safeParse(weights);
      expect(result.success).toBe(false);
    });

    it('should reject non-number values', () => {
      const weights = { first_time_user: 'ten' };
      const result = RuleWeightsSchema.safeParse(weights);
      expect(result.success).toBe(false);
    });

    it('should allow empty object', () => {
      const result = RuleWeightsSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should allow partial weights', () => {
      const weights = { first_time_user: 10 };
      const result = RuleWeightsSchema.safeParse(weights);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.first_time_user).toBe(10);
      }
    });
  });

  describe('parseRuleWeights', () => {
    let mockLogger: StateMachineLogger;

    beforeEach(() => {
      mockLogger = createMockLogger();
    });

    it('should parse valid JSON weights', () => {
      const json = '{"first_time_user": 10, "budget_amount": 2}';
      const result = parseRuleWeights(json, mockLogger);

      expect(result.first_time_user).toBe(10);
      expect(result.budget_amount).toBe(2);
    });

    it('should return empty object for empty JSON', () => {
      const result = parseRuleWeights('{}', mockLogger);
      expect(result).toEqual({});
    });

    it('should return empty object for invalid JSON and log warning', () => {
      const result = parseRuleWeights('not valid json', mockLogger);

      expect(result).toEqual({});
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to parse RULE_WEIGHTS, using defaults',
        expect.objectContaining({
          error: expect.any(String),
        })
      );
    });

    it('should return empty object for invalid weights schema and log warning', () => {
      const json = '{"invalid_rule": 10}';
      const result = parseRuleWeights(json, mockLogger);

      expect(result).toEqual({});
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to parse RULE_WEIGHTS, using defaults',
        expect.objectContaining({
          error: expect.any(String),
        })
      );
    });

    it('should log info when custom weights applied', () => {
      const json = '{"first_time_user": 10}';
      parseRuleWeights(json, mockLogger);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Custom rule weights applied',
        expect.objectContaining({
          customWeights: { first_time_user: 10 },
        })
      );
    });

    it('should handle non-Error exceptions gracefully', () => {
      // Mock JSON.parse to throw a non-Error value (string)
      const originalParse = JSON.parse;
      JSON.parse = () => {
        throw 'string error'; // Not an Error object
      };

      try {
        const result = parseRuleWeights('{}', mockLogger);

        expect(result).toEqual({});
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Failed to parse RULE_WEIGHTS, using defaults',
          expect.objectContaining({
            error: 'string error', // String(error) was used
          })
        );
      } finally {
        JSON.parse = originalParse;
      }
    });

    it('should not log info for empty weights', () => {
      parseRuleWeights('{}', mockLogger);

      expect(mockLogger.info).not.toHaveBeenCalledWith(
        'Custom rule weights applied',
        expect.any(Object)
      );
    });
  });

  describe('loadScoringConfig', () => {
    let mockLogger: StateMachineLogger;
    const originalEnv = process.env;

    beforeEach(() => {
      mockLogger = createMockLogger();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should use default threshold when AUTO_APPROVE_THRESHOLD not set', () => {
      delete process.env.AUTO_APPROVE_THRESHOLD;
      delete process.env.RULE_WEIGHTS;

      const config = loadScoringConfig(mockLogger);

      expect(config.threshold).toBe(20);
    });

    it('should parse AUTO_APPROVE_THRESHOLD from environment', () => {
      process.env.AUTO_APPROVE_THRESHOLD = '30';
      delete process.env.RULE_WEIGHTS;

      const config = loadScoringConfig(mockLogger);

      expect(config.threshold).toBe(30);
    });

    it('should use default threshold for invalid AUTO_APPROVE_THRESHOLD', () => {
      process.env.AUTO_APPROVE_THRESHOLD = 'not-a-number';
      delete process.env.RULE_WEIGHTS;

      const config = loadScoringConfig(mockLogger);

      expect(config.threshold).toBe(20);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Invalid AUTO_APPROVE_THRESHOLD, using default',
        expect.objectContaining({
          value: 'not-a-number',
          default: 20,
        })
      );
    });

    it('should parse RULE_WEIGHTS from environment', () => {
      process.env.RULE_WEIGHTS = '{"first_time_user": 15}';
      delete process.env.AUTO_APPROVE_THRESHOLD;

      const config = loadScoringConfig(mockLogger);

      expect(config.weights.first_time_user).toBe(15);
    });

    it('should use empty weights when RULE_WEIGHTS not set', () => {
      delete process.env.RULE_WEIGHTS;
      delete process.env.AUTO_APPROVE_THRESHOLD;

      const config = loadScoringConfig(mockLogger);

      expect(config.weights).toEqual({});
    });

    it('should return complete config with both settings', () => {
      process.env.AUTO_APPROVE_THRESHOLD = '25';
      process.env.RULE_WEIGHTS = '{"budget_amount": 3}';

      const config = loadScoringConfig(mockLogger);

      expect(config.threshold).toBe(25);
      expect(config.weights.budget_amount).toBe(3);
    });
  });
});
