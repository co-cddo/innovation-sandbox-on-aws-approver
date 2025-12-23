/**
 * SQS Service Tests
 *
 * Tests for sending delayed requests to the SQS delay queue.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import {
  createSQSService,
  type DelayedLeaseMessage,
  type SQSLogger,
} from '../../src/services/sqs.js';

// Mock the SQS client
vi.mock('@aws-sdk/client-sqs', async () => {
  const actual = await vi.importActual('@aws-sdk/client-sqs');
  return {
    ...actual,
    SQSClient: vi.fn().mockImplementation(() => ({
      send: vi.fn().mockResolvedValue({}),
    })),
  };
});

describe('SQS Service', () => {
  let mockClient: SQSClient;
  let mockSend: ReturnType<typeof vi.fn>;
  const mockLogger: SQSLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    mockSend = vi.fn().mockResolvedValue({
      MessageId: 'msg-123',
    });
    mockClient = {
      send: mockSend,
    } as unknown as SQSClient;
    vi.clearAllMocks();
  });

  const createTestMessage = (): DelayedLeaseMessage => ({
    leaseId: {
      userEmail: 'test@example.gov.uk',
      uuid: 'test-lease-123',
    },
    originalEvent: { detail: { templateId: 'web-hosting' } },
    receivedAt: '2025-01-15T20:00:00.000Z',
    processAfter: '2025-01-16T07:00:00.000Z',
    reason: 'Outside business hours. Next processing: 2025-01-16T07:00:00.000Z',
  });

  describe('sendDelayedRequest', () => {
    it('should send message to SQS successfully', async () => {
      const service = createSQSService(
        mockClient,
        { queueUrl: 'https://sqs.us-west-2.amazonaws.com/123456789/ApproverDelayQueue' },
        mockLogger
      );

      const message = createTestMessage();
      const result = await service.sendDelayedRequest(message);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-123');
      expect(result.error).toBeUndefined();
    });

    it('should include correct message attributes', async () => {
      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' });

      const message = createTestMessage();
      await service.sendDelayedRequest(message);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0];
      expect(sentCommand).toBeInstanceOf(SendMessageCommand);

      // Check the command input
      const input = (sentCommand as SendMessageCommand).input;
      expect(input.MessageAttributes).toEqual({
        leaseId: {
          DataType: 'String',
          StringValue: 'test-lease-123',
        },
        userEmail: {
          DataType: 'String',
          StringValue: 'test@example.gov.uk',
        },
        processAfter: {
          DataType: 'String',
          StringValue: '2025-01-16T07:00:00.000Z',
        },
      });
    });

    it('should include original event in message body', async () => {
      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' });

      const message = createTestMessage();
      await service.sendDelayedRequest(message);

      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0] as SendMessageCommand;
      const messageBody = sentCommand.input.MessageBody;

      expect(messageBody).toBeDefined();
      const parsed = JSON.parse(messageBody!);
      expect(parsed.originalEvent).toEqual({ detail: { templateId: 'web-hosting' } });
      expect(parsed.receivedAt).toBe('2025-01-15T20:00:00.000Z');
      expect(parsed.processAfter).toBe('2025-01-16T07:00:00.000Z');
    });

    it('should handle SQS send failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('SQS service unavailable'));

      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' }, mockLogger);

      const message = createTestMessage();
      const result = await service.sendDelayedRequest(message);

      expect(result.success).toBe(false);
      expect(result.messageId).toBeUndefined();
      expect(result.error).toBe('SQS service unavailable');
    });

    it('should log success', async () => {
      mockSend.mockResolvedValueOnce({ MessageId: 'msg-456' });

      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' }, mockLogger);

      const message = createTestMessage();
      await service.sendDelayedRequest(message);

      expect(mockLogger.info).toHaveBeenCalledWith('Delayed request sent to queue', {
        messageId: 'msg-456',
        leaseId: 'test-lease-123',
        userEmail: 'test@example.gov.uk',
        processAfter: '2025-01-16T07:00:00.000Z',
      });
    });

    it('should log failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Queue not found'));

      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' }, mockLogger);

      const message = createTestMessage();
      await service.sendDelayedRequest(message);

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send delayed request to queue', {
        error: 'Queue not found',
        leaseId: 'test-lease-123',
        userEmail: 'test@example.gov.uk',
      });
    });

    it('should work without logger', async () => {
      mockSend.mockResolvedValueOnce({ MessageId: 'msg-789' });

      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' });

      const message = createTestMessage();
      const result = await service.sendDelayedRequest(message);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-789');
    });

    it('should use correct queue URL', async () => {
      const queueUrl = 'https://sqs.eu-west-2.amazonaws.com/999/MyQueue';
      const service = createSQSService(mockClient, { queueUrl });

      const message = createTestMessage();
      await service.sendDelayedRequest(message);

      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0] as SendMessageCommand;
      expect(sentCommand.input.QueueUrl).toBe(queueUrl);
    });
  });
});
