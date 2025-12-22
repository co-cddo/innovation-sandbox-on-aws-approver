/**
 * Tests for orchestrator error handling.
 * These tests verify the catch block that handles unexpected handler exceptions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ApprovalState,
  createInitialContext,
  type StateContext,
} from '../../src/state-machine/types.js';

// Mock the handlers module to inject a throwing handler
vi.mock('../../src/state-machine/handlers.js', () => ({
  createStateHandlers: vi.fn(),
}));

import { createStateHandlers } from '../../src/state-machine/handlers.js';
import {
  createStateMachineOrchestrator,
  type StateMachineLogger,
  type OrchestratorConfig,
} from '../../src/state-machine/orchestrator.js';

// Create mock logger
const createMockLogger = (): StateMachineLogger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe('orchestrator error handling', () => {
  let mockLogger: StateMachineLogger;

  beforeEach(() => {
    mockLogger = createMockLogger();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should catch handler exceptions and transition to ERROR state', () => {
    // Create handlers where VALIDATING throws an Error
    const mockedCreateStateHandlers = createStateHandlers as ReturnType<typeof vi.fn>;
    mockedCreateStateHandlers.mockReturnValue({
      [ApprovalState.RECEIVED]: (ctx: StateContext) => ({
        nextState: ApprovalState.VALIDATING,
        context: ctx,
      }),
      [ApprovalState.VALIDATING]: () => {
        throw new Error('Handler threw an exception');
      },
      [ApprovalState.SCORING]: (ctx: StateContext) => ({
        nextState: ApprovalState.DECIDING,
        context: { ...ctx, score: 0 },
      }),
      [ApprovalState.DECIDING]: (ctx: StateContext) => ({
        nextState: ApprovalState.APPROVED,
        context: { ...ctx, decision: 'approved' as const },
      }),
      [ApprovalState.APPROVED]: (ctx: StateContext) => ({
        nextState: ApprovalState.APPROVED,
        context: ctx,
      }),
      [ApprovalState.DENIED]: (ctx: StateContext) => ({
        nextState: ApprovalState.DENIED,
        context: ctx,
      }),
      [ApprovalState.ESCALATED]: (ctx: StateContext) => ({
        nextState: ApprovalState.ESCALATED,
        context: ctx,
      }),
      [ApprovalState.ERROR]: (ctx: StateContext) => ({
        nextState: ApprovalState.ERROR,
        context: ctx,
      }),
    });

    const config: OrchestratorConfig = {
      stateMachineConfig: { autoApproveThreshold: 20 },
      logger: mockLogger,
    };

    const orchestrator = createStateMachineOrchestrator(config);

    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
    };

    const result = orchestrator.run(ApprovalState.RECEIVED, context);

    expect(result.finalState).toBe(ApprovalState.ERROR);
    expect(result.success).toBe(false);
    expect(result.context.error).toBeDefined();
    expect(result.context.error?.code).toBe('HANDLER_ERROR');
    expect(result.context.error?.message).toBe('Handler threw an exception');
    expect(result.context.error?.state).toBe(ApprovalState.VALIDATING);

    // Verify error was logged
    expect(mockLogger.error).toHaveBeenCalledWith(
      'State handler error',
      expect.objectContaining({
        state: ApprovalState.VALIDATING,
        error: 'Handler threw an exception',
      })
    );
  });

  it('should handle non-Error exceptions thrown by handlers', () => {
    // Create handlers where VALIDATING throws a non-Error
    const mockedCreateStateHandlers = createStateHandlers as ReturnType<typeof vi.fn>;
    mockedCreateStateHandlers.mockReturnValue({
      [ApprovalState.RECEIVED]: (ctx: StateContext) => ({
        nextState: ApprovalState.VALIDATING,
        context: ctx,
      }),
      [ApprovalState.VALIDATING]: () => {
        throw 'String exception'; // Non-Error throw
      },
      [ApprovalState.SCORING]: (ctx: StateContext) => ({
        nextState: ApprovalState.DECIDING,
        context: ctx,
      }),
      [ApprovalState.DECIDING]: (ctx: StateContext) => ({
        nextState: ApprovalState.APPROVED,
        context: ctx,
      }),
      [ApprovalState.APPROVED]: (ctx: StateContext) => ({
        nextState: ApprovalState.APPROVED,
        context: ctx,
      }),
      [ApprovalState.DENIED]: (ctx: StateContext) => ({
        nextState: ApprovalState.DENIED,
        context: ctx,
      }),
      [ApprovalState.ESCALATED]: (ctx: StateContext) => ({
        nextState: ApprovalState.ESCALATED,
        context: ctx,
      }),
      [ApprovalState.ERROR]: (ctx: StateContext) => ({
        nextState: ApprovalState.ERROR,
        context: ctx,
      }),
    });

    const config: OrchestratorConfig = {
      stateMachineConfig: { autoApproveThreshold: 20 },
      logger: mockLogger,
    };

    const orchestrator = createStateMachineOrchestrator(config);

    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
    };

    const result = orchestrator.run(ApprovalState.RECEIVED, context);

    expect(result.finalState).toBe(ApprovalState.ERROR);
    expect(result.success).toBe(false);
    expect(result.context.error?.message).toBe('String exception');
    expect(result.context.error?.code).toBe('HANDLER_ERROR');

    // Verify error was logged
    expect(mockLogger.error).toHaveBeenCalledWith(
      'State handler error',
      expect.objectContaining({
        error: 'String exception',
      })
    );
  });

  it('should record transition to ERROR with proper timing', () => {
    const mockedCreateStateHandlers = createStateHandlers as ReturnType<typeof vi.fn>;
    mockedCreateStateHandlers.mockReturnValue({
      [ApprovalState.RECEIVED]: (ctx: StateContext) => ({
        nextState: ApprovalState.VALIDATING,
        context: ctx,
      }),
      [ApprovalState.VALIDATING]: () => {
        throw new Error('Timing test error');
      },
      [ApprovalState.SCORING]: (ctx: StateContext) => ({
        nextState: ApprovalState.DECIDING,
        context: ctx,
      }),
      [ApprovalState.DECIDING]: (ctx: StateContext) => ({
        nextState: ApprovalState.APPROVED,
        context: ctx,
      }),
      [ApprovalState.APPROVED]: (ctx: StateContext) => ({
        nextState: ApprovalState.APPROVED,
        context: ctx,
      }),
      [ApprovalState.DENIED]: (ctx: StateContext) => ({
        nextState: ApprovalState.DENIED,
        context: ctx,
      }),
      [ApprovalState.ESCALATED]: (ctx: StateContext) => ({
        nextState: ApprovalState.ESCALATED,
        context: ctx,
      }),
      [ApprovalState.ERROR]: (ctx: StateContext) => ({
        nextState: ApprovalState.ERROR,
        context: ctx,
      }),
    });

    const config: OrchestratorConfig = {
      stateMachineConfig: { autoApproveThreshold: 20 },
      logger: mockLogger,
    };

    const orchestrator = createStateMachineOrchestrator(config);

    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
    };

    const result = orchestrator.run(ApprovalState.RECEIVED, context);

    // Should have two transitions: RECEIVED→VALIDATING, VALIDATING→ERROR
    expect(result.context.stateHistory).toHaveLength(2);

    const errorTransition = result.context.stateHistory[1]!;
    expect(errorTransition.from).toBe(ApprovalState.VALIDATING);
    expect(errorTransition.to).toBe(ApprovalState.ERROR);
    expect(errorTransition.reason).toBe('Handler error: Timing test error');
    expect(errorTransition.durationMs).toBeGreaterThanOrEqual(0);
  });
});
