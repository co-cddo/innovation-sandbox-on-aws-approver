import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handler,
  setEventBridgeService,
  resetEventBridgeService,
  setIsbLambdaService,
  resetIsbLambdaService,
  setDynamoDBService,
  resetDynamoDBService,
  setOrchestrator,
  resetOrchestrator,
} from '../src/handler.js';
import type { DynamoDBService } from '../src/services/dynamodb.js';
import type { EventBridgeEvent, Context } from 'aws-lambda';
import type { EventBridgeService } from '../src/services/eventbridge.js';
import type { IsbLambdaService } from '../src/services/isb-lambda.js';
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

// Mock the Lambda client to prevent real AWS calls
vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({}),
  })),
  InvokeCommand: vi.fn(),
}));

// Mock the DynamoDB client to prevent real AWS calls
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn().mockReturnValue({}),
  },
  QueryCommand: vi.fn(),
}));

// Import the mocked logger for assertions
import { logger as mockLogger } from '../src/lib/logger.js';

// Mock EventBridge service for testing (used for escalation events only)
// Note: emitLeaseApproved is no longer used - approvals go via ISB Lambda directly
const mockEmitLeaseEscalated = vi.fn().mockResolvedValue(undefined);
const mockEventBridgeService: EventBridgeService = {
  emitLeaseApproved: vi.fn().mockResolvedValue(undefined), // Kept for interface compliance
  emitLeaseEscalated: mockEmitLeaseEscalated,
};

// Mock ISB Lambda service for testing (used for actual approvals)
const mockApproveLease = vi.fn().mockResolvedValue({ success: true, statusCode: 200 });
const mockDenyLease = vi.fn().mockResolvedValue({ success: true, statusCode: 200 });
const mockIsbLambdaService: IsbLambdaService = {
  approveLease: mockApproveLease,
  denyLease: mockDenyLease,
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
    // Inject mock services for testing
    setEventBridgeService(mockEventBridgeService);
    setIsbLambdaService(mockIsbLambdaService);
  });

  afterEach(() => {
    // Reset to avoid affecting other tests
    resetEventBridgeService();
    resetIsbLambdaService();
    resetDynamoDBService();
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

    it('should extract leaseId, userEmail, templateId, and domain from event', async () => {
      const event = createValidLeaseRequestedEvent();

      await handler(event, mockContext);

      expect(mockLogger.appendKeys).toHaveBeenCalledWith({
        leaseId: '123e4567-e89b-12d3-a456-426614174000',
        userEmail: 'user@example.gov.uk',
        templateId: 'web-hosting',
        eventId: 'test-event-id',
        idempotencyKey: '123e4567-e89b-12d3-a456-426614174000:test-event-id',
        domain: 'example.gov.uk',
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

    it('should call ISB Lambda service to approve lease', async () => {
      const event = createValidLeaseRequestedEvent();

      await handler(event, mockContext);

      expect(mockApproveLease).toHaveBeenCalledTimes(1);
      expect(mockApproveLease).toHaveBeenCalledWith({
        leaseId: {
          userEmail: 'user@example.gov.uk',
          uuid: '123e4567-e89b-12d3-a456-426614174000',
        },
        approverEmail: 'ndx+try-automated-approver@dsit.gov.uk',
      });
    });

    it('should log approval with action approved and timestamp', async () => {
      const event = createValidLeaseRequestedEvent();

      await handler(event, mockContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Lease approved via ISB Lambda',
        expect.objectContaining({
          action: 'approved',
          timestamp: expect.any(String),
          leaseId: '123e4567-e89b-12d3-a456-426614174000',
          userEmail: 'user@example.gov.uk',
          approvedBy: 'ndx+try-automated-approver@dsit.gov.uk',
          score: expect.any(Number), // Score calculated by scoring engine
        })
      );
    });

    it('should throw ProcessingError when ISB Lambda approval fails (fail-closed)', async () => {
      const event = createValidLeaseRequestedEvent();
      mockApproveLease.mockResolvedValueOnce({ success: false, statusCode: 500, error: 'ISB unavailable' });

      await expect(handler(event, mockContext)).rejects.toThrow('ISB unavailable');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'ISB Lambda approval failed',
        expect.objectContaining({
          leaseId: '123e4567-e89b-12d3-a456-426614174000',
          userEmail: 'user@example.gov.uk',
          error: 'ISB unavailable',
        })
      );
      // Should emit LeaseEscalated for fail-closed behavior with score from state machine
      expect(mockEmitLeaseEscalated).toHaveBeenCalledWith({
        leaseId: {
          userEmail: 'user@example.gov.uk',
          uuid: '123e4567-e89b-12d3-a456-426614174000',
        },
        reason: 'ISB Lambda approval failed: ISB unavailable',
        errorCode: 'ISB_APPROVAL_FAILED',
        score: expect.any(Number), // Score is now captured from state machine for error reporting
      });
    });

    it('should throw ProcessingError when ISB Lambda throws exception', async () => {
      const event = createValidLeaseRequestedEvent();
      mockApproveLease.mockRejectedValueOnce(new Error('Network error'));

      await expect(handler(event, mockContext)).rejects.toThrow('Network error');

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
        leaseId: {
          userEmail: 'user@example.gov.uk',
          uuid: '123e4567-e89b-12d3-a456-426614174000',
        },
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
      // Escalated requests call ISB Lambda for approval (stub auto-approval)
      expect(mockApproveLease).toHaveBeenCalled();
    });

    it('should throw ProcessingError when ISB Lambda fails for escalated request (fail-closed)', async () => {
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
      mockApproveLease.mockResolvedValueOnce({ success: false, statusCode: 500, error: 'ISB unavailable' });

      const event = createValidLeaseRequestedEvent();
      await expect(handler(event, mockContext)).rejects.toThrow('ISB unavailable');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'ISB Lambda approval failed for escalated request',
        expect.objectContaining({
          error: 'ISB unavailable',
        })
      );
      expect(mockEmitLeaseEscalated).toHaveBeenCalled();
    });

    it('should throw ProcessingError when ISB Lambda throws for escalated request', async () => {
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
      mockApproveLease.mockRejectedValueOnce(new Error('Network error'));

      const event = createValidLeaseRequestedEvent();
      await expect(handler(event, mockContext)).rejects.toThrow('Network error');

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

    it('should use default approvedBy when not set by state machine', async () => {
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
      expect(mockApproveLease).toHaveBeenCalledWith(
        expect.objectContaining({
          approverEmail: 'ndx+try-automated-approver@dsit.gov.uk',
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
        leaseId: {
          userEmail: 'user@example.gov.uk',
          uuid: '123e4567-e89b-12d3-a456-426614174000',
        },
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
            approvedBy: 'ndx+try-automated-approver@dsit.gov.uk',
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

  describe('DynamoDB user history integration', () => {
    it('should query user history when DynamoDB service is configured', async () => {
      const mockHistory = [
        {
          uuid: 'lease-1',
          userEmail: 'user@example.gov.uk',
          status: 'Expired' as const,
          originalLeaseTemplateUuid: 'template-1',
          created: new Date().toISOString(),
        },
      ];
      const mockDynamoDBService: DynamoDBService = {
        getUserLeaseHistory: vi.fn().mockResolvedValue(mockHistory),
        getOrgLeaseHistory: vi.fn().mockResolvedValue([]),
      };
      setDynamoDBService(mockDynamoDBService);

      const event = createValidLeaseRequestedEvent();
      await handler(event, mockContext);

      expect(mockDynamoDBService.getUserLeaseHistory).toHaveBeenCalledWith('user@example.gov.uk');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'User history retrieved',
        expect.objectContaining({
          userEmail: 'user@example.gov.uk',
          leaseCount: 1,
        })
      );
    });

    it('should use pessimistic fallback when DynamoDB service is not configured', async () => {
      // Set DynamoDB service to undefined to simulate not configured
      setDynamoDBService(undefined);

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      // Should still succeed with pessimistic fallback
      expect(result.statusCode).toBe(200);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'DynamoDB service not configured - using pessimistic fallback',
        expect.objectContaining({
          userEmail: 'user@example.gov.uk',
        })
      );
    });

    it('should use pessimistic fallback on DynamoDB query error (AC9)', async () => {
      const mockDynamoDBService: DynamoDBService = {
        getUserLeaseHistory: vi.fn().mockRejectedValue(new Error('DynamoDB unavailable')),
        getOrgLeaseHistory: vi.fn().mockResolvedValue([]),
      };
      setDynamoDBService(mockDynamoDBService);

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      // Should still succeed with pessimistic fallback
      expect(result.statusCode).toBe(200);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to query user history - using pessimistic fallback',
        expect.objectContaining({
          error: 'DynamoDB unavailable',
          userEmail: 'user@example.gov.uk',
        })
      );
    });

    it('should pass user history to state machine context', async () => {
      const mockHistory = [
        {
          uuid: 'lease-1',
          userEmail: 'user@example.gov.uk',
          status: 'Active' as const,
          originalLeaseTemplateUuid: 'web-hosting',
          created: new Date().toISOString(),
        },
      ];
      const mockDynamoDBService: DynamoDBService = {
        getUserLeaseHistory: vi.fn().mockResolvedValue(mockHistory),
        getOrgLeaseHistory: vi.fn().mockResolvedValue([]),
      };
      setDynamoDBService(mockDynamoDBService);

      // Create mock orchestrator to verify context passed
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
            userLeaseHistory: mockHistory,
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();
      await handler(event, mockContext);

      // Verify orchestrator was called with history in context
      expect(mockOrchestrator.run).toHaveBeenCalledWith(
        ApprovalState.RECEIVED,
        expect.objectContaining({
          userLeaseHistory: mockHistory,
        })
      );
    });
  });

  describe('DynamoDB org history integration (Story 3.2)', () => {
    it('should query org history when DynamoDB service is configured', async () => {
      const mockOrgHistory = [
        {
          uuid: 'org-lease-1',
          userEmail: 'colleague@example.gov.uk',
          status: 'Active' as const,
          originalLeaseTemplateUuid: 'template-1',
          created: new Date().toISOString(),
        },
      ];
      const mockDynamoDBService: DynamoDBService = {
        getUserLeaseHistory: vi.fn().mockResolvedValue([]),
        getOrgLeaseHistory: vi.fn().mockResolvedValue(mockOrgHistory),
      };
      setDynamoDBService(mockDynamoDBService);

      const event = createValidLeaseRequestedEvent();
      await handler(event, mockContext);

      // Org history query should use domain and exclude current user
      expect(mockDynamoDBService.getOrgLeaseHistory).toHaveBeenCalledWith(
        'example.gov.uk',
        'user@example.gov.uk'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Org history retrieved',
        expect.objectContaining({
          domain: 'example.gov.uk',
          leaseCount: 1,
        })
      );
    });

    it('should use pessimistic fallback on org query error (AC6)', async () => {
      const mockDynamoDBService: DynamoDBService = {
        getUserLeaseHistory: vi.fn().mockResolvedValue([]),
        getOrgLeaseHistory: vi.fn().mockRejectedValue(new Error('DynamoDB scan failed')),
      };
      setDynamoDBService(mockDynamoDBService);

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      // Should still succeed with pessimistic fallback
      expect(result.statusCode).toBe(200);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to query org history - using pessimistic fallback',
        expect.objectContaining({
          error: 'DynamoDB scan failed',
          userEmail: 'user@example.gov.uk',
        })
      );
    });

    it('should pass org history to state machine context', async () => {
      const mockOrgHistory = [
        {
          uuid: 'org-lease-1',
          userEmail: 'colleague@example.gov.uk',
          status: 'BudgetExceeded' as const,
          originalLeaseTemplateUuid: 'template-1',
          created: new Date().toISOString(),
        },
      ];
      const mockDynamoDBService: DynamoDBService = {
        getUserLeaseHistory: vi.fn().mockResolvedValue([]),
        getOrgLeaseHistory: vi.fn().mockResolvedValue(mockOrgHistory),
      };
      setDynamoDBService(mockDynamoDBService);

      // Create mock orchestrator to verify context passed
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
            orgLeaseHistory: mockOrgHistory,
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();
      await handler(event, mockContext);

      // Verify orchestrator was called with org history in context
      expect(mockOrchestrator.run).toHaveBeenCalledWith(
        ApprovalState.RECEIVED,
        expect.objectContaining({
          orgLeaseHistory: mockOrgHistory,
        })
      );
    });

    it('should include domain in structured logs (AC5)', async () => {
      const mockDynamoDBService: DynamoDBService = {
        getUserLeaseHistory: vi.fn().mockResolvedValue([]),
        getOrgLeaseHistory: vi.fn().mockResolvedValue([]),
      };
      setDynamoDBService(mockDynamoDBService);

      const event = createValidLeaseRequestedEvent();
      await handler(event, mockContext);

      // Verify domain was added to logger context
      expect(mockLogger.appendKeys).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'example.gov.uk',
        })
      );
    });
  });
});
