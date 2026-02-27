import { describe, it, beforeAll } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { SlackActionLambda } from '../../lib/constructs/slack-action-lambda.js';

describe('SlackActionLambda Base Construct', () => {
  describe('Approve Action Type', () => {
    let template: Template;

    beforeAll(() => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack', {
        env: { account: '123456789012', region: 'us-west-2' },
      });

      new SlackActionLambda(stack, 'TestSlackAction', {
        actionType: 'approve',
        isbApiBaseUrl: 'https://isb-api.test.gov.uk',
        isbJwtSecretPath: '/test/JwtSecret',
        isbSecretsKmsKeyId: 'test-kms-key-id',
        approverEmail: 'test-approver@dsit.gov.uk',
        snsTopicArn: 'arn:aws:sns:us-west-2:123456789012:test-topic',
        logLevel: 'DEBUG',
      });

      template = Template.fromStack(stack);
    });

    it('creates Lambda function with correct name for approve action', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'ApproverSlackApprove',
      });
    });

    it('creates log group with correct name for approve action', () => {
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: '/aws/lambda/ApproverSlackApprove',
      });
    });

    it('includes Story tag for approve (7.2.1)', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Tags: Match.arrayWith([
          Match.objectLike({
            Key: 'Story',
            Value: '7.2.1',
          }),
        ]),
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

  describe('Deny Action Type', () => {
    let template: Template;

    beforeAll(() => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack', {
        env: { account: '123456789012', region: 'us-west-2' },
      });

      new SlackActionLambda(stack, 'TestSlackAction', {
        actionType: 'deny',
        isbApiBaseUrl: 'https://isb-api.test.gov.uk',
        isbJwtSecretPath: '/test/JwtSecret',
        isbSecretsKmsKeyId: 'test-kms-key-id',
        approverEmail: 'test-approver@dsit.gov.uk',
        snsTopicArn: 'arn:aws:sns:us-west-2:123456789012:test-topic',
        logLevel: 'DEBUG',
      });

      template = Template.fromStack(stack);
    });

    it('creates Lambda function with correct name for deny action', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'ApproverSlackDeny',
      });
    });

    it('creates log group with correct name for deny action', () => {
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: '/aws/lambda/ApproverSlackDeny',
      });
    });

    it('includes Story tag for deny (7.2.2)', () => {
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

  describe('Environment Variables', () => {
    let template: Template;

    beforeAll(() => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack', {
        env: { account: '123456789012', region: 'us-west-2' },
      });

      new SlackActionLambda(stack, 'TestSlackAction', {
        actionType: 'approve',
        isbApiBaseUrl: 'https://isb-api.test.gov.uk',
        isbJwtSecretPath: '/test/JwtSecret',
        isbSecretsKmsKeyId: 'test-kms-key-id',
        approverEmail: 'test-approver@dsit.gov.uk',
        snsTopicArn: 'arn:aws:sns:us-west-2:123456789012:test-topic',
        logLevel: 'DEBUG',
      });

      template = Template.fromStack(stack);
    });

    it('includes ISB_API_BASE_URL and ISB_JWT_SECRET_PATH', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            ISB_API_BASE_URL: 'https://isb-api.test.gov.uk',
            ISB_JWT_SECRET_PATH: '/test/JwtSecret',
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

  describe('IAM Permissions', () => {
    let template: Template;

    beforeAll(() => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack', {
        env: { account: '123456789012', region: 'us-west-2' },
      });

      new SlackActionLambda(stack, 'TestSlackAction', {
        actionType: 'approve',
        isbApiBaseUrl: 'https://isb-api.test.gov.uk',
        isbJwtSecretPath: '/test/JwtSecret',
        isbSecretsKmsKeyId: 'test-kms-key-id',
        approverEmail: 'test-approver@dsit.gov.uk',
        snsTopicArn: 'arn:aws:sns:us-west-2:123456789012:test-topic',
      });

      template = Template.fromStack(stack);
    });

    it('grants secretsmanager:GetSecretValue permission for ISB JWT secret', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'secretsmanager:GetSecretValue',
              Effect: 'Allow',
            }),
          ]),
        },
      });
    });
  });

  describe('CloudWatch Log Group', () => {
    let template: Template;

    beforeAll(() => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack', {
        env: { account: '123456789012', region: 'us-west-2' },
      });

      new SlackActionLambda(stack, 'TestSlackAction', {
        actionType: 'approve',
        isbApiBaseUrl: 'https://isb-api.test.gov.uk',
        isbJwtSecretPath: '/test/JwtSecret',
        isbSecretsKmsKeyId: 'test-kms-key-id',
        approverEmail: 'test-approver@dsit.gov.uk',
        snsTopicArn: 'arn:aws:sns:us-west-2:123456789012:test-topic',
      });

      template = Template.fromStack(stack);
    });

    it('sets 7 year retention for GDPR compliance', () => {
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        RetentionInDays: 2557, // 7 years
      });
    });
  });

  describe('Tags', () => {
    let template: Template;

    beforeAll(() => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack', {
        env: { account: '123456789012', region: 'us-west-2' },
      });

      new SlackActionLambda(stack, 'TestSlackAction', {
        actionType: 'approve',
        isbApiBaseUrl: 'https://isb-api.test.gov.uk',
        isbJwtSecretPath: '/test/JwtSecret',
        isbSecretsKmsKeyId: 'test-kms-key-id',
        approverEmail: 'test-approver@dsit.gov.uk',
        snsTopicArn: 'arn:aws:sns:us-west-2:123456789012:test-topic',
      });

      template = Template.fromStack(stack);
    });

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
  });

  describe('Default log level', () => {
    let template: Template;

    beforeAll(() => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack2', {
        env: { account: '123456789012', region: 'us-west-2' },
      });

      // Test with default log level (not provided)
      new SlackActionLambda(stack, 'TestSlackAction', {
        actionType: 'approve',
        isbApiBaseUrl: 'https://isb-api.test.gov.uk',
        isbJwtSecretPath: '/test/JwtSecret',
        isbSecretsKmsKeyId: 'test-kms-key-id',
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
});
