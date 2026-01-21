/**
 * Amazon Q Developer Custom Action Types (Story 7.2.1)
 *
 * Type definitions for the payload format used when an operator clicks
 * a custom action button (Approve/Deny) in Slack via Amazon Q Developer.
 *
 * @see https://docs.aws.amazon.com/chatbot/latest/adminguide/custom-actions.html
 */

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
 * Decoded lease ID from base64 composite key
 */
export interface DecodedLeaseId {
  userEmail: string;
  uuid: string;
}

/**
 * Decodes the base64 composite key back to LeaseId.
 *
 * The composite key is a base64-encoded JSON string containing
 * {userEmail, uuid}. This matches the format created by
 * encodeLeaseCompositeKey() in sns-notification.ts.
 *
 * IMPORTANT: This decode function MUST stay in sync with encodeLeaseCompositeKey()
 * in src/services/sns-notification.ts. The test in test/lib/slack-action-types.test.ts
 * verifies this compatibility - see "matches format produced by encodeLeaseCompositeKey" test.
 *
 * @param encoded - Base64-encoded JSON string
 * @returns Decoded LeaseId object
 * @throws Error if decoding or parsing fails
 */
export const decodeLeaseCompositeKey = (encoded: string): DecodedLeaseId => {
  try {
    const json = Buffer.from(encoded, 'base64').toString('utf8');
    const parsed = JSON.parse(json) as { userEmail?: string; uuid?: string };

    if (!parsed.userEmail || !parsed.uuid) {
      throw new Error('Missing userEmail or uuid in decoded payload');
    }

    return {
      userEmail: parsed.userEmail,
      uuid: parsed.uuid,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in base64 payload: ${error.message}`);
    }
    throw error;
  }
};
