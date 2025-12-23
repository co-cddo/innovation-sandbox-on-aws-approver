import { describe, it, expect, vi } from 'vitest';
import { createStateHandlers, getStateHandler, type HandlerConfig } from '../../src/state-machine/handlers.js';
import {
  ApprovalState,
  createInitialContext,
  type StateContext,
  type StateMachineConfig,
} from '../../src/state-machine/types.js';
import type { StateMachineLogger } from '../../src/state-machine/orchestrator.js';

describe('createStateHandlers', () => {
  it('should create handlers for all states', () => {
    const handlers = createStateHandlers();

    expect(handlers[ApprovalState.RECEIVED]).toBeDefined();
    expect(handlers[ApprovalState.VALIDATING]).toBeDefined();
    expect(handlers[ApprovalState.SCORING]).toBeDefined();
    expect(handlers[ApprovalState.DECIDING]).toBeDefined();
    expect(handlers[ApprovalState.APPROVED]).toBeDefined();
    expect(handlers[ApprovalState.DENIED]).toBeDefined();
    expect(handlers[ApprovalState.ESCALATED]).toBeDefined();
    expect(handlers[ApprovalState.ERROR]).toBeDefined();
  });

  it('should return functions for all handlers', () => {
    const handlers = createStateHandlers();

    Object.values(handlers).forEach((handler) => {
      expect(typeof handler).toBe('function');
    });
  });

  it('should accept HandlerConfig with custom logger', () => {
    const mockLogger: StateMachineLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const handlerConfig: HandlerConfig = {
      stateMachineConfig: { autoApproveThreshold: 15 },
      logger: mockLogger,
    };
    const handlers = createStateHandlers(handlerConfig);

    expect(handlers[ApprovalState.RECEIVED]).toBeDefined();
    expect(handlers[ApprovalState.SCORING]).toBeDefined();
  });

  it('should accept empty HandlerConfig and use defaults', () => {
    const handlerConfig: HandlerConfig = {};
    const handlers = createStateHandlers(handlerConfig);

    expect(handlers[ApprovalState.RECEIVED]).toBeDefined();
  });
});

describe('getStateHandler', () => {
  it('should return handler for specified state', () => {
    const handler = getStateHandler(ApprovalState.RECEIVED);
    expect(typeof handler).toBe('function');
  });

  it('should accept custom config', () => {
    const customConfig: StateMachineConfig = { autoApproveThreshold: 10 };
    const handler = getStateHandler(ApprovalState.DECIDING, customConfig);
    expect(typeof handler).toBe('function');
  });
});

describe('RECEIVED handler', () => {
  const handlers = createStateHandlers();

  it('should transition to VALIDATING', () => {
    const context = createInitialContext();
    const result = handlers[ApprovalState.RECEIVED](context);

    expect(result.nextState).toBe(ApprovalState.VALIDATING);
  });

  it('should preserve context data', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'test-123',
      userEmail: 'user@example.gov.uk',
    };

    const result = handlers[ApprovalState.RECEIVED](context);

    expect(result.context.leaseId).toBe('test-123');
    expect(result.context.userEmail).toBe('user@example.gov.uk');
  });

  it('should be a pure function (no mutation)', () => {
    const context = createInitialContext();
    const originalContext = { ...context };

    handlers[ApprovalState.RECEIVED](context);

    expect(context).toEqual(originalContext);
  });
});

describe('VALIDATING handler', () => {
  const handlers = createStateHandlers();

  it('should transition to ALLOW_LIST_CHECK when valid', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
    };

    const result = handlers[ApprovalState.VALIDATING](context);

    expect(result.nextState).toBe(ApprovalState.ALLOW_LIST_CHECK);
  });

  it('should transition to ERROR when leaseId is missing', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: '', // Missing
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
    };

    const result = handlers[ApprovalState.VALIDATING](context);

    expect(result.nextState).toBe(ApprovalState.ERROR);
    expect(result.context.error).toBeDefined();
    expect(result.context.error?.code).toBe('VALIDATION_ERROR');
    expect(result.context.error?.state).toBe(ApprovalState.VALIDATING);
  });

  it('should transition to ERROR when userEmail is missing', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: '', // Missing
      templateId: 'web-hosting',
    };

    const result = handlers[ApprovalState.VALIDATING](context);

    expect(result.nextState).toBe(ApprovalState.ERROR);
    expect(result.context.error?.message).toContain('Missing required fields');
  });

  it('should transition to ERROR when templateId is missing', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: '', // Missing
    };

    const result = handlers[ApprovalState.VALIDATING](context);

    expect(result.nextState).toBe(ApprovalState.ERROR);
  });

  it('should be a pure function (no mutation)', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
    };
    const originalContext = JSON.parse(JSON.stringify(context));

    handlers[ApprovalState.VALIDATING](context);

    expect(context).toEqual(originalContext);
  });
});

describe('ALLOW_LIST_CHECK handler', () => {
  const handlers = createStateHandlers();

  it('should transition to APPROVED for allow-listed email', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'chris.nesbitt-smith@dsit.gov.uk',
      templateId: 'web-hosting',
    };

    const result = handlers[ApprovalState.ALLOW_LIST_CHECK](context);

    expect(result.nextState).toBe(ApprovalState.APPROVED);
    expect(result.context.allowListOverride).toBe(true);
    expect(result.context.decision).toBe('approved');
    expect(result.context.reason).toBe('ALLOW-LIST-OVERRIDE');
    expect(result.context.score).toBe(0);
  });

  it('should transition to SCORING for non-allow-listed email', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'regular-user@example.gov.uk',
      templateId: 'web-hosting',
    };

    const result = handlers[ApprovalState.ALLOW_LIST_CHECK](context);

    expect(result.nextState).toBe(ApprovalState.SCORING);
    expect(result.context.allowListOverride).toBe(false);
  });

  it('should be case-insensitive for allow-list check', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'CHRIS.NESBITT-SMITH@DSIT.GOV.UK',
      templateId: 'web-hosting',
    };

    const result = handlers[ApprovalState.ALLOW_LIST_CHECK](context);

    expect(result.nextState).toBe(ApprovalState.APPROVED);
    expect(result.context.allowListOverride).toBe(true);
  });

  it('should be a pure function (no mutation)', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
    };
    const originalContext = JSON.parse(JSON.stringify(context));

    handlers[ApprovalState.ALLOW_LIST_CHECK](context);

    expect(context).toEqual(originalContext);
  });
});

describe('SCORING handler', () => {
  const handlers = createStateHandlers();

  it('should transition to DECIDING', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
    };

    const result = handlers[ApprovalState.SCORING](context);

    expect(result.nextState).toBe(ApprovalState.DECIDING);
  });

  it('should calculate score using scoring engine (first-time user)', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
      budgetAmount: 0,
      leaseDurationHours: 0,
    };

    const result = handlers[ApprovalState.SCORING](context);

    // First-time user with no budget/duration = score of 5
    expect(result.context.score).toBe(5);
  });

  it('should populate scoreBreakdown with 16 rules', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
      budgetAmount: 0,
      leaseDurationHours: 0,
    };

    const result = handlers[ApprovalState.SCORING](context);

    // Should have 16 rules in breakdown
    expect(result.context.scoreBreakdown).toHaveLength(16);

    // First-time user rule should be triggered
    const firstTimeRule = result.context.scoreBreakdown.find((r) => r.rule === 'first_time_user');
    expect(firstTimeRule).toBeDefined();
    expect(firstTimeRule!.triggered).toBe(true);
    expect(firstTimeRule!.points).toBe(5);
  });

  it('should be a pure function (no mutation)', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
    };
    const originalContext = JSON.parse(JSON.stringify(context));

    handlers[ApprovalState.SCORING](context);

    expect(context).toEqual(originalContext);
  });
});

describe('DECIDING handler', () => {
  describe('with default threshold (20)', () => {
    const handlers = createStateHandlers();

    it('should transition to APPROVED when score is below threshold', () => {
      const context: StateContext = {
        ...createInitialContext(),
        leaseId: 'abc-123',
        userEmail: 'user@example.gov.uk',
        templateId: 'web-hosting',
        score: 15,
        requiresManualApproval: false,
      };

      const result = handlers[ApprovalState.DECIDING](context);

      expect(result.nextState).toBe(ApprovalState.APPROVED);
      expect(result.context.decision).toBe('approved');
      expect(result.context.approvedBy).toBe('ndx+try-automated-approver@dsit.gov.uk');
      expect(result.context.reason).toContain('below threshold');
    });

    it('should transition to APPROVED when score is 0', () => {
      const context: StateContext = {
        ...createInitialContext(),
        leaseId: 'abc-123',
        userEmail: 'user@example.gov.uk',
        templateId: 'web-hosting',
        score: 0,
        requiresManualApproval: false,
      };

      const result = handlers[ApprovalState.DECIDING](context);

      expect(result.nextState).toBe(ApprovalState.APPROVED);
    });

    it('should transition to ESCALATED when score equals threshold', () => {
      const context: StateContext = {
        ...createInitialContext(),
        leaseId: 'abc-123',
        userEmail: 'user@example.gov.uk',
        templateId: 'web-hosting',
        score: 20,
        requiresManualApproval: false,
      };

      const result = handlers[ApprovalState.DECIDING](context);

      expect(result.nextState).toBe(ApprovalState.ESCALATED);
      expect(result.context.decision).toBe('escalated');
      expect(result.context.reason).toContain('meets or exceeds threshold');
    });

    it('should transition to ESCALATED when score exceeds threshold', () => {
      const context: StateContext = {
        ...createInitialContext(),
        leaseId: 'abc-123',
        userEmail: 'user@example.gov.uk',
        templateId: 'web-hosting',
        score: 25,
        requiresManualApproval: false,
      };

      const result = handlers[ApprovalState.DECIDING](context);

      expect(result.nextState).toBe(ApprovalState.ESCALATED);
    });

    it('should transition to ESCALATED when requiresManualApproval is true', () => {
      const context: StateContext = {
        ...createInitialContext(),
        leaseId: 'abc-123',
        userEmail: 'user@example.gov.uk',
        templateId: 'web-hosting',
        score: 5, // Low score, but manual approval requested
        requiresManualApproval: true,
      };

      const result = handlers[ApprovalState.DECIDING](context);

      expect(result.nextState).toBe(ApprovalState.ESCALATED);
      expect(result.context.decision).toBe('escalated');
      expect(result.context.reason).toBe('Manual approval requested by user');
    });
  });

  describe('with custom threshold', () => {
    it('should use custom threshold for decision', () => {
      const customConfig: StateMachineConfig = { autoApproveThreshold: 10 };
      const handlers = createStateHandlers(customConfig);

      const context: StateContext = {
        ...createInitialContext(),
        leaseId: 'abc-123',
        userEmail: 'user@example.gov.uk',
        templateId: 'web-hosting',
        score: 15, // Would approve with default 20, but escalates with 10
        requiresManualApproval: false,
      };

      const result = handlers[ApprovalState.DECIDING](context);

      expect(result.nextState).toBe(ApprovalState.ESCALATED);
    });

    it('should approve when score is below custom threshold', () => {
      const customConfig: StateMachineConfig = { autoApproveThreshold: 10 };
      const handlers = createStateHandlers(customConfig);

      const context: StateContext = {
        ...createInitialContext(),
        leaseId: 'abc-123',
        userEmail: 'user@example.gov.uk',
        templateId: 'web-hosting',
        score: 5,
        requiresManualApproval: false,
      };

      const result = handlers[ApprovalState.DECIDING](context);

      expect(result.nextState).toBe(ApprovalState.APPROVED);
    });
  });

  it('should be a pure function (no mutation)', () => {
    const handlers = createStateHandlers();
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
      score: 15,
      requiresManualApproval: false,
    };
    const originalContext = JSON.parse(JSON.stringify(context));

    handlers[ApprovalState.DECIDING](context);

    expect(context).toEqual(originalContext);
  });
});

describe('APPROVED handler (terminal)', () => {
  const handlers = createStateHandlers();

  it('should stay in APPROVED state', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
      decision: 'approved',
      approvedBy: 'ndx+try-automated-approver@dsit.gov.uk',
    };

    const result = handlers[ApprovalState.APPROVED](context);

    expect(result.nextState).toBe(ApprovalState.APPROVED);
  });

  it('should preserve existing decision and approvedBy', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
      decision: 'approved',
      approvedBy: 'operator@example.gov.uk',
    };

    const result = handlers[ApprovalState.APPROVED](context);

    expect(result.context.decision).toBe('approved');
    expect(result.context.approvedBy).toBe('operator@example.gov.uk');
  });

  it('should set defaults if decision/approvedBy not set', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
    };

    const result = handlers[ApprovalState.APPROVED](context);

    expect(result.context.decision).toBe('approved');
    expect(result.context.approvedBy).toBe('ndx+try-automated-approver@dsit.gov.uk');
  });
});

describe('DENIED handler (terminal)', () => {
  const handlers = createStateHandlers();

  it('should stay in DENIED state', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
    };

    const result = handlers[ApprovalState.DENIED](context);

    expect(result.nextState).toBe(ApprovalState.DENIED);
  });

  it('should set decision to denied', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
    };

    const result = handlers[ApprovalState.DENIED](context);

    expect(result.context.decision).toBe('denied');
  });
});

describe('ESCALATED handler (terminal)', () => {
  const handlers = createStateHandlers();

  it('should stay in ESCALATED state', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
    };

    const result = handlers[ApprovalState.ESCALATED](context);

    expect(result.nextState).toBe(ApprovalState.ESCALATED);
  });

  it('should set decision to escalated', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
    };

    const result = handlers[ApprovalState.ESCALATED](context);

    expect(result.context.decision).toBe('escalated');
  });
});

describe('ERROR handler (terminal)', () => {
  const handlers = createStateHandlers();

  it('should stay in ERROR state', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      error: {
        message: 'Test error',
        code: 'TEST_ERROR',
        state: ApprovalState.SCORING,
      },
    };

    const result = handlers[ApprovalState.ERROR](context);

    expect(result.nextState).toBe(ApprovalState.ERROR);
  });

  it('should preserve error details', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      error: {
        message: 'DynamoDB timeout',
        code: 'DYNAMO_TIMEOUT',
        state: ApprovalState.SCORING,
      },
    };

    const result = handlers[ApprovalState.ERROR](context);

    expect(result.context.error).toBeDefined();
    expect(result.context.error?.message).toBe('DynamoDB timeout');
    expect(result.context.error?.code).toBe('DYNAMO_TIMEOUT');
  });
});
