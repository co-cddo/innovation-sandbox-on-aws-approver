/**
 * Business Hours Tests
 *
 * Tests timezone-aware business hours detection with various edge cases.
 */

import { describe, it, expect } from 'vitest';
import {
  getLondonTime,
  isWeekday,
  isEndOfWindow,
  getNextBusinessHoursStart,
  checkBusinessHours,
  createBusinessHoursChecker,
  countBusinessDays,
  isQueueExpired,
} from '../../src/lib/business-hours.js';
import { createMockBankHolidayService } from '../../src/services/bank-holidays.js';

describe('getLondonTime', () => {
  it('should extract hour and day from a UTC date', () => {
    // 2025-01-15 14:30 UTC = Wednesday
    const date = new Date('2025-01-15T14:30:00.000Z');
    const result = getLondonTime(date, 'Europe/London');

    expect(result.hour).toBe(14); // GMT in January, no offset
    expect(result.dayOfWeek).toBe(3); // Wednesday
    expect(result.dateString).toBe('2025-01-15');
  });

  it('should handle BST (British Summer Time)', () => {
    // 2025-07-15 14:30 UTC = should be 15:30 BST
    const date = new Date('2025-07-15T14:30:00.000Z');
    const result = getLondonTime(date, 'Europe/London');

    expect(result.hour).toBe(15); // BST = UTC+1
    expect(result.dayOfWeek).toBe(2); // Tuesday
    expect(result.dateString).toBe('2025-07-15');
  });

  it('should handle midnight correctly', () => {
    // 2025-01-15 00:00 UTC
    const date = new Date('2025-01-15T00:00:00.000Z');
    const result = getLondonTime(date, 'Europe/London');

    expect(result.hour).toBe(0);
    expect(result.minute).toBe(0);
  });

  it('should handle end of day correctly', () => {
    // 2025-01-15 23:59 UTC
    const date = new Date('2025-01-15T23:59:00.000Z');
    const result = getLondonTime(date, 'Europe/London');

    expect(result.hour).toBe(23);
    expect(result.minute).toBe(59);
  });
});

describe('isWeekday', () => {
  it('should return true for Monday through Friday', () => {
    expect(isWeekday(1)).toBe(true); // Monday
    expect(isWeekday(2)).toBe(true); // Tuesday
    expect(isWeekday(3)).toBe(true); // Wednesday
    expect(isWeekday(4)).toBe(true); // Thursday
    expect(isWeekday(5)).toBe(true); // Friday
  });

  it('should return false for Saturday and Sunday', () => {
    expect(isWeekday(0)).toBe(false); // Sunday
    expect(isWeekday(6)).toBe(false); // Saturday
  });
});

describe('isEndOfWindow', () => {
  const config = { startHour: 7, endHour: 19, timezone: 'Europe/London' };

  it('should return true for 5pm-7pm', () => {
    expect(isEndOfWindow(17, config)).toBe(true);
    expect(isEndOfWindow(18, config)).toBe(true);
  });

  it('should return false for outside end-of-window period', () => {
    expect(isEndOfWindow(7, config)).toBe(false);
    expect(isEndOfWindow(12, config)).toBe(false);
    expect(isEndOfWindow(16, config)).toBe(false);
    expect(isEndOfWindow(19, config)).toBe(false); // After hours
  });

  it('should handle custom end hours', () => {
    const customConfig = { ...config, endHour: 17 };
    expect(isEndOfWindow(15, customConfig)).toBe(true); // 3pm-5pm
    expect(isEndOfWindow(16, customConfig)).toBe(true);
    expect(isEndOfWindow(14, customConfig)).toBe(false);
  });
});

describe('getNextBusinessHoursStart', () => {
  const emptyHolidays = new Set<string>();
  const config = { startHour: 7, endHour: 19, timezone: 'Europe/London' };

  it('should return today if before start hour on a weekday', () => {
    // Wednesday 2025-01-15 at 5:00 UTC (5am London in winter)
    const date = new Date('2025-01-15T05:00:00.000Z');
    const result = getNextBusinessHoursStart(date, emptyHolidays, config);

    // Should be 7am same day
    expect(result.getUTCHours()).toBe(7);
  });

  it('should return next day if after business hours', () => {
    // Wednesday 2025-01-15 at 20:00 UTC (8pm London)
    const date = new Date('2025-01-15T20:00:00.000Z');
    const result = getNextBusinessHoursStart(date, emptyHolidays, config);

    // Should be 7am Thursday
    const resultDate = result.toISOString().split('T')[0];
    expect(resultDate).toBe('2025-01-16');
  });

  it('should skip weekends', () => {
    // Friday 2025-01-17 at 20:00 UTC (after hours)
    const date = new Date('2025-01-17T20:00:00.000Z');
    const result = getNextBusinessHoursStart(date, emptyHolidays, config);

    // Should skip Saturday and Sunday, return Monday 7am
    const resultDate = result.toISOString().split('T')[0];
    expect(resultDate).toBe('2025-01-20'); // Monday
  });

  it('should skip bank holidays', () => {
    // Tuesday 2025-01-14 at 20:00 UTC (after hours)
    // Wednesday 2025-01-15 is a bank holiday
    const holidays = new Set(['2025-01-15']);
    const date = new Date('2025-01-14T20:00:00.000Z');
    const result = getNextBusinessHoursStart(date, holidays, config);

    // Should skip Wednesday (holiday), return Thursday 7am
    const resultDate = result.toISOString().split('T')[0];
    expect(resultDate).toBe('2025-01-16');
  });
});

describe('checkBusinessHours', () => {
  const mockBankHolidayService = createMockBankHolidayService([]);
  const config = { startHour: 7, endHour: 19, timezone: 'Europe/London' };

  it('should return true during business hours on a weekday', async () => {
    // Wednesday 2025-01-15 at 12:00 UTC (noon London)
    const date = new Date('2025-01-15T12:00:00.000Z');
    const result = await checkBusinessHours(date, mockBankHolidayService, config);

    expect(result.isWithinBusinessHours).toBe(true);
    expect(result.isEndOfWindow).toBe(false);
    expect(result.londonHour).toBe(12);
    expect(result.dayOfWeek).toBe(3);
    expect(result.isBankHoliday).toBe(false);
    expect(result.nextProcessingTime).toBeUndefined();
  });

  it('should return false before business hours', async () => {
    // Wednesday 2025-01-15 at 05:00 UTC (5am London)
    const date = new Date('2025-01-15T05:00:00.000Z');
    const result = await checkBusinessHours(date, mockBankHolidayService, config);

    expect(result.isWithinBusinessHours).toBe(false);
    expect(result.londonHour).toBe(5);
    expect(result.nextProcessingTime).toBeDefined();
  });

  it('should return false after business hours', async () => {
    // Wednesday 2025-01-15 at 20:00 UTC (8pm London)
    const date = new Date('2025-01-15T20:00:00.000Z');
    const result = await checkBusinessHours(date, mockBankHolidayService, config);

    expect(result.isWithinBusinessHours).toBe(false);
    expect(result.londonHour).toBe(20);
    expect(result.nextProcessingTime).toBeDefined();
  });

  it('should return false on weekends', async () => {
    // Saturday 2025-01-18 at 12:00 UTC
    const date = new Date('2025-01-18T12:00:00.000Z');
    const result = await checkBusinessHours(date, mockBankHolidayService, config);

    expect(result.isWithinBusinessHours).toBe(false);
    expect(result.dayOfWeek).toBe(6); // Saturday
  });

  it('should return false on bank holidays', async () => {
    const holidayService = createMockBankHolidayService(['2025-01-15']);
    // Wednesday 2025-01-15 at 12:00 UTC (bank holiday)
    const date = new Date('2025-01-15T12:00:00.000Z');
    const result = await checkBusinessHours(date, holidayService, config);

    expect(result.isWithinBusinessHours).toBe(false);
    expect(result.isBankHoliday).toBe(true);
  });

  it('should detect end-of-window period', async () => {
    // Wednesday 2025-01-15 at 17:30 UTC (5:30pm London in winter)
    const date = new Date('2025-01-15T17:30:00.000Z');
    const result = await checkBusinessHours(date, mockBankHolidayService, config);

    expect(result.isWithinBusinessHours).toBe(true);
    expect(result.isEndOfWindow).toBe(true);
    expect(result.londonHour).toBe(17);
  });

  it('should detect end-of-window at 6pm', async () => {
    // Wednesday 2025-01-15 at 18:00 UTC (6pm London)
    const date = new Date('2025-01-15T18:00:00.000Z');
    const result = await checkBusinessHours(date, mockBankHolidayService, config);

    expect(result.isWithinBusinessHours).toBe(true);
    expect(result.isEndOfWindow).toBe(true);
  });

  it('should not detect end-of-window at 4pm', async () => {
    // Wednesday 2025-01-15 at 16:00 UTC (4pm London)
    const date = new Date('2025-01-15T16:00:00.000Z');
    const result = await checkBusinessHours(date, mockBankHolidayService, config);

    expect(result.isWithinBusinessHours).toBe(true);
    expect(result.isEndOfWindow).toBe(false);
  });
});

describe('createBusinessHoursChecker', () => {
  it('should create a checker with default config', async () => {
    const mockBankHolidayService = createMockBankHolidayService([]);
    const checker = createBusinessHoursChecker(mockBankHolidayService);

    // Should return a function
    expect(typeof checker).toBe('function');

    // Should work with default date (now)
    const result = await checker();
    expect(result).toHaveProperty('isWithinBusinessHours');
    expect(result).toHaveProperty('londonTime');
  });

  it('should accept a custom date', async () => {
    const mockBankHolidayService = createMockBankHolidayService([]);
    const checker = createBusinessHoursChecker(mockBankHolidayService);

    const customDate = new Date('2025-01-15T12:00:00.000Z');
    const result = await checker(customDate);

    expect(result.londonHour).toBe(12);
  });
});

describe('DST transitions', () => {
  const mockBankHolidayService = createMockBankHolidayService([]);
  const config = { startHour: 7, endHour: 19, timezone: 'Europe/London' };

  it('should handle clock change to BST (March)', async () => {
    // 2025-03-30 is the last Sunday of March (clocks go forward)
    // 14:00 UTC = 15:00 BST
    const date = new Date('2025-03-30T14:00:00.000Z');
    const result = await checkBusinessHours(date, mockBankHolidayService, config);

    expect(result.londonHour).toBe(15);
    expect(result.isWithinBusinessHours).toBe(false); // Sunday
  });

  it('should handle clock change to GMT (October)', async () => {
    // 2025-10-26 is the last Sunday of October (clocks go back)
    // 14:00 UTC = 14:00 GMT
    const date = new Date('2025-10-26T14:00:00.000Z');
    const result = await checkBusinessHours(date, mockBankHolidayService, config);

    expect(result.londonHour).toBe(14);
    expect(result.isWithinBusinessHours).toBe(false); // Sunday
  });

  it('should correctly apply BST during summer', async () => {
    // Summer Wednesday - 2025-07-16
    // 06:00 UTC = 07:00 BST (just at start of business hours)
    const date = new Date('2025-07-16T06:00:00.000Z');
    const result = await checkBusinessHours(date, mockBankHolidayService, config);

    expect(result.londonHour).toBe(7);
    expect(result.isWithinBusinessHours).toBe(true);
  });

  it('should correctly apply GMT during winter', async () => {
    // Winter Wednesday - 2025-01-15
    // 07:00 UTC = 07:00 GMT (just at start of business hours)
    const date = new Date('2025-01-15T07:00:00.000Z');
    const result = await checkBusinessHours(date, mockBankHolidayService, config);

    expect(result.londonHour).toBe(7);
    expect(result.isWithinBusinessHours).toBe(true);
  });
});

describe('edge cases', () => {
  const mockBankHolidayService = createMockBankHolidayService([]);
  const config = { startHour: 7, endHour: 19, timezone: 'Europe/London' };

  it('should handle exactly 7am (start of business hours)', async () => {
    const date = new Date('2025-01-15T07:00:00.000Z');
    const result = await checkBusinessHours(date, mockBankHolidayService, config);

    expect(result.isWithinBusinessHours).toBe(true);
    expect(result.londonHour).toBe(7);
  });

  it('should handle exactly 7pm (end of business hours - exclusive)', async () => {
    const date = new Date('2025-01-15T19:00:00.000Z');
    const result = await checkBusinessHours(date, mockBankHolidayService, config);

    expect(result.isWithinBusinessHours).toBe(false); // 7pm is after hours
    expect(result.londonHour).toBe(19);
  });

  it('should handle 6:59pm (last minute of business hours)', async () => {
    const date = new Date('2025-01-15T18:59:00.000Z');
    const result = await checkBusinessHours(date, mockBankHolidayService, config);

    expect(result.isWithinBusinessHours).toBe(true);
    expect(result.isEndOfWindow).toBe(true);
  });
});

describe('countBusinessDays', () => {

  it('should count 5 business days in a week with no bank holidays', () => {
    // Monday to Friday (5 business days)
    const start = new Date('2025-01-13T00:00:00.000Z'); // Monday
    const end = new Date('2025-01-17T23:59:59.000Z'); // Friday
    const result = countBusinessDays(start, end, new Set<string>());
    expect(result).toBe(4); // Tue, Wed, Thu, Fri (excluding Mon since we start counting from day after)
  });

  it('should return 0 when end is before start', () => {
    const start = new Date('2025-01-15T00:00:00.000Z');
    const end = new Date('2025-01-14T00:00:00.000Z');
    const result = countBusinessDays(start, end, new Set<string>());
    expect(result).toBe(0);
  });

  it('should return 0 when end equals start', () => {
    const date = new Date('2025-01-15T00:00:00.000Z');
    const result = countBusinessDays(date, date, new Set<string>());
    expect(result).toBe(0);
  });

  it('should exclude weekends', () => {
    // Friday to Monday (spans a weekend)
    const start = new Date('2025-01-17T00:00:00.000Z'); // Friday
    const end = new Date('2025-01-20T23:59:59.000Z'); // Monday
    const result = countBusinessDays(start, end, new Set<string>());
    expect(result).toBe(1); // Only Monday is counted (Sat/Sun excluded)
  });

  it('should exclude bank holidays', () => {
    // Wednesday to Friday with Thursday as bank holiday
    const start = new Date('2025-01-15T00:00:00.000Z'); // Wednesday
    const end = new Date('2025-01-17T23:59:59.000Z'); // Friday
    const bankHolidays = new Set(['2025-01-16']); // Thursday
    const result = countBusinessDays(start, end, bankHolidays);
    expect(result).toBe(1); // Only Friday (Thursday excluded)
  });

  it('should count business days across multiple weeks', () => {
    // Monday Jan 13 to Friday Jan 24 (10 business days total, but we count from day after)
    const start = new Date('2025-01-13T00:00:00.000Z'); // Monday
    const end = new Date('2025-01-24T23:59:59.000Z'); // Friday
    const result = countBusinessDays(start, end, new Set<string>());
    // Tue-Fri week 1 = 4, Mon-Fri week 2 = 5 = 9 days
    expect(result).toBe(9);
  });

  it('should exclude both weekends and bank holidays', () => {
    // Monday to next Monday with Friday as bank holiday
    const start = new Date('2025-01-13T00:00:00.000Z'); // Monday
    const end = new Date('2025-01-20T23:59:59.000Z'); // Monday
    const bankHolidays = new Set(['2025-01-17']); // Friday
    const result = countBusinessDays(start, end, bankHolidays);
    // Tue, Wed, Thu (Fri=holiday), Mon = 4 days
    expect(result).toBe(4);
  });

  it('should handle spanning Christmas holiday period', () => {
    // Dec 23 to Dec 29 with Dec 25, 26 as bank holidays
    const start = new Date('2025-12-23T00:00:00.000Z'); // Tuesday
    const end = new Date('2025-12-29T23:59:59.000Z'); // Monday
    const bankHolidays = new Set(['2025-12-25', '2025-12-26']); // Thu, Fri
    const result = countBusinessDays(start, end, bankHolidays);
    // Wed (24th), Mon (29th) = 2 days (25th, 26th holidays, 27-28 weekend)
    expect(result).toBe(2);
  });
});

describe('isQueueExpired', () => {

  it('should return false when request has been in queue for less than max days', () => {
    // Queued on Monday, current is Wednesday (2 business days)
    const queuedAt = new Date('2025-01-13T10:00:00.000Z'); // Monday
    const currentDate = new Date('2025-01-15T10:00:00.000Z'); // Wednesday
    const result = isQueueExpired(queuedAt, 5, new Set<string>(), currentDate);
    expect(result).toBe(false);
  });

  it('should return false when request has been in queue for exactly max days', () => {
    // Queued on Monday, current is Monday+5 business days = next Monday
    const queuedAt = new Date('2025-01-13T10:00:00.000Z'); // Monday
    const currentDate = new Date('2025-01-20T10:00:00.000Z'); // Next Monday (5 business days later)
    const result = isQueueExpired(queuedAt, 5, new Set<string>(), currentDate);
    expect(result).toBe(false); // Exactly 5, not > 5
  });

  it('should return true when request has been in queue for more than max days', () => {
    // Queued on Monday, current is Tuesday next week (6 business days)
    const queuedAt = new Date('2025-01-13T10:00:00.000Z'); // Monday
    const currentDate = new Date('2025-01-21T10:00:00.000Z'); // Tuesday next week
    const result = isQueueExpired(queuedAt, 5, new Set<string>(), currentDate);
    expect(result).toBe(true);
  });

  it('should account for weekends when checking expiry', () => {
    // Queued on Friday, current is next Friday (5 business days but 7 calendar days)
    const queuedAt = new Date('2025-01-17T10:00:00.000Z'); // Friday
    const currentDate = new Date('2025-01-24T10:00:00.000Z'); // Next Friday
    const result = isQueueExpired(queuedAt, 5, new Set<string>(), currentDate);
    expect(result).toBe(false); // Mon, Tue, Wed, Thu, Fri = 5 business days, exactly at limit
  });

  it('should account for bank holidays when checking expiry', () => {
    // Queued on Monday, current is next Monday with one bank holiday
    const queuedAt = new Date('2025-01-13T10:00:00.000Z'); // Monday
    const currentDate = new Date('2025-01-21T10:00:00.000Z'); // Tuesday next week
    const bankHolidays = new Set(['2025-01-16']); // Thursday
    // Business days: Tue, Wed, Fri, Mon, Tue = 5 (Thu excluded)
    const result = isQueueExpired(queuedAt, 5, bankHolidays, currentDate);
    expect(result).toBe(false); // Exactly 5
  });
});
