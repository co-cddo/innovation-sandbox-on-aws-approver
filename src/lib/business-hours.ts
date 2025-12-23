/**
 * Business Hours Utilities
 *
 * Provides timezone-aware business hours detection for UK (Europe/London).
 * Handles BST/GMT transitions automatically via JavaScript's Intl API.
 *
 * Business hours: 7am-7pm London time, Monday-Friday, excluding UK bank holidays.
 */

import type { BankHolidayService } from '../services/bank-holidays.js';

export interface BusinessHoursConfig {
  /** Start hour in 24h format (default: 7) */
  startHour: number;
  /** End hour in 24h format (default: 19) */
  endHour: number;
  /** IANA timezone (default: Europe/London) */
  timezone: string;
}

export interface BusinessHoursResult {
  /** Whether the given time is within business hours */
  isWithinBusinessHours: boolean;
  /** Whether the given time is in end-of-window period (5pm-7pm) */
  isEndOfWindow: boolean;
  /** Current London time as ISO string */
  londonTime: string;
  /** Current hour in London (0-23) */
  londonHour: number;
  /** Current day of week (0=Sunday, 6=Saturday) */
  dayOfWeek: number;
  /** Whether today is a bank holiday */
  isBankHoliday: boolean;
  /** If outside business hours, next processing time */
  nextProcessingTime?: string;
}

const DEFAULT_CONFIG: BusinessHoursConfig = {
  startHour: 7,
  endHour: 19,
  timezone: 'Europe/London',
};

/**
 * Get the current hour and day in the specified timezone
 */
export function getLondonTime(date: Date, timezone: string): { hour: number; minute: number; dayOfWeek: number; dateString: string } {
  // Get date parts in London timezone
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const getPart = (type: string): string => parts.find(p => p.type === type)?.value ?? '';

  const hour = parseInt(getPart('hour'), 10);
  const minute = parseInt(getPart('minute'), 10);
  const weekday = getPart('weekday');

  // Convert weekday string to number (0=Sunday)
  const weekdayMap: Record<string, number> = {
    'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6,
  };
  const dayOfWeek = weekdayMap[weekday] ?? 0;

  // Build date string for holiday checking (YYYY-MM-DD)
  const year = getPart('year');
  const month = getPart('month');
  const day = getPart('day');
  const dateString = `${year}-${month}-${day}`;

  return { hour, minute, dayOfWeek, dateString };
}

/**
 * Check if a day is a weekday (Monday-Friday)
 */
export function isWeekday(dayOfWeek: number): boolean {
  return dayOfWeek >= 1 && dayOfWeek <= 5;
}

/**
 * Check if time is within the end-of-window period (5pm-7pm)
 */
export function isEndOfWindow(hour: number, config: BusinessHoursConfig = DEFAULT_CONFIG): boolean {
  const endOfWindowStart = config.endHour - 2; // 5pm when endHour is 7pm
  return hour >= endOfWindowStart && hour < config.endHour;
}

/**
 * Calculate the next business hours start time
 */
export function getNextBusinessHoursStart(
  date: Date,
  bankHolidays: Set<string>,
  config: BusinessHoursConfig = DEFAULT_CONFIG
): Date {
  const result = new Date(date);
  const { hour, dayOfWeek, dateString } = getLondonTime(result, config.timezone);

  // If we're before start hour on a business day, next window is today
  if (isWeekday(dayOfWeek) && !bankHolidays.has(dateString) && hour < config.startHour) {
    // Set to start hour today
    result.setUTCHours(config.startHour, 0, 0, 0);
    // Adjust for London timezone offset (approximate - Intl handles DST)
    return result;
  }

  // Otherwise, find the next business day
  let daysToAdd = 1;
  let nextDate = new Date(result);

  while (daysToAdd <= 10) { // Safety limit
    nextDate = new Date(result.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
    const nextTime = getLondonTime(nextDate, config.timezone);

    if (isWeekday(nextTime.dayOfWeek) && !bankHolidays.has(nextTime.dateString)) {
      // Found a business day - set to start hour
      // Create a new date at the start hour in London time
      const [year, month, day] = nextTime.dateString.split('-').map(Number);
      const nextStart = new Date(Date.UTC(year, month - 1, day, config.startHour, 0, 0, 0));
      return nextStart;
    }

    daysToAdd++;
  }

  // Fallback: return tomorrow at start hour
  const tomorrow = new Date(result.getTime() + 24 * 60 * 60 * 1000);
  tomorrow.setUTCHours(config.startHour, 0, 0, 0);
  return tomorrow;
}

/**
 * Check if a given time is within business hours
 */
export async function checkBusinessHours(
  date: Date,
  bankHolidayService: BankHolidayService,
  config: BusinessHoursConfig = DEFAULT_CONFIG
): Promise<BusinessHoursResult> {
  const { hour, dayOfWeek, dateString } = getLondonTime(date, config.timezone);

  // Get bank holidays
  const bankHolidays = await bankHolidayService.getBankHolidays();
  const isBankHoliday = bankHolidays.has(dateString);

  // Check if within business hours
  const isBusinessDay = isWeekday(dayOfWeek) && !isBankHoliday;
  const isWithinHours = hour >= config.startHour && hour < config.endHour;
  const isWithinBusinessHours = isBusinessDay && isWithinHours;
  const endOfWindow = isBusinessDay && isEndOfWindow(hour, config);

  // Calculate next processing time if outside business hours
  let nextProcessingTime: string | undefined;
  if (!isWithinBusinessHours) {
    const nextStart = getNextBusinessHoursStart(date, bankHolidays, config);
    nextProcessingTime = nextStart.toISOString();
  }

  return {
    isWithinBusinessHours,
    isEndOfWindow: endOfWindow,
    londonTime: date.toLocaleString('en-GB', { timeZone: config.timezone }),
    londonHour: hour,
    dayOfWeek,
    isBankHoliday,
    nextProcessingTime,
  };
}

/**
 * Create a business hours checker with configuration from environment variables
 */
export function createBusinessHoursChecker(
  bankHolidayService: BankHolidayService
): (date?: Date) => Promise<BusinessHoursResult> {
  const config: BusinessHoursConfig = {
    startHour: parseInt(process.env.BUSINESS_HOURS_START ?? '7', 10),
    endHour: parseInt(process.env.BUSINESS_HOURS_END ?? '19', 10),
    timezone: process.env.BUSINESS_HOURS_TZ ?? 'Europe/London',
  };

  return async (date = new Date()) => checkBusinessHours(date, bankHolidayService, config);
}
