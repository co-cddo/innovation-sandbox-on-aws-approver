/**
 * Tests for individual scoring rules.
 * Each rule is a pure function tested in isolation.
 *
 * Uses ISB DynamoDB schema format for lease history records.
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
import { createScoringContext, type ScoringContext, type LeaseHistoryRecord } from '../../src/scoring/types.js';

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

/**
 * Helper to create a lease history record matching ISB schema.
 * Defaults to a recent lease (within 30 days of the default requestTimestamp).
 */
const createLease = (overrides: Partial<LeaseHistoryRecord> = {}): LeaseHistoryRecord => ({
  uuid: 'test-lease-uuid',
  userEmail: 'user@example.gov.uk',
  status: 'Active',
  originalLeaseTemplateUuid: 'web-hosting',
  created: '2025-01-10T10:00:00Z', // Recent (within 30 days of Jan 15)
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
          createLease({ uuid: 'old-1', status: 'Active' }),
        ],
      });
      const result = expiredLeasesRule(context, 2);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
    });

    it('should return weight * count for expired leases in last 30 days', () => {
      const context = createBaseContext({
        userLeaseHistory: [
          createLease({ uuid: 'exp-1', status: 'Expired', created: '2025-01-05T10:00:00Z' }),
          createLease({ uuid: 'exp-2', status: 'Expired', created: '2025-01-08T10:00:00Z' }),
        ],
      });
      const result = expiredLeasesRule(context, 2);
      expect(result.points).toBe(4); // 2 * 2
      expect(result.triggered).toBe(true);
    });

    it('should exclude expired leases older than 30 days', () => {
      const context = createBaseContext({
        requestTimestamp: new Date('2025-01-15T14:00:00Z'),
        userLeaseHistory: [
          createLease({ uuid: 'exp-old', status: 'Expired', created: '2024-12-01T10:00:00Z' }), // 45 days ago
          createLease({ uuid: 'exp-recent', status: 'Expired', created: '2025-01-05T10:00:00Z' }), // 10 days ago
        ],
      });
      const result = expiredLeasesRule(context, 2);
      expect(result.points).toBe(2); // Only 1 recent expired lease
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
          createLease({ uuid: 'old-1', status: 'Active' }),
        ],
      });
      const result = budgetExceededRule(context, 5);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
    });

    it('should return weight * count for budget exceeded leases in last 30 days', () => {
      const context = createBaseContext({
        userLeaseHistory: [
          createLease({ uuid: 'be-1', status: 'BudgetExceeded', created: '2025-01-10T10:00:00Z' }),
        ],
      });
      const result = budgetExceededRule(context, 5);
      expect(result.points).toBe(5);
      expect(result.triggered).toBe(true);
    });

    it('should exclude budget exceeded leases older than 30 days', () => {
      const context = createBaseContext({
        requestTimestamp: new Date('2025-01-15T14:00:00Z'),
        userLeaseHistory: [
          createLease({ uuid: 'be-old', status: 'BudgetExceeded', created: '2024-12-01T10:00:00Z' }), // 45 days ago
        ],
      });
      const result = budgetExceededRule(context, 5);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
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
          createLease({ uuid: 'old-1', status: 'Active' }),
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
          createLease({ uuid: 'old', status: 'Active' }),
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
          // Successful statuses: Active, Expired, ManuallyTerminated
          createLease({ uuid: 'old', status: 'Expired', originalLeaseTemplateUuid: 'web-hosting' }),
        ],
      });
      const result = familiarTemplateRule(context, -1);
      expect(result.points).toBe(-1);
      expect(result.triggered).toBe(true);
    });

    it('should return bonus for ManuallyTerminated lease with same template', () => {
      const context = createBaseContext({
        templateId: 'web-hosting',
        userLeaseHistory: [
          createLease({ uuid: 'old', status: 'ManuallyTerminated', originalLeaseTemplateUuid: 'web-hosting' }),
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
          createLease({ uuid: 'old', status: 'Expired', originalLeaseTemplateUuid: 'data-science' }),
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

    it('should not count BudgetExceeded as successful template use', () => {
      const context = createBaseContext({
        templateId: 'web-hosting',
        userLeaseHistory: [
          createLease({ uuid: 'old', status: 'BudgetExceeded', originalLeaseTemplateUuid: 'web-hosting' }),
        ],
      });
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
          createLease({ uuid: '1', originalLeaseTemplateUuid: 'template-1' }),
          createLease({ uuid: '2', originalLeaseTemplateUuid: 'template-2' }),
          createLease({ uuid: '3', originalLeaseTemplateUuid: 'template-3' }),
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
          createLease({ uuid: '1', originalLeaseTemplateUuid: 'template-1' }),
          createLease({ uuid: '2', originalLeaseTemplateUuid: 'template-2' }),
          createLease({ uuid: '3', originalLeaseTemplateUuid: 'template-3' }),
        ],
      });
      const result = templateHopperRule(context, 2);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
    });

    it('should return 0 for fewer than 3 leases', () => {
      const context = createBaseContext({
        userLeaseHistory: [
          createLease({ uuid: '1', originalLeaseTemplateUuid: 'template-1' }),
          createLease({ uuid: '2', originalLeaseTemplateUuid: 'template-2' }),
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
    it('should return weight for request within 1hr of previous lease creation', () => {
      const context = createBaseContext({
        requestTimestamp: new Date('2025-01-15T14:00:00Z'), // Request time
        userLeaseHistory: [
          createLease({ uuid: 'prev', created: '2025-01-15T13:30:00Z' }), // 30 min before request
        ],
      });
      const result = cooldownViolationRule(context, 10);
      expect(result.points).toBe(10);
      expect(result.triggered).toBe(true);
    });

    it('should return 0 when more than 1hr since last lease', () => {
      const context = createBaseContext({
        requestTimestamp: new Date('2025-01-15T14:00:00Z'), // Request time
        userLeaseHistory: [
          createLease({ uuid: 'prev', created: '2025-01-15T12:00:00Z' }), // 2 hours before request
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

    it('should find most recent lease from multiple leases', () => {
      const context = createBaseContext({
        requestTimestamp: new Date('2025-01-15T14:00:00Z'),
        userLeaseHistory: [
          // Older lease listed first - tests the sort finding the newer one
          createLease({ uuid: 'older', created: '2025-01-15T12:00:00Z' }),
          createLease({ uuid: 'newer', created: '2025-01-15T13:30:00Z' }),
        ],
      });
      const result = cooldownViolationRule(context, 10);
      expect(result.points).toBe(10); // Violation because 30 min since newer lease
      expect(result.triggered).toBe(true);
    });

    it('should check against most recent even when newest is first in list', () => {
      const context = createBaseContext({
        requestTimestamp: new Date('2025-01-15T14:00:00Z'),
        userLeaseHistory: [
          // Newer lease listed first
          createLease({ uuid: 'newer', created: '2025-01-15T13:30:00Z' }),
          createLease({ uuid: 'older', created: '2025-01-15T12:00:00Z' }),
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
    it('should return bonus for ManuallyTerminated leases in last 90 days', () => {
      const context = createBaseContext({
        requestTimestamp: new Date('2025-01-15T14:00:00Z'),
        userLeaseHistory: [
          createLease({ uuid: '1', status: 'ManuallyTerminated', created: '2025-01-01T10:00:00Z' }),
          createLease({ uuid: '2', status: 'ManuallyTerminated', created: '2025-01-05T10:00:00Z' }),
        ],
      });
      const result = manualEarlyTerminationRule(context, -2);
      expect(result.points).toBe(-4); // -2 * 2
      expect(result.triggered).toBe(true);
    });

    it('should return 0 when no ManuallyTerminated leases', () => {
      const context = createBaseContext({
        userLeaseHistory: [
          createLease({ uuid: '1', status: 'Expired' }),
        ],
      });
      const result = manualEarlyTerminationRule(context, -2);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
    });

    it('should exclude ManuallyTerminated leases older than 90 days', () => {
      const context = createBaseContext({
        requestTimestamp: new Date('2025-01-15T14:00:00Z'),
        userLeaseHistory: [
          createLease({ uuid: '1', status: 'ManuallyTerminated', created: '2024-10-01T10:00:00Z' }), // > 90 days ago
        ],
      });
      const result = manualEarlyTerminationRule(context, -2);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
    });
  });

  describe('Rule 14: org_recent_negative', () => {
    it('should return weight when org has expired lease in last 30 days', () => {
      const context = createBaseContext({
        requestTimestamp: new Date('2025-01-15T14:00:00Z'),
        orgLeaseHistory: [
          createLease({ uuid: '1', status: 'Expired', created: '2025-01-05T10:00:00Z' }),
        ],
      });
      const result = orgRecentNegativeRule(context, 3);
      expect(result.points).toBe(3);
      expect(result.triggered).toBe(true);
    });

    it('should return weight when org has BudgetExceeded lease in last 30 days', () => {
      const context = createBaseContext({
        requestTimestamp: new Date('2025-01-15T14:00:00Z'),
        orgLeaseHistory: [
          createLease({ uuid: '1', status: 'BudgetExceeded', created: '2025-01-05T10:00:00Z' }),
        ],
      });
      const result = orgRecentNegativeRule(context, 3);
      expect(result.points).toBe(3);
      expect(result.triggered).toBe(true);
    });

    it('should return 0 when org has clean history in last 30 days', () => {
      const context = createBaseContext({
        requestTimestamp: new Date('2025-01-15T14:00:00Z'),
        orgLeaseHistory: [
          createLease({ uuid: '1', status: 'Active', created: '2025-01-05T10:00:00Z' }),
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

    it('should exclude negative history older than 30 days', () => {
      const context = createBaseContext({
        requestTimestamp: new Date('2025-01-15T14:00:00Z'),
        orgLeaseHistory: [
          createLease({ uuid: '1', status: 'Expired', created: '2024-12-01T10:00:00Z' }), // > 30 days ago
        ],
      });
      const result = orgRecentNegativeRule(context, 3);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
    });

    it('should count multiple negative outcomes in reason', () => {
      const context = createBaseContext({
        requestTimestamp: new Date('2025-01-15T14:00:00Z'),
        orgLeaseHistory: [
          createLease({ uuid: '1', status: 'Expired', created: '2025-01-05T10:00:00Z' }),
          createLease({ uuid: '2', status: 'BudgetExceeded', created: '2025-01-03T10:00:00Z' }),
          createLease({ uuid: '3', status: 'Active', created: '2025-01-01T10:00:00Z' }), // Not negative
        ],
      });
      const result = orgRecentNegativeRule(context, 3);
      expect(result.points).toBe(3);
      expect(result.triggered).toBe(true);
      expect(result.reason).toContain('2 negative outcome(s)');
    });
  });

  describe('Rule 15: org_clean_record', () => {
    it('should return bonus when org has 5+ clean leases in last 90 days', () => {
      const context = createBaseContext({
        requestTimestamp: new Date('2025-01-15T14:00:00Z'),
        orgLeaseHistory: [
          createLease({ uuid: '1', status: 'Active', created: '2025-01-01T10:00:00Z' }),
          createLease({ uuid: '2', status: 'Active', created: '2024-12-20T10:00:00Z' }),
          createLease({ uuid: '3', status: 'Active', created: '2024-12-15T10:00:00Z' }),
          createLease({ uuid: '4', status: 'ManuallyTerminated', created: '2024-12-10T10:00:00Z' }),
          createLease({ uuid: '5', status: 'Active', created: '2024-12-05T10:00:00Z' }),
        ],
      });
      const result = orgCleanRecordRule(context, -2);
      expect(result.points).toBe(-2);
      expect(result.triggered).toBe(true);
      expect(result.reason).toContain('5 leases');
    });

    it('should return 0 when org has less than 5 leases (even if clean)', () => {
      const context = createBaseContext({
        requestTimestamp: new Date('2025-01-15T14:00:00Z'),
        orgLeaseHistory: [
          createLease({ uuid: '1', status: 'Active', created: '2025-01-01T10:00:00Z' }),
          createLease({ uuid: '2', status: 'Active', created: '2024-12-15T10:00:00Z' }),
          createLease({ uuid: '3', status: 'ManuallyTerminated', created: '2024-12-10T10:00:00Z' }),
          createLease({ uuid: '4', status: 'Active', created: '2024-12-05T10:00:00Z' }),
        ],
      });
      const result = orgCleanRecordRule(context, -2);
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
    });

    it('should return 0 when org has 5+ leases but has negative outcome', () => {
      const context = createBaseContext({
        requestTimestamp: new Date('2025-01-15T14:00:00Z'),
        orgLeaseHistory: [
          createLease({ uuid: '1', status: 'Active', created: '2025-01-01T10:00:00Z' }),
          createLease({ uuid: '2', status: 'Active', created: '2024-12-20T10:00:00Z' }),
          createLease({ uuid: '3', status: 'BudgetExceeded', created: '2024-12-15T10:00:00Z' }),
          createLease({ uuid: '4', status: 'Active', created: '2024-12-10T10:00:00Z' }),
          createLease({ uuid: '5', status: 'Active', created: '2024-12-05T10:00:00Z' }),
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

    it('should ignore history older than 90 days when counting', () => {
      const context = createBaseContext({
        requestTimestamp: new Date('2025-01-15T14:00:00Z'),
        orgLeaseHistory: [
          createLease({ uuid: '1', status: 'BudgetExceeded', created: '2024-09-01T10:00:00Z' }), // > 90 days ago, ignored
          createLease({ uuid: '2', status: 'Active', created: '2025-01-01T10:00:00Z' }),
          createLease({ uuid: '3', status: 'Active', created: '2024-12-20T10:00:00Z' }),
          createLease({ uuid: '4', status: 'Active', created: '2024-12-15T10:00:00Z' }),
          createLease({ uuid: '5', status: 'Active', created: '2024-12-10T10:00:00Z' }),
          createLease({ uuid: '6', status: 'Active', created: '2024-12-05T10:00:00Z' }),
        ],
      });
      const result = orgCleanRecordRule(context, -2);
      expect(result.points).toBe(-2); // Only recent history counts (5 clean leases)
      expect(result.triggered).toBe(true);
    });

    it('should treat Expired in org history as negative outcome', () => {
      const context = createBaseContext({
        requestTimestamp: new Date('2025-01-15T14:00:00Z'),
        orgLeaseHistory: [
          createLease({ uuid: '1', status: 'Active', created: '2025-01-01T10:00:00Z' }),
          createLease({ uuid: '2', status: 'Active', created: '2024-12-20T10:00:00Z' }),
          createLease({ uuid: '3', status: 'Expired', created: '2024-12-15T10:00:00Z' }), // Negative
          createLease({ uuid: '4', status: 'Active', created: '2024-12-10T10:00:00Z' }),
          createLease({ uuid: '5', status: 'Active', created: '2024-12-05T10:00:00Z' }),
        ],
      });
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

    it('should return weight for group mailbox detected (returning user)', () => {
      const context = createBaseContext({
        userLeaseHistory: [createLease()], // Has history = not first-time
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

    it('should defer to Rule #4 for first-time user with group mailbox (AC2: no double-counting)', () => {
      // First-time user (empty history) with group mailbox
      const context = createBaseContext({
        userLeaseHistory: [], // No history = first-time
        aiAnalysis: { isGroupMailbox: true, isOutsideTargetAudience: false, confidence: 0.9 },
      });
      const result = groupMailboxDetectedRule(context, 20);

      // Rule #16 should NOT fire - Rule #4 (first_time_suspicious) handles it
      expect(result.points).toBe(0);
      expect(result.triggered).toBe(false);
      expect(result.reason).toBe('Handled by first_time_suspicious rule');
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
