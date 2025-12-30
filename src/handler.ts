import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { LambdaClient } from '@aws-sdk/client-lambda';
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
import {
  createBedrockService,
  type BedrockService,
} from './services/bedrock.js';
import {
  createSQSService,
  type SQSService,
  type DelayedLeaseMessage,
  type ReceivedMessage,
} from './services/sqs.js';
import {
  createSlackService,
  type SlackService,
  type EscalationNotificationParams,
} from './services/slack.js';
import { getSlackWebhookUrl } from './lib/secrets.js';
import {
  createBusinessHoursChecker,
  isQueueExpired,
  type BusinessHoursResult,
} from './lib/business-hours.js';
import {
  createBankHolidayService,
  type BankHolidayService,
} from './services/bank-holidays.js';
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
  buildCooldownDelayMessage,
  buildReprocessingMessage,
  ruleResultsToBreakdown,
} from './lib/lease-comments.js';
import {
  checkAccountReadiness,
  getConfigFromEnvironment,
} from './lib/account-cooldown.js';
import {
  calculateQueueEstimate,
  buildQueueEstimateComment,
} from './lib/queue-estimate.js';
import {
  addToQueue,
  removeFromQueue,
  getQueueDepth,
  getOldestPending,
  keyToLeaseId,
  getLastCapacityCrunchAlertTime,
  updateLastCapacityCrunchAlertTime,
  type QueuePositionServiceConfig,
} from './services/queue-position.js';
import {
  shouldSendCapacityCrunchAlert,
  buildCapacityCrunchAlert,
  type CapacityStatus,
} from './lib/capacity-crunch.js';
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

// Lambda client for direct ISB Lambda invocation
const lambdaClient = new LambdaClient({
  region: process.env.AWS_REGION || 'us-west-2',
});

// ISB Lambda service configuration
const isbLambdaConfig = {
  functionName: process.env.ISB_LEASES_LAMBDA_NAME || 'ISB-LeasesLambdaFunction-ndx',
  accountsFunctionName: process.env.ISB_ACCOUNTS_LAMBDA_NAME || 'ISB-AccountsLambdaFunction-ndx',
};

// Create ISB Lambda service (can be overridden in tests via dependency injection)
let isbLambdaService: IsbLambdaService = createIsbLambdaService(lambdaClient, isbLambdaConfig);

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

// Slack service configuration (Story 5.2)
// ISB Console URL for deep links in notifications
const isbConsoleUrl = process.env.ISB_CONSOLE_URL || '';

// Slack service (initialized lazily on first escalation)
let slackService: SlackService | undefined;

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
  isbLambdaService = createIsbLambdaService(lambdaClient, isbLambdaConfig);
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
export const setDomainAllowlistService = (
  service: DomainAllowlistService | undefined
): void => {
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
 * Allows overriding the Slack service for testing purposes (Story 5.2).
 */
export const setSlackService = (service: SlackService | undefined): void => {
  slackService = service;
};

/**
 * Resets the Slack service to undefined (for test cleanup).
 * The service is lazily initialized on first escalation.
 */
export const resetSlackService = (): void => {
  slackService = undefined;
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
 * Checks account readiness by querying ISB Lambda and applying cooldown logic.
 * Returns account readiness result for inclusion in state context.
 * Returns a "proceed" result on failure (pessimistic: let scoring decide).
 */
const checkAccountReadinessNow = async (): Promise<{
  hasReadyAccount: boolean;
  readyAccountCount: number;
  coolingAccountCount: number;
  activeAccountCount: number;
  estimatedAccountReadyTime: string | undefined;
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
        readyAccountCount: 0,
        coolingAccountCount: 0,
        activeAccountCount: 0,
        estimatedAccountReadyTime: undefined,
        accountDelayReason: undefined, // No delay, proceed with warning
      };
    }

    // Apply cooldown logic
    const cooldownConfig = getConfigFromEnvironment();
    const now = new Date();
    const readinessResult = checkAccountReadiness(accountsResult.accounts, now, cooldownConfig);

    logger.info('Account readiness check completed', {
      totalAccounts: accountsResult.accounts.length,
      readyAccounts: readinessResult.readyAccounts.length,
      coolingAccounts: readinessResult.coolingAccounts.length,
      activeAccounts: readinessResult.activeAccounts.length,
      hasReadyAccount: readinessResult.hasReadyAccount,
      estimatedReadyTime: readinessResult.estimatedReadyTime?.toISOString(),
    });

    return {
      hasReadyAccount: readinessResult.hasReadyAccount,
      readyAccountCount: readinessResult.readyAccounts.length,
      coolingAccountCount: readinessResult.coolingAccounts.length,
      activeAccountCount: readinessResult.activeAccounts.length,
      estimatedAccountReadyTime: readinessResult.estimatedReadyTime?.toISOString(),
      accountDelayReason: readinessResult.hasReadyAccount ? undefined : 'NO_READY_ACCOUNTS',
    };
  } catch (error) {
    logger.error('Error checking account readiness - proceeding to scoring', {
      error: error instanceof Error ? error.message : String(error),
    });
    // On error, proceed (let scoring decide)
    return {
      hasReadyAccount: true,
      readyAccountCount: 0,
      coolingAccountCount: 0,
      activeAccountCount: 0,
      estimatedAccountReadyTime: undefined,
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
};

/** Account readiness check result for context preparation */
interface AccountReadinessCheck {
  hasReadyAccount: boolean;
  readyAccountCount: number;
  coolingAccountCount: number;
  activeAccountCount: number;
  estimatedAccountReadyTime: string | undefined;
  accountDelayReason: 'NO_READY_ACCOUNTS' | 'ACCOUNT_FETCH_ERROR' | undefined;
}

/**
 * Prepares the initial state context from a validated event.
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
  const { leaseId, templateId, budgetAmount, leaseDurationHours, requiresManualApproval, comments } =
    detail;

  return {
    ...createInitialContext(),
    leaseId: leaseId.uuid,
    userEmail: leaseId.userEmail,
    templateId,
    budgetAmount,
    leaseDurationHours,
    requiresManualApproval,
    comments,
    userLeaseHistory,
    orgLeaseHistory,
    isVerifiedGovDomain: isVerifiedDomain,
    aiAnalysis,
    // Business hours data from checker
    isWithinBusinessHours: businessHoursResult.isWithinBusinessHours,
    isEndOfWindow: businessHoursResult.isEndOfWindow,
    nextProcessingTime: businessHoursResult.nextProcessingTime,
    // Account readiness data from cooldown check (Epic 6)
    hasReadyAccount: accountReadinessCheck.hasReadyAccount,
    readyAccountCount: accountReadinessCheck.readyAccountCount,
    coolingAccountCount: accountReadinessCheck.coolingAccountCount,
    activeAccountCount: accountReadinessCheck.activeAccountCount,
    estimatedAccountReadyTime: accountReadinessCheck.estimatedAccountReadyTime,
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
 * Sends a Slack notification for an escalated request (Story 5.2).
 * Initializes Slack service lazily on first use.
 * Fails silently to avoid blocking the approval flow (AC6).
 *
 * @param params - Escalation notification parameters
 */
const notifySlackEscalation = async (
  params: EscalationNotificationParams
): Promise<void> => {
  // If Slack service is already set (e.g., via dependency injection for testing),
  // skip configuration checks and use it directly
  if (!slackService) {
    // Check if ISB console URL is configured
    if (!isbConsoleUrl) {
      logger.warn('ISB_CONSOLE_URL not configured - skipping Slack notification', {
        leaseId: params.leaseId,
      });
      return;
    }

    // Check if SQS service is available for queue depth
    if (!sqsService) {
      logger.warn('SQS service not configured - skipping Slack notification', {
        leaseId: params.leaseId,
      });
      return;
    }

    // Initialize Slack service lazily
    const webhookResult = await getSlackWebhookUrl();
    if (!webhookResult.success) {
      logger.warn('Failed to get Slack webhook URL - skipping notification', {
        leaseId: params.leaseId,
        error: webhookResult.error,
      });
      return;
    }

    slackService = createSlackService(
      webhookResult.webhookUrl!,
      isbConsoleUrl,
      sqsService,
      logger as unknown as import('./services/slack.js').SlackLogger,
      stateMachineConfig.autoApproveThreshold
    );
  }

  try {
    const result = await slackService.notifyEscalation(params);
    if (!result.success) {
      logger.warn('Slack notification failed - request still escalated', {
        leaseId: params.leaseId,
        error: result.error,
        statusCode: result.statusCode,
      });
    }
  } catch (error) {
    // Log and continue - AC6 requires graceful failure
    logger.warn('Error sending Slack notification - request still escalated', {
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

    if (result.statusCode === 200) {
      // Success - delete the message
      if (!sqsService) {
        logger.error('SQS service not available for message deletion');
        return false;
      }

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
      });
      return true;
    }

    // Processing returned non-200 - leave message in queue
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
const processExpiredMessage = async (
  message: ReceivedMessage
): Promise<boolean> => {
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
    if (!sqsService) {
      logger.error('SQS service not available for message deletion');
      return false;
    }

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

  // Check account readiness (Epic 6 - use actual account cooldown check)
  const accountReadiness = await checkAccountReadinessNow();
  if (!accountReadiness.hasReadyAccount) {
    logger.info('No ready accounts available - skipping queue processing', {
      triggerType,
      readyAccountCount: accountReadiness.readyAccountCount,
      coolingAccountCount: accountReadiness.coolingAccountCount,
      activeAccountCount: accountReadiness.activeAccountCount,
      estimatedAccountReadyTime: accountReadiness.estimatedAccountReadyTime,
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

  // Story 6.3: Get oldest pending request from DynamoDB queue position table (FIFO)
  let oldestLeaseId: { userEmail: string; uuid: string } | undefined;
  try {
    const oldestResult = await getOldestPending(dynamoDBClient, queuePositionConfig);
    if (oldestResult.success && oldestResult.record) {
      oldestLeaseId = keyToLeaseId(oldestResult.record.leaseId);
      logger.info('Found oldest pending request for FIFO processing', {
        leaseId: oldestLeaseId.uuid,
        userEmail: oldestLeaseId.userEmail,
        position: oldestResult.record.position,
        queuedAt: oldestResult.record.queuedAt,
        triggerType,
      });
    }
  } catch (error) {
    logger.warn('Failed to get oldest pending from queue position table - falling back to SQS order', {
      error: error instanceof Error ? error.message : String(error),
      triggerType,
    });
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

  // Receive oldest message from queue
  const receiveResult = await sqsService.receiveMessages(1, 300);
  if (!receiveResult.success) {
    logger.error('Failed to receive messages from queue', {
      error: receiveResult.error,
      triggerType,
    });
    return {
      statusCode: 500,
      body: `Failed to receive messages: ${receiveResult.error}`,
    };
  }

  if (receiveResult.messages.length === 0) {
    // No messages in SQS but might have stale entries in DynamoDB - clean up
    if (oldestLeaseId) {
      logger.warn('DynamoDB queue has entries but SQS is empty - cleaning up', {
        leaseId: oldestLeaseId.uuid,
      });
      await removeFromQueue(dynamoDBClient, queuePositionConfig, oldestLeaseId);
    }
    logger.info('No messages in delay queue', {
      triggerType,
    });
    return {
      statusCode: 200,
      body: 'No messages in queue',
    };
  }

  // Process the oldest message (messages are already sorted by SentTimestamp)
  const message = receiveResult.messages[0]!;

  // Get bank holidays for expiry check
  const bankHolidays = await bankHolidayService.getBankHolidays();

  // Check if the message has expired (> 5 business days in queue)
  const queuedAt = new Date(message.body.receivedAt);
  const isExpired = isQueueExpired(queuedAt, queueExpiryDays, bankHolidays);

  let success: boolean;
  let action: string;

  if (isExpired) {
    // Message has expired - expire it without processing
    success = await processExpiredMessage(message);
    action = 'expired';
  } else {
    // Message is still valid - process it
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
      // Don't fail if cleanup fails - message is already processed
      logger.warn('Failed to remove from queue position table', {
        leaseId: processedLeaseId.uuid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Log queue depth after processing (AC4)
  const depthAfterResult = await sqsService.getQueueDepth();
  if (depthAfterResult.success) {
    logger.info('Queue depth after processing', {
      approximateNumberOfMessages: depthAfterResult.approximateNumberOfMessages,
      depthBefore,
      action,
      success: success ? 1 : 0,
      triggerType,
    });
  }

  if (action === 'expired') {
    return {
      statusCode: 200,
      body: success ? 'Expired 1 stale message from queue' : 'Failed to expire stale message',
    };
  }

  return {
    statusCode: 200,
    body: success ? 'Processed 1 message from queue' : 'Message processing failed - will retry',
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
  } catch {
    domain = 'unknown';
  }

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

    // Check account readiness (Epic 6 - account cooldown)
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
        const isAccountUnavailable =
          approvalResult.error?.includes('no available account') ||
          approvalResult.error?.includes('account not available') ||
          approvalResult.error?.includes('no sandbox available') ||
          approvalResult.statusCode === 409; // Conflict status

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
      const escalatedMessage = buildEscalatedMessage(
        score,
        scoreBreakdown,
        referenceNumber
      );
      await updateLeaseComments(leaseId, escalatedMessage);

      // Send Slack notification (Story 5.2)
      // AC6: Fails silently - request remains escalated regardless of notification status
      await notifySlackEscalation({
        leaseId: leaseId.uuid,
        userEmail: leaseId.userEmail,
        score,
        scoreBreakdown,
        templateId,
        referenceNumber,
      });

      return {
        statusCode: 200,
        body: 'OK',
      };
    }

    if (decision === 'delayed') {
      // Determine delay reason: business hours or account cooldown
      const { accountDelayReason, estimatedAccountReadyTime, coolingAccountCount, activeAccountCount } = result.context;
      const isAccountCooldownDelay = accountDelayReason === 'NO_READY_ACCOUNTS';

      // For account cooldown delays, add to queue position table (Story 6.3)
      let queuePosition: number | undefined;
      let queueDepth: number | undefined;
      let queueEstimateMessage: string | undefined;

      if (isAccountCooldownDelay) {
        try {
          // Get current queue depth first
          const depthResult = await getQueueDepth(dynamoDBClient, queuePositionConfig);
          if (depthResult.success) {
            queueDepth = depthResult.queueDepth;
          }

          // Parse estimated fulfillment time if available
          const estimatedTime = estimatedAccountReadyTime
            ? new Date(estimatedAccountReadyTime)
            : null;

          // Add to queue position table
          const addResult = await addToQueue(dynamoDBClient, queuePositionConfig, {
            leaseId,
            estimatedFulfillmentTime: estimatedTime,
          });

          if (addResult.success && addResult.position) {
            queuePosition = addResult.position;
            queueDepth = (queueDepth ?? 0) + 1; // Increment if we just added

            // Calculate queue estimate with user-friendly message
            // Use empty arrays but pass isCapacityCrunch override since we have the counts
            const isCapacityCrunch = (coolingAccountCount ?? 0) === 0 && (activeAccountCount ?? 0) > 0;
            const queueEstimate = calculateQueueEstimate(
              [], // cooling accounts - not available in this context
              [], // active accounts - not available in this context
              queuePosition,
              queueDepth,
              new Date(),
              undefined, // use default cooldown config
              { isCapacityCrunchOverride: isCapacityCrunch }
            );

            queueEstimateMessage = queueEstimate.message;

            logger.info('Added request to queue position table', {
              leaseId: leaseId.uuid,
              queuePosition,
              queueDepth,
              estimatedFulfillmentTime: estimatedTime?.toISOString(),
            });

            // Story 6.4: Send capacity crunch alert to Slack if applicable
            if (isCapacityCrunch && slackService) {
              try {
                const now = new Date();

                // Get last alert time from DynamoDB
                const lastAlertResult = await getLastCapacityCrunchAlertTime(dynamoDBClient, queuePositionConfig);
                const lastAlertTime = lastAlertResult.success ? lastAlertResult.lastAlertTime : null;

                // Check if we should send alert (throttled to once per hour)
                if (shouldSendCapacityCrunchAlert(true, lastAlertTime, now)) {
                  // Build capacity status for alert
                  const capacityStatus: CapacityStatus = {
                    isCapacityCrunch: true,
                    totalAccounts: (activeAccountCount ?? 0),
                    activeCount: activeAccountCount ?? 0,
                    availableCount: 0,
                    readyCount: 0,
                    coolingCount: 0,
                    pendingRequests: queueDepth,
                    soonestAvailableHours: estimatedTime
                      ? Math.max(0, (estimatedTime.getTime() - now.getTime()) / (60 * 60 * 1000))
                      : null,
                  };

                  const alert = buildCapacityCrunchAlert(capacityStatus);
                  const alertResult = await slackService.notifyCapacityCrunch(alert);

                  if (alertResult.success) {
                    // Update last alert time in DynamoDB
                    await updateLastCapacityCrunchAlertTime(dynamoDBClient, queuePositionConfig, now);
                    logger.info('Capacity crunch alert sent to Slack', {
                      activeAccounts: capacityStatus.activeCount,
                      pendingRequests: capacityStatus.pendingRequests,
                    });
                  } else {
                    // Don't fail the request if alert fails
                    logger.warn('Failed to send capacity crunch alert to Slack', {
                      error: alertResult.error,
                    });
                  }
                } else {
                  logger.debug('Capacity crunch alert throttled', {
                    lastAlertTime: lastAlertTime?.toISOString(),
                  });
                }
              } catch (error) {
                // Don't fail the request if alert handling fails
                logger.warn('Error processing capacity crunch alert', {
                  error: error instanceof Error ? error.message : String(error),
                });
              }
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
        delayReason: isAccountCooldownDelay ? 'account_cooldown' : 'outside_business_hours',
        nextProcessingTime: result.context.nextProcessingTime,
        estimatedAccountReadyTime,
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
        reason: reason ?? (isAccountCooldownDelay ? 'No ready accounts' : 'Outside business hours'),
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
        delayReason: isAccountCooldownDelay ? 'account_cooldown' : 'outside_business_hours',
        queuePosition,
      });

      // Update lease comments with appropriate message
      const referenceNumber = generateReferenceNumber(leaseId.uuid);
      let delayedMessage: string;

      if (isAccountCooldownDelay && queueEstimateMessage) {
        // Use the queue estimate message with position info
        delayedMessage = buildQueueEstimateComment(
          {
            position: queuePosition ?? 1,
            estimatedFulfillmentTime: estimatedAccountReadyTime ? new Date(estimatedAccountReadyTime) : null,
            isCapacityCrunch: (coolingAccountCount ?? 0) === 0 && (activeAccountCount ?? 0) > 0,
            message: queueEstimateMessage,
            queueDepth: queueDepth ?? 1,
          },
          referenceNumber
        );
      } else if (isAccountCooldownDelay) {
        // Fallback to cooldown message without queue position
        delayedMessage = buildCooldownDelayMessage(referenceNumber, estimatedAccountReadyTime);
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
