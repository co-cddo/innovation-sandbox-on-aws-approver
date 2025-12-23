/**
 * Domain Allowlist Service
 *
 * Loads and caches the ukps-domains allowlist from S3.
 * Story 3.3: Domain Verification from S3 Cache
 *
 * Features:
 * - Filters to local_authority organisation_type_id only (FR8)
 * - In-memory cache with 1 hour TTL (FR11)
 * - Stale-while-revalidate on refresh failure (AC6)
 * - Pessimistic fallback on errors (AC5)
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

/**
 * Cache entry for domain list
 */
interface CacheEntry {
  data: string[];
  expiresAt: number;
  lastFetched: number;
}

/**
 * Domain entry from ukps-domains JSON
 */
interface DomainEntry {
  domain_pattern?: string;
  organisation_type_id?: string;
  organisation_name?: string;
}

/**
 * Expected JSON structure from S3
 */
interface DomainsJson {
  domains?: DomainEntry[];
}

/**
 * Configuration for domain allowlist service
 */
export interface DomainAllowlistConfig {
  bucketName: string;
  objectKey: string;
}

/**
 * Result from getLocalAuthorityDomains including cache status
 */
export interface DomainAllowlistResult {
  /** List of domain patterns */
  domains: string[];
  /** Whether stale cache was used due to S3 error */
  usedStaleCache: boolean;
  /** S3 error message if stale cache was used */
  staleReason?: string;
}

/**
 * Domain allowlist service interface
 */
export interface DomainAllowlistService {
  /**
   * Get list of local authority domains from cached S3 data.
   * Returns cached data if within TTL, otherwise fetches fresh data.
   * Uses stale cache on refresh failure.
   */
  getLocalAuthorityDomains(): Promise<DomainAllowlistResult>;

  /**
   * Clear the cache, forcing next call to fetch from S3.
   * Useful for testing or forced refresh.
   */
  clearCache(): void;
}

/**
 * Cache TTL in milliseconds (1 hour)
 */
export const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Creates a domain allowlist service with S3 backend and caching.
 *
 * @param client - S3 client (injected for testability)
 * @param config - Bucket and key configuration
 * @returns Domain allowlist service
 */
export const createDomainAllowlistService = (
  client: S3Client,
  config: DomainAllowlistConfig
): DomainAllowlistService => {
  const { bucketName, objectKey } = config;

  // In-memory cache (module-level per service instance)
  let cache: CacheEntry | null = null;

  /**
   * Fetches and parses domain list from S3
   */
  const fetchFromS3 = async (): Promise<string[]> => {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
    });

    const response = await client.send(command);

    if (!response.Body) {
      throw new Error('No body in S3 response');
    }

    // Convert stream to string
    const bodyContents = await response.Body.transformToString();
    const json = JSON.parse(bodyContents) as DomainsJson;

    // Filter to local_authority only and extract domain_pattern
    const domains = (json.domains ?? [])
      .filter((entry) => entry.organisation_type_id === 'local_authority')
      .filter((entry) => entry.domain_pattern !== undefined && entry.domain_pattern !== '')
      .map((entry) => entry.domain_pattern as string);

    return domains;
  };

  /**
   * Gets local authority domains with caching and stale-while-revalidate
   */
  const getLocalAuthorityDomains = async (): Promise<DomainAllowlistResult> => {
    const now = Date.now();

    // Return cached if valid
    if (cache && cache.expiresAt > now) {
      return { domains: cache.data, usedStaleCache: false };
    }

    try {
      const domains = await fetchFromS3();
      cache = {
        data: domains,
        expiresAt: now + CACHE_TTL_MS,
        lastFetched: now,
      };
      return { domains, usedStaleCache: false };
    } catch (error) {
      // Stale cache fallback with indicator for caller to log warning (AC6)
      if (cache) {
        return {
          domains: cache.data,
          usedStaleCache: true,
          staleReason: error instanceof Error ? error.message : String(error),
        };
      }
      // No cache available - rethrow
      throw error;
    }
  };

  /**
   * Clears the cache
   */
  const clearCache = (): void => {
    cache = null;
  };

  return {
    getLocalAuthorityDomains,
    clearCache,
  };
};
