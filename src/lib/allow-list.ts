/**
 * Allow-list for emails that bypass scoring and auto-approve.
 * Implements AC6: Allow-list bypass for specific emails.
 */

/**
 * Static list of emails that bypass scoring and are auto-approved.
 * These are trusted users who should not be subject to the scoring engine.
 */
export const ALLOW_LIST_EMAILS: ReadonlyArray<string> = [
  'chris.nesbitt-smith@digital.cabinet-office.gov.uk',
  'chris.nesbitt-smith@dsit.gov.uk',
  'benjamin.bennett@dsit.gov.uk',
  'dimitris.perdikou@dsit.gov.uk',
  'edward.mccutcheon@dsit.gov.uk',
  'peter.gale@dsit.gov.uk',
] as const;

/**
 * Checks if an email address is in the allow-list.
 * Comparison is case-insensitive.
 *
 * @param email - The email address to check
 * @returns true if the email is in the allow-list
 */
export const isAllowListed = (email: string): boolean => {
  const normalizedEmail = email.toLowerCase().trim();
  return ALLOW_LIST_EMAILS.some((allowed) => allowed.toLowerCase() === normalizedEmail);
};
