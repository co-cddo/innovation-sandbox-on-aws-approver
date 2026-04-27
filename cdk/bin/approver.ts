#!/usr/bin/env node
// @ts-expect-error - source-map-support has no bundled type declarations
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ApproverStack } from '../lib/approver-stack.js';
import { GitHubActionsStack } from '../lib/github-actions-stack.js';
import { DEFAULT_CONFIG, PROD_ENV } from '../config/environments.js';

const app = new cdk.App();

// GitHub Actions OIDC stack - creates IAM role for CI/CD
// First deploy: manual, subsequent deploys: via CI using this role
new GitHubActionsStack(app, 'ApproverGitHubActionsStack', {
  env: PROD_ENV,
  description: 'GitHub Actions OIDC integration for Approver service',
  github: {
    owner: 'co-cddo',
    repo: 'innovation-sandbox-on-aws-approver',
    branch: 'main',
  },
});

// Main Approver infrastructure stack
new ApproverStack(app, 'ApproverStack', {
  env: PROD_ENV,
  config: DEFAULT_CONFIG,
  description: 'Score-based lease approval system for Innovation Sandbox on AWS',
});
