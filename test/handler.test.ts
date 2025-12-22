import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../src/handler.js';
import type { EventBridgeEvent, Context } from 'aws-lambda';

vi.mock('../src/lib/logger.ts', () => ({
  logger: {
    info: vi.fn(),
    addContext: vi.fn(),
  },
}));

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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return statusCode 200 and body OK', async () => {
    const event = createMockEvent('LeaseRequested', { leaseId: 'test-lease' });

    const result = await handler(event, mockContext);

    expect(result).toEqual({
      statusCode: 200,
      body: 'OK',
    });
  });

  it('should handle events with different detail types', async () => {
    const event = createMockEvent('AccountCleanupSucceeded', {
      accountId: 'test-account',
    });

    const result = await handler(event, mockContext);

    expect(result.statusCode).toBe(200);
  });

  it('should handle events with empty detail', async () => {
    const event = createMockEvent('ScheduledProcessing', {});

    const result = await handler(event, mockContext);

    expect(result.statusCode).toBe(200);
    expect(result.body).toBe('OK');
  });
});
