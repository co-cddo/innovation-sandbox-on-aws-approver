/**
 * Tests for domain extraction utility.
 * Story 3.2: Organization Reputation Tracking - AC1
 */

import { describe, it, expect } from 'vitest';
import { extractDomain } from '../../src/lib/domain.js';

describe('extractDomain', () => {
  describe('valid email formats', () => {
    it('should extract domain from simple email', () => {
      expect(extractDomain('user@example.com')).toBe('example.com');
    });

    it('should extract domain from email with subdomain', () => {
      expect(extractDomain('sarah.jones@councilname.gov.uk')).toBe(
        'councilname.gov.uk'
      );
    });

    it('should extract domain from email with plus addressing', () => {
      expect(extractDomain('user+tag@domain.org')).toBe('domain.org');
    });

    it('should handle single-part domain', () => {
      expect(extractDomain('admin@localhost')).toBe('localhost');
    });

    it('should handle numeric domain parts', () => {
      expect(extractDomain('user@123.example.com')).toBe('123.example.com');
    });
  });

  describe('case insensitivity', () => {
    it('should lowercase the domain', () => {
      expect(extractDomain('USER@EXAMPLE.COM')).toBe('example.com');
    });

    it('should lowercase mixed case domain', () => {
      expect(extractDomain('John.Doe@CouncilName.GOV.UK')).toBe(
        'councilname.gov.uk'
      );
    });

    it('should preserve local part case but lowercase domain', () => {
      // extractDomain only returns domain, so local part is not relevant
      expect(extractDomain('John.Doe@Example.COM')).toBe('example.com');
    });
  });

  describe('edge cases', () => {
    it('should handle email with multiple @ symbols (use last one)', () => {
      // Some systems allow @ in quoted local parts
      expect(extractDomain('"user@work"@example.com')).toBe('example.com');
    });

    it('should handle very long domain', () => {
      const longDomain = 'sub1.sub2.sub3.department.council.gov.uk';
      expect(extractDomain(`user@${longDomain}`)).toBe(longDomain);
    });

    it('should handle domain with hyphens', () => {
      expect(extractDomain('user@my-council.gov.uk')).toBe('my-council.gov.uk');
    });
  });

  describe('invalid email formats', () => {
    it('should throw error for email without @', () => {
      expect(() => extractDomain('invalidemail')).toThrow(
        'Invalid email format: invalidemail'
      );
    });

    it('should throw error for empty string', () => {
      expect(() => extractDomain('')).toThrow('Invalid email format: ');
    });

    it('should throw error for email with only @', () => {
      // Edge case: @ with no domain after it should throw
      expect(() => extractDomain('@')).toThrow('Invalid email format: @');
    });

    it('should throw error for email ending with @', () => {
      expect(() => extractDomain('user@')).toThrow('Invalid email format: user@');
    });
  });
});
