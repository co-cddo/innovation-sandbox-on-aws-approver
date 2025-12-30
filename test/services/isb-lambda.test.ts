import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import {
  createIsbLambdaService,
  type IsbLambdaServiceConfig,
  type ApproveLeaseLambdaParams,
  type DenyLeaseLambdaParams,
  type GetAccountsLambdaParams,
} from '../../src/services/isb-lambda.js';

// Mock the Lambda client
vi.mock('@aws-sdk/client-lambda', async () => {
  const actual = await vi.importActual('@aws-sdk/client-lambda');
  return {
    ...actual,
    LambdaClient: vi.fn().mockImplementation(() => ({
      send: vi.fn().mockResolvedValue({}),
    })),
  };
});

describe('ISB Lambda Service', () => {
  let mockClient: LambdaClient;
  let mockSend: ReturnType<typeof vi.fn>;
  const config: IsbLambdaServiceConfig = {
    functionName: 'ISB-LeasesLambdaFunction-test',
  };

  beforeEach(() => {
    mockSend = vi.fn().mockResolvedValue({
      Payload: Buffer.from(
        JSON.stringify({
          statusCode: 200,
          body: JSON.stringify({ status: 'success' }),
        })
      ),
    });
    mockClient = {
      send: mockSend,
    } as unknown as LambdaClient;
  });

  describe('createIsbLambdaService', () => {
    it('creates a service with approveLease method', () => {
      const service = createIsbLambdaService(mockClient, config);

      expect(service).toBeDefined();
      expect(typeof service.approveLease).toBe('function');
    });

    it('creates a service with denyLease method', () => {
      const service = createIsbLambdaService(mockClient, config);

      expect(service).toBeDefined();
      expect(typeof service.denyLease).toBe('function');
    });

    it('creates a service with getAccounts method', () => {
      const service = createIsbLambdaService(mockClient, config);

      expect(service).toBeDefined();
      expect(typeof service.getAccounts).toBe('function');
    });
  });

  describe('approveLease', () => {
    const approveParams: ApproveLeaseLambdaParams = {
      leaseId: {
        userEmail: 'user@example.gov.uk',
        uuid: '123e4567-e89b-12d3-a456-426614174000',
      },
      approverEmail: 'ndx+try-automated-approver@dsit.gov.uk',
    };

    it('sends an InvokeCommand with correct function name', async () => {
      const service = createIsbLambdaService(mockClient, config);

      await service.approveLease(approveParams);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0];
      expect(sentCommand).toBeInstanceOf(InvokeCommand);
    });

    it('includes correct API Gateway event payload structure', async () => {
      const service = createIsbLambdaService(mockClient, config);

      await service.approveLease(approveParams);

      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0] as InvokeCommand;
      const payload = JSON.parse(Buffer.from(sentCommand.input.Payload as Buffer).toString());

      expect(payload.httpMethod).toBe('POST');
      expect(payload.path).toContain('/leases/');
      expect(payload.path).toContain('/review');
      expect(payload.body).toBe(JSON.stringify({ action: 'Approve' }));
    });

    it('includes Authorization header with JWT', async () => {
      const service = createIsbLambdaService(mockClient, config);

      await service.approveLease(approveParams);

      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0] as InvokeCommand;
      const payload = JSON.parse(Buffer.from(sentCommand.input.Payload as Buffer).toString());

      expect(payload.headers.Authorization).toMatch(/^Bearer .+\..+\..+$/);
      expect(payload.headers['Content-Type']).toBe('application/json');
    });

    it('encodes leaseId as base64 in path parameter', async () => {
      const service = createIsbLambdaService(mockClient, config);

      await service.approveLease(approveParams);

      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0] as InvokeCommand;
      const payload = JSON.parse(Buffer.from(sentCommand.input.Payload as Buffer).toString());

      // Decode the leaseId from the path
      const leaseIdB64 = payload.pathParameters.leaseId;
      const decodedLeaseId = JSON.parse(Buffer.from(leaseIdB64, 'base64').toString());

      expect(decodedLeaseId.userEmail).toBe(approveParams.leaseId.userEmail);
      expect(decodedLeaseId.uuid).toBe(approveParams.leaseId.uuid);
    });

    it('returns success result on 200 response', async () => {
      const service = createIsbLambdaService(mockClient, config);

      const result = await service.approveLease(approveParams);

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.message).toBe('success');
    });

    it('returns failure on non-2xx response', async () => {
      mockSend.mockResolvedValue({
        Payload: Buffer.from(
          JSON.stringify({
            statusCode: 400,
            body: JSON.stringify({ message: 'Lease not found' }),
          })
        ),
      });

      const service = createIsbLambdaService(mockClient, config);
      const result = await service.approveLease(approveParams);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(400);
      expect(result.error).toBe('Lease not found');
    });

    it('handles Lambda function error', async () => {
      mockSend.mockResolvedValue({
        FunctionError: 'Unhandled',
        Payload: Buffer.from('{}'),
      });

      const service = createIsbLambdaService(mockClient, config);
      const result = await service.approveLease(approveParams);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
      expect(result.error).toContain('Lambda function error');
    });

    it('handles empty payload response', async () => {
      mockSend.mockResolvedValue({
        Payload: undefined,
      });

      const service = createIsbLambdaService(mockClient, config);
      const result = await service.approveLease(approveParams);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
      expect(result.error).toBe('Empty response from ISB Lambda');
    });

    it('handles malformed JSON response', async () => {
      mockSend.mockResolvedValue({
        Payload: Buffer.from('not valid json'),
      });

      const service = createIsbLambdaService(mockClient, config);
      const result = await service.approveLease(approveParams);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
      expect(result.error).toContain('Failed to parse ISB Lambda response');
    });

    it('extracts error from ISB JSend response format', async () => {
      mockSend.mockResolvedValue({
        Payload: Buffer.from(
          JSON.stringify({
            statusCode: 409,
            body: JSON.stringify({
              data: {
                errors: [{ message: 'Lease already approved' }],
              },
            }),
          })
        ),
      });

      const service = createIsbLambdaService(mockClient, config);
      const result = await service.approveLease(approveParams);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Lease already approved');
    });

    it('propagates client errors', async () => {
      const error = new Error('Lambda unavailable');
      mockSend.mockRejectedValue(error);

      const service = createIsbLambdaService(mockClient, config);

      await expect(service.approveLease(approveParams)).rejects.toThrow('Lambda unavailable');
    });
  });

  describe('denyLease', () => {
    const denyParams: DenyLeaseLambdaParams = {
      leaseId: {
        userEmail: 'user@example.gov.uk',
        uuid: '123e4567-e89b-12d3-a456-426614174000',
      },
      approverEmail: 'ndx+try-automated-approver@dsit.gov.uk',
    };

    it('sends Deny action in request body', async () => {
      const service = createIsbLambdaService(mockClient, config);

      await service.denyLease(denyParams);

      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0] as InvokeCommand;
      const payload = JSON.parse(Buffer.from(sentCommand.input.Payload as Buffer).toString());

      expect(payload.body).toBe(JSON.stringify({ action: 'Deny' }));
    });

    it('returns success result on 200 response', async () => {
      const service = createIsbLambdaService(mockClient, config);

      const result = await service.denyLease(denyParams);

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
    });

    it('handles Lambda function error', async () => {
      mockSend.mockResolvedValue({
        FunctionError: 'Unhandled',
        Payload: Buffer.from('{}'),
      });

      const service = createIsbLambdaService(mockClient, config);
      const result = await service.denyLease(denyParams);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Lambda function error');
    });

    it('propagates client errors', async () => {
      const error = new Error('Lambda unavailable');
      mockSend.mockRejectedValue(error);

      const service = createIsbLambdaService(mockClient, config);

      await expect(service.denyLease(denyParams)).rejects.toThrow('Lambda unavailable');
    });
  });

  describe('JWT token generation', () => {
    it('includes approver email in JWT payload', async () => {
      const service = createIsbLambdaService(mockClient, config);

      await service.approveLease({
        leaseId: {
          userEmail: 'user@example.gov.uk',
          uuid: '123e4567-e89b-12d3-a456-426614174000',
        },
        approverEmail: 'custom-approver@gov.uk',
      });

      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0] as InvokeCommand;
      const payload = JSON.parse(Buffer.from(sentCommand.input.Payload as Buffer).toString());

      // Extract and decode JWT payload
      const jwtToken = payload.headers.Authorization.replace('Bearer ', '');
      const [, jwtPayloadB64] = jwtToken.split('.');
      // Add padding if needed for base64url decoding
      const paddedPayload = jwtPayloadB64 + '=='.slice((2 - jwtPayloadB64.length * 3) & 3);
      const jwtPayload = JSON.parse(
        Buffer.from(paddedPayload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()
      );

      expect(jwtPayload.user.email).toBe('custom-approver@gov.uk');
      expect(jwtPayload.user.roles).toContain('Admin');
    });
  });

  describe('getAccounts', () => {
    const getAccountsParams: GetAccountsLambdaParams = {
      approverEmail: 'ndx+try-automated-approver@dsit.gov.uk',
    };

    // Helper to create a mock accounts response
    const createAccountsResponse = (
      accounts: Array<{
        awsAccountId: string;
        name: string;
        status: 'Available' | 'Active';
        createdTime: string;
        lastEditTime: string;
      }>,
      nextPageIdentifier?: string | null
    ) => ({
      statusCode: 200,
      body: JSON.stringify({
        accounts: accounts.map((a) => ({
          awsAccountId: a.awsAccountId,
          name: a.name,
          status: a.status,
          meta: {
            createdTime: a.createdTime,
            lastEditTime: a.lastEditTime,
          },
        })),
        nextPageIdentifier: nextPageIdentifier ?? null,
      }),
    });

    it('sends GET request to /accounts', async () => {
      mockSend.mockResolvedValue({
        Payload: Buffer.from(
          JSON.stringify(
            createAccountsResponse([
              {
                awsAccountId: '123456789012',
                name: 'pool-001',
                status: 'Available',
                createdTime: '2025-01-01T00:00:00Z',
                lastEditTime: '2025-12-28T14:30:00Z',
              },
            ])
          )
        ),
      });

      const service = createIsbLambdaService(mockClient, config);
      await service.getAccounts(getAccountsParams);

      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0] as InvokeCommand;
      const payload = JSON.parse(Buffer.from(sentCommand.input.Payload as Buffer).toString());

      expect(payload.httpMethod).toBe('GET');
      expect(payload.path).toBe('/accounts');
      expect(payload.resource).toBe('/accounts');
    });

    it('returns accounts on successful single page response', async () => {
      mockSend.mockResolvedValue({
        Payload: Buffer.from(
          JSON.stringify(
            createAccountsResponse([
              {
                awsAccountId: '123456789012',
                name: 'pool-001',
                status: 'Available',
                createdTime: '2025-01-01T00:00:00Z',
                lastEditTime: '2025-12-28T14:30:00Z',
              },
              {
                awsAccountId: '123456789013',
                name: 'pool-002',
                status: 'Active',
                createdTime: '2025-01-02T00:00:00Z',
                lastEditTime: '2025-12-29T10:00:00Z',
              },
            ])
          )
        ),
      });

      const service = createIsbLambdaService(mockClient, config);
      const result = await service.getAccounts(getAccountsParams);

      expect(result.success).toBe(true);
      expect(result.accounts).toHaveLength(2);
      expect(result.totalFetched).toBe(2);
      expect(result.pagesTraversed).toBe(1);
      expect(result.accounts[0]?.awsAccountId).toBe('123456789012');
      expect(result.accounts[0]?.status).toBe('Available');
      expect(result.accounts[1]?.status).toBe('Active');
    });

    it('handles multi-page pagination (2 pages)', async () => {
      // First page with nextPageIdentifier
      mockSend.mockResolvedValueOnce({
        Payload: Buffer.from(
          JSON.stringify(
            createAccountsResponse(
              [
                {
                  awsAccountId: '123456789012',
                  name: 'pool-001',
                  status: 'Available',
                  createdTime: '2025-01-01T00:00:00Z',
                  lastEditTime: '2025-12-28T14:30:00Z',
                },
              ],
              'page2token'
            )
          )
        ),
      });

      // Second page without nextPageIdentifier
      mockSend.mockResolvedValueOnce({
        Payload: Buffer.from(
          JSON.stringify(
            createAccountsResponse([
              {
                awsAccountId: '123456789013',
                name: 'pool-002',
                status: 'Active',
                createdTime: '2025-01-02T00:00:00Z',
                lastEditTime: '2025-12-29T10:00:00Z',
              },
            ])
          )
        ),
      });

      const service = createIsbLambdaService(mockClient, config);
      const result = await service.getAccounts(getAccountsParams);

      expect(result.success).toBe(true);
      expect(result.accounts).toHaveLength(2);
      expect(result.totalFetched).toBe(2);
      expect(result.pagesTraversed).toBe(2);
      expect(mockSend).toHaveBeenCalledTimes(2);

      // Verify second call includes pageIdentifier
      const secondCallArgs = mockSend.mock.calls[1] as unknown[];
      const secondCommand = secondCallArgs[0] as InvokeCommand;
      const secondPayload = JSON.parse(
        Buffer.from(secondCommand.input.Payload as Buffer).toString()
      );
      expect(secondPayload.queryStringParameters?.pageIdentifier).toBe('page2token');
    });

    it('handles multi-page pagination (3 pages)', async () => {
      // First page
      mockSend.mockResolvedValueOnce({
        Payload: Buffer.from(
          JSON.stringify(
            createAccountsResponse(
              [
                {
                  awsAccountId: '111111111111',
                  name: 'pool-001',
                  status: 'Available',
                  createdTime: '2025-01-01T00:00:00Z',
                  lastEditTime: '2025-12-28T14:30:00Z',
                },
              ],
              'page2'
            )
          )
        ),
      });

      // Second page
      mockSend.mockResolvedValueOnce({
        Payload: Buffer.from(
          JSON.stringify(
            createAccountsResponse(
              [
                {
                  awsAccountId: '222222222222',
                  name: 'pool-002',
                  status: 'Active',
                  createdTime: '2025-01-02T00:00:00Z',
                  lastEditTime: '2025-12-29T10:00:00Z',
                },
              ],
              'page3'
            )
          )
        ),
      });

      // Third page (final)
      mockSend.mockResolvedValueOnce({
        Payload: Buffer.from(
          JSON.stringify(
            createAccountsResponse([
              {
                awsAccountId: '333333333333',
                name: 'pool-003',
                status: 'Available',
                createdTime: '2025-01-03T00:00:00Z',
                lastEditTime: '2025-12-29T12:00:00Z',
              },
            ])
          )
        ),
      });

      const service = createIsbLambdaService(mockClient, config);
      const result = await service.getAccounts(getAccountsParams);

      expect(result.success).toBe(true);
      expect(result.accounts).toHaveLength(3);
      expect(result.totalFetched).toBe(3);
      expect(result.pagesTraversed).toBe(3);
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it('returns empty accounts array on empty response', async () => {
      mockSend.mockResolvedValue({
        Payload: Buffer.from(JSON.stringify(createAccountsResponse([]))),
      });

      const service = createIsbLambdaService(mockClient, config);
      const result = await service.getAccounts(getAccountsParams);

      expect(result.success).toBe(true);
      expect(result.accounts).toHaveLength(0);
      expect(result.totalFetched).toBe(0);
      expect(result.pagesTraversed).toBe(1);
    });

    it('returns failure on Lambda function error', async () => {
      mockSend.mockResolvedValue({
        FunctionError: 'Unhandled',
        Payload: Buffer.from('{}'),
      });

      const service = createIsbLambdaService(mockClient, config);
      const result = await service.getAccounts(getAccountsParams);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Lambda function error');
    });

    it('returns failure on empty payload', async () => {
      mockSend.mockResolvedValue({
        Payload: undefined,
      });

      const service = createIsbLambdaService(mockClient, config);
      const result = await service.getAccounts(getAccountsParams);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Empty response from ISB Lambda');
    });

    it('returns failure on non-2xx status code', async () => {
      mockSend.mockResolvedValue({
        Payload: Buffer.from(
          JSON.stringify({
            statusCode: 403,
            body: JSON.stringify({ message: 'Forbidden' }),
          })
        ),
      });

      const service = createIsbLambdaService(mockClient, config);
      const result = await service.getAccounts(getAccountsParams);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Forbidden');
    });

    it('returns failure on malformed JSON response', async () => {
      mockSend.mockResolvedValue({
        Payload: Buffer.from('not valid json'),
      });

      const service = createIsbLambdaService(mockClient, config);
      const result = await service.getAccounts(getAccountsParams);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to parse ISB Lambda response');
    });

    it('returns failure on invalid account schema', async () => {
      mockSend.mockResolvedValue({
        Payload: Buffer.from(
          JSON.stringify({
            statusCode: 200,
            body: JSON.stringify({
              accounts: [
                {
                  // Missing required fields
                  awsAccountId: '123456789012',
                  name: 'pool-001',
                  // status is missing
                },
              ],
            }),
          })
        ),
      });

      const service = createIsbLambdaService(mockClient, config);
      const result = await service.getAccounts(getAccountsParams);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid accounts response schema');
    });

    it('propagates client errors', async () => {
      const error = new Error('Lambda unavailable');
      mockSend.mockRejectedValue(error);

      const service = createIsbLambdaService(mockClient, config);

      await expect(service.getAccounts(getAccountsParams)).rejects.toThrow('Lambda unavailable');
    });

    it('includes Authorization header with JWT', async () => {
      mockSend.mockResolvedValue({
        Payload: Buffer.from(JSON.stringify(createAccountsResponse([]))),
      });

      const service = createIsbLambdaService(mockClient, config);
      await service.getAccounts(getAccountsParams);

      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0] as InvokeCommand;
      const payload = JSON.parse(Buffer.from(sentCommand.input.Payload as Buffer).toString());

      expect(payload.headers.Authorization).toMatch(/^Bearer .+\..+\..+$/);
    });

    it('returns error when pagination exceeds MAX_PAGINATION_PAGES limit (infinite loop prevention)', async () => {
      // Setup mockSend to always return a page with nextPageIdentifier
      // This simulates an infinite loop scenario
      const infinitePageResponse = createAccountsResponse(
        [
          {
            awsAccountId: '123456789012',
            name: 'pool-001',
            status: 'Available',
            createdTime: '2025-01-01T00:00:00Z',
            lastEditTime: '2025-12-28T14:30:00Z',
          },
        ],
        'always-has-next'
      );

      // Mock 101 calls to trigger the safety limit (MAX_PAGINATION_PAGES = 100)
      mockSend.mockResolvedValue({
        Payload: Buffer.from(JSON.stringify(infinitePageResponse)),
      });

      const service = createIsbLambdaService(mockClient, config);
      const result = await service.getAccounts(getAccountsParams);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Pagination exceeded 100 pages');
      expect(result.pagesTraversed).toBe(101);
      // Should have accumulated accounts from 100 pages before hitting the limit
      expect(result.accounts.length).toBe(100);
    });

    it('continues fetching until nextPageIdentifier is null (pagination termination)', async () => {
      // Page 1 with nextPageIdentifier as string
      mockSend.mockResolvedValueOnce({
        Payload: Buffer.from(
          JSON.stringify(
            createAccountsResponse(
              [
                {
                  awsAccountId: '111111111111',
                  name: 'pool-001',
                  status: 'Available',
                  createdTime: '2025-01-01T00:00:00Z',
                  lastEditTime: '2025-12-28T14:30:00Z',
                },
              ],
              'next'
            )
          )
        ),
      });

      // Page 2 with nextPageIdentifier as null (explicit)
      mockSend.mockResolvedValueOnce({
        Payload: Buffer.from(
          JSON.stringify(
            createAccountsResponse(
              [
                {
                  awsAccountId: '222222222222',
                  name: 'pool-002',
                  status: 'Active',
                  createdTime: '2025-01-02T00:00:00Z',
                  lastEditTime: '2025-12-29T10:00:00Z',
                },
              ],
              null
            )
          )
        ),
      });

      const service = createIsbLambdaService(mockClient, config);
      const result = await service.getAccounts(getAccountsParams);

      expect(result.success).toBe(true);
      expect(result.pagesTraversed).toBe(2);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });
});
