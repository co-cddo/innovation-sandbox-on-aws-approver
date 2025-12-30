/**
 * Queue Position Service (Story 6.3 - FR62, FR67)
 *
 * Manages queue position in DynamoDB for FIFO processing when
 * sandbox accounts are in cooldown.
 *
 * Uses:
 * - DynamoDB for persistence (survives Lambda cold starts)
 * - GSI on positionStatus+position for FIFO ordering
 * - TTL for automatic cleanup of stale entries
 */

import { DynamoDBClient, QueryCommand, PutItemCommand, DeleteItemCommand, UpdateItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type { LeaseId, QueuePositionRecord, QueuePositionInput, QueuePositionResult } from '../lib/types.js';
import { logger } from '../lib/logger.js';

/**
 * Configuration for the queue position service
 */
export interface QueuePositionServiceConfig {
  readonly tableName: string;
  readonly positionIndexName?: string;
  /** TTL in days for automatic cleanup (default: 7) */
  readonly ttlDays?: number;
}

const DEFAULT_CONFIG: Partial<QueuePositionServiceConfig> = {
  positionIndexName: 'PositionIndex',
  ttlDays: 7,
};

/**
 * Convert LeaseId to DynamoDB partition key string
 */
export const leaseIdToKey = (leaseId: LeaseId): string => {
  return `${leaseId.userEmail}#${leaseId.uuid}`;
};

/**
 * Parse DynamoDB key back to LeaseId
 */
export const keyToLeaseId = (key: string): LeaseId => {
  const parts = key.split('#');
  /* c8 ignore next -- split always returns at least one element */
  const userEmail = parts[0] ?? '';
  const uuid = parts[1] ?? '';
  return { userEmail, uuid };
};

/**
 * Get the current queue depth (count of pending requests)
 */
export const getQueueDepth = async (
  client: DynamoDBClient,
  config: QueuePositionServiceConfig
): Promise<QueuePositionResult> => {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  try {
    const command = new QueryCommand({
      TableName: mergedConfig.tableName,
      IndexName: mergedConfig.positionIndexName,
      KeyConditionExpression: 'positionStatus = :status',
      ExpressionAttributeValues: marshall({
        ':status': 'PENDING',
      }),
      Select: 'COUNT',
    });

    const response = await client.send(command);
    const queueDepth = response.Count ?? 0;

    logger.debug('Queue depth retrieved', { queueDepth });

    return {
      success: true,
      queueDepth,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to get queue depth', { error: errorMessage });
    return {
      success: false,
      error: errorMessage,
    };
  }
};

/**
 * Get the next (highest) position number for new entries.
 *
 * NOTE: This is not atomic - there's a small race condition window where
 * concurrent requests could get the same position number. This is acceptable
 * because:
 * 1. Innovation Sandbox has low request volume (minutes between requests typically)
 * 2. FIFO processing uses queuedAt timestamp as secondary sort in getOldestPending()
 * 3. Position is primarily for user display, not for processing order
 *
 * For high-volume systems, use DynamoDB atomic counter pattern instead.
 */
const getNextPosition = async (
  client: DynamoDBClient,
  config: QueuePositionServiceConfig
): Promise<number> => {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  try {
    // Query the GSI in descending order to get the highest position
    // Note: 'position' is a DynamoDB reserved keyword, so we must use ExpressionAttributeNames
    const command = new QueryCommand({
      TableName: mergedConfig.tableName,
      IndexName: mergedConfig.positionIndexName,
      KeyConditionExpression: 'positionStatus = :status',
      ExpressionAttributeValues: marshall({
        ':status': 'PENDING',
      }),
      ExpressionAttributeNames: {
        '#pos': 'position',
      },
      ScanIndexForward: false, // Descending order
      Limit: 1,
      ProjectionExpression: '#pos',
    });

    const response = await client.send(command);
    const firstItem = response.Items?.[0];
    if (firstItem) {
      const item = unmarshall(firstItem);
      return (item.position as number) + 1;
    }

    // No items in queue, start at position 1
    return 1;
  } catch (error) {
    logger.warn('Failed to get next position, starting at 1', { error });
    return 1;
  }
};

/**
 * Add a lease request to the queue
 */
export const addToQueue = async (
  client: DynamoDBClient,
  config: QueuePositionServiceConfig,
  input: QueuePositionInput
): Promise<QueuePositionResult> => {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const leaseKey = leaseIdToKey(input.leaseId);

  try {
    // Check if already in queue
    const existingCommand = new GetItemCommand({
      TableName: mergedConfig.tableName,
      Key: marshall({ leaseId: leaseKey }),
    });

    const existingResponse = await client.send(existingCommand);
    if (existingResponse.Item) {
      const existing = unmarshall(existingResponse.Item) as QueuePositionRecord;
      logger.info('Request already in queue', {
        leaseId: leaseKey,
        existingPosition: existing.position,
      });
      return {
        success: true,
        position: existing.position,
      };
    }

    // Get next position
    const position = await getNextPosition(client, config);

    // Calculate TTL (7 days from now)
    /* c8 ignore next -- ttlDays always set from DEFAULT_CONFIG spread */
    const ttlDays = mergedConfig.ttlDays ?? 7;
    const ttl = Math.floor(Date.now() / 1000) + ttlDays * 24 * 60 * 60;

    const record: QueuePositionRecord = {
      leaseId: leaseKey,
      position,
      queuedAt: new Date().toISOString(),
      userEmail: input.leaseId.userEmail,
      estimatedFulfillmentTime: input.estimatedFulfillmentTime?.toISOString() ?? null,
      positionStatus: 'PENDING',
      ttl,
    };

    const putCommand = new PutItemCommand({
      TableName: mergedConfig.tableName,
      Item: marshall(record, { removeUndefinedValues: true }),
      ConditionExpression: 'attribute_not_exists(leaseId)', // Idempotent
    });

    await client.send(putCommand);

    logger.info('Added request to queue', {
      leaseId: leaseKey,
      position,
      estimatedFulfillmentTime: record.estimatedFulfillmentTime,
    });

    return {
      success: true,
      position,
    };
  } catch (error) {
    // Handle condition check failure (already exists)
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      logger.info('Request already added to queue (race condition)', { leaseId: leaseKey });
      // Fetch the existing position
      const existingCommand = new GetItemCommand({
        TableName: mergedConfig.tableName,
        Key: marshall({ leaseId: leaseKey }),
      });
      const existingResponse = await client.send(existingCommand);
      if (existingResponse.Item) {
        const existing = unmarshall(existingResponse.Item) as QueuePositionRecord;
        return { success: true, position: existing.position };
      }
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to add to queue', { leaseId: leaseKey, error: errorMessage });
    return {
      success: false,
      error: errorMessage,
    };
  }
};

/**
 * Remove a lease request from the queue (when processed or cancelled)
 */
export const removeFromQueue = async (
  client: DynamoDBClient,
  config: QueuePositionServiceConfig,
  leaseId: LeaseId
): Promise<QueuePositionResult> => {
  const leaseKey = leaseIdToKey(leaseId);

  try {
    const command = new DeleteItemCommand({
      TableName: config.tableName,
      Key: marshall({ leaseId: leaseKey }),
    });

    await client.send(command);

    logger.info('Removed request from queue', { leaseId: leaseKey });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to remove from queue', { leaseId: leaseKey, error: errorMessage });
    return {
      success: false,
      error: errorMessage,
    };
  }
};

/**
 * Get the oldest pending request (for FIFO processing).
 * Returns the request with the lowest position number.
 *
 * If multiple requests have the same position (rare race condition),
 * uses queuedAt timestamp as tiebreaker to ensure true FIFO ordering.
 */
export const getOldestPending = async (
  client: DynamoDBClient,
  config: QueuePositionServiceConfig
): Promise<{ success: boolean; record?: QueuePositionRecord; error?: string }> => {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  try {
    // Fetch a few items to handle potential position collisions
    // In normal operation, we expect unique positions, but race conditions
    // could cause duplicates. Fetching 5 handles typical collision scenarios.
    const command = new QueryCommand({
      TableName: mergedConfig.tableName,
      IndexName: mergedConfig.positionIndexName,
      KeyConditionExpression: 'positionStatus = :status',
      ExpressionAttributeValues: marshall({
        ':status': 'PENDING',
      }),
      ScanIndexForward: true, // Ascending order (lowest position first)
      Limit: 5,
    });

    const response = await client.send(command);
    const items = response.Items;

    if (!items || items.length === 0) {
      logger.debug('No pending requests in queue');
      return { success: true };
    }

    // Unmarshall all items
    const records = items.map((item) => unmarshall(item) as QueuePositionRecord);

    // Find lowest position, then use queuedAt as tiebreaker
    const lowestPosition = records[0]?.position ?? 0;
    const samePositionRecords = records.filter((r) => r.position === lowestPosition);

    // Sort by queuedAt (earliest first) for true FIFO when positions match
    samePositionRecords.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));

    const record = samePositionRecords[0];

    if (!record) {
      logger.debug('No pending requests in queue');
      return { success: true };
    }

    logger.debug('Retrieved oldest pending request', {
      leaseId: record.leaseId,
      position: record.position,
      queuedAt: record.queuedAt,
      candidatesAtSamePosition: samePositionRecords.length,
    });

    return { success: true, record };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to get oldest pending', { error: errorMessage });
    return {
      success: false,
      error: errorMessage,
    };
  }
};

/**
 * Get queue position for a specific lease
 */
export const getQueuePosition = async (
  client: DynamoDBClient,
  config: QueuePositionServiceConfig,
  leaseId: LeaseId
): Promise<QueuePositionResult> => {
  const leaseKey = leaseIdToKey(leaseId);

  try {
    const command = new GetItemCommand({
      TableName: config.tableName,
      Key: marshall({ leaseId: leaseKey }),
    });

    const response = await client.send(command);

    if (!response.Item) {
      logger.debug('Lease not found in queue', { leaseId: leaseKey });
      return { success: true };
    }

    const record = unmarshall(response.Item) as QueuePositionRecord;
    return {
      success: true,
      position: record.position,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to get queue position', { leaseId: leaseKey, error: errorMessage });
    return {
      success: false,
      error: errorMessage,
    };
  }
};

/**
 * Update estimated fulfillment time for a queued request.
 *
 * NOTE: This function is currently not called but is exported for future use cases:
 * - When an account becomes ready, update remaining queue estimates
 * - When queue positions shift after a request is processed
 * - Periodic recalculation of estimates based on actual throughput
 *
 * TODO: Integrate when Story 6.4 (Capacity Crunch Alerts) is complete,
 * or when delay queue processing triggers estimate recalculation.
 */
export const updateEstimatedTime = async (
  client: DynamoDBClient,
  config: QueuePositionServiceConfig,
  leaseId: LeaseId,
  estimatedFulfillmentTime: Date | null
): Promise<QueuePositionResult> => {
  const leaseKey = leaseIdToKey(leaseId);

  try {
    const command = new UpdateItemCommand({
      TableName: config.tableName,
      Key: marshall({ leaseId: leaseKey }),
      UpdateExpression: 'SET estimatedFulfillmentTime = :eft',
      ExpressionAttributeValues: marshall({
        ':eft': estimatedFulfillmentTime?.toISOString() ?? null,
      }),
      ConditionExpression: 'attribute_exists(leaseId)',
    });

    await client.send(command);

    logger.info('Updated estimated fulfillment time', {
      leaseId: leaseKey,
      estimatedFulfillmentTime: estimatedFulfillmentTime?.toISOString() ?? null,
    });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to update estimated time', { leaseId: leaseKey, error: errorMessage });
    return {
      success: false,
      error: errorMessage,
    };
  }
};

// ==========================================
// Capacity Crunch Alert Throttle (Story 6.4)
// ==========================================

/**
 * Fixed key for storing the last capacity crunch alert timestamp.
 * Uses a reserved prefix to avoid collision with lease IDs.
 */
const CAPACITY_CRUNCH_ALERT_KEY = '__SYSTEM__#capacityCrunchLastAlert';

/**
 * Get the last capacity crunch alert timestamp.
 * Returns null if no alert has been sent.
 */
export const getLastCapacityCrunchAlertTime = async (
  client: DynamoDBClient,
  config: QueuePositionServiceConfig
): Promise<{ success: boolean; lastAlertTime: Date | null; error?: string }> => {
  try {
    const command = new GetItemCommand({
      TableName: config.tableName,
      Key: marshall({ leaseId: CAPACITY_CRUNCH_ALERT_KEY }),
    });

    const response = await client.send(command);

    if (!response.Item) {
      logger.debug('No previous capacity crunch alert found');
      return { success: true, lastAlertTime: null };
    }

    const item = unmarshall(response.Item);
    const lastAlertTime = item.lastAlertTime ? new Date(item.lastAlertTime as string) : null;

    logger.debug('Retrieved last capacity crunch alert time', {
      lastAlertTime: lastAlertTime?.toISOString() ?? null,
    });

    return { success: true, lastAlertTime };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to get last capacity crunch alert time', { error: errorMessage });
    return {
      success: false,
      lastAlertTime: null,
      error: errorMessage,
    };
  }
};

/**
 * Update the last capacity crunch alert timestamp.
 * Used after successfully sending a capacity crunch alert to implement throttling.
 */
export const updateLastCapacityCrunchAlertTime = async (
  client: DynamoDBClient,
  config: QueuePositionServiceConfig,
  alertTime: Date
): Promise<{ success: boolean; error?: string }> => {
  try {
    // Calculate TTL (7 days from now - matches queue TTL)
    const ttl = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

    const command = new PutItemCommand({
      TableName: config.tableName,
      Item: marshall({
        leaseId: CAPACITY_CRUNCH_ALERT_KEY,
        lastAlertTime: alertTime.toISOString(),
        positionStatus: 'SYSTEM', // Required for GSI, won't interfere with queue queries
        position: 0,
        ttl,
      }),
    });

    await client.send(command);

    logger.info('Updated last capacity crunch alert time', {
      lastAlertTime: alertTime.toISOString(),
    });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to update last capacity crunch alert time', { error: errorMessage });
    return {
      success: false,
      error: errorMessage,
    };
  }
};
