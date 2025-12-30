/**
 * Metrics Service Tests (Story 5.3)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createMetricsService,
  METRIC_NAMES,
  type MetricsLogger,
} from '../../src/services/metrics.js';

// Use vi.hoisted() for Vitest v4 compatibility
const { mockAddMetric, mockAddDimension, mockPublishStoredMetrics, mockClearMetrics } = vi.hoisted(
  () => ({
    mockAddMetric: vi.fn(),
    mockAddDimension: vi.fn(),
    mockPublishStoredMetrics: vi.fn(),
    mockClearMetrics: vi.fn(),
  })
);

vi.mock('@aws-lambda-powertools/metrics', () => ({
  Metrics: class MockMetrics {
    addMetric = mockAddMetric;
    addDimension = mockAddDimension;
    publishStoredMetrics = mockPublishStoredMetrics;
    clearMetrics = mockClearMetrics;
  },
  MetricUnit: {
    Count: 'Count',
    Milliseconds: 'Milliseconds',
  },
}));

describe('Metrics Service (Story 5.3)', () => {
  // Mock logger
  const createMockLogger = (): MetricsLogger => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createMetricsService', () => {
    it('should create a metrics service with default options', () => {
      const service = createMetricsService();
      expect(service).toBeDefined();
      expect(typeof service.recordDecision).toBe('function');
      expect(typeof service.recordScore).toBe('function');
      expect(typeof service.recordLatency).toBe('function');
      expect(typeof service.recordRuleTriggers).toBe('function');
      expect(typeof service.publishMetrics).toBe('function');
    });

    it('should accept custom logger', () => {
      const logger = createMockLogger();
      const service = createMetricsService(logger);
      service.recordDecision('approved');
      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe('recordDecision (AC2)', () => {
    it('should record approved decision metric', () => {
      const logger = createMockLogger();
      const service = createMetricsService(logger);

      service.recordDecision('approved');

      expect(mockAddDimension).toHaveBeenCalledWith('action', 'approved');
      expect(mockAddMetric).toHaveBeenCalledWith(METRIC_NAMES.DECISIONS, 'Count', 1);
      expect(logger.info).toHaveBeenCalledWith('Recorded decision metric', {
        action: 'approved',
      });
    });

    it('should record escalated decision metric', () => {
      const service = createMetricsService();
      service.recordDecision('escalated');
      expect(mockAddDimension).toHaveBeenCalledWith('action', 'escalated');
      expect(mockAddMetric).toHaveBeenCalledWith(METRIC_NAMES.DECISIONS, 'Count', 1);
    });

    it('should record delayed decision metric', () => {
      const service = createMetricsService();
      service.recordDecision('delayed');
      expect(mockAddDimension).toHaveBeenCalledWith('action', 'delayed');
    });

    it('should record denied decision metric', () => {
      const service = createMetricsService();
      service.recordDecision('denied');
      expect(mockAddDimension).toHaveBeenCalledWith('action', 'denied');
    });

    it('should record expired decision metric', () => {
      const service = createMetricsService();
      service.recordDecision('expired');
      expect(mockAddDimension).toHaveBeenCalledWith('action', 'expired');
    });

    it('should record error decision metric', () => {
      const service = createMetricsService();
      service.recordDecision('error');
      expect(mockAddDimension).toHaveBeenCalledWith('action', 'error');
    });

    it('should handle metric recording errors gracefully', () => {
      mockAddDimension.mockImplementationOnce(() => {
        throw new Error('Metrics error');
      });
      const logger = createMockLogger();
      const service = createMetricsService(logger);

      // Should not throw
      service.recordDecision('approved');

      expect(logger.warn).toHaveBeenCalledWith('Failed to record decision metric', {
        action: 'approved',
        error: 'Metrics error',
      });
    });
  });

  describe('recordScore (AC2)', () => {
    it('should record score value metric', () => {
      const logger = createMockLogger();
      const service = createMetricsService(logger);

      service.recordScore(25);

      expect(mockAddMetric).toHaveBeenCalledWith(METRIC_NAMES.SCORE, 'Count', 25);
      expect(logger.info).toHaveBeenCalledWith('Recorded score metric', { score: 25 });
    });

    it('should record zero score', () => {
      const service = createMetricsService();
      service.recordScore(0);
      expect(mockAddMetric).toHaveBeenCalledWith(METRIC_NAMES.SCORE, 'Count', 0);
    });

    it('should record negative score', () => {
      const service = createMetricsService();
      service.recordScore(-5);
      expect(mockAddMetric).toHaveBeenCalledWith(METRIC_NAMES.SCORE, 'Count', -5);
    });

    it('should handle score recording errors gracefully', () => {
      mockAddMetric.mockImplementationOnce(() => {
        throw new Error('Score error');
      });
      const logger = createMockLogger();
      const service = createMetricsService(logger);

      service.recordScore(15);

      expect(logger.warn).toHaveBeenCalledWith('Failed to record score metric', {
        score: 15,
        error: 'Score error',
      });
    });
  });

  describe('recordLatency (AC2)', () => {
    it('should record total latency metric', () => {
      const logger = createMockLogger();
      const service = createMetricsService(logger);

      service.recordLatency('total', 1500);

      expect(mockAddDimension).toHaveBeenCalledWith('stage', 'total');
      expect(mockAddMetric).toHaveBeenCalledWith(METRIC_NAMES.LATENCY, 'Milliseconds', 1500);
      expect(logger.info).toHaveBeenCalledWith('Recorded latency metric', {
        stage: 'total',
        durationMs: 1500,
      });
    });

    it('should record scoring latency metric', () => {
      const service = createMetricsService();
      service.recordLatency('scoring', 200);
      expect(mockAddDimension).toHaveBeenCalledWith('stage', 'scoring');
      expect(mockAddMetric).toHaveBeenCalledWith(METRIC_NAMES.LATENCY, 'Milliseconds', 200);
    });

    it('should record bedrock latency metric', () => {
      const service = createMetricsService();
      service.recordLatency('bedrock', 800);
      expect(mockAddDimension).toHaveBeenCalledWith('stage', 'bedrock');
      expect(mockAddMetric).toHaveBeenCalledWith(METRIC_NAMES.LATENCY, 'Milliseconds', 800);
    });

    it('should record domain_lookup latency metric', () => {
      const service = createMetricsService();
      service.recordLatency('domain_lookup', 50);
      expect(mockAddDimension).toHaveBeenCalledWith('stage', 'domain_lookup');
    });

    it('should handle latency recording errors gracefully', () => {
      mockAddDimension.mockImplementationOnce(() => {
        throw new Error('Latency error');
      });
      const logger = createMockLogger();
      const service = createMetricsService(logger);

      service.recordLatency('total', 1000);

      expect(logger.warn).toHaveBeenCalledWith('Failed to record latency metric', {
        stage: 'total',
        durationMs: 1000,
        error: 'Latency error',
      });
    });
  });

  describe('recordRuleTriggers (AC3)', () => {
    it('should record metrics for triggered rules', () => {
      const logger = createMockLogger();
      const service = createMetricsService(logger);

      const breakdown = {
        first_time_user: 5,
        group_mailbox_detected: 20,
      };

      service.recordRuleTriggers(breakdown);

      expect(mockAddDimension).toHaveBeenCalledWith('rule', 'first_time_user');
      expect(mockAddDimension).toHaveBeenCalledWith('rule', 'group_mailbox_detected');
      expect(mockAddMetric).toHaveBeenCalledWith(METRIC_NAMES.RULE_TRIGGER, 'Count', 1);
      expect(logger.info).toHaveBeenCalledWith('Recorded rule trigger metric', {
        ruleName: 'first_time_user',
        points: 5,
      });
    });

    it('should filter out zero-value rules', () => {
      const service = createMetricsService();

      const breakdown = {
        triggered_rule: 5,
        zero_rule: 0,
        another_triggered: -3,
      };

      service.recordRuleTriggers(breakdown);

      expect(mockAddDimension).toHaveBeenCalledWith('rule', 'triggered_rule');
      expect(mockAddDimension).toHaveBeenCalledWith('rule', 'another_triggered');
      expect(mockAddDimension).not.toHaveBeenCalledWith('rule', 'zero_rule');
    });

    it('should handle negative rule values', () => {
      const service = createMetricsService();

      const breakdown = {
        verified_gov_domain: -5,
      };

      service.recordRuleTriggers(breakdown);

      expect(mockAddDimension).toHaveBeenCalledWith('rule', 'verified_gov_domain');
      expect(mockAddMetric).toHaveBeenCalledWith(METRIC_NAMES.RULE_TRIGGER, 'Count', 1);
    });

    it('should handle empty breakdown', () => {
      const logger = createMockLogger();
      const service = createMetricsService(logger);

      service.recordRuleTriggers({});

      // Should not call addDimension for rule when breakdown is empty
      expect(mockAddDimension).not.toHaveBeenCalledWith('rule', expect.any(String));
    });

    it('should handle all-zero breakdown', () => {
      const service = createMetricsService();

      const breakdown = {
        rule1: 0,
        rule2: 0,
      };

      service.recordRuleTriggers(breakdown);

      expect(mockAddDimension).not.toHaveBeenCalledWith('rule', expect.any(String));
    });

    it('should handle rule trigger recording errors gracefully', () => {
      mockAddDimension.mockImplementationOnce(() => {
        throw new Error('Rule error');
      });
      const logger = createMockLogger();
      const service = createMetricsService(logger);

      service.recordRuleTriggers({ test_rule: 5 });

      expect(logger.warn).toHaveBeenCalledWith('Failed to record rule trigger metrics', {
        error: 'Rule error',
      });
    });
  });

  describe('publishMetrics', () => {
    it('should publish stored metrics', () => {
      const logger = createMockLogger();
      const service = createMetricsService(logger);

      service.publishMetrics();

      expect(mockPublishStoredMetrics).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('Published metrics to CloudWatch');
    });

    it('should handle publish errors gracefully', () => {
      mockPublishStoredMetrics.mockImplementationOnce(() => {
        throw new Error('Publish error');
      });
      const logger = createMockLogger();
      const service = createMetricsService(logger);

      service.publishMetrics();

      expect(logger.warn).toHaveBeenCalledWith('Failed to publish metrics', {
        error: 'Publish error',
      });
    });
  });

  describe('addDimension', () => {
    it('should add custom dimension', () => {
      const service = createMetricsService();

      service.addDimension('environment', 'production');

      expect(mockAddDimension).toHaveBeenCalledWith('environment', 'production');
    });

    it('should handle dimension errors gracefully', () => {
      mockAddDimension.mockImplementationOnce(() => {
        throw new Error('Dimension error');
      });
      const logger = createMockLogger();
      const service = createMetricsService(logger);

      service.addDimension('test', 'value');

      expect(logger.warn).toHaveBeenCalledWith('Failed to add dimension', {
        name: 'test',
        value: 'value',
        error: 'Dimension error',
      });
    });
  });

  describe('clearMetrics', () => {
    it('should clear stored metrics', () => {
      const logger = createMockLogger();
      const service = createMetricsService(logger);

      service.clearMetrics();

      expect(mockClearMetrics).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('Cleared stored metrics');
    });

    it('should handle clear errors gracefully', () => {
      mockClearMetrics.mockImplementationOnce(() => {
        throw new Error('Clear error');
      });
      const logger = createMockLogger();
      const service = createMetricsService(logger);

      service.clearMetrics();

      expect(logger.warn).toHaveBeenCalledWith('Failed to clear metrics', {
        error: 'Clear error',
      });
    });
  });

  describe('Non-Error exception handling', () => {
    it('should handle non-Error in recordDecision', () => {
      mockAddDimension.mockImplementationOnce(() => {
        throw 'String error'; // Non-Error exception
      });
      const logger = createMockLogger();
      const service = createMetricsService(logger);

      service.recordDecision('approved');

      expect(logger.warn).toHaveBeenCalledWith('Failed to record decision metric', {
        action: 'approved',
        error: 'String error',
      });
    });

    it('should handle non-Error in recordScore', () => {
      mockAddMetric.mockImplementationOnce(() => {
        throw { custom: 'error object' }; // Non-Error exception
      });
      const logger = createMockLogger();
      const service = createMetricsService(logger);

      service.recordScore(10);

      expect(logger.warn).toHaveBeenCalledWith('Failed to record score metric', {
        score: 10,
        error: '[object Object]',
      });
    });

    it('should handle non-Error in recordLatency', () => {
      mockAddDimension.mockImplementationOnce(() => {
        throw 42; // Non-Error exception (number)
      });
      const logger = createMockLogger();
      const service = createMetricsService(logger);

      service.recordLatency('total', 1000);

      expect(logger.warn).toHaveBeenCalledWith('Failed to record latency metric', {
        stage: 'total',
        durationMs: 1000,
        error: '42',
      });
    });

    it('should handle non-Error in recordRuleTriggers', () => {
      mockAddDimension.mockImplementationOnce(() => {
        throw null; // Non-Error exception (null)
      });
      const logger = createMockLogger();
      const service = createMetricsService(logger);

      service.recordRuleTriggers({ test_rule: 5 });

      expect(logger.warn).toHaveBeenCalledWith('Failed to record rule trigger metrics', {
        error: 'null',
      });
    });

    it('should handle non-Error in publishMetrics', () => {
      mockPublishStoredMetrics.mockImplementationOnce(() => {
        throw undefined; // Non-Error exception (undefined)
      });
      const logger = createMockLogger();
      const service = createMetricsService(logger);

      service.publishMetrics();

      expect(logger.warn).toHaveBeenCalledWith('Failed to publish metrics', {
        error: 'undefined',
      });
    });

    it('should handle non-Error in addDimension', () => {
      mockAddDimension.mockImplementationOnce(() => {
        throw 'dimension error';
      });
      const logger = createMockLogger();
      const service = createMetricsService(logger);

      service.addDimension('test', 'value');

      expect(logger.warn).toHaveBeenCalledWith('Failed to add dimension', {
        name: 'test',
        value: 'value',
        error: 'dimension error',
      });
    });

    it('should handle non-Error in clearMetrics', () => {
      mockClearMetrics.mockImplementationOnce(() => {
        throw 'clear error string';
      });
      const logger = createMockLogger();
      const service = createMetricsService(logger);

      service.clearMetrics();

      expect(logger.warn).toHaveBeenCalledWith('Failed to clear metrics', {
        error: 'clear error string',
      });
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete request flow', () => {
      const logger = createMockLogger();
      const service = createMetricsService(logger);

      // Record decision
      service.recordDecision('approved');

      // Record score
      service.recordScore(15);

      // Record latencies
      service.recordLatency('total', 2000);
      service.recordLatency('scoring', 150);
      service.recordLatency('bedrock', 800);

      // Record rule triggers
      service.recordRuleTriggers({
        first_time_user: 5,
        verified_gov_domain: -5,
        group_mailbox: 15,
      });

      // Publish all metrics
      service.publishMetrics();

      expect(mockPublishStoredMetrics).toHaveBeenCalled();
      expect(mockAddMetric).toHaveBeenCalled();
    });
  });
});
