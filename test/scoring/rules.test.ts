/**
 * Tests for individual scoring rules.
 * Each rule is a pure function tested in isolation.
 */
import { describe, it, expect } from 'vitest';
import {
  expiredLeasesRule,
  budgetExceededRule,
  firstTimeUserRule,
  firstTimeSuspiciousRule,
  verifiedGovDomainRule,
  familiarTemplateRule,
  templateHopperRule,
  budgetAmountRule,
  durationRequestedRule,
  endOfWindowRule,
  cooldownViolationRule,
  outsideTargetAudienceRule,
  manualEarlyTerminationRule,
  orgRecentNegativeRule,
  orgCleanRecordRule,
  groupMailboxDetectedRule,
  ALL_RULES,
} from '../../src/scoring/rules.js';
import { createScoringContext, type ScoringContext } from '../../src/scoring/types.js';

// Helper to create a base context
const createBaseContext = (overrides: Partial<ScoringContext> = {}): ScoringContext =>
  createScoringContext({
    leaseId: 'test-123',
    userEmail: 'user@example.gov.uk',
    templateId: 'web-hosting',
    budgetAmount: 100,
    leaseDurationHours: 24,
    requestTimestamp: new Date('2025-01-15T14:00:00Z'),
    ...overrides,
  });

describe('scoring rules', () => {
  describe('ALL_RULES array', () => {
    it('should contain 16 rules', () => {
      expect(ALL_RULES).toHaveLength(16);
    });

    it('should have unique rule IDs', () => {
      const ruleIds = ALL_RULES.map((r) => r.ruleId);
      expect(new Set(ruleIds).size).toBe(16);
    });
  });

  describe('Rule 1: expired_leases', () => {
    it('should return 0 points when no expired leases', () => {
      const context = createBaseContext({
        userLeaseHistory: [
          { leaseId: 'old-1', status: 'Completed', templateId: 'web', terminatedEarly: false },
        ],
      });
      const result = expiredLeasesRule(context, 2);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
    });

    it('should return weight * count for expired leases', () => {
      const context = createBaseContext({
        userLeaseHistory: [
          { leaseId: 'exp-1', status: 'Expired', templateId: 'web', terminatedEarly: false },
          { leaseId: 'exp-2', status: 'Expired', templateId: 'data', terminatedEarly: false },
        ],
      });
      const result = expiredLeasesRule(context, 2);
      expect(result.points).toBe(4); // 2 * 2
      expect(result.triggered).toBe(true);
    });

    it('should return 0 when no history (fallback)', () => {
      const context = createBaseContext({ userLeaseHistory: [] });
      const result = expiredLeasesRule(context, 2);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
    });
  });

  describe('Rule 2: budget_exceeded', () => {
    it('should return 0 points when no budget exceeded leases', () => {
      const context = createBaseContext({
        userLeaseHistory: [
          { leaseId: 'old-1', status: 'Completed', templateId: 'web', terminatedEarly: false },
        ],
      });
      const result = budgetExceededRule(context, 5);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
    });

    it('should return weight * count for budget exceeded leases', () => {
      const context = createBaseContext({
        userLeaseHistory: [
          { leaseId: 'be-1', status: 'BudgetExceeded', templateId: 'web', terminatedEarly: false },
        ],
      });
      const result = budgetExceededRule(context, 5);
      expect(result.points).toBe(5);
      expect(result.triggered).toBe(true);
    });
  });

  describe('Rule 3: first_time_user', () => {
    it('should return weight for user with no history', () => {
      const context = createBaseContext({ userLeaseHistory: [] });
      const result = firstTimeUserRule(context, 5);
      expect(result.points).toBe(5);
      expect(result.triggered).toBe(true);
    });

    it('should return 0 for user with history', () => {
      const context = createBaseContext({
        userLeaseHistory: [
          { leaseId: 'old-1', status: 'Completed', templateId: 'web', terminatedEarly: false },
        ],
      });
      const result = firstTimeUserRule(context, 5);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
    });
  });

  describe('Rule 4: first_time_suspicious', () => {
    it('should skip when no AI analysis available', () => {
      const context = createBaseContext({ userLeaseHistory: [], aiAnalysis: undefined });
      const result = firstTimeSuspiciousRule(context, 20);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
      expect(result.fallbackUsed).toBe(true);
    });

    it('should return weight for first time + group mailbox', () => {
      const context = createBaseContext({
        userLeaseHistory: [],
        aiAnalysis: { isGroupMailbox: true, isOutsideTargetAudience: false, confidence: 0.9 },
      });
      const result = firstTimeSuspiciousRule(context, 20);
      expect(result.points).toBe(20);
      expect(result.triggered).toBe(true);
    });

    it('should return 0 for returning user even with group mailbox', () => {
      const context = createBaseContext({
        userLeaseHistory: [
          { leaseId: 'old', status: 'Completed', templateId: 'web', terminatedEarly: false },
        ],
        aiAnalysis: { isGroupMailbox: true, isOutsideTargetAudience: false, confidence: 0.9 },
      });
      const result = firstTimeSuspiciousRule(context, 20);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
    });
  });

  describe('Rule 5: verified_gov_domain', () => {
    it('should return negative weight (bonus) for verified domain', () => {
      const context = createBaseContext({ isVerifiedGovDomain: true });
      const result = verifiedGovDomainRule(context, -5);
      expect(result.points).toBe(-5);
      expect(result.triggered).toBe(true);
    });

    it('should return 0 for unverified domain (skip bonus)', () => {
      const context = createBaseContext({ isVerifiedGovDomain: false });
      const result = verifiedGovDomainRule(context, -5);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
    });
  });

  describe('Rule 6: familiar_template', () => {
    it('should return bonus for previously used template', () => {
      const context = createBaseContext({
        templateId: 'web-hosting',
        userLeaseHistory: [
          { leaseId: 'old', status: 'Completed', templateId: 'web-hosting', terminatedEarly: false },
        ],
      });
      const result = familiarTemplateRule(context, -1);
      expect(result.points).toBe(-1);
      expect(result.triggered).toBe(true);
    });

    it('should return 0 for new template', () => {
      const context = createBaseContext({
        templateId: 'web-hosting',
        userLeaseHistory: [
          { leaseId: 'old', status: 'Completed', templateId: 'data-science', terminatedEarly: false },
        ],
      });
      const result = familiarTemplateRule(context, -1);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
    });

    it('should return 0 when no history', () => {
      const context = createBaseContext({ userLeaseHistory: [] });
      const result = familiarTemplateRule(context, -1);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
    });
  });

  describe('Rule 7: template_hopper', () => {
    it('should return weight for 3+ leases with all different templates', () => {
      const context = createBaseContext({
        templateId: 'template-4',
        userLeaseHistory: [
          { leaseId: '1', status: 'Completed', templateId: 'template-1', terminatedEarly: false },
          { leaseId: '2', status: 'Completed', templateId: 'template-2', terminatedEarly: false },
          { leaseId: '3', status: 'Completed', templateId: 'template-3', terminatedEarly: false },
        ],
      });
      const result = templateHopperRule(context, 2);
      expect(result.points).toBe(2);
      expect(result.triggered).toBe(true);
    });

    it('should return 0 when user has repeated a template', () => {
      const context = createBaseContext({
        templateId: 'template-1', // Repeating
        userLeaseHistory: [
          { leaseId: '1', status: 'Completed', templateId: 'template-1', terminatedEarly: false },
          { leaseId: '2', status: 'Completed', templateId: 'template-2', terminatedEarly: false },
          { leaseId: '3', status: 'Completed', templateId: 'template-3', terminatedEarly: false },
        ],
      });
      const result = templateHopperRule(context, 2);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
    });

    it('should return 0 for fewer than 3 leases', () => {
      const context = createBaseContext({
        userLeaseHistory: [
          { leaseId: '1', status: 'Completed', templateId: 'template-1', terminatedEarly: false },
          { leaseId: '2', status: 'Completed', templateId: 'template-2', terminatedEarly: false },
        ],
      });
      const result = templateHopperRule(context, 2);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
    });
  });

  describe('Rule 8: budget_amount', () => {
    it('should return weight per $10 of budget', () => {
      const context = createBaseContext({ budgetAmount: 100 });
      const result = budgetAmountRule(context, 1);
      expect(result.points).toBe(10); // 100 / 10 = 10
      expect(result.triggered).toBe(true);
    });

    it('should round down partial units', () => {
      const context = createBaseContext({ budgetAmount: 15 });
      const result = budgetAmountRule(context, 1);
      expect(result.points).toBe(1); // floor(15 / 10) = 1
      expect(result.triggered).toBe(true);
    });

    it('should return 0 for budget under $10', () => {
      const context = createBaseContext({ budgetAmount: 5 });
      const result = budgetAmountRule(context, 1);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
    });

    it('should apply custom weight', () => {
      const context = createBaseContext({ budgetAmount: 50 });
      const result = budgetAmountRule(context, 2);
      expect(result.points).toBe(10); // 5 * 2
      expect(result.triggered).toBe(true);
    });
  });

  describe('Rule 9: duration_requested', () => {
    it('should return weight per 8 hours', () => {
      const context = createBaseContext({ leaseDurationHours: 24 });
      const result = durationRequestedRule(context, 1);
      expect(result.points).toBe(3); // 24 / 8 = 3
      expect(result.triggered).toBe(true);
    });

    it('should round down partial units', () => {
      const context = createBaseContext({ leaseDurationHours: 20 });
      const result = durationRequestedRule(context, 1);
      expect(result.points).toBe(2); // floor(20 / 8) = 2
      expect(result.triggered).toBe(true);
    });

    it('should return 0 for duration under 8 hours', () => {
      const context = createBaseContext({ leaseDurationHours: 4 });
      const result = durationRequestedRule(context, 1);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
    });
  });

  describe('Rule 10: end_of_window', () => {
    it('should return bonus for request in final 2 hours (5-7pm London)', () => {
      // 5:30pm London = 17:30 GMT
      const context = createBaseContext({
        requestTimestamp: new Date('2025-01-15T17:30:00Z'),
      });
      const result = endOfWindowRule(context, -2);
      expect(result.points).toBe(-2);
      expect(result.triggered).toBe(true);
    });

    it('should return 0 for request outside end-of-window', () => {
      // 2pm London = 14:00 GMT
      const context = createBaseContext({
        requestTimestamp: new Date('2025-01-15T14:00:00Z'),
      });
      const result = endOfWindowRule(context, -2);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
    });

    it('should handle BST (summer time)', () => {
      // 6pm London BST = 17:00 UTC (during BST)
      const context = createBaseContext({
        requestTimestamp: new Date('2025-06-15T17:00:00Z'),
      });
      const result = endOfWindowRule(context, -2);
      expect(result.points).toBe(-2);
      expect(result.triggered).toBe(true);
    });
  });

  describe('Rule 11: cooldown_violation', () => {
    it('should return weight for request within 1hr of previous lease end', () => {
      const previousEnd = new Date('2025-01-15T13:30:00Z');
      const context = createBaseContext({
        requestTimestamp: new Date('2025-01-15T14:00:00Z'), // 30 min later
        userLeaseHistory: [
          { leaseId: 'prev', status: 'Completed', templateId: 'web', endedAt: previousEnd, terminatedEarly: false },
        ],
      });
      const result = cooldownViolationRule(context, 10);
      expect(result.points).toBe(10);
      expect(result.triggered).toBe(true);
    });

    it('should return 0 when more than 1hr since last lease', () => {
      const previousEnd = new Date('2025-01-15T12:00:00Z');
      const context = createBaseContext({
        requestTimestamp: new Date('2025-01-15T14:00:00Z'), // 2 hours later
        userLeaseHistory: [
          { leaseId: 'prev', status: 'Completed', templateId: 'web', endedAt: previousEnd, terminatedEarly: false },
        ],
      });
      const result = cooldownViolationRule(context, 10);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
    });

    it('should return 0 when no history', () => {
      const context = createBaseContext({ userLeaseHistory: [] });
      const result = cooldownViolationRule(context, 10);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
    });

    it('should find most recent lease from multiple ended leases', () => {
      const olderEnd = new Date('2025-01-15T12:00:00Z');
      const newerEnd = new Date('2025-01-15T13:30:00Z');
      const context = createBaseContext({
        requestTimestamp: new Date('2025-01-15T14:00:00Z'), // 30 min after newer
        userLeaseHistory: [
          // Older lease listed first - tests the reduce finding the newer one
          { leaseId: 'older', status: 'Completed', templateId: 'web', endedAt: olderEnd, terminatedEarly: false },
          { leaseId: 'newer', status: 'Completed', templateId: 'data', endedAt: newerEnd, terminatedEarly: false },
        ],
      });
      const result = cooldownViolationRule(context, 10);
      expect(result.points).toBe(10); // Violation because 30 min since newer lease
      expect(result.triggered).toBe(true);
    });

    it('should check against most recent even when newest is first in list', () => {
      const newerEnd = new Date('2025-01-15T13:30:00Z');
      const olderEnd = new Date('2025-01-15T12:00:00Z');
      const context = createBaseContext({
        requestTimestamp: new Date('2025-01-15T14:00:00Z'), // 30 min after newer
        userLeaseHistory: [
          // Newer lease listed first
          { leaseId: 'newer', status: 'Completed', templateId: 'data', endedAt: newerEnd, terminatedEarly: false },
          { leaseId: 'older', status: 'Completed', templateId: 'web', endedAt: olderEnd, terminatedEarly: false },
        ],
      });
      const result = cooldownViolationRule(context, 10);
      expect(result.points).toBe(10);
      expect(result.triggered).toBe(true);
    });
  });

  describe('Rule 12: outside_target_audience', () => {
    it('should skip when no AI analysis available', () => {
      const context = createBaseContext({ aiAnalysis: undefined });
      const result = outsideTargetAudienceRule(context, 10);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
      expect(result.fallbackUsed).toBe(true);
    });

    it('should return weight for outside target audience', () => {
      const context = createBaseContext({
        aiAnalysis: { isGroupMailbox: false, isOutsideTargetAudience: true, confidence: 0.9 },
      });
      const result = outsideTargetAudienceRule(context, 10);
      expect(result.points).toBe(10);
      expect(result.triggered).toBe(true);
    });

    it('should return 0 for target audience', () => {
      const context = createBaseContext({
        aiAnalysis: { isGroupMailbox: false, isOutsideTargetAudience: false, confidence: 0.9 },
      });
      const result = outsideTargetAudienceRule(context, 10);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
    });
  });

  describe('Rule 13: manual_early_termination', () => {
    it('should return bonus for early terminated leases', () => {
      const context = createBaseContext({
        userLeaseHistory: [
          { leaseId: '1', status: 'Terminated', templateId: 'web', terminatedEarly: true },
          { leaseId: '2', status: 'Terminated', templateId: 'data', terminatedEarly: true },
        ],
      });
      const result = manualEarlyTerminationRule(context, -2);
      expect(result.points).toBe(-4); // -2 * 2
      expect(result.triggered).toBe(true);
    });

    it('should return 0 when no early terminations', () => {
      const context = createBaseContext({
        userLeaseHistory: [
          { leaseId: '1', status: 'Completed', templateId: 'web', terminatedEarly: false },
        ],
      });
      const result = manualEarlyTerminationRule(context, -2);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
    });
  });

  describe('Rule 14: org_recent_negative', () => {
    it('should return weight when org has recent negative history', () => {
      const context = createBaseContext({
        orgLeaseHistory: [
          { leaseId: '1', status: 'Expired', templateId: 'web', terminatedEarly: false },
        ],
      });
      const result = orgRecentNegativeRule(context, 3);
      expect(result.points).toBe(3);
      expect(result.triggered).toBe(true);
    });

    it('should return 0 when org has clean history', () => {
      const context = createBaseContext({
        orgLeaseHistory: [
          { leaseId: '1', status: 'Completed', templateId: 'web', terminatedEarly: false },
        ],
      });
      const result = orgRecentNegativeRule(context, 3);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
    });

    it('should return 0 when no org history', () => {
      const context = createBaseContext({ orgLeaseHistory: [] });
      const result = orgRecentNegativeRule(context, 3);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
    });
  });

  describe('Rule 15: org_clean_record', () => {
    it('should return bonus when org has clean record (all completed)', () => {
      const context = createBaseContext({
        orgLeaseHistory: [
          { leaseId: '1', status: 'Completed', templateId: 'web', terminatedEarly: false },
          { leaseId: '2', status: 'Completed', templateId: 'data', terminatedEarly: false },
        ],
      });
      const result = orgCleanRecordRule(context, -2);
      expect(result.points).toBe(-2);
      expect(result.triggered).toBe(true);
    });

    it('should return 0 when org has any negative history', () => {
      const context = createBaseContext({
        orgLeaseHistory: [
          { leaseId: '1', status: 'Completed', templateId: 'web', terminatedEarly: false },
          { leaseId: '2', status: 'Expired', templateId: 'data', terminatedEarly: false },
        ],
      });
      const result = orgCleanRecordRule(context, -2);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
    });

    it('should return 0 when no org history', () => {
      const context = createBaseContext({ orgLeaseHistory: [] });
      const result = orgCleanRecordRule(context, -2);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
    });
  });

  describe('Rule 16: group_mailbox_detected', () => {
    it('should skip when no AI analysis available', () => {
      const context = createBaseContext({ aiAnalysis: undefined });
      const result = groupMailboxDetectedRule(context, 20);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
      expect(result.fallbackUsed).toBe(true);
    });

    it('should return weight for group mailbox detected', () => {
      const context = createBaseContext({
        aiAnalysis: { isGroupMailbox: true, isOutsideTargetAudience: false, confidence: 0.9 },
      });
      const result = groupMailboxDetectedRule(context, 20);
      expect(result.points).toBe(20);
      expect(result.triggered).toBe(true);
    });

    it('should return 0 for individual mailbox', () => {
      const context = createBaseContext({
        aiAnalysis: { isGroupMailbox: false, isOutsideTargetAudience: false, confidence: 0.9 },
      });
      const result = groupMailboxDetectedRule(context, 20);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
    });
  });

  describe('determinism', () => {
    it('should produce same result for identical inputs', () => {
      const context = createBaseContext({ budgetAmount: 100 });
      const result1 = budgetAmountRule(context, 1);
      const result2 = budgetAmountRule(context, 1);
      expect(result1).toEqual(result2);
    });

    it('should produce same total when rules run in different orders', () => {
      const context = createBaseContext({ budgetAmount: 100, leaseDurationHours: 24 });

      // Order 1
      const budget1 = budgetAmountRule(context, 1);
      const duration1 = durationRequestedRule(context, 1);

      // Order 2
      const duration2 = durationRequestedRule(context, 1);
      const budget2 = budgetAmountRule(context, 1);

      expect(budget1.points + duration1.points).toBe(budget2.points + duration2.points);
    });
  });
});
