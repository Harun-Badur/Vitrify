import type { OutfitRole, Product } from '../../../types/product';
import { normalizeOutfitItems, type OutfitCandidateInput } from './generateOutfitCandidates';
import type { WardrobeItemForCandidate } from './outfitCandidate';

/**
 * Upper bound of the firstOnly candidate band (every role combination). Anchors whose bound stays at or
 * below it are never touched, so their output is identical to the uncapped search.
 */
export const BAND_CAP_LIMIT = 4_000;

const OPTIONAL: readonly OutfitRole[] = ['outerwear', 'shoes', 'bag', 'hat', 'accessory'];

/** Optional roles with at least one item (the anchor included); the largest optional count a leaf can reach. */
export const presentOptionalRoles = <T extends WardrobeItemForCandidate>(input: OutfitCandidateInput<T>): number =>
  new Set(normalizeOutfitItems(input).map(item => item.role).filter(role => OPTIONAL.includes(role))).size;

interface Counts { catalog: Map<OutfitRole, Product[]>; wardrobe: Map<OutfitRole, number> }

const bound = (sizes: ReadonlyMap<OutfitRole, number>, required?: OutfitRole): number => {
  const size = (role: OutfitRole): number => required === role ? 1 : sizes.get(role) ?? 0;
  const tops = required === 'one_piece' ? 0 : size('top'), bottoms = size('bottom');
  const onePieces = required === 'top' || required === 'bottom' ? 0 : size('one_piece');
  let total = Math.max(1, tops * bottoms + onePieces);
  for (const role of OPTIONAL) total *= Math.max(1, size(role));
  return total;
};

/**
 * Keeps only the N catalog alternatives per role that are most compatible with the anchor, with the
 * smallest N that brings the band bound under the limit. Returns the input products unchanged when
 * the bound is already within the limit (the normal case).
 */
export function capCatalogBand<T extends WardrobeItemForCandidate>(
  input: OutfitCandidateInput<T>, anchor: Product, score: (product: Product) => number, limit = BAND_CAP_LIMIT,
): readonly Product[] {
  const counts: Counts = { catalog: new Map(), wardrobe: new Map() };
  for (const item of normalizeOutfitItems(input)) {
    if (item.sourceType === 'wardrobe') counts.wardrobe.set(item.role, (counts.wardrobe.get(item.role) ?? 0) + 1);
    else if (item.product.id !== anchor.id) {
      const group = counts.catalog.get(item.role) ?? [];
      group.push(item.product);
      counts.catalog.set(item.role, group);
    }
  }
  const required = input.requiredCatalogProductId === anchor.id
    ? normalizeOutfitItems(input).find(item => item.sourceType === 'catalog' && item.sourceId === anchor.id)?.role : undefined;
  const sizesFor = (cap: number): Map<OutfitRole, number> => {
    const sizes = new Map<OutfitRole, number>();
    for (const role of new Set([...counts.catalog.keys(), ...counts.wardrobe.keys()])) {
      sizes.set(role, (counts.wardrobe.get(role) ?? 0) + Math.min(counts.catalog.get(role)?.length ?? 0, cap));
    }
    return sizes;
  };
  if (bound(sizesFor(Infinity), required) <= limit) return input.catalogProducts;
  let cap = Math.max(...[...counts.catalog.values()].map(group => group.length));
  while (cap > 1 && bound(sizesFor(cap), required) > limit) cap -= 1;
  const dropped = new Set<string>();
  for (const group of counts.catalog.values()) {
    if (group.length <= cap) continue;
    const ranked = group.map((product, index) => ({ product, index, value: score(product) }))
      .sort((left, right) => right.value - left.value || left.index - right.index);
    for (const entry of ranked.slice(cap)) dropped.add(entry.product.id);
  }
  return input.catalogProducts.filter(product => !dropped.has(product.id));
}
