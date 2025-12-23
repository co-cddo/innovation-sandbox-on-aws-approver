/**
 * Bedrock AI Email Analysis Service
 *
 * Invokes Amazon Bedrock (Nova Micro) for email pattern analysis.
 * Story 3.4: Bedrock AI Email Analysis with Circuit Breaker
 *
 * Features:
 * - Email analysis for group mailbox and local gov detection (FR12, FR13)
 * - 3 second timeout using AbortController (NFR-PERF-04)
 * - Circuit breaker integration (FR46)
 * - Rule-based fallback when unavailable (FR14)
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import type { AIAnalysisResult } from '../scoring/types.js';
import { CircuitBreaker, CircuitOpenError, type CircuitBreakerLogger } from '../lib/circuit-breaker.js';
import { analyzeEmailPattern, getMatchedGroupMailboxPrefix } from '../lib/email-analysis.js';

/**
 * Bedrock service configuration
 */
export interface BedrockServiceConfig {
  /** Bedrock model ID */
  modelId: string;
  /** Timeout in milliseconds for Bedrock calls */
  timeoutMs: number;
}

/**
 * Default Bedrock configuration per architecture
 */
export const DEFAULT_BEDROCK_CONFIG: BedrockServiceConfig = {
  modelId: 'amazon.nova-micro-v1:0',
  timeoutMs: 3000, // 3 seconds per NFR-PERF-04
};

/**
 * Result from Bedrock service including fallback information
 */
export interface BedrockAnalysisResult {
  /** AI analysis result */
  analysis: AIAnalysisResult;
  /** Whether fallback was used instead of Bedrock */
  usedFallback: boolean;
  /** Reason for fallback if used */
  fallbackReason?: string;
  /** Raw Bedrock response for debugging */
  rawResponse?: string;
}

/**
 * Raw response structure from Bedrock Nova Micro
 */
interface BedrockResponse {
  isGroupMailbox: boolean;
  confidence: 'high' | 'medium' | 'low';
  isLocalGovernment: boolean;
  reasoning?: string;
}

/**
 * Logger interface for Bedrock service
 */
export interface BedrockLogger extends CircuitBreakerLogger {
  error(message: string, attributes?: Record<string, unknown>): void;
}

/**
 * Bedrock email analysis service interface
 */
export interface BedrockService {
  /**
   * Analyze an email address for suspicious patterns.
   * Uses Bedrock AI with circuit breaker and rule-based fallback.
   *
   * @param email - Email address to analyze
   * @returns Analysis result with fallback status
   */
  analyzeEmail(email: string): Promise<BedrockAnalysisResult>;

  /**
   * Get current circuit breaker state (for testing/monitoring)
   */
  getCircuitState(): string;

  /**
   * Reset circuit breaker (for testing)
   */
  resetCircuitBreaker(): void;
}

/**
 * Build the analysis prompt for Bedrock
 */
const buildPrompt = (email: string): string => {
  return `Analyze this email address: ${email}

Determine:
1. Is this likely a group/shared mailbox? (team@, info@, contact@, admin@, etc.)
2. Does the domain appear to be UK local government?

Respond in JSON format only:
{
  "isGroupMailbox": boolean,
  "confidence": "high" | "medium" | "low",
  "isLocalGovernment": boolean,
  "reasoning": "brief explanation"
}`;
};

/**
 * Parse confidence string to numeric value
 */
const parseConfidence = (confidence: string): number => {
  switch (confidence.toLowerCase()) {
    case 'high':
      return 0.9;
    case 'medium':
      return 0.7;
    case 'low':
      return 0.5;
    default:
      return 0.5;
  }
};

/**
 * Parse Bedrock response to AIAnalysisResult
 */
const parseBedrockResponse = (responseText: string): AIAnalysisResult => {
  // Try to extract JSON from the response (handle markdown code blocks)
  let jsonText = responseText;

  // Remove markdown code blocks if present
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonText = jsonMatch[1].trim();
  }

  // Try to find JSON object in the response
  const objectMatch = jsonText.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    jsonText = objectMatch[0];
  }

  const parsed = JSON.parse(jsonText) as BedrockResponse;

  // Validate required fields
  if (typeof parsed.isGroupMailbox !== 'boolean') {
    throw new Error('Invalid response: missing isGroupMailbox boolean');
  }

  return {
    isGroupMailbox: parsed.isGroupMailbox,
    isOutsideTargetAudience: parsed.isLocalGovernment === false,
    confidence: parseConfidence(parsed.confidence ?? 'low'),
  };
};

/**
 * Creates a Bedrock email analysis service with circuit breaker and fallback.
 *
 * @param client - BedrockRuntimeClient (injected for testability)
 * @param config - Service configuration
 * @param logger - Optional logger for diagnostics
 * @returns Bedrock service
 */
export const createBedrockService = (
  client: BedrockRuntimeClient,
  config: Partial<BedrockServiceConfig> = {},
  logger?: BedrockLogger
): BedrockService => {
  const fullConfig: BedrockServiceConfig = { ...DEFAULT_BEDROCK_CONFIG, ...config };

  // Create circuit breaker for Bedrock calls
  const circuitBreaker = new CircuitBreaker(
    {
      name: 'bedrock',
      failureThreshold: parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || '3', 10),
      recoveryTimeoutMs: parseInt(process.env.CIRCUIT_BREAKER_RECOVERY_MS || '60000', 10),
    },
    logger
  );

  /**
   * Invoke Bedrock with timeout using AbortController
   */
  const invokeBedrockWithTimeout = async (email: string): Promise<string> => {
    const controller = new globalThis.AbortController();
    const timeoutId = setTimeout(() => controller.abort(), fullConfig.timeoutMs);

    try {
      const prompt = buildPrompt(email);

      const command = new InvokeModelCommand({
        modelId: fullConfig.modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          messages: [
            {
              role: 'user',
              content: [{ text: prompt }],
            },
          ],
          inferenceConfig: {
            maxTokens: 256,
            temperature: 0.1, // Low temperature for consistent output
          },
        }),
      });

      const response = await client.send(command, {
        abortSignal: controller.signal,
      });

      if (!response.body) {
        throw new Error('No response body from Bedrock');
      }

      // Parse the response body
      const responseBody = JSON.parse(new globalThis.TextDecoder().decode(response.body)) as {
        output?: { message?: { content?: Array<{ text?: string }> } };
      };

      const text = responseBody.output?.message?.content?.[0]?.text;
      if (!text) {
        throw new Error('No text content in Bedrock response');
      }

      return text;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  /**
   * Analyze email with circuit breaker and fallback
   */
  const analyzeEmail = async (email: string): Promise<BedrockAnalysisResult> => {
    try {
      // Execute through circuit breaker
      const responseText = await circuitBreaker.execute(() => invokeBedrockWithTimeout(email));

      // Parse the response
      const analysis = parseBedrockResponse(responseText);

      logger?.info('Bedrock email analysis completed', {
        email,
        isGroupMailbox: analysis.isGroupMailbox,
        isOutsideTargetAudience: analysis.isOutsideTargetAudience,
        confidence: analysis.confidence,
      });

      return {
        analysis,
        usedFallback: false,
        rawResponse: responseText,
      };
    } catch (error) {
      // Determine fallback reason
      let fallbackReason: string;

      if (error instanceof CircuitOpenError) {
        fallbackReason = `Circuit breaker open: ${error.message}`;
        logger?.warn('Using fallback - circuit breaker open', {
          email,
          circuitName: error.circuitName,
          timeUntilRecoveryMs: error.timeUntilRecoveryMs,
        });
      } else if (error instanceof Error && error.name === 'AbortError') {
        fallbackReason = 'Bedrock timeout (3s)';
        logger?.warn('Using fallback - Bedrock timeout', {
          email,
          timeoutMs: fullConfig.timeoutMs,
        });
      } else {
        fallbackReason = error instanceof Error ? error.message : String(error);
        logger?.error('Using fallback - Bedrock error', {
          email,
          error: fallbackReason,
        });
      }

      // Use rule-based fallback
      const analysis = analyzeEmailPattern(email);
      const matchedPrefix = getMatchedGroupMailboxPrefix(email);

      logger?.info('Fallback email analysis completed', {
        email,
        isGroupMailbox: analysis.isGroupMailbox,
        matchedPrefix,
        fallbackReason,
      });

      return {
        analysis,
        usedFallback: true,
        fallbackReason,
      };
    }
  };

  return {
    analyzeEmail,
    getCircuitState: () => circuitBreaker.getState(),
    resetCircuitBreaker: () => circuitBreaker.reset(),
  };
};
