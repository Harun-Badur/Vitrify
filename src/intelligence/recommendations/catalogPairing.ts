import { matchSubcategoryFromTitle } from '../../../lib/productAttributes';
import type { Product } from '../../../types/product';
import { evaluatePair } from '../pairing/pairing.ts';
import { PAIRING_POLICY_V2 } from '../pairing/pairingPolicy.ts';
import type { PairEvaluation, PairItem } from '../pairing/pairingTypes.ts';

/**
 * Builds the pairing view of a hydrated catalog Product (Faz 4 S3b). The Product carries no
 * per-field provenance, so reliability comes only from explicit title evidence:
 * - subtype: reliable when the title rules name the same slug (high-confidence title match);
 * - gender: `unisex` is reliable only with an explicit unisex word; women/men stay unverified.
 */
const NEUTRAL_WORDS = ['unisex', 'uniseks'];

const titleWords = (title: string): string[] =>
  title.toLocaleLowerCase('tr-TR').match(/[\p{L}\p{N}]+/gu) ?? [];

const items = new WeakMap<Product, { title: string; subcategory: Product['subcategory']; gender: Product['gender'];
  role: Product['outfitRole']; item: PairItem }>();

export const pairItemFromProduct = (product: Product): PairItem => {
  const cached = items.get(product);
  if (cached && cached.title === product.title && cached.subcategory === product.subcategory
    && cached.gender === product.gender && cached.role === product.outfitRole) return cached.item;
  const subtype = product.subcategory?.trim() || null;
  const gender = product.gender || null;
  const explicitNeutral = gender === 'unisex' && titleWords(product.title).some((word) => NEUTRAL_WORDS.includes(word));
  const item: PairItem = {
    id: product.id,
    origin: 'catalog',
    role: product.outfitRole
      ? { value: product.outfitRole, source: 'category_rule', confidence: 'high' }
      : { value: null, source: 'unknown', confidence: 'unknown' },
    gender: gender === null
      ? { value: null, source: 'unknown', confidence: 'unknown' }
      : { value: gender, source: 'product_snapshot', confidence: explicitNeutral ? 'high' : 'unknown' },
    subtype: subtype === null
      ? { value: null, source: 'unknown', confidence: 'unknown' }
      : { value: subtype, source: 'product_snapshot',
        confidence: matchSubcategoryFromTitle(product.title, product.category) === subtype ? 'high' : 'unknown' },
    conflicts: [],
  };
  items.set(product, { title: product.title, subcategory: product.subcategory, gender: product.gender,
    role: product.outfitRole, item });
  return item;
};

/** The S3b pairing decision for two catalog products; anchor first (human decisions are directional). */
export const catalogPairDecision = (anchor: Product, candidate: Product): PairEvaluation => evaluatePair({
  anchor: pairItemFromProduct(anchor),
  candidate: pairItemFromProduct(candidate),
  sessionGender: null,
  policy: PAIRING_POLICY_V2,
});

/** Only eligible pairs are shown; rejected and uncertain (insufficient evidence) pairs are not. */
export const isCatalogPairEligible = (anchor: Product, candidate: Product): boolean =>
  catalogPairDecision(anchor, candidate).outcome === 'eligible';
