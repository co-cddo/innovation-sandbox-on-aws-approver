/**
 * Core type definitions for the Innovation Sandbox Approver
 * Additional types will be added as features are implemented
 */

export interface LeaseRequest {
  leaseId: string;
  userId: string;
  userEmail: string;
  organizationId?: string;
  requestedAt: string;
}

export interface ApprovalDecision {
  leaseId: string;
  approved: boolean;
  score: number;
  reasons: string[];
  decidedAt: string;
}
