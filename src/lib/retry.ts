/**
 * Retry utility with exponential backoff for transient failures.
 * Implements FR45: Retry with exponential backoff (100ms, 200ms, 400ms, max 3 retries).
 */

import type { StateMachineLogger } from '../state-machine/orchestrator.js';

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Base delay in milliseconds for first retry */
  baseDelayMs: number;
  /** Maximum delay in milliseconds */
  maxDelayMs: number;
}

/**
 * Default retry configuration per FR45
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 400,
};

/**
 * Error names that are considered retryable.
 * These indicate transient failures that may succeed on retry.
 */
const RETRYABLE_ERROR_NAMES = new Set([
  'ProvisionedThroughputExceededException',
  'ThrottlingException',
  'ServiceUnavailable',
  'ServiceUnavailableException',
  'InternalServerError',
  'InternalServerException',
  'RequestLimitExceeded',
  'TooManyRequestsException',
]);

/**
 * Error codes that are considered retryable.
 */
const RETRYABLE_ERROR_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EPIPE',
  'NetworkingError',
  'TimeoutError',
]);

/**
 * Determines if an error is retryable.
 *
 * @param error - The error to check
 * @returns true if the error is transient and may succeed on retry
 */
export const isRetryableError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  // Check error name
  if (RETRYABLE_ERROR_NAMES.has(error.name)) {
    return true;
  }

  // Check for error code property (AWS SDK errors)
  const errorWithCode = error as Error & { code?: string };
  if (errorWithCode.code && RETRYABLE_ERROR_CODES.has(errorWithCode.code)) {
    return true;
  }

  // Check error message for common transient patterns
  const message = error.message.toLowerCase();
  if (
    message.includes('throttl') ||
    message.includes('rate exceeded') ||
    message.includes('too many requests') ||
    message.includes('service unavailable') ||
    message.includes('temporarily unavailable') ||
    message.includes('connection reset') ||
    message.includes('timeout')
  ) {
    return true;
  }

  return false;
};

/**
 * Sleep for a specified number of milliseconds.
 *
 * @param ms - Number of milliseconds to sleep
 * @returns Promise that resolves after the delay
 */
export const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * Calculates the delay for a given retry attempt using exponential backoff.
 *
 * @param attempt - The current retry attempt (0-indexed)
 * @param config - Retry configuration
 * @returns Delay in milliseconds
 */
export const calculateBackoffDelay = (attempt: number, config: RetryConfig): number => {
  const delay = config.baseDelayMs * Math.pow(2, attempt);
  return Math.min(delay, config.maxDelayMs);
};

/**
 * Executes a function with retry logic and exponential backoff.
 *
 * @param fn - The async function to execute
 * @param config - Retry configuration
 * @param logger - Logger for retry attempts
 * @returns The result of the function
 * @throws The last error if all retries fail
 */
export const withRetry = async <T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  logger?: StateMachineLogger
): Promise<T> => {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // If this is the last attempt or not retryable, throw immediately
      if (attempt === config.maxRetries || !isRetryableError(error)) {
        throw lastError;
      }

      const delay = calculateBackoffDelay(attempt, config);

      if (logger) {
        logger.warn('Retrying after transient error', {
          attempt: attempt + 1,
          maxRetries: config.maxRetries,
          delayMs: delay,
          errorName: lastError.name,
          errorMessage: lastError.message,
        });
      }

      await sleep(delay);
    }
    /* c8 ignore next */
  }
  // This should never be reached, but TypeScript needs it for exhaustive checking
  /* c8 ignore next */
  throw lastError ?? new Error('Retry failed with no error captured');
};
