/**
 * State Machine Types for Approval Decision Orchestration
 * Implements enum-based state machine pattern per architecture.md
 */

import type { LeaseHistoryRecord } from '../scoring/types.js';

/**
 * Approval states for the decision orchestration state machine.
 * Terminal states: APPROVED, DENIED, ESCALATED, ERROR
 */
export enum ApprovalState {
  /** Initial state when event is received */
  RECEIVED = 'RECEIVED',
  /** Validating event schema and extracting data */
  VALIDATING = 'VALIDATING',
  /** Checking if user is on the allow-list for auto-approval bypass */
  ALLOW_LIST_CHECK = 'ALLOW_LIST_CHECK',
  /** Running scoring rules */
  SCORING = 'SCORING',
  /** Making approval/denial/escalation decision */
  DECIDING = 'DECIDING',
  /** Terminal state for auto-approved requests */
  APPROVED = 'APPROVED',
  /** Terminal state for denied requests */
  DENIED = 'DENIED',
  /** Terminal state for manual review */
  ESCALATED = 'ESCALATED',
  /** Terminal state for infrastructure errors */
  ERROR = 'ERROR',
}

/**
 * Terminal states where the state machine stops processing
 */
export const TERMINAL_STATES: readonly ApprovalState[] = [
  ApprovalState.APPROVED,
  ApprovalState.DENIED,
  ApprovalState.ESCALATED,
  ApprovalState.ERROR,
] as const;

/**
 * Check if a state is a terminal state
 */
export const isTerminalState = (state: ApprovalState): boolean =>
  TERMINAL_STATES.includes(state);

/**
 * Result from a single scoring rule
 */
export interface RuleResult {
  /** Rule identifier */
  rule: string;
  /** Points contributed (positive = penalty, negative = bonus) */
  points: number;
  /** Whether the rule was triggered */
  triggered: boolean;
  /** Optional explanation */
  reason?: string;
}

/**
 * Record of a state transition
 */
export interface StateTransition {
  /** State before transition */
  from: ApprovalState;
  /** State after transition */
  to: ApprovalState;
  /** ISO timestamp when transition occurred */
  timestamp: string;
  /** Duration of the state handler in milliseconds */
  durationMs: number;
  /** Optional reason for the transition */
  reason?: string;
}

/**
 * Error details captured when transitioning to ERROR state
 */
export interface StateError {
  /** Error message */
  message: string;
  /** Error code for categorization */
  code: string;
  /** State where the error occurred */
  state: ApprovalState;
}

/**
 * Context passed through state machine handlers.
 * Contains all data needed for decision making.
 */
export interface StateContext {
  // Event data (populated in VALIDATING state)
  /** Lease UUID */
  leaseId: string;
  /** Requester email address */
  userEmail: string;
  /** Requested template ID */
  templateId: string;
  /** Budget amount in dollars */
  budgetAmount: number;
  /** Lease duration in hours */
  leaseDurationHours: number;
  /** Whether manual approval was requested */
  requiresManualApproval: boolean;
  /** Optional comments from requester */
  comments?: string;

  // History data (populated before state machine runs)
  /** User's lease history for scoring rules */
  userLeaseHistory: LeaseHistoryRecord[];
  /** Organization (domain) lease history for org reputation rules */
  orgLeaseHistory: LeaseHistoryRecord[];

  // Processing state (populated during processing)
  /** Calculated risk score */
  score: number;
  /** Breakdown of score by rule */
  scoreBreakdown: RuleResult[];
  /** Final decision */
  decision?: 'approved' | 'denied' | 'escalated';
  /** Who approved/denied (system or operator email) */
  approvedBy?: string;
  /** Reason for the decision */
  reason?: string;
  /** Whether the allow-list bypass was used */
  allowListOverride?: boolean;

  // Error tracking
  /** Error details if ERROR state reached */
  error?: StateError;

  // State history for audit
  /** Full history of state transitions */
  stateHistory: StateTransition[];
}

/**
 * Result from a state handler.
 * Handlers are pure functions that return next state and updated context.
 */
export interface StateHandlerResult {
  /** Next state to transition to */
  nextState: ApprovalState;
  /** Updated context (should not mutate original) */
  context: StateContext;
}

/**
 * State handler function type.
 * Pure function: takes context, returns next state + updated context.
 * No side effects - side effects are handled by the orchestrator.
 */
export type StateHandler = (context: StateContext) => StateHandlerResult;

/**
 * Result from the state machine orchestrator
 */
export interface StateMachineResult {
  /** Final state reached */
  finalState: ApprovalState;
  /** Final context with all processing results */
  context: StateContext;
  /** Whether processing completed successfully (terminal state reached) */
  success: boolean;
}

/**
 * Configuration for the state machine
 */
export interface StateMachineConfig {
  /** Auto-approve threshold (score must be strictly less than this) */
  autoApproveThreshold: number;
}

/**
 * Create an initial context with default values.
 * Used to start state machine processing.
 */
export const createInitialContext = (): StateContext => ({
  leaseId: '',
  userEmail: '',
  templateId: '',
  budgetAmount: 0,
  leaseDurationHours: 0,
  requiresManualApproval: false,
  userLeaseHistory: [],
  orgLeaseHistory: [],
  score: 0,
  scoreBreakdown: [],
  stateHistory: [],
});
