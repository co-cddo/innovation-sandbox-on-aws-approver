import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import type { ApproverConfig } from '../../config/environments.js';

export interface ApproverLambdaProps {
  config: ApproverConfig;
  idempotencyTableName: string;
  queuePositionTableName: string;
  delayQueueUrl: string;
  domainListBucketName: string;
  /** SNS topic ARN for approval notifications (Story 7.1.1) */
  notificationTopicArn?: string;
}

export class ApproverLambda extends Construct {
  public readonly function: lambda.Function;
  public readonly logGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props: ApproverLambdaProps) {
    super(scope, id);

    const { config, idempotencyTableName, queuePositionTableName, delayQueueUrl, domainListBucketName, notificationTopicArn } = props;

    // Create explicit log group with GDPR-compliant retention (7 years)
    // Story 5.4: FR55 - GDPR compliance audit trail
    this.logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: '/aws/lambda/approver',
      retention: logs.RetentionDays.SEVEN_YEARS,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Don't delete logs on stack removal
    });

    this.function = new lambda.Function(this, 'Function', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      architecture: lambda.Architecture.ARM_64,
      logGroup: this.logGroup, // Associate with explicit log group
      environment: {
        AUTO_APPROVE_THRESHOLD: config.autoApproveThreshold.toString(),
        BUSINESS_HOURS_START: config.businessHoursStart.toString(),
        BUSINESS_HOURS_END: config.businessHoursEnd.toString(),
        BUSINESS_HOURS_TZ: config.businessHoursTz,
        ISB_CONSOLE_URL: config.isbConsoleUrl,
        ISB_LEASES_TABLE_NAME: config.isbLeasesTableName,
        ISB_ACCOUNTS_TABLE_NAME: config.isbAccountsTableName,
        IDEMPOTENCY_TABLE_NAME: idempotencyTableName,
        QUEUE_POSITION_TABLE_NAME: queuePositionTableName,
        DELAY_QUEUE_URL: delayQueueUrl,
        DOMAIN_ALLOWLIST_BUCKET: domainListBucketName,
        BEDROCK_MODEL_ID: config.bedrockModelId,
        LOG_LEVEL: config.logLevel,
        RULE_WEIGHTS: config.ruleWeights,
        EVENT_BUS_NAME: config.isbEventBusName,
        ISB_LEASES_LAMBDA_NAME: config.isbLeasesLambdaName,
        ISB_ACCOUNTS_LAMBDA_NAME: config.isbAccountsLambdaName,
        // Story 7.1.1: SNS notification topic for approval notifications
        ...(notificationTopicArn && { NOTIFICATION_TOPIC_ARN: notificationTopicArn }),
      },
      tracing: lambda.Tracing.ACTIVE,
    });

    // Grant Bedrock invoke permissions for Nova Micro (via cross-region inference profile)
    // The us.amazon.nova-micro-v1:0 profile routes to any US region dynamically
    this.function.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [
          // Foundation model ARNs for all US regions (cross-region inference routing)
          'arn:aws:bedrock:us-west-2::foundation-model/amazon.nova-micro-v1:0',
          'arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-micro-v1:0',
          'arn:aws:bedrock:us-east-2::foundation-model/amazon.nova-micro-v1:0',
          'arn:aws:bedrock:us-west-1::foundation-model/amazon.nova-micro-v1:0',
          // Inference profile ARN (required for on-demand throughput)
          `arn:aws:bedrock:us-west-2:${cdk.Stack.of(this).account}:inference-profile/${config.bedrockModelId}`,
        ],
      })
    );

    // Grant Secrets Manager read for approver secrets
    this.function.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:us-west-2:${cdk.Stack.of(this).account}:secret:/approver/*`,
        ],
      })
    );

    // Grant EventBridge put events to ISB event bus (for escalation events)
    this.function.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['events:PutEvents'],
        resources: [
          `arn:aws:events:us-west-2:${cdk.Stack.of(this).account}:event-bus/${config.isbEventBusName}`,
        ],
      })
    );

    // Grant Lambda invoke permission for ISB Lambdas (leases + accounts)
    this.function.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [
          `arn:aws:lambda:us-west-2:${cdk.Stack.of(this).account}:function:${config.isbLeasesLambdaName}`,
          `arn:aws:lambda:us-west-2:${cdk.Stack.of(this).account}:function:${config.isbAccountsLambdaName}`,
        ],
      })
    );

    // Grant ISB Leases table read/write (Scan needed for org history queries)
    this.function.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan', 'dynamodb:UpdateItem', 'dynamodb:PutItem'],
        resources: [
          `arn:aws:dynamodb:us-west-2:${cdk.Stack.of(this).account}:table/${config.isbLeasesTableName}`,
          `arn:aws:dynamodb:us-west-2:${cdk.Stack.of(this).account}:table/${config.isbLeasesTableName}/index/*`,
        ],
      })
    );

    // Grant ISB Accounts table read (GetItem/Query/Scan for account cooldown checks - Story 6.2)
    // Scan required for getAvailableAccountsCount() and checkAccountReadinessNow()
    this.function.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
        resources: [
          `arn:aws:dynamodb:us-west-2:${cdk.Stack.of(this).account}:table/${config.isbAccountsTableName}`,
          `arn:aws:dynamodb:us-west-2:${cdk.Stack.of(this).account}:table/${config.isbAccountsTableName}/index/*`,
        ],
      })
    );

    // Grant KMS decrypt for ISB DynamoDB tables (encrypted at rest)
    this.function.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['kms:Decrypt'],
        resources: [
          // ISB data tables are encrypted with this key
          `arn:aws:kms:us-west-2:${cdk.Stack.of(this).account}:key/${config.isbKmsKeyId}`,
        ],
      })
    );

    // Grant AppConfig read for ISB console URL - scoped to account/region
    this.function.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'appconfig:GetConfiguration',
          'appconfig:GetLatestConfiguration',
          'appconfig:StartConfigurationSession',
        ],
        resources: [
          `arn:aws:appconfig:us-west-2:${cdk.Stack.of(this).account}:application/*`,
          `arn:aws:appconfig:us-west-2:${cdk.Stack.of(this).account}:application/*/environment/*`,
          `arn:aws:appconfig:us-west-2:${cdk.Stack.of(this).account}:application/*/environment/*/configuration/*`,
        ],
      })
    );
  }
}
