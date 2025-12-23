/**
 * Domain extraction utilities for organization-based scoring.
 *
 * Used by Story 3.2: Organization Reputation Tracking to extract
 * the email domain for org-level lease history queries.
 */

/**
 * Extracts the domain from an email address.
 *
 * @param email - The email address to extract domain from
 * @returns The domain portion of the email, lowercased
 * @throws Error if email format is invalid (missing @)
 *
 * @example
 * extractDomain('sarah.jones@councilname.gov.uk') // 'councilname.gov.uk'
 * extractDomain('USER@EXAMPLE.COM') // 'example.com'
 */
export const extractDomain = (email: string): string => {
  const atIndex = email.lastIndexOf('@');
  if (atIndex === -1) {
    throw new Error(`Invalid email format: ${email}`);
  }
  const domain = email.substring(atIndex + 1).toLowerCase();
  if (domain.length === 0) {
    throw new Error(`Invalid email format: ${email}`);
  }
  return domain;
};
