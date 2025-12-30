import { describe, it, expect } from 'vitest';
import type { Account } from '../../src/lib/types.js';
import {
  calculateQueueEstimate,
  buildQueueEstimateComment,
  type QueueEstimate,
} from '../../src/lib/queue-estimate.js';
import { DEFAULT_COOLDOWN_CONFIG } from '../../src/lib/account-cooldown.js';

describe('queue-estimate', () => {
  // Helper to create test accounts
  const createAccount = (
    overrides: Partial<Account> & { lastEditTime?: string; createdTime?: string } = {}
  ): Account => ({
    awsAccountId: overrides.awsAccountId ?? '123456789012',
    name: overrides.name ?? 'pool-001',
    status: overrides.status ?? 'Available',
    meta: {
      createdTime: overrides.createdTime ?? '2025-01-01T00:00:00Z',
      lastEditTime: overrides.lastEditTime ?? '2025-01-01T00:00:00Z',
    },
  });

  describe('calculateQueueEstimate', () => {
    it('calculates estimated time from soonest cooling account', () => {
      const now = new Date('2025-01-02T12:00:00Z');

      // Account will be ready at soonest cooling account's ready time (48h after lastEdit)
      const coolingAccounts = [
        createAccount({
          name: 'pool-001',
          lastEditTime: '2025-01-01T18:00:00Z', // Ready at 2025-01-03T18:00:00Z (48h cooldown)
        }),
        createAccount({
          name: 'pool-002',
          lastEditTime: '2025-01-02T00:00:00Z', // Ready at 2025-01-04T00:00:00Z (48h cooldown)
        }),
      ];

      const result = calculateQueueEstimate(
        coolingAccounts,
        [], // No active accounts
        1, // First in queue
        1, // Queue depth
        now,
        DEFAULT_COOLDOWN_CONFIG
      );

      expect(result.position).toBe(1);
      expect(result.isCapacityCrunch).toBe(false);
      expect(result.estimatedFulfillmentTime).not.toBeNull();
      // Position 1 = soonest ready time (2025-01-03T18:00:00Z with 48h cooldown)
      expect(result.estimatedFulfillmentTime?.toISOString()).toBe('2025-01-03T18:00:00.000Z');
    });

    it('adds 4 hours per queue position ahead', () => {
      const now = new Date('2025-01-03T12:00:00Z');

      // Account will be ready at 2025-01-03T18:00:00Z (48h after lastEditTime)
      const coolingAccounts = [
        createAccount({
          lastEditTime: '2025-01-01T18:00:00Z',
        }),
      ];

      // Position 3: two people ahead, so add 8 hours
      const result = calculateQueueEstimate(
        coolingAccounts,
        [],
        3, // Third in queue
        5, // Total queue depth
        now,
        DEFAULT_COOLDOWN_CONFIG
      );

      expect(result.position).toBe(3);
      expect(result.queueDepth).toBe(5);
      expect(result.estimatedFulfillmentTime).not.toBeNull();
      // Position 3 = soonest time + (2 * 4 hours) = 18:00 + 8 hours = 02:00 next day
      expect(result.estimatedFulfillmentTime?.toISOString()).toBe('2025-01-04T02:00:00.000Z');
    });

    it('detects capacity crunch when all accounts are active', () => {
      const now = new Date('2025-01-02T12:00:00Z');

      const activeAccounts = [
        createAccount({ status: 'Active', name: 'pool-001' }),
        createAccount({ status: 'Active', name: 'pool-002' }),
      ];

      const result = calculateQueueEstimate(
        [], // No cooling accounts
        activeAccounts,
        1,
        3,
        now,
        DEFAULT_COOLDOWN_CONFIG
      );

      expect(result.isCapacityCrunch).toBe(true);
      expect(result.estimatedFulfillmentTime).toBeNull(); // Can't estimate with no cooling accounts
      expect(result.message).toContain('All sandbox sessions are currently in active use');
      expect(result.message).toContain('36-48 hours');
    });

    it('returns null estimate when no cooling accounts and no active accounts', () => {
      const now = new Date('2025-01-02T12:00:00Z');

      const result = calculateQueueEstimate([], [], 1, 1, now, DEFAULT_COOLDOWN_CONFIG);

      expect(result.isCapacityCrunch).toBe(false); // No active accounts = not a crunch
      expect(result.estimatedFulfillmentTime).toBeNull();
    });

    it('respects isCapacityCrunchOverride when account arrays are empty', () => {
      const now = new Date('2025-01-02T12:00:00Z');

      // Without override, empty arrays = not capacity crunch
      const resultWithoutOverride = calculateQueueEstimate([], [], 1, 1, now, DEFAULT_COOLDOWN_CONFIG);
      expect(resultWithoutOverride.isCapacityCrunch).toBe(false);

      // With override = true, should be capacity crunch
      const resultWithOverride = calculateQueueEstimate([], [], 1, 1, now, DEFAULT_COOLDOWN_CONFIG, {
        isCapacityCrunchOverride: true,
      });
      expect(resultWithOverride.isCapacityCrunch).toBe(true);
      expect(resultWithOverride.message).toContain('36-48 hours');
    });

    it('builds user-friendly message with queue position', () => {
      const now = new Date('2025-01-02T12:00:00Z');

      const coolingAccounts = [
        createAccount({
          lastEditTime: '2025-01-01T18:00:00Z',
        }),
      ];

      const result = calculateQueueEstimate(coolingAccounts, [], 2, 5, now, DEFAULT_COOLDOWN_CONFIG);

      expect(result.message).toContain('Your request has been received');
      expect(result.message).toContain('routine maintenance');
      expect(result.message).toContain('position 2');
      expect(result.message).toContain('estimate may change');
      // Should NOT contain technical jargon
      expect(result.message).not.toContain('cooldown');
      expect(result.message).not.toContain('24 hour');
    });

    it('handles soonest ready time in the past gracefully', () => {
      // Edge case: If somehow lastEditTime + 24hr is before now
      const now = new Date('2025-01-05T12:00:00Z');

      const coolingAccounts = [
        createAccount({
          lastEditTime: '2025-01-01T00:00:00Z', // Ready at 2025-01-02T00:00:00Z (past)
        }),
      ];

      const result = calculateQueueEstimate(coolingAccounts, [], 1, 1, now, DEFAULT_COOLDOWN_CONFIG);

      // Should use now as base time instead of past time
      expect(result.estimatedFulfillmentTime).not.toBeNull();
      expect(result.estimatedFulfillmentTime!.getTime()).toBeGreaterThanOrEqual(now.getTime());
    });

    it('includes queue depth in result', () => {
      const now = new Date('2025-01-02T12:00:00Z');
      const coolingAccounts = [createAccount({ lastEditTime: '2025-01-01T18:00:00Z' })];

      const result = calculateQueueEstimate(coolingAccounts, [], 5, 10, now, DEFAULT_COOLDOWN_CONFIG);

      expect(result.queueDepth).toBe(10);
    });
  });

  describe('buildQueueEstimateComment', () => {
    it('combines estimate message with reference number', () => {
      const estimate: QueueEstimate = {
        position: 2,
        estimatedFulfillmentTime: new Date('2025-01-02T18:00:00Z'),
        isCapacityCrunch: false,
        message: 'Your request has been received...',
        queueDepth: 3,
      };

      const comment = buildQueueEstimateComment(estimate, 'ISB-2025-0042');

      expect(comment).toContain('Your request has been received...');
      expect(comment).toContain('Reference: ISB-2025-0042');
    });
  });

  describe('capacity crunch messaging', () => {
    it('includes high demand warning for capacity crunch', () => {
      const now = new Date('2025-01-02T12:00:00Z');

      const activeAccounts = [
        createAccount({ status: 'Active' }),
        createAccount({ status: 'Active' }),
        createAccount({ status: 'Active' }),
      ];

      const result = calculateQueueEstimate([], activeAccounts, 1, 5, now, DEFAULT_COOLDOWN_CONFIG);

      expect(result.message).toContain('in active use');
      expect(result.message).toContain('36-48 hours');
      expect(result.message).toContain("You'll be notified");
      expect(result.message).not.toContain('estimate may change'); // Different message for crunch
    });
  });

  describe('time formatting', () => {
    it('formats estimated time in human-readable format', () => {
      const now = new Date('2025-01-02T12:00:00Z'); // Thursday

      const coolingAccounts = [
        createAccount({
          lastEditTime: '2025-01-01T18:00:00Z', // Ready Thursday 18:00 UTC
        }),
      ];

      const result = calculateQueueEstimate(coolingAccounts, [], 1, 1, now, DEFAULT_COOLDOWN_CONFIG);

      // Should include day name and time
      expect(result.message).toMatch(/Thursday|18:00|6:00/); // Either format is acceptable
    });
  });
});
