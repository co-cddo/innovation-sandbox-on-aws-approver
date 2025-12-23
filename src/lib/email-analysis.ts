/**
 * Email Analysis Utility
 *
 * Rule-based fallback for email pattern analysis when Bedrock is unavailable.
 * Story 3.4: Bedrock AI Email Analysis with Circuit Breaker
 *
 * Features:
 * - Group mailbox prefix detection (FR14)
 * - Returns consistent AIAnalysisResult shape
 * - Case-insensitive matching
 */

import type { AIAnalysisResult } from '../scoring/types.js';

/**
 * Common group mailbox prefixes.
 * Emails starting with these patterns are likely shared/team mailboxes.
 */
export const GROUP_MAILBOX_PREFIXES = [
  'team',
  'info',
  'contact',
  'admin',
  'support',
  'helpdesk',
  'enquiries',
  'office',
  'reception',
  'general',
  'hello',
  'mail',
  'post',
  'shared',
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
] as const;

/**
 * UK local government domain patterns.
 * Used for rule-based local gov detection when AI is unavailable.
 */
const UK_LOCAL_GOV_PATTERNS = [
  '.gov.uk',
  '.council.gov.uk',
  '.gov.scot',
  '.gov.wales',
  '.police.uk',
  '.nhs.uk',
  '.ac.uk',
  '.sch.uk',
] as const;

/**
 * Check if an email prefix matches a group mailbox pattern.
 *
 * @param email - Email address to check
 * @returns true if the prefix matches a group mailbox pattern
 */
export const isLikelyGroupMailbox = (email: string): boolean => {
  const prefix = email.split('@')[0]?.toLowerCase() ?? '';

  // Check if prefix starts with any group mailbox pattern
  return GROUP_MAILBOX_PREFIXES.some((pattern) => prefix.startsWith(pattern));
};

/**
 * Check if an email domain appears to be UK government-related.
 * This is a simple heuristic for rule-based fallback, not authoritative.
 *
 * @param email - Email address to check
 * @returns true if the domain looks like UK government
 */
export const isLikelyUKGovernment = (email: string): boolean => {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';

  // Check if domain ends with any UK gov pattern
  return UK_LOCAL_GOV_PATTERNS.some((pattern) => domain.endsWith(pattern));
};

/**
 * Analyze email pattern using rule-based heuristics.
 * Used as fallback when Bedrock AI is unavailable.
 *
 * @param email - Email address to analyze
 * @returns AIAnalysisResult with group mailbox detection
 */
export const analyzeEmailPattern = (email: string): AIAnalysisResult => {
  const isGroupMailbox = isLikelyGroupMailbox(email);

  return {
    isGroupMailbox,
    confidence: isGroupMailbox ? 0.7 : 0.5,
  };
};

/**
 * Get the matching group mailbox prefix for logging purposes.
 * Returns the matched prefix or undefined if no match.
 *
 * @param email - Email address to check
 * @returns The matched prefix pattern, or undefined
 */
export const getMatchedGroupMailboxPrefix = (email: string): string | undefined => {
  const prefix = email.split('@')[0]?.toLowerCase() ?? '';

  return GROUP_MAILBOX_PREFIXES.find((pattern) => prefix.startsWith(pattern));
};
