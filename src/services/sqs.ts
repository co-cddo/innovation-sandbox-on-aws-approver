/**
 * SQS Service for delay queue operations.
 *
 * Handles sending delayed requests to the SQS delay queue when requests
 * arrive outside business hours.
 */

import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';

/**
 * Message structure for delayed lease requests.
 */
export interface DelayedLeaseMessage {
  /** Lease identifier */
  leaseId: {
    userEmail: string;
    uuid: string;
  };
  /** Original event data to replay */
  originalEvent: unknown;
  /** When the request was received (ISO string) */
  receivedAt: string;
  /** When the request should be processed (ISO string) */
  processAfter: string;
  /** Reason for the delay */
  reason: string;
}

/**
 * Result from sending a message to the delay queue.
 */
export interface SendDelayedResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Received message from the delay queue.
 */
export interface ReceivedMessage {
  /** Message ID */
  messageId: string;
  /** Receipt handle for deletion */
  receiptHandle: string;
  /** Parsed message body */
  body: DelayedLeaseMessage;
  /** Approximate time message was sent (for FIFO ordering) */
  sentTimestamp?: number;
}

/**
 * Result from receiving messages from the delay queue.
 */
export interface ReceiveMessagesResult {
  success: boolean;
  messages: ReceivedMessage[];
  error?: string;
}

/**
 * Result from deleting a message from the delay queue.
 */
export interface DeleteMessageResult {
  success: boolean;
  error?: string;
}

/**
 * Queue depth information.
 */
export interface QueueDepthResult {
  success: boolean;
  approximateNumberOfMessages?: number;
  error?: string;
}

/**
 * SQS service configuration.
 */
export interface SQSServiceConfig {
  queueUrl: string;
}

/**
 * SQS service interface for delay queue operations.
 */
export interface SQSService {
  /**
   * Sends a delayed lease request to the delay queue.
   */
  sendDelayedRequest(message: DelayedLeaseMessage): Promise<SendDelayedResult>;

  /**
   * Receives messages from the delay queue.
   * Returns oldest messages first (FIFO by SentTimestamp).
   * @param maxMessages - Maximum number of messages to receive (1-10, default 1)
   * @param visibilityTimeout - Visibility timeout in seconds (default 300 = 5 min)
   */
  receiveMessages(maxMessages?: number, visibilityTimeout?: number): Promise<ReceiveMessagesResult>;

  /**
   * Deletes a message from the delay queue after successful processing.
   */
  deleteMessage(receiptHandle: string): Promise<DeleteMessageResult>;

  /**
   * Gets the approximate number of messages in the queue.
   */
  getQueueDepth(): Promise<QueueDepthResult>;
}

/**
 * Logger interface for SQS service.
 */
export interface SQSLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Creates an SQS service for delay queue operations.
 */
export const createSQSService = (
  client: SQSClient,
  config: SQSServiceConfig,
  logger?: SQSLogger
): SQSService => {
  const noOpLogger: SQSLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
  const log = logger ?? noOpLogger;

  return {
    async sendDelayedRequest(message: DelayedLeaseMessage): Promise<SendDelayedResult> {
      try {
        const command = new SendMessageCommand({
          QueueUrl: config.queueUrl,
          MessageBody: JSON.stringify(message),
          MessageAttributes: {
            leaseId: {
              DataType: 'String',
              StringValue: message.leaseId.uuid,
            },
            userEmail: {
              DataType: 'String',
              StringValue: message.leaseId.userEmail,
            },
            processAfter: {
              DataType: 'String',
              StringValue: message.processAfter,
            },
          },
        });

        const result = await client.send(command);

        log.info('Delayed request sent to queue', {
          messageId: result.MessageId,
          leaseId: message.leaseId.uuid,
          userEmail: message.leaseId.userEmail,
          processAfter: message.processAfter,
        });

        return {
          success: true,
          messageId: result.MessageId,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        log.error('Failed to send delayed request to queue', {
          error: errorMessage,
          leaseId: message.leaseId.uuid,
          userEmail: message.leaseId.userEmail,
        });

        return {
          success: false,
          error: errorMessage,
        };
      }
    },

    async receiveMessages(
      maxMessages: number = 1,
      visibilityTimeout: number = 300
    ): Promise<ReceiveMessagesResult> {
      try {
        const command = new ReceiveMessageCommand({
          QueueUrl: config.queueUrl,
          MaxNumberOfMessages: Math.min(Math.max(1, maxMessages), 10),
          VisibilityTimeout: visibilityTimeout,
          AttributeNames: ['All'], // Includes SentTimestamp
          MessageAttributeNames: ['All'],
          WaitTimeSeconds: 0, // Short poll - we don't want to wait
        });

        const result = await client.send(command);

        if (!result.Messages || result.Messages.length === 0) {
          log.info('No messages in delay queue');
          return { success: true, messages: [] };
        }

        // Parse messages and sort by SentTimestamp (oldest first for FIFO)
        const messages: ReceivedMessage[] = result.Messages.map((msg) => {
          const sentTimestamp = msg.Attributes?.SentTimestamp
            ? parseInt(msg.Attributes.SentTimestamp, 10)
            : undefined;

          let body: DelayedLeaseMessage;
          try {
            body = JSON.parse(msg.Body ?? '{}') as DelayedLeaseMessage;
          } catch {
            // If parsing fails, create a minimal structure
            body = {
              leaseId: { userEmail: 'unknown', uuid: 'unknown' },
              originalEvent: {},
              receivedAt: new Date().toISOString(),
              processAfter: new Date().toISOString(),
              reason: 'Unparseable message',
            };
          }

          return {
            messageId: msg.MessageId ?? 'unknown',
            receiptHandle: msg.ReceiptHandle ?? '',
            body,
            sentTimestamp,
          };
        }).sort((a, b) => (a.sentTimestamp ?? 0) - (b.sentTimestamp ?? 0));

        log.info('Received messages from delay queue', {
          messageCount: messages.length,
          oldestMessageId: messages[0]?.messageId,
        });

        return { success: true, messages };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        log.error('Failed to receive messages from queue', {
          error: errorMessage,
        });

        return { success: false, messages: [], error: errorMessage };
      }
    },

    async deleteMessage(receiptHandle: string): Promise<DeleteMessageResult> {
      try {
        const command = new DeleteMessageCommand({
          QueueUrl: config.queueUrl,
          ReceiptHandle: receiptHandle,
        });

        await client.send(command);

        log.info('Message deleted from delay queue', {
          receiptHandle: receiptHandle.substring(0, 50) + '...',
        });

        return { success: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        log.error('Failed to delete message from queue', {
          error: errorMessage,
        });

        return { success: false, error: errorMessage };
      }
    },

    async getQueueDepth(): Promise<QueueDepthResult> {
      try {
        const command = new GetQueueAttributesCommand({
          QueueUrl: config.queueUrl,
          AttributeNames: ['ApproximateNumberOfMessages'],
        });

        const result = await client.send(command);
        const count = result.Attributes?.ApproximateNumberOfMessages
          ? parseInt(result.Attributes.ApproximateNumberOfMessages, 10)
          : 0;

        log.info('Queue depth retrieved', {
          approximateNumberOfMessages: count,
        });

        return { success: true, approximateNumberOfMessages: count };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        log.error('Failed to get queue depth', {
          error: errorMessage,
        });

        return { success: false, error: errorMessage };
      }
    },
  };
};
