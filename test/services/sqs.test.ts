/**
 * SQS Service Tests
 *
 * Tests for sending delayed requests to the SQS delay queue.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
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

  describe('receiveMessages', () => {
    it('should receive messages from queue successfully', async () => {
      const testMessage = createTestMessage();
      mockSend.mockResolvedValueOnce({
        Messages: [
          {
            MessageId: 'msg-receive-1',
            ReceiptHandle: 'receipt-handle-123',
            Body: JSON.stringify(testMessage),
            Attributes: {
              SentTimestamp: '1705363200000', // 2024-01-16T00:00:00.000Z
            },
          },
        ],
      });

      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' }, mockLogger);
      const result = await service.receiveMessages(1, 300);

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]?.messageId).toBe('msg-receive-1');
      expect(result.messages[0]?.receiptHandle).toBe('receipt-handle-123');
      expect(result.messages[0]?.body.leaseId.uuid).toBe('test-lease-123');
    });

    it('should return empty array when no messages', async () => {
      mockSend.mockResolvedValueOnce({
        Messages: [],
      });

      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' }, mockLogger);
      const result = await service.receiveMessages();

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(0);
    });

    it('should sort messages by SentTimestamp (oldest first)', async () => {
      mockSend.mockResolvedValueOnce({
        Messages: [
          {
            MessageId: 'msg-newer',
            ReceiptHandle: 'receipt-2',
            Body: JSON.stringify(createTestMessage()),
            Attributes: { SentTimestamp: '1705449600000' }, // 2024-01-17T00:00:00.000Z
          },
          {
            MessageId: 'msg-older',
            ReceiptHandle: 'receipt-1',
            Body: JSON.stringify(createTestMessage()),
            Attributes: { SentTimestamp: '1705363200000' }, // 2024-01-16T00:00:00.000Z
          },
        ],
      });

      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' });
      const result = await service.receiveMessages(10);

      expect(result.messages[0]?.messageId).toBe('msg-older');
      expect(result.messages[1]?.messageId).toBe('msg-newer');
    });

    it('should handle receive failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Network error'));

      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' }, mockLogger);
      const result = await service.receiveMessages();

      expect(result.success).toBe(false);
      expect(result.messages).toHaveLength(0);
      expect(result.error).toBe('Network error');
    });

    it('should use correct visibility timeout', async () => {
      mockSend.mockResolvedValueOnce({ Messages: [] });

      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' });
      await service.receiveMessages(1, 600);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0] as ReceiveMessageCommand;
      expect(sentCommand.input.VisibilityTimeout).toBe(600);
    });

    it('should handle malformed message body', async () => {
      mockSend.mockResolvedValueOnce({
        Messages: [
          {
            MessageId: 'msg-malformed',
            ReceiptHandle: 'receipt-malformed',
            Body: 'not valid json',
          },
        ],
      });

      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' });
      const result = await service.receiveMessages();

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]?.body.reason).toBe('Unparseable message');
    });

    it('should handle undefined Body in message (line 223)', async () => {
      mockSend.mockResolvedValueOnce({
        Messages: [
          {
            MessageId: 'msg-no-body',
            ReceiptHandle: 'receipt-no-body',
            // Body is undefined
          },
        ],
      });

      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' });
      const result = await service.receiveMessages();

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(1);
      // Should parse '{}' as fallback, resulting in an empty object, which gets
      // treated as unparseable since it lacks required fields
      expect(result.messages[0]?.body).toBeDefined();
    });

    it('should sort messages by sentTimestamp with undefined handling (line 241)', async () => {
      mockSend.mockResolvedValueOnce({
        Messages: [
          {
            MessageId: 'msg-2',
            ReceiptHandle: 'receipt-2',
            Body: JSON.stringify(createTestMessage()),
            Attributes: { SentTimestamp: '1735560000000' }, // Later
          },
          {
            MessageId: 'msg-1',
            ReceiptHandle: 'receipt-1',
            Body: JSON.stringify(createTestMessage()),
            // No Attributes - sentTimestamp will be undefined
          },
          {
            MessageId: 'msg-3',
            ReceiptHandle: 'receipt-3',
            Body: JSON.stringify(createTestMessage()),
            Attributes: { SentTimestamp: '1735550000000' }, // Earlier
          },
        ],
      });

      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' });
      const result = await service.receiveMessages(10);

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(3);
      // Undefined timestamp (0) should come first, then sorted by timestamp
      expect(result.messages[0]?.messageId).toBe('msg-1'); // undefined -> 0
      expect(result.messages[1]?.messageId).toBe('msg-3'); // 1735550000000
      expect(result.messages[2]?.messageId).toBe('msg-2'); // 1735560000000
    });
  });

  describe('deleteMessage', () => {
    it('should delete message successfully', async () => {
      mockSend.mockResolvedValueOnce({});

      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' }, mockLogger);
      const result = await service.deleteMessage('receipt-handle-123');

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should handle delete failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Invalid receipt handle'));

      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' }, mockLogger);
      const result = await service.deleteMessage('invalid-handle');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid receipt handle');
    });

    it('should use correct receipt handle', async () => {
      mockSend.mockResolvedValueOnce({});

      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' });
      await service.deleteMessage('my-receipt-handle');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0] as DeleteMessageCommand;
      expect(sentCommand.input.ReceiptHandle).toBe('my-receipt-handle');
    });
  });

  describe('getQueueDepth', () => {
    it('should return queue depth successfully', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: {
          ApproximateNumberOfMessages: '5',
        },
      });

      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' }, mockLogger);
      const result = await service.getQueueDepth();

      expect(result.success).toBe(true);
      expect(result.approximateNumberOfMessages).toBe(5);
    });

    it('should return 0 when attribute not present', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: {},
      });

      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' });
      const result = await service.getQueueDepth();

      expect(result.success).toBe(true);
      expect(result.approximateNumberOfMessages).toBe(0);
    });

    it('should handle get depth failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Queue not found'));

      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' }, mockLogger);
      const result = await service.getQueueDepth();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Queue not found');
    });

    it('should request correct attribute', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: {} });

      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' });
      await service.getQueueDepth();

      expect(mockSend).toHaveBeenCalledTimes(1);
      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0] as GetQueueAttributesCommand;
      expect(sentCommand.input.AttributeNames).toEqual(['ApproximateNumberOfMessages']);
    });

    it('should handle non-Error exception', async () => {
      mockSend.mockRejectedValueOnce('String error');

      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' }, mockLogger);
      const result = await service.getQueueDepth();

      expect(result.success).toBe(false);
      expect(result.error).toBe('String error');
    });
  });

  describe('Non-Error exception handling', () => {
    it('should handle non-Error in sendDelayedRequest', async () => {
      mockSend.mockRejectedValueOnce('String SQS error');

      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' }, mockLogger);
      const message = createTestMessage();
      const result = await service.sendDelayedRequest(message);

      expect(result.success).toBe(false);
      expect(result.error).toBe('String SQS error');
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send delayed request to queue', {
        error: 'String SQS error',
        leaseId: 'test-lease-123',
        userEmail: 'test@example.gov.uk',
      });
    });

    it('should handle non-Error in receiveMessages', async () => {
      mockSend.mockRejectedValueOnce({ code: 'AWS_ERROR' });

      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' }, mockLogger);
      const result = await service.receiveMessages();

      expect(result.success).toBe(false);
      expect(result.error).toBe('[object Object]');
    });

    it('should handle non-Error in deleteMessage', async () => {
      mockSend.mockRejectedValueOnce(42);

      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' }, mockLogger);
      const result = await service.deleteMessage('receipt-handle');

      expect(result.success).toBe(false);
      expect(result.error).toBe('42');
    });

    it('should handle message with missing MessageId', async () => {
      const testMessage = createTestMessage();
      mockSend.mockResolvedValueOnce({
        Messages: [
          {
            // MessageId is undefined
            ReceiptHandle: 'receipt-1',
            Body: JSON.stringify(testMessage),
          },
        ],
      });

      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' });
      const result = await service.receiveMessages();

      expect(result.success).toBe(true);
      expect(result.messages[0]?.messageId).toBe('unknown');
    });

    it('should handle message with missing ReceiptHandle', async () => {
      const testMessage = createTestMessage();
      mockSend.mockResolvedValueOnce({
        Messages: [
          {
            MessageId: 'msg-1',
            // ReceiptHandle is undefined
            Body: JSON.stringify(testMessage),
          },
        ],
      });

      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' });
      const result = await service.receiveMessages();

      expect(result.success).toBe(true);
      expect(result.messages[0]?.receiptHandle).toBe('');
    });

    it('should handle undefined Messages array', async () => {
      mockSend.mockResolvedValueOnce({
        // Messages is undefined
      });

      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' }, mockLogger);
      const result = await service.receiveMessages();

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(0);
      expect(mockLogger.info).toHaveBeenCalledWith('No messages in delay queue');
    });

    it('should clamp maxMessages to 10', async () => {
      mockSend.mockResolvedValueOnce({ Messages: [] });

      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' });
      await service.receiveMessages(100); // Request 100 but should be clamped to 10

      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0] as ReceiveMessageCommand;
      expect(sentCommand.input.MaxNumberOfMessages).toBe(10);
    });

    it('should clamp maxMessages to minimum 1', async () => {
      mockSend.mockResolvedValueOnce({ Messages: [] });

      const service = createSQSService(mockClient, { queueUrl: 'https://sqs.example.com/queue' });
      await service.receiveMessages(0); // Request 0 but should be clamped to 1

      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0] as ReceiveMessageCommand;
      expect(sentCommand.input.MaxNumberOfMessages).toBe(1);
    });
  });
});
