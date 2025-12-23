/**
 * Bedrock Service Unit Tests
 *
 * Tests for Bedrock AI email analysis service.
 * Story 3.4: AC1, AC4 - Bedrock invocation and timeout handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import {
  createBedrockService,
  type BedrockService,
  DEFAULT_BEDROCK_CONFIG,
} from '../../src/services/bedrock.js';

// Mock the BedrockRuntimeClient
const mockSend = vi.fn();
const mockBedrockClient = {
  send: mockSend,
} as unknown as BedrockRuntimeClient;

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('BedrockService', () => {
  let service: BedrockService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createBedrockService(mockBedrockClient, {}, mockLogger);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    service.resetCircuitBreaker();
  });

  describe('analyzeEmail - successful invocation (AC1)', () => {
    it('should invoke Bedrock and parse JSON response', async () => {
      const bedrockResponse = {
        isGroupMailbox: true,
        confidence: 'high',
        isLocalGovernment: true,
        reasoning: 'Email starts with team@ prefix',
      };

      mockSend.mockResolvedValueOnce({
        body: new globalThis.TextEncoder().encode(
          JSON.stringify({
            output: {
              message: {
                content: [{ text: JSON.stringify(bedrockResponse) }],
              },
            },
          })
        ),
      });

      const result = await service.analyzeEmail('team@council.gov.uk');

      expect(result.usedFallback).toBe(false);
      expect(result.analysis.isGroupMailbox).toBe(true);
      expect(result.analysis.confidence).toBe(0.9); // high = 0.9
      expect(result.analysis.isOutsideTargetAudience).toBe(false); // isLocalGovernment: true
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Bedrock email analysis completed',
        expect.objectContaining({
          email: 'team@council.gov.uk',
          isGroupMailbox: true,
        })
      );
    });

    it('should parse response with markdown code blocks', async () => {
      const responseText = '```json\n{"isGroupMailbox": false, "confidence": "medium", "isLocalGovernment": true}\n```';

      mockSend.mockResolvedValueOnce({
        body: new globalThis.TextEncoder().encode(
          JSON.stringify({
            output: {
              message: {
                content: [{ text: responseText }],
              },
            },
          })
        ),
      });

      const result = await service.analyzeEmail('john.smith@council.gov.uk');

      expect(result.usedFallback).toBe(false);
      expect(result.analysis.isGroupMailbox).toBe(false);
      expect(result.analysis.confidence).toBe(0.7); // medium = 0.7
    });

    it('should handle response with surrounding text', async () => {
      const responseText = 'Here is my analysis:\n\n{"isGroupMailbox": true, "confidence": "low", "isLocalGovernment": false}\n\nLet me know if you need more info.';

      mockSend.mockResolvedValueOnce({
        body: new globalThis.TextEncoder().encode(
          JSON.stringify({
            output: {
              message: {
                content: [{ text: responseText }],
              },
            },
          })
        ),
      });

      const result = await service.analyzeEmail('info@gmail.com');

      expect(result.usedFallback).toBe(false);
      expect(result.analysis.isGroupMailbox).toBe(true);
      expect(result.analysis.isOutsideTargetAudience).toBe(true); // isLocalGovernment: false
    });

    it('should detect outside target audience when not local government', async () => {
      mockSend.mockResolvedValueOnce({
        body: new globalThis.TextEncoder().encode(
          JSON.stringify({
            output: {
              message: {
                content: [{ text: '{"isGroupMailbox": false, "confidence": "high", "isLocalGovernment": false}' }],
              },
            },
          })
        ),
      });

      const result = await service.analyzeEmail('user@company.com');

      expect(result.analysis.isOutsideTargetAudience).toBe(true);
    });
  });

  describe('analyzeEmail - timeout handling (AC4)', () => {
    it('should use fallback on timeout', async () => {
      // Simulate a timeout by not resolving
      mockSend.mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => {
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            }, 10);
          })
      );

      const result = await service.analyzeEmail('team@council.gov.uk');

      expect(result.usedFallback).toBe(true);
      expect(result.fallbackReason).toContain('timeout');
      expect(result.analysis.isGroupMailbox).toBe(true); // Rule-based detects 'team' prefix
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Using fallback - Bedrock timeout',
        expect.objectContaining({
          email: 'team@council.gov.uk',
        })
      );
    });
  });

  describe('analyzeEmail - error handling', () => {
    it('should use fallback on Bedrock error', async () => {
      mockSend.mockRejectedValueOnce(new Error('Bedrock service error'));

      const result = await service.analyzeEmail('info@council.gov.uk');

      expect(result.usedFallback).toBe(true);
      expect(result.fallbackReason).toBe('Bedrock service error');
      expect(result.analysis.isGroupMailbox).toBe(true); // Rule-based detects 'info' prefix
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Using fallback - Bedrock error',
        expect.objectContaining({
          email: 'info@council.gov.uk',
          error: 'Bedrock service error',
        })
      );
    });

    it('should use fallback on malformed JSON response', async () => {
      mockSend.mockResolvedValueOnce({
        body: new globalThis.TextEncoder().encode(
          JSON.stringify({
            output: {
              message: {
                content: [{ text: 'not valid json' }],
              },
            },
          })
        ),
      });

      const result = await service.analyzeEmail('user@council.gov.uk');

      expect(result.usedFallback).toBe(true);
      expect(result.fallbackReason).toContain('Unexpected token');
    });

    it('should use fallback on missing isGroupMailbox field', async () => {
      mockSend.mockResolvedValueOnce({
        body: new globalThis.TextEncoder().encode(
          JSON.stringify({
            output: {
              message: {
                content: [{ text: '{"confidence": "high", "isLocalGovernment": true}' }],
              },
            },
          })
        ),
      });

      const result = await service.analyzeEmail('user@council.gov.uk');

      expect(result.usedFallback).toBe(true);
      expect(result.fallbackReason).toContain('missing isGroupMailbox');
    });

    it('should use fallback on missing response body', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await service.analyzeEmail('user@council.gov.uk');

      expect(result.usedFallback).toBe(true);
      expect(result.fallbackReason).toContain('No response body');
    });

    it('should use fallback on missing text content', async () => {
      mockSend.mockResolvedValueOnce({
        body: new globalThis.TextEncoder().encode(
          JSON.stringify({
            output: {
              message: {
                content: [],
              },
            },
          })
        ),
      });

      const result = await service.analyzeEmail('user@council.gov.uk');

      expect(result.usedFallback).toBe(true);
      expect(result.fallbackReason).toContain('No text content');
    });

    it('should handle missing isLocalGovernment field (pessimistic)', async () => {
      // When isLocalGovernment is undefined, we assume they ARE local gov (pessimistic approach)
      // isOutsideTargetAudience = (undefined === false) = false
      mockSend.mockResolvedValueOnce({
        body: new globalThis.TextEncoder().encode(
          JSON.stringify({
            output: {
              message: {
                content: [{ text: '{"isGroupMailbox": false, "confidence": "high"}' }],
              },
            },
          })
        ),
      });

      const result = await service.analyzeEmail('user@council.gov.uk');

      // Should NOT use fallback - isLocalGovernment is optional
      expect(result.usedFallback).toBe(false);
      // Pessimistic: undefined !== false, so isOutsideTargetAudience = false (assume they're local gov)
      expect(result.analysis.isOutsideTargetAudience).toBe(false);
    });
  });

  describe('circuit breaker integration (AC5)', () => {
    it('should open circuit after 3 consecutive failures', async () => {
      mockSend.mockRejectedValue(new Error('Bedrock unavailable'));

      // First 3 calls should hit Bedrock
      for (let i = 0; i < 3; i++) {
        const result = await service.analyzeEmail('user@council.gov.uk');
        expect(result.usedFallback).toBe(true);
      }

      expect(mockSend).toHaveBeenCalledTimes(3);

      // Next call should use fallback due to open circuit
      const result = await service.analyzeEmail('team@council.gov.uk');
      expect(result.usedFallback).toBe(true);
      expect(result.fallbackReason).toContain('Circuit breaker open');
      expect(mockSend).toHaveBeenCalledTimes(3); // No additional calls

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Using fallback - circuit breaker open',
        expect.objectContaining({
          circuitName: 'bedrock',
        })
      );
    });

    it('should not open circuit on successful calls', async () => {
      const successResponse = {
        body: new globalThis.TextEncoder().encode(
          JSON.stringify({
            output: {
              message: {
                content: [{ text: '{"isGroupMailbox": false, "confidence": "high", "isLocalGovernment": true}' }],
              },
            },
          })
        ),
      };

      mockSend.mockResolvedValue(successResponse);

      for (let i = 0; i < 5; i++) {
        const result = await service.analyzeEmail('user@council.gov.uk');
        expect(result.usedFallback).toBe(false);
      }

      expect(mockSend).toHaveBeenCalledTimes(5);
      expect(service.getCircuitState()).toBe('CLOSED');
    });

    it('should reset failure count on success', async () => {
      // 2 failures
      mockSend.mockRejectedValueOnce(new Error('fail'));
      mockSend.mockRejectedValueOnce(new Error('fail'));

      await service.analyzeEmail('user@council.gov.uk');
      await service.analyzeEmail('user@council.gov.uk');

      // 1 success - should reset
      mockSend.mockResolvedValueOnce({
        body: new globalThis.TextEncoder().encode(
          JSON.stringify({
            output: {
              message: {
                content: [{ text: '{"isGroupMailbox": false, "confidence": "high", "isLocalGovernment": true}' }],
              },
            },
          })
        ),
      });
      const successResult = await service.analyzeEmail('user@council.gov.uk');
      expect(successResult.usedFallback).toBe(false);

      // 2 more failures - circuit should still be closed (not at threshold)
      mockSend.mockRejectedValueOnce(new Error('fail'));
      mockSend.mockRejectedValueOnce(new Error('fail'));

      await service.analyzeEmail('user@council.gov.uk');
      await service.analyzeEmail('user@council.gov.uk');

      expect(service.getCircuitState()).toBe('CLOSED');
    });
  });

  describe('getCircuitState', () => {
    it('should return current circuit state', () => {
      expect(service.getCircuitState()).toBe('CLOSED');
    });
  });

  describe('resetCircuitBreaker', () => {
    it('should reset circuit to closed state', async () => {
      mockSend.mockRejectedValue(new Error('fail'));

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        await service.analyzeEmail('user@council.gov.uk');
      }

      expect(service.getCircuitState()).toBe('OPEN');

      service.resetCircuitBreaker();

      expect(service.getCircuitState()).toBe('CLOSED');
    });
  });

  describe('DEFAULT_BEDROCK_CONFIG', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_BEDROCK_CONFIG.modelId).toBe('amazon.nova-micro-v1:0');
      expect(DEFAULT_BEDROCK_CONFIG.timeoutMs).toBe(3000);
    });
  });

  describe('confidence parsing', () => {
    it('should parse high confidence as 0.9', async () => {
      mockSend.mockResolvedValueOnce({
        body: new globalThis.TextEncoder().encode(
          JSON.stringify({
            output: {
              message: {
                content: [{ text: '{"isGroupMailbox": true, "confidence": "high", "isLocalGovernment": true}' }],
              },
            },
          })
        ),
      });

      const result = await service.analyzeEmail('team@council.gov.uk');
      expect(result.analysis.confidence).toBe(0.9);
    });

    it('should parse medium confidence as 0.7', async () => {
      mockSend.mockResolvedValueOnce({
        body: new globalThis.TextEncoder().encode(
          JSON.stringify({
            output: {
              message: {
                content: [{ text: '{"isGroupMailbox": true, "confidence": "medium", "isLocalGovernment": true}' }],
              },
            },
          })
        ),
      });

      const result = await service.analyzeEmail('team@council.gov.uk');
      expect(result.analysis.confidence).toBe(0.7);
    });

    it('should parse low confidence as 0.5', async () => {
      mockSend.mockResolvedValueOnce({
        body: new globalThis.TextEncoder().encode(
          JSON.stringify({
            output: {
              message: {
                content: [{ text: '{"isGroupMailbox": true, "confidence": "low", "isLocalGovernment": true}' }],
              },
            },
          })
        ),
      });

      const result = await service.analyzeEmail('team@council.gov.uk');
      expect(result.analysis.confidence).toBe(0.5);
    });

    it('should default to 0.5 for unknown confidence', async () => {
      mockSend.mockResolvedValueOnce({
        body: new globalThis.TextEncoder().encode(
          JSON.stringify({
            output: {
              message: {
                content: [{ text: '{"isGroupMailbox": true, "confidence": "unknown", "isLocalGovernment": true}' }],
              },
            },
          })
        ),
      });

      const result = await service.analyzeEmail('team@council.gov.uk');
      expect(result.analysis.confidence).toBe(0.5);
    });
  });
});
