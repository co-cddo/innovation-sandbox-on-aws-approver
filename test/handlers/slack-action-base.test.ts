/**
 * Unit Tests for Slack Action Base Functions (Story 7.3.2)
 *
 * These tests verify the "already processed" detection and response format
 * for when an operator clicks Approve/Deny on an already-processed request.
 *
 * @see src/handlers/slack-action-base.ts
 */

import { describe, it, expect } from 'vitest';
import {
  isAlreadyProcessedResult,
  createAlreadyProcessedResponse,
  createSuccessResponse,
  createErrorResponse,
  validateEvent,
  isValidSlackUserId,
  sanitizeSlackUserId,
  type IsbLambdaResult,
  type SlackActionConfig,
} from '../../src/handlers/slack-action-base.js';

describe('isAlreadyProcessedResult (Story 7.3.2)', () => {
  describe('AC1: Detects ISB 409 Conflict responses', () => {
    it('returns true for 409 status code', () => {
      const result: IsbLambdaResult = {
        success: false,
        statusCode: 409,
        error: 'Conflict',
      };

      expect(isAlreadyProcessedResult(result)).toBe(true);
    });

    it('returns true for 409 with any error message', () => {
      const result: IsbLambdaResult = {
        success: false,
        statusCode: 409,
        error: 'Some other message',
      };

      expect(isAlreadyProcessedResult(result)).toBe(true);
    });

    it('returns true for 409 without error message', () => {
      const result: IsbLambdaResult = {
        success: false,
        statusCode: 409,
      };

      expect(isAlreadyProcessedResult(result)).toBe(true);
    });
  });

  describe('AC1: Detects "already" keyword in error message', () => {
    it('returns true when error contains "already" (lowercase)', () => {
      const result: IsbLambdaResult = {
        success: false,
        statusCode: 400,
        error: 'Lease already approved',
      };

      expect(isAlreadyProcessedResult(result)).toBe(true);
    });

    it('returns true when error contains "Already" (mixed case)', () => {
      const result: IsbLambdaResult = {
        success: false,
        statusCode: 400,
        error: 'Lease Already Approved',
      };

      expect(isAlreadyProcessedResult(result)).toBe(true);
    });

    it('returns true when error contains "ALREADY" (uppercase)', () => {
      const result: IsbLambdaResult = {
        success: false,
        statusCode: 400,
        error: 'LEASE ALREADY DENIED',
      };

      expect(isAlreadyProcessedResult(result)).toBe(true);
    });

    it('returns true for "has already been" pattern', () => {
      const result: IsbLambdaResult = {
        success: false,
        statusCode: 422,
        error: 'This lease has already been denied',
      };

      expect(isAlreadyProcessedResult(result)).toBe(true);
    });
  });

  describe('AC1: Detects "processed" keyword in error message', () => {
    it('returns true when error contains "processed" (lowercase)', () => {
      const result: IsbLambdaResult = {
        success: false,
        statusCode: 400,
        error: 'Request has been processed',
      };

      expect(isAlreadyProcessedResult(result)).toBe(true);
    });

    it('returns true when error contains "Processed" (mixed case)', () => {
      const result: IsbLambdaResult = {
        success: false,
        statusCode: 400,
        error: 'Already Processed',
      };

      expect(isAlreadyProcessedResult(result)).toBe(true);
    });
  });

  describe('AC1: Detects "invalid state" keyword in error message', () => {
    it('returns true when error contains "invalid state" (lowercase)', () => {
      const result: IsbLambdaResult = {
        success: false,
        statusCode: 422,
        error: 'Lease is in invalid state for this action',
      };

      expect(isAlreadyProcessedResult(result)).toBe(true);
    });

    it('returns true when error contains "Invalid state" (mixed case)', () => {
      const result: IsbLambdaResult = {
        success: false,
        statusCode: 422,
        error: 'Invalid state transition',
      };

      expect(isAlreadyProcessedResult(result)).toBe(true);
    });

    it('returns true when error contains "INVALID STATE" (uppercase)', () => {
      const result: IsbLambdaResult = {
        success: false,
        statusCode: 422,
        error: 'INVALID STATE FOR OPERATION',
      };

      expect(isAlreadyProcessedResult(result)).toBe(true);
    });
  });

  describe('AC2: Does NOT detect non-already-processed errors', () => {
    it('returns false for 400 with "Invalid uuid"', () => {
      const result: IsbLambdaResult = {
        success: false,
        statusCode: 400,
        error: 'Invalid uuid',
      };

      expect(isAlreadyProcessedResult(result)).toBe(false);
    });

    it('returns false for 403 Forbidden', () => {
      const result: IsbLambdaResult = {
        success: false,
        statusCode: 403,
        error: 'Not authorized',
      };

      expect(isAlreadyProcessedResult(result)).toBe(false);
    });

    it('returns false for 500 Internal Server Error', () => {
      const result: IsbLambdaResult = {
        success: false,
        statusCode: 500,
        error: 'Internal server error',
      };

      expect(isAlreadyProcessedResult(result)).toBe(false);
    });

    it('returns false for generic 4xx errors', () => {
      const result: IsbLambdaResult = {
        success: false,
        statusCode: 422,
        error: 'Validation failed',
      };

      expect(isAlreadyProcessedResult(result)).toBe(false);
    });

    it('returns false for success results', () => {
      const result: IsbLambdaResult = {
        success: true,
        statusCode: 200,
      };

      // Function returns falsy (undefined) when not matching, which is effectively false
      expect(isAlreadyProcessedResult(result)).toBeFalsy();
    });

    it('returns false when no error message and non-409 status', () => {
      const result: IsbLambdaResult = {
        success: false,
        statusCode: 400,
      };

      // Function returns falsy (undefined) when not matching, which is effectively false
      expect(isAlreadyProcessedResult(result)).toBeFalsy();
    });
  });
});

describe('createAlreadyProcessedResponse (Story 7.3.2)', () => {
  describe('AC1: Response format', () => {
    it('returns CustomActionResponse with version 1.0', () => {
      const response = createAlreadyProcessedResponse('U12345678');

      expect(response.version).toBe('1.0');
    });

    it('returns status "error" (informational)', () => {
      const response = createAlreadyProcessedResponse('U12345678');

      expect(response.status).toBe('error');
    });

    it('includes info emoji in message', () => {
      const response = createAlreadyProcessedResponse('U12345678');

      expect(response.message).toContain('ℹ️');
    });

    it('includes "Already processed" text in message', () => {
      const response = createAlreadyProcessedResponse('U12345678');

      expect(response.message).toContain('Already processed');
    });

    it('includes explanation that request was handled', () => {
      const response = createAlreadyProcessedResponse('U12345678');

      expect(response.message).toMatch(/approved or denied|already been handled/i);
    });
  });

  describe('AC2: Graceful handling - no user input in response', () => {
    it('ignores slackUserId parameter (does not include in message)', () => {
      const response = createAlreadyProcessedResponse('U12345678');

      expect(response.message).not.toContain('U12345678');
    });

    it('does not include potentially malicious input', () => {
      const response = createAlreadyProcessedResponse('<script>alert(1)</script>');

      expect(response.message).not.toContain('<script>');
      expect(response.message).not.toContain('alert');
    });

    it('does not include injection attempts', () => {
      const response = createAlreadyProcessedResponse("'; DROP TABLE users; --");

      expect(response.message).not.toContain('DROP');
      expect(response.message).not.toContain('TABLE');
    });
  });

  describe('AC3: Response format compatible with Amazon Q thread reply', () => {
    it('has all required CustomActionResponse properties', () => {
      const response = createAlreadyProcessedResponse('operator');

      expect(response).toHaveProperty('version');
      expect(response).toHaveProperty('status');
      expect(response).toHaveProperty('message');
    });

    it('version is string "1.0"', () => {
      const response = createAlreadyProcessedResponse('operator');

      expect(typeof response.version).toBe('string');
      expect(response.version).toBe('1.0');
    });

    it('status is "error" (valid CustomActionResponse status)', () => {
      const response = createAlreadyProcessedResponse('operator');

      expect(['success', 'error']).toContain(response.status);
    });

    it('message is non-empty string', () => {
      const response = createAlreadyProcessedResponse('operator');

      expect(typeof response.message).toBe('string');
      expect(response.message.length).toBeGreaterThan(0);
    });
  });
});

describe('Response format consistency (Story 7.3.2)', () => {
  const testConfig: SlackActionConfig = {
    actionType: 'approve',
    serviceName: 'test',
    successEmoji: '✅',
    successVerb: 'Approved',
    failureMessage: 'Failed to approve',
  };

  it('success, error, and already-processed responses have same structure', () => {
    const successResponse = createSuccessResponse('U12345678', testConfig);
    const errorResponse = createErrorResponse('Some error', 'corr-123');
    const alreadyProcessedResponse = createAlreadyProcessedResponse('U12345678');

    // All should have the same properties
    const expectedKeys = ['message', 'status', 'version']; // sorted alphabetically

    expect(Object.keys(successResponse).sort()).toEqual(expectedKeys);
    expect(Object.keys(errorResponse).sort()).toEqual(expectedKeys);
    expect(Object.keys(alreadyProcessedResponse).sort()).toEqual(expectedKeys);
  });

  it('all responses use version 1.0', () => {
    const successResponse = createSuccessResponse('U12345678', testConfig);
    const errorResponse = createErrorResponse('Some error', 'corr-123');
    const alreadyProcessedResponse = createAlreadyProcessedResponse('U12345678');

    expect(successResponse.version).toBe('1.0');
    expect(errorResponse.version).toBe('1.0');
    expect(alreadyProcessedResponse.version).toBe('1.0');
  });

  it('response messages follow established patterns', () => {
    const successResponse = createSuccessResponse('U12345678', testConfig);
    const errorResponse = createErrorResponse('Some error', 'corr-123');
    const alreadyProcessedResponse = createAlreadyProcessedResponse('U12345678');

    // Success: emoji + action
    expect(successResponse.message).toBe('✅ Approved');

    // Error: ❌ Error: message (ref: correlationId)
    expect(errorResponse.message).toMatch(/❌ Error:.*\(ref:.*\)/);

    // Already processed: ℹ️ Already processed - explanation
    expect(alreadyProcessedResponse.message).toMatch(/ℹ️ Already processed/);
  });
});

describe('validateEvent', () => {
  it('accepts direct leaseId format', () => {
    const result = validateEvent({ leaseId: 'some-base64-value' });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.leaseId).toBe('some-base64-value');
    }
  });

  it('accepts full notification format', () => {
    const result = validateEvent({
      originalNotification: {
        additionalContext: {
          leaseId: 'some-base64-value',
        },
      },
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.leaseId).toBe('some-base64-value');
    }
  });

  it('rejects missing leaseId', () => {
    const result = validateEvent({ someOther: 'value' });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('Missing leaseId');
    }
  });
});

describe('Slack User ID utilities', () => {
  describe('isValidSlackUserId', () => {
    it('validates correct Slack user IDs', () => {
      expect(isValidSlackUserId('U12345678')).toBe(true);
      expect(isValidSlackUserId('UABCD1234XYZ')).toBe(true);
    });

    it('rejects invalid formats', () => {
      expect(isValidSlackUserId('invalid')).toBe(false);
      expect(isValidSlackUserId('W12345678')).toBe(false);
      expect(isValidSlackUserId('')).toBe(false);
    });
  });

  describe('sanitizeSlackUserId', () => {
    it('returns valid IDs unchanged', () => {
      expect(sanitizeSlackUserId('U12345678')).toBe('U12345678');
    });

    it('returns fallback for invalid IDs', () => {
      expect(sanitizeSlackUserId('invalid')).toBe('unknown-user');
      expect(sanitizeSlackUserId('<script>')).toBe('unknown-user');
    });
  });
});
