/**
 * Pairing schema. Self-contained so the Edge runtime (Deno) can load it: no package
 * dependencies and only relative `.ts` imports. The unions mirror the product and product
 * signal types; __tests__/pairing.test.ts keeps them in sync.
 */

export const PAIR_ROLES = ['top', 'bottom', 'outerwear', 'one_piece', 'shoes', 'bag', 'hat', 'accessory'] as const;

export type PairRole = (typeof PAIR_ROLES)[number];

export type PairGender = 'women' | 'men' | 'unisex';

export type PairConfidence = 'high' | 'medium' | 'low' | 'unknown';

/** Product signal sources, plus `derived_from_subtype` for dimensions read off the subtype. */
export type PairSignalSource =
  | 'catalog_repair'
  | 'curated_title_override'
  | 'catalog_attribute'
  | 'catalog_variant'
  | 'product_snapshot'
  | 'category_rule'
  | 'price_rule'
  | 'title_inferred'
  | 'derived_from_subtype'
  | 'human_review'
  | 'unknown';

export type PairConflictCode =
  | 'role_category_mismatch'
  | 'role_subtype_mismatch'
  | 'subtype_category_mismatch'
  | 'declared_inferred_mismatch'
  | 'declared_value_rejected'
  | 'suit_blazer_ambiguity';

/** `value: null` is missing evidence, never a default. */
export interface PairSignal<T> {
  value: T | null;
  source: PairSignalSource;
  confidence: PairConfidence;
}

export interface PairConflict {
  field: string;
  code: PairConflictCode;
}

/** One side of a pair, reduced to the signals the pairing rules read. */
export interface PairItem {
  id: string;
  /** Catalog product (default) or the user's own wardrobe item; gender rules skip wardrobe items. */
  origin?: 'catalog' | 'wardrobe';
  role: PairSignal<PairRole>;
  gender: PairSignal<PairGender>;
  subtype: PairSignal<string>;
  conflicts: readonly PairConflict[];
  /** Color slugs; absent or empty means unknown color evidence. */
  colors?: readonly string[];
}

/** `insufficient_evidence` is never a rejection; it only means the pair could not be decided. */
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

/** Faz 4 V3: how many of the listed dimensions must be known and compatible on both items. */
export interface PositiveEvidencePolicy {
  version: number;
  minDimensions: number;
  dimensions: readonly ('formality' | 'season' | 'color')[];
}

export interface CompatibilityPolicy {
  version: number;
  roleRelations: Readonly<Record<PairRole, Readonly<Record<PairRole, RoleRelationRule>>>>;
  /** Existing signal confidences allowed to support a hard rejection. */
  reliableConfidences: readonly PairConfidence[];
  /** Product conflicts that make a role signal unreliable for rejection. */
  roleAffectingConflicts: readonly PairConflictCode[];
  /** Values that are compatible with every gender and gender filter. */
  genderNeutral: PairGender;
  /** Faz 4 S3b decisions; absent in V1 (the S2 gate behavior). */
  s3b?: {
    /** Catalog↔catalog: unknown gender or an unverified neutral gender is uncertain. */
    uncertainGender: true;
    /** Coarse season/formality conflicts from derived_from_subtype evidence decide. */
    coarseSeasonFormality: true;
    /** Versioned human reviewer decisions reject their pair. */
    humanDecisions: true;
  };
  /** Faz 4 V3; absent in V1 and V2. Unknown dimensions are not evidence. */
  positiveEvidence?: PositiveEvidencePolicy;
}

export const COMPATIBILITY_CHECKS = ['identity', 'role', 'gender', 'session_gender', 'season', 'formality', 'human_decision', 'positive_evidence'] as const;

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
  // Faz 4 S3b (policy V2).
  'gender_unisex_unverified',
  'gender_not_applicable',
  'season_compatible',
  'season_unknown',
  'season_conflict',
  'season_conflict_unverified',
  'formality_compatible',
  'formality_unknown',
  'formality_conflict',
  'formality_conflict_unverified',
  'human_decision_none',
  'human_incompatible',
  // Faz 4 V3.
  'positive_evidence_sufficient',
  'positive_evidence_insufficient',
] as const;

export type CompatibilityReasonCode = (typeof COMPATIBILITY_REASON_CODES)[number];

export interface CompatibilityEvidence {
  subject: 'anchor' | 'candidate' | 'session';
  field: 'id' | 'role' | 'gender' | 'season' | 'formality' | 'color' | 'human_decision';
  value: string | null;
  source: PairSignalSource | 'catalog_product' | 'session_filter';
  confidence: PairConfidence;
  /** Whether policy allows this evidence to support a hard rejection. */
  reliable: boolean;
}

export interface CompatibilityCheck {
  check: CompatibilityCheckName;
  status: CompatibilityCheckStatus;
  code: CompatibilityReasonCode;
  evidence: readonly CompatibilityEvidence[];
}

export type PairSeason = 'warm' | 'cold';

export type PairFormality = 'formal' | 'casual';

/** Evidence-only dimensions: reported with their source, never part of the outcome (Faz 4 S2). */
export interface PairEvidencePolicy {
  version: number;
  seasonBySubtype: Readonly<Record<string, PairSeason>>;
  formalityBySubtype: Readonly<Record<string, PairFormality>>;
}

/**
 * `unknown`: no value. `unverified`: a value policy may not use for rejection (for example a
 * heuristic `unisex`). `reliable`: a value that may support a rejection.
 */
export type PairEvidenceStatus = 'unknown' | 'unverified' | 'reliable';

export interface PairDimensionEvidence<T> {
  subject: 'anchor' | 'candidate';
  value: T | null;
  source: PairSignalSource;
  confidence: PairConfidence;
  status: PairEvidenceStatus;
}

export interface PairEvidence {
  gender: readonly PairDimensionEvidence<PairGender>[];
  season: readonly PairDimensionEvidence<PairSeason>[];
  formality: readonly PairDimensionEvidence<PairFormality>[];
}

export const PAIR_EVALUATION_VERSION = 1;

export interface PairEvaluation {
  version: typeof PAIR_EVALUATION_VERSION;
  policyVersion: number;
  evidencePolicyVersion: number;
  anchorId: string;
  candidateId: string;
  outcome: CompatibilityOutcome;
  /** Codes of the checks that produced the outcome; all codes when eligible. */
  reasons: readonly CompatibilityReasonCode[];
  checks: readonly CompatibilityCheck[];
  /** Reported evidence; it never changes the outcome. */
  evidence: PairEvidence;
}
