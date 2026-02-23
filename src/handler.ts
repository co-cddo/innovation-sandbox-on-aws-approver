import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { SQSClient } from '@aws-sdk/client-sqs';
// makeIdempotent import prepared for future full integration (Story 2.4 deferred handler wrapping)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { makeIdempotent as _makeIdempotent } from '@aws-lambda-powertools/idempotency';
import { logger } from './lib/logger.js';
import { LeaseRequestedEventSchema, type LeaseRequestedEvent } from './lib/types.js';
import { createEventBridgeService, type EventBridgeService } from './services/eventbridge.js';
import { createIsbLambdaService, type IsbLambdaService } from './services/isb-lambda.js';
import { createDynamoDBService, type DynamoDBService } from './services/dynamodb.js';
import { extractDomain } from './lib/domain.js';
import { isVerifiedGovDomain } from './lib/domain-verification.js';
import type { LeaseHistoryRecord, AIAnalysisResult } from './scoring/types.js';
import {
  createDomainAllowlistService,
  type DomainAllowlistService,
} from './services/domain-allowlist.js';
import { createBedrockService, type BedrockService } from './services/bedrock.js';
import {
  createSQSService,
  type SQSService,
  type DelayedLeaseMessage,
  type ReceivedMessage,
} from './services/sqs.js';
import {
  createSNSNotificationService,
  type SNSNotificationService,
  type SNSEscalationParams,
} from './services/sns-notification.js';
import { createAWSSNSClient } from './services/sns.js';
import {
  createBusinessHoursChecker,
  isQueueExpired,
  type BusinessHoursResult,
} from './lib/business-hours.js';
import { createBankHolidayService, type BankHolidayService } from './services/bank-holidays.js';
import {
  createPersistenceLayer,
  createIdempotencyConfig,
  generateIdempotencyKey,
} from './lib/idempotency.js';
import { generateReferenceNumber } from './lib/reference-number.js';
import {
  buildAutoApprovedMessage,
  buildAllowListApprovedMessage,
  buildEscalatedMessage,
  buildDelayedMessage,
  buildExpiredMessage,
  buildNoAccountsDelayMessage,
  buildReprocessingMessage,
  ruleResultsToBreakdown,
} from './lib/lease-comments.js';
import {
  addToQueue,
  removeFromQueue,
  getQueueDepth,
  getOldestPending,
  keyToLeaseId,
  type QueuePositionServiceConfig,
} from './services/queue-position.js';
import {
  ApprovalState,
  createInitialContext,
  createStateMachineOrchestrator,
  type StateContext,
  type StateMachineOrchestrator,
  type StateMachineConfig,
  type StateMachineLogger,
} from './state-machine/index.js';
import type { EventBridgeEvent, Context } from 'aws-lambda';

export interface ApproverResponse {
  statusCode: number;
  body: string;
}

/**
 * Error class for unrecoverable processing errors.
 * These errors trigger fail-closed behavior and DLQ routing.
 */
export class ProcessingError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly leaseId?: string,
    public readonly userEmail?: string,
    public readonly score?: number
  ) {
    super(message);
    this.name = 'ProcessingError';
  }
}

// EventBridge client initialized outside handler for connection reuse across invocations
const eventBridgeClient = new EventBridgeClient({
  region: process.env.AWS_REGION || 'us-west-2',
});

// Default configuration for EventBridge service
const eventBridgeConfig = {
  eventBusName: process.env.EVENT_BUS_NAME || 'default',
  source: 'innovation-sandbox',
};

// Create service instance (can be overridden in tests via dependency injection)
let eventBridgeService: EventBridgeService = createEventBridgeService(
  eventBridgeClient,
  eventBridgeConfig
);

// Secrets Manager client for JWT secret retrieval
const secretsManagerClient = new SecretsManagerClient({
  region: process.env.AWS_REGION || 'us-west-2',
});

// ISB API service configuration
const isbLambdaConfig = {
  apiBaseUrl: process.env.ISB_API_BASE_URL || '',
  jwtSecretPath: process.env.ISB_JWT_SECRET_PATH || '',
};

// Create ISB API service (can be overridden in tests via dependency injection)
let isbLambdaService: IsbLambdaService = createIsbLambdaService(
  secretsManagerClient,
  isbLambdaConfig
);

// DynamoDB client for user history queries (ISB Leases table)
const dynamoDBClient = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-west-2',
});
const dynamoDBDocClient = DynamoDBDocumentClient.from(dynamoDBClient);

// DynamoDB service configuration
const dynamoDBConfig = {
  tableName: process.env.ISB_LEASES_TABLE_NAME || '',
  accountsTableName: process.env.ISB_ACCOUNTS_TABLE_NAME || '',
};

// Create DynamoDB service (can be overridden in tests via dependency injection)
let dynamoDBService: DynamoDBService | undefined = dynamoDBConfig.tableName
  ? createDynamoDBService(dynamoDBDocClient, dynamoDBConfig)
  : undefined;

// S3 client for domain allowlist (ukps-domains)
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-west-2',
});

// Domain allowlist service configuration
const domainAllowlistConfig = {
  bucketName: process.env.DOMAIN_ALLOWLIST_BUCKET || '',
  objectKey: process.env.DOMAIN_ALLOWLIST_KEY || 'user_domains.json',
};

// Create domain allowlist service (can be overridden in tests via dependency injection)
let domainAllowlistService: DomainAllowlistService | undefined = domainAllowlistConfig.bucketName
  ? createDomainAllowlistService(s3Client, domainAllowlistConfig)
  : undefined;

// Bedrock client for AI email analysis
const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || 'us-west-2',
});

// Bedrock service configuration
const bedrockConfig = {
  modelId: process.env.BEDROCK_MODEL_ID || 'amazon.nova-micro-v1:0',
  timeoutMs: parseInt(process.env.BEDROCK_TIMEOUT_MS || '3000', 10),
};

// Create Bedrock service (can be overridden in tests via dependency injection)
// Service is always created - it handles circuit breaker and fallback internally
// Cast logger to BedrockLogger - the logger methods are compatible at runtime
let bedrockService: BedrockService | undefined = createBedrockService(
  bedrockClient,
  bedrockConfig,
  logger as unknown as import('./services/bedrock.js').BedrockLogger
);

// SQS client for delay queue
const sqsClient = new SQSClient({
  region: process.env.AWS_REGION || 'us-west-2',
});

// SQS service configuration
const sqsConfig = {
  queueUrl: process.env.DELAY_QUEUE_URL || '',
};

// Create SQS service (can be overridden in tests via dependency injection)
let sqsService: SQSService | undefined = sqsConfig.queueUrl
  ? createSQSService(
      sqsClient,
      sqsConfig,
      logger as unknown as import('./services/sqs.js').SQSLogger
    )
  : undefined;

// Queue Position service configuration (Story 6.3)
const queuePositionConfig: QueuePositionServiceConfig = {
  tableName: process.env.QUEUE_POSITION_TABLE_NAME || 'ApproverQueuePosition',
  positionIndexName: 'PositionIndex',
  ttlDays: 7,
};

// SNS notification service configuration (Story 7.1.1)
// ISB Console URL for deep links in notifications
const isbConsoleUrl = process.env.ISB_CONSOLE_URL || '';

// SNS notification service configuration (Story 7.1.1)
const snsTopicArn = process.env.NOTIFICATION_TOPIC_ARN || '';

// SNS notification service (initialized lazily on first escalation)
let snsNotificationService: SNSNotificationService | undefined;

// Bank holiday service for business hours checking
let bankHolidayService: BankHolidayService = createBankHolidayService();

// Business hours checker (uses bank holiday service)
let businessHoursChecker = createBusinessHoursChecker(bankHolidayService);

// State machine configuration
const stateMachineConfig: StateMachineConfig = {
  autoApproveThreshold: parseInt(process.env.AUTO_APPROVE_THRESHOLD || '20', 10),
};

// Queue expiry configuration (default: 5 business days)
const queueExpiryDays = parseInt(process.env.QUEUE_EXPIRY_DAYS || '5', 10);

// Create orchestrator (can be overridden in tests via dependency injection)
let orchestrator: StateMachineOrchestrator = createStateMachineOrchestrator({
  stateMachineConfig,
  logger: logger as StateMachineLogger,
});

// Idempotency configuration - lazy initialized to allow testing without DynamoDB
// These variables are prepared for full handler wrapping (deferred in Story 2.4)
let idempotencyEnabled = false;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let _persistenceLayer: ReturnType<typeof createPersistenceLayer> | undefined;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let _idempotencyConfig: ReturnType<typeof createIdempotencyConfig> | undefined;

/**
 * Initializes idempotency if IDEMPOTENCY_TABLE_NAME is set.
 * Call this lazily to allow testing without DynamoDB.
 */
/* c8 ignore start - idempotency initialization requires actual DynamoDB in AWS */
const initializeIdempotency = (): boolean => {
  if (idempotencyEnabled) return true;
  if (!process.env.IDEMPOTENCY_TABLE_NAME) return false;

  try {
    _persistenceLayer = createPersistenceLayer();
    _idempotencyConfig = createIdempotencyConfig();
    idempotencyEnabled = true;
    return true;
  } catch {
    logger.warn('Failed to initialize idempotency - continuing without it');
    return false;
  }
};
/* c8 ignore stop */

/**
 * Allows overriding the EventBridge service for testing purposes.
 * Uses dependency injection pattern for testability.
 */
export const setEventBridgeService = (service: EventBridgeService): void => {
  eventBridgeService = service;
};

/**
 * Resets to the default EventBridge service (for test cleanup).
 */
export const resetEventBridgeService = (): void => {
  eventBridgeService = createEventBridgeService(eventBridgeClient, eventBridgeConfig);
};

/**
 * Allows overriding the ISB Lambda service for testing purposes.
 */
export const setIsbLambdaService = (service: IsbLambdaService): void => {
  isbLambdaService = service;
};

/**
 * Resets to the default ISB Lambda service (for test cleanup).
 */
export const resetIsbLambdaService = (): void => {
  isbLambdaService = createIsbLambdaService(secretsManagerClient, isbLambdaConfig);
};

/**
 * Allows overriding the DynamoDB service for testing purposes.
 */
export const setDynamoDBService = (service: DynamoDBService | undefined): void => {
  dynamoDBService = service;
};

/**
 * Resets to the default DynamoDB service (for test cleanup).
 */
export const resetDynamoDBService = (): void => {
  dynamoDBService = dynamoDBConfig.tableName
    ? createDynamoDBService(dynamoDBDocClient, dynamoDBConfig)
    : undefined;
};

/**
 * Allows overriding the domain allowlist service for testing purposes.
 */
export const setDomainAllowlistService = (service: DomainAllowlistService | undefined): void => {
  domainAllowlistService = service;
};

/**
 * Resets to the default domain allowlist service (for test cleanup).
 */
export const resetDomainAllowlistService = (): void => {
  domainAllowlistService = domainAllowlistConfig.bucketName
    ? createDomainAllowlistService(s3Client, domainAllowlistConfig)
    : undefined;
};

/**
 * Allows overriding the Bedrock service for testing purposes.
 */
export const setBedrockService = (service: BedrockService | undefined): void => {
  bedrockService = service;
};

/**
 * Resets to the default Bedrock service (for test cleanup).
 */
export const resetBedrockService = (): void => {
  bedrockService = createBedrockService(
    bedrockClient,
    bedrockConfig,
    logger as unknown as import('./services/bedrock.js').BedrockLogger
  );
};

/**
 * Allows overriding the state machine orchestrator for testing purposes.
 */
export const setOrchestrator = (newOrchestrator: StateMachineOrchestrator): void => {
  orchestrator = newOrchestrator;
};

/**
 * Resets to the default orchestrator (for test cleanup).
 */
export const resetOrchestrator = (): void => {
  orchestrator = createStateMachineOrchestrator({
    stateMachineConfig,
    logger: logger as StateMachineLogger,
  });
};

/**
 * Allows overriding the SQS service for testing purposes.
 */
export const setSQSService = (service: SQSService | undefined): void => {
  sqsService = service;
};

/**
 * Resets to the default SQS service (for test cleanup).
 */
export const resetSQSService = (): void => {
  sqsService = sqsConfig.queueUrl
    ? createSQSService(
        sqsClient,
        sqsConfig,
        logger as unknown as import('./services/sqs.js').SQSLogger
      )
    : undefined;
};

/**
 * Allows overriding the bank holiday service for testing purposes.
 */
export const setBankHolidayService = (service: BankHolidayService): void => {
  bankHolidayService = service;
  businessHoursChecker = createBusinessHoursChecker(bankHolidayService);
};

/**
 * Resets to the default bank holiday service (for test cleanup).
 */
export const resetBankHolidayService = (): void => {
  bankHolidayService = createBankHolidayService();
  businessHoursChecker = createBusinessHoursChecker(bankHolidayService);
};

/**
 * Allows overriding the SNS notification service for testing purposes (Story 7.1.1).
 */
export const setSNSNotificationService = (service: SNSNotificationService | undefined): void => {
  snsNotificationService = service;
};

/**
 * Resets the SNS notification service to undefined (for test cleanup).
 * The service is lazily initialized on first escalation.
 */
export const resetSNSNotificationService = (): void => {
  snsNotificationService = undefined;
};

/**
 * Queries user lease history from DynamoDB with pessimistic fallback on error.
 * If DynamoDB is not configured or query fails, returns empty array (pessimistic fallback).
 */
const queryUserHistory = async (userEmail: string): Promise<LeaseHistoryRecord[]> => {
  if (!dynamoDBService) {
    logger.warn('DynamoDB service not configured - using pessimistic fallback', {
      userEmail,
    });
    return [];
  }

  try {
    const history = await dynamoDBService.getUserLeaseHistory(userEmail);
    logger.info('User history retrieved', {
      userEmail,
      leaseCount: history.length,
    });
    return history;
  } catch (error) {
    // Log error but use pessimistic fallback (empty history)
    // This triggers first_time_user penalty and skips bonuses
    logger.error('Failed to query user history - using pessimistic fallback', {
      error: error instanceof Error ? error.message : String(error),
      userEmail,
    });
    return [];
  }
};

/**
 * Queries organization lease history from DynamoDB with pessimistic fallback on error.
 * Returns leases from OTHER users at the same domain (excludes current user).
 * If DynamoDB is not configured or query fails, returns empty array (pessimistic fallback).
 */
const queryOrgHistory = async (userEmail: string): Promise<LeaseHistoryRecord[]> => {
  if (!dynamoDBService) {
    logger.warn('DynamoDB service not configured - skipping org history', {
      userEmail,
    });
    return [];
  }

  try {
    const domain = extractDomain(userEmail);
    const history = await dynamoDBService.getOrgLeaseHistory(domain, userEmail);
    logger.info('Org history retrieved', {
      domain,
      leaseCount: history.length,
    });
    return history;
  } catch (error) {
    // Pessimistic fallback - empty history means no penalties or bonuses
    logger.error('Failed to query org history - using pessimistic fallback', {
      error: error instanceof Error ? error.message : String(error),
      userEmail,
    });
    return [];
  }
};

/**
 * Analyzes an email address using Bedrock AI with circuit breaker and fallback.
 * Returns AIAnalysisResult or undefined if service is not configured.
 * This implements AC1, AC4, AC5: AI analysis with timeout and circuit breaker.
 */
const analyzeEmailWithAI = async (email: string): Promise<AIAnalysisResult | undefined> => {
  if (!bedrockService) {
    logger.warn('Bedrock service not configured - skipping AI analysis', {
      email,
    });
    return undefined;
  }

  try {
    const result = await bedrockService.analyzeEmail(email);

    // Log whether fallback was used
    if (result.usedFallback) {
      logger.info('AI email analysis used fallback', {
        email,
        fallbackReason: result.fallbackReason,
        isGroupMailbox: result.analysis.isGroupMailbox,
      });
    } else {
      logger.info('AI email analysis completed', {
        email,
        isGroupMailbox: result.analysis.isGroupMailbox,
        confidence: result.analysis.confidence,
      });
    }

    return result.analysis;
  } catch (error) {
    // This shouldn't happen as the service handles errors internally,
    // but just in case, log and return undefined (pessimistic fallback)
    logger.error('Unexpected error in AI email analysis - skipping', {
      error: error instanceof Error ? error.message : String(error),
      email,
    });
    return undefined;
  }
};

/**
 * Checks if a domain is in the verified local authority domains allowlist.
 * Returns false (pessimistic) if the service is not configured or query fails.
 * This implements AC5: skip bonus on failure, don't fail the whole request.
 */
const checkDomainVerification = async (domain: string): Promise<boolean> => {
  if (!domainAllowlistService) {
    logger.warn('Domain allowlist service not configured - skipping domain verification', {
      domain,
    });
    return false;
  }

  try {
    const result = await domainAllowlistService.getLocalAuthorityDomains();

    // Log warning if stale cache was used (AC6)
    if (result.usedStaleCache) {
      logger.warn('Using stale domain cache after S3 error', {
        domain,
        staleReason: result.staleReason,
      });
    }

    const isVerified = isVerifiedGovDomain(domain, result.domains);
    logger.info('Domain verification result', {
      domain,
      isVerified,
      allowlistSize: result.domains.length,
      usedStaleCache: result.usedStaleCache,
    });
    return isVerified;
  } catch (error) {
    // Pessimistic fallback - skip bonus if S3 fails (AC5)
    logger.error('Failed to verify domain - using pessimistic fallback', {
      error: error instanceof Error ? error.message : String(error),
      domain,
    });
    return false;
  }
};

/**
 * Resolves a template UUID to its human-readable name by querying the ISB Leases API.
 * Returns the UUID as fallback if lookup fails or template not found.
 * Fails silently to avoid blocking the approval flow.
 */
const resolveTemplateName = async (
  leaseId: { userEmail: string; uuid: string },
  templateUuid: string
): Promise<string> => {
  try {
    const result = await isbLambdaService.getLease({
      leaseId,
      approverEmail: 'ndx+try-automated-approver@dsit.gov.uk',
    });

    if (result.success && result.templateName) {
      logger.info('Template name resolved from ISB API', {
        leaseId: leaseId.uuid,
        templateUuid,
        templateName: result.templateName,
      });
      return result.templateName;
    }

    // Name not found or lookup failed - use UUID as fallback
    if (!result.success) {
      logger.warn('Template lookup failed - using UUID as fallback', {
        leaseId: leaseId.uuid,
        templateUuid,
        error: result.error,
      });
    }
    return templateUuid;
  } catch (error) {
    logger.warn('Error resolving template name - using UUID as fallback', {
      leaseId: leaseId.uuid,
      templateUuid,
      error: error instanceof Error ? error.message : String(error),
    });
    return templateUuid;
  }
};

/**
 * Checks account availability by querying ISB Lambda.
 *
 * Returns a "proceed" result on failure (pessimistic: let scoring decide).
 */
const checkAccountReadinessNow = async (): Promise<{
  hasReadyAccount: boolean;
  availableAccountCount: number;
  activeAccountCount: number;
  accountDelayReason: 'NO_READY_ACCOUNTS' | 'ACCOUNT_FETCH_ERROR' | undefined;
}> => {
  try {
    // Fetch all accounts from ISB Lambda
    // Use the automated approver email for account queries
    const accountsResult = await isbLambdaService.getAccounts({
      approverEmail: 'ndx+try-automated-approver@dsit.gov.uk',
    });

    if (!accountsResult.success) {
      logger.warn('Failed to fetch accounts from ISB Lambda - proceeding to scoring', {
        error: accountsResult.error,
      });
      // On failure, proceed (let scoring decide) - pessimistic approach
      // Don't block requests if we can't check accounts
      return {
        hasReadyAccount: true, // Assume ready to proceed
        availableAccountCount: 0,
        activeAccountCount: 0,
        accountDelayReason: undefined, // No delay, proceed with warning
      };
    }

    // Count Available vs Active accounts
    const availableAccounts = accountsResult.accounts.filter((a) => a.status === 'Available');
    const activeAccounts = accountsResult.accounts.filter((a) => a.status === 'Active');

    const hasReadyAccount = availableAccounts.length > 0;

    logger.info('Account availability check completed', {
      totalAccounts: accountsResult.accounts.length,
      availableAccounts: availableAccounts.length,
      activeAccounts: activeAccounts.length,
      hasReadyAccount,
    });

    return {
      hasReadyAccount,
      availableAccountCount: availableAccounts.length,
      activeAccountCount: activeAccounts.length,
      accountDelayReason: hasReadyAccount ? undefined : 'NO_READY_ACCOUNTS',
    };
  } catch (error) {
    logger.error('Error checking account availability - proceeding to scoring', {
      error: error instanceof Error ? error.message : String(error),
    });
    // On error, proceed (let scoring decide)
    return {
      hasReadyAccount: true,
      availableAccountCount: 0,
      activeAccountCount: 0,
      accountDelayReason: undefined,
    };
  }
};

/**
 * Checks if the current time is within business hours.
 * Returns business hours result for inclusion in state context.
 */
const checkBusinessHoursNow = async (): Promise<BusinessHoursResult> => {
  try {
    const result = await businessHoursChecker();

    logger.info('Business hours check', {
      businessHoursCheck: result.isWithinBusinessHours ? 'within' : 'outside',
      londonTime: result.londonTime,
      londonHour: result.londonHour,
      dayOfWeek: result.dayOfWeek,
      isBankHoliday: result.isBankHoliday,
      isEndOfWindow: result.isEndOfWindow,
      nextProcessingTime: result.nextProcessingTime,
    });

    // Log end-of-window penalty if applicable (AC6)
    if (result.isEndOfWindow) {
      logger.info('End-of-window penalty applicable', {
        endOfWindowPenalty: true,
        londonHour: result.londonHour,
      });
    }

    return result;
    /* c8 ignore start -- defensive: businessHoursChecker uses mock service in tests */
  } catch (error) {
    // On error, default to within business hours to avoid blocking requests
    logger.error('Failed to check business hours - defaulting to within', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      isWithinBusinessHours: true,
      isEndOfWindow: false,
      londonTime: new Date().toISOString(),
      londonHour: 12,
      dayOfWeek: 1,
      isBankHoliday: false,
      dateString: new Date().toISOString().split('T')[0]!,
    };
  }
  /* c8 ignore stop */
};

/** Account availability check result for context preparation */
interface AccountReadinessCheck {
  hasReadyAccount: boolean;
  availableAccountCount: number;
  activeAccountCount: number;
  accountDelayReason: 'NO_READY_ACCOUNTS' | 'ACCOUNT_FETCH_ERROR' | undefined;
}

/**
 * Prepares the initial state context from a validated event.
 *
 * Note: requiresManualApproval is included for schema compatibility but is
 * intentionally ignored by the state machine. ISB routes ALL requests with
 * requiresManualApproval=true - scoring determines approval decisions.
 */
const prepareContext = (
  event: LeaseRequestedEvent,
  userLeaseHistory: LeaseHistoryRecord[],
  orgLeaseHistory: LeaseHistoryRecord[],
  isVerifiedDomain: boolean,
  businessHoursResult: BusinessHoursResult,
  accountReadinessCheck: AccountReadinessCheck,
  aiAnalysis?: AIAnalysisResult
): StateContext => {
  const { detail } = event;
  const {
    leaseId,
    templateId,
    budgetAmount,
    leaseDurationHours,
    requiresManualApproval,
    comments,
  } = detail;

  return {
    ...createInitialContext(),
    leaseId: leaseId.uuid,
    userEmail: leaseId.userEmail,
    templateId,
    budgetAmount,
    leaseDurationHours,
    requiresManualApproval, // Ignored by DECIDING handler - kept for logging/auditing
    comments,
    userLeaseHistory,
    orgLeaseHistory,
    isVerifiedGovDomain: isVerifiedDomain,
    aiAnalysis,
    // Business hours data from checker
    isWithinBusinessHours: businessHoursResult.isWithinBusinessHours,
    isEndOfWindow: businessHoursResult.isEndOfWindow,
    nextProcessingTime: businessHoursResult.nextProcessingTime,
    // Account availability data
    hasReadyAccount: accountReadinessCheck.hasReadyAccount,
    availableAccountCount: accountReadinessCheck.availableAccountCount,
    activeAccountCount: accountReadinessCheck.activeAccountCount,
    accountDelayReason: accountReadinessCheck.accountDelayReason,
  };
};

/**
 * Emits a LeaseEscalated event for fail-closed error handling.
 * This ensures the request is queued for manual review even when errors occur.
 */
const emitEscalationOnError = async (
  leaseId: { userEmail: string; uuid: string },
  reason: string,
  errorCode: string,
  score?: number
): Promise<void> => {
  try {
    await eventBridgeService.emitLeaseEscalated({
      leaseId,
      reason,
      errorCode,
      score,
    });
    logger.info('LeaseEscalated event emitted for error handling', {
      action: 'escalated',
      errorCode,
      leaseId: leaseId.uuid,
      userEmail: leaseId.userEmail,
    });
  } catch (emitError) {
    // Log the failure but don't throw - we still want to throw the original error for DLQ
    logger.error('Failed to emit LeaseEscalated event', {
      error: emitError instanceof Error ? emitError.message : String(emitError),
      leaseId: leaseId.uuid,
      userEmail: leaseId.userEmail,
      originalError: reason,
    });
  }
};

/**
 * Updates lease comments in DynamoDB (Story 5.1).
 * Fails silently to avoid blocking approval flow - logs warning on failure.
 *
 * @param leaseId - The lease ID to update
 * @param comments - The comments string to set
 */
const updateLeaseComments = async (
  leaseId: { userEmail: string; uuid: string },
  comments: string
): Promise<void> => {
  if (!dynamoDBService) {
    logger.warn('DynamoDB service not configured - skipping comments update', {
      leaseId: leaseId.uuid,
    });
    return;
  }

  try {
    const result = await dynamoDBService.updateLeaseComments(leaseId, comments);
    if (!result.success) {
      logger.warn('Failed to update lease comments', {
        leaseId: leaseId.uuid,
        userEmail: leaseId.userEmail,
        error: result.error,
      });
      return;
    }

    logger.info('Lease comments updated', {
      leaseId: leaseId.uuid,
      userEmail: leaseId.userEmail,
    });
  } catch (error) {
    // Log and continue - don't fail the overall request
    logger.warn('Error updating lease comments', {
      leaseId: leaseId.uuid,
      userEmail: leaseId.userEmail,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Sends an SNS notification for an escalated request (Story 7.1.1).
 * Initializes SNS notification service lazily on first use.
 * Fails silently to avoid blocking the approval flow.
 *
 * @param params - SNS escalation notification parameters
 */
const notifySNSEscalation = async (params: SNSEscalationParams): Promise<void> => {
  // If SNS service is already set (e.g., via dependency injection for testing),
  // skip configuration checks and use it directly
  /* c8 ignore start -- lazy initialization guards: tests inject snsNotificationService directly */
  if (!snsNotificationService) {
    // Check if SNS topic ARN is configured
    if (!snsTopicArn) {
      logger.info('NOTIFICATION_TOPIC_ARN not configured - skipping SNS notification', {
        leaseId: params.leaseId,
      });
      return;
    }

    // Check if ISB console URL is configured (needed for deep links)
    if (!isbConsoleUrl) {
      logger.warn('ISB_CONSOLE_URL not configured - skipping SNS notification', {
        leaseId: params.leaseId,
      });
      return;
    }

    // Initialize SNS notification service lazily
    const snsClient = createAWSSNSClient();
    snsNotificationService = createSNSNotificationService(
      snsClient,
      snsTopicArn,
      isbConsoleUrl,
      logger as unknown as import('./services/sns-notification.js').SNSNotificationLogger
    );
  }
  /* c8 ignore stop */

  try {
    const result = await snsNotificationService.notifyEscalation(params);
    if (!result.success) {
      logger.warn('SNS notification failed - request still escalated', {
        leaseId: params.leaseId,
        error: result.error,
      });
    } else {
      logger.info('SNS escalation notification sent', {
        leaseId: params.leaseId,
        messageId: result.messageId,
      });
    }
  } catch (error) {
    // Log and continue - fails silently to avoid blocking
    logger.warn('Error sending SNS notification - request still escalated', {
      leaseId: params.leaseId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Processes a single delayed message from the queue.
 * Returns true if processing was successful, false otherwise.
 */
const processDelayedMessage = async (
  message: ReceivedMessage,
  context: Context
): Promise<boolean> => {
  const { body, receiptHandle } = message;
  const { leaseId, originalEvent } = body;

  logger.info('Processing delayed message', {
    leaseId: leaseId.uuid,
    userEmail: leaseId.userEmail,
    receivedAt: body.receivedAt,
  });

  try {
    // Parse the original event and process it
    const event = originalEvent as EventBridgeEvent<string, unknown>;

    // Recursively call the main handler to process the original event
    // This will go through the full scoring and approval flow
    const result = await handler(event, context);

    if (result.statusCode === 200 || result.statusCode === 202) {
      // Success - delete the message
      // 200 = processed normally (approved/denied/escalated/already-processed)
      // 202 = TOCTOU re-queued (a fresh replacement message was already created)
      /* c8 ignore start -- sqsService verified before processDelayedMessage is called */
      if (!sqsService) {
        logger.error('SQS service not available for message deletion');
        return false;
      }
      /* c8 ignore stop */

      const deleteResult = await sqsService.deleteMessage(receiptHandle);
      if (!deleteResult.success) {
        logger.error('Failed to delete processed message', {
          error: deleteResult.error,
          leaseId: leaseId.uuid,
        });
        // Message will become visible again after timeout
        return false;
      }

      logger.info('Delayed message processed and deleted', {
        leaseId: leaseId.uuid,
        userEmail: leaseId.userEmail,
        resultStatusCode: result.statusCode,
      });
      return true;
    }

    // Processing returned non-success - leave message in queue
    logger.warn('Delayed message processing returned error', {
      leaseId: leaseId.uuid,
      statusCode: result.statusCode,
      body: result.body,
    });
    return false;
  } catch (error) {
    // Processing threw - leave message in queue
    logger.error('Error processing delayed message', {
      error: error instanceof Error ? error.message : String(error),
      leaseId: leaseId.uuid,
    });
    return false;
  }
};

/**
 * Processes an expired message from the delay queue.
 * Emits a LeaseDenied event and updates lease comments, then deletes the message.
 * Returns true if expiry was successful, false otherwise.
 */
const processExpiredMessage = async (message: ReceivedMessage): Promise<boolean> => {
  const { body, receiptHandle } = message;
  const { leaseId, receivedAt } = body;
  const currentTime = new Date().toISOString();
  const referenceNumber = generateReferenceNumber(leaseId.uuid);

  logger.info('Processing expired message', {
    action: 'expired',
    leaseId: leaseId.uuid,
    userEmail: leaseId.userEmail,
    queuedAt: receivedAt,
    expiredAt: currentTime,
    businessDaysInQueue: queueExpiryDays,
    reason: 'queue_timeout',
    referenceNumber,
  });

  try {
    // Emit LeaseDenied event with queue_timeout reason
    await eventBridgeService.emitLeaseDenied({
      leaseId,
      reason: 'queue_timeout',
      deniedBy: 'system',
    });

    logger.info('LeaseDenied event emitted for expired request', {
      leaseId: leaseId.uuid,
      userEmail: leaseId.userEmail,
      reason: 'queue_timeout',
    });

    // Update lease comments with expiry message (Story 5.1 AC7)
    const expiryMessage = buildExpiredMessage(referenceNumber, queueExpiryDays);
    await updateLeaseComments(leaseId, expiryMessage);

    // Delete the message from the queue
    /* c8 ignore start -- sqsService always set in handler context */
    if (!sqsService) {
      logger.error('SQS service not available for message deletion');
      return false;
    }
    /* c8 ignore stop */

    const deleteResult = await sqsService.deleteMessage(receiptHandle);
    if (!deleteResult.success) {
      logger.error('Failed to delete expired message', {
        error: deleteResult.error,
        leaseId: leaseId.uuid,
      });
      return false;
    }

    logger.info('Expired message processed and deleted', {
      action: 'expired',
      leaseId: leaseId.uuid,
      userEmail: leaseId.userEmail,
      queuedAt: receivedAt,
      expiredAt: currentTime,
      businessDaysInQueue: queueExpiryDays,
      reason: 'queue_timeout',
      referenceNumber,
    });

    return true;
  } catch (error) {
    logger.error('Error processing expired message', {
      error: error instanceof Error ? error.message : String(error),
      leaseId: leaseId.uuid,
    });
    return false;
  }
};

/**
 * Processes the delay queue - checks for messages and processes if conditions are met.
 * Called by scheduled queue check and AccountCleanupSucceeded triggers.
 *
 * Story 6.3: Uses DynamoDB queue position table for FIFO ordering.
 * The oldest request (lowest position number) is processed first.
 */
const processDelayQueue = async (
  context: Context,
  triggerType: 'scheduled' | 'cleanup'
): Promise<ApproverResponse> => {
  // Check if within business hours first (before making SQS calls)
  const businessHoursResult = await checkBusinessHoursNow();
  if (!businessHoursResult.isWithinBusinessHours) {
    logger.info('Outside business hours - skipping queue processing', {
      londonTime: businessHoursResult.londonTime,
      nextProcessingTime: businessHoursResult.nextProcessingTime,
      triggerType,
    });
    return {
      statusCode: 200,
      body: 'Outside business hours - queue processing skipped',
    };
  }

  // Check account availability
  const accountReadiness = await checkAccountReadinessNow();
  if (!accountReadiness.hasReadyAccount) {
    logger.info('No ready accounts available - skipping queue processing', {
      triggerType,
      availableAccountCount: accountReadiness.availableAccountCount,
      activeAccountCount: accountReadiness.activeAccountCount,
    });
    return {
      statusCode: 200,
      body: 'No ready accounts available - queue processing skipped',
    };
  }

  // Check if SQS service is configured
  if (!sqsService) {
    logger.warn('SQS service not configured - cannot process queue');
    return {
      statusCode: 200,
      body: 'SQS service not configured',
    };
  }

  // Log queue depth before processing (AC4)
  let depthBefore = 0;
  const depthBeforeResult = await sqsService.getQueueDepth();
  if (depthBeforeResult.success) {
    depthBefore = depthBeforeResult.approximateNumberOfMessages ?? 0;
    logger.info('Queue depth before processing', {
      approximateNumberOfMessages: depthBefore,
      triggerType,
    });
  }

  // Get bank holidays once for expiry checks across all messages
  const bankHolidays = await bankHolidayService.getBankHolidays();

  // Process multiple messages per invocation to drain the queue faster.
  // Stop when: no more messages, time running low, or max iterations reached.
  const MIN_REMAINING_MS = 8000; // Reserve 8s for cleanup and response
  let totalProcessed = 0;
  let totalExpired = 0;
  let totalFailed = 0;

  while (context.getRemainingTimeInMillis() > MIN_REMAINING_MS) {
    // Story 6.3: Get oldest pending request from DynamoDB queue position table (FIFO)
    let oldestLeaseId: { userEmail: string; uuid: string } | undefined;
    try {
      const oldestResult = await getOldestPending(dynamoDBClient, queuePositionConfig);
      if (oldestResult.success && oldestResult.record) {
        oldestLeaseId = keyToLeaseId(oldestResult.record.leaseId);
        if (totalProcessed === 0) {
          logger.info('Found oldest pending request for FIFO processing', {
            leaseId: oldestLeaseId.uuid,
            userEmail: oldestLeaseId.userEmail,
            position: oldestResult.record.position,
            queuedAt: oldestResult.record.queuedAt,
            triggerType,
          });
        }
      }
    } catch (error) {
      logger.warn(
        'Failed to get oldest pending from queue position table - falling back to SQS order',
        {
          error: error instanceof Error ? error.message : String(error),
          triggerType,
        }
      );
    }

    // Receive next message from queue
    const receiveResult = await sqsService.receiveMessages(1, 300);
    if (!receiveResult.success) {
      logger.error('Failed to receive messages from queue', {
        error: receiveResult.error,
        triggerType,
      });
      // If no messages processed yet, propagate the error
      if (totalProcessed + totalExpired === 0) {
        return {
          statusCode: 500,
          body: `Failed to receive messages: ${receiveResult.error}`,
        };
      }
      break;
    }

    if (receiveResult.messages.length === 0) {
      // No messages in SQS but might have stale entries in DynamoDB - clean up
      if (oldestLeaseId) {
        logger.warn('DynamoDB queue has entries but SQS is empty - cleaning up', {
          leaseId: oldestLeaseId.uuid,
        });
        await removeFromQueue(dynamoDBClient, queuePositionConfig, oldestLeaseId);
      }
      if (totalProcessed === 0) {
        logger.info('No messages in delay queue', { triggerType });
      }
      break;
    }

    // Process the oldest message (messages are already sorted by SentTimestamp)
    const message = receiveResult.messages[0]!;

    // Check if the message has expired (> 5 business days in queue)
    const queuedAt = new Date(message.body.receivedAt);
    const isExpired = isQueueExpired(queuedAt, queueExpiryDays, bankHolidays);

    let success: boolean;
    let action: string;

    if (isExpired) {
      success = await processExpiredMessage(message);
      action = 'expired';
    } else {
      success = await processDelayedMessage(message, context);
      action = 'processed';
    }

    // Story 6.3: Remove from DynamoDB queue position table if successful
    if (success) {
      const processedLeaseId = message.body.leaseId;
      try {
        await removeFromQueue(dynamoDBClient, queuePositionConfig, processedLeaseId);
        logger.info('Removed processed request from queue position table', {
          leaseId: processedLeaseId.uuid,
          action,
        });
      } catch (error) {
        logger.warn('Failed to remove from queue position table', {
          leaseId: processedLeaseId.uuid,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!success) {
      totalFailed++;
      break; // Stop on processing failure to avoid cascading errors
    } else if (action === 'expired') {
      totalExpired++;
    } else {
      totalProcessed++;
    }
  }

  const totalHandled = totalProcessed + totalExpired;

  // Log queue depth after processing (AC4)
  const depthAfterResult = await sqsService.getQueueDepth();
  if (depthAfterResult.success) {
    logger.info('Queue depth after processing', {
      approximateNumberOfMessages: depthAfterResult.approximateNumberOfMessages,
      depthBefore,
      totalProcessed,
      totalExpired,
      totalFailed,
      triggerType,
    });
  }

  if (totalHandled === 0 && totalFailed === 0) {
    return {
      statusCode: 200,
      body: 'No messages in queue',
    };
  }

  if (totalFailed > 0 && totalHandled === 0) {
    return {
      statusCode: 200,
      body: 'Message processing failed - will retry',
    };
  }

  return {
    statusCode: 200,
    body: `Processed ${totalHandled} message${totalHandled !== 1 ? 's' : ''} from queue (${totalProcessed} processed, ${totalExpired} expired${totalFailed > 0 ? `, ${totalFailed} failed` : ''})`,
  };
};

/**
 * Handles scheduled queue check events (from EventBridge Scheduler every 30 minutes).
 */
const handleScheduledQueueCheck = async (
  event: EventBridgeEvent<string, unknown>,
  context: Context
): Promise<ApproverResponse> => {
  logger.info('Scheduled queue check triggered', {
    source: event.source,
    detailType: event['detail-type'],
    timestamp: new Date().toISOString(),
  });

  return processDelayQueue(context, 'scheduled');
};

/**
 * Handles AccountCleanupSucceeded events - an account became available.
 */
const handleAccountCleanupSucceeded = async (
  event: EventBridgeEvent<string, unknown>,
  context: Context
): Promise<ApproverResponse> => {
  const detail = event.detail as { accountId?: string } | undefined;

  logger.info('Account cleanup succeeded - checking delay queue', {
    accountId: detail?.accountId,
    source: event.source,
    timestamp: new Date().toISOString(),
  });

  return processDelayQueue(context, 'cleanup');
};

/**
 * Processes LeaseRequested events using the state machine for decision orchestration.
 * Side effects (EventBridge emission) are handled in this handler, not in the state machine.
 *
 * Implements fail-closed error handling:
 * - On unrecoverable errors, emits LeaseEscalated event
 * - Then throws to route to DLQ for investigation
 */
export const handler = async (
  event: EventBridgeEvent<string, unknown>,
  context: Context
): Promise<ApproverResponse> => {
  logger.addContext(context);

  // Track event ID for idempotency key generation
  const eventId = event.id;

  // Initialize idempotency if configured
  initializeIdempotency();

  // Route based on event type
  // 1. Scheduled queue check (from EventBridge Scheduler every 30 minutes)
  if (event.source === 'scheduled.queue-check') {
    return handleScheduledQueueCheck(event, context);
  }

  // 2. Account cleanup succeeded - an account became available
  if (event['detail-type'] === 'AccountCleanupSucceeded') {
    return handleAccountCleanupSucceeded(event, context);
  }

  // 3. LeaseRequested - main approval flow
  if (event['detail-type'] !== 'LeaseRequested') {
    logger.info('Ignoring unrecognized event', {
      detailType: event['detail-type'],
      source: event.source,
    });
    return {
      statusCode: 200,
      body: 'Ignored - unrecognized event type',
    };
  }

  // Debug: Log raw event detail fields to understand what ISB is sending
  const rawDetail = (event as unknown as Record<string, unknown>).detail as
    | Record<string, unknown>
    | undefined;
  if (rawDetail) {
    logger.info('Raw event detail fields', {
      keys: Object.keys(rawDetail),
      leaseTemplateId: rawDetail.leaseTemplateId,
      originalLeaseTemplateUuid: rawDetail.originalLeaseTemplateUuid,
      templateId: rawDetail.templateId,
      leaseTemplateUuid: rawDetail.leaseTemplateUuid,
    });
  }

  // Validate event against schema
  const parseResult = LeaseRequestedEventSchema.safeParse(event);
  if (!parseResult.success) {
    logger.error('Invalid LeaseRequested event schema', {
      errors: parseResult.error.errors,
      eventId,
    });
    return {
      statusCode: 400,
      body: 'Invalid event schema',
    };
  }

  const validatedEvent: LeaseRequestedEvent = parseResult.data;
  const { leaseId, templateId } = validatedEvent.detail;

  // Generate idempotency key for deduplication tracking
  const idempotencyKey = generateIdempotencyKey(leaseId.uuid, eventId);

  // Extract domain for org-level queries and logging (AC5: cross-org security review)
  let domain: string;
  try {
    domain = extractDomain(leaseId.userEmail);
    /* c8 ignore start -- Zod validates email format before this point */
  } catch {
    domain = 'unknown';
  }
  /* c8 ignore stop */

  // Add correlation context for structured logging (AC5: include domain)
  logger.appendKeys({
    leaseId: leaseId.uuid,
    userEmail: leaseId.userEmail,
    templateId,
    eventId,
    idempotencyKey,
    domain,
  });

  logger.info('LeaseRequested event received', {
    detailType: validatedEvent['detail-type'],
    budgetAmount: validatedEvent.detail.budgetAmount,
    leaseDurationHours: validatedEvent.detail.leaseDurationHours,
    requiresManualApproval: validatedEvent.detail.requiresManualApproval,
  });

  // Track score for error reporting (populated after state machine runs)
  let currentScore: number | undefined;

  try {
    // Check business hours first
    const businessHoursResult = await checkBusinessHoursNow();

    // Check account availability
    const accountReadinessCheck = await checkAccountReadinessNow();

    // Query user and org history before running state machine
    const userLeaseHistory = await queryUserHistory(leaseId.userEmail);
    const orgLeaseHistory = await queryOrgHistory(leaseId.userEmail);

    // Check domain verification (uses domain already extracted for logging)
    const isVerifiedDomain = await checkDomainVerification(domain);

    // Analyze email with AI (uses circuit breaker and fallback)
    const aiAnalysis = await analyzeEmailWithAI(leaseId.userEmail);

    // Prepare context and run state machine
    const initialContext = prepareContext(
      validatedEvent,
      userLeaseHistory,
      orgLeaseHistory,
      isVerifiedDomain,
      businessHoursResult,
      accountReadinessCheck,
      aiAnalysis
    );
    const result = orchestrator.run(ApprovalState.RECEIVED, initialContext);

    // Capture score for error handling
    currentScore = result.context.score;

    // Handle state machine result
    if (!result.success) {
      // State machine ended in ERROR state - fail-closed behavior
      const errorMessage = result.context.error?.message ?? 'Unknown error';
      const errorCode = result.context.error?.code ?? 'UNKNOWN_ERROR';

      logger.error('State machine failed - triggering fail-closed escalation', {
        finalState: result.finalState,
        error: result.context.error,
        leaseId: leaseId.uuid,
        userEmail: leaseId.userEmail,
      });

      // Emit LeaseEscalated event before throwing for DLQ
      await emitEscalationOnError(
        leaseId,
        `State machine error: ${errorMessage}`,
        errorCode,
        result.context.score
      );

      // Throw to route to DLQ - fail-closed behavior
      throw new ProcessingError(
        errorMessage,
        errorCode,
        leaseId.uuid,
        leaseId.userEmail,
        result.context.score
      );
    }

    // Handle based on decision
    const { decision, approvedBy, reason, score, allowListOverride } = result.context;

    if (decision === 'approved') {
      // Log allow-list override if applicable
      if (allowListOverride) {
        // Note: For allow-list override, score is 0 as scoring was bypassed
        // The calculated score for reference would require running the scoring engine
        // which is intentionally skipped for performance. Logging score=0 with override flag.
        logger.info('ALLOW-LIST-OVERRIDE applied', {
          action: 'approved',
          allowListOverride: true,
          userEmail: leaseId.userEmail,
          score: score, // Will be 0 for allow-list override
          reason: 'Scoring bypassed for allow-listed user',
        });
      }

      // Approve lease via direct ISB Lambda invocation
      const approverEmail = approvedBy ?? 'ndx+try-automated-approver@dsit.gov.uk';
      const approvalResult = await isbLambdaService.approveLease({
        leaseId,
        approverEmail,
      });

      if (!approvalResult.success) {
        // Story 6.2 AC8: TOCTOU race condition detection
        // ISB may reject approval if account is no longer available (race condition)
        // ISB also returns 409 when the lease is no longer in PendingApproval state
        // (e.g., already approved/denied/expired) - this is a permanent failure, not transient
        const errorLower = approvalResult.error?.toLowerCase() ?? '';

        // Check for "already processed" FIRST (must be 409 + specific message)
        // ISB messages: "Only leases in a pending state can be approved/denied."
        //               "Lease already approved", "Lease already denied"
        const isLeaseAlreadyProcessed =
          approvalResult.statusCode === 409 &&
          (errorLower.includes('pending state') ||
            errorLower.includes('already approved') ||
            errorLower.includes('already denied'));

        if (isLeaseAlreadyProcessed) {
          logger.info('Lease no longer in pending state - treating as already processed', {
            leaseId: leaseId.uuid,
            userEmail: leaseId.userEmail,
            statusCode: approvalResult.statusCode,
            error: approvalResult.error,
          });

          return {
            statusCode: 200,
            body: 'Lease already processed - no action needed',
          };
        }

        // TOCTOU: account became unavailable between pre-check and approval attempt
        // Only match specific "no account" messages - do NOT use bare statusCode === 409
        // as a catch-all, since unrecognized 409s should escalate (fail-closed)
        const isAccountUnavailable =
          errorLower.includes('no available account') ||
          errorLower.includes('account not available') ||
          errorLower.includes('no sandbox available');

        if (isAccountUnavailable && sqsService) {
          logger.warn('TOCTOU race condition detected - re-queuing request', {
            leaseId: leaseId.uuid,
            userEmail: leaseId.userEmail,
            error: approvalResult.error,
          });

          // Re-queue the request instead of failing
          const referenceNumber = generateReferenceNumber(leaseId.uuid);
          await updateLeaseComments(leaseId, buildReprocessingMessage(referenceNumber));

          // Add back to delay queue for reprocessing (retry after 5 minutes)
          const now = new Date();
          const processAfter = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes delay
          await sqsService.sendDelayedRequest({
            leaseId,
            originalEvent: validatedEvent,
            receivedAt: now.toISOString(),
            processAfter: processAfter.toISOString(),
            reason: 'TOCTOU_REQUEUE',
          });

          return {
            statusCode: 202,
            body: 'Request re-queued due to account unavailability',
          };
        }

        logger.error('ISB Lambda approval failed', {
          leaseId: leaseId.uuid,
          userEmail: leaseId.userEmail,
          statusCode: approvalResult.statusCode,
          error: approvalResult.error,
        });

        // Escalate on approval failure (non-TOCTOU)
        await emitEscalationOnError(
          leaseId,
          `ISB Lambda approval failed: ${approvalResult.error}`,
          'ISB_APPROVAL_FAILED',
          score
        );

        throw new ProcessingError(
          approvalResult.error ?? 'ISB approval failed',
          'ISB_APPROVAL_FAILED',
          leaseId.uuid,
          leaseId.userEmail,
          score
        );
      }

      logger.info('Lease approved via ISB Lambda', {
        action: 'approved',
        timestamp: new Date().toISOString(),
        leaseId: leaseId.uuid,
        userEmail: leaseId.userEmail,
        approvedBy: approverEmail,
        score,
        scoreBreakdown: result.context.scoreBreakdown,
        reason: reason ?? 'Auto-approved',
        allowListOverride,
      });

      // Update lease comments (Story 5.1 AC2, AC3)
      const referenceNumber = generateReferenceNumber(leaseId.uuid);
      const commentsMessage = allowListOverride
        ? buildAllowListApprovedMessage(score, referenceNumber)
        : buildAutoApprovedMessage(score, referenceNumber);
      await updateLeaseComments(leaseId, commentsMessage);

      return {
        statusCode: 200,
        body: 'OK',
      };
    }

    if (decision === 'escalated') {
      // Log escalation for manual review
      logger.info('Request escalated for manual review', {
        action: 'escalated',
        timestamp: new Date().toISOString(),
        leaseId: leaseId.uuid,
        userEmail: leaseId.userEmail,
        score,
        scoreBreakdown: result.context.scoreBreakdown,
        reason,
      });

      // Update lease comments (Story 5.1 AC4)
      const referenceNumber = generateReferenceNumber(leaseId.uuid);
      const scoreBreakdown = ruleResultsToBreakdown(result.context.scoreBreakdown ?? []);
      const escalatedMessage = buildEscalatedMessage(score, scoreBreakdown, referenceNumber);
      await updateLeaseComments(leaseId, escalatedMessage);

      // Send SNS notification for Amazon Q Developer (Story 7.1.1, enhanced in 7.1.3)
      // Fails silently - request remains escalated regardless of notification status
      // Get queue depth for notification context
      let queueDepthForNotification = 0;
      if (sqsService) {
        const depthResult = await sqsService.getQueueDepth();
        if (depthResult.success) {
          queueDepthForNotification = depthResult.approximateNumberOfMessages ?? 0;
        }
      }

      // Resolve template UUID to human-readable name for notification
      const resolvedTemplateName = await resolveTemplateName(leaseId, templateId);

      // Story 7.1.3: Include template details and comment in notification
      await notifySNSEscalation({
        leaseId: leaseId.uuid,
        userEmail: leaseId.userEmail,
        score,
        scoreBreakdown,
        templateId: resolvedTemplateName,
        leaseDurationHours: validatedEvent.detail.leaseDurationHours,
        budgetAmount: validatedEvent.detail.budgetAmount,
        comment: validatedEvent.detail.comments,
        referenceNumber,
        threshold: stateMachineConfig.autoApproveThreshold,
        queueDepth: queueDepthForNotification,
      });

      return {
        statusCode: 200,
        body: 'OK',
      };
    }

    if (decision === 'delayed') {
      // Determine delay reason: business hours or no available accounts
      const { accountDelayReason, activeAccountCount } = result.context;
      const isNoAccountsDelay = accountDelayReason === 'NO_READY_ACCOUNTS';

      // For no-accounts delays, add to queue position table (Story 6.3)
      let queuePosition: number | undefined;
      let queueDepth: number | undefined;

      if (isNoAccountsDelay) {
        try {
          // Get current queue depth first
          const depthResult = await getQueueDepth(dynamoDBClient, queuePositionConfig);
          if (depthResult.success) {
            queueDepth = depthResult.queueDepth;
          }

          // Add to queue position table
          const addResult = await addToQueue(dynamoDBClient, queuePositionConfig, {
            leaseId,
          });

          if (addResult.success && addResult.position) {
            queuePosition = addResult.position;
            queueDepth = (queueDepth ?? 0) + 1; // Increment if we just added

            logger.info('Added request to queue position table', {
              leaseId: leaseId.uuid,
              queuePosition,
              queueDepth,
            });

            // Log capacity status for monitoring
            // All accounts being active means high demand
            const isCapacityCrunch = (activeAccountCount ?? 0) > 0;
            if (isCapacityCrunch) {
              logger.info('All accounts in use - notification via SNS/Amazon Q', {
                activeAccounts: activeAccountCount ?? 0,
                pendingRequests: queueDepth,
              });
            }
          } else {
            logger.warn('Failed to add to queue position table - continuing with delay', {
              leaseId: leaseId.uuid,
              error: addResult.error,
            });
          }
        } catch (error) {
          // Don't fail the request if queue position tracking fails
          logger.warn('Error tracking queue position - continuing with delay', {
            leaseId: leaseId.uuid,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      logger.info('Request delayed', {
        action: 'delayed',
        timestamp: new Date().toISOString(),
        leaseId: leaseId.uuid,
        userEmail: leaseId.userEmail,
        reason,
        delayReason: isNoAccountsDelay ? 'no_accounts_available' : 'outside_business_hours',
        nextProcessingTime: result.context.nextProcessingTime,
        accountDelayReason,
        queuePosition,
        queueDepth,
      });

      // Check if SQS service is configured
      if (!sqsService) {
        // No delay queue configured - escalate instead (fail-closed)
        logger.warn('Delay queue not configured - escalating instead', {
          leaseId: leaseId.uuid,
          userEmail: leaseId.userEmail,
        });

        await emitEscalationOnError(
          leaseId,
          'Request delayed but no delay queue configured',
          'DELAY_QUEUE_NOT_CONFIGURED',
          score
        );

        throw new ProcessingError(
          'Delay queue not configured',
          'DELAY_QUEUE_NOT_CONFIGURED',
          leaseId.uuid,
          leaseId.userEmail,
          score
        );
      }

      // Send to delay queue
      const delayMessage: DelayedLeaseMessage = {
        leaseId,
        originalEvent: validatedEvent,
        receivedAt: new Date().toISOString(),
        processAfter: result.context.nextProcessingTime ?? new Date().toISOString(),
        reason: reason ?? (isNoAccountsDelay ? 'No available accounts' : 'Outside business hours'),
      };

      const sqsResult = await sqsService.sendDelayedRequest(delayMessage);

      if (!sqsResult.success) {
        // SQS send failed - escalate (fail-closed)
        logger.error('Failed to send to delay queue - escalating', {
          leaseId: leaseId.uuid,
          userEmail: leaseId.userEmail,
          error: sqsResult.error,
        });

        await emitEscalationOnError(
          leaseId,
          `Failed to send to delay queue: ${sqsResult.error}`,
          'DELAY_QUEUE_SEND_FAILED',
          score
        );

        throw new ProcessingError(
          sqsResult.error ?? 'Failed to send to delay queue',
          'DELAY_QUEUE_SEND_FAILED',
          leaseId.uuid,
          leaseId.userEmail,
          score
        );
      }

      logger.info('Request sent to delay queue', {
        action: 'delayed',
        messageId: sqsResult.messageId,
        leaseId: leaseId.uuid,
        userEmail: leaseId.userEmail,
        processAfter: delayMessage.processAfter,
        delayReason: isNoAccountsDelay ? 'no_accounts_available' : 'outside_business_hours',
        queuePosition,
      });

      // Update lease comments with appropriate message
      const referenceNumber = generateReferenceNumber(leaseId.uuid);
      let delayedMessage: string;

      if (isNoAccountsDelay) {
        // No accounts available
        delayedMessage = buildNoAccountsDelayMessage(referenceNumber);
      } else {
        // Business hours delay
        delayedMessage = buildDelayedMessage(referenceNumber);
      }
      await updateLeaseComments(leaseId, delayedMessage);

      return {
        statusCode: 200,
        body: 'Delayed - will process during next business hours',
      };
    }

    if (decision === 'denied') {
      // Denied requests are logged for future implementation
      logger.info('Request denied', {
        action: 'denied',
        timestamp: new Date().toISOString(),
        leaseId: leaseId.uuid,
        userEmail: leaseId.userEmail,
        score,
        scoreBreakdown: result.context.scoreBreakdown,
        reason,
      });

      // TODO: In future story, this will emit LeaseDenied event
      // For now, return error as denied is not fully implemented
      return {
        statusCode: 500,
        body: 'Denied requests not yet implemented',
      };
    }

    // Unexpected decision - log warning but don't fail-closed
    logger.warn('Unexpected decision from state machine', {
      decision,
      finalState: result.finalState,
    });

    return {
      statusCode: 500,
      body: 'Unexpected processing state',
    };
  } catch (error) {
    // If it's already a ProcessingError, re-throw for DLQ routing
    if (error instanceof ProcessingError) {
      throw error;
    }

    // Unexpected error - apply fail-closed behavior
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Unexpected error - triggering fail-closed escalation', {
      error: errorMessage,
      leaseId: leaseId.uuid,
      userEmail: leaseId.userEmail,
    });

    // Emit LeaseEscalated event before throwing for DLQ
    await emitEscalationOnError(
      leaseId,
      `Unexpected error: ${errorMessage}`,
      'UNEXPECTED_ERROR',
      currentScore
    );

    // Throw to route to DLQ
    throw new ProcessingError(
      errorMessage,
      'UNEXPECTED_ERROR',
      leaseId.uuid,
      leaseId.userEmail,
      currentScore
    );
  }
};
