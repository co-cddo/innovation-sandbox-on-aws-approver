/**
 * Domain Verification Utility
 *
 * Story 3.3: Domain Verification from S3 Cache - AC2, AC3, AC4
 *
 * Checks if a domain is in the verified local authority allowlist.
 * Supports exact matching and wildcard patterns (*.gov.uk).
 */

/**
 * Checks if a domain is in the verified government domains allowlist.
 *
 * @param domain - The domain to check (e.g., 'councilname.gov.uk')
 * @param allowlist - List of allowed domain patterns (may include wildcards like '*.gov.uk')
 * @returns true if domain is verified, false otherwise
 */
export const isVerifiedGovDomain = (domain: string, allowlist: string[]): boolean => {
  if (!domain || allowlist.length === 0) {
    return false;
  }

  const lowerDomain = domain.toLowerCase();

  return allowlist.some((pattern) => {
    const lowerPattern = pattern.toLowerCase();

    // Handle wildcard patterns like *.gov.uk
    if (lowerPattern.startsWith('*.')) {
      const suffix = lowerPattern.substring(2); // Remove '*.'
      return lowerDomain.endsWith(suffix) && lowerDomain.length > suffix.length;
    }

    // Exact match (case-insensitive)
    return lowerDomain === lowerPattern;
  });
};
