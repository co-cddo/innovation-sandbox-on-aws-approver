/**
 * Tests for retry utility with exponential backoff.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_RETRY_CONFIG,
  isRetryableError,
  sleep,
  calculateBackoffDelay,
  withRetry,
  type RetryConfig,
} from '../../src/lib/retry.js';
import type { StateMachineLogger } from '../../src/state-machine/orchestrator.js';

// Note: Fake timers are applied per-test where needed

const createMockLogger = (): StateMachineLogger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe('retry', () => {
  describe('DEFAULT_RETRY_CONFIG', () => {
    it('should have maxRetries of 3', () => {
      expect(DEFAULT_RETRY_CONFIG.maxRetries).toBe(3);
    });

    it('should have baseDelayMs of 100', () => {
      expect(DEFAULT_RETRY_CONFIG.baseDelayMs).toBe(100);
    });

    it('should have maxDelayMs of 400', () => {
      expect(DEFAULT_RETRY_CONFIG.maxDelayMs).toBe(400);
    });
  });

  describe('isRetryableError', () => {
    it('should return false for non-Error values', () => {
      expect(isRetryableError('string error')).toBe(false);
      expect(isRetryableError(null)).toBe(false);
      expect(isRetryableError(undefined)).toBe(false);
      expect(isRetryableError(123)).toBe(false);
    });

    it('should return true for ProvisionedThroughputExceededException', () => {
      const error = new Error('Rate exceeded');
      error.name = 'ProvisionedThroughputExceededException';
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for ThrottlingException', () => {
      const error = new Error('Throttled');
      error.name = 'ThrottlingException';
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for ServiceUnavailable', () => {
      const error = new Error('Service down');
      error.name = 'ServiceUnavailable';
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for InternalServerError', () => {
      const error = new Error('Internal error');
      error.name = 'InternalServerError';
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for errors with ECONNRESET code', () => {
      const error = new Error('Connection reset') as Error & { code?: string };
      error.code = 'ECONNRESET';
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for errors with ETIMEDOUT code', () => {
      const error = new Error('Timed out') as Error & { code?: string };
      error.code = 'ETIMEDOUT';
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for errors with ECONNREFUSED code', () => {
      const error = new Error('Connection refused') as Error & { code?: string };
      error.code = 'ECONNREFUSED';
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for errors containing "throttl" in message', () => {
      const error = new Error('Request was throttled');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for errors containing "rate exceeded" in message', () => {
      const error = new Error('Rate exceeded limit');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for errors containing "too many requests" in message', () => {
      const error = new Error('Too many requests');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for errors containing "service unavailable" in message', () => {
      const error = new Error('Service unavailable');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for errors containing "timeout" in message', () => {
      const error = new Error('Request timeout');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return false for non-retryable errors', () => {
      const error = new Error('Validation failed');
      expect(isRetryableError(error)).toBe(false);
    });

    it('should return false for generic Error without retryable indicators', () => {
      const error = new Error('Something went wrong');
      expect(isRetryableError(error)).toBe(false);
    });
  });

  describe('sleep', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should resolve after specified milliseconds', async () => {
      const promise = sleep(100);
      vi.advanceTimersByTime(100);
      await expect(promise).resolves.toBeUndefined();
    });
  });

  describe('calculateBackoffDelay', () => {
    const config: RetryConfig = {
      maxRetries: 3,
      baseDelayMs: 100,
      maxDelayMs: 400,
    };

    it('should return baseDelayMs for attempt 0', () => {
      expect(calculateBackoffDelay(0, config)).toBe(100);
    });

    it('should return 200 for attempt 1 (100 * 2^1)', () => {
      expect(calculateBackoffDelay(1, config)).toBe(200);
    });

    it('should return 400 for attempt 2 (100 * 2^2)', () => {
      expect(calculateBackoffDelay(2, config)).toBe(400);
    });

    it('should cap at maxDelayMs for attempt 3', () => {
      expect(calculateBackoffDelay(3, config)).toBe(400);
    });

    it('should cap at maxDelayMs for high attempts', () => {
      expect(calculateBackoffDelay(10, config)).toBe(400);
    });
  });

  describe('withRetry', () => {
    it('should return result on first successful call', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await withRetry(fn, DEFAULT_RETRY_CONFIG);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should throw immediately on non-retryable error', async () => {
      const error = new Error('Validation failed');
      const fn = vi.fn().mockRejectedValue(error);

      await expect(withRetry(fn, DEFAULT_RETRY_CONFIG)).rejects.toThrow(
        'Validation failed'
      );
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should convert non-Error exceptions to Error', async () => {
      const fn = vi.fn().mockRejectedValue('string error');

      await expect(withRetry(fn, DEFAULT_RETRY_CONFIG)).rejects.toThrow(
        'string error'
      );
    });

    it('should use default config when not provided', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await withRetry(fn);

      expect(result).toBe('success');
    });

    // Tests requiring retry behavior use real timers with minimal delays
    describe('retry behavior', () => {
      const fastConfig: RetryConfig = {
        maxRetries: 2,
        baseDelayMs: 1,
        maxDelayMs: 2,
      };

      it('should retry on retryable error and succeed', async () => {
        const error = new Error('Service unavailable');
        const fn = vi
          .fn()
          .mockRejectedValueOnce(error)
          .mockResolvedValueOnce('success');

        const result = await withRetry(fn, fastConfig);

        expect(result).toBe('success');
        expect(fn).toHaveBeenCalledTimes(2);
      });

      it('should throw after max retries exhausted', async () => {
        const error = new Error('Service unavailable');
        const fn = vi.fn().mockRejectedValue(error);

        await expect(withRetry(fn, fastConfig)).rejects.toThrow(
          'Service unavailable'
        );
        // Initial call + 2 retries = 3 total calls
        expect(fn).toHaveBeenCalledTimes(3);
      });

      it('should log warning on each retry when logger provided', async () => {
        const mockLogger = createMockLogger();
        const error = new Error('Service unavailable');
        const fn = vi
          .fn()
          .mockRejectedValueOnce(error)
          .mockResolvedValueOnce('success');

        await withRetry(fn, fastConfig, mockLogger);

        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Retrying after transient error',
          expect.objectContaining({
            attempt: 1,
            maxRetries: 2,
            delayMs: 1,
            errorMessage: 'Service unavailable',
          })
        );
      });
    });
  });
});
