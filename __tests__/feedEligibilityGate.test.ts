import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MOCK_PRODUCTS } from '../data/mockProducts';
import { FEED_ELIGIBLE_COLUMN, isFeedEligibleProduct, isFeedEligibleRow } from '../lib/feedEligibility';
import { mapFeedRow } from '../services/catalogProductAdapter';
import { complementaryProductsForDisplay } from '../src/intelligence/recommendations/complementaryProductsForDisplay';
import type { DiscoverRecommendation } from '../src/intelligence/recommendations/discoverRecommendation';
import { createRankingCacheKey, RECOMMENDATION_ENGINE_VERSION } from '../src/recommendationCache/fingerprint';
import type { Product } from '../types/product';

describe('feed eligibility gate', () => {
  it('admits only an explicit stored true', () => {
    expect(FEED_ELIGIBLE_COLUMN).toBe('feed_eligible');
    expect(isFeedEligibleRow({ feed_eligible: true })).toBe(true);
    for (const value of [false, null, undefined, 'true', 1]) {
      expect(isFeedEligibleRow({ feed_eligible: value })).toBe(false);
    }
    expect(isFeedEligibleRow(null)).toBe(false);
    expect(isFeedEligibleProduct({ feedEligible: true })).toBe(true);
    expect(isFeedEligibleProduct({ feedEligible: false })).toBe(false);
    expect(isFeedEligibleProduct({})).toBe(false);
  });

  const row = {
    id: 'p-1', provider: 'defacto' as const, external_id: '1', title: 'Siyah Tişört', brand: 'Fixture',
    price: 100, currency: 'TRY', image_url: MOCK_PRODUCTS[0].imageUrl, product_url: 'https://example.invalid/p',
    category: 'upper_body', affiliate_url: null,
  };

  it('maps the stored flag and leaves rows read without it (likes/history) unchanged', () => {
    expect(mapFeedRow({ ...row, feed_eligible: true })?.feedEligible).toBe(true);
    expect(mapFeedRow({ ...row, feed_eligible: false })?.feedEligible).toBe(false);
    expect(mapFeedRow(row)).not.toHaveProperty('feedEligible');
  });

  it('keeps a product stored as ineligible out of the "Tarzını tamamlayan parçalar" strip', () => {
    const anchor = { ...MOCK_PRODUCTS[0], id: 'anchor', feedEligible: true } as Product;
    const eligible = { ...MOCK_PRODUCTS[1], id: 'eligible', feedEligible: true } as Product;
    const ineligible = { ...MOCK_PRODUCTS[2], id: 'ineligible', feedEligible: false } as Product;
    const unknown = { ...MOCK_PRODUCTS[3], id: 'unknown' } as Product;
    const items = [anchor, eligible, ineligible, unknown].map(product => ({
      sourceType: 'catalog' as const, sourceId: product.id, product }));
    const recommendation = { type: 'outfit', candidate: { items } } as unknown as DiscoverRecommendation;
    // The strip pool is gated at the query (see feedPagination); unflagged fixtures stay engine-only.
    expect(complementaryProductsForDisplay([recommendation], 'anchor').map(product => product.id)).toEqual(['eligible', 'unknown']);
  });

  it('bumps the recommendation engine version so v1 cached ID lists are not reused', () => {
    expect(RECOMMENDATION_ENGINE_VERSION).toBe('discover-engine-v2');
    const input = { catalogProducts: [], wardrobeItems: [] } as never;
    expect(createRankingCacheKey({ input }).fingerprint)
      .not.toBe(createRankingCacheKey({ input, engineVersion: 'discover-engine-v1' }).fingerprint);
  });

  it('filters every feed query on the stored flag, not the history screens', () => {
    const read = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8');
    expect(read('services/productService.ts')).toContain(".eq(FEED_ELIGIBLE_COLUMN, true)");
    expect(read('supabase/functions/recs-feed/index.ts')).toContain(".eq(FEED_ELIGIBLE_COLUMN, true)");
    expect(read('services/likeService.ts')).not.toMatch(/feed_?eligible/i);
  });
});
