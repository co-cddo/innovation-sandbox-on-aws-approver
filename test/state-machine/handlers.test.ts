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

  it('should transition to TIMING_CHECK when valid', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
    };

    const result = handlers[ApprovalState.VALIDATING](context);

    expect(result.nextState).toBe(ApprovalState.TIMING_CHECK);
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

describe('TIMING_CHECK handler', () => {
  const handlers = createStateHandlers();

  it('should transition to ACCOUNT_AVAILABILITY_CHECK when within business hours', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
      isWithinBusinessHours: true,
    };

    const result = handlers[ApprovalState.TIMING_CHECK](context);

    expect(result.nextState).toBe(ApprovalState.ACCOUNT_AVAILABILITY_CHECK);
    expect(result.context.reason).toBe('Within business hours');
  });

  // TEMPORARY: Skipped while business hours bypass is active (revert with handlers.ts)
  it.skip('should transition to DELAYED when outside business hours', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
      isWithinBusinessHours: false,
      nextProcessingTime: '2025-01-16T07:00:00.000Z',
    };

    const result = handlers[ApprovalState.TIMING_CHECK](context);

    expect(result.nextState).toBe(ApprovalState.DELAYED);
    expect(result.context.decision).toBe('delayed');
    expect(result.context.reason).toContain('Outside business hours');
    expect(result.context.reason).toContain('2025-01-16T07:00:00.000Z');
  });

  // TEMPORARY: Skipped while business hours bypass is active (revert with handlers.ts)
  it.skip('should use "unknown" when nextProcessingTime is undefined (line 157)', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
      isWithinBusinessHours: false,
      // nextProcessingTime is not set (undefined)
    };

    const result = handlers[ApprovalState.TIMING_CHECK](context);

    expect(result.nextState).toBe(ApprovalState.DELAYED);
    expect(result.context.reason).toContain('Outside business hours');
    expect(result.context.reason).toContain('unknown');
  });

  it('should proceed to ACCOUNT_AVAILABILITY_CHECK when timing not checked (undefined)', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
      // isWithinBusinessHours is undefined
    };

    const result = handlers[ApprovalState.TIMING_CHECK](context);

    expect(result.nextState).toBe(ApprovalState.ACCOUNT_AVAILABILITY_CHECK);
    expect(result.context.reason).toBe('Business hours not checked - proceeding');
  });

  it('should be a pure function (no mutation)', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
      isWithinBusinessHours: true,
    };
    const originalContext = JSON.parse(JSON.stringify(context));

    handlers[ApprovalState.TIMING_CHECK](context);

    expect(context).toEqual(originalContext);
  });
});

describe('ACCOUNT_AVAILABILITY_CHECK handler (Epic 6)', () => {
  const handlers = createStateHandlers();

  it('should transition to SCORING when hasReadyAccount is true', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
      hasReadyAccount: true,
      availableAccountCount: 2,
    };

    const result = handlers[ApprovalState.ACCOUNT_AVAILABILITY_CHECK](context);

    expect(result.nextState).toBe(ApprovalState.SCORING);
    expect(result.context.reason).toContain('Available sandbox account exists');
  });

  it('should transition to SCORING when hasReadyAccount is undefined (backwards compatibility)', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
      // hasReadyAccount not set
    };

    const result = handlers[ApprovalState.ACCOUNT_AVAILABILITY_CHECK](context);

    expect(result.nextState).toBe(ApprovalState.SCORING);
    expect(result.context.reason).toContain('Account availability not checked');
  });

  it('should transition to DELAYED when hasReadyAccount is false', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
      hasReadyAccount: false,
      availableAccountCount: 0,
      activeAccountCount: 3,
    };

    const result = handlers[ApprovalState.ACCOUNT_AVAILABILITY_CHECK](context);

    expect(result.nextState).toBe(ApprovalState.DELAYED);
    expect(result.context.decision).toBe('delayed');
    expect(result.context.accountDelayReason).toBe('NO_READY_ACCOUNTS');
    expect(result.context.reason).toContain('No sandbox accounts currently available');
  });

  it('should set default delay reason when not specified', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
      hasReadyAccount: false,
    };

    const result = handlers[ApprovalState.ACCOUNT_AVAILABILITY_CHECK](context);

    expect(result.context.accountDelayReason).toBe('NO_READY_ACCOUNTS');
    expect(result.context.reason).toContain('No sandbox accounts currently available');
  });

  it('should be a pure function (no mutation)', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
      hasReadyAccount: true,
    };
    const originalContext = JSON.parse(JSON.stringify(context));

    handlers[ApprovalState.ACCOUNT_AVAILABILITY_CHECK](context);

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
      isVerifiedGovDomain: true,
      isEndOfWindow: false, // Explicitly set to avoid time-dependent test
    };

    const result = handlers[ApprovalState.SCORING](context);

    // first_time_user: +5, verified_gov_domain: -5
    // org_clean_record: 0 (requires 5+ org leases)
    // Total: 0
    expect(result.context.score).toBe(0);
  });

  it('should populate scoreBreakdown with 19 rules', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
      budgetAmount: 0,
      leaseDurationHours: 0,
    };

    const result = handlers[ApprovalState.SCORING](context);

    // Should have 19 rules in breakdown (including allow_list_override)
    expect(result.context.scoreBreakdown).toHaveLength(19);

    // First-time user rule should be triggered
    const firstTimeRule = result.context.scoreBreakdown.find((r) => r.rule === 'first_time_user');
    expect(firstTimeRule).toBeDefined();
    expect(firstTimeRule!.triggered).toBe(true);
    expect(firstTimeRule!.points).toBe(5);
  });

  it('should set preapprovedOverride to true for pre-approved users', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'preapproved-user@dsit.gov.uk',
      templateId: 'web-hosting',
      budgetAmount: 0,
      leaseDurationHours: 0,
      isVerifiedGovDomain: true,
      isPreapproved: true,
    };

    const result = handlers[ApprovalState.SCORING](context);

    expect(result.context.preapprovedOverride).toBe(true);
    // Pre-approved override gives -100 bonus
    const preapprovedRule = result.context.scoreBreakdown.find((r) => r.rule === 'allow_list_override');
    expect(preapprovedRule).toBeDefined();
    expect(preapprovedRule!.triggered).toBe(true);
    expect(preapprovedRule!.points).toBe(-100);
  });

  it('should set preapprovedOverride to false for non-pre-approved users', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'regular-user@example.gov.uk',
      templateId: 'web-hosting',
      budgetAmount: 0,
      leaseDurationHours: 0,
      isPreapproved: false,
    };

    const result = handlers[ApprovalState.SCORING](context);

    expect(result.context.preapprovedOverride).toBe(false);
    // Pre-approved override rule should not be triggered
    const preapprovedRule = result.context.scoreBreakdown.find((r) => r.rule === 'allow_list_override');
    expect(preapprovedRule).toBeDefined();
    expect(preapprovedRule!.triggered).toBe(false);
    expect(preapprovedRule!.points).toBe(0);
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

    it('should IGNORE requiresManualApproval and approve based on score', () => {
      // ISB always sets requiresManualApproval=true because this approver IS the
      // "manual approver" from ISB's perspective. The flag should be ignored.
      const context: StateContext = {
        ...createInitialContext(),
        leaseId: 'abc-123',
        userEmail: 'user@example.gov.uk',
        templateId: 'web-hosting',
        score: 5, // Low score should approve regardless of requiresManualApproval
        requiresManualApproval: true, // This should be IGNORED
      };

      const result = handlers[ApprovalState.DECIDING](context);

      // Should approve based on score, not escalate due to flag
      expect(result.nextState).toBe(ApprovalState.APPROVED);
      expect(result.context.decision).toBe('approved');
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

describe('DELAYED handler (terminal)', () => {
  const handlers = createStateHandlers();

  it('should stay in DELAYED state', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
      isWithinBusinessHours: false,
      nextProcessingTime: '2025-01-16T07:00:00.000Z',
    };

    const result = handlers[ApprovalState.DELAYED](context);

    expect(result.nextState).toBe(ApprovalState.DELAYED);
  });

  it('should set decision to delayed', () => {
    const context: StateContext = {
      ...createInitialContext(),
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
    };

    const result = handlers[ApprovalState.DELAYED](context);

    expect(result.context.decision).toBe('delayed');
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
