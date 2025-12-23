import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import type { ApproverConfig } from '../../config/environments.js';

export interface ApproverLambdaProps {
  config: ApproverConfig;
  idempotencyTableName: string;
  delayQueueUrl: string;
  domainListBucketName: string;
}

export class ApproverLambda extends Construct {
  public readonly function: lambda.Function;

  constructor(scope: Construct, id: string, props: ApproverLambdaProps) {
    super(scope, id);

    const { config, idempotencyTableName, delayQueueUrl, domainListBucketName } = props;

    this.function = new lambda.Function(this, 'Function', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      architecture: lambda.Architecture.ARM_64,
      environment: {
        AUTO_APPROVE_THRESHOLD: config.autoApproveThreshold.toString(),
        BUSINESS_HOURS_START: config.businessHoursStart.toString(),
        BUSINESS_HOURS_END: config.businessHoursEnd.toString(),
        BUSINESS_HOURS_TZ: config.businessHoursTz,
        ISB_CONSOLE_URL: config.isbConsoleUrl,
        ISB_LEASES_TABLE_NAME: config.isbLeasesTableName,
        ISB_ACCOUNTS_TABLE_NAME: config.isbAccountsTableName,
        IDEMPOTENCY_TABLE_NAME: idempotencyTableName,
        DELAY_QUEUE_URL: delayQueueUrl,
        DOMAIN_ALLOWLIST_BUCKET: domainListBucketName,
        SLACK_WEBHOOK_SECRET_ARN: config.slackWebhookSecretArn,
        BEDROCK_MODEL_ID: config.bedrockModelId,
        LOG_LEVEL: config.logLevel,
        RULE_WEIGHTS: config.ruleWeights,
        // ISB event bus for emitting escalation events
        EVENT_BUS_NAME: 'InnovationSandboxComputeISBEventBus6697FE33',
        // ISB Leases Lambda for direct approval invocation
        ISB_LEASES_LAMBDA_NAME: config.isbLeasesLambdaName,
      },
      tracing: lambda.Tracing.ACTIVE,
    });

    // Grant Bedrock invoke permissions for Nova Micro (via cross-region inference profile)
    // The us.amazon.nova-micro-v1:0 profile routes to any US region, so we need both
    this.function.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [
          // Foundation model ARNs for cross-region inference routing
          'arn:aws:bedrock:us-west-2::foundation-model/amazon.nova-micro-v1:0',
          'arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-micro-v1:0',
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
          `arn:aws:events:us-west-2:${cdk.Stack.of(this).account}:event-bus/InnovationSandboxComputeISBEventBus6697FE33`,
        ],
      })
    );

    // Grant Lambda invoke permission for ISB Leases Lambda (direct approval)
    this.function.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [
          `arn:aws:lambda:us-west-2:${cdk.Stack.of(this).account}:function:${config.isbLeasesLambdaName}`,
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

    // Grant ISB Accounts table read (GetItem/Query only - no Scan for least-privilege)
    this.function.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:GetItem', 'dynamodb:Query'],
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
          `arn:aws:kms:us-west-2:${cdk.Stack.of(this).account}:key/4682f54a-cf9a-4a2f-941c-aba8795ac878`,
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
