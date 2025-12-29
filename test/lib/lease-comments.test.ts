/**
 * Lease Comments Message Builder Tests (Story 5.1)
 *
 * Tests for lease status message formatting with neutral language.
 */

import { describe, it, expect } from 'vitest';
import {
  buildAutoApprovedMessage,
  buildAllowListApprovedMessage,
  buildEscalatedMessage,
  buildDelayedMessage,
  buildQueuedMessage,
  buildExpiredMessage,
  buildCooldownDelayMessage,
  buildReprocessingMessage,
  formatScoreBreakdown,
  ruleResultsToBreakdown,
} from '../../src/lib/lease-comments.js';
import type { ScoreBreakdown } from '../../src/scoring/types.js';
import type { RuleResult } from '../../src/state-machine/types.js';

describe('Lease Comments Message Builders (Story 5.1)', () => {
  const testReference = 'ISB-2025-0042';

  describe('buildAutoApprovedMessage (AC2)', () => {
    it('should format auto-approved message with score and reference', () => {
      const message = buildAutoApprovedMessage(15, testReference);

      expect(message).toContain('Your request has been automatically approved.');
      expect(message).toContain('Score: 15 (threshold: 20)');
      expect(message).toContain(`Reference: ${testReference}`);
    });

    it('should use custom threshold when provided', () => {
      const message = buildAutoApprovedMessage(10, testReference, 15);

      expect(message).toContain('Score: 10 (threshold: 15)');
    });

    it('should format zero score correctly', () => {
      const message = buildAutoApprovedMessage(0, testReference);

      expect(message).toContain('Score: 0 (threshold: 20)');
    });
  });

  describe('buildAllowListApprovedMessage (AC3)', () => {
    it('should format allow-list approved message with override indicator', () => {
      const message = buildAllowListApprovedMessage(25, testReference);

      expect(message).toContain('ALLOW-LIST-OVERRIDE');
      expect(message).toContain('automatically approved');
      expect(message).toContain('Score: 25 (for reference only)');
      expect(message).toContain(`Reference: ${testReference}`);
    });

    it('should indicate score is for reference only', () => {
      const message = buildAllowListApprovedMessage(0, testReference);

      expect(message).toContain('(for reference only)');
      expect(message).not.toContain('threshold');
    });
  });

  describe('formatScoreBreakdown', () => {
    it('should format positive points with plus sign', () => {
      const breakdown: ScoreBreakdown = {
        first_time_user: 5,
        group_mailbox: 20,
      };

      const result = formatScoreBreakdown(breakdown);

      expect(result).toContain('- first_time_user: +5');
      expect(result).toContain('- group_mailbox: +20');
    });

    it('should format negative points with minus sign', () => {
      const breakdown: ScoreBreakdown = {
        verified_gov_domain: -5,
        familiar_template: -1,
      };

      const result = formatScoreBreakdown(breakdown);

      expect(result).toContain('- verified_gov_domain: -5');
      expect(result).toContain('- familiar_template: -1');
    });

    it('should filter out zero-value rules', () => {
      const breakdown: ScoreBreakdown = {
        first_time_user: 5,
        expired_leases: 0,
        verified_gov_domain: -5,
      };

      const result = formatScoreBreakdown(breakdown);

      expect(result).toContain('first_time_user');
      expect(result).toContain('verified_gov_domain');
      expect(result).not.toContain('expired_leases');
    });

    it('should sort by absolute impact (highest first)', () => {
      const breakdown: ScoreBreakdown = {
        first_time_user: 5,
        group_mailbox: 20,
        verified_gov_domain: -10,
      };

      const result = formatScoreBreakdown(breakdown);
      const lines = result.split('\n');

      // group_mailbox (20) should come first, then verified_gov_domain (10), then first_time_user (5)
      expect(lines[0]).toContain('group_mailbox');
      expect(lines[1]).toContain('verified_gov_domain');
      expect(lines[2]).toContain('first_time_user');
    });

    it('should return default message when no rules triggered', () => {
      const breakdown: ScoreBreakdown = {
        first_time_user: 0,
        expired_leases: 0,
      };

      const result = formatScoreBreakdown(breakdown);

      expect(result).toBe('- No rules triggered');
    });

    it('should handle empty breakdown', () => {
      const breakdown: ScoreBreakdown = {};

      const result = formatScoreBreakdown(breakdown);

      expect(result).toBe('- No rules triggered');
    });
  });

  describe('buildEscalatedMessage (AC4)', () => {
    it('should format escalated message with neutral language', () => {
      const breakdown: ScoreBreakdown = {
        first_time_user: 5,
        group_mailbox: 20,
      };

      const message = buildEscalatedMessage(25, breakdown, testReference);

      expect(message).toContain('Your request requires additional review.');
      expect(message).toContain('Score: 25 (threshold: 20)');
      expect(message).toContain('Score breakdown:');
      expect(message).toContain('- first_time_user: +5');
      expect(message).toContain('- group_mailbox: +20');
      expect(message).toContain('forwarded to the NDX team');
      expect(message).toContain('may be in touch');
      expect(message).toContain(`Reference: ${testReference}`);
    });

    it('should not use accusatory language', () => {
      const breakdown: ScoreBreakdown = {
        group_mailbox: 20,
      };

      const message = buildEscalatedMessage(20, breakdown, testReference);

      expect(message).not.toContain('rejected');
      expect(message).not.toContain('denied');
      expect(message).not.toContain('suspicious');
      expect(message).not.toContain('flagged');
      expect(message).not.toContain('blocked');
    });

    it('should include custom threshold', () => {
      const breakdown: ScoreBreakdown = { first_time_user: 5 };

      const message = buildEscalatedMessage(30, breakdown, testReference, 25);

      expect(message).toContain('Score: 30 (threshold: 25)');
    });
  });

  describe('buildDelayedMessage (AC5)', () => {
    it('should format delayed message with business hours info', () => {
      const message = buildDelayedMessage(testReference);

      expect(message).toContain('Your request has been received.');
      expect(message).toContain('outside of our');
      expect(message).toContain('processing hours');
      expect(message).toContain('7am-7pm London time, weekdays');
      expect(message).toContain('next available window');
      expect(message).toContain(`Reference: ${testReference}`);
    });

    it('should be informative about the delay reason', () => {
      const message = buildDelayedMessage(testReference);

      expect(message).toContain('submitted outside');
      expect(message).toContain('will be processed');
    });
  });

  describe('buildQueuedMessage (AC6)', () => {
    it('should format queued message with position', () => {
      const message = buildQueuedMessage(3, testReference);

      expect(message).toContain('Your request has been received.');
      expect(message).toContain('sandbox accounts are currently in use');
      expect(message).toContain('queued');
      expect(message).toContain('when an account becomes available');
      expect(message).toContain('Queue position: 3');
      expect(message).toContain(`Reference: ${testReference}`);
    });

    it('should handle queue position 1', () => {
      const message = buildQueuedMessage(1, testReference);

      expect(message).toContain('Queue position: 1');
    });

    it('should handle high queue position', () => {
      const message = buildQueuedMessage(25, testReference);

      expect(message).toContain('Queue position: 25');
    });
  });

  describe('buildExpiredMessage (AC7)', () => {
    it('should format expired message with default business days', () => {
      const message = buildExpiredMessage(testReference);

      expect(message).toContain('Your request has expired after 5 business days in queue.');
      expect(message).toContain('no sandbox accounts were available');
      expect(message).toContain('submit a new request');
      expect(message).toContain('if you still need access');
      expect(message).toContain(`Reference: ${testReference}`);
    });

    it('should use custom business days when provided', () => {
      const message = buildExpiredMessage(testReference, 7);

      expect(message).toContain('expired after 7 business days');
    });

    it('should explain what happened and next steps', () => {
      const message = buildExpiredMessage(testReference);

      // Should explain the situation
      expect(message).toContain('This may have occurred');
      // Should provide guidance on next steps
      expect(message).toContain('Please submit a new request');
    });
  });

  describe('ruleResultsToBreakdown', () => {
    it('should convert RuleResult array to ScoreBreakdown object', () => {
      const ruleResults: RuleResult[] = [
        { rule: 'first_time_user', points: 5, triggered: true },
        { rule: 'verified_gov_domain', points: -5, triggered: true },
      ];

      const breakdown = ruleResultsToBreakdown(ruleResults);

      expect(breakdown).toEqual({
        first_time_user: 5,
        verified_gov_domain: -5,
      });
    });

    it('should filter out zero-point rules', () => {
      const ruleResults: RuleResult[] = [
        { rule: 'first_time_user', points: 5, triggered: true },
        { rule: 'expired_leases', points: 0, triggered: false },
        { rule: 'verified_gov_domain', points: -5, triggered: true },
      ];

      const breakdown = ruleResultsToBreakdown(ruleResults);

      expect(breakdown).toEqual({
        first_time_user: 5,
        verified_gov_domain: -5,
      });
      expect('expired_leases' in breakdown).toBe(false);
    });

    it('should handle empty array', () => {
      const breakdown = ruleResultsToBreakdown([]);

      expect(breakdown).toEqual({});
    });

    it('should handle all zero-point rules', () => {
      const ruleResults: RuleResult[] = [
        { rule: 'expired_leases', points: 0, triggered: false },
        { rule: 'budget_exceeded', points: 0, triggered: false },
      ];

      const breakdown = ruleResultsToBreakdown(ruleResults);

      expect(breakdown).toEqual({});
    });

    it('should work with buildEscalatedMessage', () => {
      const ruleResults: RuleResult[] = [
        { rule: 'first_time_user', points: 5, triggered: true },
        { rule: 'group_mailbox_detected', points: 20, triggered: true },
      ];

      const breakdown = ruleResultsToBreakdown(ruleResults);
      const message = buildEscalatedMessage(25, breakdown, 'ISB-2025-0042');

      expect(message).toContain('first_time_user: +5');
      expect(message).toContain('group_mailbox_detected: +20');
    });
  });

  describe('Reference number format (AC8)', () => {
    it('should include reference number in all message types', () => {
      const breakdown: ScoreBreakdown = { first_time_user: 5 };

      const messages = [
        buildAutoApprovedMessage(10, testReference),
        buildAllowListApprovedMessage(10, testReference),
        buildEscalatedMessage(25, breakdown, testReference),
        buildDelayedMessage(testReference),
        buildQueuedMessage(1, testReference),
        buildExpiredMessage(testReference),
      ];

      messages.forEach((message, index) => {
        expect(message, `Message type ${index} should include reference`).toContain(testReference);
      });
    });

    it('should format reference number consistently', () => {
      const ref = 'ISB-2025-9999';
      const message = buildAutoApprovedMessage(10, ref);

      expect(message).toContain(`Reference: ${ref}`);
    });
  });

  describe('buildCooldownDelayMessage (Epic 6)', () => {
    it('should include maintenance explanation and reference', () => {
      const message = buildCooldownDelayMessage(testReference);

      expect(message).toContain('Your request has been received');
      expect(message).toContain('routine maintenance');
      expect(message).toContain('will be processed automatically');
      expect(message).toContain(`Reference: ${testReference}`);
    });

    it('should include estimated availability when provided', () => {
      const estimatedTime = '2025-01-02T14:00:00Z';
      const message = buildCooldownDelayMessage(testReference, estimatedTime);

      expect(message).toContain(`Estimated availability: ${estimatedTime}`);
    });

    it('should not include estimated availability when not provided', () => {
      const message = buildCooldownDelayMessage(testReference);

      expect(message).not.toContain('Estimated availability');
    });

    it('should use neutral language (no technical jargon)', () => {
      const message = buildCooldownDelayMessage(testReference);

      // Should NOT contain technical terms
      expect(message).not.toContain('cooldown');
      expect(message).not.toContain('billing');
      expect(message).not.toContain('24 hour');
    });
  });

  describe('buildReprocessingMessage (Epic 6)', () => {
    it('should include reprocessing status and reference', () => {
      const message = buildReprocessingMessage(testReference);

      expect(message).toContain('reprocessed');
      expect(message).toContain('Account assignment is in progress');
      expect(message).toContain('No action is required');
      expect(message).toContain(`Reference: ${testReference}`);
    });

    it('should use reassuring language', () => {
      const message = buildReprocessingMessage(testReference);

      // Should be user-friendly
      expect(message).not.toContain('race condition');
      expect(message).not.toContain('TOCTOU');
      expect(message).not.toContain('error');
    });
  });
});
