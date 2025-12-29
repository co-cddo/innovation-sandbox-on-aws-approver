/**
 * Account Cooldown Logic
 *
 * Determines which sandbox accounts are ready for lease assignment.
 * Implements 24-hour cooldown for billing separation and new account grace period.
 *
 * Rationale for 24-hour cooldown (5 Whys: Billing Separation):
 * - AWS Cost Explorer aggregates by day
 * - 24-hour gap ensures distinct billing days per user
 * - Makes cost attribution unambiguous
 * - Prevents billing disputes between sequential users
 */

import type { Account } from './types.js';

/**
 * Configuration for account cooldown logic
 */
export interface AccountCooldownConfig {
  /** Hours an account must cool before reuse (default: 24) */
  readonly cooldownHours: number;
  /** Minutes a new account is considered ready without cooldown (default: 60) */
  readonly newAccountGraceMinutes: number;
}

/**
 * Default cooldown configuration
 */
export const DEFAULT_COOLDOWN_CONFIG: AccountCooldownConfig = {
  cooldownHours: 24,
  newAccountGraceMinutes: 60,
};

/**
 * Result from checking account readiness
 */
export interface AccountReadinessResult {
  /** Whether at least one account is ready for assignment */
  readonly hasReadyAccount: boolean;
  /** Accounts that are ready for immediate assignment */
  readonly readyAccounts: Account[];
  /** Available accounts still in cooldown period */
  readonly coolingAccounts: Account[];
  /** Accounts currently in use (status = Active) */
  readonly activeAccounts: Account[];
  /** Estimated time when first cooling account will be ready (null if none) */
  readonly estimatedReadyTime: Date | null;
}

/**
 * Read cooldown configuration from environment variables
 */
export const getConfigFromEnvironment = (): AccountCooldownConfig => {
  const cooldownHours = parseInt(process.env.ACCOUNT_COOLDOWN_HOURS ?? '', 10);
  const newAccountGraceMinutes = parseInt(process.env.NEW_ACCOUNT_GRACE_MINUTES ?? '', 10);

  return {
    cooldownHours: Number.isFinite(cooldownHours)
      ? cooldownHours
      : DEFAULT_COOLDOWN_CONFIG.cooldownHours,
    newAccountGraceMinutes: Number.isFinite(newAccountGraceMinutes)
      ? newAccountGraceMinutes
      : DEFAULT_COOLDOWN_CONFIG.newAccountGraceMinutes,
  };
};

/**
 * Check if a single account is ready for assignment.
 *
 * An account is ready if:
 * 1. status === 'Available' AND
 * 2. Either:
 *    a. meta.lastEditTime > 24 hours ago (cooled down), OR
 *    b. meta.createdTime < 1 hour ago (brand new)
 *
 * @param account - The account to check
 * @param nowTimestamp - Current timestamp (injected for testability)
 * @param config - Cooldown configuration
 * @returns Whether the account is ready
 */
export const isAccountReady = (
  account: Account,
  nowTimestamp: Date,
  config: AccountCooldownConfig = DEFAULT_COOLDOWN_CONFIG
): boolean => {
  // Must be Available status
  if (account.status !== 'Available') {
    return false;
  }

  const lastEditTime = new Date(account.meta.lastEditTime);
  const createdTime = new Date(account.meta.createdTime);
  const nowMs = nowTimestamp.getTime();

  const cooldownMs = config.cooldownHours * 60 * 60 * 1000;
  const graceMs = config.newAccountGraceMinutes * 60 * 1000;

  const timeSinceLastEdit = nowMs - lastEditTime.getTime();
  const timeSinceCreation = nowMs - createdTime.getTime();

  // Brand new account: ready if created within grace period
  if (timeSinceCreation < graceMs) {
    return true;
  }

  // Otherwise: ready if cooldown period has passed
  return timeSinceLastEdit >= cooldownMs;
};

/**
 * Calculate when an account in cooldown will become ready.
 *
 * @param account - The account in cooldown
 * @param config - Cooldown configuration
 * @returns Date when the account will be ready
 */
export const calculateReadyTime = (
  account: Account,
  config: AccountCooldownConfig = DEFAULT_COOLDOWN_CONFIG
): Date => {
  const lastEditTime = new Date(account.meta.lastEditTime);
  const cooldownMs = config.cooldownHours * 60 * 60 * 1000;
  return new Date(lastEditTime.getTime() + cooldownMs);
};

/**
 * Check readiness of all accounts and categorize them.
 *
 * Pure function - no side effects. Accepts nowTimestamp for testability.
 *
 * @param accounts - All accounts from ISB
 * @param nowTimestamp - Current timestamp (injected for testability)
 * @param config - Cooldown configuration
 * @returns Categorized accounts with readiness status
 */
export const checkAccountReadiness = (
  accounts: Account[],
  nowTimestamp: Date,
  config: AccountCooldownConfig = DEFAULT_COOLDOWN_CONFIG
): AccountReadinessResult => {
  const readyAccounts: Account[] = [];
  const coolingAccounts: Account[] = [];
  const activeAccounts: Account[] = [];

  for (const account of accounts) {
    if (account.status === 'Active') {
      activeAccounts.push(account);
    } else if (isAccountReady(account, nowTimestamp, config)) {
      readyAccounts.push(account);
    } else {
      // Available but in cooldown
      coolingAccounts.push(account);
    }
  }

  // Calculate estimated ready time from soonest cooling account
  let estimatedReadyTime: Date | null = null;
  if (coolingAccounts.length > 0) {
    const readyTimes = coolingAccounts.map((acc) => calculateReadyTime(acc, config));
    const soonest = Math.min(...readyTimes.map((d) => d.getTime()));
    estimatedReadyTime = new Date(soonest);
  }

  return {
    hasReadyAccount: readyAccounts.length > 0,
    readyAccounts,
    coolingAccounts,
    activeAccounts,
    estimatedReadyTime,
  };
};
