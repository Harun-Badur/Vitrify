import type { ProductFilters } from '../filters/productFilters';
import { filterProducts } from '../filters/productFilters';
import type { WardrobeItemForCandidate } from '../outfits/outfitCandidate';
import type { OutfitCandidateInput } from '../outfits/generateOutfitCandidates';
import { generateOutfitCandidates, generateOutfitCandidatesAsync } from '../outfits/generateOutfitCandidates';
import { generateWardrobeCatalogOutfits } from '../outfits/generateWardrobeCatalogOutfits';
import { findDiversityBandAsync, rankDiversityBand, rankDiversityBandAsync, rankOutfitCandidates, rankOutfitCandidatesAsync,
  type DiversityBand } from '../outfits/rankOutfitCandidates';
import type { RankedOutfitCandidate } from '../outfits/outfitRanking';
import type { OutfitDiscoverRecommendation } from './discoverRecommendation';
import { selectDiverseComplements, selectDiverseComplementsAsync, selectFromDiversityBandAsync } from './selectDiverseComplements';
import { isCatalogPairEligible } from './catalogPairing';
import type { CooperativeWorkOptions } from '../cooperativeWork';
import { createRecommendationMemo, type RecommendationMemo } from '../../../lib/recommendationMemo';
import type { Product } from '../../../types/product';
import { perfLog, perfNow } from '../../../lib/perfLog';

export interface DiscoverRecommendationInput<T extends WardrobeItemForCandidate>
  extends OutfitCandidateInput<T> {
  /** Existing hard catalog filters; omitted fields remain the caller's responsibility. */
  catalogFilters?: Pick<ProductFilters, 'query' | 'category' | 'gender' | 'size'>;
  /** Discover cards consume only the first ranked outfit. */
  firstOnly?: boolean;
  /** Counts of complements already shown in this caller's recommendation session. */
  recommendationExposure?: ReadonlyMap<string, number>;
}

/** Pure orchestration point for Discover's future outfit recommendation feed. */
const prepareInput = <T extends WardrobeItemForCandidate>(
  input: DiscoverRecommendationInput<T>,
) => {
  const catalogProducts = input.catalogFilters
    ? filterProducts([...input.catalogProducts], input.catalogFilters)
    : input.catalogProducts;
  const requiredProduct = input.requiredCatalogProductId
    ? catalogProducts.find((product) => product.id === input.requiredCatalogProductId)
    : undefined;
  // Faz 4 S3b: the pairing decision (gender, coarse season/formality, human decisions) replaces
  // the raw gender split and the separate human list. Only eligible products reach generation.
  const compatibleProducts = requiredProduct
    ? catalogProducts.filter((product) => product.id === requiredProduct.id
      || isCatalogPairEligible(requiredProduct, product))
    : catalogProducts;

  const outfitInput = {
    wardrobeItems: input.wardrobeItems,
    catalogProducts: compatibleProducts,
    requiredCatalogProductId: input.requiredCatalogProductId,
    maximalOnly: input.firstOnly,
  };
  return { outfitInput, requiredProduct };
};

export const getDiscoverRecommendations = <T extends WardrobeItemForCandidate>(
  input: DiscoverRecommendationInput<T>,
): OutfitDiscoverRecommendation<T>[] => {
  const { outfitInput, requiredProduct } = prepareInput(input);
  if (input.firstOnly && requiredProduct) {
    const ranked = rankOutfitCandidates(generateOutfitCandidates(outfitInput), requiredProduct);
    const selection = selectDiverseComplements(ranked, requiredProduct, input.recommendationExposure);
    return selection ? [{ type: 'outfit', ...selection.outfit, rank: 1,
      sources: selection.outfit.candidate.sources, displayProducts: selection.products }] : [];
  }
  const ranked = generateWardrobeCatalogOutfits(outfitInput);
  return (input.firstOnly ? ranked.slice(0, 1) : ranked).map((entry) => ({
    type: 'outfit',
    ...entry,
    sources: entry.candidate.sources,
  }));
};

export interface PreparedDiscoverRanking<T extends WardrobeItemForCandidate = WardrobeItemForCandidate> {
  ranked: RankedOutfitCandidate<T>[];
  requiredProduct: Product | undefined;
  diverse: boolean;
  firstOnly: boolean | undefined;
  recommendationMemo?: RecommendationMemo;
  /** Absent on a hydrated ranking, which carries its ranked list instead. */
  band?: DiversityBand<T>;
}

/** Exposure-independent pool, with its computation memo retained for selection. */
export const prepareDiscoverRankingAsync = async <T extends WardrobeItemForCandidate>(
  input: DiscoverRecommendationInput<T>, options?: CooperativeWorkOptions,
): Promise<PreparedDiscoverRanking<T>> => {
  const workOptions: CooperativeWorkOptions = {
    ...options,
    recommendationMemo: createRecommendationMemo(),
    diagnosticStage: 'ranking',
  };
  const perfInput = perfNow();
  const { outfitInput, requiredProduct } = prepareInput(input);
  perfLog('rec_input', { ms: perfNow() - perfInput, pool: input.catalogProducts.length,
    compatible: outfitInput.catalogProducts.length, wardrobe: input.wardrobeItems.length,
    gender: input.catalogFilters?.gender ?? 'none' });
  const diverse = !!(input.firstOnly && requiredProduct);
  const { firstOnly } = input, { recommendationMemo } = workOptions;
  if (diverse) {
    const band = await findDiversityBandAsync(outfitInput, requiredProduct!, workOptions);
    let ranked: RankedOutfitCandidate<T>[] | undefined;
    // Selection works on the band; ranked entries are built only for a reader of the whole list.
    // No object spread here: the compiled spread would read the getter and build them all.
    return { requiredProduct, diverse, firstOnly, recommendationMemo, band, get ranked() { return ranked ??= rankDiversityBand(band); } };
  }
  const ranked = await rankOutfitCandidatesAsync(await generateOutfitCandidatesAsync(outfitInput, workOptions),
    requiredProduct, workOptions);
  return { requiredProduct, diverse, firstOnly, recommendationMemo, ranked };
};


/** Changed exposure repeats only selection, never candidate generation or ranking. */
export const completeDiscoverRecommendationsAsync = async <T extends WardrobeItemForCandidate>(
  prepared: PreparedDiscoverRanking<T>, exposure?: ReadonlyMap<string, number>, options?: CooperativeWorkOptions,
): Promise<OutfitDiscoverRecommendation<T>[]> => {
  const { requiredProduct } = prepared;
  if (prepared.diverse && requiredProduct) {
    const selectionOptions: CooperativeWorkOptions = { ...options, recommendationMemo: prepared.recommendationMemo, diagnosticStage: 'selection' };
    const fromBand = prepared.band
      ? await selectFromDiversityBandAsync(prepared.band, requiredProduct, exposure, selectionOptions) : undefined;
    const selection = fromBand !== undefined ? fromBand : await selectDiverseComplementsAsync(
      prepared.band ? await rankDiversityBandAsync(prepared.band, selectionOptions) : prepared.ranked, requiredProduct, exposure, selectionOptions);
    return selection ? [{ type: 'outfit', ...selection.outfit, rank: 1,
      sources: selection.outfit.candidate.sources, displayProducts: selection.products }] : [];
  }
  const { ranked } = prepared;
  return (prepared.firstOnly ? ranked.slice(0, 1) : ranked).map(entry => ({
    type: 'outfit', ...entry, sources: entry.candidate.sources,
  }));
};

/** Preserves the original full-pipeline API for existing callers. */
export const getDiscoverRecommendationsAsync = async <T extends WardrobeItemForCandidate>(
  input: DiscoverRecommendationInput<T>, options?: CooperativeWorkOptions,
): Promise<OutfitDiscoverRecommendation<T>[]> => completeDiscoverRecommendationsAsync(
  await prepareDiscoverRankingAsync(input, options), input.recommendationExposure, options,
);
