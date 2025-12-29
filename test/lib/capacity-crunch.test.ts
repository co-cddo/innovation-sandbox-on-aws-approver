import { describe, it, expect } from 'vitest';
import type { Account } from '../../src/lib/types.js';
import type { AccountReadinessResult } from '../../src/lib/account-cooldown.js';
import {
  analyzeCapacityStatus,
  shouldSendCapacityCrunchAlert,
  buildCapacityCrunchAlert,
  buildCapacityCrunchMessage,
} from '../../src/lib/capacity-crunch.js';

describe('capacity-crunch', () => {
  // Helper to create test accounts
  const createAccount = (status: 'Available' | 'Active' = 'Available'): Account => ({
    awsAccountId: '123456789012',
    name: 'pool-001',
    status,
    meta: {
      createdTime: '2025-01-01T00:00:00Z',
      lastEditTime: '2025-01-01T00:00:00Z',
    },
  });

  // Helper to create readiness result
  const createReadinessResult = (
    ready: number,
    cooling: number,
    active: number,
    estimatedReadyTime: Date | null = null
  ): AccountReadinessResult => ({
    hasReadyAccount: ready > 0,
    readyAccounts: Array(ready)
      .fill(null)
      .map(() => createAccount('Available')),
    coolingAccounts: Array(cooling)
      .fill(null)
      .map(() => createAccount('Available')),
    activeAccounts: Array(active)
      .fill(null)
      .map(() => createAccount('Active')),
    estimatedReadyTime,
  });

  describe('analyzeCapacityStatus', () => {
    it('detects capacity crunch when all accounts are active', () => {
      const readiness = createReadinessResult(0, 0, 8); // 8 active, 0 available
      const status = analyzeCapacityStatus(readiness, 5);

      expect(status.isCapacityCrunch).toBe(true);
      expect(status.totalAccounts).toBe(8);
      expect(status.activeCount).toBe(8);
      expect(status.availableCount).toBe(0);
      expect(status.pendingRequests).toBe(5);
    });

    it('does not detect capacity crunch when some accounts are cooling', () => {
      const readiness = createReadinessResult(0, 3, 5); // 5 active, 3 cooling
      const status = analyzeCapacityStatus(readiness, 2);

      expect(status.isCapacityCrunch).toBe(false);
      expect(status.availableCount).toBe(3);
      expect(status.coolingCount).toBe(3);
    });

    it('does not detect capacity crunch when ready accounts exist', () => {
      const readiness = createReadinessResult(2, 1, 5); // 2 ready, 1 cooling, 5 active
      const status = analyzeCapacityStatus(readiness, 0);

      expect(status.isCapacityCrunch).toBe(false);
      expect(status.readyCount).toBe(2);
    });

    it('calculates soonest available hours from estimated time', () => {
      const now = new Date('2025-01-02T12:00:00Z');
      const estimatedReady = new Date('2025-01-02T18:00:00Z'); // 6 hours from now

      const readiness = createReadinessResult(0, 2, 6, estimatedReady);
      const status = analyzeCapacityStatus(readiness, 3, now);

      expect(status.soonestAvailableHours).toBe(6);
    });

    it('returns null soonest hours when no estimated time', () => {
      const readiness = createReadinessResult(0, 0, 8, null);
      const status = analyzeCapacityStatus(readiness, 2);

      expect(status.soonestAvailableHours).toBeNull();
    });

    it('handles no accounts gracefully', () => {
      const readiness = createReadinessResult(0, 0, 0);
      const status = analyzeCapacityStatus(readiness, 0);

      expect(status.isCapacityCrunch).toBe(false);
      expect(status.totalAccounts).toBe(0);
    });
  });

  describe('shouldSendCapacityCrunchAlert', () => {
    it('returns false when not in capacity crunch', () => {
      const result = shouldSendCapacityCrunchAlert(false, null);
      expect(result).toBe(false);
    });

    it('returns true when in capacity crunch and never alerted', () => {
      const result = shouldSendCapacityCrunchAlert(true, null);
      expect(result).toBe(true);
    });

    it('returns false when in capacity crunch but alerted recently', () => {
      const now = new Date('2025-01-02T12:00:00Z');
      const lastAlert = new Date('2025-01-02T11:30:00Z'); // 30 minutes ago

      const result = shouldSendCapacityCrunchAlert(true, lastAlert, now);
      expect(result).toBe(false);
    });

    it('returns true when in capacity crunch and throttle period passed', () => {
      const now = new Date('2025-01-02T12:00:00Z');
      const lastAlert = new Date('2025-01-02T10:59:00Z'); // 61 minutes ago

      const result = shouldSendCapacityCrunchAlert(true, lastAlert, now);
      expect(result).toBe(true);
    });

    it('respects custom throttle period', () => {
      const now = new Date('2025-01-02T12:00:00Z');
      const lastAlert = new Date('2025-01-02T11:30:00Z'); // 30 minutes ago

      // With 30 minute throttle, should be allowed
      const result = shouldSendCapacityCrunchAlert(true, lastAlert, now, 30);
      expect(result).toBe(true);
    });

    it('returns true at exactly throttle boundary', () => {
      const now = new Date('2025-01-02T12:00:00Z');
      const lastAlert = new Date('2025-01-02T11:00:00Z'); // Exactly 60 minutes ago

      const result = shouldSendCapacityCrunchAlert(true, lastAlert, now, 60);
      expect(result).toBe(true);
    });
  });

  describe('buildCapacityCrunchAlert', () => {
    it('builds alert with all fields', () => {
      const status = {
        isCapacityCrunch: true,
        totalAccounts: 8,
        activeCount: 8,
        availableCount: 0,
        readyCount: 0,
        coolingCount: 0,
        pendingRequests: 5,
        soonestAvailableHours: 6,
      };

      const alert = buildCapacityCrunchAlert(status);

      expect(alert.alertType).toBe('capacity_crunch');
      expect(alert.activeAccounts).toBe(8);
      expect(alert.availableAccounts).toBe(0);
      expect(alert.pendingRequests).toBe(5);
      expect(alert.soonestAvailableHours).toBe(6);
      expect(alert.message).toContain('All sandbox accounts are in active use');
      expect(alert.message).toContain('8/8');
      expect(alert.message).toContain('5 pending requests');
      expect(alert.message).toContain('~6 hours');
      expect(alert.message).toContain('Consider provisioning');
    });

    it('handles unknown soonest availability', () => {
      const status = {
        isCapacityCrunch: true,
        totalAccounts: 8,
        activeCount: 8,
        availableCount: 0,
        readyCount: 0,
        coolingCount: 0,
        pendingRequests: 3,
        soonestAvailableHours: null,
      };

      const alert = buildCapacityCrunchAlert(status);

      expect(alert.message).toContain('unknown');
    });
  });

  describe('buildCapacityCrunchMessage', () => {
    it('builds user-friendly message with reference', () => {
      const message = buildCapacityCrunchMessage('ISB-2025-0042');

      expect(message).toContain('Your request has been received');
      expect(message).toContain('All sandbox sessions are currently in active use');
      expect(message).toContain('36-48 hours');
      expect(message).toContain('Our team is aware');
      expect(message).toContain("You'll be notified");
      expect(message).toContain('Reference: ISB-2025-0042');
    });

    it('uses neutral language without technical jargon', () => {
      const message = buildCapacityCrunchMessage('ISB-2025-0042');

      expect(message).not.toContain('capacity');
      expect(message).not.toContain('crunch');
      expect(message).not.toContain('Active');
      expect(message).not.toContain('cooldown');
    });
  });
});
