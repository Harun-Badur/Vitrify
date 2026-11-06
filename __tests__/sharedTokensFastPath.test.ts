import { createOutfitRankingTokenCache, evaluateOutfitCandidate, evaluateOutfitMinimum } from '../src/intelligence/outfits/outfitRanking';
import type { OutfitCandidate, OutfitCandidateItem } from '../src/intelligence/outfits/outfitCandidate';
import { createRecommendationMemo, withRecommendationMemo } from '../lib/recommendationMemo';
import type { Product } from '../types/product';

const catalogItem = (id: string, role: 'top' | 'bottom', colorSlugs: string[]): OutfitCandidateItem => ({
  sourceType: 'catalog', sourceId: id, role,
  product: { id, title: id, brand: 'B', price: 1, imageUrl: '', category: role === 'top' ? 'upper_body' : 'lower_body',
    outfitRole: role, garmentDescription: id, gender: 'women', colorSlugs } as Product });
const wardrobeItem = (id: string, role: 'top' | 'bottom', tags: string[]): OutfitCandidateItem => ({
  sourceType: 'wardrobe', sourceId: id, role, wardrobeItem: { id, category: role, style_tags: tags } as never });
const shared = (memo: ReturnType<typeof createRecommendationMemo>) => memo.values.get('sharedTokensMemo')?.size ?? 0;

describe('sharedTokens fast path', () => {
  it('builds no key for catalog-only style tags, which are always empty', () => {
    const memo = createRecommendationMemo();
    const items = [catalogItem('a', 'top', ['siyah']), catalogItem('b', 'bottom', ['siyah'])];
    const value = withRecommendationMemo(memo, () => evaluateOutfitMinimum(items, createOutfitRankingTokenCache()));
    expect(value).toEqual({ sharedStyleTags: [] });
    expect(shared(memo)).toBe(0);
  });

  it('still shares tokens as soon as one item has any', () => {
    const memo = createRecommendationMemo();
    const items = [wardrobeItem('a', 'top', ['casual', 'minimal']), wardrobeItem('b', 'bottom', ['casual'])];
    const value = withRecommendationMemo(memo, () => evaluateOutfitMinimum(items, createOutfitRankingTokenCache()));
    expect(value).toEqual({ sharedStyleTags: ['casual'] });
    expect(shared(memo)).toBe(1);
  });

  it('leaves shared colors of catalog items untouched and returns fresh arrays', () => {
    const items = [catalogItem('a', 'top', ['siyah']), catalogItem('b', 'bottom', ['siyah'])];
    const candidate: OutfitCandidate = { id: 'c', items, roles: ['top', 'bottom'], sources: ['catalog'] };
    const first = evaluateOutfitCandidate(candidate), second = evaluateOutfitCandidate(candidate);
    expect(first.rankingValue.sharedColors).toEqual(['siyah']);
    expect(first.rankingValue.sharedStyleTags).toEqual([]);
    expect(first.rankingValue.sharedStyleTags).not.toBe(second.rankingValue.sharedStyleTags);
  });
});
