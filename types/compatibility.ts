import type { OutfitRole, ProductGender } from './product';
import type {
  ProductConflictCode,
  ProductSemanticConflict,
  ProductSignalConfidence,
  ProductSignalSource,
} from './productIntelligence';
import type { StyleAnchorField, StyleContextConflict, StyleContextGap, StyleDimensions } from './styleContext';

export const COMPATIBILITY_RESULT_VERSION = 1;

/** `insufficient_evidence` is never a rejection; it only means the gate could not decide. */
export type CompatibilityOutcome = 'eligible' | 'rejected' | 'insufficient_evidence';

/**
 * `exclusive_slot`: both items occupy the same body slot, so wearing both is structurally impossible.
 * `context_dependent`: valid or not depending on styling (layering); never a rejection.
 */
export type RoleRelation = 'complementary' | 'context_dependent' | 'exclusive_slot';

export type RoleRelationRationale = 'distinct_slots' | 'single_body_slot' | 'layering_varies' | 'subtype_varies';

export interface RoleRelationRule {
  relation: RoleRelation;
  rationale: RoleRelationRationale;
}

export interface CompatibilityPolicy {
  version: number;
  roleRelations: Readonly<Record<OutfitRole, Readonly<Record<OutfitRole, RoleRelationRule>>>>;
  /** Existing signal confidences allowed to support a hard rejection. */
  reliableConfidences: readonly ProductSignalConfidence[];
  /** Product conflicts that make a role signal unreliable for rejection. */
  roleAffectingConflicts: readonly ProductConflictCode[];
  /** Values that are compatible with every gender and gender filter. */
  genderNeutral: ProductGender;
}

export const COMPATIBILITY_CHECKS = ['identity', 'role', 'gender', 'session_gender'] as const;

export type CompatibilityCheckName = (typeof COMPATIBILITY_CHECKS)[number];

export type CompatibilityCheckStatus = 'pass' | 'reject' | 'insufficient';

export const COMPATIBILITY_REASON_CODES = [
  'distinct_products',
  'candidate_is_anchor',
  'role_complementary',
  'role_context_dependent',
  'role_exclusive_slot',
  'role_exclusive_slot_unverified',
  'role_unknown',
  'gender_match',
  'gender_unisex_compatible',
  'gender_unknown',
  'gender_conflict',
  'gender_conflict_unverified',
  'session_gender_no_filter',
  'session_gender_filter_unrecognized',
  'session_gender_match',
  'session_gender_unisex_compatible',
  'session_gender_unknown',
  'session_gender_mismatch',
  'session_gender_mismatch_unverified',
] as const;

export type CompatibilityReasonCode = (typeof COMPATIBILITY_REASON_CODES)[number];

export interface CompatibilityEvidence {
  subject: 'anchor' | 'candidate' | 'session';
  field: 'id' | 'role' | 'gender';
  value: string | null;
  source: ProductSignalSource | 'catalog_product' | 'session_filter';
  confidence: ProductSignalConfidence;
  /** Whether policy allows this evidence to support a hard rejection. */
  reliable: boolean;
}

export interface CompatibilityCheck {
  check: CompatibilityCheckName;
  status: CompatibilityCheckStatus;
  code: CompatibilityReasonCode;
  evidence: readonly CompatibilityEvidence[];
}

export interface CompatibilityResult {
  version: typeof COMPATIBILITY_RESULT_VERSION;
  policyVersion: number;
  anchorId: string;
  candidateId: string;
  outcome: CompatibilityOutcome;
  /** Codes of the checks that produced the outcome; all codes when eligible. */
  reasons: readonly CompatibilityReasonCode[];
  checks: readonly CompatibilityCheck[];
  /** Missing attributes; reported for downstream stages, never a rejection reason here. */
  unknowns: { anchor: readonly StyleAnchorField[]; candidate: readonly StyleAnchorField[] };
  /** Non-blocking candidate evidence; declared and behavioral relations stay separate. */
  preferences: StyleDimensions;
  candidateConflicts: readonly ProductSemanticConflict[];
  contextConflicts: readonly StyleContextConflict[];
  contextGaps: readonly StyleContextGap[];
}
