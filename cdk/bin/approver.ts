#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ApproverStack } from '../lib/approver-stack.js';
import { DEFAULT_CONFIG, PROD_ENV } from '../config/environments.js';

const app = new cdk.App();

new ApproverStack(app, 'ApproverStack', {
  env: PROD_ENV,
  config: DEFAULT_CONFIG,
  description: 'Score-based lease approval system for Innovation Sandbox on AWS',
});
