import { normalizedRecommendationToken } from '../../../lib/recommendationMemo';
import type { Product, OutfitRole } from '../../../types/product';
import type { WardrobeItemForCandidate } from '../outfits/outfitCandidate';
import { hasCoreFootwear } from '../pairing/outfitRules.ts';
import type { RankedOutfitCandidate } from '../outfits/outfitRanking';
import { rankBandLeavesWork, type DiversityBand } from '../outfits/rankOutfitCandidates';
import { catalogCompatibility, catalogSemanticKey, sameCatalogProduct } from '../outfits/catalogCompatibility';
import { isCatalogPairEligible } from './catalogPairing';
import { runCooperatively, runSynchronously, type CooperativeWorkOptions } from '../cooperativeWork';

export interface ComplementSelection<T extends WardrobeItemForCandidate> {
  outfit: RankedOutfitCandidate<T>;
  products: Product[];
}

const NEAR_COMPATIBILITY_MARGIN = 0.12;
const EXPOSURE_PENALTY = 0.07;
const CATEGORY_REPEAT_PENALTY = 0.12;
const BRAND_REPEAT_PENALTY = 0.04;
const MAX_COMPLEMENTS = 3;
const normalizedBrand = (brand: string) => normalizedRecommendationToken(brand, true,
  () => brand.trim().toLocaleLowerCase('tr-TR'));

/** Complete visible core roles before allowing accessories or outerwear. */
const availableComplements = (choices: ReadonlyMap<string, Product>, anchor: Product,
  selected: readonly Product[], roles: ReadonlySet<OutfitRole>): Product[] => {
  const coreRoles: readonly OutfitRole[] = anchor.outfitRole === 'top' ? ['bottom', 'shoes']
    : anchor.outfitRole === 'bottom' ? ['top', 'shoes']
      : anchor.outfitRole === 'one_piece' ? ['shoes']
        : anchor.outfitRole === 'shoes' ? ['top', 'bottom'] : ['top', 'bottom', 'shoes'];
  const uniqueChoices = [...choices.values()].filter((p) => !sameCatalogProduct(p, anchor) && !selected.some((chosen) => sameCatalogProduct(chosen, p)));
  const missingCoreRole = coreRoles.find(role => !roles.has(role) &&
    uniqueChoices.some(product => product.outfitRole === role));
  const coreChoices = missingCoreRole ? uniqueChoices.filter((p) => p.outfitRole === missingCoreRole) : [];
  return coreChoices.length ? coreChoices : uniqueChoices;
};

/** The winning product; `tied` when another product matches it exactly, so only list order could decide. */
function* chooseComplement(available: readonly Product[], anchor: Product, selected: readonly Product[],
  itemScores: Map<Product, number>, exposure: ReadonlyMap<string, number>,
): Generator<void, { choice: Product | null; tied: boolean }, void> {
  let choice: Product | null = null, highest = -Infinity, tied = false;
  for (const product of available) {
    let base = itemScores.get(product);
    if (base === undefined) {
      base = catalogCompatibility(anchor, product).score; itemScores.set(product, base);
    }
    const count = exposure.get(product.id) ?? 0;
    const previous = Number.isFinite(count) ? Math.max(0, count) : 0;
    const repeatCategory = selected.some((p) => p.category === product.category);
    const repeatBrand = selected.some((p) => normalizedBrand(p.brand) === normalizedBrand(product.brand));
    const score = base - EXPOSURE_PENALTY * Math.log2(1 + previous)
      - Number(repeatCategory) * CATEGORY_REPEAT_PENALTY - Number(repeatBrand) * BRAND_REPEAT_PENALTY;
    if (score > highest || (score === highest && choice !== null && catalogSemanticKey(product) < catalogSemanticKey(choice))) {
      choice = product; highest = score; tied = false;
    } else if (score === highest && choice !== null && catalogSemanticKey(product) === catalogSemanticKey(choice)) tied = true;
    yield;
  }
  return { choice, tied };
}

/** Retains an actual valid outfit containing every selected product, never a synthetic mix. */
function* selectionWork<T extends WardrobeItemForCandidate>(
  ranked: readonly RankedOutfitCandidate<T>[],
  anchor: Product,
  exposure: ReadonlyMap<string, number> = new Map(),
): Generator<void, ComplementSelection<T> | null, void> {
  const best = ranked[0];
  if (!best) return null;
  let compatible: RankedOutfitCandidate<T>[] = [];
  const bestFootwear = hasCoreFootwear(best.candidate.items);
  for (const entry of ranked) {
    if (entry.rankingValue.validRoles && entry.rankingValue.coreComplete &&
    hasCoreFootwear(entry.candidate.items) === bestFootwear &&
    entry.rankingValue.optionalRoleCount === best.rankingValue.optionalRoleCount &&
    entry.rankingValue.sharedStyleTags.length === best.rankingValue.sharedStyleTags.length &&
    (entry.rankingValue.compatibilityScore ?? 0) >= (best.rankingValue.compatibilityScore ?? 0) - NEAR_COMPATIBILITY_MARGIN) compatible.push(entry);
    yield;
  }
  const selected: Product[] = [], roles = new Set<OutfitRole>();
  const itemScores = new Map<Product, number>();
  for (let slot = 0; slot < MAX_COMPLEMENTS; slot++) {
    const choices = new Map<string, Product>();
    for (const entry of compatible) for (const item of entry.candidate.items) {

        // Pairing decides against the anchor and every complement already chosen; a slot with no
        // eligible product stays empty (0-3 complements, never force-filled).
        if (item.sourceType === 'catalog' && !choices.has(item.sourceId) && !roles.has(item.role)
          && isCatalogPairEligible(anchor, item.product)
          && selected.every((chosen) => isCatalogPairEligible(chosen, item.product))) choices.set(item.sourceId, item.product);

      yield;
    }
    const available = availableComplements(choices, anchor, selected, roles);
    const { choice } = yield* chooseComplement(available, anchor, selected, itemScores, exposure);
    if (!choice) break;
    const chosen = choice;
    selected.push(chosen);
    if (chosen.outfitRole) roles.add(chosen.outfitRole);
    const remaining: RankedOutfitCandidate<T>[] = [];
    for (const entry of compatible) {
      if (entry.candidate.items.some((item) => item.sourceType === 'catalog' && item.sourceId === chosen.id)) remaining.push(entry);
      yield;
    }
    compatible = remaining;
  }
  const outfit = compatible[0];
  return outfit ? { outfit, products: selected } : null;
}

/**
 * selectionWork over bare band leaves. Selection reads a ranked list in only three ways: its best entry,
 * which products it contains, and its first entry after filtering. The band fixes everything the first
 * filter compares except compatibility, membership needs no order, and the last entry is ranked for
 * real below. Returns undefined when two products tie exactly: then list order decides, so the caller
 * must use the ranked band.
 */
function* bandSelectionWork<T extends WardrobeItemForCandidate>(
  band: DiversityBand<T>, anchor: Product, exposure: ReadonlyMap<string, number> = new Map(),
): Generator<void, ComplementSelection<T> | null | undefined, void> {
  if (band.leaves.length === 0) return null;
  let best = -Infinity;
  for (const compatibility of band.compatibility) best = Math.max(best, compatibility);
  let compatible = band.leaves.filter((_, index) => band.compatibility[index] >= best - NEAR_COMPATIBILITY_MARGIN);
  yield;
  const selected: Product[] = [], roles = new Set<OutfitRole>();
  const itemScores = new Map<Product, number>();
  for (let slot = 0; slot < MAX_COMPLEMENTS; slot++) {
    const choices = new Map<string, Product>();
    const judged = new Set<string>();
    for (const leaf of compatible) {
      for (const item of leaf) {
        if (item.sourceType !== 'catalog' || judged.has(item.sourceId)) continue;
        judged.add(item.sourceId);
        if (!roles.has(item.role) && isCatalogPairEligible(anchor, item.product)
          && selected.every((chosen) => isCatalogPairEligible(chosen, item.product))) choices.set(item.sourceId, item.product);
        yield;
      }
    }
    const available = availableComplements(choices, anchor, selected, roles);
    const { choice, tied } = yield* chooseComplement(available, anchor, selected, itemScores, exposure);
    if (tied) return undefined;
    if (!choice) break;
    const chosen = choice;
    selected.push(chosen);
    if (chosen.outfitRole) roles.add(chosen.outfitRole);
    compatible = compatible.filter((leaf) => leaf.some((item) => item.sourceType === 'catalog' && item.sourceId === chosen.id));
    yield;
  }
  if (compatible.length === 0) return null;
  const [outfit] = yield* rankBandLeavesWork(compatible, anchor);
  return { outfit, products: selected };
}

export const selectFromDiversityBandAsync = <T extends WardrobeItemForCandidate>(
  band: DiversityBand<T>, anchor: Product, exposure?: ReadonlyMap<string, number>, options?: CooperativeWorkOptions,
): Promise<ComplementSelection<T> | null | undefined> => runCooperatively(bandSelectionWork(band, anchor, exposure), options);

export const selectDiverseComplements = <T extends WardrobeItemForCandidate>(
  ranked: readonly RankedOutfitCandidate<T>[], anchor: Product,
  exposure?: ReadonlyMap<string, number>,
): ComplementSelection<T> | null => runSynchronously(selectionWork(ranked, anchor, exposure));

export const selectDiverseComplementsAsync = <T extends WardrobeItemForCandidate>(
  ranked: readonly RankedOutfitCandidate<T>[], anchor: Product,
  exposure?: ReadonlyMap<string, number>, options?: CooperativeWorkOptions,
): Promise<ComplementSelection<T> | null> => runCooperatively(selectionWork(ranked, anchor, exposure), options);
