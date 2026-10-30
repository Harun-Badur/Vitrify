import {
  PRODUCT_VARIANT_COLUMNS_ENABLED,
  mapFeedRow,
  withVariantColumns,
} from '../services/catalogProductAdapter';
import type { FeedProductRow } from '../types/product';

const row = (extra: Record<string, unknown> = {}): FeedProductRow =>
  ({
    id: 'lcw-1',
    provider: 'lcw',
    external_id: '1',
    title: 'Tişört',
    brand: 'LCW',
    price: 100,
    currency: 'TRY',
    image_url: 'https://x/i.jpg',
    product_url: 'https://www.lcw.com/x-o-1',
    category: 'upper_body',
    affiliate_url: null,
    ...extra,
  }) as FeedProductRow;

describe('variant columns flag', () => {
  it('is on (migration applied) and appends the columns by default', () => {
    expect(PRODUCT_VARIANT_COLUMNS_ENABLED).toBe(true);
    expect(withVariantColumns('id, title')).toBe(
      'id, title, color_variants, size_options, variants_fetched_at',
    );
  });

  it('leaves the select untouched when disabled', () => {
    expect(withVariantColumns('id, title', false)).toBe('id, title');
  });

  it('appends the three columns when enabled', () => {
    expect(withVariantColumns('id', true)).toBe(
      'id, color_variants, size_options, variants_fetched_at',
    );
  });
});

describe('mapFeedRow variant fields', () => {
  it('omits the fields when the columns are absent or null', () => {
    const p = mapFeedRow(row())!;
    expect(p.colorVariants).toBeUndefined();
    expect(p.sizeOptions).toBeUndefined();
    expect(p.variantsFetchedAt).toBeUndefined();
    const n = mapFeedRow(row({ color_variants: null, size_options: null, variants_fetched_at: null }))!;
    expect(n.colorVariants).toBeUndefined();
    expect(n.sizeOptions).toBeUndefined();
  });

  it('maps valid data and drops malformed entries', () => {
    const p = mapFeedRow(
      row({
        color_variants: [
          { name: 'Siyah', url: 'https://x/1', imageUrl: 'https://x/1.jpg' },
          { name: null, url: 'https://x/2' },
          { name: 'Bad' },
          'junk',
        ],
        size_options: [{ label: '38', inStock: true }, { label: '40' }, { inStock: true }],
        variants_fetched_at: '2026-10-30T10:00:00.000Z',
      }),
    )!;
    expect(p.colorVariants).toEqual([
      { name: 'Siyah', url: 'https://x/1', imageUrl: 'https://x/1.jpg' },
      { name: null, url: 'https://x/2' },
    ]);
    expect(p.sizeOptions).toEqual([{ label: '38', inStock: true }, { label: '40' }]);
    expect(p.variantsFetchedAt).toBe('2026-10-30T10:00:00.000Z');
  });

  it('treats non-array or empty values as absent', () => {
    const p = mapFeedRow(row({ color_variants: {}, size_options: [] }))!;
    expect(p.colorVariants).toBeUndefined();
    expect(p.sizeOptions).toBeUndefined();
  });
});
