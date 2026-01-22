/**
 * Slack Approve Lambda Construct (Story 7.2.1)
 *
 * CDK construct for the Lambda function that handles "Approve" button clicks
 * from Slack via Amazon Q Developer custom actions.
 *
 * This construct extends SlackActionLambda base class to eliminate code duplication.
 * See slack-action-lambda.ts for shared infrastructure configuration.
 */

import { Construct } from 'constructs';
import { SlackActionLambda, type SlackActionLambdaProps } from './slack-action-lambda.js';

/**
 * Configuration properties for SlackApproveLambda construct.
 */
export type SlackApproveLambdaProps = Omit<SlackActionLambdaProps, 'actionType'>;

/**
 * CDK Construct for the Slack Approve Lambda function.
 *
 * This Lambda handles the "Approve" custom action button clicks from Slack
 * via Amazon Q Developer. It:
 * 1. Receives the custom action payload
 * 2. Decodes the leaseId from the notification metadata
 * 3. Invokes ISB Leases Lambda to approve the request
 * 4. Returns a formatted response for thread reply
 */
export class SlackApproveLambda extends SlackActionLambda {
  constructor(scope: Construct, id: string, props: SlackApproveLambdaProps) {
    super(scope, id, { ...props, actionType: 'approve' });
  }
}
