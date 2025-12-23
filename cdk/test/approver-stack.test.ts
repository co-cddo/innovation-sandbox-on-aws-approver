import { describe, it, beforeAll, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { ApproverStack } from '../lib/approver-stack.js';
import { DEFAULT_CONFIG } from '../config/environments.js';

describe('ApproverStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new ApproverStack(app, 'TestStack', {
      config: DEFAULT_CONFIG,
      env: { account: '123456789012', region: 'us-west-2' },
    });
    template = Template.fromStack(stack);
  });

  describe('Lambda Function', () => {
    it('creates Lambda function with Node.js 20 runtime', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'nodejs20.x',
      });
    });

    it('sets 30 second timeout', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Timeout: 30,
      });
    });

    it('sets 512MB memory', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        MemorySize: 512,
      });
    });

    it('uses ARM64 architecture', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Architectures: ['arm64'],
      });
    });

    it('includes required environment variables', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            AUTO_APPROVE_THRESHOLD: '20',
            BUSINESS_HOURS_START: '7',
            BUSINESS_HOURS_END: '19',
            BUSINESS_HOURS_TZ: 'Europe/London',
            BEDROCK_MODEL_ID: 'amazon.nova-micro-v1:0',
            LOG_LEVEL: 'INFO',
          }),
        },
      });
    });
  });

  describe('DynamoDB Idempotency Table', () => {
    it('creates idempotency table with correct partition key', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'ApproverIdempotency',
        KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      });
    });

    it('enables TTL on expiration attribute', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TimeToLiveSpecification: {
          AttributeName: 'expiration',
          Enabled: true,
        },
      });
    });

    it('uses PAY_PER_REQUEST billing mode', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        BillingMode: 'PAY_PER_REQUEST',
      });
    });
  });

  describe('S3 Domain List Bucket', () => {
    it('creates S3 bucket with encryption', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            {
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: 'AES256',
              },
            },
          ],
        },
      });
    });

    it('blocks public access', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      });
    });
  });

  describe('SQS Queues', () => {
    it('creates delay queue with 30 second delivery delay', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'ApproverDelayQueue',
        DelaySeconds: 30,
      });
    });

    it('creates DLQ for delay queue', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'ApproverDelayQueueDLQ',
      });
    });

    it('configures redrive policy with 3 max receives', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        RedrivePolicy: Match.objectLike({
          maxReceiveCount: 3,
        }),
      });
    });
  });

  describe('EventBridge Rules', () => {
    it('creates LeaseRequested rule', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        Name: 'ApproverLeaseRequested',
        EventPattern: {
          source: ['innovation-sandbox'],
          'detail-type': ['LeaseRequested'],
        },
      });
    });

    it('creates CleanupSucceeded rule', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        Name: 'ApproverCleanupSucceeded',
        EventPattern: {
          source: ['innovation-sandbox'],
          'detail-type': ['AccountCleanupSucceeded'],
        },
      });
    });
  });

  describe('EventBridge Scheduler', () => {
    it('creates 30-minute queue check schedule', () => {
      template.hasResourceProperties('AWS::Scheduler::Schedule', {
        Name: 'ApproverQueueCheck',
        ScheduleExpression: 'rate(30 minutes)',
      });
    });
  });

  describe('IAM Policies - Least Privilege', () => {
    it('grants Bedrock invoke for Nova Micro model', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'bedrock:InvokeModel',
              Effect: 'Allow',
              Resource: Match.stringLikeRegexp('.*foundation-model/amazon.nova-micro.*'),
            }),
          ]),
        },
      });
    });

    it('grants Secrets Manager read for approver secrets', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'secretsmanager:GetSecretValue',
              Effect: 'Allow',
              Resource: Match.stringLikeRegexp('.*secret:/approver/.*'),
            }),
          ]),
        },
      });
    });

    it('grants EventBridge put events', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'events:PutEvents',
              Effect: 'Allow',
              Resource: Match.stringLikeRegexp('.*event-bus/default'),
            }),
          ]),
        },
      });
    });
  });

  describe('Stack Outputs', () => {
    it('outputs Lambda function name', () => {
      template.hasOutput('LambdaFunctionName', {});
    });

    it('outputs idempotency table name', () => {
      template.hasOutput('IdempotencyTableName', {});
    });

    it('outputs domain list bucket name', () => {
      template.hasOutput('DomainListBucketName', {});
    });

    it('outputs delay queue URL', () => {
      template.hasOutput('DelayQueueUrl', {});
    });
  });

  // NOTE: Snapshot test intentionally removed - Lambda code asset hashes change with every
  // code modification, causing CI friction. The property-based tests above provide
  // comprehensive coverage of infrastructure configuration.
});
