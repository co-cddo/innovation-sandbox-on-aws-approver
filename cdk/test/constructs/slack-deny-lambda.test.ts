import { describe, it, beforeAll } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { SlackDenyLambda } from '../../lib/constructs/slack-deny-lambda.js';

describe('SlackDenyLambda Construct', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
    });

    new SlackDenyLambda(stack, 'TestSlackDeny', {
      isbLeasesLambdaName: 'ISB-LeasesLambdaFunction-test',
      approverEmail: 'test-approver@dsit.gov.uk',
      snsTopicArn: 'arn:aws:sns:us-west-2:123456789012:test-topic',
      logLevel: 'DEBUG',
    });

    template = Template.fromStack(stack);
  });

  describe('Lambda Function Creation (AC1)', () => {
    it('creates Lambda function with correct name', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'ApproverSlackDeny',
      });
    });

    it('uses Node.js 20.x runtime', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'nodejs20.x',
      });
    });

    it('sets 30 second timeout', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Timeout: 30,
      });
    });

    it('sets 256MB memory', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        MemorySize: 256,
      });
    });

    it('uses ARM64 architecture', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Architectures: ['arm64'],
      });
    });

    it('enables X-Ray tracing', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        TracingConfig: {
          Mode: 'Active',
        },
      });
    });
  });

  describe('Environment Variables (AC5)', () => {
    it('includes ISB_LEASES_LAMBDA_NAME', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            ISB_LEASES_LAMBDA_NAME: 'ISB-LeasesLambdaFunction-test',
          }),
        },
      });
    });

    it('includes APPROVER_EMAIL', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            APPROVER_EMAIL: 'test-approver@dsit.gov.uk',
          }),
        },
      });
    });

    it('includes SNS_TOPIC_ARN', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            SNS_TOPIC_ARN: 'arn:aws:sns:us-west-2:123456789012:test-topic',
          }),
        },
      });
    });

    it('includes LOG_LEVEL', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            LOG_LEVEL: 'DEBUG',
          }),
        },
      });
    });

    it('includes NODE_OPTIONS for source maps', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            NODE_OPTIONS: '--enable-source-maps',
          }),
        },
      });
    });
  });

  describe('IAM Permissions (AC5)', () => {
    it('grants lambda:InvokeFunction permission for ISB Lambda', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'lambda:InvokeFunction',
              Effect: 'Allow',
              Resource: 'arn:aws:lambda:us-west-2:123456789012:function:ISB-LeasesLambdaFunction-test',
            }),
          ]),
        },
      });
    });
  });

  describe('CloudWatch Log Group', () => {
    it('creates log group with correct name', () => {
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: '/aws/lambda/ApproverSlackDeny',
      });
    });

    it('sets 7 year retention for GDPR compliance', () => {
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        RetentionInDays: 2557, // 7 years
      });
    });
  });

  describe('Tags', () => {
    it('includes Project tag', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Tags: Match.arrayWith([
          Match.objectLike({
            Key: 'Project',
            Value: 'innovation-sandbox-approver',
          }),
        ]),
      });
    });

    it('includes Component tag', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Tags: Match.arrayWith([
          Match.objectLike({
            Key: 'Component',
            Value: 'slack-actions',
          }),
        ]),
      });
    });

    it('includes Story tag', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Tags: Match.arrayWith([
          Match.objectLike({
            Key: 'Story',
            Value: '7.2.2',
          }),
        ]),
      });
    });
  });
});

describe('SlackDenyLambda with default log level', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack2', {
      env: { account: '123456789012', region: 'us-west-2' },
    });

    // Test with default log level (not provided)
    new SlackDenyLambda(stack, 'TestSlackDeny', {
      isbLeasesLambdaName: 'ISB-LeasesLambdaFunction-test',
      approverEmail: 'test-approver@dsit.gov.uk',
      snsTopicArn: 'arn:aws:sns:us-west-2:123456789012:test-topic',
    });

    template = Template.fromStack(stack);
  });

  it('defaults LOG_LEVEL to INFO when not provided', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          LOG_LEVEL: 'INFO',
        }),
      },
    });
  });
});
