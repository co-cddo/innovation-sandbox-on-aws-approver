import { describe, it, expect } from 'vitest';
import {
  encodeLeaseCompositeKey,
  decodeLeaseCompositeKey,
  leaseIdToCompositeKey,
} from '../../src/lib/lease-id-codec.js';

describe('Lease ID Codec', () => {
  describe('encodeLeaseCompositeKey', () => {
    it('encodes userEmail and uuid to base64 JSON', () => {
      const encoded = encodeLeaseCompositeKey('user@example.gov.uk', 'abc-123-def');

      // Decode to verify format
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded);

      expect(parsed.userEmail).toBe('user@example.gov.uk');
      expect(parsed.uuid).toBe('abc-123-def');
    });

    it('handles special characters in email', () => {
      const encoded = encodeLeaseCompositeKey('test+tag@sub.domain.gov.uk', 'uuid-456');

      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded);

      expect(parsed.userEmail).toBe('test+tag@sub.domain.gov.uk');
    });

    it('handles full UUID format', () => {
      const uuid = '123e4567-e89b-12d3-a456-426614174000';
      const encoded = encodeLeaseCompositeKey('user@gov.uk', uuid);

      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded);

      expect(parsed.uuid).toBe(uuid);
    });

    it('produces consistent output for same input', () => {
      const encoded1 = encodeLeaseCompositeKey('user@gov.uk', 'test-uuid');
      const encoded2 = encodeLeaseCompositeKey('user@gov.uk', 'test-uuid');

      expect(encoded1).toBe(encoded2);
    });
  });

  describe('decodeLeaseCompositeKey', () => {
    it('decodes a valid base64 encoded JSON payload', () => {
      const payload = { userEmail: 'user@example.gov.uk', uuid: 'abc-123-def' };
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');

      const result = decodeLeaseCompositeKey(encoded);

      expect(result.userEmail).toBe('user@example.gov.uk');
      expect(result.uuid).toBe('abc-123-def');
    });

    it('handles different email formats', () => {
      const payload = { userEmail: 'test+tag@sub.domain.gov.uk', uuid: 'uuid-456' };
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');

      const result = decodeLeaseCompositeKey(encoded);

      expect(result.userEmail).toBe('test+tag@sub.domain.gov.uk');
      expect(result.uuid).toBe('uuid-456');
    });

    it('handles UUIDs with various formats', () => {
      const payload = {
        userEmail: 'user@gov.uk',
        uuid: '123e4567-e89b-12d3-a456-426614174000',
      };
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');

      const result = decodeLeaseCompositeKey(encoded);

      expect(result.uuid).toBe('123e4567-e89b-12d3-a456-426614174000');
    });

    it('throws error for invalid base64', () => {
      expect(() => {
        decodeLeaseCompositeKey('not-valid-base64!!!');
      }).toThrow();
    });

    it('throws error for valid base64 but invalid JSON', () => {
      const notJson = Buffer.from('this is not json').toString('base64');

      expect(() => {
        decodeLeaseCompositeKey(notJson);
      }).toThrow('Invalid JSON');
    });

    it('throws error when userEmail is missing', () => {
      const payload = { uuid: 'abc-123' };
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');

      expect(() => {
        decodeLeaseCompositeKey(encoded);
      }).toThrow('Missing userEmail or uuid');
    });

    it('throws error when uuid is missing', () => {
      const payload = { userEmail: 'user@gov.uk' };
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');

      expect(() => {
        decodeLeaseCompositeKey(encoded);
      }).toThrow('Missing userEmail or uuid');
    });

    it('throws error when both fields are missing', () => {
      const payload = {};
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');

      expect(() => {
        decodeLeaseCompositeKey(encoded);
      }).toThrow('Missing userEmail or uuid');
    });

    it('throws error for null values', () => {
      const payload = { userEmail: null, uuid: null };
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');

      expect(() => {
        decodeLeaseCompositeKey(encoded);
      }).toThrow('Missing userEmail or uuid');
    });

    it('throws error for empty string values', () => {
      const payload = { userEmail: '', uuid: '' };
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');

      expect(() => {
        decodeLeaseCompositeKey(encoded);
      }).toThrow('Missing userEmail or uuid');
    });
  });

  describe('encode/decode round-trip', () => {
    it('successfully round-trips through encode and decode', () => {
      const userEmail = 'test@dsit.gov.uk';
      const uuid = '550e8400-e29b-41d4-a716-446655440000';

      const encoded = encodeLeaseCompositeKey(userEmail, uuid);
      const decoded = decodeLeaseCompositeKey(encoded);

      expect(decoded.userEmail).toBe(userEmail);
      expect(decoded.uuid).toBe(uuid);
    });

    it('round-trips special characters', () => {
      const userEmail = 'user+test@sub.domain.gov.uk';
      const uuid = 'test-uuid-with-dashes';

      const encoded = encodeLeaseCompositeKey(userEmail, uuid);
      const decoded = decodeLeaseCompositeKey(encoded);

      expect(decoded.userEmail).toBe(userEmail);
      expect(decoded.uuid).toBe(uuid);
    });
  });

  describe('leaseIdToCompositeKey', () => {
    it('encodes LeaseId object to composite key', () => {
      const leaseId = {
        userEmail: 'user@gov.uk',
        uuid: 'abc-123',
      };

      const key = leaseIdToCompositeKey(leaseId);
      const decoded = decodeLeaseCompositeKey(key);

      expect(decoded.userEmail).toBe(leaseId.userEmail);
      expect(decoded.uuid).toBe(leaseId.uuid);
    });

    it('produces same output as encodeLeaseCompositeKey', () => {
      const userEmail = 'test@example.gov.uk';
      const uuid = 'test-uuid-123';

      const key1 = leaseIdToCompositeKey({ userEmail, uuid });
      const key2 = encodeLeaseCompositeKey(userEmail, uuid);

      expect(key1).toBe(key2);
    });
  });
});
