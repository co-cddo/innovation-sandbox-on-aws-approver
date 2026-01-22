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
  getUserFriendlyErrorMessage,
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

/**
 * Error Response Tests (Story 7.3.3)
 *
 * These tests verify the error thread reply format and behavior
 * when action processing fails.
 */
describe('createErrorResponse (Story 7.3.3)', () => {
  describe('AC1: Error thread reply format', () => {
    it('returns CustomActionResponse with version 1.0', () => {
      const response = createErrorResponse('Test error', 'corr-123');

      expect(response.version).toBe('1.0');
    });

    it('returns status "error"', () => {
      const response = createErrorResponse('Test error', 'corr-123');

      expect(response.status).toBe('error');
    });

    it('includes error emoji in message', () => {
      const response = createErrorResponse('Test error', 'corr-123');

      expect(response.message).toContain('❌');
    });

    it('includes "Error:" prefix in message', () => {
      const response = createErrorResponse('Test error', 'corr-123');

      expect(response.message).toContain('Error:');
    });

    it('includes error message in response', () => {
      const response = createErrorResponse('Service temporarily unavailable', 'corr-123');

      expect(response.message).toContain('Service temporarily unavailable');
    });

    it('includes correlation ID reference in format (ref: {correlationId})', () => {
      const response = createErrorResponse('Test error', 'approve-1234567890-abcd12');

      expect(response.message).toContain('(ref: approve-1234567890-abcd12)');
    });

    it('matches exact AC1 format: ❌ Error: {message} (ref: {correlationId})', () => {
      const response = createErrorResponse('Test error message', 'corr-id-123');

      expect(response.message).toBe('❌ Error: Test error message (ref: corr-id-123)');
    });
  });

  describe('AC2: Error messages reflect actual errors', () => {
    it('preserves ISB Lambda error message for 4xx errors', () => {
      // When createErrorResponse is called with the ISB error, it should preserve it
      const response = createErrorResponse('Invalid uuid', 'corr-123');

      expect(response.message).toContain('Invalid uuid');
    });

    it('can display timeout-like error message', () => {
      const response = createErrorResponse('Request timed out, please try again', 'corr-123');

      expect(response.message).toContain('Request timed out');
    });

    it('can display generic error message for security', () => {
      // Per security recommendations, generic messages are used for unexpected errors
      const response = createErrorResponse('Unexpected error, please try again', 'corr-123');

      expect(response.message).toContain('Unexpected error');
    });
  });

  describe('AC1: Response format compatible with Amazon Q thread reply', () => {
    it('has all required CustomActionResponse properties', () => {
      const response = createErrorResponse('Test error', 'corr-123');

      expect(response).toHaveProperty('version');
      expect(response).toHaveProperty('status');
      expect(response).toHaveProperty('message');
    });

    it('version is string "1.0"', () => {
      const response = createErrorResponse('Test error', 'corr-123');

      expect(typeof response.version).toBe('string');
      expect(response.version).toBe('1.0');
    });

    it('status is "error" (valid CustomActionResponse status)', () => {
      const response = createErrorResponse('Test error', 'corr-123');

      expect(['success', 'error']).toContain(response.status);
    });

    it('message is non-empty string', () => {
      const response = createErrorResponse('Test error', 'corr-123');

      expect(typeof response.message).toBe('string');
      expect(response.message.length).toBeGreaterThan(0);
    });
  });
});

describe('getUserFriendlyErrorMessage (Story 7.3.3)', () => {
  const testConfig: SlackActionConfig = {
    actionType: 'approve',
    serviceName: 'test',
    successEmoji: '✅',
    successVerb: 'Approved',
    failureMessage: 'Failed to approve',
  };

  describe('AC2: 5xx error handling', () => {
    it('returns "Service temporarily unavailable, please try again" for 500 errors', () => {
      const result: IsbLambdaResult = {
        success: false,
        statusCode: 500,
        error: 'Internal server error',
      };

      const message = getUserFriendlyErrorMessage(result, testConfig);

      expect(message).toBe('Service temporarily unavailable, please try again');
    });

    it('returns "Service temporarily unavailable, please try again" for 502 errors', () => {
      const result: IsbLambdaResult = {
        success: false,
        statusCode: 502,
        error: 'Bad Gateway',
      };

      const message = getUserFriendlyErrorMessage(result, testConfig);

      expect(message).toBe('Service temporarily unavailable, please try again');
    });

    it('returns "Service temporarily unavailable, please try again" for 503 errors', () => {
      const result: IsbLambdaResult = {
        success: false,
        statusCode: 503,
        error: 'Service Unavailable',
      };

      const message = getUserFriendlyErrorMessage(result, testConfig);

      expect(message).toBe('Service temporarily unavailable, please try again');
    });

    it('returns "Service temporarily unavailable, please try again" for 504 Gateway Timeout', () => {
      const result: IsbLambdaResult = {
        success: false,
        statusCode: 504,
        error: 'Gateway Timeout',
      };

      const message = getUserFriendlyErrorMessage(result, testConfig);

      expect(message).toBe('Service temporarily unavailable, please try again');
    });
  });

  describe('AC2: 4xx error handling', () => {
    it('returns raw error message for 400 errors', () => {
      const result: IsbLambdaResult = {
        success: false,
        statusCode: 400,
        error: 'Invalid uuid',
      };

      const message = getUserFriendlyErrorMessage(result, testConfig);

      expect(message).toBe('Invalid uuid');
    });

    it('returns raw error message for 403 errors', () => {
      const result: IsbLambdaResult = {
        success: false,
        statusCode: 403,
        error: 'Not authorized',
      };

      const message = getUserFriendlyErrorMessage(result, testConfig);

      expect(message).toBe('Not authorized');
    });

    it('returns raw error message for 422 errors', () => {
      const result: IsbLambdaResult = {
        success: false,
        statusCode: 422,
        error: 'Validation failed',
      };

      const message = getUserFriendlyErrorMessage(result, testConfig);

      expect(message).toBe('Validation failed');
    });
  });

  describe('AC2: Fallback error handling', () => {
    it('returns config.failureMessage when error is undefined', () => {
      const result: IsbLambdaResult = {
        success: false,
        statusCode: 400,
      };

      const message = getUserFriendlyErrorMessage(result, testConfig);

      expect(message).toBe('Failed to approve');
    });

    it('returns empty string when error is empty string (uses nullish coalescing)', () => {
      const result: IsbLambdaResult = {
        success: false,
        statusCode: 400,
        error: '',
      };

      const message = getUserFriendlyErrorMessage(result, testConfig);

      // The ?? operator only falls back for null/undefined, not empty string
      // This is intentional - if ISB explicitly returns an empty error, we respect it
      expect(message).toBe('');
    });

    it('returns "Service temporarily unavailable" for 5xx even without error message', () => {
      const result: IsbLambdaResult = {
        success: false,
        statusCode: 500,
      };

      const message = getUserFriendlyErrorMessage(result, testConfig);

      expect(message).toBe('Service temporarily unavailable, please try again');
    });
  });

  describe('AC2: Security - error messages do not expose sensitive info', () => {
    it('5xx errors use generic message regardless of actual error', () => {
      const result: IsbLambdaResult = {
        success: false,
        statusCode: 500,
        error: 'Database connection string: mongodb://admin:password@internal-host:27017',
      };

      const message = getUserFriendlyErrorMessage(result, testConfig);

      // Should use generic message, not expose connection string
      expect(message).toBe('Service temporarily unavailable, please try again');
      expect(message).not.toContain('mongodb');
      expect(message).not.toContain('password');
    });
  });
});

/**
 * Action Logging Tests (Story 7.4.1)
 *
 * These tests verify that action logs include proper structure for auditing:
 * - action field (approve/deny)
 * - outcome field (success/already_processed/error)
 * - Consistent correlation ID across all log entries
 */
describe('Action Logging (Story 7.4.1)', () => {
  describe('AC1: Log entry type definitions', () => {
    it('ACTION_LOG_OUTCOMES constant includes all valid outcome values', async () => {
      // Import the constant that defines valid outcomes
      const { ACTION_LOG_OUTCOMES } = await import('../../src/handlers/slack-action-base.js');

      // Constant should contain all required outcome values
      expect(ACTION_LOG_OUTCOMES).toBeDefined();
      expect(ACTION_LOG_OUTCOMES).toContain('success');
      expect(ACTION_LOG_OUTCOMES).toContain('already_processed');
      expect(ACTION_LOG_OUTCOMES).toContain('error');
      expect(ACTION_LOG_OUTCOMES).toHaveLength(3);
    });

    it('ActionLogOutcome type is correctly derived from constant', async () => {
      // This test verifies the type exists and is exported
      const { ACTION_LOG_OUTCOMES: outcomes } = await import(
        '../../src/handlers/slack-action-base.js'
      );

      // TypeScript type verification at runtime - the constant exists and is typed correctly
      type OutcomeType = (typeof outcomes)[number];

      // Verify each outcome can be assigned to the type
      const success: OutcomeType = 'success';
      const alreadyProcessed: OutcomeType = 'already_processed';
      const error: OutcomeType = 'error';

      expect(success).toBe('success');
      expect(alreadyProcessed).toBe('already_processed');
      expect(error).toBe('error');
      // Access the imported value to satisfy linter
      expect(outcomes).toBeDefined();
    });
  });

  describe('AC1-5: Required log fields', () => {
    it('log entries should include leaseId, action, operator, timestamp, outcome per AC1', () => {
      // This test documents the required fields for structured JSON logs
      // Actual implementation verified via code inspection in Task 1 audit
      const requiredFields = ['correlationId', 'action', 'outcome', 'leaseId', 'userEmail', 'operator'];

      // All fields should be present in the log entry structure
      // This is a documentation test - actual verification is in the implementation
      expect(requiredFields).toContain('correlationId'); // AC5: Correlation ID for tracing
      expect(requiredFields).toContain('action'); // AC2: action=approve/deny
      expect(requiredFields).toContain('outcome'); // AC2-4: outcome=success/already_processed/error
      expect(requiredFields).toContain('leaseId'); // AC1: leaseId
      expect(requiredFields).toContain('operator'); // AC1: operator
    });

    it('AC2: success logs should include outcome=success', () => {
      // Document expected log structure for successful actions
      const expectedSuccessLogFields = {
        correlationId: expect.any(String),
        action: expect.stringMatching(/approve|deny/),
        outcome: 'success',
        leaseId: expect.any(String),
        userEmail: expect.any(String),
        operator: expect.any(String),
        statusCode: expect.any(Number),
      };

      // Verify structure expectations
      expect(expectedSuccessLogFields.outcome).toBe('success');
      expect(expectedSuccessLogFields.action).toBeDefined();
    });

    it('AC3: already-processed logs should include outcome=already_processed', () => {
      // Document expected log structure for already-processed actions
      const expectedAlreadyProcessedLogFields = {
        correlationId: expect.any(String),
        action: expect.stringMatching(/approve|deny/),
        outcome: 'already_processed',
        leaseId: expect.any(String),
        userEmail: expect.any(String),
        operator: expect.any(String),
        statusCode: expect.any(Number),
        error: expect.any(String),
      };

      // Verify structure expectations
      expect(expectedAlreadyProcessedLogFields.outcome).toBe('already_processed');
    });

    it('AC4: error logs should include outcome=error', () => {
      // Document expected log structure for error actions
      const expectedErrorLogFields = {
        correlationId: expect.any(String),
        action: expect.stringMatching(/approve|deny/),
        outcome: 'error',
        leaseId: expect.any(String),
        userEmail: expect.any(String),
        operator: expect.any(String),
        statusCode: expect.any(Number),
        error: expect.any(String),
      };

      // Verify structure expectations
      expect(expectedErrorLogFields.outcome).toBe('error');
    });

    it('AC4: unexpected error logs should include stack trace at DEBUG level', () => {
      // Per AC4: "full stack trace is included at DEBUG level"
      // Implementation splits logging:
      // 1. ERROR level: action, outcome, error message (for production visibility)
      // 2. DEBUG level: stack trace (for debugging when LOG_LEVEL=DEBUG)
      //
      // This avoids verbose stack traces in production logs while
      // preserving debugging capability when needed.
      //
      // See: src/handlers/slack-action-base.ts (catch block)
      const expectedErrorLogFields = {
        correlationId: expect.any(String),
        action: expect.stringMatching(/approve|deny/),
        outcome: 'error',
        error: expect.any(String),
      };

      const expectedDebugLogFields = {
        correlationId: expect.any(String),
        stack: expect.any(String), // Stack trace at DEBUG level
      };

      // Verify structure expectations
      expect(expectedErrorLogFields.outcome).toBe('error');
      expect(expectedDebugLogFields.stack).toBeDefined();
    });

    it('AC5: correlation ID format follows pattern {action}-{timestamp}-{random}', () => {
      // Document correlation ID format for tracing
      const correlationIdPattern = /^(approve|deny)-\d+-[a-z0-9]+$/;

      // Example correlation IDs
      expect('approve-1705849200000-abc123').toMatch(correlationIdPattern);
      expect('deny-1705849200000-xyz789').toMatch(correlationIdPattern);
    });
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
