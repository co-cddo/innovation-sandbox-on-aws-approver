/**
 * Queue Position Estimation (Story 6.3)
 *
 * Calculates estimated wait time and queue position for users
 * when no sandbox accounts are immediately available.
 *
 * The estimate is based on:
 * - Soonest cooling account ready time (lastEditTime + 24hr cooldown)
 * - Queue depth (each position adds ~4 hours rough estimate)
 */

import type { Account } from './types.js';
import { calculateReadyTime, DEFAULT_COOLDOWN_CONFIG } from './account-cooldown.js';
import type { AccountCooldownConfig } from './account-cooldown.js';

/**
 * Queue estimate result
 */
export interface QueueEstimate {
  /** Position in queue (1 = next in line) */
  readonly position: number;
  /** Estimated fulfillment time (null if cannot estimate) */
  readonly estimatedFulfillmentTime: Date | null;
  /** True if all accounts are Active (none cooling) */
  readonly isCapacityCrunch: boolean;
  /** Human-readable message for user */
  readonly message: string;
  /** Queue depth (total pending requests) */
  readonly queueDepth: number;
}

/**
 * Average hours between account readiness events.
 * Used to estimate wait time per queue position.
 *
 * With 8 accounts and 24hr cooldown:
 * - Steady state: ~3 accounts become ready per day
 * - Average wait per position: ~8 hours (conservative estimate)
 *
 * Using 4 hours to account for:
 * - Variable lease durations
 * - Early terminations
 * - New account provisioning
 */
const HOURS_PER_QUEUE_POSITION = 4;

/**
 * Format date for user-friendly display.
 * e.g., "Tuesday 2:00 PM GMT"
 */
const formatUserFriendlyDate = (date: Date): string => {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: 'Europe/London', // UK time for UK users
  };

  return date.toLocaleString('en-GB', options);
};

/**
 * Build user-friendly message for queue delay.
 * Avoids technical jargon like "cooldown".
 */
const buildQueueMessage = (
  position: number,
  estimatedTime: Date | null,
  isCapacityCrunch: boolean
): string => {
  const lines: string[] = [];

  if (isCapacityCrunch) {
    lines.push(
      'Your request has been received. All sandbox sessions are currently in active use.',
      'Based on current demand, your request may take 36-48 hours to fulfill.',
      "Our team is aware of high demand. You'll be notified as soon as a session becomes available."
    );
  } else {
    lines.push(
      'Your request has been received. No sandbox sessions are currently available -',
      'all accounts are undergoing routine maintenance.'
    );

    if (estimatedTime) {
      const formattedTime = formatUserFriendlyDate(estimatedTime);
      lines.push(
        `Based on current queue (position ${position}) and account availability,`,
        `your request should be fulfilled around ${formattedTime}.`
      );
    } else {
      lines.push(`Your request is position ${position} in queue.`);
    }

    lines.push('This estimate may change based on demand.');
  }

  return lines.join('\n');
};

/**
 * Options for calculating queue estimate
 */
export interface CalculateQueueEstimateOptions {
  /** Override capacity crunch detection (useful when account arrays unavailable) */
  isCapacityCrunchOverride?: boolean;
}

/**
 * Calculate queue estimate for a user whose request is being delayed.
 *
 * Pure function - accepts all inputs as parameters for testability.
 *
 * @param coolingAccounts - Accounts that are Available but in cooldown
 * @param activeAccounts - Accounts that are currently Active (in use)
 * @param queuePosition - User's position in queue (1-based)
 * @param queueDepth - Total pending requests in queue
 * @param nowTimestamp - Current time (injected for testability)
 * @param config - Cooldown configuration
 * @param options - Optional overrides for calculated values
 * @returns Queue estimate with position and estimated fulfillment time
 */
export const calculateQueueEstimate = (
  coolingAccounts: Account[],
  activeAccounts: Account[],
  queuePosition: number,
  queueDepth: number,
  nowTimestamp: Date,
  config: AccountCooldownConfig = DEFAULT_COOLDOWN_CONFIG,
  options?: CalculateQueueEstimateOptions
): QueueEstimate => {
  // Detect capacity crunch: all accounts active, none cooling
  // Allow override when account arrays are not available (e.g., handler context)
  const isCapacityCrunch =
    options?.isCapacityCrunchOverride ?? (coolingAccounts.length === 0 && activeAccounts.length > 0);

  // Calculate soonest ready time from cooling accounts
  let estimatedFulfillmentTime: Date | null = null;

  if (coolingAccounts.length > 0) {
    // Find the soonest cooling account ready time
    const readyTimes = coolingAccounts.map((acc) => calculateReadyTime(acc, config));
    const soonestReadyMs = Math.min(...readyTimes.map((d) => d.getTime()));

    // Add wait time based on queue position
    // Position 1 = next in line, no additional wait
    // Position 2 = wait for position 1, etc.
    const positionDelayMs = (queuePosition - 1) * HOURS_PER_QUEUE_POSITION * 60 * 60 * 1000;

    // But also account for when we are relative to now
    // If soonestReady is in the past (shouldn't happen but safety), use now
    const baseTimeMs = Math.max(soonestReadyMs, nowTimestamp.getTime());
    estimatedFulfillmentTime = new Date(baseTimeMs + positionDelayMs);
  }

  // Build user-friendly message
  const message = buildQueueMessage(queuePosition, estimatedFulfillmentTime, isCapacityCrunch);

  return {
    position: queuePosition,
    estimatedFulfillmentTime,
    isCapacityCrunch,
    message,
    queueDepth,
  };
};

/**
 * Build formatted message with reference number for lease comments.
 * Combines queue estimate message with reference number.
 */
export const buildQueueEstimateComment = (estimate: QueueEstimate, referenceNumber: string): string => {
  return `${estimate.message}\nReference: ${referenceNumber}`;
};
