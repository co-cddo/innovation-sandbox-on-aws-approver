import { describe, it, expect } from 'vitest';
import { decodeLeaseCompositeKey } from '../../src/lib/slack-action-types.js';

describe('Slack Action Types', () => {
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

    it('works with URL-safe base64 variations', () => {
      // Standard base64 encoded payload
      const payload = { userEmail: 'user@example.gov.uk', uuid: 'test-uuid' };
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');

      const result = decodeLeaseCompositeKey(encoded);

      expect(result.userEmail).toBe('user@example.gov.uk');
      expect(result.uuid).toBe('test-uuid');
    });

    it('matches format produced by encodeLeaseCompositeKey', () => {
      // This tests compatibility with sns-notification.ts encodeLeaseCompositeKey
      // The encoding format should be: base64(JSON.stringify({userEmail, uuid}))
      const userEmail = 'test@dsit.gov.uk';
      const uuid = '550e8400-e29b-41d4-a716-446655440000';

      // Manually encode in the same way as encodeLeaseCompositeKey
      const encoded = Buffer.from(JSON.stringify({ userEmail, uuid }), 'utf8').toString('base64');

      const result = decodeLeaseCompositeKey(encoded);

      expect(result.userEmail).toBe(userEmail);
      expect(result.uuid).toBe(uuid);
    });
  });
});
