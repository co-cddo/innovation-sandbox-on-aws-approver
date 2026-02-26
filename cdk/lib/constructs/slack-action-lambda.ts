/**
 * Slack Action Lambda Base Construct (Issue 9 - Code Review Fix)
 *
 * Base CDK construct for Slack action Lambdas that eliminates code duplication
 * between approve and deny Lambda constructs. Both handlers share 95%+ of their
 * infrastructure configuration.
 *
 * Features:
 * - Node.js 20.x runtime with 30s timeout
 * - IAM permissions for ISB Lambda invocation
 * - Environment variables for ISB integration
 * - ESM bundling configuration
 * - 7-year log retention for audit compliance
 * - AWS Chatbot invoke permission for custom actions
 */

import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

/**
 * Type of Slack action: approve or deny.
 */
export type SlackActionType = 'approve' | 'deny';

/**
 * Configuration properties for SlackActionLambda base construct.
 */
export interface SlackActionLambdaProps {
  /** Action type: 'approve' or 'deny' */
  actionType: SlackActionType;
  /** ISB API Gateway base URL */
  isbApiBaseUrl: string;
  /** ISB JWT secret path in Secrets Manager */
  isbJwtSecretPath: string;
  /** Approver email for automated approvals/denials */
  approverEmail: string;
  /** SNS topic ARN for thread replies (for future use in Story 7.3.x) */
  snsTopicArn: string;
  /** Log level for Lambda */
  logLevel?: string;
}

/**
 * Base CDK Construct for Slack action Lambda functions.
 *
 * This construct handles the shared configuration for both Approve and Deny
 * Lambda functions that handle custom action button clicks from Slack
 * via Amazon Q Developer.
 *
 * Common functionality:
 * - Lambda function with Node.js 20.x runtime
 * - CloudWatch log group with 7-year retention
 * - IAM permissions for ISB Lambda invocation
 * - AWS Chatbot invoke permission
 * - Cost tracking tags
 */
export class SlackActionLambda extends Construct {
  /** The Lambda function */
  public readonly function: nodejs.NodejsFunction;
  /** The CloudWatch log group */
  public readonly logGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props: SlackActionLambdaProps) {
    super(scope, id);

    const {
      actionType,
      isbApiBaseUrl,
      isbJwtSecretPath,
      approverEmail,
      snsTopicArn,
      logLevel = 'INFO',
    } = props;

    // Derive names from actionType
    const actionName = actionType.charAt(0).toUpperCase() + actionType.slice(1);
    const functionName = `ApproverSlack${actionName}`;
    const logGroupName = `/aws/lambda/${functionName}`;
    const entryPoint = `src/handlers/slack-${actionType}.ts`;
    const storyNumber = actionType === 'approve' ? '7.2.1' : '7.2.2';

    // Create explicit log group with audit retention (Story 5.4 compliance)
    this.logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName,
      retention: logs.RetentionDays.SEVEN_YEARS,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Create the Lambda function
    this.function = new nodejs.NodejsFunction(this, 'Function', {
      functionName,
      entry: entryPoint,
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      architecture: lambda.Architecture.ARM_64,
      logGroup: this.logGroup,
      environment: {
        ISB_API_BASE_URL: isbApiBaseUrl,
        ISB_JWT_SECRET_PATH: isbJwtSecretPath,
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

    // Grant Secrets Manager read for ISB JWT secret (used by @co-cddo/isb-client)
    this.function.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'GetIsbJwtSecret',
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:secret:${isbJwtSecretPath}*`,
        ],
      })
    );

    // Add tags for cost tracking
    cdk.Tags.of(this.function).add('Project', 'innovation-sandbox-approver');
    cdk.Tags.of(this.function).add('Component', 'slack-actions');
    cdk.Tags.of(this.function).add('Story', storyNumber);

    // Grant AWS Chatbot permission to invoke this Lambda (Story 7.2.3)
    // Required for custom action buttons to work from Slack notifications
    this.function.addPermission('ChatbotInvoke', {
      principal: new iam.ServicePrincipal('chatbot.amazonaws.com'),
      action: 'lambda:InvokeFunction',
    });
  }
}
