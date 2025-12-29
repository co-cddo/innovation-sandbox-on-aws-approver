/**
 * Slack Service Tests (Story 5.2)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createSlackService,
  formatScoreBreakdownForSlack,
  buildSlackPayload,
  encodeLeaseCompositeKey,
  type EscalationNotificationParams,
  type SlackLogger,
} from '../../src/services/slack.js';
import type { SQSService } from '../../src/services/sqs.js';

describe('Slack Service (Story 5.2)', () => {
  // Mock fetch
  const mockFetch = vi.fn();

  // Mock SQS service
  const createMockSQSService = (queueDepth: number = 3): SQSService => ({
    sendDelayedRequest: vi.fn(),
    receiveMessages: vi.fn(),
    deleteMessage: vi.fn(),
    getQueueDepth: vi.fn().mockResolvedValue({
      success: true,
      approximateNumberOfMessages: queueDepth,
    }),
  });

  // Mock logger
  const createMockLogger = (): SlackLogger => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  });

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('formatScoreBreakdownForSlack (AC3)', () => {
    it('should format breakdown with bullet points', () => {
      const breakdown = {
        first_time_user: 5,
        group_mailbox_detected: 20,
      };

      const result = formatScoreBreakdownForSlack(breakdown);

      expect(result).toContain('• group_mailbox_detected: +20');
      expect(result).toContain('• first_time_user: +5');
    });

    it('should sort by absolute contribution (highest first)', () => {
      const breakdown = {
        small_rule: 2,
        big_rule: 20,
        medium_rule: -10,
      };

      const result = formatScoreBreakdownForSlack(breakdown);
      const lines = result.split('\n');

      // big_rule (20) should be first, then medium_rule (-10), then small_rule (2)
      expect(lines[0]).toContain('big_rule');
      expect(lines[1]).toContain('medium_rule');
      expect(lines[2]).toContain('small_rule');
    });

    it('should filter out zero-value rules', () => {
      const breakdown = {
        triggered_rule: 5,
        zero_rule: 0,
        another_rule: -3,
      };

      const result = formatScoreBreakdownForSlack(breakdown);

      expect(result).not.toContain('zero_rule');
      expect(result).toContain('triggered_rule');
      expect(result).toContain('another_rule');
    });

    it('should handle negative values correctly', () => {
      const breakdown = {
        verified_gov_domain: -5,
        org_clean_record: -2,
      };

      const result = formatScoreBreakdownForSlack(breakdown);

      expect(result).toContain('• verified_gov_domain: -5');
      expect(result).toContain('• org_clean_record: -2');
    });

    it('should return placeholder for empty breakdown', () => {
      const result = formatScoreBreakdownForSlack({});

      expect(result).toBe('• No rules triggered');
    });

    it('should return placeholder when all rules are zero', () => {
      const breakdown = {
        rule1: 0,
        rule2: 0,
      };

      const result = formatScoreBreakdownForSlack(breakdown);

      expect(result).toBe('• No rules triggered');
    });
  });

  describe('encodeLeaseCompositeKey', () => {
    it('should encode userEmail and uuid to base64 JSON', () => {
      const encoded = encodeLeaseCompositeKey(
        'user@example.gov.uk',
        'abc-123-def'
      );
      const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
      expect(decoded).toEqual({
        userEmail: 'user@example.gov.uk',
        uuid: 'abc-123-def',
      });
    });

    it('should handle email with special characters', () => {
      const encoded = encodeLeaseCompositeKey(
        'user+tag@example.gov.uk',
        'uuid-123'
      );
      const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
      expect(decoded.userEmail).toBe('user+tag@example.gov.uk');
    });

    it('should produce valid base64 output', () => {
      const encoded = encodeLeaseCompositeKey(
        'test@test.gov.uk',
        'uuid'
      );
      // Base64 regex
      expect(encoded).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it('should handle long email addresses', () => {
      const longEmail = 'very.long.email.address.with.many.parts@subdomain.department.gov.uk';
      const encoded = encodeLeaseCompositeKey(longEmail, 'uuid-456');
      const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
      expect(decoded.userEmail).toBe(longEmail);
    });

    it('should produce consistent encoding for same input', () => {
      const encoded1 = encodeLeaseCompositeKey('user@gov.uk', 'uuid-1');
      const encoded2 = encodeLeaseCompositeKey('user@gov.uk', 'uuid-1');
      expect(encoded1).toBe(encoded2);
    });
  });

  describe('buildSlackPayload (AC2)', () => {
    const params: EscalationNotificationParams = {
      leaseId: 'abc123-def456-ghi789',
      userEmail: 'sarah.jones@council.gov.uk',
      score: 25,
      scoreBreakdown: {
        first_time_user: 5,
        group_mailbox_detected: 20,
      },
      templateId: 'bedrock-basic',
      referenceNumber: 'ISB-2025-0042',
    };

    it('should build payload with all required fields', () => {
      const payload = buildSlackPayload(
        params,
        'https://isb-console.example.com',
        3
      );

      expect(payload.user_email).toBe('sarah.jones@council.gov.uk');
      expect(payload.lease_id).toBe('abc123-def456-ghi789');
      expect(payload.reference).toBe('ISB-2025-0042');
      expect(payload.score).toBe('25');
      expect(payload.threshold).toBe('20');
      expect(payload.template_id).toBe('bedrock-basic');
      expect(payload.queue_depth).toBe('3');
    });

    it('should generate correct console URL with base64 encoded composite key (AC4)', () => {
      const payload = buildSlackPayload(
        params,
        'https://isb-console.example.com',
        0
      );

      // Verify URL structure
      expect(payload.console_url).toMatch(/^https:\/\/isb-console\.example\.com\/leases\/edit\//);

      // Decode and verify the composite key
      const urlParts = payload.console_url.split('/leases/edit/');
      expect(urlParts[0]).toBe('https://isb-console.example.com');
      const decoded = JSON.parse(Buffer.from(urlParts[1]!, 'base64').toString('utf8'));
      expect(decoded).toEqual({
        userEmail: 'sarah.jones@council.gov.uk',
        uuid: 'abc123-def456-ghi789',
      });
    });

    it('should format score breakdown correctly', () => {
      const payload = buildSlackPayload(
        params,
        'https://isb-console.example.com',
        0
      );

      expect(payload.score_breakdown).toContain('• group_mailbox_detected: +20');
      expect(payload.score_breakdown).toContain('• first_time_user: +5');
    });

    it('should use custom threshold when provided', () => {
      const payload = buildSlackPayload(
        params,
        'https://isb-console.example.com',
        0,
        30
      );

      expect(payload.threshold).toBe('30');
    });

    it('should convert all values to strings', () => {
      const payload = buildSlackPayload(
        params,
        'https://isb-console.example.com',
        5
      );

      expect(typeof payload.score).toBe('string');
      expect(typeof payload.threshold).toBe('string');
      expect(typeof payload.queue_depth).toBe('string');
    });
  });

  describe('createSlackService', () => {
    const webhookUrl = 'https://hooks.slack.com/triggers/T123/456/abc';
    const isbConsoleUrl = 'https://isb-console.example.com';
    const params: EscalationNotificationParams = {
      leaseId: 'test-lease-123',
      userEmail: 'user@council.gov.uk',
      score: 25,
      scoreBreakdown: { first_time_user: 5, group_mailbox_detected: 20 },
      templateId: 'bedrock-basic',
      referenceNumber: 'ISB-2025-0001',
    };

    describe('notifyEscalation (AC1, AC5, AC6)', () => {
      it('should send webhook request with correct payload', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve('ok'),
        });

        const sqsService = createMockSQSService(3);
        const service = createSlackService(webhookUrl, isbConsoleUrl, sqsService);

        const result = await service.notifyEscalation(params);

        expect(result.success).toBe(true);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockFetch).toHaveBeenCalledWith(
          webhookUrl,
          expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          })
        );
      });

      it('should include queue depth from SQS service (AC5)', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve('ok'),
        });

        const sqsService = createMockSQSService(7);
        const service = createSlackService(webhookUrl, isbConsoleUrl, sqsService);

        await service.notifyEscalation(params);

        expect(sqsService.getQueueDepth).toHaveBeenCalled();

        const fetchCall = mockFetch.mock.calls[0]!;
        const body = JSON.parse(fetchCall[1].body);
        expect(body.queue_depth).toBe('7');
      });

      it('should use 0 for queue depth on SQS error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve('ok'),
        });

        const sqsService: SQSService = {
          sendDelayedRequest: vi.fn(),
          receiveMessages: vi.fn(),
          deleteMessage: vi.fn(),
          getQueueDepth: vi.fn().mockResolvedValue({
            success: false,
            error: 'SQS error',
          }),
        };
        const logger = createMockLogger();
        const service = createSlackService(
          webhookUrl,
          isbConsoleUrl,
          sqsService,
          logger
        );

        await service.notifyEscalation(params);

        const fetchCall = mockFetch.mock.calls[0]!;
        const body = JSON.parse(fetchCall[1].body);
        expect(body.queue_depth).toBe('0');
        expect(logger.warn).toHaveBeenCalled();
      });

      it('should handle successful response', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve('ok'),
        });

        const sqsService = createMockSQSService();
        const service = createSlackService(webhookUrl, isbConsoleUrl, sqsService);

        const result = await service.notifyEscalation(params);

        expect(result.success).toBe(true);
        expect(result.statusCode).toBe(200);
        expect(result.error).toBeUndefined();
      });

      it('should handle 4xx error response gracefully (AC6)', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          text: () => Promise.resolve('Invalid payload'),
        });

        const sqsService = createMockSQSService();
        const logger = createMockLogger();
        const service = createSlackService(
          webhookUrl,
          isbConsoleUrl,
          sqsService,
          logger
        );

        const result = await service.notifyEscalation(params);

        expect(result.success).toBe(false);
        expect(result.statusCode).toBe(400);
        expect(result.error).toContain('400');
        expect(logger.error).toHaveBeenCalled();
      });

      it('should handle 5xx error response gracefully (AC6)', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: () => Promise.resolve('Server error'),
        });

        const sqsService = createMockSQSService();
        const service = createSlackService(webhookUrl, isbConsoleUrl, sqsService);

        const result = await service.notifyEscalation(params);

        expect(result.success).toBe(false);
        expect(result.statusCode).toBe(500);
        expect(result.error).toContain('500');
      });

      it('should handle timeout gracefully (AC6)', async () => {
        const timeoutError = new Error('The operation was aborted');
        timeoutError.name = 'TimeoutError';
        mockFetch.mockRejectedValueOnce(timeoutError);

        const sqsService = createMockSQSService();
        const logger = createMockLogger();
        const service = createSlackService(
          webhookUrl,
          isbConsoleUrl,
          sqsService,
          logger
        );

        const result = await service.notifyEscalation(params);

        expect(result.success).toBe(false);
        expect(result.error).toContain('timeout');
        expect(logger.error).toHaveBeenCalledWith(
          'Failed to send Slack notification',
          expect.objectContaining({
            isTimeout: true,
          })
        );
      });

      it('should handle network error gracefully (AC6)', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        const sqsService = createMockSQSService();
        const service = createSlackService(webhookUrl, isbConsoleUrl, sqsService);

        const result = await service.notifyEscalation(params);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Network error');
      });

      it('should log success with relevant details', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve('ok'),
        });

        const sqsService = createMockSQSService();
        const logger = createMockLogger();
        const service = createSlackService(
          webhookUrl,
          isbConsoleUrl,
          sqsService,
          logger
        );

        await service.notifyEscalation(params);

        expect(logger.info).toHaveBeenCalledWith(
          'Sending Slack escalation notification',
          expect.objectContaining({
            leaseId: params.leaseId,
            userEmail: params.userEmail,
            score: params.score,
          })
        );

        expect(logger.info).toHaveBeenCalledWith(
          'Slack escalation notification sent successfully',
          expect.objectContaining({
            leaseId: params.leaseId,
            statusCode: 200,
          })
        );
      });

      it('should set Content-Type header correctly', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve('ok'),
        });

        const sqsService = createMockSQSService();
        const service = createSlackService(webhookUrl, isbConsoleUrl, sqsService);

        await service.notifyEscalation(params);

        expect(mockFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            headers: { 'Content-Type': 'application/json' },
          })
        );
      });

      it('should pass signal for timeout', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve('ok'),
        });

        const sqsService = createMockSQSService();
        const service = createSlackService(webhookUrl, isbConsoleUrl, sqsService);

        await service.notifyEscalation(params);

        expect(mockFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            signal: expect.any(AbortSignal),
          })
        );
      });
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete escalation flow', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve('ok'),
      });

      const sqsService = createMockSQSService(5);
      const logger = createMockLogger();
      const service = createSlackService(
        'https://hooks.slack.com/triggers/T123/456/abc',
        'https://isb.sandbox.gov.uk',
        sqsService,
        logger
      );

      const params: EscalationNotificationParams = {
        leaseId: 'f2d3eb78-907a-4c20-8127-7ce45758836d',
        userEmail: 'team@bigcouncil.gov.uk',
        score: 30,
        scoreBreakdown: {
          first_time_user: 5,
          group_mailbox_detected: 20,
          cooldown_violation: 10,
          verified_gov_domain: -5,
        },
        templateId: 'bedrock-pro',
        referenceNumber: 'ISB-2025-1234',
      };

      const result = await service.notifyEscalation(params);

      expect(result.success).toBe(true);

      // Verify payload structure
      const fetchCall = mockFetch.mock.calls[0]!;
      const body = JSON.parse(fetchCall[1].body);

      // Verify non-URL fields
      expect(body.user_email).toBe('team@bigcouncil.gov.uk');
      expect(body.lease_id).toBe('f2d3eb78-907a-4c20-8127-7ce45758836d');
      expect(body.reference).toBe('ISB-2025-1234');
      expect(body.score).toBe('30');
      expect(body.threshold).toBe('20');
      expect(body.template_id).toBe('bedrock-pro');
      expect(body.score_breakdown).toContain('• group_mailbox_detected: +20');
      expect(body.queue_depth).toBe('5');

      // Verify console_url contains base64-encoded composite key
      const urlParts = body.console_url.split('/leases/edit/');
      expect(urlParts[0]).toBe('https://isb.sandbox.gov.uk');
      const decoded = JSON.parse(Buffer.from(urlParts[1], 'base64').toString('utf8'));
      expect(decoded).toEqual({
        userEmail: 'team@bigcouncil.gov.uk',
        uuid: 'f2d3eb78-907a-4c20-8127-7ce45758836d',
      });
    });
  });
});
