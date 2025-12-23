/**
 * Idempotency configuration using AWS Lambda Powertools.
 * Ensures duplicate events are processed only once.
 */
import { IdempotencyConfig } from '@aws-lambda-powertools/idempotency';
import { DynamoDBPersistenceLayer } from '@aws-lambda-powertools/idempotency/dynamodb';

/**
 * TTL for idempotency records: 24 hours in seconds
 */
export const IDEMPOTENCY_TTL_SECONDS = 86400;

/**
 * Creates the DynamoDB persistence layer for idempotency.
 * Uses the table specified in environment variable.
 */
export const createPersistenceLayer = (): DynamoDBPersistenceLayer => {
  const tableName = process.env.IDEMPOTENCY_TABLE_NAME;

  if (!tableName) {
    throw new Error('IDEMPOTENCY_TABLE_NAME environment variable is required');
  }

  return new DynamoDBPersistenceLayer({
    tableName,
  });
};

/**
 * Creates the idempotency configuration.
 * Uses JMESPath to extract the idempotency key from the event.
 * Key format: {leaseId}
 *
 * Note: EventBridge events have a unique 'id' field, but we key on leaseId
 * since multiple EventBridge events for the same lease should be deduplicated.
 */
export const createIdempotencyConfig = (): IdempotencyConfig => {
  return new IdempotencyConfig({
    expiresAfterSeconds: IDEMPOTENCY_TTL_SECONDS,
    // Use JMESPath to extract leaseId from EventBridge event detail
    eventKeyJmesPath: 'detail.leaseId.uuid',
    throwOnNoIdempotencyKey: true,
    useLocalCache: true,
  });
};

/**
 * Generates an idempotency key from a lease request.
 * Format: {leaseId}:{eventId}
 *
 * @param leaseId - The lease UUID
 * @param eventId - The EventBridge event ID (optional)
 * @returns The idempotency key
 */
export const generateIdempotencyKey = (leaseId: string, eventId?: string): string => {
  if (eventId) {
    return `${leaseId}:${eventId}`;
  }
  return leaseId;
};
