/**
 * Lease Comments Message Builders (Story 5.1)
 *
 * Provides message templates for lease status updates with neutral language.
 * All messages include a reference number for tracking and clear next steps.
 *
 * @see FR33 - Update lease comments
 * @see FR34 - Neutral language
 * @see FR35 - Reference number format
 */

import type { ScoreBreakdown } from '../scoring/types.js';
import type { RuleResult } from '../state-machine/types.js';

/**
 * Default auto-approve threshold for messaging.
 */
const DEFAULT_THRESHOLD = 20;

/**
 * Converts a RuleResult array (from state machine) to ScoreBreakdown object.
 * This allows the message builders to work with both formats.
 *
 * @param ruleResults - Array of rule results from scoring engine
 * @returns ScoreBreakdown object mapping rule names to point values
 */
export const ruleResultsToBreakdown = (ruleResults: RuleResult[]): ScoreBreakdown => {
  return ruleResults.reduce<ScoreBreakdown>((acc, result) => {
    if (result.points !== 0) {
      acc[result.rule] = result.points;
    }
    return acc;
  }, {});
};

/**
 * Builds the message for an auto-approved lease request.
 *
 * @param score - The calculated risk score
 * @param referenceNumber - Reference in ISB-YYYY-NNNN format
 * @param threshold - Auto-approve threshold (default: 20)
 * @returns Formatted message string
 */
export const buildAutoApprovedMessage = (
  score: number,
  referenceNumber: string,
  threshold: number = DEFAULT_THRESHOLD
): string => {
  return [
    'Your lease request has been automatically approved.',
    `Score: ${score} (threshold: ${threshold})`,
    `Reference: ${referenceNumber}`,
  ].join('\n');
};

/**
 * Builds the message for an allow-list approved lease request.
 *
 * @param score - The calculated risk score (for reference only)
 * @param referenceNumber - Reference in ISB-YYYY-NNNN format
 * @returns Formatted message string
 */
export const buildAllowListApprovedMessage = (
  score: number,
  referenceNumber: string
): string => {
  return [
    'Your lease request has been automatically approved (ALLOW-LIST-OVERRIDE).',
    `Score: ${score} (for reference only)`,
    `Reference: ${referenceNumber}`,
  ].join('\n');
};

/**
 * Formats the score breakdown for display in messages.
 * Only includes rules with non-zero contribution.
 * Sorts by absolute impact (highest first).
 *
 * @param breakdown - Score breakdown object
 * @returns Formatted breakdown string with bullet points
 */
export const formatScoreBreakdown = (breakdown: ScoreBreakdown): string => {
  // Get entries with non-zero values
  const entries = Object.entries(breakdown)
    .filter(([_, value]) => value !== 0)
    // Sort by absolute value (highest impact first)
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a));

  if (entries.length === 0) {
    return '- No rules triggered';
  }

  return entries
    .map(([rule, value]) => {
      // Format value with sign
      const sign = value >= 0 ? '+' : '';
      return `- ${rule}: ${sign}${value}`;
    })
    .join('\n');
};

/**
 * Builds the message for an escalated (manual review required) lease request.
 * Uses neutral language to avoid appearing accusatory.
 *
 * @param score - The calculated risk score
 * @param scoreBreakdown - Breakdown of rule contributions
 * @param referenceNumber - Reference in ISB-YYYY-NNNN format
 * @param threshold - Auto-approve threshold (default: 20)
 * @returns Formatted message string
 */
export const buildEscalatedMessage = (
  score: number,
  scoreBreakdown: ScoreBreakdown,
  referenceNumber: string,
  threshold: number = DEFAULT_THRESHOLD
): string => {
  const breakdown = formatScoreBreakdown(scoreBreakdown);

  return [
    'Your lease request requires additional review.',
    `Score: ${score} (threshold: ${threshold})`,
    '',
    'Score breakdown:',
    breakdown,
    '',
    'Your request has been forwarded to the NDX team who may be in touch',
    'to discuss your requirements before approving.',
    `Reference: ${referenceNumber}`,
  ].join('\n');
};

/**
 * Builds the message for a delayed lease request (outside business hours).
 *
 * @param referenceNumber - Reference in ISB-YYYY-NNNN format
 * @returns Formatted message string
 */
export const buildDelayedMessage = (referenceNumber: string): string => {
  return [
    'Your lease request has been received. As it was submitted outside of our',
    'processing hours (7am-7pm London time, weekdays), it will be processed',
    'during the next available window.',
    `Reference: ${referenceNumber}`,
  ].join('\n');
};

/**
 * Builds the message for a queued lease request (no accounts available).
 *
 * @param queuePosition - Position in the queue
 * @param referenceNumber - Reference in ISB-YYYY-NNNN format
 * @returns Formatted message string
 */
export const buildQueuedMessage = (
  queuePosition: number,
  referenceNumber: string
): string => {
  return [
    'Your lease request has been received. All sandbox accounts are currently in use.',
    'Your request has been queued and will be processed when an account becomes available.',
    `Queue position: ${queuePosition}`,
    `Reference: ${referenceNumber}`,
  ].join('\n');
};

/**
 * Builds the message for an expired lease request (exceeded queue time limit).
 *
 * @param referenceNumber - Reference in ISB-YYYY-NNNN format
 * @param businessDays - Number of business days before expiry (default: 5)
 * @returns Formatted message string
 */
export const buildExpiredMessage = (
  referenceNumber: string,
  businessDays: number = 5
): string => {
  return [
    `Your lease request has expired after ${businessDays} business days in queue.`,
    'This may have occurred because no sandbox accounts were available.',
    'Please submit a new request if you still need access.',
    `Reference: ${referenceNumber}`,
  ].join('\n');
};
