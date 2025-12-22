import { Logger } from '@aws-lambda-powertools/logger';
import type { LogLevel } from '@aws-lambda-powertools/logger/types';

/**
 * Centralized logger instance for the Approver Lambda
 * Uses AWS Lambda Powertools for structured JSON logging
 */
export const logger = new Logger({
  serviceName: 'approver',
  logLevel: (process.env.LOG_LEVEL as LogLevel) ?? 'INFO',
});

export { Logger };
