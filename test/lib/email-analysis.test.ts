/**
 * Email Analysis Utility Tests
 *
 * Tests for rule-based email pattern analysis fallback.
 * Story 3.4: AC7 - Rule-based fallback scoring
 */

import { describe, it, expect } from 'vitest';
import {
  isLikelyGroupMailbox,
  isLikelyUKGovernment,
  analyzeEmailPattern,
  getMatchedGroupMailboxPrefix,
  GROUP_MAILBOX_PREFIXES,
} from '../../src/lib/email-analysis.js';

describe('Email Analysis', () => {
  describe('isLikelyGroupMailbox', () => {
    describe('should detect group mailbox prefixes (AC7)', () => {
      const groupMailboxEmails = [
        'team@council.gov.uk',
        'team.support@council.gov.uk',
        'info@council.gov.uk',
        'contact@council.gov.uk',
        'admin@council.gov.uk',
        'support@council.gov.uk',
        'helpdesk@council.gov.uk',
        'enquiries@council.gov.uk',
        'office@council.gov.uk',
        'reception@council.gov.uk',
        'general@council.gov.uk',
        'hello@council.gov.uk',
        'mail@council.gov.uk',
        'post@council.gov.uk',
        'shared@council.gov.uk',
        'noreply@council.gov.uk',
        'no-reply@council.gov.uk',
        'donotreply@council.gov.uk',
        'do-not-reply@council.gov.uk',
      ];

      it.each(groupMailboxEmails)('should detect %s as group mailbox', (email) => {
        expect(isLikelyGroupMailbox(email)).toBe(true);
      });
    });

    describe('should handle case insensitivity', () => {
      it('should detect uppercase prefixes', () => {
        expect(isLikelyGroupMailbox('TEAM@council.gov.uk')).toBe(true);
        expect(isLikelyGroupMailbox('Info@council.gov.uk')).toBe(true);
        expect(isLikelyGroupMailbox('ADMIN@council.gov.uk')).toBe(true);
      });

      it('should detect mixed case prefixes', () => {
        expect(isLikelyGroupMailbox('TeAm@council.gov.uk')).toBe(true);
        expect(isLikelyGroupMailbox('HelpDesk@council.gov.uk')).toBe(true);
      });
    });

    describe('should not flag personal emails', () => {
      const personalEmails = [
        'john.smith@council.gov.uk',
        'sarah.jones@council.gov.uk',
        'j.smith@council.gov.uk',
        'firstname.lastname@council.gov.uk',
        'user123@council.gov.uk',
        'ceo@council.gov.uk',
        'developer@council.gov.uk',
        'analyst@council.gov.uk',
      ];

      it.each(personalEmails)('should not flag %s as group mailbox', (email) => {
        expect(isLikelyGroupMailbox(email)).toBe(false);
      });
    });

    describe('should detect prefix at start only', () => {
      it('should not flag emails with prefix in middle', () => {
        expect(isLikelyGroupMailbox('john.team@council.gov.uk')).toBe(false);
        expect(isLikelyGroupMailbox('user.info@council.gov.uk')).toBe(false);
        expect(isLikelyGroupMailbox('my.admin@council.gov.uk')).toBe(false);
      });

      it('should detect prefix with additional characters', () => {
        expect(isLikelyGroupMailbox('team-finance@council.gov.uk')).toBe(true);
        expect(isLikelyGroupMailbox('info.housing@council.gov.uk')).toBe(true);
        expect(isLikelyGroupMailbox('admin_user@council.gov.uk')).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('should handle empty string', () => {
        expect(isLikelyGroupMailbox('')).toBe(false);
      });

      it('should handle email without @ symbol', () => {
        expect(isLikelyGroupMailbox('teamcouncil.gov.uk')).toBe(true);
      });

      it('should handle email with multiple @ symbols', () => {
        expect(isLikelyGroupMailbox('team@test@council.gov.uk')).toBe(true);
      });
    });
  });

  describe('isLikelyUKGovernment', () => {
    describe('should detect UK government domains', () => {
      const govDomains = [
        'user@council.gov.uk',
        'user@example.gov.uk',
        'user@department.gov.scot',
        'user@department.gov.wales',
        'user@constabulary.police.uk',
        'user@trust.nhs.uk',
        'user@university.ac.uk',
        'user@school.sch.uk',
      ];

      it.each(govDomains)('should detect %s as UK government', (email) => {
        expect(isLikelyUKGovernment(email)).toBe(true);
      });
    });

    describe('should not flag non-gov domains', () => {
      const nonGovDomains = [
        'user@gmail.com',
        'user@company.co.uk',
        'user@organization.org.uk',
        'user@example.com',
        'user@test.io',
        'user@govuk.com', // Fake gov domain
      ];

      it.each(nonGovDomains)('should not flag %s as UK government', (email) => {
        expect(isLikelyUKGovernment(email)).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('should handle empty string', () => {
        expect(isLikelyUKGovernment('')).toBe(false);
      });

      it('should handle email without domain', () => {
        expect(isLikelyUKGovernment('user@')).toBe(false);
      });

      it('should handle case insensitivity', () => {
        expect(isLikelyUKGovernment('user@COUNCIL.GOV.UK')).toBe(true);
        expect(isLikelyUKGovernment('user@Council.Gov.Uk')).toBe(true);
      });
    });
  });

  describe('analyzeEmailPattern', () => {
    it('should return AIAnalysisResult shape', () => {
      const result = analyzeEmailPattern('user@council.gov.uk');

      expect(result).toHaveProperty('isGroupMailbox');
      expect(result).toHaveProperty('isOutsideTargetAudience');
      expect(result).toHaveProperty('confidence');
      expect(typeof result.isGroupMailbox).toBe('boolean');
      expect(typeof result.isOutsideTargetAudience).toBe('boolean');
      expect(typeof result.confidence).toBe('number');
    });

    it('should detect group mailbox', () => {
      const result = analyzeEmailPattern('team@council.gov.uk');

      expect(result.isGroupMailbox).toBe(true);
      expect(result.confidence).toBe(0.7); // Medium confidence for rule-based
    });

    it('should not flag personal email as group mailbox', () => {
      const result = analyzeEmailPattern('john.smith@council.gov.uk');

      expect(result.isGroupMailbox).toBe(false);
      expect(result.confidence).toBe(0.5); // Lower confidence for non-matches
    });

    it('should always return false for isOutsideTargetAudience (pessimistic)', () => {
      // Pessimistic approach: don't penalize without AI confidence
      const result = analyzeEmailPattern('user@gmail.com');

      expect(result.isOutsideTargetAudience).toBe(false);
    });

    it('should handle gov domain emails', () => {
      const result = analyzeEmailPattern('john.smith@council.gov.uk');

      expect(result.isGroupMailbox).toBe(false);
      expect(result.isOutsideTargetAudience).toBe(false);
    });
  });

  describe('getMatchedGroupMailboxPrefix', () => {
    it('should return matched prefix', () => {
      expect(getMatchedGroupMailboxPrefix('team@council.gov.uk')).toBe('team');
      expect(getMatchedGroupMailboxPrefix('info.test@council.gov.uk')).toBe('info');
      expect(getMatchedGroupMailboxPrefix('admin_user@council.gov.uk')).toBe('admin');
    });

    it('should return undefined for personal emails', () => {
      expect(getMatchedGroupMailboxPrefix('john.smith@council.gov.uk')).toBeUndefined();
      expect(getMatchedGroupMailboxPrefix('user123@council.gov.uk')).toBeUndefined();
    });

    it('should handle edge cases', () => {
      expect(getMatchedGroupMailboxPrefix('')).toBeUndefined();
      expect(getMatchedGroupMailboxPrefix('user@council.gov.uk')).toBeUndefined();
    });
  });

  describe('GROUP_MAILBOX_PREFIXES', () => {
    it('should include all required prefixes from AC7', () => {
      // From the story AC7: team, info, contact, admin, support, helpdesk, enquiries
      const requiredPrefixes = ['team', 'info', 'contact', 'admin', 'support', 'helpdesk', 'enquiries'];

      requiredPrefixes.forEach((prefix) => {
        expect(GROUP_MAILBOX_PREFIXES).toContain(prefix);
      });
    });

    it('should be a readonly array', () => {
      // TypeScript should prevent modification, but we can check it's an array
      expect(Array.isArray(GROUP_MAILBOX_PREFIXES)).toBe(true);
      expect(GROUP_MAILBOX_PREFIXES.length).toBeGreaterThan(7);
    });
  });
});
