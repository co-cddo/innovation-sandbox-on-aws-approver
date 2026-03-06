import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createIdentityStoreService } from '../../src/services/identity-store.js';

// Use vi.hoisted() for mocks used inside vi.mock() (Vitest v4 compatible)
const { mockIdentitystoreSend } = vi.hoisted(() => ({
  mockIdentitystoreSend: vi.fn(),
}));

vi.mock('@aws-sdk/client-identitystore', () => ({
  IdentitystoreClient: class MockIdentitystoreClient {
    send = mockIdentitystoreSend;
  },
  ListUsersCommand: class MockListUsersCommand {
    constructor(public input: unknown) {}
  },
  IsMemberInGroupsCommand: class MockIsMemberInGroupsCommand {
    constructor(public input: unknown) {}
  },
}));

vi.mock('@aws-sdk/client-sts', () => ({
  STSClient: class MockSTSClient {},
  AssumeRoleCommand: class MockAssumeRoleCommand {
    constructor(public input: unknown) {}
  },
}));

// STS client mock - passed directly to createIdentityStoreService
const mockSTSSend = vi.fn();
const mockStsClient = { send: mockSTSSend } as never;

const baseConfig = {
  identityStoreId: 'd-test123',
  roleArn: 'arn:aws:iam::111111111111:role/TestRole',
  groupId: 'group-abc-123',
  region: 'us-west-2',
};

describe('createIdentityStoreService', () => {
  beforeEach(() => {
    mockIdentitystoreSend.mockReset();
    mockSTSSend.mockReset();
    // Default STS mock returns valid credentials
    mockSTSSend.mockResolvedValue({
      Credentials: {
        AccessKeyId: 'AKIATEST',
        SecretAccessKey: 'secret',
        SessionToken: 'token',
        Expiration: new Date(Date.now() + 900 * 1000),
      },
    });
  });

  it('should return true when user is in the pre-approved group', async () => {
    mockIdentitystoreSend
      .mockResolvedValueOnce({
        Users: [{ UserId: 'user-123' }],
      })
      .mockResolvedValueOnce({
        Results: [{ GroupId: 'group-abc-123', MembershipExists: true }],
      });

    const service = createIdentityStoreService(mockStsClient, baseConfig);
    const result = await service.isPreapproved('test@example.gov.uk');

    expect(result).toBe(true);
  });

  it('should return false when user is NOT in the group', async () => {
    mockIdentitystoreSend
      .mockResolvedValueOnce({
        Users: [{ UserId: 'user-123' }],
      })
      .mockResolvedValueOnce({
        Results: [{ GroupId: 'group-abc-123', MembershipExists: false }],
      });

    const service = createIdentityStoreService(mockStsClient, baseConfig);
    const result = await service.isPreapproved('test@example.gov.uk');

    expect(result).toBe(false);
  });

  it('should return false when user is not found in Identity Store', async () => {
    mockIdentitystoreSend.mockResolvedValueOnce({
      Users: [],
    });

    const service = createIdentityStoreService(mockStsClient, baseConfig);
    const result = await service.isPreapproved('unknown@example.gov.uk');

    expect(result).toBe(false);
  });

  it('should return false when STS AssumeRole fails', async () => {
    mockSTSSend.mockRejectedValueOnce(new Error('Access denied'));

    const service = createIdentityStoreService(mockStsClient, baseConfig);
    const result = await service.isPreapproved('test@example.gov.uk');

    expect(result).toBe(false);
  });

  it('should return false when Identity Store API fails', async () => {
    mockIdentitystoreSend.mockRejectedValueOnce(new Error('Service unavailable'));

    const service = createIdentityStoreService(mockStsClient, baseConfig);
    const result = await service.isPreapproved('test@example.gov.uk');

    expect(result).toBe(false);
  });

  it('should return false when STS returns incomplete credentials', async () => {
    mockSTSSend.mockResolvedValueOnce({
      Credentials: {
        AccessKeyId: 'AKIATEST',
        // Missing SecretAccessKey and SessionToken
      },
    });

    const service = createIdentityStoreService(mockStsClient, baseConfig);
    const result = await service.isPreapproved('test@example.gov.uk');

    expect(result).toBe(false);
  });

  it('should cache STS credentials across calls', async () => {
    mockIdentitystoreSend
      .mockResolvedValueOnce({ Users: [{ UserId: 'user-1' }] })
      .mockResolvedValueOnce({ Results: [{ GroupId: 'group-abc-123', MembershipExists: true }] })
      .mockResolvedValueOnce({ Users: [{ UserId: 'user-2' }] })
      .mockResolvedValueOnce({ Results: [{ GroupId: 'group-abc-123', MembershipExists: false }] });

    const service = createIdentityStoreService(mockStsClient, baseConfig);
    await service.isPreapproved('user1@example.gov.uk');
    await service.isPreapproved('user2@example.gov.uk');

    // STS should only be called once (credentials cached)
    expect(mockSTSSend).toHaveBeenCalledTimes(1);
  });

  it('should return false when user has no UserId', async () => {
    mockIdentitystoreSend.mockResolvedValueOnce({
      Users: [{ UserId: undefined }],
    });

    const service = createIdentityStoreService(mockStsClient, baseConfig);
    const result = await service.isPreapproved('test@example.gov.uk');

    expect(result).toBe(false);
  });

  it('should return false when IsMemberInGroups returns empty results', async () => {
    mockIdentitystoreSend
      .mockResolvedValueOnce({
        Users: [{ UserId: 'user-123' }],
      })
      .mockResolvedValueOnce({
        Results: [],
      });

    const service = createIdentityStoreService(mockStsClient, baseConfig);
    const result = await service.isPreapproved('test@example.gov.uk');

    expect(result).toBe(false);
  });
});
