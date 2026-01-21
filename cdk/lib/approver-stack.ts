import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as chatbot from 'aws-cdk-lib/aws-chatbot';
import { Construct } from 'constructs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ApproverLambda } from './constructs/approver-lambda.js';
import { SlackApproveLambda } from './constructs/slack-approve-lambda.js';
import { SlackDenyLambda } from './constructs/slack-deny-lambda.js';
import type { ApproverConfig } from '../config/environments.js';
import { SLACK_CONFIG } from '../config/environments.js';

export interface ApproverStackProps extends cdk.StackProps {
  config: ApproverConfig;
}

export class ApproverStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApproverStackProps) {
    super(scope, id, props);

    const { config } = props;

    // ==========================================
    // DynamoDB Idempotency Table
    // ==========================================
    const idempotencyTable = new dynamodb.Table(this, 'IdempotencyTable', {
      tableName: 'ApproverIdempotency',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev; change to RETAIN for prod
      timeToLiveAttribute: 'expiration',
    });

    // ==========================================
    // DynamoDB Queue Position Table (Story 6.3 - FR62, FR67)
    // Tracks queue position for FIFO processing when accounts are in cooldown
    // ==========================================
    const queuePositionTable = new dynamodb.Table(this, 'QueuePositionTable', {
      tableName: 'ApproverQueuePosition',
      partitionKey: { name: 'leaseId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev; change to RETAIN for prod
      timeToLiveAttribute: 'ttl',
    });

    // GSI for FIFO ordering: query by status, sorted by position
    queuePositionTable.addGlobalSecondaryIndex({
      indexName: 'PositionIndex',
      partitionKey: { name: 'positionStatus', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'position', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ==========================================
    // S3 Domain List Bucket
    // ==========================================
    const domainListBucket = new s3.Bucket(this, 'DomainListBucket', {
      bucketName: `approver-domain-list-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev; change to RETAIN for prod
      autoDeleteObjects: true, // For dev; remove for prod
    });

    // Deploy domain list JSON from ukps-domains repo
    // Source: https://github.com/govuk-digital-backbone/ukps-domains
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    new s3deploy.BucketDeployment(this, 'DomainListDeployment', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../assets'))],
      destinationBucket: domainListBucket,
      prune: false, // Don't delete other files
    });

    // ==========================================
    // SQS Delay Queue with DLQ
    // ==========================================
    const delayQueueDlq = new sqs.Queue(this, 'DelayQueueDLQ', {
      queueName: 'ApproverDelayQueueDLQ',
      retentionPeriod: cdk.Duration.days(14),
    });

    const delayQueue = new sqs.Queue(this, 'DelayQueue', {
      queueName: 'ApproverDelayQueue',
      visibilityTimeout: cdk.Duration.minutes(5),
      deliveryDelay: cdk.Duration.seconds(30),
      deadLetterQueue: {
        queue: delayQueueDlq,
        maxReceiveCount: 3,
      },
    });

    // ==========================================
    // SNS Topic for Approval Notifications (Story 7.1.1)
    // Declared early so we can pass ARN to Lambda construct
    // ==========================================
    const notificationTopic = new sns.Topic(this, 'NotificationTopic', {
      topicName: 'isb-approval-notifications',
      displayName: 'ISB Approval Notifications',
    });

    // Add cost tracking tags (Story 7.1.1 AC1)
    cdk.Tags.of(notificationTopic).add('Project', 'innovation-sandbox-approver');
    cdk.Tags.of(notificationTopic).add('Component', 'notifications');

    // ==========================================
    // Slack Channel Configuration (Story 7.1.2)
    // Amazon Q Developer integration for Slack notifications
    // ==========================================

    // Guardrail policy for Lambda invoke (Story 7.1.2 AC3)
    // Allows custom actions to invoke approve/deny Lambdas (Stories 7.2.1/7.2.2)
    const slackLambdaInvokePolicy = new iam.ManagedPolicy(
      this,
      'SlackLambdaInvokePolicy',
      {
        managedPolicyName: 'ApproverSlackLambdaInvoke',
        statements: [
          new iam.PolicyStatement({
            sid: 'AllowLambdaInvoke',
            effect: iam.Effect.ALLOW,
            actions: ['lambda:InvokeFunction'],
            resources: [
              // Future action Lambdas (Stories 7.2.1/7.2.2)
              `arn:aws:lambda:${this.region}:${this.account}:function:ApproverSlack*`,
              // ISB Leases Lambda (existing)
              `arn:aws:lambda:${this.region}:${this.account}:function:${config.isbLeasesLambdaName}`,
            ],
          }),
        ],
      }
    );

    // Slack channel configuration (Story 7.1.2 AC1, AC2)
    const slackChannel = new chatbot.SlackChannelConfiguration(
      this,
      'SlackChannel',
      {
        slackChannelConfigurationName: 'ISBApproverSlack',
        slackWorkspaceId: SLACK_CONFIG.workspaceId,
        slackChannelId: SLACK_CONFIG.channelId,
        guardrailPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('ReadOnlyAccess'),
          slackLambdaInvokePolicy,
        ],
        loggingLevel: chatbot.LoggingLevel.INFO,
      }
    );

    // Subscribe to notification SNS topic (Story 7.1.2 AC2)
    slackChannel.addNotificationTopic(notificationTopic);

    // Grant the Slack channel configuration role permission to invoke our action Lambdas (Story 7.2.3)
    // This is required in addition to guardrail policies which only set upper bounds
    slackChannel.role.attachInlinePolicy(
      new iam.Policy(this, 'SlackChannelLambdaInvokePolicy', {
        statements: [
          new iam.PolicyStatement({
            sid: 'AllowSlackActionLambdaInvoke',
            effect: iam.Effect.ALLOW,
            actions: ['lambda:InvokeFunction'],
            resources: [
              `arn:aws:lambda:${this.region}:${this.account}:function:ApproverSlack*`,
            ],
          }),
        ],
      })
    );

    // ==========================================
    // Lambda Function
    // ==========================================
    const approverLambda = new ApproverLambda(this, 'ApproverLambda', {
      config,
      idempotencyTableName: idempotencyTable.tableName,
      queuePositionTableName: queuePositionTable.tableName,
      delayQueueUrl: delayQueue.queueUrl,
      domainListBucketName: domainListBucket.bucketName,
      notificationTopicArn: notificationTopic.topicArn,
    });

    // Grant publish permission to approver Lambda (Story 7.1.1 AC4)
    notificationTopic.grantPublish(approverLambda.function);

    // ==========================================
    // Slack Approve Lambda (Story 7.2.1)
    // Handles "Approve" button clicks from Slack via Amazon Q Developer
    // ==========================================
    const slackApproveLambda = new SlackApproveLambda(this, 'SlackApproveLambda', {
      isbLeasesLambdaName: config.isbLeasesLambdaName,
      approverEmail: 'ndx+try-automated-approver@dsit.gov.uk',
      snsTopicArn: notificationTopic.topicArn,
      logLevel: config.logLevel,
    });

    // ==========================================
    // Slack Deny Lambda (Story 7.2.2)
    // Handles "Deny" button clicks from Slack via Amazon Q Developer
    // ==========================================
    const slackDenyLambda = new SlackDenyLambda(this, 'SlackDenyLambda', {
      isbLeasesLambdaName: config.isbLeasesLambdaName,
      approverEmail: 'ndx+try-automated-approver@dsit.gov.uk',
      snsTopicArn: notificationTopic.topicArn,
      logLevel: config.logLevel,
    });

    // ==========================================
    // Custom Actions for Slack Buttons (Story 7.2.3)
    // These create Approve/Deny buttons that appear on notifications
    // ==========================================

    // Approve Custom Action - button to approve a lease request
    new chatbot.CfnCustomAction(this, 'ApproveCustomAction', {
      actionName: 'isb-approve',
      definition: {
        commandText: `lambda invoke --function-name ${slackApproveLambda.function.functionName} --payload {"leaseId": "$leaseId"} --region ${this.region}`,
      },
      aliasName: 'approve-lease',
      attachments: [
        {
          buttonText: '✅ Approve',
          notificationType: 'custom',
          variables: {
            leaseId: '$.metadata.additionalContext.leaseId',
          },
          // Show button only when leaseId is present in the notification
          criteria: [
            {
              operator: 'HAS_VALUE',
              variableName: 'leaseId',
            },
          ],
        },
      ],
    });

    // Deny Custom Action - button to deny a lease request
    new chatbot.CfnCustomAction(this, 'DenyCustomAction', {
      actionName: 'isb-deny',
      definition: {
        commandText: `lambda invoke --function-name ${slackDenyLambda.function.functionName} --payload {"leaseId": "$leaseId"} --region ${this.region}`,
      },
      aliasName: 'deny-lease',
      attachments: [
        {
          buttonText: '❌ Deny',
          notificationType: 'custom',
          variables: {
            leaseId: '$.metadata.additionalContext.leaseId',
          },
          // Show button only when leaseId is present in the notification
          criteria: [
            {
              operator: 'HAS_VALUE',
              variableName: 'leaseId',
            },
          ],
        },
      ],
    });

    // Grant permissions to Lambda
    idempotencyTable.grantReadWriteData(approverLambda.function);
    queuePositionTable.grantReadWriteData(approverLambda.function);
    domainListBucket.grantRead(approverLambda.function);
    delayQueue.grantSendMessages(approverLambda.function);
    delayQueue.grantConsumeMessages(approverLambda.function);

    // ==========================================
    // EventBridge Rules (on ISB custom event bus)
    // ==========================================

    // Import the ISB event bus
    const isbEventBus = events.EventBus.fromEventBusArn(
      this,
      'ISBEventBus',
      `arn:aws:events:${this.region}:${this.account}:event-bus/${config.isbEventBusName}`
    );

    // LeaseRequested Rule - no source filter to catch events from any source
    const leaseRequestedRule = new events.Rule(this, 'LeaseRequestedRule', {
      ruleName: 'ApproverLeaseRequested',
      eventBus: isbEventBus,
      eventPattern: {
        detailType: ['LeaseRequested'],
      },
    });
    leaseRequestedRule.addTarget(new targets.LambdaFunction(approverLambda.function));

    // AccountCleanupSucceeded Rule - no source filter to catch events from any source
    const cleanupSucceededRule = new events.Rule(this, 'CleanupSucceededRule', {
      ruleName: 'ApproverCleanupSucceeded',
      eventBus: isbEventBus,
      eventPattern: {
        detailType: ['AccountCleanupSucceeded'],
      },
    });
    cleanupSucceededRule.addTarget(new targets.LambdaFunction(approverLambda.function));

    // ==========================================
    // EventBridge Scheduler (30-minute queue check)
    // ==========================================
    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });

    approverLambda.function.grantInvoke(schedulerRole);

    new scheduler.CfnSchedule(this, 'QueueCheckSchedule', {
      name: 'ApproverQueueCheck',
      scheduleExpression: 'rate(30 minutes)',
      flexibleTimeWindow: {
        mode: 'OFF',
      },
      target: {
        arn: approverLambda.function.functionArn,
        roleArn: schedulerRole.roleArn,
        input: JSON.stringify({
          source: 'scheduled.queue-check',
          'detail-type': 'ScheduledQueueCheck',
          detail: {},
        }),
      },
    });

    // ==========================================
    // CloudWatch Alarms (Story 5.3, NFR-OBS-03)
    // ==========================================

    // SNS Topic for alarm notifications
    const alarmTopic = new sns.Topic(this, 'ApproverAlarmTopic', {
      topicName: 'ApproverAlarms',
      displayName: 'Approver Service Alarms',
    });

    // DLQ Depth Alarm - triggers when DLQ has more than 5 messages
    const dlqDepthAlarm = new cloudwatch.Alarm(this, 'DlqDepthAlarm', {
      alarmName: 'Approver-DLQ-Depth',
      alarmDescription: 'DLQ has more than 5 messages - indicates processing failures',
      metric: delayQueueDlq.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
        statistic: 'Maximum',
      }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    dlqDepthAlarm.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(alarmTopic));

    // Lambda Error Rate Alarm - triggers when errors exceed 1% over 5 minutes
    const errorRateAlarm = new cloudwatch.Alarm(this, 'ErrorRateAlarm', {
      alarmName: 'Approver-Error-Rate',
      alarmDescription: 'Lambda error rate exceeded threshold',
      metric: new cloudwatch.MathExpression({
        expression: '(errors / invocations) * 100',
        usingMetrics: {
          errors: approverLambda.function.metricErrors({
            period: cdk.Duration.minutes(5),
            statistic: 'Sum',
          }),
          invocations: approverLambda.function.metricInvocations({
            period: cdk.Duration.minutes(5),
            statistic: 'Sum',
          }),
        },
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    errorRateAlarm.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(alarmTopic));

    // Lambda Duration Alarm - triggers when p95 latency exceeds 5 seconds (NFR-PERF-01)
    const durationAlarm = new cloudwatch.Alarm(this, 'DurationAlarm', {
      alarmName: 'Approver-High-Latency',
      alarmDescription: 'Lambda p95 latency exceeded 5 seconds',
      metric: approverLambda.function.metricDuration({
        period: cdk.Duration.minutes(5),
        statistic: 'p95',
      }),
      threshold: 5000, // 5 seconds in milliseconds
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    durationAlarm.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(alarmTopic));

    // ==========================================
    // Stack Outputs
    // ==========================================
    new cdk.CfnOutput(this, 'LambdaFunctionName', {
      value: approverLambda.function.functionName,
      description: 'Approver Lambda function name',
    });

    new cdk.CfnOutput(this, 'IdempotencyTableName', {
      value: idempotencyTable.tableName,
      description: 'Idempotency DynamoDB table name',
    });

    new cdk.CfnOutput(this, 'QueuePositionTableName', {
      value: queuePositionTable.tableName,
      description: 'Queue position DynamoDB table name (Story 6.3)',
    });

    new cdk.CfnOutput(this, 'DomainListBucketName', {
      value: domainListBucket.bucketName,
      description: 'Domain list S3 bucket name',
    });

    new cdk.CfnOutput(this, 'DelayQueueUrl', {
      value: delayQueue.queueUrl,
      description: 'Delay queue URL',
    });

    new cdk.CfnOutput(this, 'DelayQueueDlqUrl', {
      value: delayQueueDlq.queueUrl,
      description: 'Delay queue DLQ URL',
    });

    new cdk.CfnOutput(this, 'AlarmTopicArn', {
      value: alarmTopic.topicArn,
      description: 'SNS topic for alarm notifications',
    });

    new cdk.CfnOutput(this, 'NotificationTopicArn', {
      value: notificationTopic.topicArn,
      description: 'SNS topic for approval notifications (Story 7.1.1)',
    });

    new cdk.CfnOutput(this, 'LogGroupName', {
      value: approverLambda.logGroup.logGroupName,
      description: 'CloudWatch Log Group for approver Lambda (7-year retention)',
    });

    // Slack Channel Configuration Outputs (Story 7.1.2 AC4)
    new cdk.CfnOutput(this, 'SlackChannelConfigArn', {
      value: slackChannel.slackChannelConfigurationArn,
      description: 'Slack channel configuration ARN (Story 7.1.2)',
    });

    new cdk.CfnOutput(this, 'CustomActionsConsoleUrl', {
      value: `https://${this.region}.console.aws.amazon.com/chatbot/home?region=${this.region}#/chat-clients`,
      description: 'AWS Console URL to configure custom actions (Story 7.1.2)',
    });

    new cdk.CfnOutput(this, 'SlackWorkspaceId', {
      value: SLACK_CONFIG.workspaceId,
      description: 'Slack workspace ID for reference (Story 7.1.2)',
    });

    new cdk.CfnOutput(this, 'SlackChannelId', {
      value: SLACK_CONFIG.channelId,
      description: 'Slack channel ID for reference (Story 7.1.2)',
    });

    // Slack Approve Lambda Outputs (Story 7.2.1)
    new cdk.CfnOutput(this, 'SlackApproveLambdaArn', {
      value: slackApproveLambda.function.functionArn,
      description: 'Slack Approve Lambda ARN (for custom action configuration)',
    });

    new cdk.CfnOutput(this, 'SlackApproveLambdaName', {
      value: slackApproveLambda.function.functionName,
      description: 'Slack Approve Lambda function name (Story 7.2.1)',
    });

    // Slack Deny Lambda Outputs (Story 7.2.2)
    new cdk.CfnOutput(this, 'SlackDenyLambdaArn', {
      value: slackDenyLambda.function.functionArn,
      description: 'Slack Deny Lambda ARN (for custom action configuration)',
    });

    new cdk.CfnOutput(this, 'SlackDenyLambdaName', {
      value: slackDenyLambda.function.functionName,
      description: 'Slack Deny Lambda function name (Story 7.2.2)',
    });
  }
}
