import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handler,
  setEventBridgeService,
  resetEventBridgeService,
  setOrchestrator,
  resetOrchestrator,
} from '../src/handler.js';
import type { EventBridgeEvent, Context } from 'aws-lambda';
import type { EventBridgeService } from '../src/services/eventbridge.js';
import type { StateMachineOrchestrator } from '../src/state-machine/index.js';
import { ApprovalState, createInitialContext } from '../src/state-machine/index.js';

vi.mock('../src/lib/logger.ts', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    addContext: vi.fn(),
    appendKeys: vi.fn(),
  },
}));

// Mock the EventBridge client to prevent real AWS calls
vi.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({}),
  })),
  PutEventsCommand: vi.fn(),
}));

// Import the mocked logger for assertions
import { logger as mockLogger } from '../src/lib/logger.js';

// Mock EventBridge service for testing
const mockEmitLeaseApproved = vi.fn().mockResolvedValue(undefined);
const mockEmitLeaseEscalated = vi.fn().mockResolvedValue(undefined);
const mockEventBridgeService: EventBridgeService = {
  emitLeaseApproved: mockEmitLeaseApproved,
  emitLeaseEscalated: mockEmitLeaseEscalated,
};

describe('handler', () => {
  const mockContext: Context = {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'test-function',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test',
    memoryLimitInMB: '128',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/test',
    logStreamName: '2024/01/01/[$LATEST]abc123',
    getRemainingTimeInMillis: () => 30000,
    done: vi.fn(),
    fail: vi.fn(),
    succeed: vi.fn(),
  };

  const createMockEvent = (
    detailType: string,
    detail: unknown
  ): EventBridgeEvent<string, unknown> => ({
    version: '0',
    id: 'test-event-id',
    'detail-type': detailType,
    source: 'innovation-sandbox',
    account: '123456789012',
    time: '2024-01-01T00:00:00Z',
    region: 'us-east-1',
    resources: [],
    detail,
  });

  const createValidLeaseRequestedEvent = () =>
    createMockEvent('LeaseRequested', {
      leaseId: {
        userEmail: 'user@example.gov.uk',
        uuid: '123e4567-e89b-12d3-a456-426614174000',
      },
      templateId: 'web-hosting',
      budgetAmount: 50,
      leaseDurationHours: 48,
      requiresManualApproval: false,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    // Inject mock EventBridge service for testing
    setEventBridgeService(mockEventBridgeService);
  });

  afterEach(() => {
    // Reset to avoid affecting other tests
    resetEventBridgeService();
    resetOrchestrator();
  });

  describe('LeaseRequested events', () => {
    it('should process valid LeaseRequested event and return OK', async () => {
      const event = createValidLeaseRequestedEvent();

      const result = await handler(event, mockContext);

      expect(result).toEqual({
        statusCode: 200,
        body: 'OK',
      });
    });

    it('should extract leaseId, userEmail, and templateId from event', async () => {
      const event = createValidLeaseRequestedEvent();

      await handler(event, mockContext);

      expect(mockLogger.appendKeys).toHaveBeenCalledWith({
        leaseId: '123e4567-e89b-12d3-a456-426614174000',
        userEmail: 'user@example.gov.uk',
        templateId: 'web-hosting',
        eventId: 'test-event-id',
        idempotencyKey: '123e4567-e89b-12d3-a456-426614174000:test-event-id',
      });
    });

    it('should log event received with structured data', async () => {
      const event = createValidLeaseRequestedEvent();

      await handler(event, mockContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'LeaseRequested event received',
        expect.objectContaining({
          detailType: 'LeaseRequested',
          budgetAmount: 50,
          leaseDurationHours: 48,
          requiresManualApproval: false,
        })
      );
    });

    it('should reject invalid LeaseRequested event schema', async () => {
      const invalidEvent = createMockEvent('LeaseRequested', {
        leaseId: 'invalid-format', // Should be object with userEmail and uuid
        templateId: 'web-hosting',
      });

      const result = await handler(invalidEvent, mockContext);

      expect(result).toEqual({
        statusCode: 400,
        body: 'Invalid event schema',
      });
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Invalid LeaseRequested event schema',
        expect.objectContaining({ errors: expect.any(Array) })
      );
    });

    it('should handle optional comments field', async () => {
      const event = createMockEvent('LeaseRequested', {
        leaseId: {
          userEmail: 'user@example.gov.uk',
          uuid: '123e4567-e89b-12d3-a456-426614174000',
        },
        templateId: 'web-hosting',
        budgetAmount: 50,
        leaseDurationHours: 48,
        comments: 'Testing Lambda + API Gateway',
        requiresManualApproval: false,
      });

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
    });

    it('should emit LeaseApproved event with correct parameters', async () => {
      const event = createValidLeaseRequestedEvent();

      await handler(event, mockContext);

      expect(mockEmitLeaseApproved).toHaveBeenCalledTimes(1);
      expect(mockEmitLeaseApproved).toHaveBeenCalledWith({
        leaseId: '123e4567-e89b-12d3-a456-426614174000',
        userEmail: 'user@example.gov.uk',
        approvedBy: 'approver-service@system',
        score: expect.any(Number), // Score calculated by scoring engine
        reason: expect.stringContaining('below threshold'), // State machine provides decision reason
      });
    });

    it('should log approval with action approved and timestamp', async () => {
      const event = createValidLeaseRequestedEvent();

      await handler(event, mockContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Approval emitted',
        expect.objectContaining({
          action: 'approved',
          timestamp: expect.any(String),
          leaseId: '123e4567-e89b-12d3-a456-426614174000',
          userEmail: 'user@example.gov.uk',
          approvedBy: 'approver-service@system',
          score: expect.any(Number), // Score calculated by scoring engine
        })
      );
    });

    it('should throw ProcessingError when EventBridge emission fails (fail-closed)', async () => {
      const event = createValidLeaseRequestedEvent();
      mockEmitLeaseApproved.mockRejectedValueOnce(new Error('EventBridge unavailable'));

      await expect(handler(event, mockContext)).rejects.toThrow('EventBridge unavailable');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Unexpected error - triggering fail-closed escalation',
        expect.objectContaining({
          error: 'EventBridge unavailable',
          leaseId: '123e4567-e89b-12d3-a456-426614174000',
          userEmail: 'user@example.gov.uk',
        })
      );
      // Should emit LeaseEscalated for fail-closed behavior with score from state machine
      expect(mockEmitLeaseEscalated).toHaveBeenCalledWith({
        leaseId: '123e4567-e89b-12d3-a456-426614174000',
        userEmail: 'user@example.gov.uk',
        reason: 'Unexpected error: EventBridge unavailable',
        errorCode: 'UNEXPECTED_ERROR',
        score: expect.any(Number), // Score is now captured from state machine for error reporting
      });
    });

    it('should throw ProcessingError for non-Error exceptions in EventBridge emission', async () => {
      const event = createValidLeaseRequestedEvent();
      mockEmitLeaseApproved.mockRejectedValueOnce('String error');

      await expect(handler(event, mockContext)).rejects.toThrow('String error');

      expect(mockEmitLeaseEscalated).toHaveBeenCalled();
    });
  });

  describe('non-LeaseRequested events', () => {
    it('should ignore AccountCleanupSucceeded events', async () => {
      const event = createMockEvent('AccountCleanupSucceeded', {
        accountId: 'test-account',
      });

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('Ignored - not a LeaseRequested event');
      expect(mockLogger.info).toHaveBeenCalledWith('Ignoring non-LeaseRequested event', {
        detailType: 'AccountCleanupSucceeded',
      });
    });

    it('should ignore ScheduledProcessing events', async () => {
      const event = createMockEvent('ScheduledProcessing', {});

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('Ignored - not a LeaseRequested event');
    });
  });

  describe('state machine integration', () => {
    it('should throw ProcessingError when state machine fails (fail-closed)', async () => {
      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.ERROR,
          success: false,
          context: {
            ...createInitialContext(),
            leaseId: '123e4567-e89b-12d3-a456-426614174000',
            userEmail: 'user@example.gov.uk',
            error: {
              message: 'Validation failed',
              code: 'VALIDATION_ERROR',
              state: ApprovalState.VALIDATING,
            },
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();
      await expect(handler(event, mockContext)).rejects.toThrow('Validation failed');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'State machine failed - triggering fail-closed escalation',
        expect.objectContaining({
          finalState: ApprovalState.ERROR,
        })
      );
      // Should emit LeaseEscalated for fail-closed behavior
      expect(mockEmitLeaseEscalated).toHaveBeenCalledWith({
        leaseId: '123e4567-e89b-12d3-a456-426614174000',
        userEmail: 'user@example.gov.uk',
        reason: 'State machine error: Validation failed',
        errorCode: 'VALIDATION_ERROR',
        score: 0,
      });
    });

    it('should handle escalated decision', async () => {
      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.ESCALATED,
          success: true,
          context: {
            ...createInitialContext(),
            leaseId: '123e4567-e89b-12d3-a456-426614174000',
            userEmail: 'user@example.gov.uk',
            templateId: 'web-hosting',
            score: 25,
            decision: 'escalated',
            reason: 'Score 25 meets or exceeds threshold 20',
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('OK');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Request escalated for manual review',
        expect.objectContaining({
          action: 'escalated',
          score: 25,
        })
      );
      // Escalated requests still emit approval event for backward compatibility
      expect(mockEmitLeaseApproved).toHaveBeenCalled();
    });

    it('should throw ProcessingError when EventBridge emission fails for escalated request (fail-closed)', async () => {
      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.ESCALATED,
          success: true,
          context: {
            ...createInitialContext(),
            leaseId: '123e4567-e89b-12d3-a456-426614174000',
            userEmail: 'user@example.gov.uk',
            templateId: 'web-hosting',
            score: 25,
            decision: 'escalated',
            reason: 'Score 25 meets or exceeds threshold 20',
          },
        }),
      };
      setOrchestrator(mockOrchestrator);
      mockEmitLeaseApproved.mockRejectedValueOnce(new Error('EventBridge unavailable'));

      const event = createValidLeaseRequestedEvent();
      await expect(handler(event, mockContext)).rejects.toThrow('EventBridge unavailable');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Unexpected error - triggering fail-closed escalation',
        expect.objectContaining({
          error: 'EventBridge unavailable',
        })
      );
      expect(mockEmitLeaseEscalated).toHaveBeenCalled();
    });

    it('should throw ProcessingError for non-Error exceptions in escalated EventBridge emission', async () => {
      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.ESCALATED,
          success: true,
          context: {
            ...createInitialContext(),
            leaseId: '123e4567-e89b-12d3-a456-426614174000',
            userEmail: 'user@example.gov.uk',
            templateId: 'web-hosting',
            score: 25,
            decision: 'escalated',
            reason: 'Score 25 meets or exceeds threshold 20',
          },
        }),
      };
      setOrchestrator(mockOrchestrator);
      mockEmitLeaseApproved.mockRejectedValueOnce('String error');

      const event = createValidLeaseRequestedEvent();
      await expect(handler(event, mockContext)).rejects.toThrow('String error');

      expect(mockEmitLeaseEscalated).toHaveBeenCalled();
    });

    it('should return 500 for denied decision (not yet implemented)', async () => {
      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.DENIED,
          success: true,
          context: {
            ...createInitialContext(),
            leaseId: '123e4567-e89b-12d3-a456-426614174000',
            userEmail: 'user@example.gov.uk',
            templateId: 'web-hosting',
            decision: 'denied',
            score: 50,
            reason: 'Rate limited',
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(500);
      expect(result.body).toBe('Denied requests not yet implemented');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Request denied',
        expect.objectContaining({
          action: 'denied',
          leaseId: '123e4567-e89b-12d3-a456-426614174000',
          userEmail: 'user@example.gov.uk',
          score: 50,
          reason: 'Rate limited',
        })
      );
    });

    it('should return 500 for unexpected decision', async () => {
      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.APPROVED,
          success: true,
          context: {
            ...createInitialContext(),
            leaseId: '123e4567-e89b-12d3-a456-426614174000',
            userEmail: 'user@example.gov.uk',
            templateId: 'web-hosting',
            decision: 'unknown' as 'approved', // Force unexpected decision via type coercion
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(500);
      expect(result.body).toBe('Unexpected processing state');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Unexpected decision from state machine',
        expect.objectContaining({
          decision: 'unknown',
        })
      );
    });

    it('should handle undefined decision', async () => {
      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.APPROVED,
          success: true,
          context: {
            ...createInitialContext(),
            leaseId: '123e4567-e89b-12d3-a456-426614174000',
            userEmail: 'user@example.gov.uk',
            templateId: 'web-hosting',
            decision: undefined, // No decision set
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      // Should fall through to unexpected state
      expect(result.statusCode).toBe(500);
      expect(result.body).toBe('Unexpected processing state');
    });

    it('should use default approvedBy and reason when not set by state machine', async () => {
      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.APPROVED,
          success: true,
          context: {
            ...createInitialContext(),
            leaseId: '123e4567-e89b-12d3-a456-426614174000',
            userEmail: 'user@example.gov.uk',
            templateId: 'web-hosting',
            score: 0,
            decision: 'approved',
            approvedBy: undefined, // Not set - should use default
            reason: undefined, // Not set - should use default
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(mockEmitLeaseApproved).toHaveBeenCalledWith(
        expect.objectContaining({
          approvedBy: 'approver-service@system',
          reason: 'Auto-approved',
        })
      );
    });

    it('should still throw when emitLeaseEscalated fails', async () => {
      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.ERROR,
          success: false,
          context: {
            ...createInitialContext(),
            leaseId: '123e4567-e89b-12d3-a456-426614174000',
            userEmail: 'user@example.gov.uk',
            error: {
              message: 'Validation failed',
              code: 'VALIDATION_ERROR',
              state: ApprovalState.VALIDATING,
            },
          },
        }),
      };
      setOrchestrator(mockOrchestrator);
      // Mock emitLeaseEscalated to fail
      mockEmitLeaseEscalated.mockRejectedValueOnce(new Error('Escalation failed'));

      const event = createValidLeaseRequestedEvent();
      await expect(handler(event, mockContext)).rejects.toThrow('Validation failed');

      // Should log the failure to emit LeaseEscalated
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to emit LeaseEscalated event',
        expect.objectContaining({
          error: 'Escalation failed',
          leaseId: '123e4567-e89b-12d3-a456-426614174000',
          userEmail: 'user@example.gov.uk',
        })
      );
    });

    it('should handle non-Error exceptions when emitLeaseEscalated fails', async () => {
      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.ERROR,
          success: false,
          context: {
            ...createInitialContext(),
            leaseId: '123e4567-e89b-12d3-a456-426614174000',
            userEmail: 'user@example.gov.uk',
            error: {
              message: 'Validation failed',
              code: 'VALIDATION_ERROR',
              state: ApprovalState.VALIDATING,
            },
          },
        }),
      };
      setOrchestrator(mockOrchestrator);
      // Mock emitLeaseEscalated to fail with a non-Error value
      mockEmitLeaseEscalated.mockRejectedValueOnce('String error from EventBridge');

      const event = createValidLeaseRequestedEvent();
      await expect(handler(event, mockContext)).rejects.toThrow('Validation failed');

      // Should log the failure to emit LeaseEscalated with stringified error
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to emit LeaseEscalated event',
        expect.objectContaining({
          error: 'String error from EventBridge',
          leaseId: '123e4567-e89b-12d3-a456-426614174000',
          userEmail: 'user@example.gov.uk',
        })
      );
    });

    it('should handle state machine error with missing message and code', async () => {
      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.ERROR,
          success: false,
          context: {
            ...createInitialContext(),
            leaseId: '123e4567-e89b-12d3-a456-426614174000',
            userEmail: 'user@example.gov.uk',
            error: {
              // Missing message and code - tests null coalescing on lines 221-222
              state: ApprovalState.VALIDATING,
            },
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();
      await expect(handler(event, mockContext)).rejects.toThrow('Unknown error');

      // Should emit LeaseEscalated with default error code
      expect(mockEmitLeaseEscalated).toHaveBeenCalledWith({
        leaseId: '123e4567-e89b-12d3-a456-426614174000',
        userEmail: 'user@example.gov.uk',
        reason: 'State machine error: Unknown error',
        errorCode: 'UNKNOWN_ERROR',
        score: 0,
      });
    });

    it('should log ALLOW-LIST-OVERRIDE when allow-listed user is approved', async () => {
      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.APPROVED,
          success: true,
          context: {
            ...createInitialContext(),
            leaseId: '123e4567-e89b-12d3-a456-426614174000',
            userEmail: 'chris.nesbitt-smith@dsit.gov.uk',
            templateId: 'web-hosting',
            score: 0,
            decision: 'approved',
            approvedBy: 'approver-service@system',
            reason: 'ALLOW-LIST-OVERRIDE',
            allowListOverride: true,
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createMockEvent('LeaseRequested', {
        leaseId: {
          userEmail: 'chris.nesbitt-smith@dsit.gov.uk',
          uuid: '123e4567-e89b-12d3-a456-426614174000',
        },
        templateId: 'web-hosting',
        budgetAmount: 50,
        leaseDurationHours: 48,
        requiresManualApproval: false,
      });
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'ALLOW-LIST-OVERRIDE applied',
        expect.objectContaining({
          action: 'approved',
          allowListOverride: true,
        })
      );
    });
  });
});
