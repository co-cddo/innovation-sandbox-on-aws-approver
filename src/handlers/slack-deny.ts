/**
 * Slack Deny Action Lambda Handler (Story 7.2.2)
 *
 * Handles the "Deny" custom action button clicks from Slack via Amazon Q Developer.
 * Invokes ISB Leases Lambda to deny the lease and returns a formatted thread reply.
 *
 * @see https://docs.aws.amazon.com/chatbot/latest/adminguide/custom-actions.html
 */

import { createSlackActionHandler } from './slack-action-base.js';

const { handler, setIsbLambdaService, resetIsbLambdaService } = createSlackActionHandler({
  actionType: 'deny',
  serviceName: 'slack-deny',
  successEmoji: '🚫',
  successVerb: 'Denied',
  failureMessage: 'Failed to deny request',
});

export { handler, setIsbLambdaService, resetIsbLambdaService };
