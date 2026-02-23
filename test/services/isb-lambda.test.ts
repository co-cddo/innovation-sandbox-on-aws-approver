import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import {
  createIsbLambdaService,
  signJwt,
  resetTokenCache,
  type IsbLambdaServiceConfig,
  type ApproveLeaseLambdaParams,
  type DenyLeaseLambdaParams,
  type GetAccountsLambdaParams,
} from '../../src/services/isb-lambda.js';

// Mock SecretsManager client
vi.mock('@aws-sdk/client-secrets-manager', async () => {
  const actual = await vi.importActual('@aws-sdk/client-secrets-manager');
  return {
    ...actual,
    SecretsManagerClient: vi.fn().mockImplementation(() => ({
      send: vi.fn().mockResolvedValue({}),
    })),
  };
});

// Helper to create a mock Response
const createMockResponse = (body: unknown, status = 200): Response => {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: vi.fn().mockResolvedValue(body),
    headers: new Headers(),
    redirected: false,
    statusText: status === 200 ? 'OK' : 'Error',
    type: 'basic' as ResponseType,
    url: '',
    clone: vi.fn(),
    body: null,
    bodyUsed: false,
    arrayBuffer: vi.fn(),
    blob: vi.fn(),
    formData: vi.fn(),
    text: vi.fn(),
    bytes: vi.fn(),
  } as unknown as Response;
};

describe('ISB API Service', () => {
  let mockSecretsClient: SecretsManagerClient;
  let mockSecretsSend: ReturnType<typeof vi.fn>;
  let mockFetch: ReturnType<typeof vi.fn>;
  const config: IsbLambdaServiceConfig = {
    apiBaseUrl: 'https://isb-api.example.com',
    jwtSecretPath: '/approver/isb-jwt-secret',
  };

  beforeEach(() => {
    // Reset token cache between tests
    resetTokenCache();

    // Mock SecretsManager
    mockSecretsSend = vi.fn().mockResolvedValue({
      SecretString: 'test-jwt-secret-key',
    });
    mockSecretsClient = {
      send: mockSecretsSend,
    } as unknown as SecretsManagerClient;

    // Mock global.fetch
    mockFetch = vi.fn().mockResolvedValue(createMockResponse({ status: 'success' }));
    vi.stubGlobal('fetch', mockFetch);

    // Set APPROVER_EMAIL env var
    vi.stubEnv('APPROVER_EMAIL', 'ndx+try-automated-approver@dsit.gov.uk');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe('signJwt', () => {
    it('produces a valid HS256 JWT with 3 parts', () => {
      const token = signJwt({ user: { email: 'test@gov.uk' } }, 'secret');
      const parts = token.split('.');
      expect(parts).toHaveLength(3);
    });

    it('includes correct header with HS256 algorithm', () => {
      const token = signJwt({ user: { email: 'test@gov.uk' } }, 'secret');
      const [headerB64] = token.split('.');
      const header = JSON.parse(Buffer.from(headerB64!, 'base64url').toString());
      expect(header.alg).toBe('HS256');
      expect(header.typ).toBe('JWT');
    });

    it('includes iat and exp claims in payload', () => {
      const token = signJwt({ user: { email: 'test@gov.uk' } }, 'secret', 7200);
      const [, payloadB64] = token.split('.');
      const payload = JSON.parse(Buffer.from(payloadB64!, 'base64url').toString());
      expect(payload.iat).toBeDefined();
      expect(payload.exp).toBeDefined();
      expect(payload.exp - payload.iat).toBe(7200);
    });

    it('includes custom payload fields', () => {
      const token = signJwt({ user: { email: 'test@gov.uk', roles: ['Admin'] } }, 'secret');
      const [, payloadB64] = token.split('.');
      const payload = JSON.parse(Buffer.from(payloadB64!, 'base64url').toString());
      expect(payload.user.email).toBe('test@gov.uk');
      expect(payload.user.roles).toContain('Admin');
    });
  });

  describe('Token caching', () => {
    it('fetches secret from SecretsManager on first call', async () => {
      const service = createIsbLambdaService(mockSecretsClient, config);
      await service.approveLease({
        leaseId: { userEmail: 'user@gov.uk', uuid: '123e4567-e89b-12d3-a456-426614174000' },
        approverEmail: 'approver@gov.uk',
      });

      expect(mockSecretsSend).toHaveBeenCalledTimes(1);
    });

    it('reuses cached secret on subsequent calls', async () => {
      const service = createIsbLambdaService(mockSecretsClient, config);

      await service.approveLease({
        leaseId: { userEmail: 'user@gov.uk', uuid: '123e4567-e89b-12d3-a456-426614174000' },
        approverEmail: 'approver@gov.uk',
      });
      await service.approveLease({
        leaseId: { userEmail: 'user@gov.uk', uuid: '123e4567-e89b-12d3-a456-426614174000' },
        approverEmail: 'approver@gov.uk',
      });

      // SecretsManager should only be called once (cached)
      expect(mockSecretsSend).toHaveBeenCalledTimes(1);
    });

    it('throws when JWT secret is empty', async () => {
      mockSecretsSend.mockResolvedValue({ SecretString: '' });
      const service = createIsbLambdaService(mockSecretsClient, config);

      await expect(
        service.approveLease({
          leaseId: { userEmail: 'user@gov.uk', uuid: '123e4567-e89b-12d3-a456-426614174000' },
          approverEmail: 'approver@gov.uk',
        })
      ).rejects.toThrow('JWT secret is empty');
    });

    it('invalidates cache on 401 response and re-fetches on next call', async () => {
      // First call succeeds
      mockFetch.mockResolvedValueOnce(createMockResponse({ status: 'success' }));

      const service = createIsbLambdaService(mockSecretsClient, config);
      await service.approveLease({
        leaseId: { userEmail: 'user@gov.uk', uuid: '123e4567-e89b-12d3-a456-426614174000' },
        approverEmail: 'approver@gov.uk',
      });
      expect(mockSecretsSend).toHaveBeenCalledTimes(1);

      // Second call returns 401 - should invalidate cache
      mockFetch.mockResolvedValueOnce(createMockResponse({ message: 'Unauthorized' }, 401));
      await service.approveLease({
        leaseId: { userEmail: 'user@gov.uk', uuid: '123e4567-e89b-12d3-a456-426614174000' },
        approverEmail: 'approver@gov.uk',
      });

      // Third call should re-fetch secret
      mockFetch.mockResolvedValueOnce(createMockResponse({ status: 'success' }));
      await service.approveLease({
        leaseId: { userEmail: 'user@gov.uk', uuid: '123e4567-e89b-12d3-a456-426614174000' },
        approverEmail: 'approver@gov.uk',
      });

      expect(mockSecretsSend).toHaveBeenCalledTimes(2);
    });

    it('invalidates cache on 403 response', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ status: 'success' }));

      const service = createIsbLambdaService(mockSecretsClient, config);
      await service.approveLease({
        leaseId: { userEmail: 'user@gov.uk', uuid: '123e4567-e89b-12d3-a456-426614174000' },
        approverEmail: 'approver@gov.uk',
      });

      // 403 should invalidate cache
      mockFetch.mockResolvedValueOnce(createMockResponse({ message: 'Forbidden' }, 403));
      await service.denyLease({
        leaseId: { userEmail: 'user@gov.uk', uuid: '123e4567-e89b-12d3-a456-426614174000' },
        approverEmail: 'approver@gov.uk',
      });

      // Next call should re-fetch secret
      mockFetch.mockResolvedValueOnce(createMockResponse({ status: 'success' }));
      await service.approveLease({
        leaseId: { userEmail: 'user@gov.uk', uuid: '123e4567-e89b-12d3-a456-426614174000' },
        approverEmail: 'approver@gov.uk',
      });

      expect(mockSecretsSend).toHaveBeenCalledTimes(2);
    });
  });

  describe('createIsbLambdaService', () => {
    it('creates a service with all required methods', () => {
      const service = createIsbLambdaService(mockSecretsClient, config);

      expect(typeof service.approveLease).toBe('function');
      expect(typeof service.denyLease).toBe('function');
      expect(typeof service.getAccounts).toBe('function');
      expect(typeof service.getLease).toBe('function');
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

    it('sends POST request to /leases/{leaseId}/review', async () => {
      const service = createIsbLambdaService(mockSecretsClient, config);
      await service.approveLease(approveParams);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/leases/');
      expect(url).toContain('/review');
      expect(options.method).toBe('POST');
    });

    it('includes Authorization header with JWT', async () => {
      const service = createIsbLambdaService(mockSecretsClient, config);
      await service.approveLease(approveParams);

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = options.headers as Record<string, string>;
      expect(headers.Authorization).toMatch(/^Bearer .+\..+\..+$/);
    });

    it('includes Approve action in request body', async () => {
      const service = createIsbLambdaService(mockSecretsClient, config);
      await service.approveLease(approveParams);

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(options.body).toBe(JSON.stringify({ action: 'Approve' }));
    });

    it('encodes leaseId as base64 in URL path', async () => {
      const service = createIsbLambdaService(mockSecretsClient, config);
      await service.approveLease(approveParams);

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      // URL should contain base64-encoded leaseId
      const urlPath = url.replace(config.apiBaseUrl, '');
      const leaseIdB64 = decodeURIComponent(urlPath.split('/')[2]!);
      const decoded = JSON.parse(Buffer.from(leaseIdB64, 'base64').toString());
      expect(decoded.userEmail).toBe(approveParams.leaseId.userEmail);
      expect(decoded.uuid).toBe(approveParams.leaseId.uuid);
    });

    it('returns success result on 200 response', async () => {
      const service = createIsbLambdaService(mockSecretsClient, config);
      const result = await service.approveLease(approveParams);

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.message).toBe('success');
    });

    it('returns failure on non-2xx response', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ message: 'Lease not found' }, 400));

      const service = createIsbLambdaService(mockSecretsClient, config);
      const result = await service.approveLease(approveParams);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(400);
      expect(result.error).toBe('Lease not found');
    });

    it('extracts error from ISB JSend response format', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({ data: { errors: [{ message: 'Lease already approved' }] } }, 409)
      );

      const service = createIsbLambdaService(mockSecretsClient, config);
      const result = await service.approveLease(approveParams);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Lease already approved');
    });

    it('uses "success" default message when body.status is undefined', async () => {
      mockFetch.mockResolvedValue(createMockResponse({}));

      const service = createIsbLambdaService(mockSecretsClient, config);
      const result = await service.approveLease(approveParams);

      expect(result.success).toBe(true);
      expect(result.message).toBe('success');
    });

    it('falls back to body.message when JSend errors array is missing', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({ message: 'Validation failed', data: {} }, 400)
      );

      const service = createIsbLambdaService(mockSecretsClient, config);
      const result = await service.approveLease(approveParams);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Validation failed');
    });

    it('uses "Unknown error from ISB" when no error message available', async () => {
      mockFetch.mockResolvedValue(createMockResponse({}, 500));

      const service = createIsbLambdaService(mockSecretsClient, config);
      const result = await service.approveLease(approveParams);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error from ISB');
    });

    it('handles HTTP 404 response', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ message: 'Not found' }, 404));

      const service = createIsbLambdaService(mockSecretsClient, config);
      const result = await service.approveLease(approveParams);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(404);
    });

    it('handles HTTP 502 response', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ message: 'Bad Gateway' }, 502));

      const service = createIsbLambdaService(mockSecretsClient, config);
      const result = await service.approveLease(approveParams);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(502);
    });

    it('handles HTTP 503 response', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ message: 'Service Unavailable' }, 503));

      const service = createIsbLambdaService(mockSecretsClient, config);
      const result = await service.approveLease(approveParams);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(503);
    });

    it('propagates network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const service = createIsbLambdaService(mockSecretsClient, config);
      await expect(service.approveLease(approveParams)).rejects.toThrow('Network error');
    });

    it('uses AbortSignal.timeout for requests', async () => {
      const configWithTimeout: IsbLambdaServiceConfig = {
        ...config,
        timeoutMs: 3000,
      };
      const service = createIsbLambdaService(mockSecretsClient, configWithTimeout);
      await service.approveLease(approveParams);

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(options.signal).toBeDefined();
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
      const service = createIsbLambdaService(mockSecretsClient, config);
      await service.denyLease(denyParams);

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(options.body).toBe(JSON.stringify({ action: 'Deny' }));
    });

    it('returns success result on 200 response', async () => {
      const service = createIsbLambdaService(mockSecretsClient, config);
      const result = await service.denyLease(denyParams);

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
    });

    it('returns failure on error response', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ message: 'Lease not found' }, 404));

      const service = createIsbLambdaService(mockSecretsClient, config);
      const result = await service.denyLease(denyParams);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(404);
    });

    it('propagates network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const service = createIsbLambdaService(mockSecretsClient, config);
      await expect(service.denyLease(denyParams)).rejects.toThrow('Network error');
    });
  });

  describe('getAccounts', () => {
    const getAccountsParams: GetAccountsLambdaParams = {
      approverEmail: 'ndx+try-automated-approver@dsit.gov.uk',
    };

    // Helper to create a mock accounts response (JSend format)
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
      status: 'success',
      data: {
        result: accounts.map((a) => ({
          awsAccountId: a.awsAccountId,
          name: a.name,
          status: a.status,
          meta: {
            createdTime: a.createdTime,
            lastEditTime: a.lastEditTime,
          },
        })),
        nextPageIdentifier: nextPageIdentifier ?? null,
      },
    });

    it('sends GET request to /accounts', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse(
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
      );

      const service = createIsbLambdaService(mockSecretsClient, config);
      await service.getAccounts(getAccountsParams);

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://isb-api.example.com/accounts');
      expect(options.method).toBe('GET');
    });

    it('returns accounts on successful single page response', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse(
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
      );

      const service = createIsbLambdaService(mockSecretsClient, config);
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
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
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
      );

      // Second page without nextPageIdentifier
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
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
      );

      const service = createIsbLambdaService(mockSecretsClient, config);
      const result = await service.getAccounts(getAccountsParams);

      expect(result.success).toBe(true);
      expect(result.accounts).toHaveLength(2);
      expect(result.totalFetched).toBe(2);
      expect(result.pagesTraversed).toBe(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Verify second call includes pageIdentifier
      const [secondUrl] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(secondUrl).toContain('pageIdentifier=page2token');
    });

    it('handles multi-page pagination (3 pages)', async () => {
      mockFetch
        .mockResolvedValueOnce(
          createMockResponse(
            createAccountsResponse(
              [
                {
                  awsAccountId: '111',
                  name: 'p1',
                  status: 'Available',
                  createdTime: '2025-01-01T00:00:00Z',
                  lastEditTime: '2025-01-01T00:00:00Z',
                },
              ],
              'page2'
            )
          )
        )
        .mockResolvedValueOnce(
          createMockResponse(
            createAccountsResponse(
              [
                {
                  awsAccountId: '222',
                  name: 'p2',
                  status: 'Active',
                  createdTime: '2025-01-02T00:00:00Z',
                  lastEditTime: '2025-01-02T00:00:00Z',
                },
              ],
              'page3'
            )
          )
        )
        .mockResolvedValueOnce(
          createMockResponse(
            createAccountsResponse([
              {
                awsAccountId: '333',
                name: 'p3',
                status: 'Available',
                createdTime: '2025-01-03T00:00:00Z',
                lastEditTime: '2025-01-03T00:00:00Z',
              },
            ])
          )
        );

      const service = createIsbLambdaService(mockSecretsClient, config);
      const result = await service.getAccounts(getAccountsParams);

      expect(result.success).toBe(true);
      expect(result.accounts).toHaveLength(3);
      expect(result.pagesTraversed).toBe(3);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('returns empty accounts array on empty response', async () => {
      mockFetch.mockResolvedValue(createMockResponse(createAccountsResponse([])));

      const service = createIsbLambdaService(mockSecretsClient, config);
      const result = await service.getAccounts(getAccountsParams);

      expect(result.success).toBe(true);
      expect(result.accounts).toHaveLength(0);
      expect(result.totalFetched).toBe(0);
      expect(result.pagesTraversed).toBe(1);
    });

    it('returns failure on non-2xx status code', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ message: 'Forbidden' }, 403));

      const service = createIsbLambdaService(mockSecretsClient, config);
      const result = await service.getAccounts(getAccountsParams);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Forbidden');
    });

    it('returns failure on invalid account schema', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          accounts: [{ awsAccountId: '123456789012', name: 'pool-001' }],
        })
      );

      const service = createIsbLambdaService(mockSecretsClient, config);
      const result = await service.getAccounts(getAccountsParams);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid accounts response schema');
    });

    it('returns error when pagination exceeds MAX_PAGINATION_PAGES limit', async () => {
      // Always return a page with nextPageIdentifier to trigger safety limit
      mockFetch.mockResolvedValue(
        createMockResponse(
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
            'always-has-next'
          )
        )
      );

      const service = createIsbLambdaService(mockSecretsClient, config);
      const result = await service.getAccounts(getAccountsParams);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Pagination exceeded 100 pages');
      expect(result.pagesTraversed).toBe(101);
      expect(result.accounts.length).toBe(100);
    });

    it('continues fetching until nextPageIdentifier is null', async () => {
      mockFetch
        .mockResolvedValueOnce(
          createMockResponse(
            createAccountsResponse(
              [
                {
                  awsAccountId: '111',
                  name: 'p1',
                  status: 'Available',
                  createdTime: '2025-01-01T00:00:00Z',
                  lastEditTime: '2025-01-01T00:00:00Z',
                },
              ],
              'next'
            )
          )
        )
        .mockResolvedValueOnce(
          createMockResponse(
            createAccountsResponse(
              [
                {
                  awsAccountId: '222',
                  name: 'p2',
                  status: 'Active',
                  createdTime: '2025-01-02T00:00:00Z',
                  lastEditTime: '2025-01-02T00:00:00Z',
                },
              ],
              null
            )
          )
        );

      const service = createIsbLambdaService(mockSecretsClient, config);
      const result = await service.getAccounts(getAccountsParams);

      expect(result.success).toBe(true);
      expect(result.pagesTraversed).toBe(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('sends no pageIdentifier on first call', async () => {
      mockFetch.mockResolvedValue(createMockResponse(createAccountsResponse([])));

      const service = createIsbLambdaService(mockSecretsClient, config);
      await service.getAccounts(getAccountsParams);

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://isb-api.example.com/accounts');
      expect(url).not.toContain('pageIdentifier');
    });

    it('includes Authorization header with JWT', async () => {
      mockFetch.mockResolvedValue(createMockResponse(createAccountsResponse([])));

      const service = createIsbLambdaService(mockSecretsClient, config);
      await service.getAccounts(getAccountsParams);

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = options.headers as Record<string, string>;
      expect(headers.Authorization).toMatch(/^Bearer .+\..+\..+$/);
    });

    it('handles non-2xx response with JSend error format', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({ data: { errors: [{ message: 'Bad request parameter' }] } }, 400)
      );

      const service = createIsbLambdaService(mockSecretsClient, config);
      const result = await service.getAccounts(getAccountsParams);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Bad request parameter');
    });

    it('falls back to body.message when JSend errors array is empty', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({ message: 'Request failed', data: { errors: [] } }, 400)
      );

      const service = createIsbLambdaService(mockSecretsClient, config);
      const result = await service.getAccounts(getAccountsParams);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Request failed');
    });

    it('uses "Unknown error from ISB" when no message in getAccounts', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ data: {} }, 500));

      const service = createIsbLambdaService(mockSecretsClient, config);
      const result = await service.getAccounts(getAccountsParams);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error from ISB');
    });

    it('handles fetch error during pagination', async () => {
      mockFetch.mockRejectedValue(new Error('Network timeout'));

      const service = createIsbLambdaService(mockSecretsClient, config);
      const result = await service.getAccounts(getAccountsParams);

      expect(result.success).toBe(false);
      expect(result.error).toContain('ISB API request failed');
    });
  });

  describe('getLease', () => {
    it('sends GET request to /leases/{leaseId}', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          status: 'success',
          data: { originalLeaseTemplateName: 'Basic Sandbox' },
        })
      );

      const service = createIsbLambdaService(mockSecretsClient, config);
      await service.getLease({
        leaseId: { userEmail: 'user@gov.uk', uuid: '123e4567-e89b-12d3-a456-426614174000' },
        approverEmail: 'approver@gov.uk',
      });

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/leases/');
      expect(url).not.toContain('/review');
      expect(options.method).toBe('GET');
    });

    it('returns template name from lease details', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          status: 'success',
          data: { originalLeaseTemplateName: 'Basic Sandbox' },
        })
      );

      const service = createIsbLambdaService(mockSecretsClient, config);
      const result = await service.getLease({
        leaseId: { userEmail: 'user@gov.uk', uuid: '123e4567-e89b-12d3-a456-426614174000' },
        approverEmail: 'approver@gov.uk',
      });

      expect(result.success).toBe(true);
      expect(result.templateName).toBe('Basic Sandbox');
    });

    it('returns undefined templateName when not present in response', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ status: 'success', data: {} }));

      const service = createIsbLambdaService(mockSecretsClient, config);
      const result = await service.getLease({
        leaseId: { userEmail: 'user@gov.uk', uuid: '123e4567-e89b-12d3-a456-426614174000' },
        approverEmail: 'approver@gov.uk',
      });

      expect(result.success).toBe(true);
      expect(result.templateName).toBeUndefined();
    });

    it('returns failure on non-2xx response', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ message: 'Not found' }, 404));

      const service = createIsbLambdaService(mockSecretsClient, config);
      const result = await service.getLease({
        leaseId: { userEmail: 'user@gov.uk', uuid: '123e4567-e89b-12d3-a456-426614174000' },
        approverEmail: 'approver@gov.uk',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not found');
    });

    it('handles network errors gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      const service = createIsbLambdaService(mockSecretsClient, config);
      const result = await service.getLease({
        leaseId: { userEmail: 'user@gov.uk', uuid: '123e4567-e89b-12d3-a456-426614174000' },
        approverEmail: 'approver@gov.uk',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to get lease details');
    });
  });
});
