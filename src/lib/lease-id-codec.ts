/**
 * Lease ID Composite Key Encoding/Decoding (Issue 4 - Code Review Fix)
 *
 * Consolidated encode/decode logic for lease composite keys.
 * These functions are used by:
 * - sns-notification.ts: encode for console URLs and Slack metadata
 * - isb-lambda.ts: encode for API path parameters
 * - slack-action-types.ts: decode for Slack button action handling
 *
 * Format: base64(JSON.stringify({ userEmail, uuid }))
 */

import type { LeaseId } from './types.js';

/**
 * Decoded lease composite key structure.
 */
export interface CompositeLeaseId {
  userEmail: string;
  uuid: string;
}

/**
 * Encodes a lease composite key as base64-encoded JSON.
 *
 * The composite key is used in:
 * - ISB console URLs: /leases/edit/{compositeKey}
 * - Slack notification metadata for button actions
 * - ISB Lambda API path parameters
 *
 * @param userEmail - User's email address
 * @param uuid - Lease UUID
 * @returns Base64-encoded JSON string
 *
 * @example
 * ```typescript
 * const key = encodeLeaseCompositeKey('user@gov.uk', 'abc-123');
 * // Returns: "eyJ1c2VyRW1haWwiOiJ1c2VyQGdvdi51ayIsInV1aWQiOiJhYmMtMTIzIn0="
 * ```
 */
export const encodeLeaseCompositeKey = (userEmail: string, uuid: string): string => {
  const json = JSON.stringify({ userEmail, uuid });
  return Buffer.from(json, 'utf8').toString('base64');
};

/**
 * Decodes a base64-encoded lease composite key back to its components.
 *
 * IMPORTANT: This decode function MUST stay in sync with encodeLeaseCompositeKey().
 * The test in test/lib/lease-id-codec.test.ts verifies this compatibility.
 *
 * @param encoded - Base64-encoded JSON string
 * @returns Decoded lease ID with userEmail and uuid
 * @throws Error if decoding or parsing fails, or if required fields are missing
 *
 * @example
 * ```typescript
 * const { userEmail, uuid } = decodeLeaseCompositeKey(encodedKey);
 * // Returns: { userEmail: 'user@gov.uk', uuid: 'abc-123' }
 * ```
 */
export const decodeLeaseCompositeKey = (encoded: string): CompositeLeaseId => {
  try {
    const json = Buffer.from(encoded, 'base64').toString('utf8');
    const parsed = JSON.parse(json) as { userEmail?: string; uuid?: string };

    if (!parsed.userEmail || !parsed.uuid) {
      throw new Error('Missing userEmail or uuid in decoded payload');
    }

    return {
      userEmail: parsed.userEmail,
      uuid: parsed.uuid,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in base64 payload: ${error.message}`);
    }
    throw error;
  }
};

/**
 * Convenience function to encode a LeaseId type to composite key.
 *
 * @param leaseId - LeaseId object with userEmail and uuid
 * @returns Base64-encoded JSON string
 *
 * @example
 * ```typescript
 * const key = leaseIdToCompositeKey({ userEmail: 'user@gov.uk', uuid: 'abc-123' });
 * ```
 */
export const leaseIdToCompositeKey = (leaseId: LeaseId): string => {
  return encodeLeaseCompositeKey(leaseId.userEmail, leaseId.uuid);
};
