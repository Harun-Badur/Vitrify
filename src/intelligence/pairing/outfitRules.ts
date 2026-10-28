import type { PairRole } from './pairingTypes.ts';

/**
 * Structural outfit rules used by candidate generation, ranking and complement selection
 * (Faz 4 S3). Moved verbatim from outfits/outfitCandidate.ts; behavior is frozen against
 * __tests__/fixtures/legacyOutfitRules.ts. Edge-compatible: no package or app imports.
 */

export type PairCategory = 'upper_body' | 'lower_body' | 'dresses' | 'shoes' | 'bags' | 'hats' | 'accessories';

/** The catalog product fields these rules read; app Products satisfy it structurally. */
export interface PairCatalogProduct {
  title: string;
  category: PairCategory;
  subcategory?: string | null;
  gender?: string | null;
}

export type PairOutfitItem =
  | { sourceType: 'wardrobe'; sourceId: string; role: PairRole }
  | { sourceType: 'catalog'; sourceId: string; role: PairRole; product: PairCatalogProduct };

/** Upper-body subtypes and the role they fill; shared with wardrobe role resolution. */
export const UPPER_SUBCATEGORY_ROLE: Readonly<Record<string, 'top' | 'outerwear'>> = {
  top: 'top',
  tisort: 'top',
  'tişört': 'top',
  't-shirt': 'top',
  gomlek: 'top',
  'gömlek': 'top',
  bluz: 'top',
  body: 'top',
  kazak: 'top',
  hoodie: 'top',
  sweatshirt: 'top',
  polo: 'top',
  atlet: 'top',
  outerwear: 'outerwear',
  ceket: 'outerwear',
  blazer: 'outerwear',
  mont: 'outerwear',
  kaban: 'outerwear',
  trenckot: 'outerwear',
  palto: 'outerwear',
  'hırka': 'outerwear',
  hirka: 'outerwear',
};

/** Reject only explicit gender conflicts; missing gender remains unknown. */
export const hasGenderConflict = (items: readonly PairOutfitItem[]): boolean => {
  let hasWomen = false;
  let hasMen = false;
  for (const item of items) {
    if (item.sourceType !== 'catalog') continue;
    hasWomen ||= item.product.gender === 'women';
    hasMen ||= item.product.gender === 'men';
  }
  return hasWomen && hasMen;
};

/** Unknown age/type stays unknown; title evidence must explicitly identify it. */
const hardEvidence = new WeakMap<PairCatalogProduct, { title: string; subcategory: PairCatalogProduct['subcategory'];
  age: 'child' | 'adult' | null; typeRole: PairRole | null; subtypeRole: PairRole | null }>();
const readHardEvidence = (product: PairCatalogProduct) => {
  const cached = hardEvidence.get(product);
  if (cached?.title === product.title && cached.subcategory === product.subcategory) return cached;
  const title = product.title.toLocaleLowerCase('tr-TR');
  const child = /(?:^|[^\p{L}])(?:çocuk|cocuk|bebek|kids|baby|toddler)(?:$|[^\p{L}])/u.test(title);
  const adult = /(?:^|[^\p{L}])(?:kadın|kadin|erkek|yetişkin|yetiskin|women|men|adult)(?:$|[^\p{L}])/u.test(title);
  const subtype = product.subcategory?.trim().toLocaleLowerCase('tr-TR') ?? '';
  const declaredRole = UPPER_SUBCATEGORY_ROLE[subtype];
  // Require matching text as well as the subtype; inferred/missing metadata alone
  // cannot veto an authoritative role (for example a cardigan inferred as tisort).
  const explicitType = subtype && title.split(/[^\p{L}-]+/u).includes(subtype);
  const value = { title: product.title, subcategory: product.subcategory,
    age: child ? 'child' as const : adult ? 'adult' as const : null,
    typeRole: explicitType ? declaredRole ?? null : null, subtypeRole: declaredRole ?? null };
  hardEvidence.set(product, value);
  return value;
};

/** Structural core is unchanged; footwear completion precedes optional coverage. */
export const hasCoreFootwear = (items: readonly PairOutfitItem[]): boolean =>
  items.some(item => item.role === 'shoes') && (items.some(item => item.role === 'one_piece') ||
    (items.some(item => item.role === 'top') && items.some(item => item.role === 'bottom')));

export const hasHardConflict = (items: readonly PairOutfitItem[]): boolean => {
  let child = false, adult = false, women = false, men = false;
  let outerLayers = 0;
  for (const item of items) {
    if (item.role === 'outerwear') outerLayers++;
    if (item.sourceType !== 'catalog') continue;
    const evidence = readHardEvidence(item.product);
    if (evidence.typeRole && evidence.typeRole !== item.role) return true;
    // A top whose canonical subtype is outerwear (e.g. a blazer) keeps its role, but
    // the disagreement is unresolved, so it must not be paired with another outer layer.
    if (item.role === 'top' && evidence.subtypeRole === 'outerwear') outerLayers++;
    child ||= evidence.age === 'child';
    adult ||= evidence.age === 'adult';
    women ||= item.product.gender === 'women';
    men ||= item.product.gender === 'men';
  }
  return outerLayers > 1 || (child && adult) || (women && men);
};

const ROLES_BY_CATEGORY: Readonly<Record<PairCategory, readonly PairRole[]>> = {
  upper_body: ['top', 'outerwear'],
  lower_body: ['bottom'],
  dresses: ['one_piece'],
  shoes: ['shoes'],
  bags: ['bag'],
  hats: ['hat'],
  accessories: ['accessory'],
};

// Shared across anchors using the same catalog objects. Raw evidence is checked on
// every read, including in-place edits; weak keys do not retain discarded catalogs.
const catalogRoleCompatibility = new WeakMap<PairCatalogProduct, {
  category: PairCatalogProduct['category'];
  subcategory: PairCatalogProduct['subcategory'];
  roles: Map<PairRole, boolean>;
}>();

/** Broad categories may contain subtypes that cannot fill their default role. */
export const isCatalogRoleCompatible = (product: PairCatalogProduct, role: PairRole): boolean => {
  let prepared = catalogRoleCompatibility.get(product);
  if (!prepared || prepared.category !== product.category || prepared.subcategory !== product.subcategory) {
    prepared = { category: product.category, subcategory: product.subcategory, roles: new Map() };
    catalogRoleCompatibility.set(product, prepared);
  }
  const cached = prepared.roles.get(role);
  if (cached !== undefined) return cached;

  const compatible = product.category === 'lower_body'
    && (product.subcategory === undefined || product.subcategory === null ? undefined
      : product.subcategory.toLocaleLowerCase('tr-TR')) === 'pareo'
    ? false
    : ROLES_BY_CATEGORY[product.category].includes(role);
  prepared.roles.set(role, compatible);
  return compatible;
};

export const isValidOutfitItems = (items: readonly PairOutfitItem[]): boolean => {
  if (hasHardConflict(items)) return false;
  const roles = new Set<PairRole>();
  const sourceIds = new Set<string>();
  for (const item of items) {
    if (item.sourceType === 'catalog' && !isCatalogRoleCompatible(item.product, item.role)) {
      return false;
    }
    const sourceKey = JSON.stringify([item.sourceType, item.sourceId]);
    if (roles.has(item.role) || sourceIds.has(sourceKey)) return false;
    roles.add(item.role);
    sourceIds.add(sourceKey);
  }
  const hasOnePiece = roles.has('one_piece');
  const hasTwoPiece = roles.has('top') && roles.has('bottom');
  return hasOnePiece
    ? !roles.has('top') && !roles.has('bottom')
    : hasTwoPiece;
};
