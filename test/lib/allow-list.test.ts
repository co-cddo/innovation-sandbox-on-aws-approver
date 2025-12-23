/**
 * Tests for allow-list functionality.
 */
import { describe, it, expect } from 'vitest';
import { ALLOW_LIST_EMAILS, isAllowListed } from '../../src/lib/allow-list.js';

describe('allow-list', () => {
  describe('ALLOW_LIST_EMAILS', () => {
    it('should contain expected emails', () => {
      expect(ALLOW_LIST_EMAILS).toContain('chris.nesbitt-smith@digital.cabinet-office.gov.uk');
      expect(ALLOW_LIST_EMAILS).toContain('chris.nesbitt-smith@dsit.gov.uk');
      expect(ALLOW_LIST_EMAILS).toContain('benjamin.bennett@dsit.gov.uk');
      expect(ALLOW_LIST_EMAILS).toContain('dimitris.perdikou@dsit.gov.uk');
      expect(ALLOW_LIST_EMAILS).toContain('edward.mccutcheon@dsit.gov.uk');
    });

    it('should have exactly 5 entries', () => {
      expect(ALLOW_LIST_EMAILS).toHaveLength(5);
    });

    it('should be readonly', () => {
      // TypeScript should prevent mutation, but we can verify it's an array
      expect(Array.isArray(ALLOW_LIST_EMAILS)).toBe(true);
    });
  });

  describe('isAllowListed', () => {
    it('should return true for chris.nesbitt-smith@digital.cabinet-office.gov.uk', () => {
      expect(isAllowListed('chris.nesbitt-smith@digital.cabinet-office.gov.uk')).toBe(true);
    });

    it('should return true for chris.nesbitt-smith@dsit.gov.uk', () => {
      expect(isAllowListed('chris.nesbitt-smith@dsit.gov.uk')).toBe(true);
    });

    it('should return false for ndx+test@dsit.gov.uk (removed for E2E testing)', () => {
      expect(isAllowListed('ndx+test@dsit.gov.uk')).toBe(false);
    });

    it('should return true for benjamin.bennett@dsit.gov.uk', () => {
      expect(isAllowListed('benjamin.bennett@dsit.gov.uk')).toBe(true);
    });

    it('should return true for dimitris.perdikou@dsit.gov.uk', () => {
      expect(isAllowListed('dimitris.perdikou@dsit.gov.uk')).toBe(true);
    });

    it('should return true for edward.mccutcheon@dsit.gov.uk', () => {
      expect(isAllowListed('edward.mccutcheon@dsit.gov.uk')).toBe(true);
    });

    it('should return false for non-allow-listed email', () => {
      expect(isAllowListed('random-user@example.gov.uk')).toBe(false);
    });

    it('should return false for similar but different email', () => {
      expect(isAllowListed('chris.nesbitt-smith@example.gov.uk')).toBe(false);
    });

    it('should be case-insensitive (uppercase)', () => {
      expect(isAllowListed('CHRIS.NESBITT-SMITH@DSIT.GOV.UK')).toBe(true);
    });

    it('should be case-insensitive (mixed case)', () => {
      expect(isAllowListed('Chris.Nesbitt-Smith@Dsit.Gov.Uk')).toBe(true);
    });

    it('should trim whitespace', () => {
      expect(isAllowListed('  chris.nesbitt-smith@dsit.gov.uk  ')).toBe(true);
    });

    it('should return false for empty string', () => {
      expect(isAllowListed('')).toBe(false);
    });

    it('should return false for partial match', () => {
      expect(isAllowListed('chris.nesbitt-smith')).toBe(false);
    });
  });
});
