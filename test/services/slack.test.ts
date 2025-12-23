/**
 * Slack Service Tests (Story 5.2)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createSlackService,
  formatScoreBreakdownForSlack,
  buildSlackPayload,
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

    it('should generate correct console URL (AC4)', () => {
      const payload = buildSlackPayload(
        params,
        'https://isb-console.example.com',
        0
      );

      expect(payload.console_url).toBe(
        'https://isb-console.example.com/leases/abc123-def456-ghi789'
      );
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

      expect(body).toEqual({
        user_email: 'team@bigcouncil.gov.uk',
        lease_id: 'f2d3eb78-907a-4c20-8127-7ce45758836d',
        reference: 'ISB-2025-1234',
        score: '30',
        threshold: '20',
        template_id: 'bedrock-pro',
        score_breakdown: expect.stringContaining('• group_mailbox_detected: +20'),
        console_url: 'https://isb.sandbox.gov.uk/leases/f2d3eb78-907a-4c20-8127-7ce45758836d',
        queue_depth: '5',
      });
    });
  });
});
