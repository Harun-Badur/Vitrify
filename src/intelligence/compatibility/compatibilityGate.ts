import {
  COMPATIBILITY_RESULT_VERSION,
  type CompatibilityPolicy,
  type CompatibilityResult,
} from '../../../types/compatibility';
import type { Product } from '../../../types/product';
import type { ProductIntelligence } from '../../../types/productIntelligence';
import type { StyleContext } from '../../../types/styleContext';
import { evaluatePair, pairItemFromSignals } from '../pairing/pairing.ts';
import { buildStyleDimensions, styleAttributesOf, unknownStyleFields } from '../style/styleContext';
import { COMPATIBILITY_POLICY_V1 } from './compatibilityPolicy';

export interface CompatibilityInput {
  context: StyleContext;
  candidate: Product;
  /** Must describe `candidate`; build it with buildProductIntelligence. */
  candidateIntelligence: ProductIntelligence;
  policy?: CompatibilityPolicy;
}

/**
 * StyleContext adapter over the pairing module, which owns every decision rule. It adds the
 * style-context fields (unknowns, preferences, conflicts, gaps); it produces no score or order.
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
  const pair = evaluatePair({
    anchor: pairItemFromSignals(context.anchor.productId, context.anchor.attributes, anchorConflicts),
    candidate: pairItemFromSignals(candidate.id, candidateIntelligence, candidateIntelligence.conflicts),
    sessionGender: context.session.constraints.gender,
    policy,
  });
  const candidateAttributes = styleAttributesOf(candidateIntelligence);

  return {
    version: COMPATIBILITY_RESULT_VERSION,
    policyVersion: pair.policyVersion,
    anchorId: pair.anchorId,
    candidateId: pair.candidateId,
    outcome: pair.outcome,
    reasons: pair.reasons,
    checks: pair.checks,
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
