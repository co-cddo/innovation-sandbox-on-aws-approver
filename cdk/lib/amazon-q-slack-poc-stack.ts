import * as cdk from 'aws-cdk-lib';
import * as chatbot from 'aws-cdk-lib/aws-chatbot';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

/**
 * POC Stack: Amazon Q Developer Slack Integration
 *
 * This stack proves we can send notifications to Slack via Amazon Q Developer
 * (formerly AWS Chatbot) instead of direct webhooks.
 *
 * Phase 1: Send notification to channel
 * Phase 2: Add approve/deny buttons (custom actions)
 * Phase 3: Integrate with ISB approver and remove webhook code
 */
export interface AmazonQSlackPocStackProps extends cdk.StackProps {
  /**
   * Slack Workspace ID (format: T0XXXXXXX)
   */
  slackWorkspaceId: string;

  /**
   * Slack Channel ID (format: C0XXXXXXX)
   */
  slackChannelId: string;
}

export class AmazonQSlackPocStack extends cdk.Stack {
  /** SNS Topic for notifications */
  public readonly notificationTopic: sns.Topic;

  /** Slack channel configuration */
  public readonly slackChannel: chatbot.SlackChannelConfiguration;

  /** Test Lambda function */
  public readonly testLambda: lambda.Function;

  /** Approve action Lambda (POC stub) */
  public readonly approveLambda: lambda.Function;

  /** Deny action Lambda (POC stub) */
  public readonly denyLambda: lambda.Function;

  constructor(scope: Construct, id: string, props: AmazonQSlackPocStackProps) {
    super(scope, id, props);

    const { slackWorkspaceId, slackChannelId } = props;

    // ==========================================
    // SNS Topic for Slack Notifications
    // ==========================================
    this.notificationTopic = new sns.Topic(this, 'SlackNotificationTopic', {
      topicName: 'AmazonQSlackPocNotifications',
      displayName: 'Amazon Q Slack POC Notifications',
    });

    // ==========================================
    // Custom Guardrail Policy for Lambda Invoke
    // Guardrails act as permission boundaries - must allow Lambda invoke
    // ==========================================
    const lambdaInvokePolicy = new iam.ManagedPolicy(this, 'LambdaInvokePolicy', {
      managedPolicyName: 'AmazonQSlackPocLambdaInvoke',
      statements: [
        new iam.PolicyStatement({
          sid: 'AllowLambdaInvoke',
          effect: iam.Effect.ALLOW,
          actions: ['lambda:InvokeFunction'],
          resources: [
            `arn:aws:lambda:${this.region}:${this.account}:function:AmazonQSlackPoc*`,
            `arn:aws:lambda:${this.region}:${this.account}:function:ISB-LeasesLambdaFunction-ndx`,
          ],
        }),
      ],
    });

    // ==========================================
    // Amazon Q Developer (Chatbot) Slack Channel Configuration
    // ==========================================
    this.slackChannel = new chatbot.SlackChannelConfiguration(
      this,
      'SlackChannel',
      {
        slackChannelConfigurationName: 'AmazonQSlackPoc',
        slackWorkspaceId,
        slackChannelId,
        // Guardrail policies define what actions are allowed
        // Must include Lambda invoke for custom actions to work
        guardrailPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('ReadOnlyAccess'),
          lambdaInvokePolicy,
        ],
        loggingLevel: chatbot.LoggingLevel.INFO,
      }
    );

    // Add the SNS topic as notification source
    this.slackChannel.addNotificationTopic(this.notificationTopic);

    // ==========================================
    // Test Lambda for Sending Notifications
    // ==========================================
    const testLambdaRole = new iam.Role(this, 'TestLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole'
        ),
      ],
    });

    // Grant publish to SNS topic
    this.notificationTopic.grantPublish(testLambdaRole);

    this.testLambda = new lambda.Function(this, 'TestNotificationLambda', {
      functionName: 'AmazonQSlackPocTest',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      role: testLambdaRole,
      timeout: cdk.Duration.seconds(10),
      environment: {
        SNS_TOPIC_ARN: this.notificationTopic.topicArn,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
      code: lambda.Code.fromInline(`
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const sns = new SNSClient({});

/**
 * Test Lambda that sends a custom notification to Slack via Amazon Q Developer.
 * Pre-computes the ISB Lambda payloads so custom actions just forward them.
 */
exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const topicArn = process.env.SNS_TOPIC_ARN;
  const leaseUuid = event.leaseUuid || 'test-uuid';
  const userEmail = event.userEmail || 'test@example.gov.uk';
  const approverEmail = 'ndx+try-automated-approver@dsit.gov.uk';

  // Pre-compute base64-encoded leaseId
  const leaseId = Buffer.from(JSON.stringify({ userEmail, uuid: leaseUuid })).toString('base64');

  // Pre-compute JWT for approver (full Authorization header value)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .toString('base64').replace(/=/g, '').replace(/\\+/g, '-').replace(/\\//g, '_');
  const payload = Buffer.from(JSON.stringify({ user: { email: approverEmail, roles: ['Admin'] } }))
    .toString('base64').replace(/=/g, '').replace(/\\+/g, '-').replace(/\\//g, '_');
  const authorization = 'Bearer ' + header + '.' + payload + '.directinvoke';

  // Pre-compute review path
  const reviewPath = '/leases/' + leaseId + '/review';

  const notification = {
    version: '1.0',
    source: 'custom',
    id: 'lease-' + leaseUuid,
    content: {
      textType: 'client-markdown',
      title: ':warning: *Lease Review Required*',
      description: event.message || 'A lease request needs manual review.',
      nextSteps: ['Review the request details', 'Click Approve or Deny'],
      keywords: ['lease', 'review', 'pending']
    },
    metadata: {
      threadId: leaseUuid,
      summary: 'Lease Review',
      enableCustomActions: true,
      additionalContext: {
        leaseUuid,
        userEmail,
        leaseId,
        authorization,
        reviewPath
      }
    }
  };

  console.log('Sending notification:', JSON.stringify(notification, null, 2));

  const command = new PublishCommand({
    TopicArn: topicArn,
    Message: JSON.stringify(notification),
    Subject: 'Amazon Q Slack POC Test'
  });

  const result = await sns.send(command);

  console.log('SNS publish result:', JSON.stringify(result, null, 2));

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Notification sent successfully',
      messageId: result.MessageId
    })
  };
};
`),
    });

    // ==========================================
    // Phase 2: Approve/Deny Action Lambdas (POC stubs)
    // These will be invoked by custom action buttons in Slack
    // ==========================================

    // Shared role for action Lambdas - needs permission to invoke ISB Lambda and publish to SNS
    const actionLambdaRole = new iam.Role(this, 'ActionLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole'
        ),
      ],
      inlinePolicies: {
        InvokeIsbLambda: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['lambda:InvokeFunction'],
              resources: [
                `arn:aws:lambda:${this.region}:${this.account}:function:ISB-LeasesLambdaFunction-ndx`,
              ],
            }),
          ],
        }),
      },
    });

    // Grant SNS publish to action Lambdas for thread updates
    this.notificationTopic.grantPublish(actionLambdaRole);

    // Approve Lambda - calls ISB Lambda and posts thread update
    this.approveLambda = new lambda.Function(this, 'ApproveLambda', {
      functionName: 'AmazonQSlackPocApprove',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      role: actionLambdaRole,
      timeout: cdk.Duration.seconds(30),
      environment: {
        ISB_LEASES_LAMBDA_NAME: 'ISB-LeasesLambdaFunction-ndx',
        SNS_TOPIC_ARN: this.notificationTopic.topicArn,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
      code: lambda.Code.fromInline(`
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const lambdaClient = new LambdaClient({});
const snsClient = new SNSClient({});

/**
 * Approve Lambda - calls ISB Lambda and posts thread update.
 */
exports.handler = async (event) => {
  console.log('=== APPROVE BUTTON CLICKED ===');
  console.log('Event:', JSON.stringify(event, null, 2));

  const isbLambdaName = process.env.ISB_LEASES_LAMBDA_NAME;
  const topicArn = process.env.SNS_TOPIC_ARN;

  // Extract leaseId from event (passed by custom action)
  const leaseId = event.leaseId;

  if (!leaseId) {
    console.error('Missing leaseId');
    return { statusCode: 400, body: 'Missing required field: leaseId' };
  }

  // Decode leaseId to get userEmail and uuid
  let leaseUuid, userEmail;
  try {
    const decoded = JSON.parse(Buffer.from(leaseId, 'base64').toString('utf8'));
    leaseUuid = decoded.uuid;
    userEmail = decoded.userEmail;
    console.log('Decoded leaseId:', { leaseUuid, userEmail });
  } catch (e) {
    console.error('Failed to decode leaseId:', e);
    return { statusCode: 400, body: 'Invalid leaseId format' };
  }

  // Compute authorization header (static approver credentials)
  const approverEmail = 'ndx+try-automated-approver@dsit.gov.uk';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .toString('base64').replace(/=/g, '').replace(/\\+/g, '-').replace(/\\//g, '_');
  const payload = Buffer.from(JSON.stringify({ user: { email: approverEmail, roles: ['Admin'] } }))
    .toString('base64').replace(/=/g, '').replace(/\\+/g, '-').replace(/\\//g, '_');
  const authorization = 'Bearer ' + header + '.' + payload + '.directinvoke';

  // Compute review path from leaseId
  const reviewPath = '/leases/' + leaseId + '/review';

  // Build the ISB Lambda payload
  const isbPayload = {
    httpMethod: 'POST',
    path: reviewPath,
    pathParameters: { leaseId },
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'Approve' }),
    requestContext: { httpMethod: 'POST', path: reviewPath },
    resource: '/leases/{leaseId}/review',
    isBase64Encoded: false
  };

  console.log('Calling ISB Lambda:', isbLambdaName);
  console.log('Payload:', JSON.stringify(isbPayload, null, 2));

  try {
    const invokeCommand = new InvokeCommand({
      FunctionName: isbLambdaName,
      Payload: Buffer.from(JSON.stringify(isbPayload))
    });

    const response = await lambdaClient.send(invokeCommand);
    const result = JSON.parse(Buffer.from(response.Payload).toString());

    console.log('ISB Response:', JSON.stringify(result, null, 2));

    const success = result.statusCode >= 200 && result.statusCode < 300;
    const statusEmoji = success ? ':white_check_mark:' : ':x:';
    const statusText = success ? 'APPROVED' : 'FAILED';

    // Send thread update via SNS
    const notification = {
      version: '1.0',
      source: 'custom',
      id: 'approve-' + leaseUuid + '-' + Date.now(),
      content: {
        textType: 'client-markdown',
        title: statusEmoji + ' Lease ' + statusText,
        description: success
          ? 'Lease for ' + userEmail + ' has been approved.'
          : 'Failed to approve lease: ' + (result.body || 'Unknown error'),
      },
      metadata: {
        threadId: leaseUuid,
        summary: 'Lease ' + statusText
      }
    };

    console.log('Sending thread update:', JSON.stringify(notification, null, 2));

    const publishCommand = new PublishCommand({
      TopicArn: topicArn,
      Message: JSON.stringify(notification),
      Subject: 'Lease Approval Result'
    });

    await snsClient.send(publishCommand);

    return {
      statusCode: result.statusCode || 200,
      body: JSON.stringify({ message: 'Lease ' + statusText, isbStatusCode: result.statusCode })
    };
  } catch (error) {
    console.error('Error:', error);

    // Send error notification to thread
    const errorNotification = {
      version: '1.0',
      source: 'custom',
      id: 'error-' + leaseUuid + '-' + Date.now(),
      content: {
        textType: 'client-markdown',
        title: ':x: Approval Error',
        description: 'Error processing approval: ' + error.message,
      },
      metadata: {
        threadId: leaseUuid,
        summary: 'Approval Error'
      }
    };

    const publishCommand = new PublishCommand({
      TopicArn: topicArn,
      Message: JSON.stringify(errorNotification),
      Subject: 'Lease Approval Error'
    });

    await snsClient.send(publishCommand);

    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
`),
    });

    // Deny Lambda - calls ISB Lambda and posts thread update
    this.denyLambda = new lambda.Function(this, 'DenyLambda', {
      functionName: 'AmazonQSlackPocDeny',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      role: actionLambdaRole,
      timeout: cdk.Duration.seconds(30),
      environment: {
        ISB_LEASES_LAMBDA_NAME: 'ISB-LeasesLambdaFunction-ndx',
        SNS_TOPIC_ARN: this.notificationTopic.topicArn,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
      code: lambda.Code.fromInline(`
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const lambdaClient = new LambdaClient({});
const snsClient = new SNSClient({});

/**
 * Deny Lambda - calls ISB Lambda and posts thread update.
 */
exports.handler = async (event) => {
  console.log('=== DENY BUTTON CLICKED ===');
  console.log('Event:', JSON.stringify(event, null, 2));

  const isbLambdaName = process.env.ISB_LEASES_LAMBDA_NAME;
  const topicArn = process.env.SNS_TOPIC_ARN;

  // Extract leaseId from event (passed by custom action)
  const leaseId = event.leaseId;

  if (!leaseId) {
    console.error('Missing leaseId');
    return { statusCode: 400, body: 'Missing required field: leaseId' };
  }

  // Decode leaseId to get userEmail and uuid
  let leaseUuid, userEmail;
  try {
    const decoded = JSON.parse(Buffer.from(leaseId, 'base64').toString('utf8'));
    leaseUuid = decoded.uuid;
    userEmail = decoded.userEmail;
    console.log('Decoded leaseId:', { leaseUuid, userEmail });
  } catch (e) {
    console.error('Failed to decode leaseId:', e);
    return { statusCode: 400, body: 'Invalid leaseId format' };
  }

  // Compute authorization header (static approver credentials)
  const approverEmail = 'ndx+try-automated-approver@dsit.gov.uk';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .toString('base64').replace(/=/g, '').replace(/\\+/g, '-').replace(/\\//g, '_');
  const payload = Buffer.from(JSON.stringify({ user: { email: approverEmail, roles: ['Admin'] } }))
    .toString('base64').replace(/=/g, '').replace(/\\+/g, '-').replace(/\\//g, '_');
  const authorization = 'Bearer ' + header + '.' + payload + '.directinvoke';

  // Compute review path from leaseId
  const reviewPath = '/leases/' + leaseId + '/review';

  // Build the ISB Lambda payload
  const isbPayload = {
    httpMethod: 'POST',
    path: reviewPath,
    pathParameters: { leaseId },
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'Deny' }),
    requestContext: { httpMethod: 'POST', path: reviewPath },
    resource: '/leases/{leaseId}/review',
    isBase64Encoded: false
  };

  console.log('Calling ISB Lambda:', isbLambdaName);
  console.log('Payload:', JSON.stringify(isbPayload, null, 2));

  try {
    const invokeCommand = new InvokeCommand({
      FunctionName: isbLambdaName,
      Payload: Buffer.from(JSON.stringify(isbPayload))
    });

    const response = await lambdaClient.send(invokeCommand);
    const result = JSON.parse(Buffer.from(response.Payload).toString());

    console.log('ISB Response:', JSON.stringify(result, null, 2));

    const success = result.statusCode >= 200 && result.statusCode < 300;
    const statusEmoji = success ? ':no_entry_sign:' : ':x:';
    const statusText = success ? 'DENIED' : 'FAILED';

    // Send thread update via SNS
    const notification = {
      version: '1.0',
      source: 'custom',
      id: 'deny-' + leaseUuid + '-' + Date.now(),
      content: {
        textType: 'client-markdown',
        title: statusEmoji + ' Lease ' + statusText,
        description: success
          ? 'Lease for ' + userEmail + ' has been denied.'
          : 'Failed to deny lease: ' + (result.body || 'Unknown error'),
      },
      metadata: {
        threadId: leaseUuid,
        summary: 'Lease ' + statusText
      }
    };

    console.log('Sending thread update:', JSON.stringify(notification, null, 2));

    const publishCommand = new PublishCommand({
      TopicArn: topicArn,
      Message: JSON.stringify(notification),
      Subject: 'Lease Denial Result'
    });

    await snsClient.send(publishCommand);

    return {
      statusCode: result.statusCode || 200,
      body: JSON.stringify({ message: 'Lease ' + statusText, isbStatusCode: result.statusCode })
    };
  } catch (error) {
    console.error('Error:', error);

    // Send error notification to thread
    const errorNotification = {
      version: '1.0',
      source: 'custom',
      id: 'error-' + leaseUuid + '-' + Date.now(),
      content: {
        textType: 'client-markdown',
        title: ':x: Denial Error',
        description: 'Error processing denial: ' + error.message,
      },
      metadata: {
        threadId: leaseUuid,
        summary: 'Denial Error'
      }
    };

    const publishCommand = new PublishCommand({
      TopicArn: topicArn,
      Message: JSON.stringify(errorNotification),
      Subject: 'Lease Denial Error'
    });

    await snsClient.send(publishCommand);

    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
`),
    });

    // Grant the Slack channel permission to invoke action Lambdas and ISB Lambda directly
    this.slackChannel.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [
          this.approveLambda.functionArn,
          this.denyLambda.functionArn,
          `arn:aws:lambda:${this.region}:${this.account}:function:ISB-LeasesLambdaFunction-ndx`,
        ],
      })
    );

    // ==========================================
    // Stack Outputs
    // ==========================================
    new cdk.CfnOutput(this, 'NotificationTopicArn', {
      value: this.notificationTopic.topicArn,
      description: 'SNS Topic ARN for Slack notifications',
    });

    new cdk.CfnOutput(this, 'SlackChannelConfigArn', {
      value: this.slackChannel.slackChannelConfigurationArn,
      description: 'Slack channel configuration ARN',
    });

    new cdk.CfnOutput(this, 'TestLambdaName', {
      value: this.testLambda.functionName,
      description: 'Test Lambda function name - invoke to send test notification',
    });

    new cdk.CfnOutput(this, 'TestCommand', {
      value: `aws lambda invoke --function-name ${this.testLambda.functionName} --payload '{}' /dev/stdout`,
      description: 'Command to test the notification',
    });

    // Phase 2 outputs
    new cdk.CfnOutput(this, 'ApproveLambdaArn', {
      value: this.approveLambda.functionArn,
      description: 'Approve Lambda ARN - use when configuring custom action in AWS Console',
    });

    new cdk.CfnOutput(this, 'DenyLambdaArn', {
      value: this.denyLambda.functionArn,
      description: 'Deny Lambda ARN - use when configuring custom action in AWS Console',
    });

    new cdk.CfnOutput(this, 'CustomActionsConsoleUrl', {
      value: `https://${cdk.Stack.of(this).region}.console.aws.amazon.com/chatbot/home?region=${cdk.Stack.of(this).region}#/chat-clients`,
      description: 'AWS Console URL to configure custom actions',
    });
  }
}
