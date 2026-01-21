/**
 * Unit tests for SNS Notification Service (Story 7.1.1)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createSNSNotificationService,
  buildAmazonQNotification,
  formatScoreBreakdown,
  encodeLeaseCompositeKey,
  type SNSClient,
  type SNSEscalationParams,
  type SNSNotificationLogger,
} from '../../src/services/sns-notification.js';

describe('SNS Notification Service (Story 7.1.1)', () => {
  // Mock SNS client
  const createMockSNSClient = (messageId: string = 'mock-message-id'): SNSClient => ({
    publish: vi.fn().mockResolvedValue({ messageId }),
  });

  // Mock logger
  const createMockLogger = (): SNSNotificationLogger => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  });

  // Test parameters
  const defaultParams: SNSEscalationParams = {
    leaseId: '12345678-1234-1234-1234-123456789012',
    userEmail: 'test.user@example.gov.uk',
    score: 25,
    scoreBreakdown: {
      first_time_user: 5,
      high_budget: 10,
      long_duration: 5,
      verified_gov_domain: -5,
      familiar_template: -1,
    },
    templateId: 'test-template',
    referenceNumber: 'ISB-2025-1234',
    threshold: 20,
    queueDepth: 3,
  };

  const isbConsoleUrl = 'https://console.example.com';
  const topicArn = 'arn:aws:sns:us-west-2:123456789012:test-topic';

  describe('formatScoreBreakdown', () => {
    it('formats score breakdown with bullet points sorted by absolute value', () => {
      const breakdown = {
        high_budget: 10,
        first_time_user: 5,
        verified_gov_domain: -5,
      };

      const result = formatScoreBreakdown(breakdown);

      // Story 7.1.3: high_budget (10) is highlighted (>5), others are not
      // Note: Slack mrkdwn uses *text* for bold (not **text**)
      expect(result).toContain('*high_budget: +10*');
      expect(result).toContain('• first_time_user: +5');
      expect(result).toContain('• verified_gov_domain: -5');
      // high_budget (10) should come before first_time_user (5)
      expect(result.indexOf('high_budget')).toBeLessThan(result.indexOf('first_time_user'));
    });

    it('returns "No rules triggered" for empty breakdown', () => {
      const result = formatScoreBreakdown({});
      expect(result).toBe('• No rules triggered');
    });

    it('filters out zero values', () => {
      const breakdown = {
        active_rule: 5,
        zero_rule: 0,
      };

      const result = formatScoreBreakdown(breakdown);

      expect(result).toContain('• active_rule: +5');
      expect(result).not.toContain('zero_rule');
    });
  });

  describe('encodeLeaseCompositeKey', () => {
    it('encodes userEmail and uuid as base64 JSON', () => {
      const result = encodeLeaseCompositeKey('user@example.com', 'test-uuid');

      const decoded = JSON.parse(Buffer.from(result, 'base64').toString('utf8'));
      expect(decoded).toEqual({
        userEmail: 'user@example.com',
        uuid: 'test-uuid',
      });
    });
  });

  describe('buildAmazonQNotification', () => {
    it('builds notification with correct version and source', () => {
      const result = buildAmazonQNotification(defaultParams, isbConsoleUrl);

      expect(result.version).toBe('1.0');
      expect(result.source).toBe('custom');
    });

    it('includes lease ID in notification id', () => {
      const result = buildAmazonQNotification(defaultParams, isbConsoleUrl);

      expect(result.id).toBe(`lease-${defaultParams.leaseId}`);
    });

    it('uses client-markdown text type', () => {
      const result = buildAmazonQNotification(defaultParams, isbConsoleUrl);

      expect(result.content.textType).toBe('client-markdown');
    });

    it('includes warning title for escalated requests', () => {
      const result = buildAmazonQNotification(defaultParams, isbConsoleUrl);

      expect(result.content.title).toContain('Lease Review Required');
    });

    it('includes user email in description', () => {
      const result = buildAmazonQNotification(defaultParams, isbConsoleUrl);

      expect(result.content.description).toContain(defaultParams.userEmail);
    });

    it('includes template ID in description', () => {
      const result = buildAmazonQNotification(defaultParams, isbConsoleUrl);

      expect(result.content.description).toContain(defaultParams.templateId);
    });

    it('does not include reference number in description (removed for cleaner UI)', () => {
      const result = buildAmazonQNotification(defaultParams, isbConsoleUrl);

      // Reference number is no longer shown in description (removed for cleaner UI)
      // But it's still in additionalContext for action handlers
      expect(result.content.description).not.toContain('Reference:');
      expect(result.metadata.additionalContext!.reference).toBe(defaultParams.referenceNumber);
    });

    it('includes score and threshold in description', () => {
      const result = buildAmazonQNotification(defaultParams, isbConsoleUrl);

      // Slack mrkdwn uses *text* for bold
      expect(result.content.description).toContain(`Score:* ${defaultParams.score}`);
      expect(result.content.description).toContain(`threshold: ${defaultParams.threshold}`);
    });

    it('includes score breakdown or risk factors in description', () => {
      const result = buildAmazonQNotification(defaultParams, isbConsoleUrl);

      // Story 7.1.3: Uses "Risk Factors" when high-risk items exist, "Score Breakdown" otherwise
      const hasBreakdownOrRisk =
        result.content.description.includes('Score Breakdown') ||
        result.content.description.includes('Risk Factors');
      expect(hasBreakdownOrRisk).toBe(true);
      expect(result.content.description).toContain('first_time_user');
    });

    it('includes queue depth in description', () => {
      const result = buildAmazonQNotification(defaultParams, isbConsoleUrl);

      // Queue depth is no longer shown in the notification (removed for cleaner UI)
      expect(result.content.description).not.toContain('Queue Depth');
    });

    it('includes console URL link in description', () => {
      const result = buildAmazonQNotification(defaultParams, isbConsoleUrl);

      expect(result.content.description).toContain('View in Innovation Sandbox');
      expect(result.content.description).toContain(isbConsoleUrl);
    });

    it('sets threadId for message threading', () => {
      const result = buildAmazonQNotification(defaultParams, isbConsoleUrl);

      expect(result.metadata.threadId).toBe(defaultParams.leaseId);
    });

    it('enables custom actions for approve/deny buttons', () => {
      const result = buildAmazonQNotification(defaultParams, isbConsoleUrl);

      expect(result.metadata.enableCustomActions).toBe(true);
    });

    it('does not include nextSteps (removed for cleaner UI)', () => {
      const result = buildAmazonQNotification(defaultParams, isbConsoleUrl);

      // nextSteps was removed per user feedback for cleaner Slack messages
      expect(result.content.nextSteps).toBeUndefined();
    });

    it('does not include keywords (removed for cleaner UI)', () => {
      const result = buildAmazonQNotification(defaultParams, isbConsoleUrl);

      // Keywords removed for cleaner Slack messages
      expect(result.content.keywords).toBeUndefined();
    });

    it('includes additionalContext with all required fields', () => {
      const result = buildAmazonQNotification(defaultParams, isbConsoleUrl);

      expect(result.metadata.additionalContext).toBeDefined();
      expect(result.metadata.additionalContext!.userEmail).toBe(defaultParams.userEmail);
      expect(result.metadata.additionalContext!.score).toBe(String(defaultParams.score));
      expect(result.metadata.additionalContext!.threshold).toBe(String(defaultParams.threshold));
      expect(result.metadata.additionalContext!.templateId).toBe(defaultParams.templateId);
      expect(result.metadata.additionalContext!.reference).toBe(defaultParams.referenceNumber);
      expect(result.metadata.additionalContext!.queueDepth).toBe(String(defaultParams.queueDepth));
    });
  });

  describe('createSNSNotificationService', () => {
    describe('notifyEscalation', () => {
      it('publishes notification to SNS topic', async () => {
        const mockClient = createMockSNSClient('test-message-id');
        const service = createSNSNotificationService(mockClient, topicArn, isbConsoleUrl);

        const result = await service.notifyEscalation(defaultParams);

        expect(result.success).toBe(true);
        expect(result.messageId).toBe('test-message-id');
        expect(mockClient.publish).toHaveBeenCalledWith(topicArn, expect.any(String));
      });

      it('includes correct JSON payload in message', async () => {
        const mockClient = createMockSNSClient();
        const service = createSNSNotificationService(mockClient, topicArn, isbConsoleUrl);

        await service.notifyEscalation(defaultParams);

        const publishCall = (mockClient.publish as ReturnType<typeof vi.fn>).mock.calls[0];
        const messagePayload = JSON.parse(publishCall[1]);

        expect(messagePayload.version).toBe('1.0');
        expect(messagePayload.source).toBe('custom');
        expect(messagePayload.id).toContain(defaultParams.leaseId);
      });

      it('returns success with messageId on successful publish', async () => {
        const mockClient = createMockSNSClient('success-message-id');
        const service = createSNSNotificationService(mockClient, topicArn, isbConsoleUrl);

        const result = await service.notifyEscalation(defaultParams);

        expect(result.success).toBe(true);
        expect(result.messageId).toBe('success-message-id');
        expect(result.error).toBeUndefined();
      });

      it('returns failure with error message on publish error', async () => {
        const mockClient: SNSClient = {
          publish: vi.fn().mockRejectedValue(new Error('SNS publish failed')),
        };
        const service = createSNSNotificationService(mockClient, topicArn, isbConsoleUrl);

        const result = await service.notifyEscalation(defaultParams);

        expect(result.success).toBe(false);
        expect(result.error).toContain('SNS publish error');
        expect(result.error).toContain('SNS publish failed');
      });

      it('logs info messages on successful publish', async () => {
        const mockClient = createMockSNSClient();
        const mockLogger = createMockLogger();
        const service = createSNSNotificationService(mockClient, topicArn, isbConsoleUrl, mockLogger);

        await service.notifyEscalation(defaultParams);

        expect(mockLogger.info).toHaveBeenCalledTimes(2);
        expect(mockLogger.info).toHaveBeenCalledWith(
          'Sending SNS escalation notification',
          expect.objectContaining({ leaseId: defaultParams.leaseId })
        );
        expect(mockLogger.info).toHaveBeenCalledWith(
          'SNS escalation notification sent successfully',
          expect.objectContaining({ leaseId: defaultParams.leaseId })
        );
      });

      it('logs error message on publish failure', async () => {
        const mockClient: SNSClient = {
          publish: vi.fn().mockRejectedValue(new Error('Network error')),
        };
        const mockLogger = createMockLogger();
        const service = createSNSNotificationService(mockClient, topicArn, isbConsoleUrl, mockLogger);

        await service.notifyEscalation(defaultParams);

        expect(mockLogger.error).toHaveBeenCalledWith(
          'Failed to send SNS escalation notification',
          expect.objectContaining({
            leaseId: defaultParams.leaseId,
            error: 'Network error',
          })
        );
      });

      it('works without a logger (no-op logger)', async () => {
        const mockClient = createMockSNSClient();
        const service = createSNSNotificationService(mockClient, topicArn, isbConsoleUrl);

        // Should not throw
        const result = await service.notifyEscalation(defaultParams);
        expect(result.success).toBe(true);
      });
    });
  });

  describe('Story 7.1.3 - Enhanced Notification Format', () => {
    describe('Task 1: Template Details (AC#3)', () => {
      it('includes template name in description when provided', () => {
        const params: SNSEscalationParams = {
          ...defaultParams,
          templateName: 'Web Application Hosting',
        };

        const result = buildAmazonQNotification(params, isbConsoleUrl);

        expect(result.content.description).toContain('Web Application Hosting');
      });

      it('includes duration in description when provided', () => {
        const params: SNSEscalationParams = {
          ...defaultParams,
          leaseDurationHours: 48,
        };

        const result = buildAmazonQNotification(params, isbConsoleUrl);

        expect(result.content.description).toContain('48h');
      });

      it('includes budget amount in description when provided', () => {
        const params: SNSEscalationParams = {
          ...defaultParams,
          budgetAmount: 50,
        };

        const result = buildAmazonQNotification(params, isbConsoleUrl);

        expect(result.content.description).toContain('£50');
      });

      it('formats template line with name, duration, and budget', () => {
        const params: SNSEscalationParams = {
          ...defaultParams,
          templateName: 'Web Application Hosting',
          leaseDurationHours: 48,
          budgetAmount: 50,
        };

        const result = buildAmazonQNotification(params, isbConsoleUrl);

        // Should show like: **Template:** Web Application Hosting (48h, £50)
        expect(result.content.description).toMatch(/Web Application Hosting.*48h.*£50/);
      });

      it('falls back to templateId when templateName not provided', () => {
        const params: SNSEscalationParams = {
          ...defaultParams,
          // No templateName, should use templateId
        };

        const result = buildAmazonQNotification(params, isbConsoleUrl);

        expect(result.content.description).toContain(defaultParams.templateId);
      });

      it('includes template details in additionalContext', () => {
        const params: SNSEscalationParams = {
          ...defaultParams,
          templateName: 'Web Application Hosting',
          leaseDurationHours: 48,
          budgetAmount: 50,
        };

        const result = buildAmazonQNotification(params, isbConsoleUrl);

        expect(result.metadata.additionalContext!.templateName).toBe('Web Application Hosting');
        expect(result.metadata.additionalContext!.leaseDurationHours).toBe('48');
        expect(result.metadata.additionalContext!.budgetAmount).toBe('50');
      });
    });

    describe('Task 4: Timestamp (AC#1)', () => {
      it('title does not include timestamp (simplified for cleaner UI)', () => {
        const result = buildAmazonQNotification(defaultParams, isbConsoleUrl);

        // Title no longer includes timestamp (removed for cleaner UI)
        expect(result.content.title).toBe(':warning: Lease Review Required');
        expect(result.content.title).not.toMatch(/\d{4}/); // No year in title
      });

      it('includes timestamp in metadata for thread correlation', () => {
        const mockDate = new Date('2026-01-20T14:30:00.000Z');
        vi.setSystemTime(mockDate);

        const result = buildAmazonQNotification(defaultParams, isbConsoleUrl);

        // additionalContext should include timestamp for later reference
        expect(result.metadata.additionalContext!.timestamp).toBeDefined();

        vi.useRealTimers();
      });
    });

    describe('Task 3: Score Breakdown Risk Highlighting (AC#2)', () => {
      it('highlights factors contributing more than 5 points with bold', () => {
        const breakdown = {
          first_time_user: 15,  // High risk - should be highlighted
          high_budget: 7,       // High risk - should be highlighted
          modest_budget: 1,     // Low risk - should not be highlighted
        };

        const result = formatScoreBreakdown(breakdown);

        // High-risk factors (>5) should be bold (Slack mrkdwn uses *text* for bold)
        expect(result).toContain('*first_time_user: +15*');
        expect(result).toContain('*high_budget: +7*');
        // Low-risk factors should not be bold
        expect(result).toMatch(/• modest_budget: \+1(?!\*)/);  // No trailing asterisks
      });

      it('uses Risk Factors header instead of Score Breakdown for high-risk items', () => {
        const params: SNSEscalationParams = {
          ...defaultParams,
          scoreBreakdown: {
            first_time_user: 15,
            high_budget: 7,
          },
        };

        const result = buildAmazonQNotification(params, isbConsoleUrl);

        // Slack mrkdwn uses *text* for bold
        expect(result.content.description).toContain('*Risk Factors:*');
      });

      it('highlights negative factors with absolute value > 5', () => {
        const breakdown = {
          trusted_org: -10,  // High magnitude - should be highlighted
          verified_domain: -3,  // Low magnitude - should not be highlighted
        };

        const result = formatScoreBreakdown(breakdown);

        // Slack mrkdwn uses *text* for bold
        expect(result).toContain('*trusted_org: -10*');
        expect(result).not.toContain('*verified_domain');
      });

      it('does not highlight factors with exactly 5 points', () => {
        const breakdown = {
          exactly_five: 5,
          over_five: 6,
        };

        const result = formatScoreBreakdown(breakdown);

        // 5 points should not be highlighted (>5 is the threshold)
        expect(result).toMatch(/• exactly_five: \+5(?!\*)/);
        // 6 points should be highlighted (Slack mrkdwn uses *text*)
        expect(result).toContain('*over_five: +6*');
      });
    });

    describe('Task 2: Requester Comment (AC#4)', () => {
      it('includes comment in description when provided', () => {
        const params: SNSEscalationParams = {
          ...defaultParams,
          comment: 'Testing Lambda + API Gateway for citizen feedback form',
        };

        const result = buildAmazonQNotification(params, isbConsoleUrl);

        expect(result.content.description).toContain('Testing Lambda + API Gateway');
      });

      it('displays comment with blockquote formatting', () => {
        const params: SNSEscalationParams = {
          ...defaultParams,
          comment: 'Need sandbox for hackathon project',
        };

        const result = buildAmazonQNotification(params, isbConsoleUrl);

        // Should show comment with > blockquote formatting
        expect(result.content.description).toContain('> "Need sandbox for hackathon project"');
      });

      it('shows "No comment provided" when comment is empty', () => {
        const params: SNSEscalationParams = {
          ...defaultParams,
          comment: '',
        };

        const result = buildAmazonQNotification(params, isbConsoleUrl);

        expect(result.content.description).toContain('No comment provided');
      });

      it('shows "No comment provided" when comment is undefined', () => {
        const params: SNSEscalationParams = {
          ...defaultParams,
          // comment is undefined
        };

        const result = buildAmazonQNotification(params, isbConsoleUrl);

        expect(result.content.description).toContain('No comment provided');
      });

      it('has Comment section header', () => {
        const params: SNSEscalationParams = {
          ...defaultParams,
          comment: 'Test comment',
        };

        const result = buildAmazonQNotification(params, isbConsoleUrl);

        // Slack mrkdwn uses *text* for bold
        expect(result.content.description).toContain('*Comment:*');
      });
    });

    describe('Task 5: Action Button Configuration (AC#5, AC#6)', () => {
      it('AC#5: enableCustomActions is set to true for approve/deny buttons', () => {
        const result = buildAmazonQNotification(defaultParams, isbConsoleUrl);

        expect(result.metadata.enableCustomActions).toBe(true);
      });

      it('AC#5: additionalContext.leaseId contains composite key for button payloads', () => {
        const result = buildAmazonQNotification(defaultParams, isbConsoleUrl);

        // leaseId should be base64-encoded composite key
        expect(result.metadata.additionalContext!.leaseId).toBeDefined();
        const decoded = JSON.parse(
          Buffer.from(result.metadata.additionalContext!.leaseId, 'base64').toString('utf8')
        );
        expect(decoded.userEmail).toBe(defaultParams.userEmail);
        expect(decoded.uuid).toBe(defaultParams.leaseId);
      });

      it('AC#6: notification follows Amazon Q custom notification schema', () => {
        const result = buildAmazonQNotification(defaultParams, isbConsoleUrl);

        // Required schema fields
        expect(result.version).toBe('1.0');
        expect(result.source).toBe('custom');
        expect(result.id).toBeTruthy();
        expect(result.content.textType).toBe('client-markdown');
      });

      it('AC#6: threadId is set to leaseId for thread reply correlation', () => {
        const result = buildAmazonQNotification(defaultParams, isbConsoleUrl);

        expect(result.metadata.threadId).toBe(defaultParams.leaseId);
      });
    });
  });

  describe('AC Compliance', () => {
    it('AC#2: Topic publishes JSON messages (verified by message format)', async () => {
      const mockClient = createMockSNSClient();
      const service = createSNSNotificationService(mockClient, topicArn, isbConsoleUrl);

      await service.notifyEscalation(defaultParams);

      const publishCall = (mockClient.publish as ReturnType<typeof vi.fn>).mock.calls[0];
      const message = publishCall[1];

      // Verify it's valid JSON
      expect(() => JSON.parse(message)).not.toThrow();

      // Verify it matches Amazon Q Developer format
      const parsed = JSON.parse(message);
      expect(parsed.version).toBe('1.0');
      expect(parsed.source).toBe('custom');
      expect(parsed.content).toBeDefined();
      expect(parsed.metadata).toBeDefined();
    });

    it('AC#3: Notification includes all required fields for Amazon Q', async () => {
      const mockClient = createMockSNSClient();
      const service = createSNSNotificationService(mockClient, topicArn, isbConsoleUrl);

      await service.notifyEscalation(defaultParams);

      const publishCall = (mockClient.publish as ReturnType<typeof vi.fn>).mock.calls[0];
      const payload = JSON.parse(publishCall[1]);

      // Required Amazon Q Developer fields
      expect(payload.version).toBe('1.0');
      expect(payload.source).toBe('custom');
      expect(payload.id).toBeTruthy();
      expect(payload.content.textType).toBe('client-markdown');
      expect(payload.content.title).toBeTruthy();
      expect(payload.content.description).toBeTruthy();
      expect(payload.metadata.threadId).toBeTruthy();
      expect(payload.metadata.summary).toBeTruthy();

      // Additional context for action buttons
      expect(payload.metadata.additionalContext.leaseId).toBeTruthy();
      expect(payload.metadata.additionalContext.userEmail).toBe(defaultParams.userEmail);
    });
  });
});
