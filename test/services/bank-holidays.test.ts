/**
 * Bank Holidays Service Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createBankHolidayService,
  createMockBankHolidayService,
  clearBankHolidayCache,
} from '../../src/services/bank-holidays.js';

// Sample ICS content from gov.uk
const SAMPLE_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//GOV.UK//Bank Holidays//EN
X-WR-CALNAME:Bank Holidays England and Wales
BEGIN:VEVENT
DTSTART;VALUE=DATE:20251225
SUMMARY:Christmas Day
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20251226
SUMMARY:Boxing Day
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260101
SUMMARY:New Year's Day
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20250418
SUMMARY:Good Friday
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20250421
SUMMARY:Easter Monday
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20250505
SUMMARY:Early May bank holiday
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20250526
SUMMARY:Spring bank holiday
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20250825
SUMMARY:Summer bank holiday
END:VEVENT
END:VCALENDAR`;

describe('createMockBankHolidayService', () => {
  it('should return provided holidays', async () => {
    const service = createMockBankHolidayService(['2025-12-25', '2025-12-26']);
    const holidays = await service.getBankHolidays();

    expect(holidays.size).toBe(2);
    expect(holidays.has('2025-12-25')).toBe(true);
    expect(holidays.has('2025-12-26')).toBe(true);
  });

  it('should return empty set when no holidays provided', async () => {
    const service = createMockBankHolidayService([]);
    const holidays = await service.getBankHolidays();

    expect(holidays.size).toBe(0);
  });

  it('should return empty set by default', async () => {
    const service = createMockBankHolidayService();
    const holidays = await service.getBankHolidays();

    expect(holidays.size).toBe(0);
  });
});

describe('createBankHolidayService', () => {
  beforeEach(() => {
    clearBankHolidayCache();
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearBankHolidayCache();
  });

  it('should fetch and parse ICS correctly', async () => {
    // Mock fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SAMPLE_ICS),
    });

    const service = createBankHolidayService();
    const holidays = await service.getBankHolidays();

    expect(holidays.size).toBe(8);
    expect(holidays.has('2025-12-25')).toBe(true); // Christmas
    expect(holidays.has('2025-12-26')).toBe(true); // Boxing Day
    expect(holidays.has('2026-01-01')).toBe(true); // New Year
    expect(holidays.has('2025-04-18')).toBe(true); // Good Friday
    expect(holidays.has('2025-04-21')).toBe(true); // Easter Monday
    expect(holidays.has('2025-05-05')).toBe(true); // Early May
    expect(holidays.has('2025-05-26')).toBe(true); // Spring bank holiday
    expect(holidays.has('2025-08-25')).toBe(true); // Summer bank holiday
  });

  it('should cache results within TTL', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SAMPLE_ICS),
    });

    const service = createBankHolidayService(60000); // 1 minute TTL

    // First call should fetch
    await service.getBankHolidays();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    // Second call should use cache
    await service.getBankHolidays();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('should refetch after TTL expires', async () => {
    vi.useFakeTimers();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SAMPLE_ICS),
    });

    const service = createBankHolidayService(1000); // 1 second TTL

    // First call
    await service.getBankHolidays();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    // Advance time past TTL
    vi.advanceTimersByTime(1500);

    // Should refetch
    await service.getBankHolidays();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('should return empty set on fetch error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const service = createBankHolidayService();
    const holidays = await service.getBankHolidays();

    expect(holidays.size).toBe(0);
  });

  it('should return empty set on HTTP error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const service = createBankHolidayService();
    const holidays = await service.getBankHolidays();

    expect(holidays.size).toBe(0);
  });

  it('should handle refreshCache', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SAMPLE_ICS),
    });

    const service = createBankHolidayService(60000);

    // Call getBankHolidays first
    await service.getBankHolidays();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    // Force refresh should fetch again
    await service.refreshCache();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('ICS parsing edge cases', () => {
  beforeEach(() => {
    clearBankHolidayCache();
  });

  afterEach(() => {
    clearBankHolidayCache();
  });

  it('should handle ICS without VALUE=DATE', async () => {
    const icsWithoutValue = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART:20251225
SUMMARY:Christmas Day
END:VEVENT
END:VCALENDAR`;

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(icsWithoutValue),
    });

    const service = createBankHolidayService();
    const holidays = await service.getBankHolidays();

    expect(holidays.has('2025-12-25')).toBe(true);
  });

  it('should handle empty ICS', async () => {
    const emptyIcs = `BEGIN:VCALENDAR
END:VCALENDAR`;

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(emptyIcs),
    });

    const service = createBankHolidayService();
    const holidays = await service.getBankHolidays();

    expect(holidays.size).toBe(0);
  });

  it('should handle malformed ICS gracefully', async () => {
    const malformedIcs = `not valid ics content`;

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(malformedIcs),
    });

    const service = createBankHolidayService();
    const holidays = await service.getBankHolidays();

    expect(holidays.size).toBe(0);
  });

  it('should handle CRLF line endings', async () => {
    const crlfIcs = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20251225\r\nSUMMARY:Christmas Day\r\nEND:VEVENT\r\nEND:VCALENDAR`;

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(crlfIcs),
    });

    const service = createBankHolidayService();
    const holidays = await service.getBankHolidays();

    expect(holidays.has('2025-12-25')).toBe(true);
  });
});

describe('clearBankHolidayCache', () => {
  it('should clear the cache', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SAMPLE_ICS),
    });

    const service = createBankHolidayService();

    // First call
    await service.getBankHolidays();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    // Clear cache
    clearBankHolidayCache();

    // Should fetch again
    await service.getBankHolidays();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
