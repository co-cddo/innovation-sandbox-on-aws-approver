/**
 * Scoring Engine Types and Interfaces
 *
 * Defines types for the 16-rule scoring engine per architecture.md.
 * All rules are pure functions for testability and determinism.
 */

/**
 * All 16 rule identifiers as a const array for iteration and validation.
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
] as const;

/**
 * Rule identifier type - one of the 16 defined rules.
 */
export type RuleId = (typeof RULE_IDS)[number];

/**
 * Configurable weights for each rule.
 * Positive = penalty (increases score/risk)
 * Negative = bonus (decreases score/risk)
 */
export type RuleWeights = Record<RuleId, number>;

/**
 * Default weights for all 16 rules.
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
};

/**
 * Historical lease record for scoring context.
 */
export interface LeaseHistoryRecord {
  /** Lease UUID */
  leaseId: string;
  /** Lease status */
  status: 'Completed' | 'Expired' | 'BudgetExceeded' | 'Active' | 'Terminated';
  /** Template used for this lease */
  templateId: string;
  /** When the lease ended (if ended) */
  endedAt?: Date;
  /** Whether user terminated early */
  terminatedEarly: boolean;
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

  // From user history (may be empty - stub in Story 2.3)
  /** User's lease history for last 30-90 days */
  userLeaseHistory: LeaseHistoryRecord[];

  // From org history (may be empty - stub in Story 2.3)
  /** Organization (domain) lease history */
  orgLeaseHistory: LeaseHistoryRecord[];

  // From domain verification (always false in Story 2.3)
  /** Whether domain is in verified gov domains list */
  isVerifiedGovDomain: boolean;

  // From AI analysis (undefined in Story 2.3)
  /** AI analysis of email/domain - only available in Epic 3+ */
  aiAnalysis?: AIAnalysisResult;
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
