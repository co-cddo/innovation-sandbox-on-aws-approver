/**
 * ISB API Client Service
 * Communicates with ISB via API Gateway using @co-cddo/isb-client with JWT auth.
 * Replaces direct Lambda invocation with HTTP API calls.
 */

import { type ISBClient, constructLeaseId } from '@co-cddo/isb-client';
import type { LeaseId, Account, GetAccountsResult } from '../lib/types.js';

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
 * ISB service interface for type-safe dependency injection
 */
export interface IsbLambdaService {
  approveLease(params: ApproveLeaseLambdaParams): Promise<IsbLambdaResult>;
  denyLease(params: DenyLeaseLambdaParams): Promise<IsbLambdaResult>;
  getAccounts(params: GetAccountsLambdaParams): Promise<GetAccountsResult>;
  getLease(params: GetLeaseLambdaParams): Promise<GetLeaseResult>;
}

/**
 * Creates an ISB service with the given client.
 * Uses factory function pattern for dependency injection and testability.
 *
 * @param client - ISB client instance (from @co-cddo/isb-client)
 * @returns ISB service instance
 *
 * @example
 * ```typescript
 * import { createISBClient } from '@co-cddo/isb-client';
 * const isbClient = createISBClient({
 *   serviceIdentity: { email: 'approver@dsit.gov.uk', roles: ['Admin'] },
 * });
 * const service = createIsbLambdaService(isbClient);
 * await service.approveLease({
 *   leaseId: { userEmail: 'user@gov.uk', uuid: 'abc-123' },
 *   approverEmail: 'ndx+try-automated-approver@dsit.gov.uk',
 * });
 * ```
 */
export const createIsbLambdaService = (
  client: ISBClient
): IsbLambdaService => ({
  approveLease: async (params: ApproveLeaseLambdaParams): Promise<IsbLambdaResult> => {
    const encodedLeaseId = constructLeaseId(params.leaseId.userEmail, params.leaseId.uuid);
    const correlationId = `approve-${params.leaseId.uuid}`;

    try {
      const result = await client.reviewLease(
        encodedLeaseId,
        { action: 'Approve', approverEmail: params.approverEmail },
        correlationId
      );

      if (result.success) {
        return { success: true, statusCode: result.statusCode, message: 'success' };
      }

      return { success: false, statusCode: result.statusCode, error: result.error };
    } catch (error) {
      return {
        success: false,
        statusCode: 500,
        error: `ISB API error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  denyLease: async (params: DenyLeaseLambdaParams): Promise<IsbLambdaResult> => {
    const encodedLeaseId = constructLeaseId(params.leaseId.userEmail, params.leaseId.uuid);
    const correlationId = `deny-${params.leaseId.uuid}`;

    try {
      const result = await client.reviewLease(
        encodedLeaseId,
        { action: 'Deny', approverEmail: params.approverEmail },
        correlationId
      );

      if (result.success) {
        return { success: true, statusCode: result.statusCode, message: 'success' };
      }

      return { success: false, statusCode: result.statusCode, error: result.error };
    } catch (error) {
      return {
        success: false,
        statusCode: 500,
        error: `ISB API error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  getAccounts: async (_params: GetAccountsLambdaParams): Promise<GetAccountsResult> => {
    const correlationId = `accounts-${Date.now()}`;

    try {
      const accounts = await client.fetchAllAccounts(correlationId);

      // Map ISBAccountRecord[] to Account[] (approver's expected shape)
      const mappedAccounts: Account[] = accounts
        .filter((a) => a.status === 'Available' || a.status === 'Active')
        .map((a) => ({
          awsAccountId: a.awsAccountId,
          name: a.name ?? a.awsAccountId,
          status: a.status as 'Available' | 'Active',
          meta: {
            createdTime: new Date().toISOString(),
            lastEditTime: new Date().toISOString(),
          },
        }));

      return {
        success: true,
        accounts: mappedAccounts,
        totalFetched: mappedAccounts.length,
        pagesTraversed: 1,
      };
    } catch (error) {
      return {
        success: false,
        accounts: [],
        totalFetched: 0,
        pagesTraversed: 0,
        error: `ISB API error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  getLease: async (params: GetLeaseLambdaParams): Promise<GetLeaseResult> => {
    const correlationId = `getlease-${params.leaseId.uuid}`;

    try {
      const lease = await client.fetchLeaseByKey(
        params.leaseId.userEmail,
        params.leaseId.uuid,
        correlationId
      );

      if (!lease) {
        return { success: false, error: 'Lease not found' };
      }

      return {
        success: true,
        templateName: lease.originalLeaseTemplateName ?? undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get lease details: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
