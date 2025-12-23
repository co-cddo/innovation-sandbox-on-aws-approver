/**
 * DynamoDB Service for querying ISB Leases table.
 *
 * Implements user history queries for the scoring engine.
 * Uses factory pattern for dependency injection of client.
 */

import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { LeaseHistoryRecord } from '../scoring/types.js';

/**
 * Configuration for the DynamoDB service.
 */
export interface DynamoDBServiceConfig {
  /** ISB Leases table name */
  tableName: string;
}

/**
 * DynamoDB service interface.
 */
export interface DynamoDBService {
  /**
   * Get user lease history from ISB Leases table.
   * Queries by userEmail partition key and returns all leases.
   * Date filtering is done in application code.
   *
   * @param userEmail - User email address (partition key)
   * @returns Array of lease history records
   */
  getUserLeaseHistory: (userEmail: string) => Promise<LeaseHistoryRecord[]>;

  /**
   * Get organization lease history from ISB Leases table.
   * Scans for all users with emails ending in @domain.
   * Used for org-level scoring rules (Story 3.2).
   *
   * @param domain - Email domain to query (e.g., 'councilname.gov.uk')
   * @param excludeEmail - Optional email to exclude (the current user)
   * @returns Array of lease history records for the organization
   */
  getOrgLeaseHistory: (domain: string, excludeEmail?: string) => Promise<LeaseHistoryRecord[]>;
}

/**
 * Create a DynamoDB service with the given client and configuration.
 * Uses factory pattern for dependency injection.
 *
 * @param client - DynamoDB Document Client
 * @param config - Service configuration (table name)
 * @returns DynamoDBService instance
 */
export const createDynamoDBService = (
  client: DynamoDBDocumentClient,
  config: DynamoDBServiceConfig
): DynamoDBService => {
  const { tableName } = config;

  /**
   * Get user lease history from ISB Leases table.
   */
  const getUserLeaseHistory = async (userEmail: string): Promise<LeaseHistoryRecord[]> => {
    const command = new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'userEmail = :email',
      ExpressionAttributeValues: {
        ':email': userEmail,
      },
    });

    const response = await client.send(command);

    // Map DynamoDB items to LeaseHistoryRecord
    // ISB table has more fields than we need, so we extract only relevant ones
    return (response.Items ?? []).map((item) => ({
      uuid: item.uuid as string,
      userEmail: item.userEmail as string,
      status: item.status as LeaseHistoryRecord['status'],
      originalLeaseTemplateUuid: item.originalLeaseTemplateUuid as string,
      created: item.created as string,
      endDate: item.endDate as string | undefined,
    }));
  };

  /**
   * Get organization lease history from ISB Leases table.
   * Uses Scan with filter for domain matching (acceptable at 500 requests/day scale).
   * Handles pagination to ensure all results are returned.
   */
  const getOrgLeaseHistory = async (
    domain: string,
    excludeEmail?: string
  ): Promise<LeaseHistoryRecord[]> => {
    const allItems: Record<string, unknown>[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    // Paginate through all results
    do {
      const command = new ScanCommand({
        TableName: tableName,
        FilterExpression: 'contains(userEmail, :domain)',
        ExpressionAttributeValues: {
          ':domain': `@${domain}`,
        },
        ExclusiveStartKey: lastEvaluatedKey,
      });

      const response = await client.send(command);
      allItems.push(...(response.Items ?? []));
      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    // Map DynamoDB items to LeaseHistoryRecord and filter out current user
    return allItems
      .filter((item) => !excludeEmail || item.userEmail !== excludeEmail)
      .map((item) => ({
        uuid: item.uuid as string,
        userEmail: item.userEmail as string,
        status: item.status as LeaseHistoryRecord['status'],
        originalLeaseTemplateUuid: item.originalLeaseTemplateUuid as string,
        created: item.created as string,
        endDate: item.endDate as string | undefined,
      }));
  };

  return { getUserLeaseHistory, getOrgLeaseHistory };
};

/**
 * Filter lease history records to include only those within the specified number of days.
 * Uses the 'created' timestamp for filtering.
 *
 * @param leases - Array of lease history records
 * @param days - Number of days to filter by (from now)
 * @returns Filtered array of leases within the time window
 */
export const filterByDays = (leases: LeaseHistoryRecord[], days: number): LeaseHistoryRecord[] => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  return leases.filter((lease) => {
    const created = new Date(lease.created);
    return created >= cutoff;
  });
};

/**
 * Check if a lease was created within the specified number of days from a reference date.
 *
 * @param leaseCreated - ISO datetime string of lease creation
 * @param days - Number of days to check against
 * @param referenceDate - Reference date to compare against (defaults to now)
 * @returns true if lease is within the time window
 */
export const isWithinDays = (
  leaseCreated: string,
  days: number,
  referenceDate: Date = new Date()
): boolean => {
  const cutoff = new Date(referenceDate);
  cutoff.setDate(cutoff.getDate() - days);

  const created = new Date(leaseCreated);
  return created >= cutoff;
};
