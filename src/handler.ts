import { logger } from './lib/logger.js';
import type { EventBridgeEvent, Context } from 'aws-lambda';

export interface ApproverResponse {
  statusCode: number;
  body: string;
}

export const handler = async (
  event: EventBridgeEvent<string, unknown>,
  context: Context
): Promise<ApproverResponse> => {
  logger.addContext(context);
  logger.info('Event received', { event });

  return {
    statusCode: 200,
    body: 'OK',
  };
};
