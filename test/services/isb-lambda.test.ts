import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import {
  createIsbLambdaService,
  type IsbLambdaServiceConfig,
  type ApproveLeaseLambdaParams,
  type DenyLeaseLambdaParams,
} from '../../src/services/isb-lambda.js';

// Mock the Lambda client
vi.mock('@aws-sdk/client-lambda', async () => {
  const actual = await vi.importActual('@aws-sdk/client-lambda');
  return {
    ...actual,
    LambdaClient: vi.fn().mockImplementation(() => ({
      send: vi.fn().mockResolvedValue({}),
    })),
  };
});

describe('ISB Lambda Service', () => {
  let mockClient: LambdaClient;
  let mockSend: ReturnType<typeof vi.fn>;
  const config: IsbLambdaServiceConfig = {
    functionName: 'ISB-LeasesLambdaFunction-test',
  };

  beforeEach(() => {
    mockSend = vi.fn().mockResolvedValue({
      Payload: Buffer.from(
        JSON.stringify({
          statusCode: 200,
          body: JSON.stringify({ status: 'success' }),
        })
      ),
    });
    mockClient = {
      send: mockSend,
    } as unknown as LambdaClient;
  });

  describe('createIsbLambdaService', () => {
    it('creates a service with approveLease method', () => {
      const service = createIsbLambdaService(mockClient, config);

      expect(service).toBeDefined();
      expect(typeof service.approveLease).toBe('function');
    });

    it('creates a service with denyLease method', () => {
      const service = createIsbLambdaService(mockClient, config);

      expect(service).toBeDefined();
      expect(typeof service.denyLease).toBe('function');
    });
  });

  describe('approveLease', () => {
    const approveParams: ApproveLeaseLambdaParams = {
      leaseId: {
        userEmail: 'user@example.gov.uk',
        uuid: '123e4567-e89b-12d3-a456-426614174000',
      },
      approverEmail: 'ndx+try-automated-approver@dsit.gov.uk',
    };

    it('sends an InvokeCommand with correct function name', async () => {
      const service = createIsbLambdaService(mockClient, config);

      await service.approveLease(approveParams);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0];
      expect(sentCommand).toBeInstanceOf(InvokeCommand);
    });

    it('includes correct API Gateway event payload structure', async () => {
      const service = createIsbLambdaService(mockClient, config);

      await service.approveLease(approveParams);

      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0] as InvokeCommand;
      const payload = JSON.parse(Buffer.from(sentCommand.input.Payload as Buffer).toString());

      expect(payload.httpMethod).toBe('POST');
      expect(payload.path).toContain('/leases/');
      expect(payload.path).toContain('/review');
      expect(payload.body).toBe(JSON.stringify({ action: 'Approve' }));
    });

    it('includes Authorization header with JWT', async () => {
      const service = createIsbLambdaService(mockClient, config);

      await service.approveLease(approveParams);

      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0] as InvokeCommand;
      const payload = JSON.parse(Buffer.from(sentCommand.input.Payload as Buffer).toString());

      expect(payload.headers.Authorization).toMatch(/^Bearer .+\..+\..+$/);
      expect(payload.headers['Content-Type']).toBe('application/json');
    });

    it('encodes leaseId as base64 in path parameter', async () => {
      const service = createIsbLambdaService(mockClient, config);

      await service.approveLease(approveParams);

      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0] as InvokeCommand;
      const payload = JSON.parse(Buffer.from(sentCommand.input.Payload as Buffer).toString());

      // Decode the leaseId from the path
      const leaseIdB64 = payload.pathParameters.leaseId;
      const decodedLeaseId = JSON.parse(Buffer.from(leaseIdB64, 'base64').toString());

      expect(decodedLeaseId.userEmail).toBe(approveParams.leaseId.userEmail);
      expect(decodedLeaseId.uuid).toBe(approveParams.leaseId.uuid);
    });

    it('returns success result on 200 response', async () => {
      const service = createIsbLambdaService(mockClient, config);

      const result = await service.approveLease(approveParams);

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.message).toBe('success');
    });

    it('returns failure on non-2xx response', async () => {
      mockSend.mockResolvedValue({
        Payload: Buffer.from(
          JSON.stringify({
            statusCode: 400,
            body: JSON.stringify({ message: 'Lease not found' }),
          })
        ),
      });

      const service = createIsbLambdaService(mockClient, config);
      const result = await service.approveLease(approveParams);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(400);
      expect(result.error).toBe('Lease not found');
    });

    it('handles Lambda function error', async () => {
      mockSend.mockResolvedValue({
        FunctionError: 'Unhandled',
        Payload: Buffer.from('{}'),
      });

      const service = createIsbLambdaService(mockClient, config);
      const result = await service.approveLease(approveParams);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
      expect(result.error).toContain('Lambda function error');
    });

    it('handles empty payload response', async () => {
      mockSend.mockResolvedValue({
        Payload: undefined,
      });

      const service = createIsbLambdaService(mockClient, config);
      const result = await service.approveLease(approveParams);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
      expect(result.error).toBe('Empty response from ISB Lambda');
    });

    it('handles malformed JSON response', async () => {
      mockSend.mockResolvedValue({
        Payload: Buffer.from('not valid json'),
      });

      const service = createIsbLambdaService(mockClient, config);
      const result = await service.approveLease(approveParams);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
      expect(result.error).toContain('Failed to parse ISB Lambda response');
    });

    it('extracts error from ISB JSend response format', async () => {
      mockSend.mockResolvedValue({
        Payload: Buffer.from(
          JSON.stringify({
            statusCode: 409,
            body: JSON.stringify({
              data: {
                errors: [{ message: 'Lease already approved' }],
              },
            }),
          })
        ),
      });

      const service = createIsbLambdaService(mockClient, config);
      const result = await service.approveLease(approveParams);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Lease already approved');
    });

    it('propagates client errors', async () => {
      const error = new Error('Lambda unavailable');
      mockSend.mockRejectedValue(error);

      const service = createIsbLambdaService(mockClient, config);

      await expect(service.approveLease(approveParams)).rejects.toThrow('Lambda unavailable');
    });
  });

  describe('denyLease', () => {
    const denyParams: DenyLeaseLambdaParams = {
      leaseId: {
        userEmail: 'user@example.gov.uk',
        uuid: '123e4567-e89b-12d3-a456-426614174000',
      },
      approverEmail: 'ndx+try-automated-approver@dsit.gov.uk',
    };

    it('sends Deny action in request body', async () => {
      const service = createIsbLambdaService(mockClient, config);

      await service.denyLease(denyParams);

      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0] as InvokeCommand;
      const payload = JSON.parse(Buffer.from(sentCommand.input.Payload as Buffer).toString());

      expect(payload.body).toBe(JSON.stringify({ action: 'Deny' }));
    });

    it('returns success result on 200 response', async () => {
      const service = createIsbLambdaService(mockClient, config);

      const result = await service.denyLease(denyParams);

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
    });

    it('handles Lambda function error', async () => {
      mockSend.mockResolvedValue({
        FunctionError: 'Unhandled',
        Payload: Buffer.from('{}'),
      });

      const service = createIsbLambdaService(mockClient, config);
      const result = await service.denyLease(denyParams);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Lambda function error');
    });

    it('propagates client errors', async () => {
      const error = new Error('Lambda unavailable');
      mockSend.mockRejectedValue(error);

      const service = createIsbLambdaService(mockClient, config);

      await expect(service.denyLease(denyParams)).rejects.toThrow('Lambda unavailable');
    });
  });

  describe('JWT token generation', () => {
    it('includes approver email in JWT payload', async () => {
      const service = createIsbLambdaService(mockClient, config);

      await service.approveLease({
        leaseId: {
          userEmail: 'user@example.gov.uk',
          uuid: '123e4567-e89b-12d3-a456-426614174000',
        },
        approverEmail: 'custom-approver@gov.uk',
      });

      const callArgs = mockSend.mock.calls[0] as unknown[];
      const sentCommand = callArgs[0] as InvokeCommand;
      const payload = JSON.parse(Buffer.from(sentCommand.input.Payload as Buffer).toString());

      // Extract and decode JWT payload
      const jwtToken = payload.headers.Authorization.replace('Bearer ', '');
      const [, jwtPayloadB64] = jwtToken.split('.');
      // Add padding if needed for base64url decoding
      const paddedPayload = jwtPayloadB64 + '=='.slice((2 - jwtPayloadB64.length * 3) & 3);
      const jwtPayload = JSON.parse(
        Buffer.from(paddedPayload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()
      );

      expect(jwtPayload.user.email).toBe('custom-approver@gov.uk');
      expect(jwtPayload.user.roles).toContain('Admin');
    });
  });
});
