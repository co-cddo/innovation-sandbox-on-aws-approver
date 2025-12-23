/**
 * EventBridge service for emitting approval events
 * Uses DI pattern with factory function for testability
 */

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { LeaseApprovedDetail, LeaseEscalatedDetail } from '../lib/types.js';

/**
 * EventBridge service configuration
 */
export interface EventBridgeServiceConfig {
  readonly eventBusName: string;
  readonly source: string;
}

/**
 * Parameters for emitting a lease approved event
 */
export interface EmitLeaseApprovedParams {
  readonly leaseId: string;
  readonly userEmail: string;
  readonly approvedBy: string;
  readonly score: number;
  readonly reason: string;
}

/**
 * Parameters for emitting a lease escalated event (fail-closed error handling)
 */
export interface EmitLeaseEscalatedParams {
  readonly leaseId: string;
  readonly userEmail: string;
  readonly reason: string;
  readonly errorCode: string;
  readonly score?: number;
}

/**
 * EventBridge service interface for type-safe dependency injection
 */
export interface EventBridgeService {
  emitLeaseApproved(params: EmitLeaseApprovedParams): Promise<void>;
  emitLeaseEscalated(params: EmitLeaseEscalatedParams): Promise<void>;
}

/**
 * Creates an EventBridge service with the given client and configuration.
 * Uses factory function pattern for dependency injection and testability.
 *
 * @param client - EventBridge client instance
 * @param config - Configuration including event bus name and source
 * @returns EventBridge service instance
 *
 * @example
 * ```typescript
 * const client = new EventBridgeClient({ region: 'us-west-2' });
 * const service = createEventBridgeService(client, {
 *   eventBusName: 'default',
 *   source: 'innovation-sandbox',
 * });
 * await service.emitLeaseApproved({
 *   leaseId: 'abc-123',
 *   userEmail: 'user@gov.uk',
 *   approvedBy: 'approver-service@system',
 *   score: 0,
 *   reason: 'Auto-approved',
 * });
 * ```
 */
export const createEventBridgeService = (
  client: EventBridgeClient,
  config: EventBridgeServiceConfig
): EventBridgeService => ({
  emitLeaseApproved: async (params: EmitLeaseApprovedParams): Promise<void> => {
    const detail: LeaseApprovedDetail = {
      leaseId: params.leaseId,
      userEmail: params.userEmail,
      approvedBy: params.approvedBy,
      score: params.score,
      reason: params.reason,
      timestamp: new Date().toISOString(),
    };

    const command = new PutEventsCommand({
      Entries: [
        {
          Source: config.source,
          DetailType: 'LeaseApproved',
          Detail: JSON.stringify(detail),
          EventBusName: config.eventBusName,
        },
      ],
    });

    const response = await client.send(command);

    // Check for partial failures - EventBridge can return success but fail to deliver
    if (response.FailedEntryCount && response.FailedEntryCount > 0) {
      const failedEntry = response.Entries?.[0];
      throw new Error(
        `Failed to emit LeaseApproved event: ${failedEntry?.ErrorCode ?? 'Unknown'} - ${failedEntry?.ErrorMessage ?? 'No error message'}`
      );
    }
  },

  emitLeaseEscalated: async (params: EmitLeaseEscalatedParams): Promise<void> => {
    const detail: LeaseEscalatedDetail = {
      leaseId: params.leaseId,
      userEmail: params.userEmail,
      reason: params.reason,
      errorCode: params.errorCode,
      score: params.score,
      timestamp: new Date().toISOString(),
    };

    const command = new PutEventsCommand({
      Entries: [
        {
          Source: config.source,
          DetailType: 'LeaseEscalated',
          Detail: JSON.stringify(detail),
          EventBusName: config.eventBusName,
        },
      ],
    });

    const response = await client.send(command);

    // Check for partial failures - EventBridge can return success but fail to deliver
    if (response.FailedEntryCount && response.FailedEntryCount > 0) {
      const failedEntry = response.Entries?.[0];
      throw new Error(
        `Failed to emit LeaseEscalated event: ${failedEntry?.ErrorCode ?? 'Unknown'} - ${failedEntry?.ErrorMessage ?? 'No error message'}`
      );
    }
  },
});
