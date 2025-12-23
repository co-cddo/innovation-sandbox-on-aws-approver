/**
 * Tests for domain verification utility.
 * Story 3.3: Domain Verification from S3 Cache - AC2, AC3, AC4
 */

import { describe, it, expect } from 'vitest';
import { isVerifiedGovDomain } from '../../src/lib/domain-verification.js';

describe('isVerifiedGovDomain', () => {
  describe('exact domain matching (AC2)', () => {
    it('should return true for exact domain match', () => {
      const allowlist = ['councilname.gov.uk', 'another.gov.uk'];
      expect(isVerifiedGovDomain('councilname.gov.uk', allowlist)).toBe(true);
    });

    it('should return false for non-matching domain', () => {
      const allowlist = ['councilname.gov.uk'];
      expect(isVerifiedGovDomain('other.gov.uk', allowlist)).toBe(false);
    });

    it('should return false for empty allowlist', () => {
      expect(isVerifiedGovDomain('any.gov.uk', [])).toBe(false);
    });
  });

  describe('case insensitivity (AC2)', () => {
    it('should match case-insensitively', () => {
      const allowlist = ['CouncilName.GOV.UK'];
      expect(isVerifiedGovDomain('councilname.gov.uk', allowlist)).toBe(true);
    });

    it('should handle uppercase input domain', () => {
      const allowlist = ['councilname.gov.uk'];
      expect(isVerifiedGovDomain('COUNCILNAME.GOV.UK', allowlist)).toBe(true);
    });

    it('should handle mixed case in both', () => {
      const allowlist = ['Council.GOV.uk'];
      expect(isVerifiedGovDomain('COUNCIL.gov.UK', allowlist)).toBe(true);
    });
  });

  describe('wildcard pattern matching (AC2)', () => {
    it('should match wildcard pattern *.gov.uk', () => {
      const allowlist = ['*.gov.uk'];
      expect(isVerifiedGovDomain('council.gov.uk', allowlist)).toBe(true);
    });

    it('should match subdomain with wildcard', () => {
      const allowlist = ['*.council.gov.uk'];
      expect(isVerifiedGovDomain('finance.council.gov.uk', allowlist)).toBe(true);
    });

    it('should not match when wildcard does not apply', () => {
      const allowlist = ['*.specific.gov.uk'];
      expect(isVerifiedGovDomain('other.gov.uk', allowlist)).toBe(false);
    });

    it('should handle case-insensitive wildcard matching', () => {
      const allowlist = ['*.GOV.UK'];
      expect(isVerifiedGovDomain('council.gov.uk', allowlist)).toBe(true);
    });
  });

  describe('verified domain (AC3)', () => {
    it('should return true for verified local authority domain', () => {
      const allowlist = ['local-council.gov.uk', 'city-council.gov.uk'];
      expect(isVerifiedGovDomain('local-council.gov.uk', allowlist)).toBe(true);
    });

    it('should identify all matching domains as verified', () => {
      const allowlist = ['a.gov.uk', 'b.gov.uk', 'c.gov.uk'];
      expect(isVerifiedGovDomain('a.gov.uk', allowlist)).toBe(true);
      expect(isVerifiedGovDomain('b.gov.uk', allowlist)).toBe(true);
      expect(isVerifiedGovDomain('c.gov.uk', allowlist)).toBe(true);
    });
  });

  describe('non-verified domain (AC4)', () => {
    it('should return false for domain not in allowlist', () => {
      const allowlist = ['council.gov.uk'];
      expect(isVerifiedGovDomain('unknown-domain.com', allowlist)).toBe(false);
    });

    it('should return false for partial match (not exact)', () => {
      const allowlist = ['council.gov.uk'];
      // 'subcouncil.gov.uk' is NOT the same as 'council.gov.uk'
      expect(isVerifiedGovDomain('subcouncil.gov.uk', allowlist)).toBe(false);
    });

    it('should return false for domain that contains allowlisted domain as substring', () => {
      const allowlist = ['gov.uk'];
      // 'fakegov.uk' should not match 'gov.uk' via exact match
      expect(isVerifiedGovDomain('fakegov.uk', allowlist)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle empty domain string', () => {
      const allowlist = ['council.gov.uk'];
      expect(isVerifiedGovDomain('', allowlist)).toBe(false);
    });

    it('should handle domain with trailing dots', () => {
      const allowlist = ['council.gov.uk'];
      // Domains should be normalized - trailing dot is DNS root
      expect(isVerifiedGovDomain('council.gov.uk.', allowlist)).toBe(false);
    });

    it('should handle multiple wildcards in allowlist', () => {
      const allowlist = ['*.council.gov.uk', '*.city.gov.uk'];
      expect(isVerifiedGovDomain('dept.council.gov.uk', allowlist)).toBe(true);
      expect(isVerifiedGovDomain('dept.city.gov.uk', allowlist)).toBe(true);
      expect(isVerifiedGovDomain('dept.other.gov.uk', allowlist)).toBe(false);
    });

    it('should handle mix of exact and wildcard patterns', () => {
      const allowlist = ['exact-council.gov.uk', '*.wildcard.gov.uk'];
      expect(isVerifiedGovDomain('exact-council.gov.uk', allowlist)).toBe(true);
      expect(isVerifiedGovDomain('sub.wildcard.gov.uk', allowlist)).toBe(true);
      expect(isVerifiedGovDomain('other.gov.uk', allowlist)).toBe(false);
    });

    it('should handle domain with hyphens', () => {
      const allowlist = ['my-local-council.gov.uk'];
      expect(isVerifiedGovDomain('my-local-council.gov.uk', allowlist)).toBe(true);
    });

    it('should handle deeply nested subdomains with wildcard', () => {
      const allowlist = ['*.gov.uk'];
      expect(isVerifiedGovDomain('a.b.c.gov.uk', allowlist)).toBe(true);
    });
  });
});
