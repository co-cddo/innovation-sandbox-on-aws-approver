/**
 * Slack Approve Lambda Construct (Story 7.2.1)
 *
 * CDK construct for the Lambda function that handles "Approve" button clicks
 * from Slack via Amazon Q Developer custom actions.
 *
 * Features:
 * - Node.js 20.x runtime with 30s timeout
 * - IAM permissions for ISB Lambda invocation
 * - Environment variables for ISB integration
 * - ESM bundling configuration
 */

import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

/**
 * Configuration properties for SlackApproveLambda construct.
 */
export interface SlackApproveLambdaProps {
  /** ISB Leases Lambda function name for approval invocation */
  isbLeasesLambdaName: string;
  /** Approver email for automated approvals */
  approverEmail: string;
  /** SNS topic ARN for thread replies (for future use in Story 7.3.x) */
  snsTopicArn: string;
  /** Log level for Lambda */
  logLevel?: string;
}

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
export class SlackApproveLambda extends Construct {
  /** The Lambda function */
  public readonly function: nodejs.NodejsFunction;
  /** The CloudWatch log group */
  public readonly logGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props: SlackApproveLambdaProps) {
    super(scope, id);

    const { isbLeasesLambdaName, approverEmail, snsTopicArn, logLevel = 'INFO' } = props;

    // Create explicit log group with audit retention (Story 5.4 compliance)
    this.logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: '/aws/lambda/ApproverSlackApprove',
      retention: logs.RetentionDays.SEVEN_YEARS,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Create the Lambda function
    this.function = new nodejs.NodejsFunction(this, 'Function', {
      functionName: 'ApproverSlackApprove',
      entry: 'src/handlers/slack-approve.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      architecture: lambda.Architecture.ARM_64,
      logGroup: this.logGroup,
      environment: {
        ISB_LEASES_LAMBDA_NAME: isbLeasesLambdaName,
        APPROVER_EMAIL: approverEmail,
        SNS_TOPIC_ARN: snsTopicArn,
        LOG_LEVEL: logLevel,
        NODE_OPTIONS: '--enable-source-maps',
      },
      bundling: {
        format: nodejs.OutputFormat.ESM,
        minify: true,
        sourceMap: true,
        target: 'node20',
        // Exclude AWS SDK v3 - it's included in the Lambda runtime
        externalModules: ['@aws-sdk/*'],
        // Banner to handle ESM compatibility
        banner:
          "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
      },
      tracing: lambda.Tracing.ACTIVE,
    });

    // Grant permission to invoke ISB Leases Lambda (AC5)
    this.function.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'InvokeISBLeasesLambda',
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [
          `arn:aws:lambda:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:function:${isbLeasesLambdaName}`,
        ],
      })
    );

    // Add tags for cost tracking
    cdk.Tags.of(this.function).add('Project', 'innovation-sandbox-approver');
    cdk.Tags.of(this.function).add('Component', 'slack-actions');
    cdk.Tags.of(this.function).add('Story', '7.2.1');

    // Grant AWS Chatbot permission to invoke this Lambda (Story 7.2.3)
    // Required for custom action buttons to work from Slack notifications
    this.function.addPermission('ChatbotInvoke', {
      principal: new iam.ServicePrincipal('chatbot.amazonaws.com'),
      action: 'lambda:InvokeFunction',
    });
  }
}
