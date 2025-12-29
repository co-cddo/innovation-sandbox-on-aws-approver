import { describe, it, expect } from 'vitest';
import {
  ApprovalState,
  TERMINAL_STATES,
  isTerminalState,
  createInitialContext,
  type StateContext,
  type StateTransition,
  type RuleResult,
  type StateError,
} from '../../src/state-machine/types.js';

describe('ApprovalState enum', () => {
  it('should have all expected states', () => {
    expect(ApprovalState.RECEIVED).toBe('RECEIVED');
    expect(ApprovalState.VALIDATING).toBe('VALIDATING');
    expect(ApprovalState.TIMING_CHECK).toBe('TIMING_CHECK');
    expect(ApprovalState.ALLOW_LIST_CHECK).toBe('ALLOW_LIST_CHECK');
    expect(ApprovalState.ACCOUNT_COOLDOWN_CHECK).toBe('ACCOUNT_COOLDOWN_CHECK'); // Epic 6
    expect(ApprovalState.SCORING).toBe('SCORING');
    expect(ApprovalState.DECIDING).toBe('DECIDING');
    expect(ApprovalState.APPROVED).toBe('APPROVED');
    expect(ApprovalState.DENIED).toBe('DENIED');
    expect(ApprovalState.ESCALATED).toBe('ESCALATED');
    expect(ApprovalState.DELAYED).toBe('DELAYED');
    expect(ApprovalState.ERROR).toBe('ERROR');
  });

  it('should have exactly 12 states', () => {
    const stateValues = Object.values(ApprovalState);
    expect(stateValues).toHaveLength(12);
  });
});

describe('TERMINAL_STATES', () => {
  it('should include APPROVED, DENIED, ESCALATED, DELAYED, and ERROR', () => {
    expect(TERMINAL_STATES).toContain(ApprovalState.APPROVED);
    expect(TERMINAL_STATES).toContain(ApprovalState.DENIED);
    expect(TERMINAL_STATES).toContain(ApprovalState.ESCALATED);
    expect(TERMINAL_STATES).toContain(ApprovalState.DELAYED);
    expect(TERMINAL_STATES).toContain(ApprovalState.ERROR);
  });

  it('should have exactly 5 terminal states', () => {
    expect(TERMINAL_STATES).toHaveLength(5);
  });

  it('should not include non-terminal states', () => {
    expect(TERMINAL_STATES).not.toContain(ApprovalState.RECEIVED);
    expect(TERMINAL_STATES).not.toContain(ApprovalState.VALIDATING);
    expect(TERMINAL_STATES).not.toContain(ApprovalState.TIMING_CHECK);
    expect(TERMINAL_STATES).not.toContain(ApprovalState.ALLOW_LIST_CHECK);
    expect(TERMINAL_STATES).not.toContain(ApprovalState.ACCOUNT_COOLDOWN_CHECK); // Epic 6
    expect(TERMINAL_STATES).not.toContain(ApprovalState.SCORING);
    expect(TERMINAL_STATES).not.toContain(ApprovalState.DECIDING);
  });
});

describe('isTerminalState', () => {
  it('should return true for terminal states', () => {
    expect(isTerminalState(ApprovalState.APPROVED)).toBe(true);
    expect(isTerminalState(ApprovalState.DENIED)).toBe(true);
    expect(isTerminalState(ApprovalState.ESCALATED)).toBe(true);
    expect(isTerminalState(ApprovalState.DELAYED)).toBe(true);
    expect(isTerminalState(ApprovalState.ERROR)).toBe(true);
  });

  it('should return false for non-terminal states', () => {
    expect(isTerminalState(ApprovalState.RECEIVED)).toBe(false);
    expect(isTerminalState(ApprovalState.VALIDATING)).toBe(false);
    expect(isTerminalState(ApprovalState.TIMING_CHECK)).toBe(false);
    expect(isTerminalState(ApprovalState.ALLOW_LIST_CHECK)).toBe(false);
    expect(isTerminalState(ApprovalState.SCORING)).toBe(false);
    expect(isTerminalState(ApprovalState.DECIDING)).toBe(false);
  });
});

describe('createInitialContext', () => {
  it('should create context with empty string values', () => {
    const context = createInitialContext();

    expect(context.leaseId).toBe('');
    expect(context.userEmail).toBe('');
    expect(context.templateId).toBe('');
  });

  it('should create context with zero numeric values', () => {
    const context = createInitialContext();

    expect(context.budgetAmount).toBe(0);
    expect(context.leaseDurationHours).toBe(0);
    expect(context.score).toBe(0);
  });

  it('should create context with false boolean values', () => {
    const context = createInitialContext();

    expect(context.requiresManualApproval).toBe(false);
  });

  it('should create context with empty arrays', () => {
    const context = createInitialContext();

    expect(context.scoreBreakdown).toEqual([]);
    expect(context.stateHistory).toEqual([]);
  });

  it('should create context without optional fields', () => {
    const context = createInitialContext();

    expect(context.comments).toBeUndefined();
    expect(context.decision).toBeUndefined();
    expect(context.approvedBy).toBeUndefined();
    expect(context.reason).toBeUndefined();
    expect(context.error).toBeUndefined();
  });

  it('should create a new object each time', () => {
    const context1 = createInitialContext();
    const context2 = createInitialContext();

    expect(context1).not.toBe(context2);
    expect(context1.stateHistory).not.toBe(context2.stateHistory);
  });
});

describe('Type structures', () => {
  it('should allow creating valid RuleResult', () => {
    const result: RuleResult = {
      rule: 'first-time-user',
      points: 5,
      triggered: true,
      reason: 'No previous sessions found',
    };

    expect(result.rule).toBe('first-time-user');
    expect(result.points).toBe(5);
    expect(result.triggered).toBe(true);
    expect(result.reason).toBe('No previous sessions found');
  });

  it('should allow RuleResult without optional reason', () => {
    const result: RuleResult = {
      rule: 'verified-domain',
      points: -5,
      triggered: true,
    };

    expect(result.reason).toBeUndefined();
  });

  it('should allow creating valid StateTransition', () => {
    const transition: StateTransition = {
      from: ApprovalState.RECEIVED,
      to: ApprovalState.VALIDATING,
      timestamp: '2025-01-01T00:00:00.000Z',
      durationMs: 15,
      reason: 'Event parsed successfully',
    };

    expect(transition.from).toBe(ApprovalState.RECEIVED);
    expect(transition.to).toBe(ApprovalState.VALIDATING);
    expect(transition.durationMs).toBe(15);
  });

  it('should allow StateTransition without optional reason', () => {
    const transition: StateTransition = {
      from: ApprovalState.SCORING,
      to: ApprovalState.DECIDING,
      timestamp: '2025-01-01T00:00:00.000Z',
      durationMs: 100,
    };

    expect(transition.reason).toBeUndefined();
  });

  it('should allow creating valid StateError', () => {
    const error: StateError = {
      message: 'DynamoDB timeout',
      code: 'DYNAMO_TIMEOUT',
      state: ApprovalState.SCORING,
    };

    expect(error.message).toBe('DynamoDB timeout');
    expect(error.code).toBe('DYNAMO_TIMEOUT');
    expect(error.state).toBe(ApprovalState.SCORING);
  });

  it('should allow creating complete StateContext', () => {
    const context: StateContext = {
      leaseId: 'abc-123',
      userEmail: 'user@example.gov.uk',
      templateId: 'web-hosting',
      budgetAmount: 50,
      leaseDurationHours: 24,
      requiresManualApproval: false,
      comments: 'Test request',
      userLeaseHistory: [],
      orgLeaseHistory: [],
      isVerifiedGovDomain: true,
      score: 15,
      scoreBreakdown: [
        { rule: 'first-time-user', points: 5, triggered: true },
        { rule: 'budget', points: 5, triggered: true },
        { rule: 'verified-domain', points: -5, triggered: true },
      ],
      decision: 'approved',
      approvedBy: 'ndx+try-automated-approver@dsit.gov.uk',
      reason: 'Score below threshold',
      stateHistory: [
        {
          from: ApprovalState.RECEIVED,
          to: ApprovalState.VALIDATING,
          timestamp: '2025-01-01T00:00:00.000Z',
          durationMs: 10,
        },
      ],
    };

    expect(context.leaseId).toBe('abc-123');
    expect(context.score).toBe(15);
    expect(context.scoreBreakdown).toHaveLength(3);
    expect(context.decision).toBe('approved');
  });
});
