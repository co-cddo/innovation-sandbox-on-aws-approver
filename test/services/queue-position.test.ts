/**
 * Unit tests for Queue Position Service (Story 6.3)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  addToQueue,
  removeFromQueue,
  getQueueDepth,
  getOldestPending,
  getQueuePosition,
  updateEstimatedTime,
  getLastCapacityCrunchAlertTime,
  updateLastCapacityCrunchAlertTime,
  leaseIdToKey,
  keyToLeaseId,
  type QueuePositionServiceConfig,
} from '../../src/services/queue-position.js';
import { DynamoDBClient, QueryCommand, DeleteItemCommand, UpdateItemCommand, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import type { LeaseId } from '../../src/lib/types.js';

// Mock AWS SDK
vi.mock('@aws-sdk/client-dynamodb');

describe('Queue Position Service', () => {
  let mockClient: DynamoDBClient;
  let mockSend: ReturnType<typeof vi.fn>;
  const config: QueuePositionServiceConfig = {
    tableName: 'test-queue-position',
    positionIndexName: 'PositionIndex',
    ttlDays: 7,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend = vi.fn();
    mockClient = {
      send: mockSend,
    } as unknown as DynamoDBClient;
  });

  describe('leaseIdToKey / keyToLeaseId', () => {
    it('should convert LeaseId to key string', () => {
      const leaseId: LeaseId = {
        userEmail: 'user@example.gov.uk',
        uuid: '12345678-1234-1234-1234-123456789012',
      };
      const key = leaseIdToKey(leaseId);
      expect(key).toBe('user@example.gov.uk#12345678-1234-1234-1234-123456789012');
    });

    it('should convert key string back to LeaseId', () => {
      const key = 'user@example.gov.uk#12345678-1234-1234-1234-123456789012';
      const leaseId = keyToLeaseId(key);
      expect(leaseId).toEqual({
        userEmail: 'user@example.gov.uk',
        uuid: '12345678-1234-1234-1234-123456789012',
      });
    });

    it('should handle key without # separator (lines 45-46)', () => {
      // When there's no #, split returns single element array
      // parts[0] ?? '' and parts[1] ?? '' fallbacks should be covered
      const key = 'malformed-key-no-separator';
      const leaseId = keyToLeaseId(key);
      expect(leaseId).toEqual({
        userEmail: 'malformed-key-no-separator',
        uuid: '',
      });
    });

    it('should handle empty key string (lines 45-46)', () => {
      const key = '';
      const leaseId = keyToLeaseId(key);
      expect(leaseId).toEqual({
        userEmail: '',
        uuid: '',
      });
    });
  });

  describe('getQueueDepth', () => {
    it('should return queue depth on success', async () => {
      mockSend.mockResolvedValueOnce({ Count: 5 });

      const result = await getQueueDepth(mockClient, config);

      expect(result).toEqual({
        success: true,
        queueDepth: 5,
      });
      expect(mockSend).toHaveBeenCalledWith(expect.any(QueryCommand));
    });

    it('should return 0 for empty queue', async () => {
      mockSend.mockResolvedValueOnce({ Count: 0 });

      const result = await getQueueDepth(mockClient, config);

      expect(result).toEqual({
        success: true,
        queueDepth: 0,
      });
    });

    it('should handle undefined Count in response (line 71)', async () => {
      mockSend.mockResolvedValueOnce({}); // No Count property

      const result = await getQueueDepth(mockClient, config);

      expect(result).toEqual({
        success: true,
        queueDepth: 0, // Default to 0 via ?? operator
      });
    });

    it('should handle errors gracefully', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB error'));

      const result = await getQueueDepth(mockClient, config);

      expect(result).toEqual({
        success: false,
        error: 'DynamoDB error',
      });
    });
  });

  describe('addToQueue', () => {
    const leaseId: LeaseId = {
      userEmail: 'user@example.gov.uk',
      uuid: '12345678-1234-1234-1234-123456789012',
    };

    it('should add new request to queue with position 1 when queue is empty', async () => {
      // GetItem returns nothing (not in queue)
      mockSend.mockResolvedValueOnce({ Item: undefined });
      // Query returns empty (no items, start at position 1)
      mockSend.mockResolvedValueOnce({ Items: [] });
      // PutItem succeeds
      mockSend.mockResolvedValueOnce({});

      const result = await addToQueue(mockClient, config, {
        leaseId,
        estimatedFulfillmentTime: new Date('2025-12-31T12:00:00Z'),
      });

      expect(result).toEqual({
        success: true,
        position: 1,
      });
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it('should add new request with next position when queue has items', async () => {
      // GetItem returns nothing (not in queue)
      mockSend.mockResolvedValueOnce({ Item: undefined });
      // Query returns highest position is 3
      mockSend.mockResolvedValueOnce({
        Items: [marshall({ position: 3 })],
      });
      // PutItem succeeds
      mockSend.mockResolvedValueOnce({});

      const result = await addToQueue(mockClient, config, {
        leaseId,
        estimatedFulfillmentTime: null,
      });

      expect(result).toEqual({
        success: true,
        position: 4,
      });
    });

    it('should return existing position if already in queue', async () => {
      // GetItem returns existing record
      mockSend.mockResolvedValueOnce({
        Item: marshall({
          leaseId: leaseIdToKey(leaseId),
          position: 2,
          queuedAt: '2025-12-30T10:00:00Z',
          userEmail: leaseId.userEmail,
          positionStatus: 'PENDING',
        }),
      });

      const result = await addToQueue(mockClient, config, {
        leaseId,
        estimatedFulfillmentTime: null,
      });

      expect(result).toEqual({
        success: true,
        position: 2,
      });
      expect(mockSend).toHaveBeenCalledTimes(1); // Only GetItem
    });

    it('should handle conditional check failure (race condition)', async () => {
      // GetItem returns nothing
      mockSend.mockResolvedValueOnce({ Item: undefined });
      // Query returns position
      mockSend.mockResolvedValueOnce({ Items: [] });
      // PutItem fails with condition check
      const conditionError = new Error('Conditional check failed');
      conditionError.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(conditionError);
      // GetItem for recovery returns existing record
      mockSend.mockResolvedValueOnce({
        Item: marshall({
          leaseId: leaseIdToKey(leaseId),
          position: 1,
          queuedAt: '2025-12-30T10:00:00Z',
          userEmail: leaseId.userEmail,
          positionStatus: 'PENDING',
        }),
      });

      const result = await addToQueue(mockClient, config, {
        leaseId,
        estimatedFulfillmentTime: null,
      });

      expect(result).toEqual({
        success: true,
        position: 1,
      });
    });

    it('should handle DynamoDB errors', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({ Items: [] });
      mockSend.mockRejectedValueOnce(new Error('DynamoDB write error'));

      const result = await addToQueue(mockClient, config, {
        leaseId,
        estimatedFulfillmentTime: null,
      });

      expect(result).toEqual({
        success: false,
        error: 'DynamoDB write error',
      });
    });

    it('should use default ttlDays when not provided in config (line 175)', async () => {
      // Config without ttlDays
      const configNoTtl: QueuePositionServiceConfig = {
        tableName: 'test-queue-position',
        positionIndexName: 'PositionIndex',
        // ttlDays not provided - should default to 7
      };

      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({ Items: [] });
      mockSend.mockResolvedValueOnce({});

      const result = await addToQueue(mockClient, configNoTtl, {
        leaseId,
        estimatedFulfillmentTime: null,
      });

      expect(result.success).toBe(true);
      expect(result.position).toBe(1);
    });

    it('should handle race condition when GetItem returns empty after ConditionalCheckFailed (line 216)', async () => {
      // GetItem returns nothing
      mockSend.mockResolvedValueOnce({ Item: undefined });
      // Query returns position
      mockSend.mockResolvedValueOnce({ Items: [] });
      // PutItem fails with condition check
      const conditionError = new Error('Conditional check failed');
      conditionError.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(conditionError);
      // GetItem for recovery returns nothing (item was deleted in between)
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await addToQueue(mockClient, config, {
        leaseId,
        estimatedFulfillmentTime: null,
      });

      // Should return error since we couldn't recover the position
      expect(result.success).toBe(false);
      expect(result.error).toContain('Conditional check failed');
    });
  });

  describe('removeFromQueue', () => {
    const leaseId: LeaseId = {
      userEmail: 'user@example.gov.uk',
      uuid: '12345678-1234-1234-1234-123456789012',
    };

    it('should remove request from queue', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await removeFromQueue(mockClient, config, leaseId);

      expect(result).toEqual({ success: true });
      expect(mockSend).toHaveBeenCalledWith(expect.any(DeleteItemCommand));
    });

    it('should handle errors gracefully', async () => {
      mockSend.mockRejectedValueOnce(new Error('Delete failed'));

      const result = await removeFromQueue(mockClient, config, leaseId);

      expect(result).toEqual({
        success: false,
        error: 'Delete failed',
      });
    });
  });

  describe('getOldestPending', () => {
    it('should return oldest pending request', async () => {
      const record = {
        leaseId: 'user@example.gov.uk#12345678-1234-1234-1234-123456789012',
        position: 1,
        queuedAt: '2025-12-30T10:00:00Z',
        userEmail: 'user@example.gov.uk',
        estimatedFulfillmentTime: '2025-12-31T12:00:00Z',
        positionStatus: 'PENDING',
        ttl: 1735639200,
      };

      mockSend.mockResolvedValueOnce({
        Items: [marshall(record)],
      });

      const result = await getOldestPending(mockClient, config);

      expect(result.success).toBe(true);
      expect(result.record).toEqual(record);
    });

    it('should use queuedAt as tiebreaker when positions match (race condition handling)', async () => {
      // Two requests with same position (simulating race condition)
      const earlierRecord = {
        leaseId: 'user1@example.gov.uk#11111111-1111-1111-1111-111111111111',
        position: 1,
        queuedAt: '2025-12-30T10:00:00Z', // Earlier
        userEmail: 'user1@example.gov.uk',
        positionStatus: 'PENDING',
        ttl: 1735639200,
      };
      const laterRecord = {
        leaseId: 'user2@example.gov.uk#22222222-2222-2222-2222-222222222222',
        position: 1, // Same position
        queuedAt: '2025-12-30T10:00:05Z', // Later (5 seconds)
        userEmail: 'user2@example.gov.uk',
        positionStatus: 'PENDING',
        ttl: 1735639200,
      };

      // DynamoDB might return them in any order
      mockSend.mockResolvedValueOnce({
        Items: [marshall(laterRecord), marshall(earlierRecord)],
      });

      const result = await getOldestPending(mockClient, config);

      expect(result.success).toBe(true);
      // Should return earlier record based on queuedAt tiebreaker
      expect(result.record?.leaseId).toBe(earlierRecord.leaseId);
      expect(result.record?.queuedAt).toBe('2025-12-30T10:00:00Z');
    });

    it('should return success with no record when queue is empty', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await getOldestPending(mockClient, config);

      expect(result).toEqual({ success: true });
      expect(result.record).toBeUndefined();
    });

    it('should handle errors gracefully', async () => {
      mockSend.mockRejectedValueOnce(new Error('Query failed'));

      const result = await getOldestPending(mockClient, config);

      expect(result).toEqual({
        success: false,
        error: 'Query failed',
      });
    });
  });

  describe('getQueuePosition', () => {
    const leaseId: LeaseId = {
      userEmail: 'user@example.gov.uk',
      uuid: '12345678-1234-1234-1234-123456789012',
    };

    it('should return position for existing entry', async () => {
      mockSend.mockResolvedValueOnce({
        Item: marshall({
          leaseId: leaseIdToKey(leaseId),
          position: 3,
          queuedAt: '2025-12-30T10:00:00Z',
          userEmail: leaseId.userEmail,
          positionStatus: 'PENDING',
        }),
      });

      const result = await getQueuePosition(mockClient, config, leaseId);

      expect(result).toEqual({
        success: true,
        position: 3,
      });
    });

    it('should return success without position if not in queue', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await getQueuePosition(mockClient, config, leaseId);

      expect(result).toEqual({ success: true });
      expect(result.position).toBeUndefined();
    });

    it('should handle errors gracefully', async () => {
      mockSend.mockRejectedValueOnce(new Error('GetItem failed'));

      const result = await getQueuePosition(mockClient, config, leaseId);

      expect(result).toEqual({
        success: false,
        error: 'GetItem failed',
      });
    });
  });

  describe('updateEstimatedTime', () => {
    const leaseId: LeaseId = {
      userEmail: 'user@example.gov.uk',
      uuid: '12345678-1234-1234-1234-123456789012',
    };

    it('should update estimated time successfully', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await updateEstimatedTime(
        mockClient,
        config,
        leaseId,
        new Date('2025-12-31T18:00:00Z')
      );

      expect(result).toEqual({ success: true });
      expect(mockSend).toHaveBeenCalledWith(expect.any(UpdateItemCommand));
    });

    it('should handle null estimated time', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await updateEstimatedTime(mockClient, config, leaseId, null);

      expect(result).toEqual({ success: true });
    });

    it('should handle errors gracefully', async () => {
      mockSend.mockRejectedValueOnce(new Error('Update failed'));

      const result = await updateEstimatedTime(
        mockClient,
        config,
        leaseId,
        new Date('2025-12-31T18:00:00Z')
      );

      expect(result).toEqual({
        success: false,
        error: 'Update failed',
      });
    });
  });

  describe('getLastCapacityCrunchAlertTime (Story 6.4)', () => {
    it('should return null when no previous alert exists', async () => {
      mockSend.mockResolvedValueOnce({}); // No Item

      const result = await getLastCapacityCrunchAlertTime(mockClient, config);

      expect(result).toEqual({
        success: true,
        lastAlertTime: null,
      });
      expect(mockSend).toHaveBeenCalledWith(expect.any(GetItemCommand));
    });

    it('should return the last alert time when exists', async () => {
      const alertTime = '2025-12-30T10:00:00.000Z';
      mockSend.mockResolvedValueOnce({
        Item: marshall({
          leaseId: '__SYSTEM__#capacityCrunchLastAlert',
          lastAlertTime: alertTime,
          positionStatus: 'SYSTEM',
          position: 0,
        }),
      });

      const result = await getLastCapacityCrunchAlertTime(mockClient, config);

      expect(result.success).toBe(true);
      expect(result.lastAlertTime?.toISOString()).toBe(alertTime);
    });

    it('should handle errors gracefully', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB error'));

      const result = await getLastCapacityCrunchAlertTime(mockClient, config);

      expect(result).toEqual({
        success: false,
        lastAlertTime: null,
        error: 'DynamoDB error',
      });
    });

    it('should return null when item exists but lastAlertTime is missing (line 451)', async () => {
      // Item exists but lastAlertTime is undefined
      mockSend.mockResolvedValueOnce({
        Item: marshall({
          leaseId: '__SYSTEM__#capacityCrunchLastAlert',
          positionStatus: 'SYSTEM',
          position: 0,
          // lastAlertTime is missing
        }),
      });

      const result = await getLastCapacityCrunchAlertTime(mockClient, config);

      expect(result.success).toBe(true);
      expect(result.lastAlertTime).toBeNull();
    });
  });

  describe('updateLastCapacityCrunchAlertTime (Story 6.4)', () => {
    it('should update the last alert time', async () => {
      mockSend.mockResolvedValueOnce({});

      const alertTime = new Date('2025-12-30T11:00:00Z');
      const result = await updateLastCapacityCrunchAlertTime(mockClient, config, alertTime);

      expect(result).toEqual({ success: true });
      expect(mockSend).toHaveBeenCalledWith(expect.any(PutItemCommand));
    });

    it('should handle errors gracefully', async () => {
      mockSend.mockRejectedValueOnce(new Error('Write failed'));

      const result = await updateLastCapacityCrunchAlertTime(
        mockClient,
        config,
        new Date('2025-12-30T11:00:00Z')
      );

      expect(result).toEqual({
        success: false,
        error: 'Write failed',
      });
    });

    it('should handle non-Error exception', async () => {
      mockSend.mockRejectedValueOnce('String error');

      const result = await updateLastCapacityCrunchAlertTime(
        mockClient,
        config,
        new Date('2025-12-30T11:00:00Z')
      );

      expect(result).toEqual({
        success: false,
        error: 'String error',
      });
    });
  });

  describe('Non-Error exception handling', () => {
    const leaseId: LeaseId = {
      userEmail: 'user@example.gov.uk',
      uuid: '12345678-1234-1234-1234-123456789012',
    };

    it('should handle non-Error in getQueueDepth', async () => {
      mockSend.mockRejectedValueOnce('String query error');

      const result = await getQueueDepth(mockClient, config);

      expect(result).toEqual({
        success: false,
        error: 'String query error',
      });
    });

    it('should handle non-Error in addToQueue', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({ Items: [] });
      mockSend.mockRejectedValueOnce('PutItem failed');

      const result = await addToQueue(mockClient, config, {
        leaseId,
        estimatedFulfillmentTime: null,
      });

      expect(result).toEqual({
        success: false,
        error: 'PutItem failed',
      });
    });

    it('should handle non-Error in removeFromQueue', async () => {
      mockSend.mockRejectedValueOnce({ code: 'AWS_ERROR' });

      const result = await removeFromQueue(mockClient, config, leaseId);

      expect(result).toEqual({
        success: false,
        error: '[object Object]',
      });
    });

    it('should handle non-Error in getOldestPending', async () => {
      mockSend.mockRejectedValueOnce(42);

      const result = await getOldestPending(mockClient, config);

      expect(result).toEqual({
        success: false,
        error: '42',
      });
    });

    it('should handle non-Error in getQueuePosition', async () => {
      mockSend.mockRejectedValueOnce(null);

      const result = await getQueuePosition(mockClient, config, leaseId);

      expect(result).toEqual({
        success: false,
        error: 'null',
      });
    });

    it('should handle non-Error in updateEstimatedTime', async () => {
      mockSend.mockRejectedValueOnce(undefined);

      const result = await updateEstimatedTime(
        mockClient,
        config,
        leaseId,
        new Date('2025-12-31T18:00:00Z')
      );

      expect(result).toEqual({
        success: false,
        error: 'undefined',
      });
    });

    it('should handle non-Error in getLastCapacityCrunchAlertTime', async () => {
      mockSend.mockRejectedValueOnce('Network timeout');

      const result = await getLastCapacityCrunchAlertTime(mockClient, config);

      expect(result).toEqual({
        success: false,
        lastAlertTime: null,
        error: 'Network timeout',
      });
    });
  });

  describe('getNextPosition error handling (lines 135-136)', () => {
    const leaseId: LeaseId = {
      userEmail: 'user@example.gov.uk',
      uuid: '12345678-1234-1234-1234-123456789012',
    };

    it('should default to position 1 when QueryCommand fails in getNextPosition', async () => {
      // First call: GetItem for existing check - returns nothing (not in queue)
      mockSend.mockResolvedValueOnce({});
      // Second call: QueryCommand for getNextPosition - throws error
      mockSend.mockRejectedValueOnce(new Error('Query failed'));
      // Third call: PutItem - succeeds
      mockSend.mockResolvedValueOnce({});

      const result = await addToQueue(mockClient, config, {
        leaseId,
        estimatedFulfillmentTime: null,
      });

      // Should succeed with position 1 (default when getNextPosition fails)
      expect(result).toEqual({
        success: true,
        position: 1,
      });
    });
  });

  describe('getOldestPending edge cases (lines 310-312)', () => {
    it('should return success with no record when items have undefined positions', async () => {
      // Return items but with missing/undefined position (edge case)
      mockSend.mockResolvedValueOnce({
        Items: [
          marshall({
            leaseId: 'user1@example.gov.uk#uuid1',
            positionStatus: 'PENDING',
            // position is intentionally missing - will be undefined after unmarshall
            queuedAt: '2025-12-30T10:00:00Z',
          }),
        ],
      });

      const result = await getOldestPending(mockClient, config);

      // When record[0].position is undefined, lowestPosition becomes 0 (via ?? 0)
      // Filter for position === 0 will return empty array since no items have position 0
      // Then samePositionRecords[0] is undefined, hitting line 310-312
      expect(result.success).toBe(true);
    });
  });
});
