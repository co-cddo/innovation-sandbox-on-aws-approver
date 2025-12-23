/**
 * Scoring Rules Implementation
 *
 * All 16 rules as pure functions per architecture.md.
 * Each rule: (context, weight) => ScoringRuleResult
 */

import type { RuleId, ScoringRuleFn, LeaseHistoryRecord } from './types.js';
import { isWithinDays } from '../services/dynamodb.js';

/**
 * Successful lease statuses that indicate responsible completion.
 * These include Active (currently running), Expired (ran full duration),
 * and ManuallyTerminated (user responsibly ended early).
 */
const SUCCESSFUL_STATUSES: LeaseHistoryRecord['status'][] = [
  'Active',
  'Expired',
  'ManuallyTerminated',
];

/**
 * Rule 1: expired_leases
 * +weight for each expired lease in last 30 days
 */
export const expiredLeasesRule: ScoringRuleFn = (context, weight) => {
  const expiredCount = context.userLeaseHistory.filter(
    (l) => l.status === 'Expired' && isWithinDays(l.created, 30, context.requestTimestamp)
  ).length;

  return {
    ruleId: 'expired_leases',
    points: expiredCount * weight,
    triggered: expiredCount > 0,
    reason: expiredCount > 0 ? `${expiredCount} expired lease(s) in last 30 days` : undefined,
  };
};

/**
 * Rule 2: budget_exceeded
 * +weight for each budget exceeded lease in last 30 days
 */
export const budgetExceededRule: ScoringRuleFn = (context, weight) => {
  const exceededCount = context.userLeaseHistory.filter(
    (l) => l.status === 'BudgetExceeded' && isWithinDays(l.created, 30, context.requestTimestamp)
  ).length;

  return {
    ruleId: 'budget_exceeded',
    points: exceededCount * weight,
    triggered: exceededCount > 0,
    reason: exceededCount > 0 ? `${exceededCount} budget exceeded lease(s) in last 30 days` : undefined,
  };
};

/**
 * Rule 3: first_time_user
 * +weight for no previous leases in system
 */
export const firstTimeUserRule: ScoringRuleFn = (context, weight) => {
  const isFirstTime = context.userLeaseHistory.length === 0;

  return {
    ruleId: 'first_time_user',
    points: isFirstTime ? weight : 0,
    triggered: isFirstTime,
    reason: isFirstTime ? 'No previous leases found' : undefined,
  };
};

/**
 * Rule 4: first_time_suspicious
 * +weight for first lease AND group mailbox pattern (AI-detected)
 * Skips if no AI analysis available
 */
export const firstTimeSuspiciousRule: ScoringRuleFn = (context, weight) => {
  // Skip if no AI analysis available
  if (!context.aiAnalysis) {
    return {
      ruleId: 'first_time_suspicious',
      points: 0,
      triggered: false,
      fallbackUsed: true,
      reason: 'AI analysis not available',
    };
  }

  const isFirstTime = context.userLeaseHistory.length === 0;
  const isGroupMailbox = context.aiAnalysis.isGroupMailbox;
  const isSuspicious = isFirstTime && isGroupMailbox;

  return {
    ruleId: 'first_time_suspicious',
    points: isSuspicious ? weight : 0,
    triggered: isSuspicious,
    reason: isSuspicious ? 'First-time user with group mailbox detected' : undefined,
  };
};

/**
 * Rule 5: verified_gov_domain
 * -weight (bonus) if domain in ukps-domains allowlist
 */
export const verifiedGovDomainRule: ScoringRuleFn = (context, weight) => {
  const isVerified = context.isVerifiedGovDomain;

  return {
    ruleId: 'verified_gov_domain',
    points: isVerified ? weight : 0, // weight is negative for bonus
    triggered: isVerified,
    reason: isVerified ? 'Domain verified in gov allowlist' : undefined,
  };
};

/**
 * Rule 6: familiar_template
 * -weight (bonus) for previously used this template successfully
 * "Successful" means Active, Expired, or ManuallyTerminated (not budget exceeded or denied)
 */
export const familiarTemplateRule: ScoringRuleFn = (context, weight) => {
  const hasFamiliarTemplate = context.userLeaseHistory.some(
    (l) =>
      l.originalLeaseTemplateUuid === context.templateId &&
      SUCCESSFUL_STATUSES.includes(l.status)
  );

  return {
    ruleId: 'familiar_template',
    points: hasFamiliarTemplate ? weight : 0, // weight is negative for bonus
    triggered: hasFamiliarTemplate,
    reason: hasFamiliarTemplate ? 'Previously used this template successfully' : undefined,
  };
};

/**
 * Rule 7: template_hopper
 * +weight if 3+ leases and never repeated a template
 */
export const templateHopperRule: ScoringRuleFn = (context, weight) => {
  const history = context.userLeaseHistory;

  // Need 3+ previous leases to be a template hopper
  if (history.length < 3) {
    return {
      ruleId: 'template_hopper',
      points: 0,
      triggered: false,
    };
  }

  // Check if any template was repeated (including current request)
  const allTemplates = [...history.map((l) => l.originalLeaseTemplateUuid), context.templateId];
  const uniqueTemplates = new Set(allTemplates);
  const isHopper = uniqueTemplates.size === allTemplates.length;

  return {
    ruleId: 'template_hopper',
    points: isHopper ? weight : 0,
    triggered: isHopper,
    reason: isHopper ? `${history.length}+ leases with all different templates` : undefined,
  };
};

/**
 * Rule 8: budget_amount
 * +weight per $10 of budget
 */
export const budgetAmountRule: ScoringRuleFn = (context, weight) => {
  const units = Math.floor(context.budgetAmount / 10);

  return {
    ruleId: 'budget_amount',
    points: units * weight,
    triggered: units > 0,
    reason: units > 0 ? `Budget $${context.budgetAmount} (${units} × $10 units)` : undefined,
  };
};

/**
 * Rule 9: duration_requested
 * +weight per 8 hours of duration
 */
export const durationRequestedRule: ScoringRuleFn = (context, weight) => {
  const units = Math.floor(context.leaseDurationHours / 8);

  return {
    ruleId: 'duration_requested',
    points: units * weight,
    triggered: units > 0,
    reason: units > 0 ? `Duration ${context.leaseDurationHours}h (${units} × 8h units)` : undefined,
  };
};

/**
 * Check if time is in end-of-window (5-7pm London)
 * Handles both GMT and BST
 */
const isEndOfWindow = (date: Date): boolean => {
  // Convert to London time
  const londonTime = new Date(date.toLocaleString('en-US', { timeZone: 'Europe/London' }));
  const hour = londonTime.getHours();

  // 5pm-7pm London = hours 17, 18
  return hour >= 17 && hour < 19;
};

/**
 * Rule 10: end_of_window
 * -weight (bonus) for request in final 2 hours (5-7pm London)
 */
export const endOfWindowRule: ScoringRuleFn = (context, weight) => {
  const inEndOfWindow = isEndOfWindow(context.requestTimestamp);

  return {
    ruleId: 'end_of_window',
    points: inEndOfWindow ? weight : 0, // weight is negative for bonus
    triggered: inEndOfWindow,
    reason: inEndOfWindow ? 'Request in final 2 hours of business day' : undefined,
  };
};

/**
 * Rule 11: cooldown_violation
 * +weight if request within 1hr of previous lease creation
 * Uses 'created' timestamp since we want to detect rapid re-requests
 */
export const cooldownViolationRule: ScoringRuleFn = (context, weight) => {
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const history = context.userLeaseHistory;

  // No history means no cooldown violation
  if (history.length === 0) {
    return {
      ruleId: 'cooldown_violation',
      points: 0,
      triggered: false,
    };
  }

  // Find the most recently created lease
  const sorted = [...history].sort(
    (a, b) => new Date(b.created).getTime() - new Date(a.created).getTime()
  );
  const mostRecent = sorted[0];

  // Calculate time since most recent lease creation
  const mostRecentTime = new Date(mostRecent.created).getTime();
  const timeSinceCreation = context.requestTimestamp.getTime() - mostRecentTime;
  const isViolation = timeSinceCreation < ONE_HOUR_MS && timeSinceCreation >= 0;

  return {
    ruleId: 'cooldown_violation',
    points: isViolation ? weight : 0,
    triggered: isViolation,
    reason: isViolation
      ? `Request ${Math.round(timeSinceCreation / 60000)} minutes after previous lease`
      : undefined,
  };
};

/**
 * Rule 12: outside_target_audience
 * +weight if AI determines domain is not local gov
 * Skips if no AI analysis available
 */
export const outsideTargetAudienceRule: ScoringRuleFn = (context, weight) => {
  // Skip if no AI analysis available
  if (!context.aiAnalysis) {
    return {
      ruleId: 'outside_target_audience',
      points: 0,
      triggered: false,
      fallbackUsed: true,
      reason: 'AI analysis not available',
    };
  }

  const isOutside = context.aiAnalysis.isOutsideTargetAudience;

  return {
    ruleId: 'outside_target_audience',
    points: isOutside ? weight : 0,
    triggered: isOutside,
    reason: isOutside ? 'Domain identified as outside target audience' : undefined,
  };
};

/**
 * Rule 13: manual_early_termination
 * -weight (bonus) for each manually terminated lease in last 90 days
 * ManuallyTerminated indicates responsible behavior (user ended early)
 */
export const manualEarlyTerminationRule: ScoringRuleFn = (context, weight) => {
  const earlyTerminationCount = context.userLeaseHistory.filter(
    (l) => l.status === 'ManuallyTerminated' && isWithinDays(l.created, 90, context.requestTimestamp)
  ).length;

  // Avoid -0 by using explicit 0 when not triggered
  const points = earlyTerminationCount > 0 ? earlyTerminationCount * weight : 0;

  return {
    ruleId: 'manual_early_termination',
    points,
    triggered: earlyTerminationCount > 0,
    reason:
      earlyTerminationCount > 0
        ? `${earlyTerminationCount} early termination(s) in last 90 days (responsible behavior)`
        : undefined,
  };
};

/**
 * Negative outcome statuses - used for org-level rules.
 * BudgetExceeded and Expired indicate problematic behavior.
 */
const NEGATIVE_STATUSES: LeaseHistoryRecord['status'][] = ['BudgetExceeded', 'Expired'];

/**
 * Rule 14: org_recent_negative
 * +weight if OTHER users at same domain had negative outcomes in last 30 days (FR19, FR20)
 * Note: orgLeaseHistory already excludes current user's leases
 */
export const orgRecentNegativeRule: ScoringRuleFn = (context, weight) => {
  const recentNegative = context.orgLeaseHistory.filter(
    (l) =>
      NEGATIVE_STATUSES.includes(l.status) && isWithinDays(l.created, 30, context.requestTimestamp)
  );

  const hasNegative = recentNegative.length > 0;

  return {
    ruleId: 'org_recent_negative',
    points: hasNegative ? weight : 0,
    triggered: hasNegative,
    reason: hasNegative
      ? `Organization has ${recentNegative.length} negative outcome(s) in last 30 days`
      : undefined,
  };
};

/**
 * Rule 15: org_clean_record
 * -weight (bonus) if domain has 5+ leases in last 90 days with zero negative outcomes
 * Note: orgLeaseHistory already excludes current user's leases
 */
export const orgCleanRecordRule: ScoringRuleFn = (context, weight) => {
  // Filter to last 90 days
  const recentOrgHistory = context.orgLeaseHistory.filter((l) =>
    isWithinDays(l.created, 90, context.requestTimestamp)
  );

  // Need 5+ leases for this rule to apply (AC4)
  if (recentOrgHistory.length < 5) {
    return {
      ruleId: 'org_clean_record',
      points: 0,
      triggered: false,
    };
  }

  // Check for any negative outcomes
  const hasNegative = recentOrgHistory.some((l) => NEGATIVE_STATUSES.includes(l.status));
  const isClean = !hasNegative;

  return {
    ruleId: 'org_clean_record',
    points: isClean ? weight : 0, // weight is negative for bonus
    triggered: isClean,
    reason: isClean
      ? `Organization has clean record (${recentOrgHistory.length} leases, 0 negative)`
      : undefined,
  };
};

/**
 * Rule 16: group_mailbox_detected
 * +weight if AI detected group email pattern
 * Skips if no AI analysis available
 */
export const groupMailboxDetectedRule: ScoringRuleFn = (context, weight) => {
  // Skip if no AI analysis available
  if (!context.aiAnalysis) {
    return {
      ruleId: 'group_mailbox_detected',
      points: 0,
      triggered: false,
      fallbackUsed: true,
      reason: 'AI analysis not available',
    };
  }

  const isGroup = context.aiAnalysis.isGroupMailbox;

  return {
    ruleId: 'group_mailbox_detected',
    points: isGroup ? weight : 0,
    triggered: isGroup,
    reason: isGroup ? 'Group mailbox pattern detected' : undefined,
  };
};

/**
 * All rules with their IDs for iteration
 */
export interface RuleDefinition {
  ruleId: RuleId;
  fn: ScoringRuleFn;
}

export const ALL_RULES: RuleDefinition[] = [
  { ruleId: 'expired_leases', fn: expiredLeasesRule },
  { ruleId: 'budget_exceeded', fn: budgetExceededRule },
  { ruleId: 'first_time_user', fn: firstTimeUserRule },
  { ruleId: 'first_time_suspicious', fn: firstTimeSuspiciousRule },
  { ruleId: 'verified_gov_domain', fn: verifiedGovDomainRule },
  { ruleId: 'familiar_template', fn: familiarTemplateRule },
  { ruleId: 'template_hopper', fn: templateHopperRule },
  { ruleId: 'budget_amount', fn: budgetAmountRule },
  { ruleId: 'duration_requested', fn: durationRequestedRule },
  { ruleId: 'end_of_window', fn: endOfWindowRule },
  { ruleId: 'cooldown_violation', fn: cooldownViolationRule },
  { ruleId: 'outside_target_audience', fn: outsideTargetAudienceRule },
  { ruleId: 'manual_early_termination', fn: manualEarlyTerminationRule },
  { ruleId: 'org_recent_negative', fn: orgRecentNegativeRule },
  { ruleId: 'org_clean_record', fn: orgCleanRecordRule },
  { ruleId: 'group_mailbox_detected', fn: groupMailboxDetectedRule },
];
