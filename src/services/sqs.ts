/**
 * SQS Service for delay queue operations.
 *
 * Handles sending delayed requests to the SQS delay queue when requests
 * arrive outside business hours.
 */

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

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
  };
};
