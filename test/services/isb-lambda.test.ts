import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createIsbLambdaService,
  type ApproveLeaseLambdaParams,
  type DenyLeaseLambdaParams,
  type GetAccountsLambdaParams,
  type GetLeaseLambdaParams,
} from '../../src/services/isb-lambda.js';
interface MockISBClient {
  reviewLease: ReturnType<typeof vi.fn>;
  fetchAllAccounts: ReturnType<typeof vi.fn>;
  fetchLeaseByKey: ReturnType<typeof vi.fn>;
  fetchLease: ReturnType<typeof vi.fn>;
  fetchAccount: ReturnType<typeof vi.fn>;
  fetchTemplate: ReturnType<typeof vi.fn>;
  registerAccount: ReturnType<typeof vi.fn>;
  resetTokenCache: ReturnType<typeof vi.fn>;
}

function createMockISBClient(): MockISBClient {
  return {
    reviewLease: vi.fn(),
    fetchAllAccounts: vi.fn(),
    fetchLeaseByKey: vi.fn(),
    fetchLease: vi.fn(),
    fetchAccount: vi.fn(),
    fetchTemplate: vi.fn(),
    registerAccount: vi.fn(),
    resetTokenCache: vi.fn(),
  };
}

describe('ISB Lambda Service', () => {
  let mockClient: ReturnType<typeof createMockISBClient>;

  beforeEach(() => {
    mockClient = createMockISBClient();
  });

  describe('createIsbLambdaService', () => {
    it('creates a service with all methods', () => {
      const service = createIsbLambdaService(mockClient as never);

      expect(service).toBeDefined();
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

    it('calls reviewLease with Approve action', async () => {
      mockClient.reviewLease.mockResolvedValue({
        success: true,
        data: { leaseId: 'test', status: 'Approved' },
        statusCode: 200,
      });

      const service = createIsbLambdaService(mockClient as never);
      await service.approveLease(approveParams);

      expect(mockClient.reviewLease).toHaveBeenCalledWith(
        expect.any(String), // base64 encoded leaseId
        { action: 'Approve' },
        expect.stringContaining('approve-')
      );
    });

    it('encodes leaseId as base64 JSON', async () => {
      mockClient.reviewLease.mockResolvedValue({
        success: true,
        data: { leaseId: 'test', status: 'Approved' },
        statusCode: 200,
      });

      const service = createIsbLambdaService(mockClient as never);
      await service.approveLease(approveParams);

      const encodedLeaseId = mockClient.reviewLease.mock.calls[0]![0] as string;
      const decoded = JSON.parse(Buffer.from(encodedLeaseId, 'base64').toString());
      expect(decoded.userEmail).toBe(approveParams.leaseId.userEmail);
      expect(decoded.uuid).toBe(approveParams.leaseId.uuid);
    });

    it('returns success result on successful review', async () => {
      mockClient.reviewLease.mockResolvedValue({
        success: true,
        data: { leaseId: 'test', status: 'Approved' },
        statusCode: 200,
      });

      const service = createIsbLambdaService(mockClient as never);
      const result = await service.approveLease(approveParams);

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.message).toBe('success');
    });

    it('returns failure on review error', async () => {
      mockClient.reviewLease.mockResolvedValue({
        success: false,
        error: 'Lease not found',
        statusCode: 400,
      });

      const service = createIsbLambdaService(mockClient as never);
      const result = await service.approveLease(approveParams);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(400);
      expect(result.error).toBe('Lease not found');
    });

    it('handles ISB client exceptions', async () => {
      mockClient.reviewLease.mockRejectedValue(new Error('Network timeout'));

      const service = createIsbLambdaService(mockClient as never);
      const result = await service.approveLease(approveParams);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
      expect(result.error).toContain('Network timeout');
    });

    it('handles non-Error exceptions', async () => {
      mockClient.reviewLease.mockRejectedValue('unknown error');

      const service = createIsbLambdaService(mockClient as never);
      const result = await service.approveLease(approveParams);

      expect(result.success).toBe(false);
      expect(result.error).toContain('unknown error');
    });

    it('returns 409 conflict status from ISB', async () => {
      mockClient.reviewLease.mockResolvedValue({
        success: false,
        error: 'Lease already approved',
        statusCode: 409,
      });

      const service = createIsbLambdaService(mockClient as never);
      const result = await service.approveLease(approveParams);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(409);
      expect(result.error).toBe('Lease already approved');
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

    it('calls reviewLease with Deny action', async () => {
      mockClient.reviewLease.mockResolvedValue({
        success: true,
        data: { leaseId: 'test', status: 'Denied' },
        statusCode: 200,
      });

      const service = createIsbLambdaService(mockClient as never);
      await service.denyLease(denyParams);

      expect(mockClient.reviewLease).toHaveBeenCalledWith(
        expect.any(String),
        { action: 'Deny' },
        expect.stringContaining('deny-')
      );
    });

    it('returns success result on 200 response', async () => {
      mockClient.reviewLease.mockResolvedValue({
        success: true,
        data: { leaseId: 'test', status: 'Denied' },
        statusCode: 200,
      });

      const service = createIsbLambdaService(mockClient as never);
      const result = await service.denyLease(denyParams);

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
    });

    it('handles ISB client exceptions', async () => {
      mockClient.reviewLease.mockRejectedValue(new Error('Lambda unavailable'));

      const service = createIsbLambdaService(mockClient as never);
      const result = await service.denyLease(denyParams);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Lambda unavailable');
    });
  });

  describe('getAccounts', () => {
    const getAccountsParams: GetAccountsLambdaParams = {
      approverEmail: 'ndx+try-automated-approver@dsit.gov.uk',
    };

    it('calls fetchAllAccounts on ISB client', async () => {
      mockClient.fetchAllAccounts.mockResolvedValue([]);

      const service = createIsbLambdaService(mockClient as never);
      await service.getAccounts(getAccountsParams);

      expect(mockClient.fetchAllAccounts).toHaveBeenCalledWith(
        expect.stringContaining('accounts-'),
      );
    });

    it('returns accounts on successful response', async () => {
      mockClient.fetchAllAccounts.mockResolvedValue([
        { awsAccountId: '123456789012', name: 'pool-001', status: 'Available' },
        { awsAccountId: '123456789013', name: 'pool-002', status: 'Active' },
      ]);

      const service = createIsbLambdaService(mockClient as never);
      const result = await service.getAccounts(getAccountsParams);

      expect(result.success).toBe(true);
      expect(result.accounts).toHaveLength(2);
      expect(result.totalFetched).toBe(2);
      expect(result.accounts[0]?.awsAccountId).toBe('123456789012');
      expect(result.accounts[0]?.status).toBe('Available');
      expect(result.accounts[1]?.status).toBe('Active');
    });

    it('returns empty accounts array when none found', async () => {
      mockClient.fetchAllAccounts.mockResolvedValue([]);

      const service = createIsbLambdaService(mockClient as never);
      const result = await service.getAccounts(getAccountsParams);

      expect(result.success).toBe(true);
      expect(result.accounts).toHaveLength(0);
      expect(result.totalFetched).toBe(0);
    });

    it('filters out accounts without Available/Active status', async () => {
      mockClient.fetchAllAccounts.mockResolvedValue([
        { awsAccountId: '123456789012', name: 'pool-001', status: 'Available' },
        { awsAccountId: '123456789013', name: 'pool-002', status: 'Suspended' },
        { awsAccountId: '123456789014', name: 'pool-003', status: 'Active' },
      ]);

      const service = createIsbLambdaService(mockClient as never);
      const result = await service.getAccounts(getAccountsParams);

      expect(result.success).toBe(true);
      expect(result.accounts).toHaveLength(2);
      expect(result.accounts[0]?.awsAccountId).toBe('123456789012');
      expect(result.accounts[1]?.awsAccountId).toBe('123456789014');
    });

    it('uses awsAccountId as name fallback', async () => {
      mockClient.fetchAllAccounts.mockResolvedValue([
        { awsAccountId: '123456789012', status: 'Available' },
      ]);

      const service = createIsbLambdaService(mockClient as never);
      const result = await service.getAccounts(getAccountsParams);

      expect(result.accounts[0]?.name).toBe('123456789012');
    });

    it('returns failure on ISB client exception', async () => {
      mockClient.fetchAllAccounts.mockRejectedValue(new Error('Network error'));

      const service = createIsbLambdaService(mockClient as never);
      const result = await service.getAccounts(getAccountsParams);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
      expect(result.accounts).toHaveLength(0);
    });

    it('provides meta fields for Account type compatibility', async () => {
      mockClient.fetchAllAccounts.mockResolvedValue([
        { awsAccountId: '123456789012', name: 'pool-001', status: 'Available' },
      ]);

      const service = createIsbLambdaService(mockClient as never);
      const result = await service.getAccounts(getAccountsParams);

      expect(result.accounts[0]?.meta).toBeDefined();
      expect(result.accounts[0]?.meta.createdTime).toBeDefined();
      expect(result.accounts[0]?.meta.lastEditTime).toBeDefined();
    });
  });

  describe('getLease', () => {
    const getLeaseParams: GetLeaseLambdaParams = {
      leaseId: {
        userEmail: 'user@example.gov.uk',
        uuid: '123e4567-e89b-12d3-a456-426614174000',
      },
      approverEmail: 'ndx+try-automated-approver@dsit.gov.uk',
    };

    it('calls fetchLeaseByKey with correct parameters', async () => {
      mockClient.fetchLeaseByKey.mockResolvedValue({
        userEmail: 'user@example.gov.uk',
        uuid: '123e4567-e89b-12d3-a456-426614174000',
        originalLeaseTemplateName: 'basic-vpc',
      });

      const service = createIsbLambdaService(mockClient as never);
      await service.getLease(getLeaseParams);

      expect(mockClient.fetchLeaseByKey).toHaveBeenCalledWith(
        'user@example.gov.uk',
        '123e4567-e89b-12d3-a456-426614174000',
        expect.stringContaining('getlease-')
      );
    });

    it('returns template name on successful lookup', async () => {
      mockClient.fetchLeaseByKey.mockResolvedValue({
        userEmail: 'user@example.gov.uk',
        uuid: '123e4567-e89b-12d3-a456-426614174000',
        originalLeaseTemplateName: 'basic-vpc',
      });

      const service = createIsbLambdaService(mockClient as never);
      const result = await service.getLease(getLeaseParams);

      expect(result.success).toBe(true);
      expect(result.templateName).toBe('basic-vpc');
    });

    it('returns undefined templateName when not present in lease', async () => {
      mockClient.fetchLeaseByKey.mockResolvedValue({
        userEmail: 'user@example.gov.uk',
        uuid: '123e4567-e89b-12d3-a456-426614174000',
      });

      const service = createIsbLambdaService(mockClient as never);
      const result = await service.getLease(getLeaseParams);

      expect(result.success).toBe(true);
      expect(result.templateName).toBeUndefined();
    });

    it('returns failure when lease not found (null result)', async () => {
      mockClient.fetchLeaseByKey.mockResolvedValue(null);

      const service = createIsbLambdaService(mockClient as never);
      const result = await service.getLease(getLeaseParams);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Lease not found');
    });

    it('handles ISB client exceptions', async () => {
      mockClient.fetchLeaseByKey.mockRejectedValue(new Error('API timeout'));

      const service = createIsbLambdaService(mockClient as never);
      const result = await service.getLease(getLeaseParams);

      expect(result.success).toBe(false);
      expect(result.error).toContain('API timeout');
    });

    it('handles non-Error exceptions', async () => {
      mockClient.fetchLeaseByKey.mockRejectedValue('unexpected');

      const service = createIsbLambdaService(mockClient as never);
      const result = await service.getLease(getLeaseParams);

      expect(result.success).toBe(false);
      expect(result.error).toContain('unexpected');
    });
  });
});
