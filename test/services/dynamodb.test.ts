/**
 * DynamoDB Service Unit Tests
 *
 * Tests for user history queries with mocked DynamoDB client.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import {
  createDynamoDBService,
  filterByDays,
  isWithinDays,
  type DynamoDBService,
} from '../../src/services/dynamodb.js';
import type { LeaseHistoryRecord } from '../../src/scoring/types.js';

// Mock DynamoDB Document Client
const mockSend = vi.fn();
const mockClient = {
  send: mockSend,
} as unknown as DynamoDBDocumentClient;

describe('DynamoDB Service', () => {
  let service: DynamoDBService;
  const tableName = 'test-leases-table';

  beforeEach(() => {
    vi.clearAllMocks();
    service = createDynamoDBService(mockClient, { tableName });
  });

  describe('getUserLeaseHistory', () => {
    it('should query by userEmail partition key', async () => {
      const userEmail = 'test@example.gov.uk';
      mockSend.mockResolvedValueOnce({ Items: [] });

      await service.getUserLeaseHistory(userEmail);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0]![0];
      expect(call).toBeInstanceOf(QueryCommand);
      expect(call.input).toEqual({
        TableName: tableName,
        KeyConditionExpression: 'userEmail = :email',
        ExpressionAttributeValues: {
          ':email': userEmail,
        },
      });
    });

    it('should return empty array for new user with no leases', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await service.getUserLeaseHistory('newuser@example.gov.uk');

      expect(result).toEqual([]);
    });

    it('should return empty array when Items is undefined', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await service.getUserLeaseHistory('newuser@example.gov.uk');

      expect(result).toEqual([]);
    });

    it('should map DynamoDB items to LeaseHistoryRecord', async () => {
      const dynamoItems = [
        {
          uuid: 'lease-1',
          userEmail: 'test@example.gov.uk',
          status: 'Active',
          originalLeaseTemplateUuid: 'template-1',
          created: '2024-12-01T10:00:00Z',
          endDate: undefined,
        },
        {
          uuid: 'lease-2',
          userEmail: 'test@example.gov.uk',
          status: 'Expired',
          originalLeaseTemplateUuid: 'template-2',
          created: '2024-11-15T14:30:00Z',
          endDate: '2024-11-20T14:30:00Z',
        },
      ];
      mockSend.mockResolvedValueOnce({ Items: dynamoItems });

      const result = await service.getUserLeaseHistory('test@example.gov.uk');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        uuid: 'lease-1',
        userEmail: 'test@example.gov.uk',
        status: 'Active',
        originalLeaseTemplateUuid: 'template-1',
        created: '2024-12-01T10:00:00Z',
        endDate: undefined,
      });
      expect(result[1]).toEqual({
        uuid: 'lease-2',
        userEmail: 'test@example.gov.uk',
        status: 'Expired',
        originalLeaseTemplateUuid: 'template-2',
        created: '2024-11-15T14:30:00Z',
        endDate: '2024-11-20T14:30:00Z',
      });
    });

    it('should handle all ISB lease status values', async () => {
      const statuses = [
        'PendingApproval',
        'ApprovalDenied',
        'Active',
        'Frozen',
        'Expired',
        'BudgetExceeded',
        'ManuallyTerminated',
        'AccountQuarantined',
        'Ejected',
      ];

      const dynamoItems = statuses.map((status, index) => ({
        uuid: `lease-${index}`,
        userEmail: 'test@example.gov.uk',
        status,
        originalLeaseTemplateUuid: `template-${index}`,
        created: `2024-12-0${index + 1}T10:00:00Z`,
      }));
      mockSend.mockResolvedValueOnce({ Items: dynamoItems });

      const result = await service.getUserLeaseHistory('test@example.gov.uk');

      expect(result).toHaveLength(statuses.length);
      result.forEach((record, index) => {
        expect(record.status).toBe(statuses[index]);
      });
    });

    it('should throw on DynamoDB error', async () => {
      const error = new Error('DynamoDB connection failed');
      mockSend.mockRejectedValueOnce(error);

      await expect(service.getUserLeaseHistory('test@example.gov.uk')).rejects.toThrow(
        'DynamoDB connection failed'
      );
    });
  });

  describe('getOrgLeaseHistory', () => {
    it('should scan with domain filter', async () => {
      const domain = 'example.gov.uk';
      mockSend.mockResolvedValueOnce({ Items: [] });

      await service.getOrgLeaseHistory(domain);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0]![0];
      expect(call).toBeInstanceOf(ScanCommand);
      expect(call.input).toEqual({
        TableName: tableName,
        FilterExpression: 'contains(userEmail, :domain)',
        ExpressionAttributeValues: {
          ':domain': '@example.gov.uk',
        },
      });
    });

    it('should return leases for all users in the domain', async () => {
      const dynamoItems = [
        {
          uuid: 'lease-1',
          userEmail: 'alice@example.gov.uk',
          status: 'Active',
          originalLeaseTemplateUuid: 'template-1',
          created: '2024-12-01T10:00:00Z',
        },
        {
          uuid: 'lease-2',
          userEmail: 'bob@example.gov.uk',
          status: 'Expired',
          originalLeaseTemplateUuid: 'template-2',
          created: '2024-11-15T14:30:00Z',
          endDate: '2024-11-20T14:30:00Z',
        },
      ];
      mockSend.mockResolvedValueOnce({ Items: dynamoItems });

      const result = await service.getOrgLeaseHistory('example.gov.uk');

      expect(result).toHaveLength(2);
      expect(result[0]!.userEmail).toBe('alice@example.gov.uk');
      expect(result[1]!.userEmail).toBe('bob@example.gov.uk');
    });

    it('should exclude current user when excludeEmail provided', async () => {
      const dynamoItems = [
        {
          uuid: 'lease-1',
          userEmail: 'alice@example.gov.uk',
          status: 'Active',
          originalLeaseTemplateUuid: 'template-1',
          created: '2024-12-01T10:00:00Z',
        },
        {
          uuid: 'lease-2',
          userEmail: 'bob@example.gov.uk',
          status: 'Expired',
          originalLeaseTemplateUuid: 'template-2',
          created: '2024-11-15T14:30:00Z',
        },
      ];
      mockSend.mockResolvedValueOnce({ Items: dynamoItems });

      const result = await service.getOrgLeaseHistory('example.gov.uk', 'alice@example.gov.uk');

      expect(result).toHaveLength(1);
      expect(result[0]!.userEmail).toBe('bob@example.gov.uk');
    });

    it('should include all users when excludeEmail not provided', async () => {
      const dynamoItems = [
        {
          uuid: 'lease-1',
          userEmail: 'alice@example.gov.uk',
          status: 'Active',
          originalLeaseTemplateUuid: 'template-1',
          created: '2024-12-01T10:00:00Z',
        },
      ];
      mockSend.mockResolvedValueOnce({ Items: dynamoItems });

      const result = await service.getOrgLeaseHistory('example.gov.uk');

      expect(result).toHaveLength(1);
    });

    it('should return empty array when no leases in domain', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await service.getOrgLeaseHistory('unknown-domain.gov.uk');

      expect(result).toEqual([]);
    });

    it('should return empty array when Items is undefined', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await service.getOrgLeaseHistory('example.gov.uk');

      expect(result).toEqual([]);
    });

    it('should throw on DynamoDB error', async () => {
      const error = new Error('DynamoDB scan failed');
      mockSend.mockRejectedValueOnce(error);

      await expect(service.getOrgLeaseHistory('example.gov.uk')).rejects.toThrow(
        'DynamoDB scan failed'
      );
    });

    it('should handle pagination when LastEvaluatedKey is present', async () => {
      // First page with LastEvaluatedKey
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            uuid: 'lease-1',
            userEmail: 'alice@example.gov.uk',
            status: 'Active',
            originalLeaseTemplateUuid: 'template-1',
            created: '2024-12-01T10:00:00Z',
          },
        ],
        LastEvaluatedKey: { userEmail: 'alice@example.gov.uk', uuid: 'lease-1' },
      });
      // Second page without LastEvaluatedKey (final page)
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            uuid: 'lease-2',
            userEmail: 'bob@example.gov.uk',
            status: 'Active',
            originalLeaseTemplateUuid: 'template-2',
            created: '2024-12-02T10:00:00Z',
          },
        ],
      });

      const result = await service.getOrgLeaseHistory('example.gov.uk');

      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
      expect(result[0]!.uuid).toBe('lease-1');
      expect(result[1]!.uuid).toBe('lease-2');
    });
  });

  describe('filterByDays', () => {
    const createLease = (created: string): LeaseHistoryRecord => ({
      uuid: 'test-uuid',
      userEmail: 'test@example.gov.uk',
      status: 'Active',
      originalLeaseTemplateUuid: 'template-1',
      created,
    });

    it('should filter leases within the specified days', () => {
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const lastWeek = new Date(now);
      lastWeek.setDate(lastWeek.getDate() - 7);
      const lastMonth = new Date(now);
      lastMonth.setDate(lastMonth.getDate() - 35);

      const leases: LeaseHistoryRecord[] = [
        createLease(yesterday.toISOString()),
        createLease(lastWeek.toISOString()),
        createLease(lastMonth.toISOString()),
      ];

      const result = filterByDays(leases, 30);

      expect(result).toHaveLength(2);
      expect(result[0]!.created).toBe(yesterday.toISOString());
      expect(result[1]!.created).toBe(lastWeek.toISOString());
    });

    it('should return empty array when no leases match', () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100);

      const leases: LeaseHistoryRecord[] = [createLease(oldDate.toISOString())];

      const result = filterByDays(leases, 30);

      expect(result).toEqual([]);
    });

    it('should return all leases when all are within window', () => {
      const now = new Date();
      const recent = new Date(now);
      recent.setDate(recent.getDate() - 5);

      const leases: LeaseHistoryRecord[] = [
        createLease(now.toISOString()),
        createLease(recent.toISOString()),
      ];

      const result = filterByDays(leases, 30);

      expect(result).toHaveLength(2);
    });
  });

  describe('isWithinDays', () => {
    it('should return true for dates within the window', () => {
      const referenceDate = new Date('2024-12-23T12:00:00Z');
      const recentDate = '2024-12-20T10:00:00Z'; // 3 days ago

      expect(isWithinDays(recentDate, 7, referenceDate)).toBe(true);
    });

    it('should return false for dates outside the window', () => {
      const referenceDate = new Date('2024-12-23T12:00:00Z');
      const oldDate = '2024-11-01T10:00:00Z'; // ~52 days ago

      expect(isWithinDays(oldDate, 30, referenceDate)).toBe(false);
    });

    it('should return true for dates exactly at the cutoff', () => {
      const referenceDate = new Date('2024-12-23T12:00:00Z');
      const cutoffDate = '2024-11-23T12:00:00Z'; // exactly 30 days ago

      expect(isWithinDays(cutoffDate, 30, referenceDate)).toBe(true);
    });

    it('should use current date as default reference', () => {
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);

      expect(isWithinDays(yesterday.toISOString(), 7)).toBe(true);
    });

    it('should work with 90-day window', () => {
      const referenceDate = new Date('2024-12-23T12:00:00Z');
      const withinWindow = '2024-10-01T10:00:00Z'; // ~83 days ago
      const outsideWindow = '2024-09-01T10:00:00Z'; // ~113 days ago

      expect(isWithinDays(withinWindow, 90, referenceDate)).toBe(true);
      expect(isWithinDays(outsideWindow, 90, referenceDate)).toBe(false);
    });
  });
});
