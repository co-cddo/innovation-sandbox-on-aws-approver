import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import {
  createEventBridgeService,
  type EventBridgeServiceConfig,
  type EmitLeaseApprovedParams,
  type EmitLeaseEscalatedParams,
} from '../../src/services/eventbridge.js';

// Mock the EventBridge client
vi.mock('@aws-sdk/client-eventbridge', async () => {
  const actual = await vi.importActual('@aws-sdk/client-eventbridge');
  return {
    ...actual,
    EventBridgeClient: vi.fn().mockImplementation(() => ({
      send: vi.fn().mockResolvedValue({}),
    })),
  };
});

describe('EventBridge Service', () => {
  let mockClient: EventBridgeClient;
  let mockSend: ReturnType<typeof vi.fn>;
  const config: EventBridgeServiceConfig = {
    eventBusName: 'default',
    source: 'innovation-sandbox',
  };

  beforeEach(() => {
    mockSend = vi.fn().mockResolvedValue({
      FailedEntryCount: 0,
      Entries: [{ EventId: 'test-event-id' }],
    });
    mockClient = {
      send: mockSend,
    } as unknown as EventBridgeClient;
  });

  describe('createEventBridgeService', () => {
    it('creates a service with emitLeaseApproved method', () => {
      const service = createEventBridgeService(mockClient, config);

      expect(service).toBeDefined();
      expect(typeof service.emitLeaseApproved).toBe('function');
    });

    it('creates a service with emitLeaseEscalated method', () => {
      const service = createEventBridgeService(mockClient, config);

      expect(service).toBeDefined();
      expect(typeof service.emitLeaseEscalated).toBe('function');
    });
  });

  describe('emitLeaseApproved', () => {
    const approvalParams: EmitLeaseApprovedParams = {
      leaseId: '123e4567-e89b-12d3-a456-426614174000',
      userEmail: 'user@example.gov.uk',
      approvedBy: 'approver-service@system',
      score: 0,
      reason: 'Stub approval - scoring not implemented',
    };

    it('sends a PutEventsCommand with correct parameters', async () => {
      const service = createEventBridgeService(mockClient, config);

      await service.emitLeaseApproved(approvalParams);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0];
      expect(sentCommand).toBeInstanceOf(PutEventsCommand);
    });

    it('includes correct event entry structure', async () => {
      const service = createEventBridgeService(mockClient, config);

      await service.emitLeaseApproved(approvalParams);

      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0] as PutEventsCommand;
      const entries = sentCommand.input.Entries ?? [];

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        Source: 'innovation-sandbox',
        DetailType: 'LeaseApproved',
        EventBusName: 'default',
      });
    });

    it('includes correct detail payload as JSON string', async () => {
      const service = createEventBridgeService(mockClient, config);

      await service.emitLeaseApproved(approvalParams);

      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0] as PutEventsCommand;
      const entries = sentCommand.input.Entries ?? [];
      const detail = JSON.parse(entries[0]?.Detail ?? '{}');

      expect(detail.leaseId).toBe(approvalParams.leaseId);
      expect(detail.userEmail).toBe(approvalParams.userEmail);
      expect(detail.approvedBy).toBe(approvalParams.approvedBy);
      expect(detail.score).toBe(approvalParams.score);
      expect(detail.reason).toBe(approvalParams.reason);
      expect(detail.timestamp).toBeDefined();
    });

    it('uses configured event bus name', async () => {
      const customConfig: EventBridgeServiceConfig = {
        eventBusName: 'custom-bus',
        source: 'innovation-sandbox',
      };
      const service = createEventBridgeService(mockClient, customConfig);

      await service.emitLeaseApproved(approvalParams);

      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0] as PutEventsCommand;
      const entries = sentCommand.input.Entries ?? [];
      expect(entries[0]?.EventBusName).toBe('custom-bus');
    });

    it('propagates client errors', async () => {
      const error = new Error('EventBridge unavailable');
      mockSend.mockRejectedValue(error);

      const service = createEventBridgeService(mockClient, config);

      await expect(service.emitLeaseApproved(approvalParams)).rejects.toThrow(
        'EventBridge unavailable'
      );
    });

    it('throws error when FailedEntryCount is greater than 0', async () => {
      mockSend.mockResolvedValue({
        FailedEntryCount: 1,
        Entries: [
          {
            ErrorCode: 'InternalException',
            ErrorMessage: 'Service unavailable',
          },
        ],
      });

      const service = createEventBridgeService(mockClient, config);

      await expect(service.emitLeaseApproved(approvalParams)).rejects.toThrow(
        'Failed to emit LeaseApproved event: InternalException - Service unavailable'
      );
    });

    it('handles FailedEntryCount with missing error details gracefully', async () => {
      mockSend.mockResolvedValue({
        FailedEntryCount: 1,
        Entries: [{}],
      });

      const service = createEventBridgeService(mockClient, config);

      await expect(service.emitLeaseApproved(approvalParams)).rejects.toThrow(
        'Failed to emit LeaseApproved event: Unknown - No error message'
      );
    });

    it('handles different approval types', async () => {
      const manualApprovalParams: EmitLeaseApprovedParams = {
        leaseId: '123e4567-e89b-12d3-a456-426614174000',
        userEmail: 'user@nhs.uk',
        approvedBy: 'operator@ndx.gov.uk',
        score: 25,
        reason: 'Manually approved after verification',
      };

      const service = createEventBridgeService(mockClient, config);

      await service.emitLeaseApproved(manualApprovalParams);

      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0] as PutEventsCommand;
      const entries = sentCommand.input.Entries ?? [];
      const detail = JSON.parse(entries[0]?.Detail ?? '{}');

      expect(detail.approvedBy).toBe('operator@ndx.gov.uk');
      expect(detail.score).toBe(25);
      expect(detail.reason).toBe('Manually approved after verification');
    });
  });

  describe('emitLeaseEscalated', () => {
    const escalationParams: EmitLeaseEscalatedParams = {
      leaseId: '123e4567-e89b-12d3-a456-426614174000',
      userEmail: 'user@example.gov.uk',
      reason: 'State machine error: Validation failed',
      errorCode: 'VALIDATION_ERROR',
      score: 5,
    };

    it('sends a PutEventsCommand with correct parameters', async () => {
      const service = createEventBridgeService(mockClient, config);

      await service.emitLeaseEscalated(escalationParams);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0];
      expect(sentCommand).toBeInstanceOf(PutEventsCommand);
    });

    it('includes correct event entry structure', async () => {
      const service = createEventBridgeService(mockClient, config);

      await service.emitLeaseEscalated(escalationParams);

      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0] as PutEventsCommand;
      const entries = sentCommand.input.Entries ?? [];

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        Source: 'innovation-sandbox',
        DetailType: 'LeaseEscalated',
        EventBusName: 'default',
      });
    });

    it('includes correct detail payload as JSON string', async () => {
      const service = createEventBridgeService(mockClient, config);

      await service.emitLeaseEscalated(escalationParams);

      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0] as PutEventsCommand;
      const entries = sentCommand.input.Entries ?? [];
      const detail = JSON.parse(entries[0]?.Detail ?? '{}');

      expect(detail.leaseId).toBe(escalationParams.leaseId);
      expect(detail.userEmail).toBe(escalationParams.userEmail);
      expect(detail.reason).toBe(escalationParams.reason);
      expect(detail.errorCode).toBe(escalationParams.errorCode);
      expect(detail.score).toBe(escalationParams.score);
      expect(detail.timestamp).toBeDefined();
    });

    it('handles optional score being undefined', async () => {
      const paramsWithoutScore: EmitLeaseEscalatedParams = {
        leaseId: '123e4567-e89b-12d3-a456-426614174000',
        userEmail: 'user@example.gov.uk',
        reason: 'Unexpected error',
        errorCode: 'UNEXPECTED_ERROR',
      };

      const service = createEventBridgeService(mockClient, config);

      await service.emitLeaseEscalated(paramsWithoutScore);

      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0] as PutEventsCommand;
      const entries = sentCommand.input.Entries ?? [];
      const detail = JSON.parse(entries[0]?.Detail ?? '{}');

      expect(detail.score).toBeUndefined();
    });

    it('throws error when FailedEntryCount is greater than 0', async () => {
      mockSend.mockResolvedValue({
        FailedEntryCount: 1,
        Entries: [
          {
            ErrorCode: 'InternalException',
            ErrorMessage: 'Service unavailable',
          },
        ],
      });

      const service = createEventBridgeService(mockClient, config);

      await expect(service.emitLeaseEscalated(escalationParams)).rejects.toThrow(
        'Failed to emit LeaseEscalated event: InternalException - Service unavailable'
      );
    });

    it('handles FailedEntryCount with missing error details gracefully', async () => {
      mockSend.mockResolvedValue({
        FailedEntryCount: 1,
        Entries: [{}],
      });

      const service = createEventBridgeService(mockClient, config);

      await expect(service.emitLeaseEscalated(escalationParams)).rejects.toThrow(
        'Failed to emit LeaseEscalated event: Unknown - No error message'
      );
    });

    it('propagates client errors', async () => {
      const error = new Error('EventBridge unavailable');
      mockSend.mockRejectedValue(error);

      const service = createEventBridgeService(mockClient, config);

      await expect(service.emitLeaseEscalated(escalationParams)).rejects.toThrow(
        'EventBridge unavailable'
      );
    });
  });
});
