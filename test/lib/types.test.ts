import { describe, it, expect } from 'vitest';
import {
  LeaseIdSchema,
  LeaseRequestedDetailSchema,
  LeaseRequestedEventSchema,
  LeaseApprovedDetailSchema,
} from '../../src/lib/types.js';

describe('LeaseIdSchema', () => {
  it('validates a valid lease ID', () => {
    const validLeaseId = {
      userEmail: 'user@example.gov.uk',
      uuid: '123e4567-e89b-12d3-a456-426614174000',
    };

    const result = LeaseIdSchema.safeParse(validLeaseId);
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const invalidLeaseId = {
      userEmail: 'not-an-email',
      uuid: '123e4567-e89b-12d3-a456-426614174000',
    };

    const result = LeaseIdSchema.safeParse(invalidLeaseId);
    expect(result.success).toBe(false);
  });

  it('rejects invalid UUID', () => {
    const invalidLeaseId = {
      userEmail: 'user@example.gov.uk',
      uuid: 'not-a-uuid',
    };

    const result = LeaseIdSchema.safeParse(invalidLeaseId);
    expect(result.success).toBe(false);
  });
});

describe('LeaseRequestedDetailSchema', () => {
  const validDetail = {
    leaseId: {
      userEmail: 'user@example.gov.uk',
      uuid: '123e4567-e89b-12d3-a456-426614174000',
    },
    templateId: 'web-hosting',
    budgetAmount: 50,
    leaseDurationHours: 48,
    requiresManualApproval: false,
  };

  it('validates a valid lease requested detail', () => {
    const result = LeaseRequestedDetailSchema.safeParse(validDetail);
    expect(result.success).toBe(true);
  });

  it('validates with optional comments', () => {
    const detailWithComments = {
      ...validDetail,
      comments: 'Testing Lambda + API Gateway',
    };

    const result = LeaseRequestedDetailSchema.safeParse(detailWithComments);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.comments).toBe('Testing Lambda + API Gateway');
    }
  });

  it('rejects missing required fields', () => {
    const invalidDetail = {
      leaseId: validDetail.leaseId,
      templateId: 'web-hosting',
      // Missing budgetAmount, leaseDurationHours, requiresManualApproval
    };

    const result = LeaseRequestedDetailSchema.safeParse(invalidDetail);
    expect(result.success).toBe(false);
  });
});

describe('LeaseRequestedEventSchema', () => {
  const validEvent = {
    version: '0',
    id: 'abc123',
    'detail-type': 'LeaseRequested' as const,
    source: 'innovation-sandbox' as const,
    account: '123456789012',
    time: '2025-12-22T10:00:00Z',
    region: 'us-west-2',
    resources: [],
    detail: {
      leaseId: {
        userEmail: 'user@example.gov.uk',
        uuid: '123e4567-e89b-12d3-a456-426614174000',
      },
      templateId: 'web-hosting',
      budgetAmount: 50,
      leaseDurationHours: 48,
      requiresManualApproval: false,
    },
  };

  it('validates a valid LeaseRequested event', () => {
    const result = LeaseRequestedEventSchema.safeParse(validEvent);
    expect(result.success).toBe(true);
  });

  it('rejects wrong detail-type', () => {
    const invalidEvent = {
      ...validEvent,
      'detail-type': 'SomeOtherEvent',
    };

    const result = LeaseRequestedEventSchema.safeParse(invalidEvent);
    expect(result.success).toBe(false);
  });

  it('rejects wrong source', () => {
    const invalidEvent = {
      ...validEvent,
      source: 'some-other-source',
    };

    const result = LeaseRequestedEventSchema.safeParse(invalidEvent);
    expect(result.success).toBe(false);
  });
});

describe('LeaseApprovedDetailSchema', () => {
  const validDetail = {
    leaseId: '123e4567-e89b-12d3-a456-426614174000',
    userEmail: 'user@example.gov.uk',
    approvedBy: 'approver-service@system',
    score: 0,
    reason: 'Stub approval - scoring not implemented',
  };

  it('validates a valid LeaseApproved detail', () => {
    const result = LeaseApprovedDetailSchema.safeParse(validDetail);
    expect(result.success).toBe(true);
  });

  it('validates with different approvedBy values', () => {
    const operatorApproval = {
      ...validDetail,
      approvedBy: 'operator@ndx.gov.uk',
      score: 25,
      reason: 'Manually approved after review',
    };

    const result = LeaseApprovedDetailSchema.safeParse(operatorApproval);
    expect(result.success).toBe(true);
  });

  it('rejects invalid leaseId UUID', () => {
    const invalidDetail = {
      ...validDetail,
      leaseId: 'not-a-uuid',
    };

    const result = LeaseApprovedDetailSchema.safeParse(invalidDetail);
    expect(result.success).toBe(false);
  });

  it('rejects invalid email', () => {
    const invalidDetail = {
      ...validDetail,
      userEmail: 'not-an-email',
    };

    const result = LeaseApprovedDetailSchema.safeParse(invalidDetail);
    expect(result.success).toBe(false);
  });
});
