import type { Product } from '../../../types/product';
import { recommendationMemoValue, normalizedRecommendationToken } from '../../../lib/recommendationMemo';

export interface CatalogCompatibility {
  score: number;
  color: number;
  /** Always 0. Price proximity is not outfit evidence; an explicit range is a hard filter. */
  price: number;
  brand: number;
  fit: number;
  style: number;
}

const WEIGHTS = { color: 0.3, brand: 0.1, fit: 0.1, style: 0.15 };
const NEUTRAL_COLORS = new Set(['siyah', 'beyaz', 'gri', 'bej', 'krem', 'navy']);
const STYLE_BY_SUBCATEGORY: Readonly<Record<string, string>> = {
  jean: 'casual', tisort: 'casual', polo: 'casual', hoodie: 'casual',
  sweatshirt: 'casual', sneaker: 'casual', sort: 'casual',
  blazer: 'tailored', gomlek: 'tailored',
};
const token = (value: string | undefined): string =>
  value === undefined || value === null ? '' : normalizedRecommendationToken(value, true,
    () => value.trim().toLocaleLowerCase('tr-TR'));

/** Style class the outfit scorer can actually read. Unmapped subtypes stay unscored. */
export const catalogStyleSignal = (subcategory: string | null | undefined): string | null =>
  STYLE_BY_SUBCATEGORY[token(subcategory ?? undefined)] ?? null;

/** Soft evidence only. Remaining weights are not rescaled after price proximity was removed. */
export const catalogCompatibility = (anchor: Product, product: Product): CatalogCompatibility => {
  const evidence = (entry: Product) => [entry.id, entry.outfitRole, entry.colorSlugs,
    entry.brand, entry.fit, entry.subcategory];
  return recommendationMemoValue('catalogCompatibilityMemo', JSON.stringify([
    'tr-TR', evidence(anchor), evidence(product),
  ]), () => {

  const left = new Set(anchor.colorSlugs?.map(token) ?? []);
  const right = product.colorSlugs?.map(token) ?? [];
  const color = right.some((color) => left.has(color)) ? 1
    : left.size > 0 && right.length > 0 &&
      ([...left].some((color) => NEUTRAL_COLORS.has(color)) || right.some((color) => NEUTRAL_COLORS.has(color))) ? 0.5 : 0;
  const price = 0;
  const anchorBrand = token(anchor.brand), productBrand = token(product.brand);
  const brand = anchorBrand !== '' && anchorBrand !== 'kabin' && anchorBrand === productBrand ? 1 : 0;
  const fit = anchor.fit && product.fit && anchor.fit === product.fit ? 1 : 0;
  const anchorStyle = catalogStyleSignal(anchor.subcategory);
  const productStyle = catalogStyleSignal(product.subcategory);
  const style = anchorStyle && productStyle && anchorStyle === productStyle ? 1 : 0;
  return { color, price, brand, fit, style,
    score: color * WEIGHTS.color + brand * WEIGHTS.brand + fit * WEIGHTS.fit + style * WEIGHTS.style };

  });
};

// Weak keys release discarded products; each entry holds only immutable output
// and private raw evidence, never the caller's mutable color array.
const semanticKeys = new WeakMap<Product, {
  evidence: readonly unknown[];
  colors: readonly string[];
  key: string;
}>();

/** Semantic ordering for genuinely equal evidence; identifiers are intentionally excluded. */
export const catalogSemanticKey = (product: Product): string => {
  const evidence = [product.id, product.outfitRole, product.category, product.gender,
    product.subcategory, product.brand, product.title, product.fit,
    product.colorSlugs == null ? product.colorSlugs : true];
  const colors = product.colorSlugs ?? [];
  const cached = semanticKeys.get(product);
  let sameColors = cached !== undefined && colors.length === cached.colors.length;
  for (let index = 0; sameColors && index < colors.length; index++) {
    sameColors = Object.is(colors[index], cached!.colors[index]);
  }
  if (cached && evidence.every((value, index) => Object.is(value, cached.evidence[index])) &&
      sameColors) return cached.key;
  const key = JSON.stringify([
    product.outfitRole, product.category, product.gender, token(product.subcategory),
    token(product.brand), token(product.title),
    [...colors].map(token).sort(), token(product.fit),
  ]);
  // Copy raw colors: the repository or caller can mutate the original array in place.
  semanticKeys.set(product, { evidence, colors: [...colors], key });
  return key;
};

export const sameCatalogProduct = (left: Product, right: Product): boolean => {

  if (left.id === right.id) return true;
  if (left.productUrl && right.productUrl) {
    try {
      const canonical = (raw: string): string => {
        return recommendationMemoValue('canonicalProductUrl', raw, () => {
          const url = new URL(raw);
          return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
        });
      };
      if (canonical(left.productUrl) === canonical(right.productUrl)) return true;
    } catch {
      // Malformed URLs are compared using actual metadata instead.
    }
  }
  return catalogSemanticKey(left) === catalogSemanticKey(right) && left.imageUrl === right.imageUrl;

};
