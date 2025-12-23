/**
 * Tests for idempotency configuration.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('idempotency', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('IDEMPOTENCY_TTL_SECONDS', () => {
    it('should be 24 hours (86400 seconds)', async () => {
      const { IDEMPOTENCY_TTL_SECONDS } = await import('../../src/lib/idempotency.js');
      expect(IDEMPOTENCY_TTL_SECONDS).toBe(86400);
    });
  });

  describe('createPersistenceLayer', () => {
    it('should throw when IDEMPOTENCY_TABLE_NAME is not set', async () => {
      delete process.env.IDEMPOTENCY_TABLE_NAME;
      const { createPersistenceLayer } = await import('../../src/lib/idempotency.js');

      expect(() => createPersistenceLayer()).toThrow(
        'IDEMPOTENCY_TABLE_NAME environment variable is required'
      );
    });

    it('should create persistence layer when table name is set', async () => {
      process.env.IDEMPOTENCY_TABLE_NAME = 'test-idempotency-table';
      const { createPersistenceLayer } = await import('../../src/lib/idempotency.js');

      const layer = createPersistenceLayer();
      expect(layer).toBeDefined();
    });
  });

  describe('createIdempotencyConfig', () => {
    it('should create config with 24-hour TTL', async () => {
      const { createIdempotencyConfig } = await import('../../src/lib/idempotency.js');

      const config = createIdempotencyConfig();
      expect(config).toBeDefined();
    });
  });

  describe('generateIdempotencyKey', () => {
    it('should generate key with leaseId and eventId', async () => {
      const { generateIdempotencyKey } = await import('../../src/lib/idempotency.js');

      const key = generateIdempotencyKey('lease-123', 'event-456');
      expect(key).toBe('lease-123:event-456');
    });

    it('should generate key with only leaseId when eventId not provided', async () => {
      const { generateIdempotencyKey } = await import('../../src/lib/idempotency.js');

      const key = generateIdempotencyKey('lease-123');
      expect(key).toBe('lease-123');
    });

    it('should generate key with empty eventId', async () => {
      const { generateIdempotencyKey } = await import('../../src/lib/idempotency.js');

      const key = generateIdempotencyKey('lease-123', '');
      expect(key).toBe('lease-123');
    });
  });
});
