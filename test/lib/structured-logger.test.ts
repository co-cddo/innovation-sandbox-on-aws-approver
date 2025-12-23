/**
 * Structured Logger Tests (Story 5.3)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createStructuredLogger,
  SYSTEM_ATTRIBUTION,
  ALLOWLIST_ATTRIBUTION,
  createManualAttribution,
  type DecisionLogParams,
} from '../../src/lib/structured-logger.js';

// Mock @aws-lambda-powertools/logger
const mockAppendKeys = vi.fn();
const mockInfo = vi.fn();
const mockWarn = vi.fn();
const mockError = vi.fn();
const mockDebug = vi.fn();

vi.mock('@aws-lambda-powertools/logger', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    appendKeys: mockAppendKeys,
    info: mockInfo,
    warn: mockWarn,
    error: mockError,
    debug: mockDebug,
  })),
}));

describe('Structured Logger (Story 5.3)', () => {
  const leaseId = 'test-lease-123';
  const eventId = 'test-event-456';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createStructuredLogger', () => {
    it('should create a logger with base context', () => {
      const logger = createStructuredLogger(leaseId, eventId);

      expect(logger).toBeDefined();
      expect(mockAppendKeys).toHaveBeenCalledWith({
        leaseId,
        eventId,
        traceId: `${leaseId}:${eventId}`,
      });
    });

    it('should generate correct trace ID', () => {
      const logger = createStructuredLogger(leaseId, eventId);
      expect(logger.getTraceId()).toBe(`${leaseId}:${eventId}`);
    });

    it('should accept custom service name', () => {
      createStructuredLogger(leaseId, eventId, 'custom-service');
      // Logger is created with custom service name (verified by mock setup)
      expect(mockAppendKeys).toHaveBeenCalled();
    });
  });

  describe('appendLeaseContext (AC1)', () => {
    it('should append user email to context', () => {
      const logger = createStructuredLogger(leaseId, eventId);

      logger.appendLeaseContext({ userEmail: 'user@example.gov.uk' });

      expect(mockAppendKeys).toHaveBeenCalledWith({
        userEmail: 'user@example.gov.uk',
      });
    });

    it('should append domain to context', () => {
      const logger = createStructuredLogger(leaseId, eventId);

      logger.appendLeaseContext({ domain: 'example.gov.uk' });

      expect(mockAppendKeys).toHaveBeenCalledWith({
        domain: 'example.gov.uk',
      });
    });

    it('should append templateId to context', () => {
      const logger = createStructuredLogger(leaseId, eventId);

      logger.appendLeaseContext({ templateId: 'bedrock-basic' });

      expect(mockAppendKeys).toHaveBeenCalledWith({
        templateId: 'bedrock-basic',
      });
    });

    it('should append multiple context values', () => {
      const logger = createStructuredLogger(leaseId, eventId);

      logger.appendLeaseContext({
        userEmail: 'user@example.gov.uk',
        domain: 'example.gov.uk',
        templateId: 'bedrock-pro',
      });

      expect(mockAppendKeys).toHaveBeenCalledWith({
        userEmail: 'user@example.gov.uk',
        domain: 'example.gov.uk',
        templateId: 'bedrock-pro',
      });
    });

    it('should handle empty context', () => {
      const logger = createStructuredLogger(leaseId, eventId);

      logger.appendLeaseContext({});

      expect(mockAppendKeys).toHaveBeenCalledWith({});
    });
  });

  describe('logStateTransition (AC5)', () => {
    it('should log state transition with duration', () => {
      const logger = createStructuredLogger(leaseId, eventId);

      logger.logStateTransition({
        from: 'SCORING',
        to: 'DECIDING',
        durationMs: 150,
      });

      expect(mockInfo).toHaveBeenCalledWith('State transition', {
        stateTransition: {
          from: 'SCORING',
          to: 'DECIDING',
          durationMs: 150,
        },
      });
    });

    it('should log transition with zero duration', () => {
      const logger = createStructuredLogger(leaseId, eventId);

      logger.logStateTransition({
        from: 'IDLE',
        to: 'RECEIVED',
        durationMs: 0,
      });

      expect(mockInfo).toHaveBeenCalledWith('State transition', {
        stateTransition: {
          from: 'IDLE',
          to: 'RECEIVED',
          durationMs: 0,
        },
      });
    });
  });

  describe('logDecision (AC6)', () => {
    it('should log approved decision with full audit trail', () => {
      const logger = createStructuredLogger(leaseId, eventId);

      const params: DecisionLogParams = {
        action: 'approved',
        score: 15,
        scoreBreakdown: { first_time_user: 5, verified_domain: -5, org_clean: -5 },
        attribution: SYSTEM_ATTRIBUTION,
        processingTimeMs: 2500,
        templateId: 'bedrock-basic',
      };

      logger.logDecision(params);

      expect(mockInfo).toHaveBeenCalledWith('Decision made', {
        action: 'approved',
        score: 15,
        scoreBreakdown: { first_time_user: 5, verified_domain: -5, org_clean: -5 },
        attribution: SYSTEM_ATTRIBUTION,
        processingTimeMs: 2500,
        templateId: 'bedrock-basic',
      });
    });

    it('should log escalated decision', () => {
      const logger = createStructuredLogger(leaseId, eventId);

      logger.logDecision({
        action: 'escalated',
        score: 25,
        scoreBreakdown: { first_time_user: 5, group_mailbox: 20 },
        attribution: SYSTEM_ATTRIBUTION,
        processingTimeMs: 3000,
      });

      expect(mockInfo).toHaveBeenCalledWith('Decision made', {
        action: 'escalated',
        score: 25,
        scoreBreakdown: { first_time_user: 5, group_mailbox: 20 },
        attribution: SYSTEM_ATTRIBUTION,
        processingTimeMs: 3000,
        templateId: undefined,
      });
    });

    it('should log delayed decision', () => {
      const logger = createStructuredLogger(leaseId, eventId);

      logger.logDecision({
        action: 'delayed',
        score: 10,
        scoreBreakdown: { first_time_user: 5, verified_domain: -5 },
        attribution: SYSTEM_ATTRIBUTION,
        processingTimeMs: 500,
      });

      expect(mockInfo).toHaveBeenCalledWith('Decision made', {
        action: 'delayed',
        score: 10,
        scoreBreakdown: { first_time_user: 5, verified_domain: -5 },
        attribution: SYSTEM_ATTRIBUTION,
        processingTimeMs: 500,
        templateId: undefined,
      });
    });

    it('should log manual attribution correctly', () => {
      const logger = createStructuredLogger(leaseId, eventId);
      const manualAttribution = createManualAttribution('operator@example.gov.uk');

      logger.logDecision({
        action: 'approved',
        score: 25,
        scoreBreakdown: { group_mailbox: 20, first_time_user: 5 },
        attribution: manualAttribution,
        processingTimeMs: 1000,
      });

      expect(mockInfo).toHaveBeenCalledWith('Decision made', {
        action: 'approved',
        score: 25,
        scoreBreakdown: { group_mailbox: 20, first_time_user: 5 },
        attribution: {
          approvedBy: 'operator@example.gov.uk',
          approvalMethod: 'manual',
        },
        processingTimeMs: 1000,
        templateId: undefined,
      });
    });

    it('should log allow-list attribution correctly', () => {
      const logger = createStructuredLogger(leaseId, eventId);

      logger.logDecision({
        action: 'approved',
        score: 5,
        scoreBreakdown: { first_time_user: 5 },
        attribution: ALLOWLIST_ATTRIBUTION,
        processingTimeMs: 200,
      });

      expect(mockInfo).toHaveBeenCalledWith('Decision made', {
        action: 'approved',
        score: 5,
        scoreBreakdown: { first_time_user: 5 },
        attribution: ALLOWLIST_ATTRIBUTION,
        processingTimeMs: 200,
        templateId: undefined,
      });
    });
  });

  describe('logEventReceived', () => {
    it('should log event received with type', () => {
      const logger = createStructuredLogger(leaseId, eventId);

      logger.logEventReceived('LeaseRequested', 'isb.leases');

      expect(mockInfo).toHaveBeenCalledWith('Event received', {
        action: 'received',
        eventType: 'LeaseRequested',
        source: 'isb.leases',
      });
    });

    it('should log event without source', () => {
      const logger = createStructuredLogger(leaseId, eventId);

      logger.logEventReceived('ScheduledQueueCheck');

      expect(mockInfo).toHaveBeenCalledWith('Event received', {
        action: 'received',
        eventType: 'ScheduledQueueCheck',
        source: undefined,
      });
    });
  });

  describe('logScoringCompleted', () => {
    it('should log scoring completion with breakdown', () => {
      const logger = createStructuredLogger(leaseId, eventId);

      logger.logScoringCompleted(
        15,
        { first_time_user: 5, group_mailbox: 20, verified_domain: -10 },
        250
      );

      expect(mockInfo).toHaveBeenCalledWith('Scoring completed', {
        action: 'scoring',
        score: 15,
        scoreBreakdown: { first_time_user: 5, group_mailbox: 20, verified_domain: -10 },
        scoringDurationMs: 250,
      });
    });

    it('should log zero score', () => {
      const logger = createStructuredLogger(leaseId, eventId);

      logger.logScoringCompleted(0, {}, 50);

      expect(mockInfo).toHaveBeenCalledWith('Scoring completed', {
        action: 'scoring',
        score: 0,
        scoreBreakdown: {},
        scoringDurationMs: 50,
      });
    });
  });

  describe('Standard logger methods', () => {
    it('should delegate info to Powertools logger', () => {
      const logger = createStructuredLogger(leaseId, eventId);

      logger.info('Test message', { key: 'value' });

      expect(mockInfo).toHaveBeenCalledWith('Test message', { key: 'value' });
    });

    it('should delegate warn to Powertools logger', () => {
      const logger = createStructuredLogger(leaseId, eventId);

      logger.warn('Warning message', { warning: true });

      expect(mockWarn).toHaveBeenCalledWith('Warning message', { warning: true });
    });

    it('should delegate error to Powertools logger', () => {
      const logger = createStructuredLogger(leaseId, eventId);

      logger.error('Error message', { error: 'details' });

      expect(mockError).toHaveBeenCalledWith('Error message', { error: 'details' });
    });

    it('should delegate debug to Powertools logger', () => {
      const logger = createStructuredLogger(leaseId, eventId);

      logger.debug('Debug message', { debug: true });

      expect(mockDebug).toHaveBeenCalledWith('Debug message', { debug: true });
    });

    it('should work without data parameter', () => {
      const logger = createStructuredLogger(leaseId, eventId);

      logger.info('Simple message');

      expect(mockInfo).toHaveBeenCalledWith('Simple message');
    });
  });

  describe('Attribution helpers', () => {
    it('should have correct system attribution', () => {
      expect(SYSTEM_ATTRIBUTION).toEqual({
        approvedBy: 'approver-service@system',
        approvalMethod: 'automatic',
      });
    });

    it('should have correct allow-list attribution', () => {
      expect(ALLOWLIST_ATTRIBUTION).toEqual({
        approvedBy: 'approver-service@system',
        approvalMethod: 'allow-list',
      });
    });

    it('should create manual attribution correctly', () => {
      const attribution = createManualAttribution('admin@gov.uk');

      expect(attribution).toEqual({
        approvedBy: 'admin@gov.uk',
        approvalMethod: 'manual',
      });
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete request flow', () => {
      const logger = createStructuredLogger(leaseId, eventId);

      // Event received
      logger.logEventReceived('LeaseRequested', 'isb.leases');

      // Append context
      logger.appendLeaseContext({
        userEmail: 'user@council.gov.uk',
        domain: 'council.gov.uk',
        templateId: 'bedrock-basic',
      });

      // State transitions
      logger.logStateTransition({ from: 'IDLE', to: 'RECEIVED', durationMs: 5 });
      logger.logStateTransition({ from: 'RECEIVED', to: 'SCORING', durationMs: 10 });

      // Scoring completed
      logger.logScoringCompleted(15, { first_time_user: 5, group_mailbox: 10 }, 200);

      // State transition to deciding
      logger.logStateTransition({ from: 'SCORING', to: 'DECIDING', durationMs: 200 });

      // Decision made
      logger.logDecision({
        action: 'approved',
        score: 15,
        scoreBreakdown: { first_time_user: 5, group_mailbox: 10 },
        attribution: SYSTEM_ATTRIBUTION,
        processingTimeMs: 2500,
        templateId: 'bedrock-basic',
      });

      // Verify all logs were made
      expect(mockInfo).toHaveBeenCalledTimes(6);
      expect(mockAppendKeys).toHaveBeenCalled();
    });
  });
});
