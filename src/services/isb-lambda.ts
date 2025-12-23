/**
 * ISB Lambda Client Service
 * Directly invokes ISB's LeasesLambdaFunction to approve/deny leases
 * Bypasses API Gateway authentication by constructing the request payload
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { LeaseId } from '../lib/types.js';

/**
 * Parameters for approving a lease via ISB Lambda
 */
export interface ApproveLeaseLambdaParams {
  readonly leaseId: LeaseId;
  readonly approverEmail: string;
}

/**
 * Parameters for denying a lease via ISB Lambda
 */
export interface DenyLeaseLambdaParams {
  readonly leaseId: LeaseId;
  readonly approverEmail: string;
}

/**
 * Result from ISB Lambda invocation
 */
export interface IsbLambdaResult {
  readonly success: boolean;
  readonly statusCode: number;
  readonly message?: string;
  readonly error?: string;
}

/**
 * ISB Lambda service configuration
 */
export interface IsbLambdaServiceConfig {
  readonly functionName: string;
}

/**
 * ISB Lambda service interface for type-safe dependency injection
 */
export interface IsbLambdaService {
  approveLease(params: ApproveLeaseLambdaParams): Promise<IsbLambdaResult>;
  denyLease(params: DenyLeaseLambdaParams): Promise<IsbLambdaResult>;
}

/**
 * Creates a base64-encoded composite key for the leaseId path parameter
 */
const encodeLeaseId = (leaseId: LeaseId): string => {
  const json = JSON.stringify({
    userEmail: leaseId.userEmail,
    uuid: leaseId.uuid,
  });
  return Buffer.from(json).toString('base64');
};

/**
 * Creates a JWT token with the approver user info
 * Note: This JWT is only decoded (not verified) by ISB when invoked via Lambda
 */
const createApproverJwt = (approverEmail: string): string => {
  // JWT header
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  // JWT payload with user info - Admin role required for approval
  const payload = Buffer.from(
    JSON.stringify({
      user: {
        email: approverEmail,
        roles: ['Admin'],
      },
    })
  )
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  // Signature not verified for direct Lambda invocation
  return `${header}.${payload}.directinvoke`;
};

/**
 * Creates the API Gateway event payload for Lambda invocation
 */
const createApiGatewayEvent = (
  leaseIdB64: string,
  action: 'Approve' | 'Deny',
  approverJwt: string
): Record<string, unknown> => ({
  httpMethod: 'POST',
  path: `/leases/${leaseIdB64}/review`,
  pathParameters: {
    leaseId: leaseIdB64,
  },
  headers: {
    Authorization: `Bearer ${approverJwt}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ action }),
  requestContext: {
    httpMethod: 'POST',
    path: `/leases/${leaseIdB64}/review`,
    extendedRequestId: `approver-${Date.now()}`,
  },
  resource: '/leases/{leaseId}/review',
  isBase64Encoded: false,
});

/**
 * Parses the Lambda response
 */
const parseResponse = (payload: Uint8Array | undefined): IsbLambdaResult => {
  if (!payload) {
    return {
      success: false,
      statusCode: 500,
      error: 'Empty response from ISB Lambda',
    };
  }

  try {
    const response = JSON.parse(Buffer.from(payload).toString());
    const statusCode = response.statusCode ?? 500;
    const body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;

    if (statusCode >= 200 && statusCode < 300) {
      return {
        success: true,
        statusCode,
        message: body?.status ?? 'success',
      };
    }

    // Extract error message from ISB's JSend response format
    const errorMessage =
      body?.data?.errors?.[0]?.message ?? body?.message ?? 'Unknown error from ISB';

    return {
      success: false,
      statusCode,
      error: errorMessage,
    };
  } catch (error) {
    return {
      success: false,
      statusCode: 500,
      error: `Failed to parse ISB Lambda response: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

/**
 * Creates an ISB Lambda service with the given client and configuration.
 * Uses factory function pattern for dependency injection and testability.
 *
 * @param client - Lambda client instance
 * @param config - Configuration including function name and approver email
 * @returns ISB Lambda service instance
 *
 * @example
 * ```typescript
 * const client = new LambdaClient({ region: 'us-west-2' });
 * const service = createIsbLambdaService(client, {
 *   functionName: 'ISB-LeasesLambdaFunction-ndx',
 *   approverEmail: 'ndx+try-automated-approver@dsit.gov.uk',
 * });
 * await service.approveLease({
 *   leaseId: { userEmail: 'user@gov.uk', uuid: 'abc-123' },
 *   approverEmail: 'ndx+try-automated-approver@dsit.gov.uk',
 * });
 * ```
 */
export const createIsbLambdaService = (
  client: LambdaClient,
  config: IsbLambdaServiceConfig
): IsbLambdaService => ({
  approveLease: async (params: ApproveLeaseLambdaParams): Promise<IsbLambdaResult> => {
    const leaseIdB64 = encodeLeaseId(params.leaseId);
    const approverJwt = createApproverJwt(params.approverEmail);
    const payload = createApiGatewayEvent(leaseIdB64, 'Approve', approverJwt);

    const command = new InvokeCommand({
      FunctionName: config.functionName,
      Payload: Buffer.from(JSON.stringify(payload)),
    });

    const response = await client.send(command);

    // Check for Lambda invocation errors
    if (response.FunctionError) {
      return {
        success: false,
        statusCode: 500,
        error: `Lambda function error: ${response.FunctionError}`,
      };
    }

    return parseResponse(response.Payload);
  },

  denyLease: async (params: DenyLeaseLambdaParams): Promise<IsbLambdaResult> => {
    const leaseIdB64 = encodeLeaseId(params.leaseId);
    const approverJwt = createApproverJwt(params.approverEmail);
    const payload = createApiGatewayEvent(leaseIdB64, 'Deny', approverJwt);

    const command = new InvokeCommand({
      FunctionName: config.functionName,
      Payload: Buffer.from(JSON.stringify(payload)),
    });

    const response = await client.send(command);

    // Check for Lambda invocation errors
    if (response.FunctionError) {
      return {
        success: false,
        statusCode: 500,
        error: `Lambda function error: ${response.FunctionError}`,
      };
    }

    return parseResponse(response.Payload);
  },
});
