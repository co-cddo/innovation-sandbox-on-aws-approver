/**
 * SNS Notification Service for Approval Notifications (Story 7.1.1)
 *
 * Publishes escalation notifications to SNS Topic for Amazon Q Developer Slack integration.
 * Uses Amazon Q Developer custom notification format for rich Slack messages.
 *
 * @see Story 7.1.1 - Integrate SNS Topic into ApproverStack
 * @see https://docs.aws.amazon.com/chatbot/latest/adminguide/custom-notifs.html
 */

import type { ScoreBreakdown } from '../scoring/types.js';
import { encodeLeaseCompositeKey } from '../lib/lease-id-codec.js';

// Re-export for backwards compatibility (Issue 4 - consolidated in lease-id-codec)
export { encodeLeaseCompositeKey };

/**
 * Logger interface for SNS notification service.
 */
export interface SNSNotificationLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Parameters for escalation notification via SNS.
 */
export interface SNSEscalationParams {
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
  /** Template display name (Story 7.1.3) */
  templateName?: string;
  /** Lease duration in hours (Story 7.1.3) */
  leaseDurationHours?: number;
  /** Budget amount in GBP (Story 7.1.3) */
  budgetAmount?: number;
  /** Reference number (ISB-YYYY-NNNN format) */
  referenceNumber: string;
  /** Auto-approve threshold */
  threshold: number;
  /** Number of pending reviews */
  queueDepth: number;
  /** Requester comment (Story 7.1.3) */
  comment?: string;
}

/**
 * Amazon Q Developer custom notification format.
 * @see https://docs.aws.amazon.com/chatbot/latest/adminguide/custom-notifs.html
 */
export interface AmazonQNotification {
  version: '1.0';
  source: 'custom';
  id: string;
  content: {
    textType: 'client-markdown';
    title: string;
    description: string;
    nextSteps?: string[];
    keywords?: string[];
  };
  metadata: {
    threadId: string;
    summary: string;
    /** Must be true for approve/deny custom action buttons in Slack */
    enableCustomActions: boolean;
    additionalContext?: Record<string, string>;
  };
}

/**
 * Result from sending an SNS notification.
 */
export interface SNSNotificationResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * SNS service interface (abstracted for testing).
 */
export interface SNSClient {
  publish(topicArn: string, message: string): Promise<{ messageId?: string }>;
}

/**
 * SNS notification service interface.
 */
export interface SNSNotificationService {
  /**
   * Sends an escalation notification via SNS to Amazon Q Developer.
   */
  notifyEscalation(params: SNSEscalationParams): Promise<SNSNotificationResult>;
}

/**
 * Risk highlighting threshold - factors contributing more than this are highlighted.
 * Story 7.1.3 AC#2: Highlight risk factors (>5 points)
 */
const RISK_HIGHLIGHT_THRESHOLD = 5;

/**
 * Formats a date as UK-friendly string (e.g., "20 Jan 2026 at 14:30")
 * Story 7.1.3 AC#1: Add timestamp to notification
 *
 * Note: Uses UTC time for consistency across all environments. During BST,
 * displayed time will be 1 hour behind UK local time. This is intentional
 * for audit trail consistency - consider Intl.DateTimeFormat with Europe/London
 * if local time display is required in future.
 *
 * @param date - Date to format
 * @returns UK-friendly formatted date string (UTC)
 */
export const formatTimestamp = (date: Date = new Date()): string => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = date.getUTCDate();
  const month = months[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  return `${day} ${month} ${year} at ${hours}:${minutes}`;
};

/**
 * Formats score breakdown for display in notification.
 * Uses bullet points (•) and newlines, sorted by absolute contribution.
 * High-risk factors (>5 points absolute value) are highlighted with bold.
 *
 * @param breakdown - Score breakdown object mapping rule names to points
 * @returns Formatted string for display
 */
export const formatScoreBreakdown = (breakdown: ScoreBreakdown): string => {
  const entries = Object.entries(breakdown)
    .filter(([, value]) => value !== 0)
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a));

  if (entries.length === 0) {
    return '• No rules triggered';
  }

  return entries
    .map(([rule, value]) => {
      const sign = value >= 0 ? '+' : '';
      const text = `${rule}: ${sign}${value}`;
      // Highlight high-risk factors (>5 points absolute value) - Story 7.1.3 AC#2
      // Note: Slack mrkdwn uses *text* for bold (not **text**)
      if (Math.abs(value) > RISK_HIGHLIGHT_THRESHOLD) {
        return `• *${text}*`;
      }
      return `• ${text}`;
    })
    .join('\n');
};

/**
 * Checks if any score factor exceeds the risk threshold.
 * Used to determine whether to use "Risk Factors" vs "Score Breakdown" header.
 *
 * @param breakdown - Score breakdown object
 * @returns true if any factor exceeds the risk threshold
 */
export const hasHighRiskFactors = (breakdown: ScoreBreakdown): boolean => {
  return Object.values(breakdown).some(
    (value) => Math.abs(value) > RISK_HIGHLIGHT_THRESHOLD
  );
};

/**
 * Formats template line with name, duration, and budget.
 * Format: "Template Name (48h, £50)" or falls back to templateId only
 *
 * @param templateId - Template identifier
 * @param templateName - Optional display name
 * @param durationHours - Optional duration in hours
 * @param budgetAmount - Optional budget in GBP
 * @returns Formatted template string
 */
export const formatTemplateLine = (
  templateId: string,
  templateName?: string,
  durationHours?: number,
  budgetAmount?: number
): string => {
  const name = templateName ?? templateId;
  const details: string[] = [];

  if (durationHours !== undefined && durationHours > 0) {
    details.push(`${durationHours}h`);
  }
  if (budgetAmount !== undefined && budgetAmount > 0) {
    details.push(`£${budgetAmount}`);
  }

  if (details.length > 0) {
    return `${name} (${details.join(', ')})`;
  }
  return name;
};

/**
 * Builds the Amazon Q Developer notification payload.
 *
 * @param params - Escalation notification parameters
 * @param isbConsoleUrl - Base URL for ISB console
 * @returns AmazonQNotification payload
 */
export const buildAmazonQNotification = (
  params: SNSEscalationParams,
  isbConsoleUrl: string
): AmazonQNotification => {
  const compositeKey = encodeLeaseCompositeKey(params.userEmail, params.leaseId);
  const consoleUrl = `${isbConsoleUrl}/leases/edit/${compositeKey}`;
  const scoreBreakdownText = formatScoreBreakdown(params.scoreBreakdown);

  // Current time for context (used in additionalContext)
  const now = new Date();

  // Determine header based on risk level (Story 7.1.3 AC#2)
  // Note: Slack mrkdwn uses *text* for bold (not **text**)
  const scoreHeader = hasHighRiskFactors(params.scoreBreakdown)
    ? '*Risk Factors:*'
    : '*Score Breakdown:*';

  // Format template line with name, duration, and budget (Story 7.1.3)
  const templateLine = formatTemplateLine(
    params.templateId,
    params.templateName,
    params.leaseDurationHours,
    params.budgetAmount
  );

  // Format comment with blockquote or fallback (Story 7.1.3 AC#4)
  const commentText = params.comment && params.comment.trim()
    ? `> "${params.comment}"`
    : 'No comment provided';

  // Build markdown description
  // Note: Slack mrkdwn uses *text* for bold (not **text**)
  const description = [
    `*User:* ${params.userEmail}`,
    `*Template:* ${templateLine}`,
    '',
    `*Score:* ${params.score} (threshold: ${params.threshold})`,
    '',
    scoreHeader,
    scoreBreakdownText,
    '',
    '*Comment:*',
    commentText,
    '',
    `<${consoleUrl}|View in Innovation Sandbox>`,
  ].join('\n');

  // Build additional context for action buttons (Story 7.1.3 - include template details)
  const additionalContext: Record<string, string> = {
    leaseId: compositeKey,
    userEmail: params.userEmail,
    score: String(params.score),
    threshold: String(params.threshold),
    templateId: params.templateId,
    reference: params.referenceNumber,
    queueDepth: String(params.queueDepth),
  };

  // Add optional template details to context (Story 7.1.3)
  if (params.templateName) {
    additionalContext.templateName = params.templateName;
  }
  if (params.leaseDurationHours !== undefined) {
    additionalContext.leaseDurationHours = String(params.leaseDurationHours);
  }
  if (params.budgetAmount !== undefined) {
    additionalContext.budgetAmount = String(params.budgetAmount);
  }

  // Add timestamp for thread correlation (Story 7.1.3)
  additionalContext.timestamp = now.toISOString();

  return {
    version: '1.0',
    source: 'custom',
    id: `lease-${params.leaseId}`,
    content: {
      textType: 'client-markdown',
      title: `:warning: Lease Review Required`,
      description,
    },
    metadata: {
      threadId: params.leaseId,
      summary: `Lease review for ${params.userEmail}`,
      enableCustomActions: true, // Required for approve/deny buttons in Slack
      additionalContext,
    },
  };
};

/**
 * Creates an SNS notification service for approval notifications.
 *
 * @param snsClient - SNS client instance
 * @param topicArn - SNS topic ARN
 * @param isbConsoleUrl - Base URL for ISB console
 * @param logger - Optional logger
 * @returns SNSNotificationService
 */
export const createSNSNotificationService = (
  snsClient: SNSClient,
  topicArn: string,
  isbConsoleUrl: string,
  logger?: SNSNotificationLogger
): SNSNotificationService => {
  const noOpLogger: SNSNotificationLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
  const log = logger ?? noOpLogger;

  return {
    async notifyEscalation(params: SNSEscalationParams): Promise<SNSNotificationResult> {
      try {
        // Build Amazon Q Developer notification payload
        const notification = buildAmazonQNotification(params, isbConsoleUrl);

        log.info('Sending SNS escalation notification', {
          leaseId: params.leaseId,
          userEmail: params.userEmail,
          score: params.score,
          queueDepth: params.queueDepth,
        });

        // Publish to SNS topic
        const result = await snsClient.publish(topicArn, JSON.stringify(notification));

        log.info('SNS escalation notification sent successfully', {
          leaseId: params.leaseId,
          messageId: result.messageId,
        });

        return {
          success: true,
          messageId: result.messageId,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        log.error('Failed to send SNS escalation notification', {
          leaseId: params.leaseId,
          userEmail: params.userEmail,
          error: errorMessage,
        });

        return {
          success: false,
          error: `SNS publish error: ${errorMessage}`,
        };
      }
    },
  };
};
