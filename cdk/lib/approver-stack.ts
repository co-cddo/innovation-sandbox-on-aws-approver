import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ApproverLambda } from './constructs/approver-lambda.js';
import type { ApproverConfig } from '../config/environments.js';

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
    // Lambda Function
    // ==========================================
    const approverLambda = new ApproverLambda(this, 'ApproverLambda', {
      config,
      idempotencyTableName: idempotencyTable.tableName,
      delayQueueUrl: delayQueue.queueUrl,
      domainListBucketName: domainListBucket.bucketName,
    });

    // Grant permissions to Lambda
    idempotencyTable.grantReadWriteData(approverLambda.function);
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
      'arn:aws:events:us-west-2:568672915267:event-bus/InnovationSandboxComputeISBEventBus6697FE33'
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
  }
}
