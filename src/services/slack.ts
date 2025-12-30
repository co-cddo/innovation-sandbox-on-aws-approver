/**
 * Slack Service for Workflow Webhook Notifications (Story 5.2)
 *
 * Provides one-way notification capabilities for escalated lease requests.
 * Uses Slack Workflow Webhooks (not incoming webhooks) for integration.
 *
 * @see FR37 - Slack notification on escalation
 * @see FR38 - Score breakdown in Slack
 * @see FR42 - Pending review queue summary
 */

import type { SQSService } from './sqs.js';
import type { ScoreBreakdown } from '../scoring/types.js';
import type { CapacityCrunchAlert } from '../lib/capacity-crunch.js';

/**
 * Payload format for Slack Workflow Webhook.
 * All values are strings - Slack Workflow handles formatting.
 */
export interface SlackNotificationPayload {
  /** Requester's email address */
  user_email: string;
  /** UUID of the lease */
  lease_id: string;
  /** Reference number in ISB-YYYY-NNNN format */
  reference: string;
  /** Numeric score as string */
  score: string;
  /** Auto-approve threshold as string */
  threshold: string;
  /** Requested template name */
  template_id: string;
  /** Multi-line score breakdown with bullet points */
  score_breakdown: string;
  /** Full ISB console deep link URL */
  console_url: string;
  /** Number of pending reviews as string */
  queue_depth: string;
}

/**
 * Parameters for escalation notification.
 */
export interface EscalationNotificationParams {
  /** Lease UUID */
  leaseId: string;
  /** Requester's email */
  userEmail: string;
  /** Risk score */
  score: number;
  /** Score breakdown object */
  scoreBreakdown: ScoreBreakdown;
  /** Requested template ID */
  templateId: string;
  /** Reference number */
  referenceNumber: string;
}

/**
 * Result from sending a Slack notification.
 */
export interface SlackNotificationResult {
  success: boolean;
  error?: string;
  statusCode?: number;
}

/**
 * Slack service interface.
 */
export interface SlackService {
  /**
   * Sends a notification for an escalated lease request.
   */
  notifyEscalation(params: EscalationNotificationParams): Promise<SlackNotificationResult>;

  /**
   * Sends a capacity crunch alert notification (Story 6.4).
   */
  notifyCapacityCrunch(alert: CapacityCrunchAlert): Promise<SlackNotificationResult>;
}

/**
 * Logger interface for Slack service.
 */
export interface SlackLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Default auto-approve threshold.
 */
const DEFAULT_THRESHOLD = 20;

/**
 * Timeout for Slack webhook requests in milliseconds.
 */
const WEBHOOK_TIMEOUT_MS = 3000;

/**
 * Formats score breakdown for Slack display.
 * Uses bullet points (•) and newlines, sorted by absolute contribution.
 *
 * @param breakdown - Score breakdown object mapping rule names to points
 * @returns Formatted string for Slack
 */
export const formatScoreBreakdownForSlack = (breakdown: ScoreBreakdown): string => {
  const entries = Object.entries(breakdown)
    .filter(([, value]) => value !== 0)
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a));

  if (entries.length === 0) {
    return '• No rules triggered';
  }

  return entries
    .map(([rule, value]) => {
      const sign = value >= 0 ? '+' : '';
      return `• ${rule}: ${sign}${value}`;
    })
    .join('\n');
};

/**
 * Encodes lease composite key for console URL.
 * Creates base64-encoded JSON containing userEmail and uuid.
 *
 * @param userEmail - User's email address
 * @param uuid - Lease UUID
 * @returns Base64-encoded JSON string
 */
export const encodeLeaseCompositeKey = (userEmail: string, uuid: string): string => {
  const json = JSON.stringify({ userEmail, uuid });
  return Buffer.from(json, 'utf8').toString('base64');
};

/**
 * Builds the Slack notification payload.
 *
 * @param params - Escalation notification parameters
 * @param isbConsoleUrl - Base URL for ISB console
 * @param queueDepth - Approximate number of pending requests
 * @param threshold - Auto-approve threshold
 * @returns SlackNotificationPayload
 */
export const buildSlackPayload = (
  params: EscalationNotificationParams,
  isbConsoleUrl: string,
  queueDepth: number,
  threshold: number = DEFAULT_THRESHOLD
): SlackNotificationPayload => {
  return {
    user_email: params.userEmail,
    lease_id: params.leaseId,
    reference: params.referenceNumber,
    score: String(params.score),
    threshold: String(threshold),
    template_id: params.templateId,
    score_breakdown: formatScoreBreakdownForSlack(params.scoreBreakdown),
    console_url: `${isbConsoleUrl}/leases/edit/${encodeLeaseCompositeKey(params.userEmail, params.leaseId)}`,
    queue_depth: String(queueDepth),
  };
};

/**
 * Creates a Slack service for webhook notifications.
 *
 * @param webhookUrl - Slack Workflow Webhook URL
 * @param isbConsoleUrl - Base URL for ISB console
 * @param sqsService - SQS service for queue depth
 * @param logger - Optional logger
 * @param threshold - Auto-approve threshold (default: 20)
 * @returns SlackService
 */
export const createSlackService = (
  webhookUrl: string,
  isbConsoleUrl: string,
  sqsService: SQSService,
  logger?: SlackLogger,
  threshold: number = DEFAULT_THRESHOLD
): SlackService => {
  const noOpLogger: SlackLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
  const log = logger ?? noOpLogger;

  return {
    async notifyEscalation(
      params: EscalationNotificationParams
    ): Promise<SlackNotificationResult> {
      try {
        // Get queue depth for the notification
        const queueDepthResult = await sqsService.getQueueDepth();
        const queueDepth = queueDepthResult.success
          ? (queueDepthResult.approximateNumberOfMessages ?? 0)
          : 0;

        if (!queueDepthResult.success) {
          log.warn('Failed to get queue depth for Slack notification, using 0', {
            error: queueDepthResult.error,
            leaseId: params.leaseId,
          });
        }

        // Build payload
        const payload = buildSlackPayload(params, isbConsoleUrl, queueDepth, threshold);

        log.info('Sending Slack escalation notification', {
          leaseId: params.leaseId,
          userEmail: params.userEmail,
          score: params.score,
          queueDepth,
        });

        // Send webhook request with timeout
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unable to read response');
          log.error('Slack webhook returned error response', {
            leaseId: params.leaseId,
            statusCode: response.status,
            statusText: response.statusText,
            responseBody: errorText,
          });

          return {
            success: false,
            error: `Slack webhook error: ${response.status} ${response.statusText}`,
            statusCode: response.status,
          };
        }

        log.info('Slack escalation notification sent successfully', {
          leaseId: params.leaseId,
          userEmail: params.userEmail,
          statusCode: response.status,
        });

        return { success: true, statusCode: response.status };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isTimeout =
          error instanceof Error && error.name === 'TimeoutError';

        log.error('Failed to send Slack notification', {
          leaseId: params.leaseId,
          userEmail: params.userEmail,
          error: errorMessage,
          isTimeout,
        });

        return {
          success: false,
          error: isTimeout
            ? `Slack webhook timeout after ${WEBHOOK_TIMEOUT_MS}ms`
            : `Slack webhook error: ${errorMessage}`,
        };
      }
    },

    async notifyCapacityCrunch(
      alert: CapacityCrunchAlert
    ): Promise<SlackNotificationResult> {
      try {
        log.info('Sending Slack capacity crunch alert', {
          activeAccounts: alert.activeAccounts,
          pendingRequests: alert.pendingRequests,
          soonestAvailableHours: alert.soonestAvailableHours,
        });

        // Build payload - using snake_case for Slack Workflow compatibility
        const payload = {
          alert_type: alert.alertType,
          active_accounts: String(alert.activeAccounts),
          available_accounts: String(alert.availableAccounts),
          pending_requests: String(alert.pendingRequests),
          soonest_available_hours: alert.soonestAvailableHours !== null
            ? String(alert.soonestAvailableHours)
            : 'unknown',
          message: alert.message,
        };

        // Send webhook request with timeout
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unable to read response');
          log.error('Slack webhook returned error for capacity crunch alert', {
            statusCode: response.status,
            statusText: response.statusText,
            responseBody: errorText,
          });

          return {
            success: false,
            error: `Slack webhook error: ${response.status} ${response.statusText}`,
            statusCode: response.status,
          };
        }

        log.info('Slack capacity crunch alert sent successfully', {
          statusCode: response.status,
        });

        return { success: true, statusCode: response.status };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isTimeout =
          error instanceof Error && error.name === 'TimeoutError';

        log.error('Failed to send Slack capacity crunch alert', {
          error: errorMessage,
          isTimeout,
        });

        return {
          success: false,
          error: isTimeout
            ? `Slack webhook timeout after ${WEBHOOK_TIMEOUT_MS}ms`
            : `Slack webhook error: ${errorMessage}`,
        };
      }
    },
  };
};
