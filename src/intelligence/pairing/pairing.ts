import { HUMAN_DECISIONS_V1, isHumanIncompatible, type HumanDecisionSet } from './humanDecisions.ts';
import { PAIRING_EVIDENCE_POLICY_V1, PAIRING_POLICY_V1 } from './pairingPolicy.ts';
import {
  PAIR_EVALUATION_VERSION,
  type CompatibilityCheck,
  type CompatibilityEvidence,
  type CompatibilityOutcome,
  type CompatibilityPolicy,
  type PairConflict,
  type PairDimensionEvidence,
  type PairEvaluation,
  type PairEvidencePolicy,
  type PairGender,
  type PairItem,
  type PairFormality,
  type PairRole,
  type PairSeason,
  type PairSignal,
} from './pairingTypes.ts';

export interface PairInput {
  anchor: PairItem;
  candidate: PairItem;
  /** Session gender filter; null when the session sets none. */
  sessionGender: string | null;
  policy?: CompatibilityPolicy;
  evidencePolicy?: PairEvidencePolicy;
  humanDecisions?: HumanDecisionSet;
}

/** Narrows any product-shaped signal set to a PairItem; extra fields are ignored. */
export const pairItemFromSignals = (
  id: string,
  signals: { role: PairSignal<PairRole>; gender: PairSignal<PairGender>; subtype: PairSignal<string> },
  conflicts: readonly PairConflict[],
  origin: 'catalog' | 'wardrobe' = 'catalog',
): PairItem => ({
  id,
  origin,
  role: { value: signals.role.value, source: signals.role.source, confidence: signals.role.confidence },
  gender: { value: signals.gender.value, source: signals.gender.source, confidence: signals.gender.confidence },
  subtype: { value: signals.subtype.value, source: signals.subtype.source, confidence: signals.subtype.confidence },
  conflicts: conflicts.map((conflict) => ({ field: conflict.field, code: conflict.code })),
});

const GENDER_FILTER_VALUES: readonly PairGender[] = ['women', 'men', 'unisex'];

const isGenderFilter = (value: string): value is PairGender =>
  (GENDER_FILTER_VALUES as readonly string[]).includes(value);

const isReliable = (signal: PairSignal<string>, conflicted: boolean, policy: CompatibilityPolicy): boolean =>
  signal.value !== null && !conflicted && policy.reliableConfidences.includes(signal.confidence);

const signalEvidence = (
  subject: 'anchor' | 'candidate',
  field: 'role' | 'gender',
  signal: PairSignal<string>,
  conflicted: boolean,
  policy: CompatibilityPolicy,
): CompatibilityEvidence => ({
  subject,
  field,
  value: signal.value,
  source: signal.source,
  confidence: signal.confidence,
  reliable: isReliable(signal, conflicted, policy),
});

const affectsRole = (conflicts: readonly PairConflict[], policy: CompatibilityPolicy): boolean =>
  conflicts.some((conflict) => conflict.field === 'role' || policy.roleAffectingConflicts.includes(conflict.code));

const affectsGender = (conflicts: readonly PairConflict[]): boolean =>
  conflicts.some((conflict) => conflict.field === 'gender');

const identityCheck = (anchor: PairItem, candidate: PairItem): CompatibilityCheck => {
  const evidence: CompatibilityEvidence[] = [
    { subject: 'anchor', field: 'id', value: anchor.id, source: 'catalog_product', confidence: 'high', reliable: true },
    { subject: 'candidate', field: 'id', value: candidate.id, source: 'catalog_product', confidence: 'high', reliable: true },
  ];
  return candidate.id === anchor.id
    ? { check: 'identity', status: 'reject', code: 'candidate_is_anchor', evidence }
    : { check: 'identity', status: 'pass', code: 'distinct_products', evidence };
};

const roleCheck = (anchor: PairItem, candidate: PairItem, policy: CompatibilityPolicy): CompatibilityCheck => {
  const evidence = [
    signalEvidence('anchor', 'role', anchor.role, affectsRole(anchor.conflicts, policy), policy),
    signalEvidence('candidate', 'role', candidate.role, affectsRole(candidate.conflicts, policy), policy),
  ];
  if (anchor.role.value === null || candidate.role.value === null) {
    return { check: 'role', status: 'insufficient', code: 'role_unknown', evidence };
  }
  const { relation } = policy.roleRelations[anchor.role.value][candidate.role.value];
  if (relation === 'complementary') return { check: 'role', status: 'pass', code: 'role_complementary', evidence };
  if (relation === 'context_dependent') return { check: 'role', status: 'pass', code: 'role_context_dependent', evidence };
  return evidence.every((entry) => entry.reliable)
    ? { check: 'role', status: 'reject', code: 'role_exclusive_slot', evidence }
    : { check: 'role', status: 'insufficient', code: 'role_exclusive_slot_unverified', evidence };
};

const genderCheck = (anchor: PairItem, candidate: PairItem, policy: CompatibilityPolicy): CompatibilityCheck => {
  const evidence = [
    signalEvidence('anchor', 'gender', anchor.gender, affectsGender(anchor.conflicts), policy),
    signalEvidence('candidate', 'gender', candidate.gender, affectsGender(candidate.conflicts), policy),
  ];
  const a = anchor.gender.value;
  const c = candidate.gender.value;
  if (policy.s3b?.uncertainGender) {
    // S3b: the rule compares two catalog products; a wardrobe item's gender is the user's own.
    if (anchor.origin === 'wardrobe' || candidate.origin === 'wardrobe') {
      return { check: 'gender', status: 'pass', code: 'gender_not_applicable', evidence };
    }
    if (a === null || c === null) return { check: 'gender', status: 'insufficient', code: 'gender_unknown', evidence };
    const unverifiedNeutral = evidence.some((entry) => entry.value === policy.genderNeutral && !entry.reliable);
    if (unverifiedNeutral) return { check: 'gender', status: 'insufficient', code: 'gender_unisex_unverified', evidence };
  }
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
  sessionGender: string | null,
  candidate: PairItem,
  policy: CompatibilityPolicy,
): CompatibilityCheck => {
  if (sessionGender === null) return { check: 'session_gender', status: 'pass', code: 'session_gender_no_filter', evidence: [] };
  const evidence: CompatibilityEvidence[] = [
    { subject: 'session', field: 'gender', value: sessionGender, source: 'session_filter', confidence: 'high', reliable: true },
    signalEvidence('candidate', 'gender', candidate.gender, affectsGender(candidate.conflicts), policy),
  ];
  if (!isGenderFilter(sessionGender)) {
    return { check: 'session_gender', status: 'pass', code: 'session_gender_filter_unrecognized', evidence };
  }
  const gender = candidate.gender.value;
  if (gender === null) return { check: 'session_gender', status: 'pass', code: 'session_gender_unknown', evidence };
  if (gender === sessionGender) return { check: 'session_gender', status: 'pass', code: 'session_gender_match', evidence };
  if (gender === policy.genderNeutral) {
    return { check: 'session_gender', status: 'pass', code: 'session_gender_unisex_compatible', evidence };
  }
  return evidence.every((entry) => entry.reliable)
    ? { check: 'session_gender', status: 'reject', code: 'session_gender_mismatch', evidence }
    : { check: 'session_gender', status: 'insufficient', code: 'session_gender_mismatch_unverified', evidence };
};

const coarseCheck = <T extends string>(
  check: 'season' | 'formality',
  table: Readonly<Record<string, T>>,
  anchor: PairItem,
  candidate: PairItem,
  policy: CompatibilityPolicy,
): CompatibilityCheck => {
  const signals = [fromSubtype(anchor, table), fromSubtype(candidate, table)];
  const evidence: CompatibilityEvidence[] = signals.map((signal, index) => ({
    subject: index === 0 ? 'anchor' : 'candidate',
    field: check,
    value: signal.value,
    source: signal.source,
    confidence: signal.confidence,
    reliable: isReliable(signal, affectsSubtype((index === 0 ? anchor : candidate).conflicts), policy),
  }));
  const [a, c] = signals.map((signal) => signal.value);
  if (a === null || c === null) return { check, status: 'pass', code: `${check}_unknown`, evidence };
  // Only the two coarse ends exist (warm/cold, formal/casual), so any difference is a coarse conflict.
  if (a === c) return { check, status: 'pass', code: `${check}_compatible`, evidence };
  return evidence.every((entry) => entry.reliable)
    ? { check, status: 'reject', code: `${check}_conflict`, evidence }
    : { check, status: 'insufficient', code: `${check}_conflict_unverified`, evidence };
};

const humanDecisionCheck = (anchor: PairItem, candidate: PairItem, decisions: HumanDecisionSet): CompatibilityCheck => {
  const blocked = isHumanIncompatible(anchor.id, candidate.id, decisions);
  const evidence: CompatibilityEvidence[] = [{
    subject: 'candidate', field: 'human_decision', value: blocked ? `v${decisions.version}` : null,
    source: 'human_review', confidence: 'high', reliable: true,
  }];
  return blocked
    ? { check: 'human_decision', status: 'reject', code: 'human_incompatible', evidence }
    : { check: 'human_decision', status: 'pass', code: 'human_decision_none', evidence };
};

const NEUTRAL_COLORS: readonly string[] = ['siyah', 'beyaz', 'gri', 'bej', 'krem', 'navy'];
const colorSlugs = (item: PairItem): string[] =>
  (item.colors ?? []).map((slug) => slug.trim().toLocaleLowerCase('tr-TR')).filter((slug) => slug !== '');

/**
 * V3: counts the dimensions that are known on both items and compatible. Compatible color means a
 * shared color or a neutral on either side (the catalog scorer's rule); two different chromatic
 * colors are no evidence, not a conflict. Formality and season come from reliable subtypes only.
 */
const positiveEvidenceCheck = (
  anchor: PairItem,
  candidate: PairItem,
  policy: CompatibilityPolicy,
  evidencePolicy: PairEvidencePolicy,
  rule: NonNullable<CompatibilityPolicy['positiveEvidence']>,
): CompatibilityCheck => {
  const evidence: CompatibilityEvidence[] = [];
  const add = (field: 'formality' | 'season' | 'color', compatible: boolean, value: string | null) => {
    if (rule.dimensions.includes(field)) {
      evidence.push({ subject: 'candidate', field, value, source: field === 'color' ? 'product_snapshot' : 'derived_from_subtype',
        confidence: compatible ? 'high' : 'unknown', reliable: compatible });
    }
  };
  const coarse = <T extends string>(table: Readonly<Record<string, T>>) => {
    const left = fromSubtype(anchor, table), right = fromSubtype(candidate, table);
    const usable = left.value !== null && right.value !== null
      && isReliable(anchor.subtype, affectsSubtype(anchor.conflicts), policy)
      && isReliable(candidate.subtype, affectsSubtype(candidate.conflicts), policy);
    return { compatible: usable && left.value === right.value, value: usable ? left.value : null };
  };
  const formality = coarse<PairFormality>(evidencePolicy.formalityBySubtype);
  const season = coarse<PairSeason>(evidencePolicy.seasonBySubtype);
  const left = colorSlugs(anchor), right = colorSlugs(candidate);
  const color = left.length > 0 && right.length > 0
    && (right.some((slug) => left.includes(slug)) || [...left, ...right].some((slug) => NEUTRAL_COLORS.includes(slug)));
  add('formality', formality.compatible, formality.value);
  add('season', season.compatible, season.value);
  add('color', color, color ? right[0] : null);
  const count = evidence.filter((entry) => entry.reliable).length;
  return count >= rule.minDimensions
    ? { check: 'positive_evidence', status: 'pass', code: 'positive_evidence_sufficient', evidence }
    : { check: 'positive_evidence', status: 'insufficient', code: 'positive_evidence_insufficient', evidence };
};

const outcomeOf = (checks: readonly CompatibilityCheck[]): CompatibilityOutcome => {
  if (checks.some((check) => check.status === 'reject')) return 'rejected';
  if (checks.some((check) => check.status === 'insufficient')) return 'insufficient_evidence';
  return 'eligible';
};

const dimensionEvidence = <T extends string>(
  subject: 'anchor' | 'candidate',
  signal: PairSignal<T>,
  conflicted: boolean,
  policy: CompatibilityPolicy,
): PairDimensionEvidence<T> => ({
  subject,
  value: signal.value,
  source: signal.source,
  confidence: signal.confidence,
  status: signal.value === null ? 'unknown' : isReliable(signal, conflicted, policy) ? 'reliable' : 'unverified',
});

const UNKNOWN_SIGNAL: PairSignal<never> = { value: null, source: 'unknown', confidence: 'unknown' };

/** Reads a dimension off the subtype slug; the subtype's confidence carries over. */
const fromSubtype = <T extends string>(item: PairItem, table: Readonly<Record<string, T>>): PairSignal<T> => {
  const slug = item.subtype.value;
  const value = slug !== null && Object.prototype.hasOwnProperty.call(table, slug) ? table[slug] : null;
  return value === null ? UNKNOWN_SIGNAL : { value, source: 'derived_from_subtype', confidence: item.subtype.confidence };
};

const affectsSubtype = (conflicts: readonly PairConflict[]): boolean =>
  conflicts.some((conflict) => conflict.field === 'subtype');

/**
 * Pure pairing decision between an anchor and one candidate. V1 (S2) decides on identity, role,
 * gender and the session gender filter. V2 (S3b) also makes unknown/unverified-neutral catalog
 * gender uncertain, decides coarse season/formality conflicts and applies human reviewer
 * decisions. Unreliable evidence can only make a pair insufficient (uncertain), never rejected.
 */
export const evaluatePair = ({
  anchor,
  candidate,
  sessionGender,
  policy = PAIRING_POLICY_V1,
  evidencePolicy = PAIRING_EVIDENCE_POLICY_V1,
  humanDecisions = HUMAN_DECISIONS_V1,
}: PairInput): PairEvaluation => {
  const checks = [
    identityCheck(anchor, candidate),
    roleCheck(anchor, candidate, policy),
    genderCheck(anchor, candidate, policy),
    sessionGenderCheck(sessionGender, candidate, policy),
  ];
  if (policy.s3b?.coarseSeasonFormality) {
    checks.push(
      coarseCheck<PairSeason>('season', evidencePolicy.seasonBySubtype, anchor, candidate, policy),
      coarseCheck<PairFormality>('formality', evidencePolicy.formalityBySubtype, anchor, candidate, policy),
    );
  }
  if (policy.s3b?.humanDecisions) checks.push(humanDecisionCheck(anchor, candidate, humanDecisions));
  if (policy.positiveEvidence) {
    checks.push(positiveEvidenceCheck(anchor, candidate, policy, evidencePolicy, policy.positiveEvidence));
  }
  const outcome = outcomeOf(checks);
  const deciding = outcome === 'rejected' ? 'reject' : outcome === 'insufficient_evidence' ? 'insufficient' : 'pass';
  const sides = [['anchor', anchor], ['candidate', candidate]] as const;

  return {
    version: PAIR_EVALUATION_VERSION,
    policyVersion: policy.version,
    evidencePolicyVersion: evidencePolicy.version,
    anchorId: anchor.id,
    candidateId: candidate.id,
    outcome,
    reasons: checks.filter((check) => check.status === deciding).map((check) => check.code),
    checks,
    evidence: {
      gender: sides.map(([subject, item]) => dimensionEvidence(subject, item.gender, affectsGender(item.conflicts), policy)),
      season: sides.map(([subject, item]) =>
        dimensionEvidence(subject, fromSubtype(item, evidencePolicy.seasonBySubtype), affectsSubtype(item.conflicts), policy)),
      formality: sides.map(([subject, item]) =>
        dimensionEvidence(subject, fromSubtype(item, evidencePolicy.formalityBySubtype), affectsSubtype(item.conflicts), policy)),
    },
  };
};
