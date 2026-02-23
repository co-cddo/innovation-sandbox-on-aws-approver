/**
 * ISB API Client Service
 * Makes HTTP calls to ISB's API Gateway with HS256 JWT authentication
 * to approve/deny leases, fetch accounts, and get lease details.
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { createHmac } from 'node:crypto';
import type { LeaseId, Account, GetAccountsResult } from '../lib/types.js';
import { AccountsPageResponseSchema } from '../lib/types.js';
import { leaseIdToCompositeKey } from '../lib/lease-id-codec.js';

/**
 * Parameters for approving a lease via ISB API
 */
export interface ApproveLeaseLambdaParams {
  readonly leaseId: LeaseId;
  readonly approverEmail: string;
}

/**
 * Parameters for denying a lease via ISB API
 */
export interface DenyLeaseLambdaParams {
  readonly leaseId: LeaseId;
  readonly approverEmail: string;
}

/**
 * Result from ISB API invocation
 */
export interface IsbLambdaResult {
  readonly success: boolean;
  readonly statusCode: number;
  readonly message?: string;
  readonly error?: string;
}

/**
 * ISB API service configuration
 */
export interface IsbLambdaServiceConfig {
  readonly apiBaseUrl: string;
  readonly jwtSecretPath: string;
  readonly timeoutMs?: number;
}

/**
 * Parameters for getting accounts via ISB API
 */
export interface GetAccountsLambdaParams {
  readonly approverEmail: string;
}

/**
 * Parameters for getting a single lease via ISB API
 */
export interface GetLeaseLambdaParams {
  readonly leaseId: LeaseId;
  readonly approverEmail: string;
}

/**
 * Result from getting lease details
 */
export interface GetLeaseResult {
  readonly success: boolean;
  readonly templateName?: string;
  readonly error?: string;
}

/**
 * ISB API service interface for type-safe dependency injection
 */
export interface IsbLambdaService {
  approveLease(params: ApproveLeaseLambdaParams): Promise<IsbLambdaResult>;
  denyLease(params: DenyLeaseLambdaParams): Promise<IsbLambdaResult>;
  getAccounts(params: GetAccountsLambdaParams): Promise<GetAccountsResult>;
  getLease(params: GetLeaseLambdaParams): Promise<GetLeaseResult>;
}

// =============================================================================
// JWT Signing (zero new dependencies — uses Node.js built-in crypto)
// =============================================================================

/**
 * Sign a JWT with HS256 algorithm using Node.js built-in crypto.
 *
 * @param payload - JWT payload object
 * @param secret - HMAC-SHA256 signing secret
 * @param expiresInSeconds - Token TTL (default 3600s / 1 hour)
 * @returns Signed JWT string
 */
export function signJwt(payload: object, secret: string, expiresInSeconds = 3600): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + expiresInSeconds };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

// =============================================================================
// Token Manager — cache secret and token across invocations
// =============================================================================

let cachedSecret: string | null = null;
let cachedToken: string | null = null;
let tokenExpiry = 0;

/**
 * Reset cached token and secret state (for testing).
 */
export function resetTokenCache(): void {
  cachedSecret = null;
  cachedToken = null;
  tokenExpiry = 0;
}

/**
 * Fetch JWT signing secret from Secrets Manager.
 */
async function fetchJwtSecret(
  secretsClient: SecretsManagerClient,
  secretPath: string
): Promise<string> {
  const command = new GetSecretValueCommand({ SecretId: secretPath });
  const response = await secretsClient.send(command);
  if (!response.SecretString) {
    throw new Error('JWT secret is empty');
  }
  return response.SecretString;
}

/**
 * Get a valid signed JWT token, re-signing if expired or expiring within 60s.
 */
async function getISBToken(
  secretsClient: SecretsManagerClient,
  jwtSecretPath: string
): Promise<string> {
  if (!cachedSecret) {
    cachedSecret = await fetchJwtSecret(secretsClient, jwtSecretPath);
  }

  const now = Math.floor(Date.now() / 1000);
  if (!cachedToken || now >= tokenExpiry - 60) {
    const approverEmail = process.env.APPROVER_EMAIL ?? 'ndx+try-automated-approver@dsit.gov.uk';
    cachedToken = signJwt({ user: { email: approverEmail, roles: ['Admin'] } }, cachedSecret, 3600);
    tokenExpiry = now + 3600;
  }

  return cachedToken;
}

/**
 * Invalidate cached secret and token, forcing re-fetch on next call.
 * Called when the API returns 401/403, indicating possible secret rotation.
 */
function invalidateSecretCache(): void {
  cachedSecret = null;
  cachedToken = null;
  tokenExpiry = 0;
}

// =============================================================================
// HTTP Fetch Helper
// =============================================================================

/**
 * Make an authenticated HTTP request to ISB API Gateway.
 */
async function fetchFromISB(
  url: string,
  secretsClient: SecretsManagerClient,
  jwtSecretPath: string,
  options: {
    method?: 'GET' | 'POST';
    body?: string;
    timeoutMs?: number;
  } = {}
): Promise<Response> {
  const { method = 'GET', body, timeoutMs = 5000 } = options;
  const token = await getISBToken(secretsClient, jwtSecretPath);

  const fetchOptions: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(timeoutMs),
  };

  if (body) {
    fetchOptions.body = body;
  }

  const response = await fetch(url, fetchOptions);

  // Invalidate cached secret on auth failures (handles secret rotation)
  if (response.status === 401 || response.status === 403) {
    invalidateSecretCache();
  }

  return response;
}

// =============================================================================
// Response Parsing
// =============================================================================

/**
 * Parses an HTTP response into an IsbLambdaResult.
 */
const parseHttpResponse = async (response: Response): Promise<IsbLambdaResult> => {
  const statusCode = response.status;

  try {
    const body = (await response.json()) as Record<string, unknown>;

    if (statusCode >= 200 && statusCode < 300) {
      return {
        success: true,
        statusCode,
        message: (body?.status as string) ?? 'success',
      };
    }

    // Extract error message from ISB's JSend response format
    const data = body?.data as Record<string, unknown> | undefined;
    const errors = data?.errors as Array<{ message?: string }> | undefined;
    const errorMessage =
      errors?.[0]?.message ?? (body?.message as string) ?? 'Unknown error from ISB';

    return {
      success: false,
      statusCode,
      error: errorMessage,
    };
  } catch (error) {
    return {
      success: false,
      statusCode,
      /* c8 ignore next -- defensive: json() throws Error objects */
      error: `Failed to parse ISB API response: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

/**
 * Maximum pages to traverse (safety limit to prevent infinite loops)
 */
const MAX_PAGINATION_PAGES = 100;

// =============================================================================
// Service Factory
// =============================================================================

/**
 * Creates an ISB API service with the given Secrets Manager client and configuration.
 * Uses factory function pattern for dependency injection and testability.
 *
 * @param secretsClient - Secrets Manager client instance for JWT secret retrieval
 * @param config - Configuration including API base URL and JWT secret path
 * @returns ISB API service instance
 */
export const createIsbLambdaService = (
  secretsClient: SecretsManagerClient,
  config: IsbLambdaServiceConfig
): IsbLambdaService => ({
  approveLease: async (params: ApproveLeaseLambdaParams): Promise<IsbLambdaResult> => {
    const leaseIdB64 = leaseIdToCompositeKey(params.leaseId);
    const url = `${config.apiBaseUrl}/leases/${encodeURIComponent(leaseIdB64)}/review`;

    const response = await fetchFromISB(url, secretsClient, config.jwtSecretPath, {
      method: 'POST',
      body: JSON.stringify({ action: 'Approve' }),
      timeoutMs: config.timeoutMs,
    });

    return parseHttpResponse(response);
  },

  denyLease: async (params: DenyLeaseLambdaParams): Promise<IsbLambdaResult> => {
    const leaseIdB64 = leaseIdToCompositeKey(params.leaseId);
    const url = `${config.apiBaseUrl}/leases/${encodeURIComponent(leaseIdB64)}/review`;

    const response = await fetchFromISB(url, secretsClient, config.jwtSecretPath, {
      method: 'POST',
      body: JSON.stringify({ action: 'Deny' }),
      timeoutMs: config.timeoutMs,
    });

    return parseHttpResponse(response);
  },

  getAccounts: async (params: GetAccountsLambdaParams): Promise<GetAccountsResult> => {
    const allAccounts: Account[] = [];
    let pageIdentifier: string | undefined = undefined;
    let pagesTraversed = 0;

    // Pagination loop - fetch all pages
    do {
      pagesTraversed++;

      // Safety: prevent infinite loops (Pre-mortem fix)
      if (pagesTraversed > MAX_PAGINATION_PAGES) {
        return {
          success: false,
          accounts: allAccounts,
          totalFetched: allAccounts.length,
          pagesTraversed,
          error: `Pagination exceeded ${MAX_PAGINATION_PAGES} pages - possible infinite loop`,
        };
      }

      const queryParams = pageIdentifier
        ? `?pageIdentifier=${encodeURIComponent(pageIdentifier)}`
        : '';
      const url = `${config.apiBaseUrl}/accounts${queryParams}`;

      let response: Response;
      try {
        response = await fetchFromISB(url, secretsClient, config.jwtSecretPath, {
          method: 'GET',
          timeoutMs: config.timeoutMs,
        });
      } catch (error) {
        return {
          success: false,
          accounts: allAccounts,
          totalFetched: allAccounts.length,
          pagesTraversed,
          /* c8 ignore next -- defensive: fetch throws Error objects */
          error: `ISB API request failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      const statusCode = response.status;

      if (statusCode < 200 || statusCode >= 300) {
        try {
          const errorBody = (await response.json()) as Record<string, unknown>;
          const data = errorBody?.data as Record<string, unknown> | undefined;
          const errors = data?.errors as Array<{ message?: string }> | undefined;
          const errorMessage =
            errors?.[0]?.message ?? (errorBody?.message as string) ?? 'Unknown error from ISB';
          return {
            success: false,
            accounts: allAccounts,
            totalFetched: allAccounts.length,
            pagesTraversed,
            error: errorMessage,
          };
        } catch {
          return {
            success: false,
            accounts: allAccounts,
            totalFetched: allAccounts.length,
            pagesTraversed,
            error: `ISB API returned status ${statusCode}`,
          };
        }
      }

      try {
        // Parse response body - ISB returns JSend format directly (no Lambda envelope)
        const body = (await response.json()) as Record<string, unknown>;

        // Validate response schema
        const parseResult = AccountsPageResponseSchema.safeParse(body);
        if (!parseResult.success) {
          return {
            success: false,
            accounts: allAccounts,
            totalFetched: allAccounts.length,
            pagesTraversed,
            error: `Invalid accounts response schema: ${parseResult.error.message}`,
          };
        }

        // Add accounts from this page (JSend format: data.result contains accounts)
        allAccounts.push(...parseResult.data.data.result);

        // Check for next page
        pageIdentifier = parseResult.data.data.nextPageIdentifier ?? undefined;
      } catch (error) {
        return {
          success: false,
          accounts: allAccounts,
          totalFetched: allAccounts.length,
          pagesTraversed,
          /* c8 ignore next -- defensive: json() throws Error objects */
          error: `Failed to parse ISB API response: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    } while (pageIdentifier);

    return {
      success: true,
      accounts: allAccounts,
      totalFetched: allAccounts.length,
      pagesTraversed,
    };
  },

  getLease: async (params: GetLeaseLambdaParams): Promise<GetLeaseResult> => {
    const leaseIdB64 = leaseIdToCompositeKey(params.leaseId);
    const url = `${config.apiBaseUrl}/leases/${encodeURIComponent(leaseIdB64)}`;

    try {
      const response = await fetchFromISB(url, secretsClient, config.jwtSecretPath, {
        method: 'GET',
        timeoutMs: config.timeoutMs,
      });

      const statusCode = response.status;

      if (statusCode < 200 || statusCode >= 300) {
        try {
          const errorBody = (await response.json()) as Record<string, unknown>;
          const data = errorBody?.data as Record<string, unknown> | undefined;
          const errors = data?.errors as Array<{ message?: string }> | undefined;
          const errorMessage =
            errors?.[0]?.message ?? (errorBody?.message as string) ?? 'Unknown error from ISB';
          return {
            success: false,
            error: errorMessage,
          };
        } catch {
          return {
            success: false,
            error: `ISB API returned status ${statusCode}`,
          };
        }
      }

      // Parse body - ISB returns JSend format: { status: "success", data: { ... } }
      const body = (await response.json()) as Record<string, unknown>;
      const bodyData = body?.data as Record<string, unknown> | undefined;

      // Extract template name from lease details
      const templateName = bodyData?.originalLeaseTemplateName as string | undefined;

      return {
        success: true,
        templateName: templateName ?? undefined,
      };
    } catch (error) {
      return {
        success: false,
        /* c8 ignore next -- defensive: fetch throws Error objects */
        error: `Failed to get lease details: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
