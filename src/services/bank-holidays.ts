/**
 * UK Bank Holidays Service
 *
 * Fetches and caches UK bank holidays from gov.uk ICS endpoint.
 * Uses England and Wales calendar (most relevant for local government).
 */

import { logger } from '../lib/logger.js';

const GOV_UK_BANK_HOLIDAYS_URL = 'https://www.gov.uk/bank-holidays/england-and-wales.ics';
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface BankHolidayService {
  /** Get set of bank holiday dates (format: YYYY-MM-DD) */
  getBankHolidays(): Promise<Set<string>>;
  /** Force refresh the cache */
  refreshCache(): Promise<void>;
}

interface BankHolidayCache {
  holidays: Set<string>;
  fetchedAt: number;
}

let cache: BankHolidayCache | null = null;

/**
 * Parse ICS format to extract holiday dates
 *
 * ICS format example:
 * BEGIN:VEVENT
 * DTSTART;VALUE=DATE:20251225
 * SUMMARY:Christmas Day
 * END:VEVENT
 */
function parseICS(icsContent: string): Set<string> {
  const holidays = new Set<string>();
  const lines = icsContent.split(/\r?\n/);

  for (const line of lines) {
    // Match DTSTART with VALUE=DATE format
    const match = line.match(/^DTSTART(?:;VALUE=DATE)?:(\d{8})/);
    if (match) {
      const dateStr = match[1];
      // Convert YYYYMMDD to YYYY-MM-DD
      const formatted = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
      holidays.add(formatted);
    }
  }

  return holidays;
}

/**
 * Fetch bank holidays from gov.uk
 */
async function fetchBankHolidays(): Promise<Set<string>> {
  try {
    // Node.js 18+ has native fetch
    const response = await globalThis.fetch(GOV_UK_BANK_HOLIDAYS_URL, {
      headers: {
        'Accept': 'text/calendar',
        'User-Agent': 'innovation-sandbox-approver/1.0',
      },
      signal: globalThis.AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const icsContent = await response.text();
    const holidays = parseICS(icsContent);

    logger.info('Fetched UK bank holidays', {
      count: holidays.size,
      source: GOV_UK_BANK_HOLIDAYS_URL,
    });

    return holidays;
  } catch (error) {
    logger.error('Failed to fetch UK bank holidays', {
      error: error instanceof Error ? error.message : String(error),
      source: GOV_UK_BANK_HOLIDAYS_URL,
    });

    // Return empty set on failure - will treat all days as non-holidays
    // This is a fail-open approach for bank holidays (pessimistic would delay more)
    return new Set();
  }
}

/**
 * Create the bank holiday service
 */
export function createBankHolidayService(cacheTtlMs: number = DEFAULT_CACHE_TTL_MS): BankHolidayService {
  return {
    async getBankHolidays(): Promise<Set<string>> {
      const now = Date.now();

      // Check if cache is still valid
      if (cache && (now - cache.fetchedAt) < cacheTtlMs) {
        return cache.holidays;
      }

      // Fetch fresh data
      const holidays = await fetchBankHolidays();

      // Update cache
      cache = {
        holidays,
        fetchedAt: now,
      };

      return holidays;
    },

    async refreshCache(): Promise<void> {
      const holidays = await fetchBankHolidays();
      cache = {
        holidays,
        fetchedAt: Date.now(),
      };
    },
  };
}

/**
 * Create a mock bank holiday service for testing
 */
export function createMockBankHolidayService(holidays: string[] = []): BankHolidayService {
  const holidaySet = new Set(holidays);
  return {
    async getBankHolidays(): Promise<Set<string>> {
      return holidaySet;
    },
    async refreshCache(): Promise<void> {
      // No-op for mock
    },
  };
}

/**
 * Clear the cache (useful for testing)
 */
export function clearBankHolidayCache(): void {
  cache = null;
}
