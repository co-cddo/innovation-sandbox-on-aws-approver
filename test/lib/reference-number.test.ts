/**
 * Reference Number Utility Tests (Story 5.1)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateReferenceNumber } from '../../src/lib/reference-number.js';

describe('Reference Number Utilities (Story 5.1)', () => {
  describe('generateReferenceNumber (AC8)', () => {
    beforeEach(() => {
      // Mock Date to control year output
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-12-23T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should generate reference in ISB-YYYY-NNNN format', () => {
      const ref = generateReferenceNumber('abc12345-def4-5678-9abc-def012345678');

      expect(ref).toMatch(/^ISB-2025-\d{4}$/);
    });

    it('should include current year', () => {
      const ref = generateReferenceNumber('test-uuid');

      expect(ref).toContain('ISB-2025');
    });

    it('should be deterministic (same input = same output)', () => {
      const leaseId = 'f2d3eb78-907a-4c20-8127-7ce45758836d';

      const ref1 = generateReferenceNumber(leaseId);
      const ref2 = generateReferenceNumber(leaseId);

      expect(ref1).toBe(ref2);
    });

    it('should generate different references for different lease IDs', () => {
      const ref1 = generateReferenceNumber('aaaa-bbbb-cccc-dddd-0001');
      const ref2 = generateReferenceNumber('aaaa-bbbb-cccc-dddd-0002');

      // Different UUIDs should generally produce different references
      // (though collisions are possible due to hash truncation)
      expect(ref1).not.toBe(ref2);
    });

    it('should pad numeric portion to 4 digits', () => {
      // Use a UUID that will produce a small number
      const ref = generateReferenceNumber('aaaa-bbbb-cccc-dddd-0000');

      expect(ref).toMatch(/^ISB-2025-\d{4}$/);
      // Should have leading zeros if number is small
      const numPart = ref.split('-').pop();
      expect(numPart).toHaveLength(4);
    });

    it('should handle UUIDs with different formats', () => {
      // Standard UUID format
      const ref1 = generateReferenceNumber('f2d3eb78-907a-4c20-8127-7ce45758836d');
      expect(ref1).toMatch(/^ISB-2025-\d{4}$/);

      // Without dashes
      const ref2 = generateReferenceNumber('f2d3eb78907a4c2081277ce45758836d');
      expect(ref2).toMatch(/^ISB-2025-\d{4}$/);

      // Short string
      const ref3 = generateReferenceNumber('abcd');
      expect(ref3).toMatch(/^ISB-2025-\d{4}$/);
    });

    it('should generate number within 0000-9999 range', () => {
      const testCases = [
        'test-uuid-1',
        'test-uuid-2',
        'aaaa-bbbb-cccc-dddd-eeee-ffff',
        '0000-0000-0000-0000',
        'ffff-ffff-ffff-ffff',
      ];

      for (const leaseId of testCases) {
        const ref = generateReferenceNumber(leaseId);
        const numPart = parseInt(ref.split('-').pop()!, 10);
        expect(numPart).toBeGreaterThanOrEqual(0);
        expect(numPart).toBeLessThan(10000);
      }
    });

    it('should handle year change', () => {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

      const ref = generateReferenceNumber('test-uuid');

      expect(ref).toContain('ISB-2026');
    });
  });
});
