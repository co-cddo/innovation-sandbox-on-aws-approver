/**
 * Capacity Crunch Detection (Story 6.4)
 *
 * Detects when all sandbox accounts are in active use (none available).
 * ISB's Billing Separator handles the 72-hour cooldown via Quarantine OU,
 * so we only see accounts that are truly available or active.
 *
 * When capacity crunch is detected:
 * - Users see a high-demand message
 * - Operators receive Slack alert (throttled to 1 per hour)
 */

/**
 * Input for capacity analysis - simple counts from ISB
 */
export interface AccountCounts {
  /** Accounts available for assignment */
  readonly availableCount: number;
  /** Accounts currently in use */
  readonly activeCount: number;
}

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
  /** Accounts available for assignment */
  readonly availableCount: number;
  /** Pending requests in queue */
  readonly pendingRequests: number;
}

/**
 * Slack alert payload for capacity crunch
 */
export interface CapacityCrunchAlert {
  readonly alertType: 'capacity_crunch';
  readonly activeAccounts: number;
  readonly availableAccounts: number;
  readonly pendingRequests: number;
  readonly message: string;
}

/**
 * Analyze account pool and determine capacity status.
 *
 * @param accountCounts - Available and active account counts from ISB
 * @param pendingRequests - Number of pending requests in queue
 * @returns Capacity status analysis
 */
export const analyzeCapacityStatus = (
  accountCounts: AccountCounts,
  pendingRequests: number = 0
): CapacityStatus => {
  const { availableCount, activeCount } = accountCounts;
  const totalAccounts = availableCount + activeCount;

  // Capacity crunch: All accounts are Active, none Available
  const isCapacityCrunch = availableCount === 0 && activeCount > 0;

  return {
    isCapacityCrunch,
    totalAccounts,
    activeCount,
    availableCount,
    pendingRequests,
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
  return {
    alertType: 'capacity_crunch',
    activeAccounts: status.activeCount,
    availableAccounts: status.availableCount,
    pendingRequests: status.pendingRequests,
    message:
      `All sandbox accounts are in active use (${status.activeCount}/${status.totalAccounts}). ` +
      `${status.pendingRequests} pending requests. Consider provisioning additional capacity.`,
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
    "You'll be notified as soon as a session becomes available.",
    `Reference: ${referenceNumber}`,
  ].join('\n');
};
