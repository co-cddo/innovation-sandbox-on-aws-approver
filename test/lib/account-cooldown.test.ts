import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Account } from '../../src/lib/types.js';
import {
  isAccountReady,
  checkAccountReadiness,
  calculateReadyTime,
  getConfigFromEnvironment,
  DEFAULT_COOLDOWN_CONFIG,
  type AccountCooldownConfig,
} from '../../src/lib/account-cooldown.js';

describe('account-cooldown', () => {
  // Helper to create a test account
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

  describe('isAccountReady', () => {
    const config = DEFAULT_COOLDOWN_CONFIG;

    it('returns false for Active accounts', () => {
      const account = createAccount({ status: 'Active' });
      const now = new Date('2025-01-03T00:00:00Z'); // 48 hours later
      expect(isAccountReady(account, now, config)).toBe(false);
    });

    it('returns true for Available account past 24hr cooldown', () => {
      const account = createAccount({
        status: 'Available',
        lastEditTime: '2025-01-01T00:00:00Z',
        createdTime: '2024-12-01T00:00:00Z', // Not a new account
      });
      const now = new Date('2025-01-02T00:00:00Z'); // Exactly 24 hours later
      expect(isAccountReady(account, now, config)).toBe(true);
    });

    it('returns true for Available account exactly at 24hr boundary', () => {
      const account = createAccount({
        status: 'Available',
        lastEditTime: '2025-01-01T10:00:00Z',
        createdTime: '2024-12-01T00:00:00Z',
      });
      const now = new Date('2025-01-02T10:00:00Z'); // Exactly 24 hours
      expect(isAccountReady(account, now, config)).toBe(true);
    });

    it('returns false for Available account at 23h 59m (still cooling)', () => {
      const account = createAccount({
        status: 'Available',
        lastEditTime: '2025-01-01T10:00:00Z',
        createdTime: '2024-12-01T00:00:00Z',
      });
      const now = new Date('2025-01-02T09:59:00Z'); // 23 hours 59 minutes
      expect(isAccountReady(account, now, config)).toBe(false);
    });

    it('returns true for brand new account within grace period (59 minutes)', () => {
      const account = createAccount({
        status: 'Available',
        createdTime: '2025-01-01T10:00:00Z',
        lastEditTime: '2025-01-01T10:00:00Z',
      });
      const now = new Date('2025-01-01T10:59:00Z'); // 59 minutes since creation
      expect(isAccountReady(account, now, config)).toBe(true);
    });

    it('returns false for new account at 61 minutes (uses cooldown rule)', () => {
      const account = createAccount({
        status: 'Available',
        createdTime: '2025-01-01T10:00:00Z',
        lastEditTime: '2025-01-01T10:00:00Z',
      });
      const now = new Date('2025-01-01T11:01:00Z'); // 61 minutes since creation
      // Now it uses cooldown rule: lastEditTime needs to be 24hr ago
      expect(isAccountReady(account, now, config)).toBe(false);
    });

    it('handles BST/GMT boundary correctly (always uses UTC)', () => {
      // Account last edited at 08:00 UTC on day 1
      const account = createAccount({
        status: 'Available',
        lastEditTime: '2025-03-30T08:00:00Z', // BST transition day in UK
        createdTime: '2025-01-01T00:00:00Z',
      });

      // Check at 08:01 UTC next day (24h 1min later)
      const now = new Date('2025-03-31T08:01:00Z');
      expect(isAccountReady(account, now, config)).toBe(true);

      // Check at 07:59 UTC next day (23h 59min later)
      const nowBefore = new Date('2025-03-31T07:59:00Z');
      expect(isAccountReady(account, nowBefore, config)).toBe(false);
    });

    it('respects custom cooldown hours configuration', () => {
      const customConfig: AccountCooldownConfig = {
        cooldownHours: 48, // 48 hour cooldown
        newAccountGraceMinutes: 60,
      };

      const account = createAccount({
        status: 'Available',
        lastEditTime: '2025-01-01T00:00:00Z',
        createdTime: '2024-12-01T00:00:00Z',
      });

      // At 24 hours - still cooling with 48hr config
      const now24h = new Date('2025-01-02T00:00:00Z');
      expect(isAccountReady(account, now24h, customConfig)).toBe(false);

      // At 48 hours - ready
      const now48h = new Date('2025-01-03T00:00:00Z');
      expect(isAccountReady(account, now48h, customConfig)).toBe(true);
    });

    it('respects custom grace period configuration', () => {
      const customConfig: AccountCooldownConfig = {
        cooldownHours: 24,
        newAccountGraceMinutes: 30, // 30 minute grace period
      };

      const account = createAccount({
        status: 'Available',
        createdTime: '2025-01-01T10:00:00Z',
        lastEditTime: '2025-01-01T10:00:00Z',
      });

      // At 29 minutes - ready (within grace)
      const now29m = new Date('2025-01-01T10:29:00Z');
      expect(isAccountReady(account, now29m, customConfig)).toBe(true);

      // At 31 minutes - not ready (outside grace, needs cooldown)
      const now31m = new Date('2025-01-01T10:31:00Z');
      expect(isAccountReady(account, now31m, customConfig)).toBe(false);
    });
  });

  describe('checkAccountReadiness', () => {
    const config = DEFAULT_COOLDOWN_CONFIG;

    it('correctly categorizes mix of ready, cooling, and active accounts', () => {
      const now = new Date('2025-01-03T12:00:00Z');

      const accounts: Account[] = [
        // Ready: Available and cooled (48+ hours since lastEdit)
        createAccount({
          awsAccountId: '111111111111',
          name: 'pool-001',
          status: 'Available',
          lastEditTime: '2025-01-01T00:00:00Z',
          createdTime: '2024-12-01T00:00:00Z',
        }),
        // Cooling: Available but only 12 hours since lastEdit
        createAccount({
          awsAccountId: '222222222222',
          name: 'pool-002',
          status: 'Available',
          lastEditTime: '2025-01-03T00:00:00Z', // 12 hours ago
          createdTime: '2024-12-01T00:00:00Z',
        }),
        // Active: In use
        createAccount({
          awsAccountId: '333333333333',
          name: 'pool-003',
          status: 'Active',
          lastEditTime: '2025-01-03T10:00:00Z',
          createdTime: '2024-12-01T00:00:00Z',
        }),
        // Ready: Brand new within grace period
        createAccount({
          awsAccountId: '444444444444',
          name: 'pool-004',
          status: 'Available',
          createdTime: '2025-01-03T11:30:00Z', // 30 minutes old
          lastEditTime: '2025-01-03T11:30:00Z',
        }),
      ];

      const result = checkAccountReadiness(accounts, now, config);

      expect(result.hasReadyAccount).toBe(true);
      expect(result.readyAccounts).toHaveLength(2); // pool-001 and pool-004
      expect(result.coolingAccounts).toHaveLength(1); // pool-002
      expect(result.activeAccounts).toHaveLength(1); // pool-003
    });

    it('returns hasReadyAccount=false when no accounts are ready', () => {
      const now = new Date('2025-01-01T12:00:00Z');

      const accounts: Account[] = [
        // Cooling: only 6 hours old
        createAccount({
          status: 'Available',
          lastEditTime: '2025-01-01T06:00:00Z',
          createdTime: '2024-12-01T00:00:00Z',
        }),
        // Active
        createAccount({
          status: 'Active',
          lastEditTime: '2025-01-01T10:00:00Z',
          createdTime: '2024-12-01T00:00:00Z',
        }),
      ];

      const result = checkAccountReadiness(accounts, now, config);

      expect(result.hasReadyAccount).toBe(false);
      expect(result.readyAccounts).toHaveLength(0);
    });

    it('calculates estimatedReadyTime from soonest cooling account', () => {
      const now = new Date('2025-01-02T12:00:00Z');

      const accounts: Account[] = [
        // Will be ready in 6 hours (at 2025-01-02T18:00:00Z)
        createAccount({
          awsAccountId: '111111111111',
          status: 'Available',
          lastEditTime: '2025-01-01T18:00:00Z',
          createdTime: '2024-12-01T00:00:00Z',
        }),
        // Will be ready in 12 hours (at 2025-01-03T00:00:00Z)
        createAccount({
          awsAccountId: '222222222222',
          status: 'Available',
          lastEditTime: '2025-01-02T00:00:00Z',
          createdTime: '2024-12-01T00:00:00Z',
        }),
      ];

      const result = checkAccountReadiness(accounts, now, config);

      expect(result.estimatedReadyTime).not.toBeNull();
      expect(result.estimatedReadyTime?.toISOString()).toBe('2025-01-02T18:00:00.000Z');
    });

    it('returns estimatedReadyTime=null when no cooling accounts', () => {
      const now = new Date('2025-01-03T12:00:00Z');

      const accounts: Account[] = [
        // Ready account
        createAccount({
          status: 'Available',
          lastEditTime: '2025-01-01T00:00:00Z',
          createdTime: '2024-12-01T00:00:00Z',
        }),
        // Active account
        createAccount({
          status: 'Active',
          lastEditTime: '2025-01-03T10:00:00Z',
          createdTime: '2024-12-01T00:00:00Z',
        }),
      ];

      const result = checkAccountReadiness(accounts, now, config);

      expect(result.coolingAccounts).toHaveLength(0);
      expect(result.estimatedReadyTime).toBeNull();
    });

    it('handles empty account list', () => {
      const now = new Date('2025-01-03T12:00:00Z');
      const result = checkAccountReadiness([], now, config);

      expect(result.hasReadyAccount).toBe(false);
      expect(result.readyAccounts).toHaveLength(0);
      expect(result.coolingAccounts).toHaveLength(0);
      expect(result.activeAccounts).toHaveLength(0);
      expect(result.estimatedReadyTime).toBeNull();
    });

    it('handles all accounts being active', () => {
      const now = new Date('2025-01-03T12:00:00Z');

      const accounts: Account[] = [
        createAccount({ status: 'Active' }),
        createAccount({ status: 'Active' }),
      ];

      const result = checkAccountReadiness(accounts, now, config);

      expect(result.hasReadyAccount).toBe(false);
      expect(result.activeAccounts).toHaveLength(2);
      expect(result.readyAccounts).toHaveLength(0);
      expect(result.coolingAccounts).toHaveLength(0);
    });
  });

  describe('calculateReadyTime', () => {
    it('calculates correct ready time for 24hr cooldown', () => {
      const account = createAccount({
        lastEditTime: '2025-01-01T10:30:00Z',
      });

      const readyTime = calculateReadyTime(account, DEFAULT_COOLDOWN_CONFIG);

      expect(readyTime.toISOString()).toBe('2025-01-02T10:30:00.000Z');
    });

    it('respects custom cooldown hours', () => {
      const account = createAccount({
        lastEditTime: '2025-01-01T10:30:00Z',
      });

      const customConfig = { ...DEFAULT_COOLDOWN_CONFIG, cooldownHours: 48 };
      const readyTime = calculateReadyTime(account, customConfig);

      expect(readyTime.toISOString()).toBe('2025-01-03T10:30:00.000Z');
    });
  });

  describe('getConfigFromEnvironment', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('returns default config when environment variables not set', () => {
      delete process.env.ACCOUNT_COOLDOWN_HOURS;
      delete process.env.NEW_ACCOUNT_GRACE_MINUTES;

      const config = getConfigFromEnvironment();

      expect(config.cooldownHours).toBe(24);
      expect(config.newAccountGraceMinutes).toBe(60);
    });

    it('reads ACCOUNT_COOLDOWN_HOURS from environment', () => {
      process.env.ACCOUNT_COOLDOWN_HOURS = '48';

      const config = getConfigFromEnvironment();

      expect(config.cooldownHours).toBe(48);
    });

    it('reads NEW_ACCOUNT_GRACE_MINUTES from environment', () => {
      process.env.NEW_ACCOUNT_GRACE_MINUTES = '30';

      const config = getConfigFromEnvironment();

      expect(config.newAccountGraceMinutes).toBe(30);
    });

    it('falls back to defaults for invalid values', () => {
      process.env.ACCOUNT_COOLDOWN_HOURS = 'invalid';
      process.env.NEW_ACCOUNT_GRACE_MINUTES = 'NaN';

      const config = getConfigFromEnvironment();

      expect(config.cooldownHours).toBe(24);
      expect(config.newAccountGraceMinutes).toBe(60);
    });
  });
});
