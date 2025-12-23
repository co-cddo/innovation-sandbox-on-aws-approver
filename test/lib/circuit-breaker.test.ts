/**
 * Circuit Breaker Unit Tests
 *
 * Tests for circuit breaker pattern implementation.
 * Story 3.4: AC5, AC6 - Circuit breaker implementation and recovery
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CircuitBreaker,
  CircuitState,
  CircuitOpenError,
  createCircuitBreaker,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
} from '../../src/lib/circuit-breaker.js';

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker;
  let mockLogger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
    };
    circuitBreaker = new CircuitBreaker(
      {
        name: 'test-circuit',
        failureThreshold: 3,
        recoveryTimeoutMs: 60000,
      },
      mockLogger
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('should start in CLOSED state', () => {
      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should have zero failure count initially', () => {
      expect(circuitBreaker.getFailureCount()).toBe(0);
    });

    it('should have zero time until recovery when closed', () => {
      expect(circuitBreaker.getTimeUntilRecoveryMs()).toBe(0);
    });
  });

  describe('execute - success cases', () => {
    it('should execute function and return result when CLOSED', async () => {
      const result = await circuitBreaker.execute(async () => 'success');
      expect(result).toBe('success');
    });

    it('should reset failure count on success', async () => {
      // Cause some failures (but not enough to open)
      const failingFn = vi.fn().mockRejectedValue(new Error('fail'));

      try {
        await circuitBreaker.execute(failingFn);
      } catch {
        // Expected
      }
      try {
        await circuitBreaker.execute(failingFn);
      } catch {
        // Expected
      }

      expect(circuitBreaker.getFailureCount()).toBe(2);

      // Successful call resets count
      await circuitBreaker.execute(async () => 'success');
      expect(circuitBreaker.getFailureCount()).toBe(0);
    });
  });

  describe('state transitions - CLOSED to OPEN (AC5)', () => {
    it('should transition to OPEN after reaching failure threshold', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('service unavailable'));

      // 3 failures should open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(failingFn);
        } catch {
          // Expected
        }
      }

      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Circuit breaker state transition',
        expect.objectContaining({
          previousState: CircuitState.CLOSED,
          newState: CircuitState.OPEN,
          circuitName: 'test-circuit',
        })
      );
    });

    it('should not open circuit before reaching threshold', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('fail'));

      // 2 failures (threshold is 3)
      for (let i = 0; i < 2; i++) {
        try {
          await circuitBreaker.execute(failingFn);
        } catch {
          // Expected
        }
      }

      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
      expect(circuitBreaker.getFailureCount()).toBe(2);
    });

    it('should throw CircuitOpenError when circuit is OPEN', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('fail'));

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(failingFn);
        } catch {
          // Expected
        }
      }

      // Next call should throw CircuitOpenError
      await expect(circuitBreaker.execute(async () => 'should not run')).rejects.toThrow(
        CircuitOpenError
      );

      const error = await circuitBreaker
        .execute(async () => 'test')
        .catch((e) => e as CircuitOpenError);
      expect(error).toBeInstanceOf(CircuitOpenError);
      expect(error.circuitName).toBe('test-circuit');
      expect(error.timeUntilRecoveryMs).toBeGreaterThan(0);
    });
  });

  describe('state transitions - OPEN to HALF_OPEN (AC6)', () => {
    it('should transition to HALF_OPEN after recovery timeout', async () => {
      vi.useFakeTimers();

      const failingFn = vi.fn().mockRejectedValue(new Error('fail'));

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(failingFn);
        } catch {
          // Expected
        }
      }

      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);

      // Advance time past recovery timeout
      vi.advanceTimersByTime(60001);

      // Next call should transition to HALF_OPEN and attempt execution
      const successFn = vi.fn().mockResolvedValue('recovered');
      const result = await circuitBreaker.execute(successFn);

      expect(result).toBe('recovered');
      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should not transition before recovery timeout', async () => {
      vi.useFakeTimers();

      const failingFn = vi.fn().mockRejectedValue(new Error('fail'));

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(failingFn);
        } catch {
          // Expected
        }
      }

      // Advance time but not past recovery timeout
      vi.advanceTimersByTime(30000); // 30 seconds

      // Should still throw CircuitOpenError
      await expect(circuitBreaker.execute(async () => 'test')).rejects.toThrow(CircuitOpenError);
      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
    });
  });

  describe('state transitions - HALF_OPEN to CLOSED (AC6)', () => {
    it('should transition to CLOSED on successful test request', async () => {
      vi.useFakeTimers();

      const failingFn = vi.fn().mockRejectedValue(new Error('fail'));

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(failingFn);
        } catch {
          // Expected
        }
      }

      // Advance past recovery timeout
      vi.advanceTimersByTime(60001);

      // Successful test request
      await circuitBreaker.execute(async () => 'success');

      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
      expect(circuitBreaker.getFailureCount()).toBe(0);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Circuit breaker state transition',
        expect.objectContaining({
          previousState: CircuitState.HALF_OPEN,
          newState: CircuitState.CLOSED,
        })
      );
    });
  });

  describe('state transitions - HALF_OPEN to OPEN (AC6)', () => {
    it('should transition back to OPEN on failed test request', async () => {
      vi.useFakeTimers();

      const failingFn = vi.fn().mockRejectedValue(new Error('fail'));

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(failingFn);
        } catch {
          // Expected
        }
      }

      // Advance past recovery timeout
      vi.advanceTimersByTime(60001);

      // Failed test request
      try {
        await circuitBreaker.execute(failingFn);
      } catch {
        // Expected
      }

      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Circuit breaker state transition',
        expect.objectContaining({
          previousState: CircuitState.HALF_OPEN,
          newState: CircuitState.OPEN,
        })
      );
    });

    it('should reset recovery timeout on HALF_OPEN failure', async () => {
      vi.useFakeTimers();

      const failingFn = vi.fn().mockRejectedValue(new Error('fail'));

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(failingFn);
        } catch {
          // Expected
        }
      }

      // Advance past recovery timeout
      vi.advanceTimersByTime(60001);

      // Failed test request - should reset timer
      try {
        await circuitBreaker.execute(failingFn);
      } catch {
        // Expected
      }

      // Advance 30 seconds - should still be open
      vi.advanceTimersByTime(30000);
      await expect(circuitBreaker.execute(async () => 'test')).rejects.toThrow(CircuitOpenError);

      // Advance another 31 seconds (total 61s from last failure) - should allow test
      vi.advanceTimersByTime(31000);
      await expect(
        circuitBreaker.execute(async () => 'recovered')
      ).resolves.toBe('recovered');
    });
  });

  describe('getTimeUntilRecoveryMs', () => {
    it('should return remaining time when OPEN', async () => {
      vi.useFakeTimers();

      const failingFn = vi.fn().mockRejectedValue(new Error('fail'));

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(failingFn);
        } catch {
          // Expected
        }
      }

      expect(circuitBreaker.getTimeUntilRecoveryMs()).toBe(60000);

      // Advance 30 seconds
      vi.advanceTimersByTime(30000);
      expect(circuitBreaker.getTimeUntilRecoveryMs()).toBe(30000);

      // Advance past recovery
      vi.advanceTimersByTime(31000);
      expect(circuitBreaker.getTimeUntilRecoveryMs()).toBe(0);
    });

    it('should return 0 when CLOSED', () => {
      expect(circuitBreaker.getTimeUntilRecoveryMs()).toBe(0);
    });
  });

  describe('reset', () => {
    it('should reset circuit to CLOSED state', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('fail'));

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(failingFn);
        } catch {
          // Expected
        }
      }

      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);

      circuitBreaker.reset();

      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
      expect(circuitBreaker.getFailureCount()).toBe(0);
      expect(mockLogger.info).toHaveBeenCalledWith('Circuit breaker reset', {
        circuitName: 'test-circuit',
      });
    });
  });

  describe('CircuitOpenError', () => {
    it('should have correct properties', () => {
      const error = new CircuitOpenError('test-circuit', 30000);

      expect(error.name).toBe('CircuitOpenError');
      expect(error.circuitName).toBe('test-circuit');
      expect(error.timeUntilRecoveryMs).toBe(30000);
      expect(error.message).toContain('test-circuit');
      expect(error.message).toContain('30000ms');
    });
  });

  describe('createCircuitBreaker', () => {
    it('should create circuit breaker with environment config', () => {
      const originalEnv = { ...process.env };
      process.env.CIRCUIT_BREAKER_THRESHOLD = '5';
      process.env.CIRCUIT_BREAKER_RECOVERY_MS = '120000';

      const cb = createCircuitBreaker('test');

      // Verify by causing failures
      expect(cb.getState()).toBe(CircuitState.CLOSED);

      process.env = originalEnv;
    });

    it('should use defaults when env vars not set', () => {
      const originalEnv = { ...process.env };
      delete process.env.CIRCUIT_BREAKER_THRESHOLD;
      delete process.env.CIRCUIT_BREAKER_RECOVERY_MS;

      const cb = createCircuitBreaker('test');
      expect(cb.getState()).toBe(CircuitState.CLOSED);

      process.env = originalEnv;
    });
  });

  describe('DEFAULT_CIRCUIT_BREAKER_CONFIG', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold).toBe(3);
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.recoveryTimeoutMs).toBe(60000);
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.name).toBe('default');
    });
  });
});
