import type {
  CompatibilityCheck,
  CompatibilityOutcome,
  CompatibilityReasonCode,
} from '../src/intelligence/pairing/pairingTypes.ts';
import type { ProductSemanticConflict } from './productIntelligence';
import type { StyleAnchorField, StyleContextConflict, StyleContextGap, StyleDimensions } from './styleContext';

// The decision schema is owned by the pairing module; these names stay for existing imports.
export {
  COMPATIBILITY_CHECKS,
  COMPATIBILITY_REASON_CODES,
} from '../src/intelligence/pairing/pairingTypes.ts';
export type {
  CompatibilityCheck,
  CompatibilityCheckName,
  CompatibilityCheckStatus,
  CompatibilityEvidence,
  CompatibilityOutcome,
  CompatibilityPolicy,
  CompatibilityReasonCode,
  RoleRelation,
  RoleRelationRationale,
  RoleRelationRule,
} from '../src/intelligence/pairing/pairingTypes.ts';

export const COMPATIBILITY_RESULT_VERSION = 1;

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
