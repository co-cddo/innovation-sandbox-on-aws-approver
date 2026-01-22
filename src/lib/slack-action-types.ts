/**
 * Amazon Q Developer Custom Action Types (Story 7.2.1)
 *
 * Type definitions for the payload format used when an operator clicks
 * a custom action button (Approve/Deny) in Slack via Amazon Q Developer.
 *
 * @see https://docs.aws.amazon.com/chatbot/latest/adminguide/custom-actions.html
 */

// Re-export from consolidated lease-id-codec module (Issue 4)
export {
  decodeLeaseCompositeKey,
  encodeLeaseCompositeKey,
  type CompositeLeaseId,
} from './lease-id-codec.js';

/**
 * Amazon Q Custom Action Lambda Event
 *
 * When an operator clicks a custom action button in Slack, Amazon Q Developer
 * (AWS Chatbot) invokes the configured Lambda with this payload format.
 */
export interface CustomActionEvent {
  /** Action name from Slack button (e.g., "approve", "deny") */
  actionName: string;
  /** Slack workspace ID */
  slackWorkspaceId: string;
  /** Slack channel ID where action was triggered */
  slackChannelId: string;
  /** Slack user ID who clicked the button */
  slackUserId: string;
  /** Original notification metadata */
  originalNotification: {
    /** threadId from the notification metadata */
    threadId: string;
    /** additionalContext from the notification */
    additionalContext: {
      /** Base64-encoded composite key containing {userEmail, uuid} */
      leaseId: string;
      /** Requester's email address */
      userEmail: string;
      /** Risk score */
      score: string;
      /** Auto-approve threshold */
      threshold: string;
      /** Requested template ID */
      templateId: string;
      /** Reference number (ISB-YYYY-NNNN format) */
      reference: string;
      /** Timestamp when notification was sent */
      timestamp?: string;
      /** Queue depth at time of notification */
      queueDepth?: string;
      /** Template display name */
      templateName?: string;
      /** Lease duration in hours */
      leaseDurationHours?: string;
      /** Budget amount in GBP */
      budgetAmount?: string;
    };
  };
}

/**
 * Amazon Q Custom Action Lambda Response
 *
 * AWS Chatbot expects this response format for thread replies.
 */
export interface CustomActionResponse {
  /** Response version */
  version: '1.0';
  /** Status of the action */
  status: 'success' | 'error';
  /** Message to post as thread reply */
  message: string;
  /** Optional: Additional metadata */
  metadata?: Record<string, string>;
}

/**
 * Decoded lease ID from base64 composite key.
 * @deprecated Use CompositeLeaseId from lease-id-codec.js instead
 */
export type DecodedLeaseId = import('./lease-id-codec.js').CompositeLeaseId;
