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
  /** Account cooldown period in hours (default: 24) - Story 6.2 AC2 */
  accountCooldownHours: number;
  /** New account grace period in minutes (default: 60) - Story 6.2 AC2 */
  newAccountGraceMinutes: number;
  /** ISB Console URL for deep links (placeholder until AppConfig integration) */
  isbConsoleUrl: string;
  /** ISB Leases DynamoDB table name */
  isbLeasesTableName: string;
  /** ISB Accounts DynamoDB table name */
  isbAccountsTableName: string;
  /** ISB Leases Lambda function name for direct approval invocation */
  isbLeasesLambdaName: string;
  /** ISB Accounts Lambda function name for account readiness checks */
  isbAccountsLambdaName: string;
  /** ISB Event Bus name for EventBridge integration */
  isbEventBusName: string;
  /** KMS key ID for ISB DynamoDB table encryption */
  isbKmsKeyId: string;
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
  accountCooldownHours: 24,
  newAccountGraceMinutes: 60,
  isbConsoleUrl: 'https://ndx.digital.cabinet-office.gov.uk', // ISB Console URL
  isbLeasesTableName: 'ndx-try-isb-data-LeaseTable473C6DF2-1RC3238PVASE1',
  isbAccountsTableName: 'ndx-try-isb-data-SandboxAccountTableEFB9C069-198TPLJI6Z9KV',
  isbLeasesLambdaName: 'ISB-LeasesLambdaFunction-ndx',
  isbAccountsLambdaName: 'ISB-AccountsLambdaFunction-ndx',
  isbEventBusName: 'InnovationSandboxComputeISBEventBus6697FE33',
  isbKmsKeyId: '4682f54a-cf9a-4a2f-941c-aba8795ac878',
  slackWebhookSecretArn:
    'arn:aws:secretsmanager:us-west-2:568672915267:secret:/approver/slack-webhook-url-FXJl1d',
  bedrockModelId: 'us.amazon.nova-micro-v1:0', // Inference profile for on-demand throughput
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
    endOfWindow: 2, // +2 penalty for end-of-window requests
    cooldownViolation: 10,
    outsideTargetAudience: 50, // +50 for non-local-gov domain
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
