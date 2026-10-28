import type {
  CompatibilityPolicy,
  PairEvidencePolicy,
  PairRole,
  RoleRelationRule,
} from './pairingTypes.ts';

export const PAIRING_POLICY_VERSION = 1;

/** Pairs not listed here occupy distinct body slots. Pairs are symmetric. */
const NON_COMPLEMENTARY_ROLE_PAIRS: readonly (readonly [PairRole, PairRole, RoleRelationRule])[] = [
  // Feet and head each hold one item at a time.
  ['shoes', 'shoes', { relation: 'exclusive_slot', rationale: 'single_body_slot' }],
  ['hat', 'hat', { relation: 'exclusive_slot', rationale: 'single_body_slot' }],
  // Layered tops, skirts over trousers and dresses over tops or trousers are styling choices.
  ['top', 'top', { relation: 'context_dependent', rationale: 'layering_varies' }],
  ['outerwear', 'outerwear', { relation: 'context_dependent', rationale: 'layering_varies' }],
  ['bottom', 'bottom', { relation: 'context_dependent', rationale: 'layering_varies' }],
  ['one_piece', 'one_piece', { relation: 'context_dependent', rationale: 'layering_varies' }],
  ['one_piece', 'top', { relation: 'context_dependent', rationale: 'layering_varies' }],
  ['one_piece', 'bottom', { relation: 'context_dependent', rationale: 'layering_varies' }],
  // These roles cover unrelated subtypes (belt, scarf, jewelry; tote, clutch), which are not modeled.
  ['bag', 'bag', { relation: 'context_dependent', rationale: 'subtype_varies' }],
  ['accessory', 'accessory', { relation: 'context_dependent', rationale: 'subtype_varies' }],
];

const COMPLEMENTARY: RoleRelationRule = { relation: 'complementary', rationale: 'distinct_slots' };

const buildRoleRelations = (): CompatibilityPolicy['roleRelations'] => {
  const lookup = new Map<string, RoleRelationRule>();
  for (const [a, b, rule] of NON_COMPLEMENTARY_ROLE_PAIRS) {
    lookup.set(`${a}|${b}`, rule);
    lookup.set(`${b}|${a}`, rule);
  }
  const row = (anchor: PairRole): Readonly<Record<PairRole, RoleRelationRule>> => Object.freeze({
    top: lookup.get(`${anchor}|top`) ?? COMPLEMENTARY,
    bottom: lookup.get(`${anchor}|bottom`) ?? COMPLEMENTARY,
    outerwear: lookup.get(`${anchor}|outerwear`) ?? COMPLEMENTARY,
    one_piece: lookup.get(`${anchor}|one_piece`) ?? COMPLEMENTARY,
    shoes: lookup.get(`${anchor}|shoes`) ?? COMPLEMENTARY,
    bag: lookup.get(`${anchor}|bag`) ?? COMPLEMENTARY,
    hat: lookup.get(`${anchor}|hat`) ?? COMPLEMENTARY,
    accessory: lookup.get(`${anchor}|accessory`) ?? COMPLEMENTARY,
  });
  return Object.freeze({
    top: row('top'),
    bottom: row('bottom'),
    outerwear: row('outerwear'),
    one_piece: row('one_piece'),
    shoes: row('shoes'),
    bag: row('bag'),
    hat: row('hat'),
    accessory: row('accessory'),
  });
};

export const PAIRING_POLICY_V1: CompatibilityPolicy = Object.freeze({
  version: PAIRING_POLICY_VERSION,
  roleRelations: buildRoleRelations(),
  // `low` is title inference and `unknown` covers heuristic-seeded catalog rows; neither may reject.
  reliableConfidences: Object.freeze(['high', 'medium'] as const),
  roleAffectingConflicts: Object.freeze(['subtype_category_mismatch', 'suit_blazer_ambiguity'] as const),
  genderNeutral: 'unisex',
});

/**
 * Coarse season and formality read off subtype slugs (lib/productAttributes SUBCATEGORY_RULES).
 * Only unambiguous slugs are listed: `ceket` spans coats and light jackets, `gomlek` spans
 * dress and casual shirts, so they stay unknown. Rule v4 splits `ceket` into mont / kaban /
 * trenckot; trenckot has no season (it spans cool seasons) and mont no formality. Evidence only in S2; no decision reads it.
 */
export const PAIRING_EVIDENCE_POLICY_V1: PairEvidencePolicy = Object.freeze({
  version: 1,
  seasonBySubtype: Object.freeze({ sort: 'warm', kazak: 'cold', mont: 'cold', kaban: 'cold' } as const),
  formalityBySubtype: Object.freeze({
    // `blazer` also covers suits (takım elbise).
    blazer: 'formal',
    kaban: 'formal',
    sort: 'casual',
    kargo: 'casual',
    esofman: 'casual',
    hoodie: 'casual',
    sweatshirt: 'casual',
  } as const),
});
