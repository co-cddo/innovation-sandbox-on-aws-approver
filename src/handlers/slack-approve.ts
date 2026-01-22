/**
 * Slack Approve Action Lambda Handler (Story 7.2.1)
 *
 * Handles the "Approve" custom action button clicks from Slack via Amazon Q Developer.
 * Invokes ISB Leases Lambda to approve the lease and returns a formatted thread reply.
 *
 * @see https://docs.aws.amazon.com/chatbot/latest/adminguide/custom-actions.html
 */

import { createSlackActionHandler } from './slack-action-base.js';

const { handler, setIsbLambdaService, resetIsbLambdaService } = createSlackActionHandler({
  actionType: 'approve',
  serviceName: 'slack-approve',
  successEmoji: '✅',
  successVerb: 'Approved',
  failureMessage: 'Failed to approve request',
});

export { handler, setIsbLambdaService, resetIsbLambdaService };
