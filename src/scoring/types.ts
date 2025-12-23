/**
 * Scoring Engine Types and Interfaces
 *
 * Defines types for the 18-rule scoring engine per architecture.md.
 * All rules are pure functions for testability and determinism.
 */

/**
 * ISB Lease Status values from the ISB integration reference.
 * These are the actual values stored in the ISB DynamoDB Leases table.
 */
export type LeaseStatus =
  | 'PendingApproval'
  | 'ApprovalDenied'
  | 'Active'
  | 'Frozen'
  | 'Expired'
  | 'BudgetExceeded'
  | 'ManuallyTerminated'
  | 'AccountQuarantined'
  | 'Ejected';

/**
 * All 18 rule identifiers as a const array for iteration and validation.
 */
export const RULE_IDS = [
  'expired_leases',
  'budget_exceeded',
  'first_time_user',
  'first_time_suspicious',
  'verified_gov_domain',
  'familiar_template',
  'template_hopper',
  'budget_amount',
  'duration_requested',
  'end_of_window',
  'cooldown_violation',
  'outside_target_audience',
  'manual_early_termination',
  'org_recent_negative',
  'org_clean_record',
  'group_mailbox_detected',
  'user_rate_limit',
  'org_rate_limit',
] as const;

/**
 * Rule identifier type - one of the 18 defined rules.
 */
export type RuleId = (typeof RULE_IDS)[number];

/**
 * Configurable weights for each rule.
 * Positive = penalty (increases score/risk)
 * Negative = bonus (decreases score/risk)
 */
export type RuleWeights = Record<RuleId, number>;

/**
 * Default weights for all 18 rules.
 * These values come from the PRD and can be overridden via RULE_WEIGHTS env var.
 */
export const DEFAULT_RULE_WEIGHTS: RuleWeights = {
  // Penalty rules (positive = more scrutiny)
  expired_leases: 2, // +2 each expired lease in last 30 days
  budget_exceeded: 5, // +5 each budget exceeded in last 30 days
  first_time_user: 5, // +5 for no previous leases
  first_time_suspicious: 20, // +20 for first lease + group mailbox
  cooldown_violation: 10, // +10 for request within 1hr of previous lease end
  outside_target_audience: 10, // +10 for non-local-gov domain (AI)
  group_mailbox_detected: 20, // +20 for detected group mailbox (AI)
  org_recent_negative: 3, // +3 for same domain issues in last 30 days
  template_hopper: 2, // +2 for 3+ leases never repeating template

  // Bonus rules (negative = less scrutiny)
  verified_gov_domain: -5, // -5 for domain in ukps-domains allowlist
  familiar_template: -1, // -1 for previously used template successfully
  end_of_window: -2, // -2 for request in final 2 hours (5-7pm London)
  manual_early_termination: -2, // -2 each early termination (responsible)
  org_clean_record: -2, // -2 for domain clean for 90 days

  // Per-unit rules
  budget_amount: 1, // +1 per $10 of budget
  duration_requested: 1, // +1 per 8 hours of duration

  // Rate limiting rules (Story 4.3)
  user_rate_limit: 5, // +5 per additional request beyond 2/hour
  org_rate_limit: 3, // +3 if 5+ different users from org in last hour
};

/**
 * Historical lease record for scoring context.
 * Matches the ISB DynamoDB Leases table schema.
 */
export interface LeaseHistoryRecord {
  /** Lease UUID (sort key in DynamoDB) */
  uuid: string;
  /** User email (partition key in DynamoDB) */
  userEmail: string;
  /** Lease status (ISB status values) */
  status: LeaseStatus;
  /** Template UUID used for this lease */
  originalLeaseTemplateUuid: string;
  /** When the lease was created (ISO datetime string) */
  created: string;
  /** When the lease ended (ISO datetime string, for terminal states) */
  endDate?: string;
}

/**
 * AI analysis result (from Bedrock) - optional, only available in Epic 3+.
 */
export interface AIAnalysisResult {
  /** Whether email appears to be a group mailbox */
  isGroupMailbox: boolean;
  /** Whether domain appears outside target audience */
  isOutsideTargetAudience: boolean;
  /** Confidence level 0-1 */
  confidence: number;
}

/**
 * Context for scoring a lease request.
 * Contains all data needed to calculate the composite score.
 */
export interface ScoringContext {
  // From event (always available)
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
  /** Timestamp of the request */
  requestTimestamp: Date;

  // From user history (populated in Story 3.1 via DynamoDB query)
  /** User's lease history for last 30-90 days */
  userLeaseHistory: LeaseHistoryRecord[];

  // From org history (populated in Story 3.2 via domain-based query)
  /** Organization (domain) lease history */
  orgLeaseHistory: LeaseHistoryRecord[];

  // From domain verification (populated in Story 3.3 via S3 cache)
  /** Whether domain is in verified gov domains list */
  isVerifiedGovDomain: boolean;

  // From AI analysis (populated in Story 3.4 via Bedrock)
  /** AI analysis of email/domain - only available in Epic 3+ */
  aiAnalysis?: AIAnalysisResult;

  // From business hours check (populated in Story 4.1)
  /** Whether request is in end-of-window period (5-7pm London) - pre-calculated by state machine */
  isEndOfWindow?: boolean;
}

/**
 * Required fields for creating a scoring context.
 */
export interface ScoringContextInput {
  leaseId: string;
  userEmail: string;
  templateId: string;
  budgetAmount: number;
  leaseDurationHours: number;
  requestTimestamp: Date;
  userLeaseHistory?: LeaseHistoryRecord[];
  orgLeaseHistory?: LeaseHistoryRecord[];
  isVerifiedGovDomain?: boolean;
  aiAnalysis?: AIAnalysisResult;
  isEndOfWindow?: boolean;
}

/**
 * Create a scoring context with defaults for optional fields.
 * In Story 2.3, history and AI analysis are stubbed (empty/undefined).
 */
export const createScoringContext = (input: ScoringContextInput): ScoringContext => ({
  leaseId: input.leaseId,
  userEmail: input.userEmail,
  templateId: input.templateId,
  budgetAmount: input.budgetAmount,
  leaseDurationHours: input.leaseDurationHours,
  requestTimestamp: input.requestTimestamp,
  userLeaseHistory: input.userLeaseHistory ?? [],
  orgLeaseHistory: input.orgLeaseHistory ?? [],
  isVerifiedGovDomain: input.isVerifiedGovDomain ?? false,
  aiAnalysis: input.aiAnalysis,
  isEndOfWindow: input.isEndOfWindow,
});

/**
 * Result from a single scoring rule evaluation.
 */
export interface ScoringRuleResult {
  /** Rule identifier */
  ruleId: RuleId;
  /** Points contributed to total score (can be negative for bonuses) */
  points: number;
  /** Whether the rule condition was met */
  triggered: boolean;
  /** Human-readable explanation */
  reason?: string;
  /** Whether pessimistic fallback was used due to missing data */
  fallbackUsed?: boolean;
}

/**
 * Complete scoring result with breakdown.
 */
export interface ScoringResult {
  /** Total score (sum of all rule points) */
  totalScore: number;
  /** Breakdown by rule */
  breakdown: ScoringRuleResult[];
  /** Time taken to calculate score in milliseconds */
  durationMs: number;
}

/**
 * Scoring rule function type.
 * Pure function: takes context and weight, returns result.
 */
export type ScoringRuleFn = (context: ScoringContext, weight: number) => ScoringRuleResult;

/**
 * Scoring engine configuration.
 */
export interface ScoringEngineConfig {
  /** Weights for each rule (overrides defaults) */
  weights: Partial<RuleWeights>;
  /** Threshold for auto-approval (score must be < this to auto-approve) */
  threshold: number;
}

/**
 * Score breakdown as a simple object mapping rule names to point values.
 * Used for user-facing messages (Story 5.1).
 */
export type ScoreBreakdown = Record<string, number>;
