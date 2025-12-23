/**
 * Tests for scoring engine types and interfaces.
 * Verifies type exports, default values, and type safety.
 */
import { describe, it, expect } from 'vitest';
import {
  RULE_IDS,
  DEFAULT_RULE_WEIGHTS,
  createScoringContext,
  type RuleId,
  type RuleWeights,
  type ScoringRuleResult,
  type ScoringResult,
} from '../../src/scoring/types.js';

describe('scoring types', () => {
  describe('RULE_IDS', () => {
    it('should contain all 16 rule identifiers', () => {
      expect(RULE_IDS).toHaveLength(16);
    });

    it('should contain expected rule names', () => {
      const expectedRules = [
        'expired_leases',
        'budget_exceeded',
        'first_time_user',
        'first_time_suspicious',
        'verified_gov_domain',
        'familiar_template',
        'template_hopper',
        'budget_amount',
        'duration_requested',
        'end_of_window',
        'cooldown_violation',
        'outside_target_audience',
        'manual_early_termination',
        'org_recent_negative',
        'org_clean_record',
        'group_mailbox_detected',
      ];

      expectedRules.forEach((rule) => {
        expect(RULE_IDS).toContain(rule);
      });
    });

    it('should have unique rule identifiers', () => {
      const uniqueRules = new Set(RULE_IDS);
      expect(uniqueRules.size).toBe(RULE_IDS.length);
    });
  });

  describe('DEFAULT_RULE_WEIGHTS', () => {
    it('should have a weight defined for all 16 rules', () => {
      const weightKeys = Object.keys(DEFAULT_RULE_WEIGHTS);
      expect(weightKeys).toHaveLength(16);
    });

    it('should have expected default weights for key rules', () => {
      // Penalty rules (positive = more scrutiny)
      expect(DEFAULT_RULE_WEIGHTS.expired_leases).toBe(2);
      expect(DEFAULT_RULE_WEIGHTS.budget_exceeded).toBe(5);
      expect(DEFAULT_RULE_WEIGHTS.first_time_user).toBe(5);
      expect(DEFAULT_RULE_WEIGHTS.first_time_suspicious).toBe(20);
      expect(DEFAULT_RULE_WEIGHTS.cooldown_violation).toBe(10);
      expect(DEFAULT_RULE_WEIGHTS.outside_target_audience).toBe(10);
      expect(DEFAULT_RULE_WEIGHTS.group_mailbox_detected).toBe(20);
      expect(DEFAULT_RULE_WEIGHTS.org_recent_negative).toBe(3);
      expect(DEFAULT_RULE_WEIGHTS.template_hopper).toBe(2);

      // Bonus rules (negative = less scrutiny)
      expect(DEFAULT_RULE_WEIGHTS.verified_gov_domain).toBe(-5);
      expect(DEFAULT_RULE_WEIGHTS.familiar_template).toBe(-1);
      expect(DEFAULT_RULE_WEIGHTS.end_of_window).toBe(-2);
      expect(DEFAULT_RULE_WEIGHTS.manual_early_termination).toBe(-2);
      expect(DEFAULT_RULE_WEIGHTS.org_clean_record).toBe(-2);

      // Per-unit rules
      expect(DEFAULT_RULE_WEIGHTS.budget_amount).toBe(1); // per $10
      expect(DEFAULT_RULE_WEIGHTS.duration_requested).toBe(1); // per 8 hours
    });

    it('should match RULE_IDS keys', () => {
      const weightKeys = Object.keys(DEFAULT_RULE_WEIGHTS) as RuleId[];
      weightKeys.forEach((key) => {
        expect(RULE_IDS).toContain(key);
      });
    });
  });

  describe('createScoringContext', () => {
    it('should create context with required fields', () => {
      const context = createScoringContext({
        leaseId: 'test-lease-123',
        userEmail: 'user@example.gov.uk',
        templateId: 'web-hosting',
        budgetAmount: 100,
        leaseDurationHours: 24,
        requestTimestamp: new Date('2025-01-15T14:00:00Z'),
      });

      expect(context.leaseId).toBe('test-lease-123');
      expect(context.userEmail).toBe('user@example.gov.uk');
      expect(context.templateId).toBe('web-hosting');
      expect(context.budgetAmount).toBe(100);
      expect(context.leaseDurationHours).toBe(24);
      expect(context.requestTimestamp).toEqual(new Date('2025-01-15T14:00:00Z'));
    });

    it('should have empty user history by default', () => {
      const context = createScoringContext({
        leaseId: 'test-lease-123',
        userEmail: 'user@example.gov.uk',
        templateId: 'web-hosting',
        budgetAmount: 100,
        leaseDurationHours: 24,
        requestTimestamp: new Date(),
      });

      expect(context.userLeaseHistory).toEqual([]);
    });

    it('should have empty org history by default', () => {
      const context = createScoringContext({
        leaseId: 'test-lease-123',
        userEmail: 'user@example.gov.uk',
        templateId: 'web-hosting',
        budgetAmount: 100,
        leaseDurationHours: 24,
        requestTimestamp: new Date(),
      });

      expect(context.orgLeaseHistory).toEqual([]);
    });

    it('should have domain unverified by default', () => {
      const context = createScoringContext({
        leaseId: 'test-lease-123',
        userEmail: 'user@example.gov.uk',
        templateId: 'web-hosting',
        budgetAmount: 100,
        leaseDurationHours: 24,
        requestTimestamp: new Date(),
      });

      expect(context.isVerifiedGovDomain).toBe(false);
    });

    it('should not have AI analysis by default', () => {
      const context = createScoringContext({
        leaseId: 'test-lease-123',
        userEmail: 'user@example.gov.uk',
        templateId: 'web-hosting',
        budgetAmount: 100,
        leaseDurationHours: 24,
        requestTimestamp: new Date(),
      });

      expect(context.aiAnalysis).toBeUndefined();
    });

    it('should allow overriding optional fields', () => {
      const context = createScoringContext({
        leaseId: 'test-lease-123',
        userEmail: 'user@example.gov.uk',
        templateId: 'web-hosting',
        budgetAmount: 100,
        leaseDurationHours: 24,
        requestTimestamp: new Date(),
        isVerifiedGovDomain: true,
        userLeaseHistory: [
          {
            uuid: 'old-lease',
            userEmail: 'user@example.gov.uk',
            status: 'Expired',
            originalLeaseTemplateUuid: 'web-hosting',
            created: '2025-01-01T10:00:00Z',
            endDate: '2025-01-02T10:00:00Z',
          },
        ],
      });

      expect(context.isVerifiedGovDomain).toBe(true);
      expect(context.userLeaseHistory).toHaveLength(1);
    });
  });

  describe('type safety', () => {
    it('should enforce RuleId type', () => {
      const validRuleId: RuleId = 'expired_leases';
      expect(validRuleId).toBe('expired_leases');
    });

    it('should enforce RuleWeights type with all keys', () => {
      const weights: RuleWeights = { ...DEFAULT_RULE_WEIGHTS };
      expect(Object.keys(weights)).toHaveLength(16);
    });

    it('should define ScoringRuleResult with required fields', () => {
      const result: ScoringRuleResult = {
        ruleId: 'first_time_user',
        points: 5,
        triggered: true,
        reason: 'No previous leases found',
      };

      expect(result.ruleId).toBe('first_time_user');
      expect(result.points).toBe(5);
      expect(result.triggered).toBe(true);
      expect(result.reason).toBe('No previous leases found');
    });

    it('should allow optional fallbackUsed field in ScoringRuleResult', () => {
      const result: ScoringRuleResult = {
        ruleId: 'verified_gov_domain',
        points: 0,
        triggered: false,
        fallbackUsed: true,
      };

      expect(result.fallbackUsed).toBe(true);
    });

    it('should define ScoringResult with all required fields', () => {
      const result: ScoringResult = {
        totalScore: 15,
        breakdown: [
          { ruleId: 'first_time_user', points: 5, triggered: true },
          { ruleId: 'budget_amount', points: 10, triggered: true },
        ],
        durationMs: 50,
      };

      expect(result.totalScore).toBe(15);
      expect(result.breakdown).toHaveLength(2);
      expect(result.durationMs).toBe(50);
    });
  });
});
