/**
 * Secrets Manager Utilities (Story 5.2)
 *
 * Provides cached access to secrets via AWS Lambda Powertools.
 * Secrets are cached with configurable TTL to minimize API calls.
 *
 * @see FR37 - Slack webhook URL from Secrets Manager
 */

import { getSecret } from '@aws-lambda-powertools/parameters/secrets';

/**
 * Default cache TTL in seconds (5 minutes).
 */
const DEFAULT_CACHE_TTL_SECONDS = 300;

/**
 * Secret name for Slack webhook URL.
 */
const SLACK_WEBHOOK_SECRET_NAME = '/approver/slack-webhook-url';

/**
 * Result from retrieving the Slack webhook URL.
 */
export interface SlackWebhookResult {
  success: boolean;
  webhookUrl?: string;
  error?: string;
}

/**
 * Retrieves the Slack webhook URL from Secrets Manager.
 * Results are cached with a 5-minute TTL to minimize API calls.
 *
 * @param secretName - Override secret name (for testing)
 * @param maxAge - Cache TTL in seconds (default: 300)
 * @returns SlackWebhookResult
 */
export const getSlackWebhookUrl = async (
  secretName: string = SLACK_WEBHOOK_SECRET_NAME,
  maxAge: number = DEFAULT_CACHE_TTL_SECONDS
): Promise<SlackWebhookResult> => {
  try {
    const webhookUrl = await getSecret(secretName, {
      maxAge,
    });

    if (!webhookUrl || typeof webhookUrl !== 'string') {
      return {
        success: false,
        error: 'Slack webhook URL secret is empty or invalid',
      };
    }

    // Validate URL format
    if (!webhookUrl.startsWith('https://hooks.slack.com/')) {
      return {
        success: false,
        error: 'Slack webhook URL has invalid format',
      };
    }

    return {
      success: true,
      webhookUrl,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to retrieve Slack webhook URL: ${errorMessage}`,
    };
  }
};
