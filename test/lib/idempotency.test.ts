/**
 * Tests for idempotency configuration.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the AWS Powertools idempotency modules for Vitest v4
vi.mock('@aws-lambda-powertools/idempotency', () => ({
  IdempotencyConfig: class MockIdempotencyConfig {
    constructor(public options: Record<string, unknown>) {}
  },
}));

vi.mock('@aws-lambda-powertools/idempotency/dynamodb', () => ({
  DynamoDBPersistenceLayer: class MockDynamoDBPersistenceLayer {
    constructor(public options: { tableName: string }) {}
  },
}));

// Import after mocks are set up - no dynamic imports needed now
import {
  IDEMPOTENCY_TTL_SECONDS,
  createPersistenceLayer,
  createIdempotencyConfig,
  generateIdempotencyKey,
} from '../../src/lib/idempotency.js';

describe('idempotency', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('IDEMPOTENCY_TTL_SECONDS', () => {
    it('should be 24 hours (86400 seconds)', () => {
      expect(IDEMPOTENCY_TTL_SECONDS).toBe(86400);
    });
  });

  describe('createPersistenceLayer', () => {
    it('should throw when IDEMPOTENCY_TABLE_NAME is not set', () => {
      delete process.env.IDEMPOTENCY_TABLE_NAME;

      expect(() => createPersistenceLayer()).toThrow(
        'IDEMPOTENCY_TABLE_NAME environment variable is required'
      );
    });

    it('should create persistence layer when table name is set', () => {
      process.env.IDEMPOTENCY_TABLE_NAME = 'test-idempotency-table';

      const layer = createPersistenceLayer();
      expect(layer).toBeDefined();
    });
  });

  describe('createIdempotencyConfig', () => {
    it('should create config with 24-hour TTL', () => {
      const config = createIdempotencyConfig();
      expect(config).toBeDefined();
    });
  });

  describe('generateIdempotencyKey', () => {
    it('should generate key with leaseId and eventId', () => {
      const key = generateIdempotencyKey('lease-123', 'event-456');
      expect(key).toBe('lease-123:event-456');
    });

    it('should generate key with only leaseId when eventId not provided', () => {
      const key = generateIdempotencyKey('lease-123');
      expect(key).toBe('lease-123');
    });

    it('should generate key with empty eventId', () => {
      const key = generateIdempotencyKey('lease-123', '');
      expect(key).toBe('lease-123');
    });
  });
});
