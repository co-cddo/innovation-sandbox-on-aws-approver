/**
 * Circuit Breaker Utility
 *
 * Implements circuit breaker pattern for external service calls (Bedrock).
 * Story 3.4: Bedrock AI Email Analysis with Circuit Breaker
 *
 * Features:
 * - Three states: CLOSED, OPEN, HALF_OPEN (FR46)
 * - Configurable failure threshold (default: 3)
 * - Configurable recovery timeout (default: 60s)
 * - State transition logging
 */

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit */
  failureThreshold: number;
  /** Time in milliseconds before attempting recovery */
  recoveryTimeoutMs: number;
  /** Name for logging purposes */
  name: string;
}

/**
 * Default circuit breaker configuration per FR46
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  recoveryTimeoutMs: 60000, // 60 seconds
  name: 'default',
};

/**
 * Circuit breaker states
 */
export enum CircuitState {
  /** Normal operation - requests pass through */
  CLOSED = 'CLOSED',
  /** Circuit is open - requests are rejected */
  OPEN = 'OPEN',
  /** Testing recovery - one request allowed through */
  HALF_OPEN = 'HALF_OPEN',
}

/**
 * Error thrown when circuit is open
 */
export class CircuitOpenError extends Error {
  constructor(
    public readonly circuitName: string,
    public readonly timeUntilRecoveryMs: number
  ) {
    super(`Circuit breaker '${circuitName}' is open. Recovery in ${timeUntilRecoveryMs}ms`);
    this.name = 'CircuitOpenError';
  }
}

/**
 * Logger interface for circuit breaker state changes
 */
export interface CircuitBreakerLogger {
  info(message: string, attributes?: Record<string, unknown>): void;
  warn(message: string, attributes?: Record<string, unknown>): void;
}

/**
 * Circuit breaker for protecting external service calls.
 *
 * State transitions:
 * - CLOSED -> OPEN: After failureThreshold consecutive failures
 * - OPEN -> HALF_OPEN: After recoveryTimeoutMs has passed
 * - HALF_OPEN -> CLOSED: After a successful request
 * - HALF_OPEN -> OPEN: After a failed request (resets timer)
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private config: CircuitBreakerConfig;
  private logger?: CircuitBreakerLogger;

  constructor(config: Partial<CircuitBreakerConfig> = {}, logger?: CircuitBreakerLogger) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
    this.logger = logger;
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get current failure count
   */
  getFailureCount(): number {
    return this.failureCount;
  }

  /**
   * Get time until recovery is attempted (0 if not OPEN)
   */
  getTimeUntilRecoveryMs(): number {
    if (this.state !== CircuitState.OPEN) {
      return 0;
    }
    const elapsed = Date.now() - this.lastFailureTime;
    return Math.max(0, this.config.recoveryTimeoutMs - elapsed);
  }

  /**
   * Execute a function with circuit breaker protection.
   *
   * @param fn - Async function to execute
   * @returns Result of the function
   * @throws CircuitOpenError if circuit is open and recovery timeout hasn't passed
   * @throws Original error if the function fails
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if we should attempt recovery
    if (this.state === CircuitState.OPEN) {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure >= this.config.recoveryTimeoutMs) {
        // Transition to HALF_OPEN for test request
        this.transitionTo(CircuitState.HALF_OPEN);
      } else {
        // Still in recovery period - reject request
        const timeUntilRecovery = this.config.recoveryTimeoutMs - timeSinceFailure;
        throw new CircuitOpenError(this.config.name, timeUntilRecovery);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      // Recovery successful - close circuit
      this.transitionTo(CircuitState.CLOSED);
    }
    // Reset failure count on any success
    this.failureCount = 0;
  }

  /**
   * Handle failed execution
   */
  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      // Recovery failed - reopen circuit
      this.transitionTo(CircuitState.OPEN);
    } else if (this.failureCount >= this.config.failureThreshold) {
      // Threshold reached - open circuit
      this.transitionTo(CircuitState.OPEN);
    }
  }

  /**
   * Transition to a new state with logging
   */
  private transitionTo(newState: CircuitState): void {
    const previousState = this.state;
    this.state = newState;

    this.logger?.info('Circuit breaker state transition', {
      circuitName: this.config.name,
      previousState,
      newState,
      failureCount: this.failureCount,
      failureThreshold: this.config.failureThreshold,
      recoveryTimeoutMs: this.config.recoveryTimeoutMs,
    });
  }

  /**
   * Reset the circuit breaker to CLOSED state.
   * Useful for testing or manual recovery.
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = 0;

    this.logger?.info('Circuit breaker reset', {
      circuitName: this.config.name,
    });
  }
}

/**
 * Create a circuit breaker instance with configuration from environment variables.
 *
 * @param name - Name for the circuit breaker (used in logging)
 * @param logger - Optional logger for state transitions
 * @returns Configured CircuitBreaker instance
 */
export const createCircuitBreaker = (
  name: string,
  logger?: CircuitBreakerLogger
): CircuitBreaker => {
  const config: CircuitBreakerConfig = {
    name,
    failureThreshold: parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || '3', 10),
    recoveryTimeoutMs: parseInt(process.env.CIRCUIT_BREAKER_RECOVERY_MS || '60000', 10),
  };
  return new CircuitBreaker(config, logger);
};
