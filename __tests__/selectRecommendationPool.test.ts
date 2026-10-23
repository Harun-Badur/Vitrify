import { fetchRecommendationCatalog } from '../services/productService';
import { selectRecommendationPool } from '../src/intelligence/recommendations/selectRecommendationPool';
import { getSupabaseClient } from '../lib/supabase';
import type { OutfitRole, Product } from '../types/product';

jest.mock('../lib/supabase', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../lib/recsFeedState', () => ({ setLastFeedMode: jest.fn(), setLastRecommendationId: jest.fn() }));
jest.mock('../lib/sessionIntent', () => ({ buildIntent: jest.fn() }));
jest.mock('../lib/logger', () => ({ logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../lib/recsConfig', () => ({ fetchRecsConfig: jest.fn(), fetchStyleProfileSnapshot: jest.fn() }));
jest.mock('expo/virtual/env', () => ({ env: process.env }), { virtual: true });

const product = (
  id: string,
  provider: Product['provider'],
  role: OutfitRole,
  createdAt: string,
): Product => ({
  id,
  title: id,
  brand: provider ?? 'Brand',
  price: 100,
  imageUrl: 'https://example.com/image.jpg',
  category: 'upper_body',
  garmentDescription: id,
  provider,
  outfitRole: role,
  createdAt,
});

const tally = (products: readonly Product[], key: (item: Product) => string): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const item of products) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
};

describe('selectRecommendationPool', () => {
  it('includes later FLO and LC Waikiki products instead of only the oldest page', () => {
    const oldest = Array.from({ length: 80 }, (_, index) =>
      product(`old-${index}`, 'trendyol', index % 2 === 0 ? 'top' : 'bottom', '2026-01-01'));
    const imported = [
      product('flo-1', 'flo', 'shoes', '2026-10-09'),
      product('lcw-1', 'lcw', 'bag', '2026-10-09'),
      product('flo-2', 'flo', 'hat', '2026-10-09'),
    ];
    const pool = selectRecommendationPool([...oldest, ...imported]);
    expect(pool.map((item) => item.id)).toEqual(expect.arrayContaining(['flo-1', 'lcw-1', 'flo-2']));
    expect(new Set(pool.map((item) => item.provider))).toEqual(new Set(['trendyol', 'flo', 'lcw']));
  });

  it('keeps one copy of a repeated product id', () => {
    const first = product('same', 'flo', 'shoes', '2026-01-01');
    const duplicate = { ...first, title: 'other title' };
    const pool = selectRecommendationPool([
      first,
      duplicate,
      product('lcw-1', 'lcw', 'bag', '2026-02-01'),
    ]);
    expect(pool.filter((item) => item.id === 'same')).toHaveLength(1);
    expect(pool.find((item) => item.id === 'same')?.title).toBe('same');
  });

  it('seats every present role and provider without treating missing gender as a signal', () => {
    const roles: OutfitRole[] = ['top', 'bottom', 'one_piece', 'outerwear', 'shoes', 'bag', 'hat', 'accessory'];
    const providers: Array<Product['provider']> = ['trendyol', 'defacto', 'flo', 'lcw'];
    const products = roles.flatMap((role) => providers.flatMap((provider) =>
      Array.from({ length: 6 }, (_, index) => ({
        ...product(`${provider}-${role}-${index}`, provider, role, '2026-01-01'),
        gender: undefined,
        colorSlugs: undefined,
        fit: undefined,
        subcategory: undefined,
      }))));
    const pool = selectRecommendationPool(products);
    expect(pool).toHaveLength(80);
    expect(Object.keys(tally(pool, (item) => item.outfitRole ?? 'none')).sort()).toEqual([...roles].sort());
    expect(tally(pool, (item) => item.outfitRole ?? 'none').hat).toBe(4);
    expect(tally(pool, (item) => item.outfitRole ?? 'none').shoes).toBe(4);
    expect(Object.keys(tally(pool, (item) => item.provider ?? 'none')).sort()).toEqual(['defacto', 'flo', 'lcw', 'trendyol']);
    expect(pool.every((item) => item.gender === undefined)).toBe(true);
  });

  it('returns the same ids when the input order changes', () => {
    const products = [
      product('b', 'lcw', 'top', '2026-03-01'),
      product('a', 'flo', 'shoes', '2026-01-01'),
      product('c', 'trendyol', 'bottom', '2026-02-01'),
    ];
    expect(selectRecommendationPool(products).map((item) => item.id))
      .toEqual(selectRecommendationPool([...products].reverse()).map((item) => item.id));
  });
});

describe('fetchRecommendationCatalog coverage', () => {
  it('pages past the oldest rows and selects a later LC Waikiki product', async () => {
    const rows = [
      ...Array.from({ length: 80 }, (_, index) => ({
        id: `old-${index}`, provider: 'trendyol', external_id: String(index), title: `Old ${index}`,
        brand: 'Trendyol', price: 100, currency: 'TRY', image_url: 'https://example.com/old.jpg',
        product_url: 'https://example.com/old', category: 'upper_body', affiliate_url: null,
        created_at: '2026-01-01T00:00:00.000Z',
      })),
      {
        id: 'lcw-1', provider: 'lcw', external_id: '1', title: 'LCW Ceket', brand: 'LCW', price: 900,
        currency: 'TRY', image_url: 'https://example.com/lcw.jpg', product_url: 'https://example.com/lcw',
        category: 'upper_body', affiliate_url: null, created_at: '2026-10-09T00:00:00.000Z',
      },
    ];
    const attributes = [{ product_id: 'lcw-1', gender: null, colors: [], fit: null, subcategory: null,
      brand_slug: 'lcw', price_band: 'mid', outfit_role: 'outerwear' }];
    const client = {
      from: (table: string) => {
        const query = {
          select: () => query,
          order: () => query,
          not: () => query,
          in: (_column: string, ids: string[]) => Promise.resolve({
            data: table === 'product_attributes' ? attributes.filter((row) => ids.includes(row.product_id)) : [],
            error: null,
          }),
          range: (start: number, end: number) => Promise.resolve({
            data: rows.slice(start, end + 1),
            error: null,
          }),
        };
        return query;
      },
    };
    jest.mocked(getSupabaseClient).mockReturnValue(client as never);
    const pool = await fetchRecommendationCatalog();
    expect(pool.map((item) => item.id)).toContain('lcw-1');
    expect(pool.find((item) => item.id === 'lcw-1')?.outfitRole).toBe('outerwear');
    expect(pool.find((item) => item.id === 'lcw-1')?.gender).not.toBe('men');
  });
});
