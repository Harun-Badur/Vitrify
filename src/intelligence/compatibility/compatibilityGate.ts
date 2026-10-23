import {
  COMPATIBILITY_RESULT_VERSION,
  type CompatibilityCheck,
  type CompatibilityEvidence,
  type CompatibilityOutcome,
  type CompatibilityPolicy,
  type CompatibilityResult,
} from '../../../types/compatibility';
import type { Product, ProductGender } from '../../../types/product';
import type {
  ProductIntelligence,
  ProductSemanticConflict,
  ProductSignal,
} from '../../../types/productIntelligence';
import type { StyleContext } from '../../../types/styleContext';
import { buildStyleDimensions, styleAttributesOf, unknownStyleFields } from '../style/styleContext';
import { COMPATIBILITY_POLICY_V1 } from './compatibilityPolicy';

export interface CompatibilityInput {
  context: StyleContext;
  candidate: Product;
  /** Must describe `candidate`; build it with buildProductIntelligence. */
  candidateIntelligence: ProductIntelligence;
  policy?: CompatibilityPolicy;
}

const GENDER_FILTER_VALUES: readonly ProductGender[] = ['women', 'men', 'unisex'];

const isGenderFilter = (value: string): value is ProductGender =>
  (GENDER_FILTER_VALUES as readonly string[]).includes(value);

const signalEvidence = (
  subject: 'anchor' | 'candidate',
  field: 'role' | 'gender',
  signal: ProductSignal<string>,
  conflicted: boolean,
  policy: CompatibilityPolicy,
): CompatibilityEvidence => ({
  subject,
  field,
  value: signal.value,
  source: signal.source,
  confidence: signal.confidence,
  reliable: signal.value !== null && !conflicted && policy.reliableConfidences.includes(signal.confidence),
});

const affectsRole = (conflicts: readonly ProductSemanticConflict[], policy: CompatibilityPolicy): boolean =>
  conflicts.some((conflict) => conflict.field === 'role' || policy.roleAffectingConflicts.includes(conflict.code));

const affectsGender = (conflicts: readonly ProductSemanticConflict[]): boolean =>
  conflicts.some((conflict) => conflict.field === 'gender');

const identityCheck = (context: StyleContext, candidate: Product): CompatibilityCheck => {
  const evidence: CompatibilityEvidence[] = [
    { subject: 'anchor', field: 'id', value: context.anchor.productId, source: 'catalog_product', confidence: 'high', reliable: true },
    { subject: 'candidate', field: 'id', value: candidate.id, source: 'catalog_product', confidence: 'high', reliable: true },
  ];
  return candidate.id === context.anchor.productId
    ? { check: 'identity', status: 'reject', code: 'candidate_is_anchor', evidence }
    : { check: 'identity', status: 'pass', code: 'distinct_products', evidence };
};

const roleCheck = (
  context: StyleContext,
  candidate: ProductIntelligence,
  anchorConflicts: readonly ProductSemanticConflict[],
  policy: CompatibilityPolicy,
): CompatibilityCheck => {
  const anchorRole = context.anchor.attributes.role;
  const evidence = [
    signalEvidence('anchor', 'role', anchorRole, affectsRole(anchorConflicts, policy), policy),
    signalEvidence('candidate', 'role', candidate.role, affectsRole(candidate.conflicts, policy), policy),
  ];
  if (anchorRole.value === null || candidate.role.value === null) {
    return { check: 'role', status: 'insufficient', code: 'role_unknown', evidence };
  }
  const { relation } = policy.roleRelations[anchorRole.value][candidate.role.value];
  if (relation === 'complementary') return { check: 'role', status: 'pass', code: 'role_complementary', evidence };
  if (relation === 'context_dependent') return { check: 'role', status: 'pass', code: 'role_context_dependent', evidence };
  return evidence.every((entry) => entry.reliable)
    ? { check: 'role', status: 'reject', code: 'role_exclusive_slot', evidence }
    : { check: 'role', status: 'insufficient', code: 'role_exclusive_slot_unverified', evidence };
};

const genderCheck = (
  context: StyleContext,
  candidate: ProductIntelligence,
  anchorConflicts: readonly ProductSemanticConflict[],
  policy: CompatibilityPolicy,
): CompatibilityCheck => {
  const anchorGender = context.anchor.attributes.gender;
  const evidence = [
    signalEvidence('anchor', 'gender', anchorGender, affectsGender(anchorConflicts), policy),
    signalEvidence('candidate', 'gender', candidate.gender, affectsGender(candidate.conflicts), policy),
  ];
  const a = anchorGender.value;
  const c = candidate.gender.value;
  if (a === null || c === null) return { check: 'gender', status: 'pass', code: 'gender_unknown', evidence };
  if (a === c) return { check: 'gender', status: 'pass', code: 'gender_match', evidence };
  if (a === policy.genderNeutral || c === policy.genderNeutral) {
    return { check: 'gender', status: 'pass', code: 'gender_unisex_compatible', evidence };
  }
  return evidence.every((entry) => entry.reliable)
    ? { check: 'gender', status: 'reject', code: 'gender_conflict', evidence }
    : { check: 'gender', status: 'insufficient', code: 'gender_conflict_unverified', evidence };
};

/** A unisex product satisfies women and men filters, mirroring the existing product filter. */
const sessionGenderCheck = (
  context: StyleContext,
  candidate: ProductIntelligence,
  policy: CompatibilityPolicy,
): CompatibilityCheck => {
  const filter = context.session.constraints.gender;
  if (filter === null) return { check: 'session_gender', status: 'pass', code: 'session_gender_no_filter', evidence: [] };
  const evidence: CompatibilityEvidence[] = [
    { subject: 'session', field: 'gender', value: filter, source: 'session_filter', confidence: 'high', reliable: true },
    signalEvidence('candidate', 'gender', candidate.gender, affectsGender(candidate.conflicts), policy),
  ];
  if (!isGenderFilter(filter)) {
    return { check: 'session_gender', status: 'pass', code: 'session_gender_filter_unrecognized', evidence };
  }
  const gender = candidate.gender.value;
  if (gender === null) return { check: 'session_gender', status: 'pass', code: 'session_gender_unknown', evidence };
  if (gender === filter) return { check: 'session_gender', status: 'pass', code: 'session_gender_match', evidence };
  if (gender === policy.genderNeutral) {
    return { check: 'session_gender', status: 'pass', code: 'session_gender_unisex_compatible', evidence };
  }
  return evidence.every((entry) => entry.reliable)
    ? { check: 'session_gender', status: 'reject', code: 'session_gender_mismatch', evidence }
    : { check: 'session_gender', status: 'insufficient', code: 'session_gender_mismatch_unverified', evidence };
};

const outcomeOf = (checks: readonly CompatibilityCheck[]): CompatibilityOutcome => {
  if (checks.some((check) => check.status === 'reject')) return 'rejected';
  if (checks.some((check) => check.status === 'insufficient')) return 'insufficient_evidence';
  return 'eligible';
};

/**
 * Pure structural gate between a StyleContext anchor and one candidate. It produces no score
 * or order; preferences and unknown attributes are reported but never decide the outcome.
 */
export const evaluateCompatibility = ({
  context,
  candidate,
  candidateIntelligence,
  policy = COMPATIBILITY_POLICY_V1,
}: CompatibilityInput): CompatibilityResult => {
  if (candidateIntelligence.productId !== candidate.id) {
    throw new Error('evaluateCompatibility: candidateIntelligence does not describe the candidate product');
  }
  const anchorConflicts = context.conflicts.flatMap((entry) => (entry.source === 'anchor' ? [entry.conflict] : []));
  const checks = [
    identityCheck(context, candidate),
    roleCheck(context, candidateIntelligence, anchorConflicts, policy),
    genderCheck(context, candidateIntelligence, anchorConflicts, policy),
    sessionGenderCheck(context, candidateIntelligence, policy),
  ];
  const outcome = outcomeOf(checks);
  const deciding = outcome === 'rejected' ? 'reject' : outcome === 'insufficient_evidence' ? 'insufficient' : 'pass';
  const candidateAttributes = styleAttributesOf(candidateIntelligence);

  return {
    version: COMPATIBILITY_RESULT_VERSION,
    policyVersion: policy.version,
    anchorId: context.anchor.productId,
    candidateId: candidate.id,
    outcome,
    reasons: checks.filter((check) => check.status === deciding).map((check) => check.code),
    checks,
    unknowns: {
      anchor: unknownStyleFields(context.anchor.attributes),
      candidate: unknownStyleFields(candidateAttributes),
    },
    preferences: buildStyleDimensions(candidate, candidateAttributes, {
      declared: context.declared,
      behavior: context.behavior,
    }),
    candidateConflicts: candidateIntelligence.conflicts,
    contextConflicts: context.conflicts,
    contextGaps: context.gaps,
  };
};
