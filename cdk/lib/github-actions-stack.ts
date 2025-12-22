import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

/**
 * GitHub repository configuration for OIDC trust
 */
interface GitHubOIDCConfig {
  /** GitHub organization/owner (e.g., 'co-cddo') */
  readonly owner: string;
  /** Repository name (e.g., 'innovation-sandbox-on-aws-approver') */
  readonly repo: string;
  /** Branch allowed to deploy (e.g., 'main') */
  readonly branch: string;
}

/**
 * Stack properties for GitHub Actions OIDC integration
 */
export interface GitHubActionsStackProps extends cdk.StackProps {
  /** GitHub repository configuration */
  readonly github: GitHubOIDCConfig;
}

/**
 * GitHub Actions OIDC Stack for Approver Service
 *
 * Creates IAM role for GitHub Actions to deploy CDK infrastructure.
 * Uses OIDC federation - no long-lived credentials stored in GitHub.
 *
 * First deploy must be manual, subsequent deploys via CI.
 */
export class GitHubActionsStack extends cdk.Stack {
  /** IAM role for infrastructure deployment (CDK) */
  public readonly infraDeployRole: iam.IRole;

  constructor(scope: Construct, id: string, props: GitHubActionsStackProps) {
    super(scope, id, props);

    const { github } = props;

    // GitHub OIDC Provider - import existing provider (one per account)
    // The provider was already created for other projects in this account
    const githubProviderArn = `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`;
    const githubProvider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      'GitHubOIDCProvider',
      githubProviderArn
    );

    // Trust policy conditions for repository
    const branchCondition = `repo:${github.owner}/${github.repo}:ref:refs/heads/${github.branch}`;

    // =========================================================================
    // Infrastructure Deploy Role (CDK permissions)
    // =========================================================================
    // Used for: cdk deploy
    // Trigger: Push to main branch
    // Security: Only main branch can deploy

    const infraRole = new iam.Role(this, 'InfraDeployRole', {
      roleName: 'GitHubActions-Approver-InfraDeploy',
      description: 'GitHub Actions role for Approver CDK infrastructure deployment',
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: new iam.FederatedPrincipal(
        githubProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          StringLike: {
            'token.actions.githubusercontent.com:sub': branchCondition,
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
    });

    // CDK requires permission to assume the CDK execution roles
    // These are created by `cdk bootstrap`
    infraRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AssumeCDKRoles',
        effect: iam.Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: [`arn:aws:iam::${this.account}:role/cdk-*`],
        conditions: {
          StringEquals: {
            'iam:ResourceTag/aws-cdk:bootstrap-role': [
              'deploy',
              'lookup',
              'file-publishing',
              'image-publishing',
            ],
          },
        },
      })
    );

    // CloudFormation permissions for CDK
    infraRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CloudFormationAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudformation:DescribeStacks',
          'cloudformation:DescribeStackEvents',
          'cloudformation:GetTemplate',
          'cloudformation:ListStacks',
        ],
        resources: ['*'],
      })
    );

    // SSM Parameter Store read (for CDK context)
    infraRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SSMParameterRead',
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/cdk-bootstrap/*`],
      })
    );

    // ECR permissions (for Lambda Docker images if used later)
    infraRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ECRAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          'ecr:GetAuthorizationToken',
          'ecr:BatchCheckLayerAvailability',
          'ecr:GetDownloadUrlForLayer',
          'ecr:BatchGetImage',
        ],
        resources: ['*'],
      })
    );

    this.infraDeployRole = infraRole;

    // Tags
    cdk.Tags.of(this).add('project', 'innovation-sandbox-approver');
    cdk.Tags.of(this).add('managedby', 'cdk');
    cdk.Tags.of(this).add('purpose', 'github-actions-oidc');

    // Outputs
    new cdk.CfnOutput(this, 'GitHubOIDCProviderArn', {
      value: githubProviderArn,
      description: 'GitHub OIDC Provider ARN (imported)',
    });

    new cdk.CfnOutput(this, 'InfraDeployRoleArn', {
      value: this.infraDeployRole.roleArn,
      description: 'IAM Role ARN for infrastructure deployment',
    });
  }
}
