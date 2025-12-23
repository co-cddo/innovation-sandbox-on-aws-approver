/**
 * Tests for scoring engine orchestrator.
 * Verifies full scoring flow, timing, and logging.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createScoringEngine } from '../../src/scoring/engine.js';
import { createScoringContext, type ScoringEngineConfig } from '../../src/scoring/types.js';
import type { StateMachineLogger } from '../../src/state-machine/orchestrator.js';

// Create mock logger
const createMockLogger = (): StateMachineLogger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe('scoring engine', () => {
  let mockLogger: StateMachineLogger;

  beforeEach(() => {
    mockLogger = createMockLogger();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createScoringEngine', () => {
    it('should create engine with config and logger', () => {
      const config: ScoringEngineConfig = {
        weights: {},
        threshold: 20,
      };
      const engine = createScoringEngine(config, mockLogger);
      expect(engine.calculateScore).toBeInstanceOf(Function);
    });
  });

  describe('calculateScore', () => {
    it('should run all 18 rules and return breakdown', () => {
      const config: ScoringEngineConfig = {
        weights: {},
        threshold: 20,
      };
      const engine = createScoringEngine(config, mockLogger);

      const context = createScoringContext({
        leaseId: 'test-123',
        userEmail: 'user@example.gov.uk',
        templateId: 'web-hosting',
        budgetAmount: 100,
        leaseDurationHours: 24,
        requestTimestamp: new Date('2025-01-15T14:00:00Z'),
      });

      const result = engine.calculateScore(context);

      expect(result.breakdown).toHaveLength(18);
      expect(typeof result.totalScore).toBe('number');
      expect(typeof result.durationMs).toBe('number');
    });

    it('should calculate expected score for first-time user with default weights', () => {
      const config: ScoringEngineConfig = {
        weights: {},
        threshold: 20,
      };
      const engine = createScoringEngine(config, mockLogger);

      const context = createScoringContext({
        leaseId: 'test-123',
        userEmail: 'user@example.gov.uk',
        templateId: 'web-hosting',
        budgetAmount: 100, // 10 units * 1 = 10
        leaseDurationHours: 24, // 3 units * 1 = 3
        requestTimestamp: new Date('2025-01-15T14:00:00Z'), // Not end of window
        isVerifiedGovDomain: true, // Verified domain
        orgLeaseHistory: [
          { uuid: 'recent', userEmail: 'other@example.gov.uk', status: 'Expired', originalLeaseTemplateUuid: 'x', created: '2025-01-10T10:00:00Z' },
        ], // Recent negative prevents org_clean_record bonus
      });

      const result = engine.calculateScore(context);

      // first_time_user: +5
      // verified_gov_domain: -5 (gov domain bonus)
      // budget_amount: +10 (100/10 = 10 units)
      // duration_requested: +3 (24/8 = 3 units)
      // org_recent_negative: +3 (recent expired lease)
      // Total expected: 16
      expect(result.totalScore).toBe(16);
    });

    it('should use default weights when not overridden', () => {
      const config: ScoringEngineConfig = {
        weights: {},
        threshold: 20,
      };
      const engine = createScoringEngine(config, mockLogger);

      const context = createScoringContext({
        leaseId: 'test-123',
        userEmail: 'user@example.gov.uk',
        templateId: 'web-hosting',
        budgetAmount: 10, // 1 unit
        leaseDurationHours: 8, // 1 unit
        requestTimestamp: new Date('2025-01-15T14:00:00Z'),
        isVerifiedGovDomain: true, // Verified domain
        orgLeaseHistory: [
          { uuid: 'recent', userEmail: 'other@example.gov.uk', status: 'Expired', originalLeaseTemplateUuid: 'x', created: '2025-01-10T10:00:00Z' },
        ],
      });

      const result = engine.calculateScore(context);

      // first_time_user: +5
      // verified_gov_domain: -5
      // budget_amount: +1
      // duration_requested: +1
      // org_recent_negative: +3
      // Total: 5
      expect(result.totalScore).toBe(5);
    });

    it('should override default weights with custom weights', () => {
      const config: ScoringEngineConfig = {
        weights: {
          first_time_user: 10, // Override from 5 to 10
        },
        threshold: 20,
      };
      const engine = createScoringEngine(config, mockLogger);

      const context = createScoringContext({
        leaseId: 'test-123',
        userEmail: 'user@example.gov.uk',
        templateId: 'web-hosting',
        budgetAmount: 10, // 1 unit
        leaseDurationHours: 8, // 1 unit
        requestTimestamp: new Date('2025-01-15T14:00:00Z'),
        isVerifiedGovDomain: true,
        orgLeaseHistory: [
          { uuid: 'recent', userEmail: 'other@example.gov.uk', status: 'Expired', originalLeaseTemplateUuid: 'x', created: '2025-01-10T10:00:00Z' },
        ],
      });

      const result = engine.calculateScore(context);

      // first_time_user: +10 (overridden)
      // verified_gov_domain: -5
      // budget_amount: +1
      // duration_requested: +1
      // org_recent_negative: +3
      // Total: 10
      expect(result.totalScore).toBe(10);
    });

    it('should include timing in result', () => {
      const config: ScoringEngineConfig = {
        weights: {},
        threshold: 20,
      };
      const engine = createScoringEngine(config, mockLogger);

      const context = createScoringContext({
        leaseId: 'test-123',
        userEmail: 'user@example.gov.uk',
        templateId: 'web-hosting',
        budgetAmount: 100,
        leaseDurationHours: 24,
        requestTimestamp: new Date(),
      });

      const result = engine.calculateScore(context);

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.durationMs).toBeLessThan(2000); // <2s per AC6
    });

    it('should log score breakdown', () => {
      const config: ScoringEngineConfig = {
        weights: {},
        threshold: 20,
      };
      const engine = createScoringEngine(config, mockLogger);

      const context = createScoringContext({
        leaseId: 'test-123',
        userEmail: 'user@example.gov.uk',
        templateId: 'web-hosting',
        budgetAmount: 100,
        leaseDurationHours: 24,
        requestTimestamp: new Date(),
      });

      engine.calculateScore(context);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Score calculated',
        expect.objectContaining({
          totalScore: expect.any(Number),
          durationMs: expect.any(Number),
          rulesTriggered: expect.any(Number),
          rulesFallback: expect.any(Number),
        })
      );
    });

    it('should mark rules with fallbackUsed when data unavailable', () => {
      const config: ScoringEngineConfig = {
        weights: {},
        threshold: 20,
      };
      const engine = createScoringEngine(config, mockLogger);

      // No AI analysis = fallback for rules 4, 16 (outside_target_audience uses S3 list, not AI)
      const context = createScoringContext({
        leaseId: 'test-123',
        userEmail: 'user@example.gov.uk',
        templateId: 'web-hosting',
        budgetAmount: 100,
        leaseDurationHours: 24,
        requestTimestamp: new Date(),
        aiAnalysis: undefined,
      });

      const result = engine.calculateScore(context);

      const fallbackRules = result.breakdown.filter((r) => r.fallbackUsed);
      expect(fallbackRules.length).toBeGreaterThan(0);

      // Rules 4 and 16 use AI analysis (outside_target_audience uses S3 domain list now)
      const fallbackRuleIds = fallbackRules.map((r) => r.ruleId);
      expect(fallbackRuleIds).toContain('first_time_suspicious');
      expect(fallbackRuleIds).toContain('group_mailbox_detected');
    });

    it('should produce deterministic results for same inputs', () => {
      const config: ScoringEngineConfig = {
        weights: {},
        threshold: 20,
      };
      const engine = createScoringEngine(config, mockLogger);

      const context = createScoringContext({
        leaseId: 'test-123',
        userEmail: 'user@example.gov.uk',
        templateId: 'web-hosting',
        budgetAmount: 100,
        leaseDurationHours: 24,
        requestTimestamp: new Date('2025-01-15T14:00:00Z'),
      });

      const result1 = engine.calculateScore(context);
      const result2 = engine.calculateScore(context);

      expect(result1.totalScore).toBe(result2.totalScore);
      expect(result1.breakdown.map((r) => r.points)).toEqual(result2.breakdown.map((r) => r.points));
    });

    it('should include all rule IDs in breakdown', () => {
      const config: ScoringEngineConfig = {
        weights: {},
        threshold: 20,
      };
      const engine = createScoringEngine(config, mockLogger);

      const context = createScoringContext({
        leaseId: 'test-123',
        userEmail: 'user@example.gov.uk',
        templateId: 'web-hosting',
        budgetAmount: 100,
        leaseDurationHours: 24,
        requestTimestamp: new Date(),
      });

      const result = engine.calculateScore(context);
      const ruleIds = result.breakdown.map((r) => r.ruleId);

      expect(ruleIds).toContain('expired_leases');
      expect(ruleIds).toContain('budget_exceeded');
      expect(ruleIds).toContain('first_time_user');
      expect(ruleIds).toContain('first_time_suspicious');
      expect(ruleIds).toContain('verified_gov_domain');
      expect(ruleIds).toContain('familiar_template');
      expect(ruleIds).toContain('template_hopper');
      expect(ruleIds).toContain('budget_amount');
      expect(ruleIds).toContain('duration_requested');
      expect(ruleIds).toContain('end_of_window');
      expect(ruleIds).toContain('cooldown_violation');
      expect(ruleIds).toContain('outside_target_audience');
      expect(ruleIds).toContain('manual_early_termination');
      expect(ruleIds).toContain('org_recent_negative');
      expect(ruleIds).toContain('org_clean_record');
      expect(ruleIds).toContain('group_mailbox_detected');
    });
  });

  describe('pessimistic fallback (AC5)', () => {
    it('should skip bonuses when data unavailable', () => {
      const config: ScoringEngineConfig = {
        weights: {},
        threshold: 20,
      };
      const engine = createScoringEngine(config, mockLogger);

      // No verified domain = skip bonus
      const context = createScoringContext({
        leaseId: 'test-123',
        userEmail: 'user@example.gov.uk',
        templateId: 'web-hosting',
        budgetAmount: 10,
        leaseDurationHours: 8,
        requestTimestamp: new Date('2025-01-15T14:00:00Z'),
        isVerifiedGovDomain: false,
      });

      const result = engine.calculateScore(context);

      const verifiedRule = result.breakdown.find((r) => r.ruleId === 'verified_gov_domain');
      expect(verifiedRule?.points).toBe(0); // Bonus skipped
    });

    it('should apply penalties when data unavailable (first_time_user)', () => {
      const config: ScoringEngineConfig = {
        weights: {},
        threshold: 20,
      };
      const engine = createScoringEngine(config, mockLogger);

      // No history = first time user (penalty applies)
      const context = createScoringContext({
        leaseId: 'test-123',
        userEmail: 'user@example.gov.uk',
        templateId: 'web-hosting',
        budgetAmount: 10,
        leaseDurationHours: 8,
        requestTimestamp: new Date('2025-01-15T14:00:00Z'),
        userLeaseHistory: [],
      });

      const result = engine.calculateScore(context);

      const firstTimeRule = result.breakdown.find((r) => r.ruleId === 'first_time_user');
      expect(firstTimeRule?.points).toBe(5); // Penalty applied
      expect(firstTimeRule?.triggered).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle zero budget and duration', () => {
      const config: ScoringEngineConfig = {
        weights: {},
        threshold: 20,
      };
      const engine = createScoringEngine(config, mockLogger);

      const context = createScoringContext({
        leaseId: 'test-123',
        userEmail: 'user@example.gov.uk',
        templateId: 'web-hosting',
        budgetAmount: 0,
        leaseDurationHours: 0,
        requestTimestamp: new Date('2025-01-15T14:00:00Z'), // 2pm London, outside end-of-window
        isVerifiedGovDomain: true,
      });

      const result = engine.calculateScore(context);

      // first_time_user: +5
      // verified_gov_domain: -5 (bonus for verified domain)
      // org_clean_record: 0 (requires 5+ org leases)
      // Total: 0
      expect(result.totalScore).toBe(0);
    });

    it('should handle negative score when bonuses exceed penalties', () => {
      const config: ScoringEngineConfig = {
        weights: {},
        threshold: 20,
      };
      const engine = createScoringEngine(config, mockLogger);

      // Verified gov domain + returning user with early termination
      const context = createScoringContext({
        leaseId: 'test-123',
        userEmail: 'user@example.gov.uk',
        templateId: 'web-hosting',
        budgetAmount: 0,
        leaseDurationHours: 0,
        requestTimestamp: new Date('2025-01-15T17:30:00Z'), // End of window penalty (+2)
        isVerifiedGovDomain: true,
        userLeaseHistory: [
          { uuid: 'old', userEmail: 'user@example.gov.uk', status: 'ManuallyTerminated', originalLeaseTemplateUuid: 'web-hosting', created: '2025-01-01T10:00:00Z' },
          { uuid: 'old2', userEmail: 'user@example.gov.uk', status: 'ManuallyTerminated', originalLeaseTemplateUuid: 'web-hosting', created: '2025-01-02T10:00:00Z' },
        ],
        orgLeaseHistory: [
          { uuid: 'old', userEmail: 'other@example.gov.uk', status: 'Expired', originalLeaseTemplateUuid: 'web', created: '2025-01-01T10:00:00Z' },
        ],
      });

      const result = engine.calculateScore(context);

      // Bonuses should push score negative despite end_of_window penalty:
      // verified_gov_domain: -5
      // familiar_template: -1
      // end_of_window: +2 (penalty)
      // manual_early_termination: -4 (2 * -2)
      // org_clean_record: 0 (needs 5+ org leases)
      // Total: -8
      expect(result.totalScore).toBeLessThan(0);
    });
  });
});
