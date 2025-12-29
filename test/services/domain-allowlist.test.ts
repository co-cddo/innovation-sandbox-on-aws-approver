/**
 * Domain Allowlist Service Unit Tests
 *
 * Tests for S3-based domain allowlist loading with caching.
 * Story 3.3: Domain Verification from S3 Cache - AC1, AC5, AC6, AC7
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import {
  createDomainAllowlistService,
  type DomainAllowlistService,
  CACHE_TTL_MS,
} from '../../src/services/domain-allowlist.js';

// Helper to create mock S3 response body that mimics sdkStreamMixin behavior
const createMockBody = (content: string) => {
  const stream = Readable.from([content]);
  return {
    transformToString: async () => content,
    transformToByteArray: async () => Buffer.from(content),
    transformToWebStream: () => stream,
    pipe: stream.pipe.bind(stream),
  };
};

// Mock S3 client
const mockSend = vi.fn();
const mockS3Client = {
  send: mockSend,
} as unknown as S3Client;

describe('DomainAllowlistService', () => {
  let service: DomainAllowlistService;
  const bucketName = 'test-domain-bucket';
  const objectKey = 'user_domains.json';

  beforeEach(() => {
    vi.clearAllMocks();
    // Create a fresh service for each test to reset cache
    service = createDomainAllowlistService(mockS3Client, { bucketName, objectKey });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getLocalAuthorityDomains', () => {
    it('should load and parse JSON from S3 (AC1)', async () => {
      const mockData = {
        domains: [
          {
            domain_pattern: 'councilname.gov.uk',
            organisation_type_id: 'local_authority',
            organisation_name: 'Council Name',
          },
          {
            domain_pattern: 'nhs.uk',
            organisation_type_id: 'nhs',
            organisation_name: 'NHS',
          },
        ],
      };

      mockSend.mockResolvedValueOnce({
        Body: createMockBody(JSON.stringify(mockData)),
      });

      const result = await service.getLocalAuthorityDomains();

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0]![0];
      expect(call).toBeInstanceOf(GetObjectCommand);
      expect(call.input).toEqual({
        Bucket: bucketName,
        Key: objectKey,
      });
      expect(result.domains).toEqual(['councilname.gov.uk']);
      expect(result.usedStaleCache).toBe(false);
    });

    it('should filter to only local_authority organisation_type_id (AC7)', async () => {
      const mockData = {
        domains: [
          { domain_pattern: 'localcouncil.gov.uk', organisation_type_id: 'local_authority' },
          { domain_pattern: 'nhs.uk', organisation_type_id: 'nhs' },
          { domain_pattern: 'police.uk', organisation_type_id: 'police' },
          { domain_pattern: 'central.gov.uk', organisation_type_id: 'central_gov' },
          { domain_pattern: 'another-council.gov.uk', organisation_type_id: 'local_authority' },
        ],
      };

      mockSend.mockResolvedValueOnce({
        Body: createMockBody(JSON.stringify(mockData)),
      });

      const result = await service.getLocalAuthorityDomains();

      expect(result.domains).toEqual(['localcouncil.gov.uk', 'another-council.gov.uk']);
    });

    it('should extract domain_pattern field (AC7)', async () => {
      const mockData = {
        domains: [
          {
            domain_pattern: 'test-council.gov.uk',
            organisation_type_id: 'local_authority',
            organisation_name: 'Test Council',
            other_field: 'ignored',
          },
        ],
      };

      mockSend.mockResolvedValueOnce({
        Body: createMockBody(JSON.stringify(mockData)),
      });

      const result = await service.getLocalAuthorityDomains();

      expect(result.domains).toEqual(['test-council.gov.uk']);
    });

    it('should cache results with 1 hour TTL (AC1, AC6)', async () => {
      const mockData = {
        domains: [
          { domain_pattern: 'cached.gov.uk', organisation_type_id: 'local_authority' },
        ],
      };

      mockSend.mockResolvedValueOnce({
        Body: createMockBody(JSON.stringify(mockData)),
      });

      // First call - should fetch from S3
      const first = await service.getLocalAuthorityDomains();
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(first.domains).toEqual(['cached.gov.uk']);
      expect(first.usedStaleCache).toBe(false);

      // Second call - should use cache
      const second = await service.getLocalAuthorityDomains();
      expect(mockSend).toHaveBeenCalledTimes(1); // Still 1 - cached
      expect(second.domains).toEqual(['cached.gov.uk']);
      expect(second.usedStaleCache).toBe(false);
    });

    it('should reload from S3 after TTL expires (AC6)', async () => {
      const mockData1 = {
        domains: [
          { domain_pattern: 'old.gov.uk', organisation_type_id: 'local_authority' },
        ],
      };
      const mockData2 = {
        domains: [
          { domain_pattern: 'new.gov.uk', organisation_type_id: 'local_authority' },
        ],
      };

      mockSend
        .mockResolvedValueOnce({ Body: createMockBody(JSON.stringify(mockData1)) })
        .mockResolvedValueOnce({ Body: createMockBody(JSON.stringify(mockData2)) });

      // First call
      const first = await service.getLocalAuthorityDomains();
      expect(first.domains).toEqual(['old.gov.uk']);

      // Advance time past TTL
      vi.useFakeTimers();
      vi.advanceTimersByTime(CACHE_TTL_MS + 1000);

      // Second call should fetch fresh data
      const second = await service.getLocalAuthorityDomains();
      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(second.domains).toEqual(['new.gov.uk']);
      expect(second.usedStaleCache).toBe(false);

      vi.useRealTimers();
    });

    it('should use stale cache if refresh fails and return usedStaleCache=true (AC6)', async () => {
      const mockData = {
        domains: [
          { domain_pattern: 'stale.gov.uk', organisation_type_id: 'local_authority' },
        ],
      };

      mockSend
        .mockResolvedValueOnce({ Body: createMockBody(JSON.stringify(mockData)) })
        .mockRejectedValueOnce(new Error('S3 unavailable'));

      // First call - successful
      const first = await service.getLocalAuthorityDomains();
      expect(first.domains).toEqual(['stale.gov.uk']);
      expect(first.usedStaleCache).toBe(false);

      // Advance time past TTL
      vi.useFakeTimers();
      vi.advanceTimersByTime(CACHE_TTL_MS + 1000);

      // Second call should use stale cache on error with indicator
      const second = await service.getLocalAuthorityDomains();
      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(second.domains).toEqual(['stale.gov.uk']); // Stale cache used
      expect(second.usedStaleCache).toBe(true);
      expect(second.staleReason).toBe('S3 unavailable');

      vi.useRealTimers();
    });

    it('should throw on S3 error with no cache (AC5)', async () => {
      mockSend.mockRejectedValueOnce(new Error('S3 bucket not found'));

      await expect(service.getLocalAuthorityDomains()).rejects.toThrow('S3 bucket not found');
    });

    it('should return empty array for empty domains list', async () => {
      const mockData = { domains: [] };

      mockSend.mockResolvedValueOnce({
        Body: createMockBody(JSON.stringify(mockData)),
      });

      const result = await service.getLocalAuthorityDomains();

      expect(result.domains).toEqual([]);
    });

    it('should return empty array when no local_authority domains exist', async () => {
      const mockData = {
        domains: [
          { domain_pattern: 'nhs.uk', organisation_type_id: 'nhs' },
          { domain_pattern: 'police.uk', organisation_type_id: 'police' },
        ],
      };

      mockSend.mockResolvedValueOnce({
        Body: createMockBody(JSON.stringify(mockData)),
      });

      const result = await service.getLocalAuthorityDomains();

      expect(result.domains).toEqual([]);
    });

    it('should handle malformed JSON gracefully', async () => {
      mockSend.mockResolvedValueOnce({
        Body: createMockBody('not valid json'),
      });

      await expect(service.getLocalAuthorityDomains()).rejects.toThrow();
    });

    it('should handle missing Body in S3 response', async () => {
      mockSend.mockResolvedValueOnce({});

      await expect(service.getLocalAuthorityDomains()).rejects.toThrow(
        'No body in S3 response'
      );
    });

    it('should handle domains without domain_pattern field', async () => {
      const mockData = {
        domains: [
          { organisation_type_id: 'local_authority', organisation_name: 'Missing Pattern' },
          { domain_pattern: 'valid.gov.uk', organisation_type_id: 'local_authority' },
        ],
      };

      mockSend.mockResolvedValueOnce({
        Body: createMockBody(JSON.stringify(mockData)),
      });

      const result = await service.getLocalAuthorityDomains();

      // Should skip entries without domain_pattern
      expect(result.domains).toEqual(['valid.gov.uk']);
    });

    it('should handle undefined domains array', async () => {
      const mockData = {};

      mockSend.mockResolvedValueOnce({
        Body: createMockBody(JSON.stringify(mockData)),
      });

      const result = await service.getLocalAuthorityDomains();

      expect(result.domains).toEqual([]);
    });
  });

  describe('clearCache', () => {
    it('should clear the cache forcing next call to fetch from S3', async () => {
      const mockData = {
        domains: [
          { domain_pattern: 'test.gov.uk', organisation_type_id: 'local_authority' },
        ],
      };

      mockSend
        .mockResolvedValueOnce({ Body: createMockBody(JSON.stringify(mockData)) })
        .mockResolvedValueOnce({ Body: createMockBody(JSON.stringify(mockData)) });

      // First call
      await service.getLocalAuthorityDomains();
      expect(mockSend).toHaveBeenCalledTimes(1);

      // Clear cache
      service.clearCache();

      // Next call should fetch from S3 again
      await service.getLocalAuthorityDomains();
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });
});
