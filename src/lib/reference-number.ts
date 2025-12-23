/**
 * Reference Number Utilities (Story 5.1)
 *
 * Generates deterministic reference numbers in ISB-YYYY-NNNN format.
 * The same leaseId will always generate the same reference number.
 *
 * @see FR35 - Reference number format
 */

/**
 * Generates a reference number in ISB-YYYY-NNNN format.
 * Uses the leaseId UUID to create a deterministic short reference.
 *
 * NOTE: This format supports max 10,000 unique references per year.
 * The same leaseId will always generate the same reference number.
 * For high-volume scenarios, collision risk increases (birthday paradox).
 * Acceptable for current low-volume use case.
 *
 * @param leaseId - The lease UUID
 * @returns Reference number string in ISB-YYYY-NNNN format
 *
 * @example
 * ```typescript
 * generateReferenceNumber('abc12345-def4-5678-9abc-def012345678'); // 'ISB-2025-5752'
 * generateReferenceNumber('abc12345-def4-5678-9abc-def012345678'); // 'ISB-2025-5752' (same input = same output)
 * ```
 */
export const generateReferenceNumber = (leaseId: string): string => {
  const year = new Date().getFullYear();
  // Use last 4 hex chars of UUID for deterministic reference
  const shortRef = leaseId.replace(/-/g, '').slice(-4).toUpperCase();
  // Convert hex to decimal and pad to 4 digits
  const numRef = (parseInt(shortRef, 16) % 10000).toString().padStart(4, '0');
  return `ISB-${year}-${numRef}`;
};
