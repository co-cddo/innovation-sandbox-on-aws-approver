/**
 * Capacity Crunch Detection (Story 6.4)
 *
 * Detects when all sandbox accounts are in active use (none available or cooling).
 * This is distinct from normal cooldown where some accounts are Available but cooling.
 *
 * When capacity crunch is detected:
 * - Users see a 36-48 hour wait estimate
 * - Operators receive Slack alert (throttled to 1 per hour)
 */

import type { AccountReadinessResult } from './account-cooldown.js';

/**
 * Capacity status of the account pool
 */
export interface CapacityStatus {
  /** True if all accounts are Active (capacity crunch) */
  readonly isCapacityCrunch: boolean;
  /** Total number of accounts */
  readonly totalAccounts: number;
  /** Accounts currently in use */
  readonly activeCount: number;
  /** Accounts available (ready or cooling) */
  readonly availableCount: number;
  /** Ready accounts (cooled down, can be assigned) */
  readonly readyCount: number;
  /** Cooling accounts (available but in 24hr cooldown) */
  readonly coolingCount: number;
  /** Pending requests in queue */
  readonly pendingRequests: number;
  /** Estimated hours until soonest account ready (null if unknown) */
  readonly soonestAvailableHours: number | null;
}

/**
 * Slack alert payload for capacity crunch
 */
export interface CapacityCrunchAlert {
  readonly alertType: 'capacity_crunch';
  readonly activeAccounts: number;
  readonly availableAccounts: number;
  readonly pendingRequests: number;
  readonly soonestAvailableHours: number | null;
  readonly message: string;
}

/**
 * Analyze account pool and determine capacity status.
 *
 * @param readinessResult - Result from checkAccountReadiness()
 * @param pendingRequests - Number of pending requests in queue
 * @param nowTimestamp - Current time for calculations
 * @returns Capacity status analysis
 */
export const analyzeCapacityStatus = (
  readinessResult: AccountReadinessResult,
  pendingRequests: number = 0,
  nowTimestamp: Date = new Date()
): CapacityStatus => {
  const { readyAccounts, coolingAccounts, activeAccounts, estimatedReadyTime } = readinessResult;

  const totalAccounts = readyAccounts.length + coolingAccounts.length + activeAccounts.length;
  const availableCount = readyAccounts.length + coolingAccounts.length;

  // Capacity crunch: All accounts are Active, none Available
  const isCapacityCrunch = availableCount === 0 && activeAccounts.length > 0;

  // Calculate hours until soonest ready
  let soonestAvailableHours: number | null = null;
  if (estimatedReadyTime) {
    const hoursUntilReady = (estimatedReadyTime.getTime() - nowTimestamp.getTime()) / (60 * 60 * 1000);
    soonestAvailableHours = Math.max(0, Math.round(hoursUntilReady * 10) / 10); // Round to 1 decimal
  }

  return {
    isCapacityCrunch,
    totalAccounts,
    activeCount: activeAccounts.length,
    availableCount,
    readyCount: readyAccounts.length,
    coolingCount: coolingAccounts.length,
    pendingRequests,
    soonestAvailableHours,
  };
};

/**
 * Check if a capacity crunch alert should be sent.
 *
 * Alert throttling: Only send one alert per hour to avoid spam.
 *
 * @param isCapacityCrunch - Whether capacity crunch is currently detected
 * @param lastAlertTime - Last time an alert was sent (null if never)
 * @param nowTimestamp - Current time
 * @param throttleMinutes - Minutes between alerts (default: 60)
 * @returns Whether an alert should be sent
 */
export const shouldSendCapacityCrunchAlert = (
  isCapacityCrunch: boolean,
  lastAlertTime: Date | null,
  nowTimestamp: Date = new Date(),
  throttleMinutes: number = 60
): boolean => {
  if (!isCapacityCrunch) {
    return false;
  }

  if (!lastAlertTime) {
    return true; // Never sent, should send now
  }

  const timeSinceLastAlert = nowTimestamp.getTime() - lastAlertTime.getTime();
  const throttleMs = throttleMinutes * 60 * 1000;

  return timeSinceLastAlert >= throttleMs;
};

/**
 * Build capacity crunch alert payload for Slack.
 *
 * @param status - Capacity status analysis
 * @returns Alert payload for Slack webhook
 */
export const buildCapacityCrunchAlert = (status: CapacityStatus): CapacityCrunchAlert => {
  const hoursText =
    status.soonestAvailableHours !== null ? `~${status.soonestAvailableHours} hours` : 'unknown';

  return {
    alertType: 'capacity_crunch',
    activeAccounts: status.activeCount,
    availableAccounts: status.availableCount,
    pendingRequests: status.pendingRequests,
    soonestAvailableHours: status.soonestAvailableHours,
    message: `All sandbox accounts are in active use (${status.activeCount}/${status.totalAccounts}). ` +
      `${status.pendingRequests} pending requests. ` +
      `Soonest availability in ${hoursText}. Consider provisioning additional capacity.`,
  };
};

/**
 * Build user-facing message for capacity crunch delay.
 *
 * Uses jargon-free language and sets expectations for longer wait.
 *
 * @param referenceNumber - Reference in ISB-YYYY-NNNN format
 * @returns Formatted message string
 */
export const buildCapacityCrunchMessage = (referenceNumber: string): string => {
  return [
    'Your request has been received. All sandbox sessions are currently in active use.',
    'Based on current demand, your request may take 36-48 hours to fulfill.',
    "Our team is aware of high demand. You'll be notified as soon as a session becomes available.",
    `Reference: ${referenceNumber}`,
  ].join('\n');
};
