/**
 * State Machine Types for Approval Decision Orchestration
 * Implements enum-based state machine pattern per architecture.md
 */

import type { LeaseHistoryRecord, AIAnalysisResult } from '../scoring/types.js';

/**
 * Approval states for the decision orchestration state machine.
 * Terminal states: APPROVED, DENIED, ESCALATED, ERROR
 */
export enum ApprovalState {
  /** Initial state when event is received */
  RECEIVED = 'RECEIVED',
  /** Validating event schema and extracting data */
  VALIDATING = 'VALIDATING',
  /** Checking business hours and timing */
  TIMING_CHECK = 'TIMING_CHECK',
  /** Checking if a sandbox account is ready for assignment (Epic 6) */
  ACCOUNT_COOLDOWN_CHECK = 'ACCOUNT_COOLDOWN_CHECK',
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
  /** Terminal state for out-of-hours requests sent to delay queue */
  DELAYED = 'DELAYED',
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
  ApprovalState.DELAYED,
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
  /**
   * Whether manual approval was requested by ISB.
   * NOTE: This field is intentionally IGNORED by the approver.
   * ISB routes ALL requests with requiresManualApproval=true because
   * this approver IS the "manual approver" from ISB's perspective.
   * Scoring determines approval decisions, not this flag.
   * @deprecated Not used in decision logic - kept for schema compatibility
   */
  requiresManualApproval: boolean;
  /** Optional comments from requester */
  comments?: string;

  // History data (populated before state machine runs)
  /** User's lease history for scoring rules */
  userLeaseHistory: LeaseHistoryRecord[];
  /** Organization (domain) lease history for org reputation rules */
  orgLeaseHistory: LeaseHistoryRecord[];
  /** Whether domain is in verified gov domains list (from S3 cache) */
  isVerifiedGovDomain: boolean;
  /** AI analysis result for email patterns (from Bedrock or fallback) */
  aiAnalysis?: AIAnalysisResult;

  // Timing data (populated in TIMING_CHECK state)
  /** Whether the request is within business hours */
  isWithinBusinessHours?: boolean;
  /** Whether the request is in end-of-window period (5pm-7pm) */
  isEndOfWindow?: boolean;
  /** Next processing time if delayed (ISO string) */
  nextProcessingTime?: string;

  // Account availability data (populated in ACCOUNT_COOLDOWN_CHECK state - Epic 6)
  /** Whether at least one sandbox account is ready for assignment */
  hasReadyAccount?: boolean;
  /** Count of accounts ready for immediate assignment */
  readyAccountCount?: number;
  /** Count of accounts in cooldown period */
  coolingAccountCount?: number;
  /** Count of accounts currently in use */
  activeAccountCount?: number;
  /** Estimated time when first cooling account will be ready (ISO string) */
  estimatedAccountReadyTime?: string;
  /** Delay reason if no accounts available */
  accountDelayReason?: 'NO_READY_ACCOUNTS' | 'ACCOUNT_FETCH_ERROR';

  // Queue position data (populated when request is delayed due to cooldown - Story 6.3)
  /** Queue position for FIFO processing (1-based) */
  queuePosition?: number;
  /** Total queue depth (pending requests) */
  queueDepth?: number;

  // Processing state (populated during processing)
  /** Calculated risk score */
  score: number;
  /** Breakdown of score by rule */
  scoreBreakdown: RuleResult[];
  /** Final decision */
  decision?: 'approved' | 'denied' | 'escalated' | 'delayed';
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
  isVerifiedGovDomain: false,
  score: 0,
  scoreBreakdown: [],
  stateHistory: [],
});
