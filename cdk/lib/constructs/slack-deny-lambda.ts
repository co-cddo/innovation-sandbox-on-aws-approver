/**
 * Slack Deny Lambda Construct (Story 7.2.2)
 *
 * CDK construct for the Lambda function that handles "Deny" button clicks
 * from Slack via Amazon Q Developer custom actions.
 *
 * This construct extends SlackActionLambda base class to eliminate code duplication.
 * See slack-action-lambda.ts for shared infrastructure configuration.
 */

import { Construct } from 'constructs';
import { SlackActionLambda, type SlackActionLambdaProps } from './slack-action-lambda.js';

/**
 * Configuration properties for SlackDenyLambda construct.
 */
export type SlackDenyLambdaProps = Omit<SlackActionLambdaProps, 'actionType'>;

/**
 * CDK Construct for the Slack Deny Lambda function.
 *
 * This Lambda handles the "Deny" custom action button clicks from Slack
 * via Amazon Q Developer. It:
 * 1. Receives the custom action payload
 * 2. Decodes the leaseId from the notification metadata
 * 3. Invokes ISB Leases Lambda to deny the request
 * 4. Returns a formatted response for thread reply
 */
export class SlackDenyLambda extends SlackActionLambda {
  constructor(scope: Construct, id: string, props: SlackDenyLambdaProps) {
    super(scope, id, { ...props, actionType: 'deny' });
  }
}
