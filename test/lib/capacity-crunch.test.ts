import { describe, it, expect } from 'vitest';
import {
  analyzeCapacityStatus,
  shouldSendCapacityCrunchAlert,
  buildCapacityCrunchAlert,
  buildCapacityCrunchMessage,
  type AccountCounts,
} from '../../src/lib/capacity-crunch.js';

describe('capacity-crunch', () => {
  describe('analyzeCapacityStatus', () => {
    it('detects capacity crunch when all accounts are active', () => {
      const counts: AccountCounts = { availableCount: 0, activeCount: 8 };
      const status = analyzeCapacityStatus(counts, 5);

      expect(status.isCapacityCrunch).toBe(true);
      expect(status.totalAccounts).toBe(8);
      expect(status.activeCount).toBe(8);
      expect(status.availableCount).toBe(0);
      expect(status.pendingRequests).toBe(5);
    });

    it('does not detect capacity crunch when some accounts are available', () => {
      const counts: AccountCounts = { availableCount: 3, activeCount: 5 };
      const status = analyzeCapacityStatus(counts, 2);

      expect(status.isCapacityCrunch).toBe(false);
      expect(status.availableCount).toBe(3);
    });

    it('handles no accounts gracefully', () => {
      const counts: AccountCounts = { availableCount: 0, activeCount: 0 };
      const status = analyzeCapacityStatus(counts, 0);

      expect(status.isCapacityCrunch).toBe(false);
      expect(status.totalAccounts).toBe(0);
    });

    it('defaults pending requests to zero', () => {
      const counts: AccountCounts = { availableCount: 2, activeCount: 6 };
      const status = analyzeCapacityStatus(counts);

      expect(status.pendingRequests).toBe(0);
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
        pendingRequests: 5,
      };

      const alert = buildCapacityCrunchAlert(status);

      expect(alert.alertType).toBe('capacity_crunch');
      expect(alert.activeAccounts).toBe(8);
      expect(alert.availableAccounts).toBe(0);
      expect(alert.pendingRequests).toBe(5);
      expect(alert.message).toContain('All sandbox accounts are in active use');
      expect(alert.message).toContain('8/8');
      expect(alert.message).toContain('5 pending requests');
      expect(alert.message).toContain('Consider provisioning');
    });
  });

  describe('buildCapacityCrunchMessage', () => {
    it('builds user-friendly message with reference', () => {
      const message = buildCapacityCrunchMessage('ISB-2025-0042');

      expect(message).toContain('Your request has been received');
      expect(message).toContain('All sandbox sessions are currently in active use');
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
