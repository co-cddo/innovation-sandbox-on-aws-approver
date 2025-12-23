/**
 * Type-safe environment configuration for the Approver CDK stack
 */

export interface ApproverConfig {
  /** Auto-approval threshold score (default: 20) */
  autoApproveThreshold: number;
  /** Business hours start (24h format, default: 7) */
  businessHoursStart: number;
  /** Business hours end (24h format, default: 19) */
  businessHoursEnd: number;
  /** Business hours timezone (default: Europe/London) */
  businessHoursTz: string;
  /** ISB Console URL for deep links */
  isbConsoleUrl: string;
  /** ISB Leases DynamoDB table name */
  isbLeasesTableName: string;
  /** ISB Accounts DynamoDB table name */
  isbAccountsTableName: string;
  /** ISB Leases Lambda function name for direct approval invocation */
  isbLeasesLambdaName: string;
  /** Slack webhook secret ARN (pre-created) */
  slackWebhookSecretArn: string;
  /** Bedrock model ID for AI analysis */
  bedrockModelId: string;
  /** Log level */
  logLevel: string;
  /** Default rule weights as JSON string */
  ruleWeights: string;
}

export const DEFAULT_CONFIG: ApproverConfig = {
  autoApproveThreshold: 20,
  businessHoursStart: 7,
  businessHoursEnd: 19,
  businessHoursTz: 'Europe/London',
  isbConsoleUrl: 'https://isb-console.example.com', // Will be updated from AppConfig
  isbLeasesTableName: 'InnovationSandboxData-Leases', // Cross-stack reference
  isbAccountsTableName: 'InnovationSandboxData-SandboxAccounts', // Cross-stack reference
  isbLeasesLambdaName: 'ISB-LeasesLambdaFunction-ndx', // Cross-stack reference
  slackWebhookSecretArn:
    'arn:aws:secretsmanager:us-west-2:568672915267:secret:/approver/slack-webhook-url-FXJl1d',
  bedrockModelId: 'amazon.nova-micro-v1:0',
  logLevel: 'INFO',
  ruleWeights: JSON.stringify({
    expiredLeases: 2,
    budgetExceeded: 5,
    firstTimeUser: 5,
    firstTimeSuspicious: 20,
    verifiedGovDomain: -5,
    familiarTemplate: -1,
    templateHopper: 2,
    budgetRequested: 1,
    durationRequested: 1,
    endOfWindow: -2,
    cooldownViolation: 10,
    outsideTargetAudience: 10,
    manualEarlyTermination: -2,
    orgRecentNegative: 3,
    orgCleanRecord: -2,
    groupMailboxDetected: 20,
  }),
};

export interface StackEnvironment {
  account: string;
  region: string;
}

export const PROD_ENV: StackEnvironment = {
  account: process.env.CDK_DEFAULT_ACCOUNT!,
  region: 'us-west-2',
};
