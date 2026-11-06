import { MOCK_PRODUCTS } from '../data/mockProducts';
import * as generation from '../src/intelligence/outfits/generateOutfitCandidates';
import {
  completeDiscoverRecommendationsAsync,
  getDiscoverRecommendations,
  prepareDiscoverRankingAsync,
} from '../src/intelligence/recommendations/getDiscoverRecommendations';
import { complementaryProductsForDisplay } from '../src/intelligence/recommendations/complementaryProductsForDisplay';
import { rankDiversityCandidatesAsync } from '../src/intelligence/outfits/rankOutfitCandidates';
import type { OutfitRole, Product } from '../types/product';

const categories: Record<OutfitRole, Product['category']> = {
  top: 'upper_body', bottom: 'lower_body', shoes: 'shoes', outerwear: 'upper_body',
  bag: 'bags', hat: 'hats', accessory: 'accessories', one_piece: 'dresses',
};
const product = (id: string, role: OutfitRole, extra: Partial<Product> = {}): Product => ({
  ...MOCK_PRODUCTS[0], id, title: `${role} ${id}`, brand: `Marka ${id}`, category: categories[role], outfitRole: role, gender: 'women',
  subcategory: undefined, fit: undefined, colorSlugs: ['siyah'], productUrl: `https://example.com/${id}`, imageUrl: `https://example.com/${id}.jpg`, ...extra });
const group = (role: OutfitRole, count: number): Product[] => Array.from({ length: count }, (_, index) => product(`${role}-${index}`, role));
const anchor = product('anchor', 'top');
const catalog = [anchor, ...group('bottom', 4), ...group('shoes', 4), ...group('bag', 4), ...group('hat', 3), ...group('accessory', 3)];
const options = { budgetMs: 1_000_000 };
const inputFor = (products: readonly Product[], exposure = new Map<string, number>()) => ({
  wardrobeItems: [], catalogProducts: [...products], requiredCatalogProductId: anchor.id, firstOnly: true, recommendationExposure: exposure });

afterEach(() => jest.restoreAllMocks());

describe('lazy diversity band', () => {
  it('builds candidate records only for the final subset, not for the whole band', async () => {
    const build = jest.spyOn(generation, 'outfitCandidateFromItems');
    const prepared = await prepareDiscoverRankingAsync(inputFor(catalog), options);
    expect(build).not.toHaveBeenCalled();
    const result = await completeDiscoverRecommendationsAsync(prepared, new Map(), options);
    const built = build.mock.calls.length;
    expect(complementaryProductsForDisplay(result, anchor.id)).toHaveLength(3);
    expect(prepared.ranked.length).toBeGreaterThan(100);
    expect(built).toBeLessThan(prepared.ranked.length / 4);
  });

  it('gives the synchronous full-ranking result for every exposure, from one prepared band', async () => {
    const prepared = await prepareDiscoverRankingAsync(inputFor(catalog), options);
    for (const exposure of [new Map<string, number>(), new Map([['bottom-0', 3]]), new Map([['shoes-0', 2], ['bag-1', 9], ['bottom-1', 1]])]) {
      expect(await completeDiscoverRecommendationsAsync(prepared, exposure, options)).toEqual(getDiscoverRecommendations(inputFor(catalog, exposure)));
    }
  });

  it('keeps the whole ranked list readable and equal to the ranking API', async () => {
    const prepared = await prepareDiscoverRankingAsync(inputFor(catalog), options);
    const input = { wardrobeItems: [], catalogProducts: catalog, requiredCatalogProductId: anchor.id, maximalOnly: true };
    expect(prepared.ranked).toEqual(await rankDiversityCandidatesAsync(input, anchor, options));
    expect(prepared.ranked).toBe(prepared.ranked);
  });

  it('falls back to ranked order when two products tie exactly, as list order then decides', async () => {
    const twin = { title: 'Ikiz', brand: 'Ikiz', productUrl: undefined, imageUrl: 'https://example.com/twin.jpg' };
    const twins = [product('twin-b', 'bottom', twin), product('twin-a', 'bottom', twin)];
    const products = [anchor, ...twins, ...group('shoes', 2)];
    const prepared = await prepareDiscoverRankingAsync(inputFor(products), options);
    expect(await completeDiscoverRecommendationsAsync(prepared, new Map(), options)).toEqual(getDiscoverRecommendations(inputFor(products)));
  });

  it('returns no selection for an empty band', async () => {
    const prepared = await prepareDiscoverRankingAsync(inputFor([anchor]), options);
    expect(prepared.ranked).toEqual(await rankDiversityCandidatesAsync({ wardrobeItems: [], catalogProducts: [anchor], requiredCatalogProductId: anchor.id, maximalOnly: true }, anchor, options));
    expect(await completeDiscoverRecommendationsAsync(prepared, new Map(), options)).toEqual(getDiscoverRecommendations(inputFor([anchor])));
  });
});
