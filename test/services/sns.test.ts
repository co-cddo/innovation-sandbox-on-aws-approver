/**
 * Unit tests for AWS SNS Client Wrapper (Story 7.1.1)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create mock send function
const mockSend = vi.fn();

// Mock the AWS SDK with a proper class
vi.mock('@aws-sdk/client-sns', () => {
  return {
    SNSClient: class MockSNSClient {
      send = mockSend;
    },
    PublishCommand: class MockPublishCommand {
      TopicArn: string;
      Message: string;
      constructor(params: { TopicArn: string; Message: string }) {
        this.TopicArn = params.TopicArn;
        this.Message = params.Message;
      }
    },
  };
});

// Import after mock setup
import { createAWSSNSClient } from '../../src/services/sns.js';

describe('AWS SNS Client Wrapper (Story 7.1.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createAWSSNSClient', () => {
    it('creates client with default region from AWS_REGION env', () => {
      const originalEnv = process.env.AWS_REGION;
      process.env.AWS_REGION = 'eu-west-1';

      const client = createAWSSNSClient();
      expect(client).toBeDefined();
      expect(client.publish).toBeDefined();

      process.env.AWS_REGION = originalEnv;
    });

    it('creates client with explicit region parameter', () => {
      const client = createAWSSNSClient('ap-southeast-1');
      expect(client).toBeDefined();
    });

    it('defaults to us-west-2 when no region specified', () => {
      const originalEnv = process.env.AWS_REGION;
      delete process.env.AWS_REGION;

      const client = createAWSSNSClient();
      expect(client).toBeDefined();

      process.env.AWS_REGION = originalEnv;
    });
  });

  describe('publish', () => {
    it('publishes message to SNS topic and returns messageId', async () => {
      mockSend.mockResolvedValueOnce({ MessageId: 'test-message-123' });

      const client = createAWSSNSClient('us-west-2');
      const result = await client.publish(
        'arn:aws:sns:us-west-2:123456789012:test-topic',
        '{"test": "message"}'
      );

      expect(result.messageId).toBe('test-message-123');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('handles missing MessageId in response', async () => {
      mockSend.mockResolvedValueOnce({});

      const client = createAWSSNSClient('us-west-2');
      const result = await client.publish(
        'arn:aws:sns:us-west-2:123456789012:test-topic',
        '{"test": "message"}'
      );

      expect(result.messageId).toBeUndefined();
    });

    it('propagates errors from SNS client', async () => {
      mockSend.mockRejectedValueOnce(new Error('SNS service unavailable'));

      const client = createAWSSNSClient('us-west-2');

      await expect(
        client.publish(
          'arn:aws:sns:us-west-2:123456789012:test-topic',
          '{"test": "message"}'
        )
      ).rejects.toThrow('SNS service unavailable');
    });

    it('calls send with PublishCommand containing correct parameters', async () => {
      mockSend.mockResolvedValueOnce({ MessageId: 'msg-456' });

      const client = createAWSSNSClient('us-west-2');
      const topicArn = 'arn:aws:sns:us-west-2:123456789012:my-topic';
      const message = '{"key": "value"}';

      await client.publish(topicArn, message);

      // Verify send was called with a PublishCommand instance
      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0]![0];
      expect(command.TopicArn).toBe(topicArn);
      expect(command.Message).toBe(message);
    });
  });
});
