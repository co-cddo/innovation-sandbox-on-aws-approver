import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handler,
  setEventBridgeService,
  resetEventBridgeService,
  setIsbLambdaService,
  resetIsbLambdaService,
  setDynamoDBService,
  resetDynamoDBService,
  setDomainAllowlistService,
  resetDomainAllowlistService,
  setBedrockService,
  resetBedrockService,
  setOrchestrator,
  resetOrchestrator,
  setSQSService,
  resetSQSService,
  setBankHolidayService,
  resetBankHolidayService,
  setSlackService,
  resetSlackService,
} from '../src/handler.js';
import type { DynamoDBService } from '../src/services/dynamodb.js';
import type { DomainAllowlistService } from '../src/services/domain-allowlist.js';
import type { BedrockService } from '../src/services/bedrock.js';
import type { SQSService } from '../src/services/sqs.js';
import type { SlackService } from '../src/services/slack.js';
import type { EventBridgeEvent, Context } from 'aws-lambda';
import type { EventBridgeService } from '../src/services/eventbridge.js';
import type { IsbLambdaService } from '../src/services/isb-lambda.js';
import type { StateMachineOrchestrator } from '../src/state-machine/index.js';
import { ApprovalState, createInitialContext } from '../src/state-machine/index.js';
import { createMockBankHolidayService } from '../src/services/bank-holidays.js';

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

// Use vi.hoisted() for queue-position mocks (Vitest v4 compatible)
const { mockAddToQueue, mockGetQueueEstimate, mockRemoveFromQueue, mockGetLastCapacityCrunchAlertTime, mockUpdateLastCapacityCrunchAlertTime, mockGetOldestPending } = vi.hoisted(() => ({
  mockAddToQueue: vi.fn(),
  mockGetQueueEstimate: vi.fn(),
  mockRemoveFromQueue: vi.fn(),
  mockGetLastCapacityCrunchAlertTime: vi.fn(),
  mockUpdateLastCapacityCrunchAlertTime: vi.fn(),
  mockGetOldestPending: vi.fn(),
}));

// Use vi.hoisted() for secrets mock (Vitest v4 compatible)
const { mockGetSlackWebhookUrl } = vi.hoisted(() => ({
  mockGetSlackWebhookUrl: vi.fn(),
}));

// Mock secrets module to control getSlackWebhookUrl behavior
vi.mock('../src/lib/secrets.js', () => ({
  getSlackWebhookUrl: mockGetSlackWebhookUrl,
}));

// Mock queue-position module to control queue position behavior in tests
vi.mock('../src/services/queue-position.js', async () => {
  const actual = await vi.importActual('../src/services/queue-position.js');
  return {
    ...actual,
    addToQueue: mockAddToQueue,
    getQueueEstimate: mockGetQueueEstimate,
    removeFromQueue: mockRemoveFromQueue,
    getLastCapacityCrunchAlertTime: mockGetLastCapacityCrunchAlertTime,
    updateLastCapacityCrunchAlertTime: mockUpdateLastCapacityCrunchAlertTime,
    getOldestPending: mockGetOldestPending,
  };
});

// Mock the EventBridge client to prevent real AWS calls (Vitest v4 compatible)
vi.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: class MockEventBridgeClient {
    send = vi.fn().mockResolvedValue({});
  },
  PutEventsCommand: class MockPutEventsCommand {},
}));

// Mock the Lambda client to prevent real AWS calls (Vitest v4 compatible)
vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: class MockLambdaClient {
    send = vi.fn().mockResolvedValue({});
  },
  InvokeCommand: class MockInvokeCommand {},
}));

// Mock the DynamoDB client to prevent real AWS calls (Vitest v4 compatible)
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class MockDynamoDBClient {
    send = vi.fn().mockResolvedValue({ Count: 0, Items: [] });
  },
  QueryCommand: class MockQueryCommand {},
  GetItemCommand: class MockGetItemCommand {},
  PutItemCommand: class MockPutItemCommand {},
  DeleteItemCommand: class MockDeleteItemCommand {},
  UpdateItemCommand: class MockUpdateItemCommand {},
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn().mockReturnValue({}),
  },
  QueryCommand: class MockQueryCommand {},
}));

vi.mock('@aws-sdk/util-dynamodb', () => ({
  marshall: vi.fn((obj) => obj),
  unmarshall: vi.fn((obj) => obj),
}));

// Mock the S3 client to prevent real AWS calls (Vitest v4 compatible)
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class MockS3Client {
    send = vi.fn().mockResolvedValue({});
  },
  GetObjectCommand: class MockGetObjectCommand {},
}));

// Mock the Bedrock client to prevent real AWS calls (Vitest v4 compatible)
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: class MockBedrockRuntimeClient {
    send = vi.fn().mockResolvedValue({});
  },
  InvokeModelCommand: class MockInvokeModelCommand {},
}));

// Mock the SQS client to prevent real AWS calls (Vitest v4 compatible)
vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: class MockSQSClient {
    send = vi.fn().mockResolvedValue({});
  },
  SendMessageCommand: class MockSendMessageCommand {},
}));

// Import the mocked logger for assertions
import { logger as mockLogger } from '../src/lib/logger.js';

// Mock EventBridge service for testing (used for escalation and denial events)
// Note: emitLeaseApproved is no longer used - approvals go via ISB Lambda directly
const mockEmitLeaseEscalated = vi.fn().mockResolvedValue(undefined);
const mockEmitLeaseDenied = vi.fn().mockResolvedValue(undefined);
const mockEventBridgeService: EventBridgeService = {
  emitLeaseApproved: vi.fn().mockResolvedValue(undefined), // Kept for interface compliance
  emitLeaseEscalated: mockEmitLeaseEscalated,
  emitLeaseDenied: mockEmitLeaseDenied, // Added for Story 4.4 queue expiry
};

// Mock ISB Lambda service for testing (used for actual approvals)
const mockApproveLease = vi.fn().mockResolvedValue({ success: true, statusCode: 200 });
const mockDenyLease = vi.fn().mockResolvedValue({ success: true, statusCode: 200 });
// Default mock returns a ready account (created > 60 min ago, last edited > 24hr ago)
const mockReadyAccount = {
  awsAccountId: '123456789012',
  name: 'pool-001',
  status: 'Available' as const,
  meta: {
    createdTime: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), // 48hr ago
    lastEditTime: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25hr ago (past cooldown)
  },
};
const mockGetAccounts = vi.fn().mockResolvedValue({
  success: true,
  accounts: [mockReadyAccount],
  totalFetched: 1,
  pagesTraversed: 1,
});
const mockGetLease = vi.fn().mockResolvedValue({
  success: true,
  templateName: 'Test Template',
});
const mockIsbLambdaService: IsbLambdaService = {
  approveLease: mockApproveLease,
  denyLease: mockDenyLease,
  getAccounts: mockGetAccounts,
  getLease: mockGetLease,
};

// Mock SQS service for testing (used for delay queue operations)
const mockSendDelayedRequest = vi.fn().mockResolvedValue({ success: true, messageId: 'test-message-id' });
const mockReceiveMessages = vi.fn().mockResolvedValue({ success: true, messages: [] });
const mockDeleteMessage = vi.fn().mockResolvedValue({ success: true });
const mockGetQueueDepth = vi.fn().mockResolvedValue({ success: true, approximateNumberOfMessages: 0 });
const mockSQSService: SQSService = {
  sendDelayedRequest: mockSendDelayedRequest,
  receiveMessages: mockReceiveMessages,
  deleteMessage: mockDeleteMessage,
  getQueueDepth: mockGetQueueDepth,
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
    // Mock time to be within business hours (Tuesday 10am UK time)
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-07T10:00:00Z')); // Tuesday 10am UTC = 10am UK (winter)
    // Inject mock services for testing
    setEventBridgeService(mockEventBridgeService);
    setIsbLambdaService(mockIsbLambdaService);
    setSQSService(mockSQSService);
    // Use mock bank holiday service to ensure consistent business hours (always within)
    setBankHolidayService(createMockBankHolidayService([]));
    // Default domain allowlist includes test domains as verified
    setDomainAllowlistService({
      getLocalAuthorityDomains: vi.fn().mockResolvedValue({
        domains: ['example.gov.uk', 'council.gov.uk'],
        usedStaleCache: false,
      }),
      clearCache: vi.fn(),
    });
    // Default queue-position mock behavior - success with position info
    mockAddToQueue.mockResolvedValue({
      success: true,
      position: 1,
    });
    mockGetQueueEstimate.mockResolvedValue({
      position: 1,
      estimatedFulfillmentTime: new Date('2025-12-31T12:00:00Z'),
      isCapacityCrunch: false,
      message: 'Your request is next in queue',
      queueDepth: 1,
    });
    mockRemoveFromQueue.mockResolvedValue({
      success: true,
    });
    mockGetLastCapacityCrunchAlertTime.mockResolvedValue({
      success: true,
      lastAlertTime: null, // No previous alert
    });
    mockUpdateLastCapacityCrunchAlertTime.mockResolvedValue({
      success: true,
    });
    mockGetOldestPending.mockResolvedValue({
      success: true,
      // No record by default
    });
    // Default getSlackWebhookUrl mock behavior - success with webhook URL
    mockGetSlackWebhookUrl.mockResolvedValue({
      success: true,
      webhookUrl: 'https://hooks.slack.com/test',
    });
  });

  afterEach(() => {
    // Restore real timers
    vi.useRealTimers();
    // Reset to avoid affecting other tests
    resetEventBridgeService();
    resetIsbLambdaService();
    resetDynamoDBService();
    resetDomainAllowlistService();
    resetBedrockService();
    resetOrchestrator();
    resetSQSService();
    resetBankHolidayService();
    resetSlackService();
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

    it('should re-queue request on TOCTOU race condition (account unavailable)', async () => {
      const event = createValidLeaseRequestedEvent();
      // ISB rejects with account unavailability message
      mockApproveLease.mockResolvedValueOnce({
        success: false,
        statusCode: 409,
        error: 'no available account',
      });

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(202);
      expect(result.body).toBe('Request re-queued due to account unavailability');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'TOCTOU race condition detected - re-queuing request',
        expect.objectContaining({
          leaseId: '123e4567-e89b-12d3-a456-426614174000',
          error: 'no available account',
        })
      );
      // Should NOT escalate
      expect(mockEmitLeaseEscalated).not.toHaveBeenCalled();
    });
  });

  describe('non-LeaseRequested events', () => {
    it('should ignore unrecognized event types', async () => {
      const event = createMockEvent('ScheduledProcessing', {});

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('Ignored - unrecognized event type');
    });
  });

  describe('scheduled queue check and delay queue processing (Story 4.2)', () => {
    const createScheduledEvent = (): EventBridgeEvent<string, unknown> => ({
      version: '0',
      id: 'scheduled-event-id',
      'detail-type': 'ScheduledQueueCheck',
      source: 'scheduled.queue-check',
      account: '123456789012',
      time: '2024-01-01T10:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {},
    });

    const createMockSQSService = (overrides?: Partial<SQSService>): SQSService => ({
      sendDelayedRequest: vi.fn().mockResolvedValue({ success: true, messageId: 'msg-123' }),
      receiveMessages: vi.fn().mockResolvedValue({ success: true, messages: [] }),
      deleteMessage: vi.fn().mockResolvedValue({ success: true }),
      getQueueDepth: vi.fn().mockResolvedValue({ success: true, approximateNumberOfMessages: 0 }),
      ...overrides,
    });

    it('should handle scheduled queue check event (AC1)', async () => {
      const event = createScheduledEvent();

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Scheduled queue check triggered',
        expect.objectContaining({
          source: 'scheduled.queue-check',
        })
      );
    });

    it('should skip queue processing when outside business hours (AC3)', async () => {
      // Mark today as a bank holiday to simulate outside business hours
      // Bank holidays are considered non-business days regardless of time
      const mockDynamoDBService: DynamoDBService = {
        getUserLeaseHistory: vi.fn().mockResolvedValue([]),
        getOrgLeaseHistory: vi.fn().mockResolvedValue([]),
        getAvailableAccountsCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
        updateLeaseComments: vi.fn().mockResolvedValue({ success: true }),
      };
      setDynamoDBService(mockDynamoDBService);

      // Use a bank holiday service that returns today as a bank holiday
      const today = new Date().toISOString().split('T')[0]!;
      const mockBankHolidayService = createMockBankHolidayService([today]);
      setBankHolidayService(mockBankHolidayService);

      const event = createScheduledEvent();
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('Outside business hours - queue processing skipped');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Outside business hours - skipping queue processing',
        expect.objectContaining({
          triggerType: 'scheduled',
        })
      );
    });

    it('should skip queue processing when no accounts available (AC3)', async () => {
      const mockDynamoDBService: DynamoDBService = {
        getUserLeaseHistory: vi.fn().mockResolvedValue([]),
        getOrgLeaseHistory: vi.fn().mockResolvedValue([]),
        getAvailableAccountsCount: vi.fn().mockResolvedValue({ success: true, count: 0 }),
        updateLeaseComments: vi.fn().mockResolvedValue({ success: true }),
      };
      setDynamoDBService(mockDynamoDBService);

      // Mock ISB Lambda to return all active accounts (no available accounts)
      const mockActiveAccount = {
        awsAccountId: '123456789012',
        name: 'pool-001',
        status: 'Active' as const, // All accounts active = no ready accounts
        meta: {
          createdTime: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
          lastEditTime: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        },
      };
      setIsbLambdaService({
        approveLease: vi.fn().mockResolvedValue({ success: true, statusCode: 200 }),
        denyLease: vi.fn().mockResolvedValue({ success: true, statusCode: 200 }),
        getAccounts: vi.fn().mockResolvedValue({
          success: true,
          accounts: [mockActiveAccount],
          totalFetched: 1,
          pagesTraversed: 1,
        }),
        getLease: vi.fn().mockResolvedValue({ success: true }),
      });

      const mockSQSService = createMockSQSService();
      setSQSService(mockSQSService);

      const event = createScheduledEvent();
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('No ready accounts available - queue processing skipped');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'No ready accounts available - skipping queue processing',
        expect.objectContaining({
          triggerType: 'scheduled',
        })
      );
    });

    it('should log queue depth before and after processing (AC4)', async () => {
      const mockDynamoDBService: DynamoDBService = {
        getUserLeaseHistory: vi.fn().mockResolvedValue([]),
        getOrgLeaseHistory: vi.fn().mockResolvedValue([]),
        getAvailableAccountsCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
        updateLeaseComments: vi.fn().mockResolvedValue({ success: true }),
      };
      setDynamoDBService(mockDynamoDBService);

      const mockSQSService = createMockSQSService({
        getQueueDepth: vi.fn().mockResolvedValue({ success: true, approximateNumberOfMessages: 3 }),
        receiveMessages: vi.fn().mockResolvedValue({ success: true, messages: [] }),
      });
      setSQSService(mockSQSService);

      const event = createScheduledEvent();
      await handler(event, mockContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Queue depth before processing',
        expect.objectContaining({
          approximateNumberOfMessages: 3,
          triggerType: 'scheduled',
        })
      );
    });

    it('should receive messages with 5-minute visibility timeout (AC5)', async () => {
      const mockDynamoDBService: DynamoDBService = {
        getUserLeaseHistory: vi.fn().mockResolvedValue([]),
        getOrgLeaseHistory: vi.fn().mockResolvedValue([]),
        getAvailableAccountsCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
        updateLeaseComments: vi.fn().mockResolvedValue({ success: true }),
      };
      setDynamoDBService(mockDynamoDBService);

      const mockReceiveMessages = vi.fn().mockResolvedValue({ success: true, messages: [] });
      const mockSQSService = createMockSQSService({
        receiveMessages: mockReceiveMessages,
      });
      setSQSService(mockSQSService);

      const event = createScheduledEvent();
      await handler(event, mockContext);

      // Verify receiveMessages was called with 5-minute (300 second) visibility timeout
      expect(mockReceiveMessages).toHaveBeenCalledWith(1, 300);
    });

    it('should return no messages when queue is empty', async () => {
      const mockDynamoDBService: DynamoDBService = {
        getUserLeaseHistory: vi.fn().mockResolvedValue([]),
        getOrgLeaseHistory: vi.fn().mockResolvedValue([]),
        getAvailableAccountsCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
        updateLeaseComments: vi.fn().mockResolvedValue({ success: true }),
      };
      setDynamoDBService(mockDynamoDBService);

      const mockSQSService = createMockSQSService({
        receiveMessages: vi.fn().mockResolvedValue({ success: true, messages: [] }),
      });
      setSQSService(mockSQSService);

      const event = createScheduledEvent();
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('No messages in queue');
    });

    it('should fall back to SQS order when getOldestPending fails (line 1104)', async () => {
      const mockDynamoDBService: DynamoDBService = {
        getUserLeaseHistory: vi.fn().mockResolvedValue([]),
        getOrgLeaseHistory: vi.fn().mockResolvedValue([]),
        getAvailableAccountsCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
        updateLeaseComments: vi.fn().mockResolvedValue({ success: true }),
      };
      setDynamoDBService(mockDynamoDBService);

      // Make getOldestPending throw an error
      mockGetOldestPending.mockRejectedValueOnce(new Error('DynamoDB unavailable'));

      const mockSQSService = createMockSQSService({
        receiveMessages: vi.fn().mockResolvedValue({ success: true, messages: [] }),
      });
      setSQSService(mockSQSService);

      const event = createScheduledEvent();
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('No messages in queue');
      // Should warn about falling back to SQS order
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to get oldest pending from queue position table - falling back to SQS order',
        expect.objectContaining({
          error: 'DynamoDB unavailable',
          triggerType: 'scheduled',
        })
      );
    });

    it('should clean up stale DynamoDB entries when SQS is empty (lines 1137-1140)', async () => {
      const mockDynamoDBService: DynamoDBService = {
        getUserLeaseHistory: vi.fn().mockResolvedValue([]),
        getOrgLeaseHistory: vi.fn().mockResolvedValue([]),
        getAvailableAccountsCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
        updateLeaseComments: vi.fn().mockResolvedValue({ success: true }),
      };
      setDynamoDBService(mockDynamoDBService);

      // Mock DynamoDB having a stale entry but SQS is empty
      const staleLeaseId = {
        userEmail: 'stale@example.gov.uk',
        uuid: '33333333-3333-3333-3333-333333333333',
      };
      mockGetOldestPending.mockResolvedValueOnce({
        success: true,
        record: {
          leaseId: 'stale@example.gov.uk#33333333-3333-3333-3333-333333333333',
          position: 1,
          positionStatus: 'PENDING',
          queuedAt: '2025-12-30T10:00:00Z',
        },
      });

      const mockSQSService = createMockSQSService({
        receiveMessages: vi.fn().mockResolvedValue({ success: true, messages: [] }),
      });
      setSQSService(mockSQSService);

      const event = createScheduledEvent();
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('No messages in queue');
      // Should warn about cleaning up stale entries
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'DynamoDB queue has entries but SQS is empty - cleaning up',
        expect.objectContaining({
          leaseId: staleLeaseId.uuid,
        })
      );
      // Should remove the stale entry
      expect(mockRemoveFromQueue).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        staleLeaseId
      );
    });

    it('should process delayed message and delete on success (AC5)', async () => {
      const mockDynamoDBService: DynamoDBService = {
        getUserLeaseHistory: vi.fn().mockResolvedValue([]),
        getOrgLeaseHistory: vi.fn().mockResolvedValue([]),
        getAvailableAccountsCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
        updateLeaseComments: vi.fn().mockResolvedValue({ success: true }),
      };
      setDynamoDBService(mockDynamoDBService);

      // Use a valid UUID for the delayed lease
      const delayedLeaseUuid = '11111111-1111-1111-1111-111111111111';

      // Use mock orchestrator to ensure the nested LeaseRequested event is approved
      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.APPROVED,
          success: true,
          context: {
            ...createInitialContext(),
            leaseId: delayedLeaseUuid,
            userEmail: 'delayed@example.gov.uk',
            templateId: 'web-hosting',
            score: 0,
            decision: 'approved',
            approvedBy: 'ndx+try-automated-approver@dsit.gov.uk',
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      // Create a delayed message with a valid LeaseRequested event
      // Use recent dates within 5 business days to avoid queue expiry (Story 4.4)
      const recentDate = new Date();
      recentDate.setHours(recentDate.getHours() - 2); // 2 hours ago
      const recentDateISO = recentDate.toISOString();
      const processAfterDate = new Date(recentDate);
      processAfterDate.setHours(processAfterDate.getHours() + 1);
      const processAfterISO = processAfterDate.toISOString();

      const originalEvent = {
        version: '0',
        id: 'original-event-id',
        'detail-type': 'LeaseRequested',
        source: 'innovation-sandbox',
        account: '123456789012',
        time: recentDateISO,
        region: 'us-east-1',
        resources: [],
        detail: {
          leaseId: {
            userEmail: 'delayed@example.gov.uk',
            uuid: delayedLeaseUuid,
          },
          templateId: 'web-hosting',
          budgetAmount: 50,
          leaseDurationHours: 48,
          requiresManualApproval: false,
        },
      };

      const mockDeleteMessage = vi.fn().mockResolvedValue({ success: true });
      const mockSQSService = createMockSQSService({
        receiveMessages: vi.fn().mockResolvedValue({
          success: true,
          messages: [
            {
              messageId: 'msg-delayed-1',
              receiptHandle: 'receipt-handle-123',
              body: {
                leaseId: { userEmail: 'delayed@example.gov.uk', uuid: delayedLeaseUuid },
                originalEvent,
                receivedAt: recentDateISO,
                processAfter: processAfterISO,
                reason: 'Outside business hours',
              },
              sentTimestamp: recentDate.getTime(),
            },
          ],
        }),
        deleteMessage: mockDeleteMessage,
        getQueueDepth: vi.fn()
          .mockResolvedValueOnce({ success: true, approximateNumberOfMessages: 1 })
          .mockResolvedValueOnce({ success: true, approximateNumberOfMessages: 0 }),
      });
      setSQSService(mockSQSService);

      const event = createScheduledEvent();
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('Processed 1 message from queue');
      expect(mockDeleteMessage).toHaveBeenCalledWith('receipt-handle-123');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Delayed message processed and deleted',
        expect.objectContaining({
          leaseId: delayedLeaseUuid,
          userEmail: 'delayed@example.gov.uk',
        })
      );
    });

    it('should continue when removeFromQueue fails after processing (line 1185)', async () => {
      const mockDynamoDBService: DynamoDBService = {
        getUserLeaseHistory: vi.fn().mockResolvedValue([]),
        getOrgLeaseHistory: vi.fn().mockResolvedValue([]),
        getAvailableAccountsCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
        updateLeaseComments: vi.fn().mockResolvedValue({ success: true }),
      };
      setDynamoDBService(mockDynamoDBService);

      const delayedLeaseUuid = '22222222-2222-2222-2222-222222222222';

      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.APPROVED,
          success: true,
          context: {
            ...createInitialContext(),
            leaseId: delayedLeaseUuid,
            userEmail: 'delayed2@example.gov.uk',
            templateId: 'web-hosting',
            score: 0,
            decision: 'approved',
            approvedBy: 'ndx+try-automated-approver@dsit.gov.uk',
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      // Make removeFromQueue throw an error
      mockRemoveFromQueue.mockRejectedValueOnce(new Error('DynamoDB queue cleanup failed'));

      const recentDate = new Date();
      recentDate.setHours(recentDate.getHours() - 2);
      const recentDateISO = recentDate.toISOString();
      const processAfterDate = new Date(recentDate);
      processAfterDate.setHours(processAfterDate.getHours() + 1);
      const processAfterISO = processAfterDate.toISOString();

      const originalEvent = {
        version: '0',
        id: 'original-event-id-2',
        'detail-type': 'LeaseRequested',
        source: 'innovation-sandbox',
        account: '123456789012',
        time: recentDateISO,
        region: 'us-east-1',
        resources: [],
        detail: {
          leaseId: { userEmail: 'delayed2@example.gov.uk', uuid: delayedLeaseUuid },
          templateId: 'web-hosting',
          budgetAmount: 50,
          leaseDurationHours: 48,
          requiresManualApproval: false,
        },
      };

      const mockDeleteMessage = vi.fn().mockResolvedValue({ success: true });
      const mockSQSService = createMockSQSService({
        receiveMessages: vi.fn().mockResolvedValue({
          success: true,
          messages: [
            {
              messageId: 'msg-delayed-2',
              receiptHandle: 'receipt-handle-456',
              body: {
                leaseId: { userEmail: 'delayed2@example.gov.uk', uuid: delayedLeaseUuid },
                originalEvent,
                receivedAt: recentDateISO,
                processAfter: processAfterISO,
                reason: 'Outside business hours',
              },
              sentTimestamp: recentDate.getTime(),
            },
          ],
        }),
        deleteMessage: mockDeleteMessage,
        getQueueDepth: vi.fn()
          .mockResolvedValueOnce({ success: true, approximateNumberOfMessages: 1 })
          .mockResolvedValueOnce({ success: true, approximateNumberOfMessages: 0 }),
      });
      setSQSService(mockSQSService);

      const event = createScheduledEvent();
      const result = await handler(event, mockContext);

      // Should still succeed even though removeFromQueue failed
      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('Processed 1 message from queue');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to remove from queue position table',
        expect.objectContaining({
          error: 'DynamoDB queue cleanup failed',
        })
      );
      // Message should still be deleted from SQS
      expect(mockDeleteMessage).toHaveBeenCalledWith('receipt-handle-456');
    });

    it('should handle SQS delete failure after successful processing (lines 928-934)', async () => {
      const mockDynamoDBService: DynamoDBService = {
        getUserLeaseHistory: vi.fn().mockResolvedValue([]),
        getOrgLeaseHistory: vi.fn().mockResolvedValue([]),
        getAvailableAccountsCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
        updateLeaseComments: vi.fn().mockResolvedValue({ success: true }),
      };
      setDynamoDBService(mockDynamoDBService);

      const delayedLeaseUuid = '66666666-6666-6666-6666-666666666666';
      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.APPROVED,
          success: true,
          context: {
            ...createInitialContext(),
            leaseId: delayedLeaseUuid,
            userEmail: 'delete-fail-delayed@example.gov.uk',
            templateId: 'web-hosting',
            score: 0,
            decision: 'approved',
            approvedBy: 'ndx+try-automated-approver@dsit.gov.uk',
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const recentDate = new Date();
      recentDate.setHours(recentDate.getHours() - 2);
      const recentDateISO = recentDate.toISOString();
      const processAfterDate = new Date(recentDate);
      processAfterDate.setHours(processAfterDate.getHours() + 1);
      const processAfterISO = processAfterDate.toISOString();

      const originalEvent = {
        version: '0',
        id: 'original-event-id-delete-fail',
        'detail-type': 'LeaseRequested',
        source: 'innovation-sandbox',
        account: '123456789012',
        time: recentDateISO,
        region: 'us-east-1',
        resources: [],
        detail: {
          leaseId: { userEmail: 'delete-fail-delayed@example.gov.uk', uuid: delayedLeaseUuid },
          templateId: 'web-hosting',
          budgetAmount: 50,
          leaseDurationHours: 48,
          requiresManualApproval: false,
        },
      };

      // deleteMessage returns failure
      const mockDeleteMessage = vi.fn().mockResolvedValue({ success: false, error: 'SQS delete failed' });
      const mockSQSService = createMockSQSService({
        receiveMessages: vi.fn().mockResolvedValue({
          success: true,
          messages: [
            {
              messageId: 'msg-delete-fail-delayed',
              receiptHandle: 'receipt-handle-delete-fail',
              body: {
                leaseId: { userEmail: 'delete-fail-delayed@example.gov.uk', uuid: delayedLeaseUuid },
                originalEvent,
                receivedAt: recentDateISO,
                processAfter: processAfterISO,
                reason: 'Outside business hours',
              },
              sentTimestamp: recentDate.getTime(),
            },
          ],
        }),
        deleteMessage: mockDeleteMessage,
        getQueueDepth: vi.fn().mockResolvedValue({ success: true, approximateNumberOfMessages: 1 }),
      });
      setSQSService(mockSQSService);

      const event = createScheduledEvent();
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('Message processing failed - will retry');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to delete processed message',
        expect.objectContaining({
          error: 'SQS delete failed',
          leaseId: delayedLeaseUuid,
        })
      );
    });

    it('should handle exception during delayed message processing (lines 952-957)', async () => {
      const mockDynamoDBService: DynamoDBService = {
        getUserLeaseHistory: vi.fn().mockResolvedValue([]),
        getOrgLeaseHistory: vi.fn().mockResolvedValue([]),
        getAvailableAccountsCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
        updateLeaseComments: vi.fn().mockResolvedValue({ success: true }),
      };
      setDynamoDBService(mockDynamoDBService);

      // Make orchestrator throw an exception
      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockImplementation(() => {
          throw new Error('Unexpected orchestrator error');
        }),
      };
      setOrchestrator(mockOrchestrator);

      const delayedLeaseUuid = '77777777-7777-7777-7777-777777777777';
      const recentDate = new Date();
      recentDate.setHours(recentDate.getHours() - 2);
      const recentDateISO = recentDate.toISOString();
      const processAfterDate = new Date(recentDate);
      processAfterDate.setHours(processAfterDate.getHours() + 1);
      const processAfterISO = processAfterDate.toISOString();

      const originalEvent = {
        version: '0',
        id: 'original-event-id-exception',
        'detail-type': 'LeaseRequested',
        source: 'innovation-sandbox',
        account: '123456789012',
        time: recentDateISO,
        region: 'us-east-1',
        resources: [],
        detail: {
          leaseId: { userEmail: 'exception@example.gov.uk', uuid: delayedLeaseUuid },
          templateId: 'web-hosting',
          budgetAmount: 50,
          leaseDurationHours: 48,
          requiresManualApproval: false,
        },
      };

      const mockDeleteMessage = vi.fn().mockResolvedValue({ success: true });
      const mockSQSService = createMockSQSService({
        receiveMessages: vi.fn().mockResolvedValue({
          success: true,
          messages: [
            {
              messageId: 'msg-exception',
              receiptHandle: 'receipt-handle-exception',
              body: {
                leaseId: { userEmail: 'exception@example.gov.uk', uuid: delayedLeaseUuid },
                originalEvent,
                receivedAt: recentDateISO,
                processAfter: processAfterISO,
                reason: 'Outside business hours',
              },
              sentTimestamp: recentDate.getTime(),
            },
          ],
        }),
        deleteMessage: mockDeleteMessage,
        getQueueDepth: vi.fn().mockResolvedValue({ success: true, approximateNumberOfMessages: 1 }),
      });
      setSQSService(mockSQSService);

      const event = createScheduledEvent();
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('Message processing failed - will retry');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error processing delayed message',
        expect.objectContaining({
          error: 'Unexpected orchestrator error',
          leaseId: delayedLeaseUuid,
        })
      );
      // Message should NOT be deleted
      expect(mockDeleteMessage).not.toHaveBeenCalled();
    });

    it('should not delete message when processing fails (AC5)', async () => {
      const mockDynamoDBService: DynamoDBService = {
        getUserLeaseHistory: vi.fn().mockResolvedValue([]),
        getOrgLeaseHistory: vi.fn().mockResolvedValue([]),
        getAvailableAccountsCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
        updateLeaseComments: vi.fn().mockResolvedValue({ success: true }),
      };
      setDynamoDBService(mockDynamoDBService);

      // Create a delayed message with an INVALID event (will fail validation)
      // Use recent dates within 5 business days to avoid queue expiry (Story 4.4)
      const recentDate = new Date();
      recentDate.setHours(recentDate.getHours() - 2); // 2 hours ago
      const recentDateISO = recentDate.toISOString();
      const processAfterDate = new Date(recentDate);
      processAfterDate.setHours(processAfterDate.getHours() + 1);
      const processAfterISO = processAfterDate.toISOString();

      const invalidOriginalEvent = {
        version: '0',
        id: 'original-event-id',
        'detail-type': 'LeaseRequested',
        source: 'innovation-sandbox',
        account: '123456789012',
        time: recentDateISO,
        region: 'us-east-1',
        resources: [],
        detail: {
          leaseId: 'invalid-format', // Invalid - should be object
          templateId: 'web-hosting',
        },
      };

      const mockDeleteMessage = vi.fn().mockResolvedValue({ success: true });
      const mockSQSService = createMockSQSService({
        receiveMessages: vi.fn().mockResolvedValue({
          success: true,
          messages: [
            {
              messageId: 'msg-invalid-1',
              receiptHandle: 'receipt-handle-invalid',
              body: {
                leaseId: { userEmail: 'invalid@example.gov.uk', uuid: 'invalid-lease-uuid' },
                originalEvent: invalidOriginalEvent,
                receivedAt: recentDateISO,
                processAfter: processAfterISO,
                reason: 'Outside business hours',
              },
              sentTimestamp: recentDate.getTime(),
            },
          ],
        }),
        deleteMessage: mockDeleteMessage,
      });
      setSQSService(mockSQSService);

      const event = createScheduledEvent();
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('Message processing failed - will retry');
      // Message should NOT be deleted since processing failed
      expect(mockDeleteMessage).not.toHaveBeenCalled();
    });

    it('should expire message after 5+ business days in queue (Story 4.4)', async () => {
      const mockDynamoDBService: DynamoDBService = {
        getUserLeaseHistory: vi.fn().mockResolvedValue([]),
        getOrgLeaseHistory: vi.fn().mockResolvedValue([]),
        getAvailableAccountsCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
        updateLeaseComments: vi.fn().mockResolvedValue({ success: true }),
      };
      setDynamoDBService(mockDynamoDBService);

      // Mock EventBridge service for emitLeaseDenied
      setEventBridgeService({
        emitLeaseApproved: vi.fn().mockResolvedValue(undefined),
        emitLeaseEscalated: vi.fn().mockResolvedValue(undefined),
        emitLeaseDenied: vi.fn().mockResolvedValue(undefined),
      });

      // Create a message that was queued 10+ days ago (definitely > 5 business days)
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 15); // 15 days ago
      const oldDateISO = oldDate.toISOString();

      const expiredLeaseUuid = '22222222-2222-2222-2222-222222222222';
      const originalEvent = {
        version: '0',
        id: 'original-event-id',
        'detail-type': 'LeaseRequested',
        source: 'innovation-sandbox',
        account: '123456789012',
        time: oldDateISO,
        region: 'us-east-1',
        resources: [],
        detail: {
          leaseId: {
            userEmail: 'expired@example.gov.uk',
            uuid: expiredLeaseUuid,
          },
          templateId: 'web-hosting',
          budgetAmount: 50,
          leaseDurationHours: 48,
          requiresManualApproval: false,
        },
      };

      const mockDeleteMessage = vi.fn().mockResolvedValue({ success: true });
      const mockSQSService = createMockSQSService({
        receiveMessages: vi.fn().mockResolvedValue({
          success: true,
          messages: [
            {
              messageId: 'msg-expired-1',
              receiptHandle: 'receipt-handle-expired',
              body: {
                leaseId: { userEmail: 'expired@example.gov.uk', uuid: expiredLeaseUuid },
                originalEvent,
                receivedAt: oldDateISO,
                processAfter: oldDateISO,
                reason: 'Outside business hours',
              },
              sentTimestamp: oldDate.getTime(),
            },
          ],
        }),
        deleteMessage: mockDeleteMessage,
        getQueueDepth: vi.fn()
          .mockResolvedValueOnce({ success: true, approximateNumberOfMessages: 1 })
          .mockResolvedValueOnce({ success: true, approximateNumberOfMessages: 0 }),
      });
      setSQSService(mockSQSService);

      const event = createScheduledEvent();
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('Expired 1 stale message from queue');
      expect(mockDeleteMessage).toHaveBeenCalledWith('receipt-handle-expired');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Expired message processed and deleted',
        expect.objectContaining({
          leaseId: expiredLeaseUuid,
          userEmail: 'expired@example.gov.uk',
          reason: 'queue_timeout',
        })
      );
    });

    it('should emit LeaseDenied event when expiring message (Story 4.4)', async () => {
      const mockDynamoDBService: DynamoDBService = {
        getUserLeaseHistory: vi.fn().mockResolvedValue([]),
        getOrgLeaseHistory: vi.fn().mockResolvedValue([]),
        getAvailableAccountsCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
        updateLeaseComments: vi.fn().mockResolvedValue({ success: true }),
      };
      setDynamoDBService(mockDynamoDBService);

      // Track emitLeaseDenied calls
      const mockEmitLeaseDenied = vi.fn().mockResolvedValue(undefined);
      setEventBridgeService({
        emitLeaseApproved: vi.fn().mockResolvedValue(undefined),
        emitLeaseEscalated: vi.fn().mockResolvedValue(undefined),
        emitLeaseDenied: mockEmitLeaseDenied,
      });

      // Create a message that was queued 10+ days ago
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 15);
      const oldDateISO = oldDate.toISOString();

      const expiredLeaseUuid = '33333333-3333-3333-3333-333333333333';
      const originalEvent = {
        version: '0',
        id: 'original-event-id',
        'detail-type': 'LeaseRequested',
        source: 'innovation-sandbox',
        account: '123456789012',
        time: oldDateISO,
        region: 'us-east-1',
        resources: [],
        detail: {
          leaseId: {
            userEmail: 'expired2@example.gov.uk',
            uuid: expiredLeaseUuid,
          },
          templateId: 'web-hosting',
        },
      };

      const mockDeleteMessage = vi.fn().mockResolvedValue({ success: true });
      const mockSQSService = createMockSQSService({
        receiveMessages: vi.fn().mockResolvedValue({
          success: true,
          messages: [
            {
              messageId: 'msg-expired-2',
              receiptHandle: 'receipt-handle-expired-2',
              body: {
                leaseId: { userEmail: 'expired2@example.gov.uk', uuid: expiredLeaseUuid },
                originalEvent,
                receivedAt: oldDateISO,
                processAfter: oldDateISO,
                reason: 'Outside business hours',
              },
              sentTimestamp: oldDate.getTime(),
            },
          ],
        }),
        deleteMessage: mockDeleteMessage,
        getQueueDepth: vi.fn()
          .mockResolvedValueOnce({ success: true, approximateNumberOfMessages: 1 })
          .mockResolvedValueOnce({ success: true, approximateNumberOfMessages: 0 }),
      });
      setSQSService(mockSQSService);

      const event = createScheduledEvent();
      await handler(event, mockContext);

      expect(mockEmitLeaseDenied).toHaveBeenCalledWith(
        expect.objectContaining({
          leaseId: {
            userEmail: 'expired2@example.gov.uk',
            uuid: expiredLeaseUuid,
          },
          reason: 'queue_timeout',
          deniedBy: 'system',
        })
      );
    });

    it('should handle deleteMessage failure in processExpiredMessage (lines 1010-1015)', async () => {
      const mockDynamoDBService: DynamoDBService = {
        getUserLeaseHistory: vi.fn().mockResolvedValue([]),
        getOrgLeaseHistory: vi.fn().mockResolvedValue([]),
        getAvailableAccountsCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
        updateLeaseComments: vi.fn().mockResolvedValue({ success: true }),
      };
      setDynamoDBService(mockDynamoDBService);

      // EventBridge works fine
      setEventBridgeService({
        emitLeaseApproved: vi.fn().mockResolvedValue(undefined),
        emitLeaseEscalated: vi.fn().mockResolvedValue(undefined),
        emitLeaseDenied: vi.fn().mockResolvedValue(undefined),
      });

      // Create a message that was queued 15 days ago (definitely expired)
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 15);
      const oldDateISO = oldDate.toISOString();

      const expiredLeaseUuid = '55555555-5555-5555-5555-555555555555';
      const originalEvent = {
        version: '0',
        id: 'original-event-id',
        'detail-type': 'LeaseRequested',
        source: 'innovation-sandbox',
        account: '123456789012',
        time: oldDateISO,
        region: 'us-east-1',
        resources: [],
        detail: {
          leaseId: {
            userEmail: 'delete-fail@example.gov.uk',
            uuid: expiredLeaseUuid,
          },
          templateId: 'web-hosting',
          budgetAmount: 50,
          leaseDurationHours: 48,
          requiresManualApproval: false,
        },
      };

      // deleteMessage returns failure
      const mockDeleteMessage = vi.fn().mockResolvedValue({ success: false, error: 'SQS delete failed' });
      const mockSQSService = createMockSQSService({
        receiveMessages: vi.fn().mockResolvedValue({
          success: true,
          messages: [
            {
              messageId: 'msg-delete-fail',
              receiptHandle: 'receipt-handle-delete-fail',
              body: {
                leaseId: { userEmail: 'delete-fail@example.gov.uk', uuid: expiredLeaseUuid },
                originalEvent,
                receivedAt: oldDateISO,
                processAfter: oldDateISO,
                reason: 'Outside business hours',
              },
              sentTimestamp: oldDate.getTime(),
            },
          ],
        }),
        deleteMessage: mockDeleteMessage,
        getQueueDepth: vi.fn().mockResolvedValue({ success: true, approximateNumberOfMessages: 1 }),
      });
      setSQSService(mockSQSService);

      const event = createScheduledEvent();
      const result = await handler(event, mockContext);

      // Should return failure for expired message
      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('Failed to expire stale message');
      // Should log the delete failure
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to delete expired message',
        expect.objectContaining({
          error: 'SQS delete failed',
          leaseId: expiredLeaseUuid,
        })
      );
    });

    it('should handle error in processExpiredMessage gracefully (lines 1030-1035)', async () => {
      const mockDynamoDBService: DynamoDBService = {
        getUserLeaseHistory: vi.fn().mockResolvedValue([]),
        getOrgLeaseHistory: vi.fn().mockResolvedValue([]),
        getAvailableAccountsCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
        updateLeaseComments: vi.fn().mockResolvedValue({ success: true }),
      };
      setDynamoDBService(mockDynamoDBService);

      // Make emitLeaseDenied throw an error to trigger the catch block
      setEventBridgeService({
        emitLeaseApproved: vi.fn().mockResolvedValue(undefined),
        emitLeaseEscalated: vi.fn().mockResolvedValue(undefined),
        emitLeaseDenied: vi.fn().mockRejectedValue(new Error('EventBridge unavailable')),
      });

      // Create a message that was queued 15 days ago (definitely expired)
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 15);
      const oldDateISO = oldDate.toISOString();

      const expiredLeaseUuid = '44444444-4444-4444-4444-444444444444';
      const originalEvent = {
        version: '0',
        id: 'original-event-id',
        'detail-type': 'LeaseRequested',
        source: 'innovation-sandbox',
        account: '123456789012',
        time: oldDateISO,
        region: 'us-east-1',
        resources: [],
        detail: {
          leaseId: {
            userEmail: 'error-expired@example.gov.uk',
            uuid: expiredLeaseUuid,
          },
          templateId: 'web-hosting',
          budgetAmount: 50,
          leaseDurationHours: 48,
          requiresManualApproval: false,
        },
      };

      const mockDeleteMessage = vi.fn().mockResolvedValue({ success: true });
      const mockSQSService = createMockSQSService({
        receiveMessages: vi.fn().mockResolvedValue({
          success: true,
          messages: [
            {
              messageId: 'msg-error-expired',
              receiptHandle: 'receipt-handle-error-expired',
              body: {
                leaseId: { userEmail: 'error-expired@example.gov.uk', uuid: expiredLeaseUuid },
                originalEvent,
                receivedAt: oldDateISO,
                processAfter: oldDateISO,
                reason: 'Outside business hours',
              },
              sentTimestamp: oldDate.getTime(),
            },
          ],
        }),
        deleteMessage: mockDeleteMessage,
        getQueueDepth: vi.fn().mockResolvedValue({ success: true, approximateNumberOfMessages: 1 }),
      });
      setSQSService(mockSQSService);

      const event = createScheduledEvent();
      const result = await handler(event, mockContext);

      // Should not crash, but should return failure
      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('Failed to expire stale message');
      // Should log the error
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error processing expired message',
        expect.objectContaining({
          error: 'EventBridge unavailable',
          leaseId: expiredLeaseUuid,
        })
      );
      // Should NOT delete the message since processing failed
      expect(mockDeleteMessage).not.toHaveBeenCalled();
    });

    it('should handle SQS receive failure gracefully', async () => {
      const mockDynamoDBService: DynamoDBService = {
        getUserLeaseHistory: vi.fn().mockResolvedValue([]),
        getOrgLeaseHistory: vi.fn().mockResolvedValue([]),
        getAvailableAccountsCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
        updateLeaseComments: vi.fn().mockResolvedValue({ success: true }),
      };
      setDynamoDBService(mockDynamoDBService);

      const mockSQSService = createMockSQSService({
        receiveMessages: vi.fn().mockResolvedValue({
          success: false,
          messages: [],
          error: 'SQS unavailable',
        }),
      });
      setSQSService(mockSQSService);

      const event = createScheduledEvent();
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(500);
      expect(result.body).toBe('Failed to receive messages: SQS unavailable');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to receive messages from queue',
        expect.objectContaining({
          error: 'SQS unavailable',
        })
      );
    });

    it('should handle AccountCleanupSucceeded event by processing queue (AC2)', async () => {
      const mockDynamoDBService: DynamoDBService = {
        getUserLeaseHistory: vi.fn().mockResolvedValue([]),
        getOrgLeaseHistory: vi.fn().mockResolvedValue([]),
        getAvailableAccountsCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
        updateLeaseComments: vi.fn().mockResolvedValue({ success: true }),
      };
      setDynamoDBService(mockDynamoDBService);

      const mockSQSService = createMockSQSService({
        receiveMessages: vi.fn().mockResolvedValue({ success: true, messages: [] }),
      });
      setSQSService(mockSQSService);

      const event: EventBridgeEvent<string, unknown> = {
        version: '0',
        id: 'cleanup-event-id',
        'detail-type': 'AccountCleanupSucceeded',
        source: 'innovation-sandbox',
        account: '123456789012',
        time: '2024-01-01T10:00:00Z',
        region: 'us-east-1',
        resources: [],
        detail: { accountId: 'cleaned-account-123' },
      };

      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Account cleanup succeeded - checking delay queue',
        expect.objectContaining({
          accountId: 'cleaned-account-123',
        })
      );
      // Should trigger queue processing with 'cleanup' trigger type
      expect(mockSQSService.receiveMessages).toHaveBeenCalled();
    });

    it('should proceed with queue processing when ISB Lambda account check fails (fail-open)', async () => {
      const mockDynamoDBService: DynamoDBService = {
        getUserLeaseHistory: vi.fn().mockResolvedValue([]),
        getOrgLeaseHistory: vi.fn().mockResolvedValue([]),
        getAvailableAccountsCount: vi.fn().mockResolvedValue({ success: true, count: 0 }),
        updateLeaseComments: vi.fn().mockResolvedValue({ success: true }),
      };
      setDynamoDBService(mockDynamoDBService);

      // Mock ISB Lambda to fail - should proceed with queue processing (fail-open)
      setIsbLambdaService({
        approveLease: vi.fn().mockResolvedValue({ success: true, statusCode: 200 }),
        denyLease: vi.fn().mockResolvedValue({ success: true, statusCode: 200 }),
        getAccounts: vi.fn().mockResolvedValue({
          success: false,
          error: 'ISB Lambda timeout',
          accounts: [],
          totalFetched: 0,
          pagesTraversed: 0,
        }),
        getLease: vi.fn().mockResolvedValue({ success: true }),
      });

      const mockSQSService = createMockSQSService({
        receiveMessages: vi.fn().mockResolvedValue({ success: true, messages: [] }),
      });
      setSQSService(mockSQSService);

      const event = createScheduledEvent();
      const result = await handler(event, mockContext);

      // Should proceed with processing despite ISB Lambda failure (fail-open to not block queue)
      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('No messages in queue');
      // Should log warning about failed account fetch
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to fetch accounts from ISB Lambda - proceeding to scoring',
        expect.objectContaining({
          error: 'ISB Lambda timeout',
        })
      );
    });

    it('should handle SQS service not configured', async () => {
      const mockDynamoDBService: DynamoDBService = {
        getUserLeaseHistory: vi.fn().mockResolvedValue([]),
        getOrgLeaseHistory: vi.fn().mockResolvedValue([]),
        getAvailableAccountsCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
        updateLeaseComments: vi.fn().mockResolvedValue({ success: true }),
      };
      setDynamoDBService(mockDynamoDBService);

      // Set SQS service to undefined
      setSQSService(undefined);

      const event = createScheduledEvent();
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('SQS service not configured');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'SQS service not configured - cannot process queue'
      );
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
      // Escalated requests do NOT call ISB Lambda - they remain pending for manual review
      expect(mockApproveLease).not.toHaveBeenCalled();
    });

    it('should send Slack notification when escalated and service is configured (Story 5.2)', async () => {
      const mockNotifyEscalation = vi.fn().mockResolvedValue({ success: true, statusCode: 200 });
      const mockSlackService: SlackService = {
        notifyEscalation: mockNotifyEscalation,
        notifyCapacityCrunch: vi.fn().mockResolvedValue({ success: true }),
      };
      setSlackService(mockSlackService);

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
            scoreBreakdown: [
              { ruleId: 'first_time_user', name: 'First Time User', points: 5, triggered: true },
              { ruleId: 'group_mailbox_detected', name: 'Group Mailbox', points: 20, triggered: true },
            ],
            decision: 'escalated',
            reason: 'Score 25 meets or exceeds threshold 20',
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(mockNotifyEscalation).toHaveBeenCalledWith(
        expect.objectContaining({
          leaseId: '123e4567-e89b-12d3-a456-426614174000',
          userEmail: 'user@example.gov.uk',
          score: 25,
          templateId: 'web-hosting',
        })
      );
    });

    it('should continue processing even if Slack notification fails (AC6)', async () => {
      const mockNotifyEscalation = vi.fn().mockResolvedValue({ success: false, error: 'Webhook error' });
      const mockSlackService: SlackService = {
        notifyEscalation: mockNotifyEscalation,
        notifyCapacityCrunch: vi.fn().mockResolvedValue({ success: true }),
      };
      setSlackService(mockSlackService);

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

      // Request should still succeed even though Slack notification failed
      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('OK');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Slack notification failed - request still escalated',
        expect.objectContaining({
          leaseId: '123e4567-e89b-12d3-a456-426614174000',
        })
      );
    });

    it('should continue processing even if Slack notification throws (AC6)', async () => {
      const mockNotifyEscalation = vi.fn().mockRejectedValue(new Error('Network error'));
      const mockSlackService: SlackService = {
        notifyEscalation: mockNotifyEscalation,
        notifyCapacityCrunch: vi.fn().mockResolvedValue({ success: true }),
      };
      setSlackService(mockSlackService);

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

      // Request should still succeed even though Slack notification threw
      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('OK');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Error sending Slack notification - request still escalated',
        expect.objectContaining({
          leaseId: '123e4567-e89b-12d3-a456-426614174000',
        })
      );
    });

    it('should return 200 OK for escalated request without calling ISB Lambda', async () => {
      // After removing temporary auto-approval, escalated requests should:
      // 1. Update lease comments
      // 2. Send Slack notification
      // 3. Return 200 OK (no ISB Lambda call)
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
            scoreBreakdown: [{ ruleId: 'group_mailbox_detected', points: 20, triggered: true }],
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      // Should return 200 OK
      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('OK');

      // Should NOT call ISB Lambda for escalated requests
      expect(mockApproveLease).not.toHaveBeenCalled();

      // Should log escalation
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Request escalated for manual review',
        expect.objectContaining({
          action: 'escalated',
          leaseId: '123e4567-e89b-12d3-a456-426614174000',
          score: 25,
        })
      );
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

    it('should continue processing even if updateLeaseComments returns failure (lines 807-812)', async () => {
      // Mock DynamoDB service to return failure for updateLeaseComments
      const mockDynamoDB: DynamoDBService = {
        getUserLeaseHistory: vi.fn().mockResolvedValue([]),
        getOrgLeaseHistory: vi.fn().mockResolvedValue([]),
        getAvailableAccountsCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
        updateLeaseComments: vi.fn().mockResolvedValue({
          success: false,
          error: 'DynamoDB error: table not found',
        }),
      };
      setDynamoDBService(mockDynamoDB);

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
            reason: 'Auto-approved',
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      // Request should still succeed
      expect(result.statusCode).toBe(200);
      // Should log the warning
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to update lease comments',
        expect.objectContaining({
          leaseId: '123e4567-e89b-12d3-a456-426614174000',
          error: 'DynamoDB error: table not found',
        })
      );
    });

    it('should continue processing even if updateLeaseComments throws (line 821)', async () => {
      // Mock DynamoDB service to throw
      const mockDynamoDB: DynamoDBService = {
        getUserLeaseHistory: vi.fn().mockResolvedValue([]),
        getOrgLeaseHistory: vi.fn().mockResolvedValue([]),
        getAvailableAccountsCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
        updateLeaseComments: vi.fn().mockRejectedValue(new Error('Connection timeout')),
      };
      setDynamoDBService(mockDynamoDB);

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
            reason: 'Auto-approved',
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      // Request should still succeed
      expect(result.statusCode).toBe(200);
      // Should log the warning
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Error updating lease comments',
        expect.objectContaining({
          leaseId: '123e4567-e89b-12d3-a456-426614174000',
          error: 'Connection timeout',
        })
      );
    });

    it('should log end-of-window penalty when in 5pm-7pm window (line 675)', async () => {
      // Set time to 5pm UK (17:00) which is within end-of-window (5pm-7pm)
      vi.setSystemTime(new Date('2025-01-07T17:00:00Z')); // Tuesday 5pm UTC

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'End-of-window penalty applicable',
        expect.objectContaining({
          endOfWindowPenalty: true,
        })
      );
    });

    it('should continue processing when ISB Lambda getAccounts throws (lines 644-651)', async () => {
      // Mock getAccounts to throw
      const mockIsbLambdaServiceWithError: IsbLambdaService = {
        approveLease: mockApproveLease,
        denyLease: mockDenyLease,
        getAccounts: vi.fn().mockRejectedValue(new Error('Lambda invocation failed')),
        getLease: mockGetLease,
      };
      setIsbLambdaService(mockIsbLambdaServiceWithError);

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      // Should still succeed - error is handled gracefully
      expect(result.statusCode).toBe(200);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error checking account readiness - proceeding to scoring',
        expect.objectContaining({
          error: 'Lambda invocation failed',
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
        getAvailableAccountsCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
        updateLeaseComments: vi.fn().mockResolvedValue({ success: true }),
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
        getAvailableAccountsCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
        updateLeaseComments: vi.fn().mockResolvedValue({ success: true }),
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
        getAvailableAccountsCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
        updateLeaseComments: vi.fn().mockResolvedValue({ success: true }),
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
        getAvailableAccountsCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
        updateLeaseComments: vi.fn().mockResolvedValue({ success: true }),
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
        getAvailableAccountsCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
        updateLeaseComments: vi.fn().mockResolvedValue({ success: true }),
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
        getAvailableAccountsCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
        updateLeaseComments: vi.fn().mockResolvedValue({ success: true }),
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
        getAvailableAccountsCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
        updateLeaseComments: vi.fn().mockResolvedValue({ success: true }),
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

  describe('Domain verification integration (Story 3.3)', () => {
    it('should verify domain using allowlist service (AC1, AC2)', async () => {
      const mockAllowlistService: DomainAllowlistService = {
        getLocalAuthorityDomains: vi.fn().mockResolvedValue({
          domains: ['example.gov.uk', 'council.gov.uk'],
          usedStaleCache: false,
        }),
        clearCache: vi.fn(),
      };
      setDomainAllowlistService(mockAllowlistService);

      const event = createValidLeaseRequestedEvent();
      await handler(event, mockContext);

      expect(mockAllowlistService.getLocalAuthorityDomains).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Domain verification result',
        expect.objectContaining({
          domain: 'example.gov.uk',
          isVerified: true,
          allowlistSize: 2,
          usedStaleCache: false,
        })
      );
    });

    it('should pass isVerifiedGovDomain=true to state machine when domain is verified (AC3)', async () => {
      const mockAllowlistService: DomainAllowlistService = {
        getLocalAuthorityDomains: vi.fn().mockResolvedValue({
          domains: ['example.gov.uk'],
          usedStaleCache: false,
        }),
        clearCache: vi.fn(),
      };
      setDomainAllowlistService(mockAllowlistService);

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
            isVerifiedGovDomain: true,
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();
      await handler(event, mockContext);

      // Verify orchestrator was called with isVerifiedGovDomain: true
      expect(mockOrchestrator.run).toHaveBeenCalledWith(
        ApprovalState.RECEIVED,
        expect.objectContaining({
          isVerifiedGovDomain: true,
        })
      );
    });

    it('should pass isVerifiedGovDomain=false when domain is not in allowlist (AC4)', async () => {
      const mockAllowlistService: DomainAllowlistService = {
        getLocalAuthorityDomains: vi.fn().mockResolvedValue({
          domains: ['other-council.gov.uk'],
          usedStaleCache: false,
        }),
        clearCache: vi.fn(),
      };
      setDomainAllowlistService(mockAllowlistService);

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
            score: 5,
            decision: 'approved',
            isVerifiedGovDomain: false,
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();
      await handler(event, mockContext);

      // Verify orchestrator was called with isVerifiedGovDomain: false
      expect(mockOrchestrator.run).toHaveBeenCalledWith(
        ApprovalState.RECEIVED,
        expect.objectContaining({
          isVerifiedGovDomain: false,
        })
      );
    });

    it('should use pessimistic fallback when allowlist service is not configured', async () => {
      // Set allowlist service to undefined to simulate not configured
      setDomainAllowlistService(undefined);

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      // Should still succeed with pessimistic fallback (no bonus)
      expect(result.statusCode).toBe(200);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Domain allowlist service not configured - skipping domain verification',
        expect.objectContaining({
          domain: 'example.gov.uk',
        })
      );
    });

    it('should use pessimistic fallback on S3 error (AC5)', async () => {
      const mockAllowlistService: DomainAllowlistService = {
        getLocalAuthorityDomains: vi.fn().mockRejectedValue(new Error('S3 bucket not found')),
        clearCache: vi.fn(),
      };
      setDomainAllowlistService(mockAllowlistService);

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      // Should still succeed with pessimistic fallback (no bonus)
      expect(result.statusCode).toBe(200);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to verify domain - using pessimistic fallback',
        expect.objectContaining({
          error: 'S3 bucket not found',
          domain: 'example.gov.uk',
        })
      );
    });

    it('should pass isVerifiedGovDomain=false on S3 error for pessimistic scoring', async () => {
      const mockAllowlistService: DomainAllowlistService = {
        getLocalAuthorityDomains: vi.fn().mockRejectedValue(new Error('S3 unavailable')),
        clearCache: vi.fn(),
      };
      setDomainAllowlistService(mockAllowlistService);

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
            score: 5,
            decision: 'approved',
            isVerifiedGovDomain: false,
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();
      await handler(event, mockContext);

      // Verify orchestrator was called with isVerifiedGovDomain: false (pessimistic)
      expect(mockOrchestrator.run).toHaveBeenCalledWith(
        ApprovalState.RECEIVED,
        expect.objectContaining({
          isVerifiedGovDomain: false,
        })
      );
    });

    it('should log warning when stale cache is used (AC6)', async () => {
      const mockAllowlistService: DomainAllowlistService = {
        getLocalAuthorityDomains: vi.fn().mockResolvedValue({
          domains: ['example.gov.uk'],
          usedStaleCache: true,
          staleReason: 'S3 temporarily unavailable',
        }),
        clearCache: vi.fn(),
      };
      setDomainAllowlistService(mockAllowlistService);

      const event = createValidLeaseRequestedEvent();
      await handler(event, mockContext);

      // Should log warning about stale cache
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Using stale domain cache after S3 error',
        expect.objectContaining({
          domain: 'example.gov.uk',
          staleReason: 'S3 temporarily unavailable',
        })
      );
      // Domain should still be verified (from stale cache)
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Domain verification result',
        expect.objectContaining({
          domain: 'example.gov.uk',
          isVerified: true,
          usedStaleCache: true,
        })
      );
    });
  });

  describe('Bedrock AI email analysis integration (Story 3.4)', () => {
    it('should analyze email using Bedrock service (AC1)', async () => {
      const mockBedrockService: BedrockService = {
        analyzeEmail: vi.fn().mockResolvedValue({
          analysis: {
            isGroupMailbox: false,
            confidence: 0.9,
          },
          usedFallback: false,
        }),
        getCircuitState: vi.fn().mockReturnValue('CLOSED'),
        resetCircuitBreaker: vi.fn(),
      };
      setBedrockService(mockBedrockService);

      const event = createValidLeaseRequestedEvent();
      await handler(event, mockContext);

      expect(mockBedrockService.analyzeEmail).toHaveBeenCalledWith('user@example.gov.uk');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'AI email analysis completed',
        expect.objectContaining({
          email: 'user@example.gov.uk',
          isGroupMailbox: false,
          confidence: 0.9,
        })
      );
    });

    it('should detect group mailbox patterns (AC2)', async () => {
      const mockBedrockService: BedrockService = {
        analyzeEmail: vi.fn().mockResolvedValue({
          analysis: {
            isGroupMailbox: true,
            confidence: 0.9,
          },
          usedFallback: false,
        }),
        getCircuitState: vi.fn().mockReturnValue('CLOSED'),
        resetCircuitBreaker: vi.fn(),
      };
      setBedrockService(mockBedrockService);

      const event = createMockEvent('LeaseRequested', {
        leaseId: {
          userEmail: 'team@council.gov.uk',
          uuid: '123e4567-e89b-12d3-a456-426614174000',
        },
        templateId: 'web-hosting',
        budgetAmount: 50,
        leaseDurationHours: 48,
        requiresManualApproval: false,
      });

      await handler(event, mockContext);

      expect(mockBedrockService.analyzeEmail).toHaveBeenCalledWith('team@council.gov.uk');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'AI email analysis completed',
        expect.objectContaining({
          isGroupMailbox: true,
        })
      );
    });

    it('should pass aiAnalysis to state machine context (AC3)', async () => {
      const mockAiAnalysis = {
        isGroupMailbox: true,
        confidence: 0.7,
      };
      const mockBedrockService: BedrockService = {
        analyzeEmail: vi.fn().mockResolvedValue({
          analysis: mockAiAnalysis,
          usedFallback: true,
          fallbackReason: 'Bedrock timeout',
        }),
        getCircuitState: vi.fn().mockReturnValue('CLOSED'),
        resetCircuitBreaker: vi.fn(),
      };
      setBedrockService(mockBedrockService);

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
            score: 20,
            decision: 'approved',
            aiAnalysis: mockAiAnalysis,
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();
      await handler(event, mockContext);

      // Verify orchestrator was called with aiAnalysis in context
      expect(mockOrchestrator.run).toHaveBeenCalledWith(
        ApprovalState.RECEIVED,
        expect.objectContaining({
          aiAnalysis: mockAiAnalysis,
        })
      );
    });

    it('should use fallback when Bedrock times out (AC4)', async () => {
      const mockBedrockService: BedrockService = {
        analyzeEmail: vi.fn().mockResolvedValue({
          analysis: {
            isGroupMailbox: true, // Rule-based fallback detected 'team' prefix
            confidence: 0.7,
          },
          usedFallback: true,
          fallbackReason: 'Bedrock timeout',
        }),
        getCircuitState: vi.fn().mockReturnValue('CLOSED'),
        resetCircuitBreaker: vi.fn(),
      };
      setBedrockService(mockBedrockService);

      const event = createMockEvent('LeaseRequested', {
        leaseId: {
          userEmail: 'team@council.gov.uk',
          uuid: '123e4567-e89b-12d3-a456-426614174000',
        },
        templateId: 'web-hosting',
        budgetAmount: 50,
        leaseDurationHours: 48,
        requiresManualApproval: false,
      });
      await handler(event, mockContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'AI email analysis used fallback',
        expect.objectContaining({
          email: 'team@council.gov.uk',
          fallbackReason: 'Bedrock timeout',
          isGroupMailbox: true,
        })
      );
    });

    it('should use fallback when circuit breaker is open (AC5)', async () => {
      const mockBedrockService: BedrockService = {
        analyzeEmail: vi.fn().mockResolvedValue({
          analysis: {
            isGroupMailbox: false,
            confidence: 0.5,
          },
          usedFallback: true,
          fallbackReason: 'Circuit breaker open',
        }),
        getCircuitState: vi.fn().mockReturnValue('OPEN'),
        resetCircuitBreaker: vi.fn(),
      };
      setBedrockService(mockBedrockService);

      const event = createValidLeaseRequestedEvent();
      await handler(event, mockContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'AI email analysis used fallback',
        expect.objectContaining({
          fallbackReason: 'Circuit breaker open',
        })
      );
    });

    it('should skip AI analysis when Bedrock service is not configured', async () => {
      // Set Bedrock service to undefined
      setBedrockService(undefined);

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      // Should still succeed without AI analysis
      expect(result.statusCode).toBe(200);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Bedrock service not configured - skipping AI analysis',
        expect.objectContaining({
          email: 'user@example.gov.uk',
        })
      );
    });

    it('should handle unexpected errors gracefully', async () => {
      const mockBedrockService: BedrockService = {
        analyzeEmail: vi.fn().mockRejectedValue(new Error('Unexpected Bedrock error')),
        getCircuitState: vi.fn().mockReturnValue('CLOSED'),
        resetCircuitBreaker: vi.fn(),
      };
      setBedrockService(mockBedrockService);

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      // Should still succeed with no AI analysis
      expect(result.statusCode).toBe(200);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Unexpected error in AI email analysis - skipping',
        expect.objectContaining({
          error: 'Unexpected Bedrock error',
          email: 'user@example.gov.uk',
        })
      );
    });

    it('should use rule-based fallback detection (AC7)', async () => {
      const mockBedrockService: BedrockService = {
        analyzeEmail: vi.fn().mockResolvedValue({
          analysis: {
            isGroupMailbox: true, // Detected 'info' prefix
            confidence: 0.7, // Medium confidence from rule-based
          },
          usedFallback: true,
          fallbackReason: 'Bedrock unavailable',
        }),
        getCircuitState: vi.fn().mockReturnValue('OPEN'),
        resetCircuitBreaker: vi.fn(),
      };
      setBedrockService(mockBedrockService);

      const event = createMockEvent('LeaseRequested', {
        leaseId: {
          userEmail: 'info@council.gov.uk',
          uuid: '123e4567-e89b-12d3-a456-426614174000',
        },
        templateId: 'web-hosting',
        budgetAmount: 50,
        leaseDurationHours: 48,
        requiresManualApproval: false,
      });

      await handler(event, mockContext);

      // Verify fallback was used and group mailbox was detected
      expect(mockLogger.info).toHaveBeenCalledWith(
        'AI email analysis used fallback',
        expect.objectContaining({
          isGroupMailbox: true,
        })
      );
    });
  });

  describe('Delayed decision handling (Story 6.2, 6.3, 6.4)', () => {
    it('should handle business hours delay with SQS service', async () => {
      setSQSService(mockSQSService);

      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.DELAYED,
          success: true,
          context: {
            ...createInitialContext(),
            leaseId: '123e4567-e89b-12d3-a456-426614174000',
            userEmail: 'user@example.gov.uk',
            templateId: 'web-hosting',
            score: 5,
            decision: 'delayed',
            reason: 'Outside business hours',
            nextProcessingTime: '2025-12-31T09:00:00Z',
            // No accountDelayReason - this is a business hours delay
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('Delayed - will process during next business hours');
      expect(mockSendDelayedRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          leaseId: expect.objectContaining({
            userEmail: 'user@example.gov.uk',
            uuid: '123e4567-e89b-12d3-a456-426614174000',
          }),
          reason: 'Outside business hours',
        })
      );
    });

    it('should handle account cooldown delay and add to queue position table', async () => {
      setSQSService(mockSQSService);

      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.DELAYED,
          success: true,
          context: {
            ...createInitialContext(),
            leaseId: '123e4567-e89b-12d3-a456-426614174000',
            userEmail: 'user@example.gov.uk',
            templateId: 'web-hosting',
            score: 5,
            decision: 'delayed',
            reason: 'No ready accounts',
            accountDelayReason: 'NO_READY_ACCOUNTS',
            estimatedAccountReadyTime: '2025-12-31T12:00:00Z',
            coolingAccountCount: 3,
            activeAccountCount: 5,
            nextProcessingTime: '2025-12-31T12:00:00Z',
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('Delayed - will process during next business hours');
      expect(mockSendDelayedRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'No ready accounts',
        })
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Request delayed',
        expect.objectContaining({
          delayReason: 'account_cooldown',
          accountDelayReason: 'NO_READY_ACCOUNTS',
        })
      );
    });

    it('should send capacity crunch alert when all accounts are active', async () => {
      setSQSService(mockSQSService);
      const mockNotifyCapacityCrunch = vi.fn().mockResolvedValue({ success: true });
      const mockSlackService: SlackService = {
        notifyEscalation: vi.fn().mockResolvedValue({ success: true }),
        notifyCapacityCrunch: mockNotifyCapacityCrunch,
      };
      setSlackService(mockSlackService);

      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.DELAYED,
          success: true,
          context: {
            ...createInitialContext(),
            leaseId: '123e4567-e89b-12d3-a456-426614174000',
            userEmail: 'user@example.gov.uk',
            templateId: 'web-hosting',
            score: 5,
            decision: 'delayed',
            reason: 'Capacity crunch - all accounts active',
            accountDelayReason: 'NO_READY_ACCOUNTS',
            estimatedAccountReadyTime: '2025-12-31T12:00:00Z',
            coolingAccountCount: 0, // No cooling accounts = capacity crunch
            activeAccountCount: 8,
            nextProcessingTime: '2025-12-31T12:00:00Z',
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(mockNotifyCapacityCrunch).toHaveBeenCalledWith(
        expect.objectContaining({
          alertType: 'capacity_crunch',
          activeAccounts: 8,
          availableAccounts: 0,
        })
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Capacity crunch alert sent to Slack',
        expect.objectContaining({
          activeAccounts: 8,
        })
      );
    });

    it('should continue processing when capacity crunch alert fails', async () => {
      setSQSService(mockSQSService);
      const mockNotifyCapacityCrunch = vi.fn().mockResolvedValue({ success: false, error: 'Slack error' });
      const mockSlackService: SlackService = {
        notifyEscalation: vi.fn().mockResolvedValue({ success: true }),
        notifyCapacityCrunch: mockNotifyCapacityCrunch,
      };
      setSlackService(mockSlackService);

      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.DELAYED,
          success: true,
          context: {
            ...createInitialContext(),
            leaseId: '123e4567-e89b-12d3-a456-426614174000',
            userEmail: 'user@example.gov.uk',
            templateId: 'web-hosting',
            score: 5,
            decision: 'delayed',
            accountDelayReason: 'NO_READY_ACCOUNTS',
            coolingAccountCount: 0,
            activeAccountCount: 8,
            nextProcessingTime: '2025-12-31T12:00:00Z',
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      // Should still succeed even though alert failed
      expect(result.statusCode).toBe(200);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to send capacity crunch alert to Slack',
        expect.objectContaining({
          error: 'Slack error',
        })
      );
    });

    it('should escalate when SQS service is not configured for delayed request', async () => {
      setSQSService(undefined);

      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.DELAYED,
          success: true,
          context: {
            ...createInitialContext(),
            leaseId: '123e4567-e89b-12d3-a456-426614174000',
            userEmail: 'user@example.gov.uk',
            templateId: 'web-hosting',
            score: 5,
            decision: 'delayed',
            reason: 'Outside business hours',
            nextProcessingTime: '2025-12-31T09:00:00Z',
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();

      await expect(handler(event, mockContext)).rejects.toThrow('Delay queue not configured');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Delay queue not configured - escalating instead',
        expect.any(Object)
      );
    });

    it('should escalate when SQS send fails', async () => {
      mockSendDelayedRequest.mockResolvedValueOnce({ success: false, error: 'SQS unavailable' });
      setSQSService(mockSQSService);

      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.DELAYED,
          success: true,
          context: {
            ...createInitialContext(),
            leaseId: '123e4567-e89b-12d3-a456-426614174000',
            userEmail: 'user@example.gov.uk',
            templateId: 'web-hosting',
            score: 5,
            decision: 'delayed',
            reason: 'Outside business hours',
            nextProcessingTime: '2025-12-31T09:00:00Z',
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();

      await expect(handler(event, mockContext)).rejects.toThrow('SQS unavailable');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to send to delay queue - escalating',
        expect.objectContaining({
          error: 'SQS unavailable',
        })
      );
    });

    it('should use cooldown delay message for account cooldown without queue estimate', async () => {
      setSQSService(mockSQSService);

      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.DELAYED,
          success: true,
          context: {
            ...createInitialContext(),
            leaseId: '123e4567-e89b-12d3-a456-426614174000',
            userEmail: 'user@example.gov.uk',
            templateId: 'web-hosting',
            score: 5,
            decision: 'delayed',
            reason: 'No ready accounts',
            accountDelayReason: 'NO_READY_ACCOUNTS',
            estimatedAccountReadyTime: '2025-12-31T12:00:00Z',
            coolingAccountCount: 2,
            activeAccountCount: 6,
            nextProcessingTime: '2025-12-31T12:00:00Z',
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Request sent to delay queue',
        expect.objectContaining({
          delayReason: 'account_cooldown',
        })
      );
    });

    it('should handle capacity crunch alert exception gracefully', async () => {
      setSQSService(mockSQSService);
      const mockNotifyCapacityCrunch = vi.fn().mockRejectedValue(new Error('Slack API down'));
      const mockSlackService: SlackService = {
        notifyEscalation: vi.fn().mockResolvedValue({ success: true }),
        notifyCapacityCrunch: mockNotifyCapacityCrunch,
      };
      setSlackService(mockSlackService);

      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.DELAYED,
          success: true,
          context: {
            ...createInitialContext(),
            leaseId: '123e4567-e89b-12d3-a456-426614174000',
            userEmail: 'user@example.gov.uk',
            templateId: 'web-hosting',
            score: 5,
            decision: 'delayed',
            accountDelayReason: 'NO_READY_ACCOUNTS',
            coolingAccountCount: 0,
            activeAccountCount: 8,
            nextProcessingTime: '2025-12-31T12:00:00Z',
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      // Should still succeed even though alert threw an exception
      expect(result.statusCode).toBe(200);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Error processing capacity crunch alert',
        expect.objectContaining({
          error: 'Slack API down',
        })
      );
    });

    it('should handle non-Error exception in capacity crunch alert', async () => {
      setSQSService(mockSQSService);
      const mockNotifyCapacityCrunch = vi.fn().mockRejectedValue('String error');
      const mockSlackService: SlackService = {
        notifyEscalation: vi.fn().mockResolvedValue({ success: true }),
        notifyCapacityCrunch: mockNotifyCapacityCrunch,
      };
      setSlackService(mockSlackService);

      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.DELAYED,
          success: true,
          context: {
            ...createInitialContext(),
            leaseId: '123e4567-e89b-12d3-a456-426614174000',
            userEmail: 'user@example.gov.uk',
            templateId: 'web-hosting',
            score: 5,
            decision: 'delayed',
            accountDelayReason: 'NO_READY_ACCOUNTS',
            coolingAccountCount: 0,
            activeAccountCount: 8,
            nextProcessingTime: '2025-12-31T12:00:00Z',
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      expect(result.statusCode).toBe(200);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Error processing capacity crunch alert',
        expect.objectContaining({
          error: 'String error',
        })
      );
    });

    it('should handle non-Error exception in SQS send failure', async () => {
      mockSendDelayedRequest.mockRejectedValueOnce('String SQS error');
      setSQSService(mockSQSService);

      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.DELAYED,
          success: true,
          context: {
            ...createInitialContext(),
            leaseId: '123e4567-e89b-12d3-a456-426614174000',
            userEmail: 'user@example.gov.uk',
            templateId: 'web-hosting',
            score: 5,
            decision: 'delayed',
            reason: 'Outside business hours',
            nextProcessingTime: '2025-12-31T09:00:00Z',
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();

      // The SQS send throws a non-Error, which should be handled gracefully
      await expect(handler(event, mockContext)).rejects.toThrow();
    });

    it('should continue with delay when addToQueue fails (lines 1663-1667)', async () => {
      setSQSService(mockSQSService);

      // Make addToQueue fail
      mockAddToQueue.mockResolvedValueOnce({
        success: false,
        error: 'DynamoDB connection error',
      });

      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.DELAYED,
          success: true,
          context: {
            ...createInitialContext(),
            leaseId: '123e4567-e89b-12d3-a456-426614174000',
            userEmail: 'user@example.gov.uk',
            templateId: 'web-hosting',
            score: 5,
            decision: 'delayed',
            reason: 'No ready accounts',
            accountDelayReason: 'NO_READY_ACCOUNTS',
            estimatedAccountReadyTime: '2025-12-31T12:00:00Z',
            coolingAccountCount: 3,
            activeAccountCount: 5,
            nextProcessingTime: '2025-12-31T12:00:00Z',
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      // Should still succeed even though addToQueue failed
      expect(result.statusCode).toBe(200);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to add to queue position table - continuing with delay',
        expect.objectContaining({
          error: 'DynamoDB connection error',
        })
      );
    });

    it('should use cooldown delay message when queue estimate is not available (line 1778)', async () => {
      setSQSService(mockSQSService);

      // addToQueue succeeds but getQueueEstimate returns null (no estimate)
      mockAddToQueue.mockResolvedValueOnce({
        success: true,
        position: 1,
      });
      mockGetQueueEstimate.mockResolvedValueOnce(null);

      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.DELAYED,
          success: true,
          context: {
            ...createInitialContext(),
            leaseId: '123e4567-e89b-12d3-a456-426614174000',
            userEmail: 'user@example.gov.uk',
            templateId: 'web-hosting',
            score: 5,
            decision: 'delayed',
            reason: 'No ready accounts',
            accountDelayReason: 'NO_READY_ACCOUNTS',
            estimatedAccountReadyTime: '2025-12-31T12:00:00Z',
            coolingAccountCount: 2,
            activeAccountCount: 6,
            nextProcessingTime: '2025-12-31T12:00:00Z',
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      // Should succeed with cooldown delay message path
      expect(result.statusCode).toBe(200);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Request sent to delay queue',
        expect.objectContaining({
          delayReason: 'account_cooldown',
        })
      );
    });

    it('should handle error exception in queue position tracking (lines 1668-1673)', async () => {
      setSQSService(mockSQSService);

      // Make addToQueue throw an exception
      mockAddToQueue.mockRejectedValueOnce(new Error('Queue tracking exception'));

      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.DELAYED,
          success: true,
          context: {
            ...createInitialContext(),
            leaseId: '123e4567-e89b-12d3-a456-426614174000',
            userEmail: 'user@example.gov.uk',
            templateId: 'web-hosting',
            score: 5,
            decision: 'delayed',
            reason: 'No ready accounts',
            accountDelayReason: 'NO_READY_ACCOUNTS',
            estimatedAccountReadyTime: '2025-12-31T12:00:00Z',
            coolingAccountCount: 3,
            activeAccountCount: 5,
            nextProcessingTime: '2025-12-31T12:00:00Z',
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      // Should still succeed even though queue tracking threw
      expect(result.statusCode).toBe(200);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Error tracking queue position - continuing with delay',
        expect.objectContaining({
          error: 'Queue tracking exception',
        })
      );
    });

    it('should handle non-Error exception in queue position tracking (lines 1668-1673)', async () => {
      setSQSService(mockSQSService);

      // Make addToQueue throw a non-Error
      mockAddToQueue.mockRejectedValueOnce('Non-Error queue exception');

      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.DELAYED,
          success: true,
          context: {
            ...createInitialContext(),
            leaseId: '123e4567-e89b-12d3-a456-426614174000',
            userEmail: 'user@example.gov.uk',
            templateId: 'web-hosting',
            score: 5,
            decision: 'delayed',
            reason: 'No ready accounts',
            accountDelayReason: 'NO_READY_ACCOUNTS',
            estimatedAccountReadyTime: '2025-12-31T12:00:00Z',
            coolingAccountCount: 3,
            activeAccountCount: 5,
            nextProcessingTime: '2025-12-31T12:00:00Z',
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      // Should still succeed with non-Error stringified
      expect(result.statusCode).toBe(200);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Error tracking queue position - continuing with delay',
        expect.objectContaining({
          error: 'Non-Error queue exception',
        })
      );
    });

    it('should throttle capacity crunch alert when recently sent (line 1651)', async () => {
      setSQSService(mockSQSService);
      const mockNotifyCapacityCrunch = vi.fn().mockResolvedValue({ success: true });
      const mockSlackService: SlackService = {
        notifyEscalation: vi.fn().mockResolvedValue({ success: true }),
        notifyCapacityCrunch: mockNotifyCapacityCrunch,
      };
      setSlackService(mockSlackService);

      // Set last alert time to 30 minutes ago (within 1-hour throttle period)
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      mockGetLastCapacityCrunchAlertTime.mockResolvedValueOnce({
        success: true,
        lastAlertTime: thirtyMinutesAgo,
      });

      const mockOrchestrator: StateMachineOrchestrator = {
        run: vi.fn().mockReturnValue({
          finalState: ApprovalState.DELAYED,
          success: true,
          context: {
            ...createInitialContext(),
            leaseId: '123e4567-e89b-12d3-a456-426614174000',
            userEmail: 'user@example.gov.uk',
            templateId: 'web-hosting',
            score: 5,
            decision: 'delayed',
            accountDelayReason: 'NO_READY_ACCOUNTS',
            coolingAccountCount: 0, // Capacity crunch condition
            activeAccountCount: 8,
            nextProcessingTime: '2025-12-31T12:00:00Z',
          },
        }),
      };
      setOrchestrator(mockOrchestrator);

      const event = createValidLeaseRequestedEvent();
      const result = await handler(event, mockContext);

      // Request should succeed
      expect(result.statusCode).toBe(200);
      // Alert should NOT be sent (throttled)
      expect(mockNotifyCapacityCrunch).not.toHaveBeenCalled();
      // Should log the throttle
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Capacity crunch alert throttled',
        expect.objectContaining({
          lastAlertTime: thirtyMinutesAgo.toISOString(),
        })
      );
    });
  });

});
