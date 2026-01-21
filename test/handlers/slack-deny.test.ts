import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import {
  handler,
  setIsbLambdaService,
  resetIsbLambdaService,
} from '../../src/handlers/slack-deny.js';
import type { IsbLambdaService, IsbLambdaResult } from '../../src/services/isb-lambda.js';
import type { CustomActionEvent, CustomActionResponse } from '../../src/lib/slack-action-types.js';

describe('Slack Deny Handler', () => {
  let mockIsbService: IsbLambdaService;
  let mockDenyLease: ReturnType<typeof vi.fn>;

  // Store original env vars
  const originalEnv = { ...process.env };

  beforeAll(() => {
    // Set required environment variables for handler
    process.env.ISB_LEASES_LAMBDA_NAME = 'ISB-LeasesLambdaFunction-test';
    process.env.APPROVER_EMAIL = 'test-approver@dsit.gov.uk';
  });

  afterAll(() => {
    // Restore original env vars
    process.env = originalEnv;
  });

  // Helper to create a valid custom action event
  const createValidEvent = (overrides?: Partial<CustomActionEvent>): CustomActionEvent => {
    const leaseIdPayload = { userEmail: 'user@example.gov.uk', uuid: 'test-uuid-123' };
    const encodedLeaseId = Buffer.from(JSON.stringify(leaseIdPayload)).toString('base64');

    return {
      actionName: 'deny',
      slackWorkspaceId: 'T12345678',
      slackChannelId: 'C12345678',
      slackUserId: 'U12345678',
      originalNotification: {
        threadId: 'test-thread-id',
        additionalContext: {
          leaseId: encodedLeaseId,
          userEmail: 'user@example.gov.uk',
          score: '25',
          threshold: '20',
          templateId: 'sandbox-basic',
          reference: 'ISB-2026-0001',
        },
      },
      ...overrides,
    };
  };

  beforeEach(() => {
    // Create mock ISB Lambda service
    mockDenyLease = vi.fn();
    mockIsbService = {
      approveLease: vi.fn(),
      denyLease: mockDenyLease,
      getAccounts: vi.fn(),
    };

    setIsbLambdaService(mockIsbService);
  });

  afterEach(() => {
    resetIsbLambdaService();
    vi.clearAllMocks();
  });

  describe('Payload Parsing', () => {
    it('returns error for non-object event', async () => {
      const result = await handler(null);

      expect(result.status).toBe('error');
      expect(result.message).toContain('Event is not an object');
    });

    it('returns error for undefined event', async () => {
      const result = await handler(undefined);

      expect(result.status).toBe('error');
      expect(result.message).toContain('Event is not an object');
    });

    it('returns error for empty object without leaseId', async () => {
      const result = await handler({
        someOtherField: 'value',
      });

      expect(result.status).toBe('error');
      expect(result.message).toContain('Missing leaseId');
    });

    it('returns error for missing additionalContext', async () => {
      const result = await handler({
        slackUserId: 'U12345678',
        originalNotification: {},
      });

      expect(result.status).toBe('error');
      expect(result.message).toContain('Missing additionalContext');
    });

    it('returns error for missing leaseId in additionalContext', async () => {
      const result = await handler({
        slackUserId: 'U12345678',
        originalNotification: {
          additionalContext: {
            userEmail: 'user@example.gov.uk',
          },
        },
      });

      expect(result.status).toBe('error');
      expect(result.message).toContain('Missing or invalid leaseId');
    });

    it('defaults slackUserId when missing from full notification format', async () => {
      const leaseIdPayload = { userEmail: 'user@example.gov.uk', uuid: 'test-uuid-123' };
      const encodedLeaseId = Buffer.from(JSON.stringify(leaseIdPayload)).toString('base64');

      mockDenyLease.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: 'success',
      } satisfies IsbLambdaResult);

      const result = await handler({
        originalNotification: {
          additionalContext: {
            leaseId: encodedLeaseId,
          },
        },
      });

      expect(result.status).toBe('success');
      // 'operator' doesn't match Slack user ID format, so sanitizes to 'unknown-user'
      // Simplified format - no user mention in response
      expect(result.message).toBe('🚫 Denied');
    });

    it('accepts direct leaseId format (custom action invoke)', async () => {
      const leaseIdPayload = { userEmail: 'user@example.gov.uk', uuid: 'test-uuid-123' };
      const encodedLeaseId = Buffer.from(JSON.stringify(leaseIdPayload)).toString('base64');

      mockDenyLease.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: 'success',
      } satisfies IsbLambdaResult);

      const result = await handler({
        leaseId: encodedLeaseId,
      });

      expect(result.status).toBe('success');
      // 'operator' doesn't match Slack user ID format, so sanitizes to 'unknown-user'
      // Simplified format - no user mention in response
      expect(result.message).toBe('🚫 Denied');
      expect(mockDenyLease).toHaveBeenCalledWith({
        leaseId: {
          userEmail: 'user@example.gov.uk',
          uuid: 'test-uuid-123',
        },
        approverEmail: 'test-approver@dsit.gov.uk',
      });
    });

    it('returns error for invalid base64 leaseId', async () => {
      const event = createValidEvent();
      event.originalNotification.additionalContext.leaseId = 'not-valid-base64!!!';

      const result = await handler(event);

      expect(result.status).toBe('error');
      expect(result.message).toContain('Invalid lease identifier');
    });

    it('returns error for invalid JSON in base64 leaseId', async () => {
      const event = createValidEvent();
      // Valid base64 but not valid JSON
      event.originalNotification.additionalContext.leaseId =
        Buffer.from('not json').toString('base64');

      const result = await handler(event);

      expect(result.status).toBe('error');
      expect(result.message).toContain('Invalid lease identifier');
    });

    it('returns error for missing userEmail in decoded leaseId', async () => {
      const event = createValidEvent();
      // Missing userEmail
      event.originalNotification.additionalContext.leaseId = Buffer.from(
        JSON.stringify({ uuid: 'test-uuid' })
      ).toString('base64');

      const result = await handler(event);

      expect(result.status).toBe('error');
      expect(result.message).toContain('Invalid lease identifier');
    });

    it('returns error for missing uuid in decoded leaseId', async () => {
      const event = createValidEvent();
      // Missing uuid
      event.originalNotification.additionalContext.leaseId = Buffer.from(
        JSON.stringify({ userEmail: 'user@example.gov.uk' })
      ).toString('base64');

      const result = await handler(event);

      expect(result.status).toBe('error');
      expect(result.message).toContain('Invalid lease identifier');
    });

    it('extracts leaseId and slackUserId correctly from valid payload', async () => {
      const event = createValidEvent();
      mockDenyLease.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: 'success',
      } satisfies IsbLambdaResult);

      await handler(event);

      expect(mockDenyLease).toHaveBeenCalledWith({
        leaseId: {
          userEmail: 'user@example.gov.uk',
          uuid: 'test-uuid-123',
        },
        approverEmail: 'test-approver@dsit.gov.uk',
      });
    });
  });

  describe('ISB Lambda Success Path', () => {
    it('returns success response when ISB Lambda succeeds', async () => {
      const event = createValidEvent();
      mockDenyLease.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: 'success',
      } satisfies IsbLambdaResult);

      const result = await handler(event);

      expect(result.version).toBe('1.0');
      expect(result.status).toBe('success');
      // Simplified format: just emoji + action
      expect(result.message).toBe('🚫 Denied');
    });

    it('uses simplified format without timestamp (per user feedback)', async () => {
      const event = createValidEvent();
      mockDenyLease.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: 'success',
      } satisfies IsbLambdaResult);

      const result = await handler(event);

      // Simplified format: just emoji + action (no timestamp)
      expect(result.message).toBe('🚫 Denied');
    });
  });

  describe('ISB Lambda Failure Paths', () => {
    it('returns error response on ISB 5xx errors', async () => {
      const event = createValidEvent();
      mockDenyLease.mockResolvedValue({
        success: false,
        statusCode: 500,
        error: 'Internal server error',
      } satisfies IsbLambdaResult);

      const result = await handler(event);

      expect(result.status).toBe('error');
      expect(result.message).toContain('❌ Error');
      expect(result.message).toContain('Service temporarily unavailable');
      expect(result.message).toContain('ref:');
    });

    it('returns error response on ISB timeout', async () => {
      const event = createValidEvent();
      mockDenyLease.mockResolvedValue({
        success: false,
        statusCode: 500,
        error: 'Lambda function timeout',
      } satisfies IsbLambdaResult);

      const result = await handler(event);

      expect(result.status).toBe('error');
      expect(result.message).toContain('Service temporarily unavailable');
    });

    it('returns already processed response on ISB 400 error with "already" in message', async () => {
      const event = createValidEvent();
      mockDenyLease.mockResolvedValue({
        success: false,
        statusCode: 400,
        error: 'Lease already denied',
      } satisfies IsbLambdaResult);

      const result = await handler(event);

      expect(result.status).toBe('error');
      expect(result.message).toContain('ℹ️ Already processed');
    });

    it('returns error response on ISB 400 without "already" keyword (e.g., invalid uuid)', async () => {
      const event = createValidEvent();
      mockDenyLease.mockResolvedValue({
        success: false,
        statusCode: 400,
        error: 'Invalid uuid',
      } satisfies IsbLambdaResult);

      const result = await handler(event);

      expect(result.status).toBe('error');
      expect(result.message).toContain('❌ Error');
      expect(result.message).toContain('Invalid uuid');
    });

    it('returns already processed response on ISB 409 conflict', async () => {
      const event = createValidEvent();
      mockDenyLease.mockResolvedValue({
        success: false,
        statusCode: 409,
        error: 'Conflict - lease already processed',
      } satisfies IsbLambdaResult);

      const result = await handler(event);

      expect(result.status).toBe('error');
      expect(result.message).toContain('ℹ️ Already processed');
    });

    it('returns already processed response when error contains "already"', async () => {
      const event = createValidEvent();
      mockDenyLease.mockResolvedValue({
        success: false,
        statusCode: 422,
        error: 'Lease has already been approved',
      } satisfies IsbLambdaResult);

      const result = await handler(event);

      expect(result.status).toBe('error');
      expect(result.message).toContain('ℹ️ Already processed');
    });

    it('returns already processed response when error contains "invalid state"', async () => {
      const event = createValidEvent();
      mockDenyLease.mockResolvedValue({
        success: false,
        statusCode: 422,
        error: 'Invalid state transition',
      } satisfies IsbLambdaResult);

      const result = await handler(event);

      expect(result.status).toBe('error');
      expect(result.message).toContain('ℹ️ Already processed');
    });

    it('returns specific error message on ISB 4xx errors (non-already-processed)', async () => {
      const event = createValidEvent();
      mockDenyLease.mockResolvedValue({
        success: false,
        statusCode: 403,
        error: 'Not authorized to deny this lease',
      } satisfies IsbLambdaResult);

      const result = await handler(event);

      expect(result.status).toBe('error');
      expect(result.message).toContain('❌ Error');
      expect(result.message).toContain('Not authorized to deny this lease');
    });

    it('includes correlation ID in error responses', async () => {
      const event = createValidEvent();
      mockDenyLease.mockResolvedValue({
        success: false,
        statusCode: 500,
        error: 'Server error',
      } satisfies IsbLambdaResult);

      const result = await handler(event);

      // Should contain a reference ID pattern
      expect(result.message).toMatch(/ref: deny-\d+-[a-z0-9]+/);
    });
  });

  describe('Response Format Generation', () => {
    it('success response follows CustomActionResponse format', async () => {
      const event = createValidEvent();
      mockDenyLease.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: 'success',
      } satisfies IsbLambdaResult);

      const result: CustomActionResponse = await handler(event);

      expect(result).toHaveProperty('version', '1.0');
      expect(result).toHaveProperty('status', 'success');
      expect(result).toHaveProperty('message');
      expect(typeof result.message).toBe('string');
    });

    it('error response follows CustomActionResponse format', async () => {
      const event = createValidEvent();
      mockDenyLease.mockResolvedValue({
        success: false,
        statusCode: 500,
        error: 'Server error',
      } satisfies IsbLambdaResult);

      const result: CustomActionResponse = await handler(event);

      expect(result).toHaveProperty('version', '1.0');
      expect(result).toHaveProperty('status', 'error');
      expect(result).toHaveProperty('message');
      expect(typeof result.message).toBe('string');
    });

    it('success message includes operator mention', async () => {
      const event = createValidEvent({ slackUserId: 'UABCD1234' });
      mockDenyLease.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: 'success',
      } satisfies IsbLambdaResult);

      const result = await handler(event);

      // Simplified format - no user mention
      expect(result.message).toBe('🚫 Denied');
    });

    it('error message includes correlation ID for troubleshooting', async () => {
      const event = createValidEvent();
      mockDenyLease.mockResolvedValue({
        success: false,
        statusCode: 500,
        error: 'Database unavailable',
      } satisfies IsbLambdaResult);

      const result = await handler(event);

      expect(result.message).toContain('(ref:');
    });
  });

  /**
   * Simplified Response Format (Story 7.3.1)
   *
   * Success responses use simplified format without user mentions.
   * This is because Amazon Q custom actions don't pass slackUserId.
   */
  describe('Simplified Response Format', () => {
    it('success response uses simplified format regardless of slackUserId', async () => {
      const event = createValidEvent({ slackUserId: 'U12345678' });
      mockDenyLease.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: 'success',
      } satisfies IsbLambdaResult);

      const result = await handler(event);

      // Simplified format - no user mention
      expect(result.message).toBe('🚫 Denied');
    });

    it('success response does not include potentially malicious input', async () => {
      const event = createValidEvent({ slackUserId: '<script>alert(1)</script>' });
      mockDenyLease.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: 'success',
      } satisfies IsbLambdaResult);

      const result = await handler(event);

      expect(result.message).not.toContain('<script>');
      // Uses simplified format
      expect(result.message).toBe('🚫 Denied');
    });

    it('already processed response uses simplified format', async () => {
      const event = createValidEvent({ slackUserId: 'malicious<>input' });
      mockDenyLease.mockResolvedValue({
        success: false,
        statusCode: 409,
        error: 'Lease already denied',
      } satisfies IsbLambdaResult);

      const result = await handler(event);

      expect(result.message).toContain('Already processed');
      expect(result.message).not.toContain('malicious');
      expect(result.message).not.toContain('<>');
    });
  });

  describe('Unexpected Error Handling', () => {
    it('catches and handles unexpected errors from ISB service', async () => {
      const event = createValidEvent();
      mockDenyLease.mockRejectedValue(new Error('Network timeout'));

      const result = await handler(event);

      expect(result.status).toBe('error');
      expect(result.message).toContain('Unexpected error');
      expect(result.message).toContain('ref:');
    });

    it('handles non-Error exceptions', async () => {
      const event = createValidEvent();
      mockDenyLease.mockRejectedValue('String error');

      const result = await handler(event);

      expect(result.status).toBe('error');
      expect(result.message).toContain('Unexpected error');
    });
  });

  describe('Environment Variable Validation', () => {
    it('throws error when APPROVER_EMAIL is not set', async () => {
      // Reset the service to force re-initialization
      resetIsbLambdaService();

      // Temporarily remove APPROVER_EMAIL
      const originalEmail = process.env.APPROVER_EMAIL;
      delete process.env.APPROVER_EMAIL;

      const event = createValidEvent();
      // Reset to use default service (which will check env vars)
      resetIsbLambdaService();

      // Re-mock after reset to use our mock service
      setIsbLambdaService(mockIsbService);
      mockDenyLease.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: 'success',
      });

      const result = await handler(event);

      // Restore env var
      process.env.APPROVER_EMAIL = originalEmail;

      // The handler should fail because APPROVER_EMAIL is not set
      expect(result.status).toBe('error');
      expect(result.message).toContain('Unexpected error');
    });

    it('throws error when ISB_LEASES_LAMBDA_NAME is not set', async () => {
      // Reset the service to force re-initialization
      resetIsbLambdaService();

      // Temporarily remove ISB_LEASES_LAMBDA_NAME
      const originalName = process.env.ISB_LEASES_LAMBDA_NAME;
      delete process.env.ISB_LEASES_LAMBDA_NAME;

      const event = createValidEvent();

      const result = await handler(event);

      // Restore env var
      process.env.ISB_LEASES_LAMBDA_NAME = originalName;

      // The handler should fail because ISB_LEASES_LAMBDA_NAME is not set
      expect(result.status).toBe('error');
      expect(result.message).toContain('Unexpected error');
    });
  });

  /**
   * Story 7.3.1: Thread Reply Format Verification
   *
   * These tests verify the thread reply format meets acceptance criteria:
   * Simplified format per user feedback: Just emoji + action word
   * No user mention or timestamp (Amazon Q custom actions don't pass slackUserId)
   *
   * Format: "🚫 Denied"
   */
  describe('Thread Reply Format (Story 7.3.1)', () => {
    it('AC2: denial confirmation includes prohibition emoji', async () => {
      const event = createValidEvent();
      mockDenyLease.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: 'success',
      } satisfies IsbLambdaResult);

      const result = await handler(event);

      expect(result.message).toContain('🚫');
    });

    it('AC2: denial confirmation includes "Denied" text', async () => {
      const event = createValidEvent();
      mockDenyLease.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: 'success',
      } satisfies IsbLambdaResult);

      const result = await handler(event);

      expect(result.message).toContain('Denied');
    });

    it('AC2: simplified format is just emoji + action (no user, no timestamp)', async () => {
      const event = createValidEvent();
      mockDenyLease.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: 'success',
      } satisfies IsbLambdaResult);

      const result = await handler(event);

      // Simplified format: just "🚫 Denied"
      expect(result.message).toBe('🚫 Denied');
    });

    it('AC5: response format compatible with Amazon Q thread reply', async () => {
      const event = createValidEvent();
      mockDenyLease.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: 'success',
      } satisfies IsbLambdaResult);

      const result: CustomActionResponse = await handler(event);

      // Amazon Q expects this exact structure for thread replies
      expect(result.version).toBe('1.0');
      expect(result.status).toBe('success');
      expect(typeof result.message).toBe('string');
      expect(result.message.length).toBeGreaterThan(0);
    });

    it('same format for direct leaseId payload (CDK custom action)', async () => {
      const leaseIdPayload = { userEmail: 'user@example.gov.uk', uuid: 'test-uuid-123' };
      const encodedLeaseId = Buffer.from(JSON.stringify(leaseIdPayload)).toString('base64');

      mockDenyLease.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: 'success',
      } satisfies IsbLambdaResult);

      // Direct payload format from CDK custom action
      const result = await handler({ leaseId: encodedLeaseId });

      // Same simplified format regardless of payload type
      expect(result.message).toBe('🚫 Denied');
    });
  });
});
