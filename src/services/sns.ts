/**
 * AWS SNS Client Wrapper (Story 7.1.1)
 *
 * Provides a thin wrapper around the AWS SDK SNS client for publishing messages.
 * Abstracted interface allows for easy testing and mocking.
 */

import { SNSClient as AWSSNSClient, PublishCommand } from '@aws-sdk/client-sns';
import type { SNSClient } from './sns-notification.js';

/**
 * Creates an SNS client wrapper using the AWS SDK.
 *
 * @param region - AWS region (defaults to AWS_REGION env var)
 * @returns SNSClient implementation
 */
export const createAWSSNSClient = (region?: string): SNSClient => {
  const client = new AWSSNSClient({
    region: region ?? process.env.AWS_REGION ?? 'us-west-2',
  });

  return {
    async publish(topicArn: string, message: string): Promise<{ messageId?: string }> {
      const command = new PublishCommand({
        TopicArn: topicArn,
        Message: message,
      });

      const response = await client.send(command);

      return {
        messageId: response.MessageId,
      };
    },
  };
};
