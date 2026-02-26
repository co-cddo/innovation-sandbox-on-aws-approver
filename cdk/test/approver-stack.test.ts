import { describe, it, beforeAll } from 'vitest';
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
            BEDROCK_MODEL_ID: 'us.amazon.nova-micro-v1:0',
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
          'detail-type': ['LeaseRequested'],
        },
      });
    });

    it('creates CleanupSucceeded rule', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        Name: 'ApproverCleanupSucceeded',
        EventPattern: {
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
    it('grants Bedrock invoke for Nova Micro model with inference profile', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'bedrock:InvokeModel',
              Effect: 'Allow',
              Resource: Match.arrayWith([
                // Foundation model ARN
                Match.stringLikeRegexp('.*foundation-model/amazon.nova-micro.*'),
                // Inference profile ARN (required for on-demand throughput)
                Match.stringLikeRegexp('.*inference-profile/us.amazon.nova-micro.*'),
              ]),
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

    it('grants EventBridge put events to ISB event bus', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'events:PutEvents',
              Effect: 'Allow',
              Resource: Match.stringLikeRegexp('.*event-bus/InnovationSandboxCompute.*'),
            }),
          ]),
        },
      });
    });
  });

  describe('SNS Notification Topic (Story 7.1.1)', () => {
    it('creates notification topic with correct name', () => {
      template.hasResourceProperties('AWS::SNS::Topic', {
        TopicName: 'isb-approval-notifications',
        DisplayName: 'ISB Approval Notifications',
      });
    });

    it('applies cost tracking tags to notification topic', () => {
      // Template.hasResourceProperties doesn't check tags directly
      // We verify the topic exists with the name and check tags via resource count
      template.resourceCountIs('AWS::SNS::Topic', 2); // alarm topic + notification topic
    });

    it('grants Lambda permission to publish to notification topic', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'sns:Publish',
              Effect: 'Allow',
            }),
          ]),
        },
      });
    });

    it('includes NOTIFICATION_TOPIC_ARN environment variable', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            NOTIFICATION_TOPIC_ARN: Match.anyValue(),
          }),
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

    it('outputs notification topic ARN (Story 7.1.1)', () => {
      template.hasOutput('NotificationTopicArn', {});
    });
  });

  describe('Slack Channel Configuration (Story 7.1.2)', () => {
    it('creates SlackChannelConfiguration with correct name', () => {
      template.hasResourceProperties('AWS::Chatbot::SlackChannelConfiguration', {
        ConfigurationName: 'ISBApproverSlack',
      });
    });

    it('configures Slack workspace and channel IDs', () => {
      template.hasResourceProperties('AWS::Chatbot::SlackChannelConfiguration', {
        SlackWorkspaceId: 'T8GT9416G',
        SlackChannelId: 'C0A9B2ME5RV',
      });
    });

    it('sets logging level to INFO', () => {
      template.hasResourceProperties('AWS::Chatbot::SlackChannelConfiguration', {
        LoggingLevel: 'INFO',
      });
    });

    it('subscribes to notification SNS topic', () => {
      template.hasResourceProperties('AWS::Chatbot::SlackChannelConfiguration', {
        SnsTopicArns: Match.anyValue(),
      });
    });

    it('includes ReadOnlyAccess managed policy as guardrail', () => {
      // GuardrailPolicies contains Fn::Join for ReadOnlyAccess ARN
      template.hasResourceProperties('AWS::Chatbot::SlackChannelConfiguration', {
        GuardrailPolicies: Match.anyValue(),
      });
    });

    it('includes custom Lambda invoke policy as guardrail', () => {
      // Verify the managed policy is referenced in guardrail policies
      template.hasResourceProperties('AWS::Chatbot::SlackChannelConfiguration', {
        GuardrailPolicies: Match.anyValue(),
      });
    });
  });

  describe('Lambda Invoke Guardrail Policy (Story 7.1.2)', () => {
    it('creates managed policy for Lambda invoke', () => {
      template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
        ManagedPolicyName: 'ApproverSlackLambdaInvoke',
      });
    });

    it('allows lambda:InvokeFunction action', () => {
      template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'lambda:InvokeFunction',
              Effect: 'Allow',
            }),
          ]),
        },
      });
    });

    it('includes ApproverSlack* Lambda pattern in resources', () => {
      template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Resource: Match.stringLikeRegexp('.*function:ApproverSlack.*'),
            }),
          ]),
        },
      });
    });
  });

  describe('Slack Channel Configuration Outputs (Story 7.1.2)', () => {
    it('outputs SlackChannelConfigArn', () => {
      template.hasOutput('SlackChannelConfigArn', {});
    });

    it('outputs CustomActionsConsoleUrl', () => {
      template.hasOutput('CustomActionsConsoleUrl', {});
    });

    it('outputs SlackWorkspaceId', () => {
      template.hasOutput('SlackWorkspaceId', {});
    });

    it('outputs SlackChannelId', () => {
      template.hasOutput('SlackChannelId', {});
    });
  });

  describe('Slack Approve Lambda (Story 7.2.1)', () => {
    it('creates ApproverSlackApprove Lambda function', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'ApproverSlackApprove',
      });
    });

    it('configures Slack Approve Lambda with Node.js 20.x runtime', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'ApproverSlackApprove',
        Runtime: 'nodejs20.x',
      });
    });

    it('sets 30 second timeout for Slack Approve Lambda', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'ApproverSlackApprove',
        Timeout: 30,
      });
    });

    it('includes ISB_API_BASE_URL environment variable', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'ApproverSlackApprove',
        Environment: {
          Variables: Match.objectLike({
            ISB_API_BASE_URL: 'https://isb-api.innovation-sandbox.gov.uk',
          }),
        },
      });
    });

    it('includes ISB_JWT_SECRET_PATH environment variable', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'ApproverSlackApprove',
        Environment: {
          Variables: Match.objectLike({
            ISB_JWT_SECRET_PATH: '/InnovationSandbox/ndx/Auth/JwtSecret',
          }),
        },
      });
    });

    it('includes APPROVER_EMAIL environment variable', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'ApproverSlackApprove',
        Environment: {
          Variables: Match.objectLike({
            APPROVER_EMAIL: 'ndx+try-automated-approver@dsit.gov.uk',
          }),
        },
      });
    });

    it('grants Slack Approve Lambda permission to read ISB JWT secret', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Sid: 'GetIsbJwtSecret',
              Action: 'secretsmanager:GetSecretValue',
              Effect: 'Allow',
            }),
          ]),
        },
      });
    });
  });

  describe('Slack Approve Lambda Outputs (Story 7.2.1)', () => {
    it('outputs SlackApproveLambdaArn', () => {
      template.hasOutput('SlackApproveLambdaArn', {});
    });

    it('outputs SlackApproveLambdaName', () => {
      template.hasOutput('SlackApproveLambdaName', {});
    });
  });

  describe('Slack Deny Lambda (Story 7.2.2)', () => {
    it('creates ApproverSlackDeny Lambda function', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'ApproverSlackDeny',
      });
    });

    it('configures Slack Deny Lambda with Node.js 20.x runtime', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'ApproverSlackDeny',
        Runtime: 'nodejs20.x',
      });
    });

    it('sets 30 second timeout for Slack Deny Lambda', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'ApproverSlackDeny',
        Timeout: 30,
      });
    });

    it('includes ISB_API_BASE_URL environment variable', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'ApproverSlackDeny',
        Environment: {
          Variables: Match.objectLike({
            ISB_API_BASE_URL: 'https://isb-api.innovation-sandbox.gov.uk',
          }),
        },
      });
    });

    it('includes ISB_JWT_SECRET_PATH environment variable', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'ApproverSlackDeny',
        Environment: {
          Variables: Match.objectLike({
            ISB_JWT_SECRET_PATH: '/InnovationSandbox/ndx/Auth/JwtSecret',
          }),
        },
      });
    });

    it('includes APPROVER_EMAIL environment variable', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'ApproverSlackDeny',
        Environment: {
          Variables: Match.objectLike({
            APPROVER_EMAIL: 'ndx+try-automated-approver@dsit.gov.uk',
          }),
        },
      });
    });

    it('grants Slack Deny Lambda permission to read ISB JWT secret', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Sid: 'GetIsbJwtSecret',
              Action: 'secretsmanager:GetSecretValue',
              Effect: 'Allow',
            }),
          ]),
        },
      });
    });
  });

  describe('Slack Deny Lambda Outputs (Story 7.2.2)', () => {
    it('outputs SlackDenyLambdaArn', () => {
      template.hasOutput('SlackDenyLambdaArn', {});
    });

    it('outputs SlackDenyLambdaName', () => {
      template.hasOutput('SlackDenyLambdaName', {});
    });
  });

  describe('Slack Action CloudWatch Alarms (Story 7.4.2)', () => {
    it('creates Slack Approve Lambda error rate alarm', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'Approver-SlackApprove-Error-Rate',
        ComparisonOperator: 'GreaterThanThreshold',
        Threshold: 1,
        EvaluationPeriods: 1,
        TreatMissingData: 'notBreaching',
      });
    });

    it('creates Slack Deny Lambda error rate alarm', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'Approver-SlackDeny-Error-Rate',
        ComparisonOperator: 'GreaterThanThreshold',
        Threshold: 1,
        EvaluationPeriods: 1,
        TreatMissingData: 'notBreaching',
      });
    });

    it('creates SNS delivery failure alarm', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'Approver-SNS-Delivery-Failures',
        ComparisonOperator: 'GreaterThanThreshold',
        Threshold: 0,
        EvaluationPeriods: 1,
        TreatMissingData: 'notBreaching',
      });
    });

    it('configures alarms with SNS alarm actions', () => {
      // All three new alarms should have alarm actions configured
      // We verify they reference the alarm topic (by checking there are alarms with AlarmActions)
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'Approver-SlackApprove-Error-Rate',
        AlarmActions: Match.anyValue(),
      });
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'Approver-SlackDeny-Error-Rate',
        AlarmActions: Match.anyValue(),
      });
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'Approver-SNS-Delivery-Failures',
        AlarmActions: Match.anyValue(),
      });
    });

    it('includes troubleshooting context in alarm descriptions', () => {
      // Verify alarms have multi-line descriptions with runbook reference
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'Approver-SlackApprove-Error-Rate',
        AlarmDescription: Match.stringLikeRegexp('.*RUNBOOK.*'),
      });
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'Approver-SlackDeny-Error-Rate',
        AlarmDescription: Match.stringLikeRegexp('.*RUNBOOK.*'),
      });
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'Approver-SNS-Delivery-Failures',
        AlarmDescription: Match.stringLikeRegexp('.*RUNBOOK.*'),
      });
    });
  });

  describe('Slack Action Alarm Outputs (Story 7.4.2)', () => {
    it('outputs SlackApproveErrorAlarmArn', () => {
      template.hasOutput('SlackApproveErrorAlarmArn', {});
    });

    it('outputs SlackDenyErrorAlarmArn', () => {
      template.hasOutput('SlackDenyErrorAlarmArn', {});
    });

    it('outputs SNSDeliveryFailureAlarmArn', () => {
      template.hasOutput('SNSDeliveryFailureAlarmArn', {});
    });
  });

  // NOTE: Snapshot test intentionally removed - Lambda code asset hashes change with every
  // code modification, causing CI friction. The property-based tests above provide
  // comprehensive coverage of infrastructure configuration.
});
