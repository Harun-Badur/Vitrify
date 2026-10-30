import {
  MANUAL_REVIEW_PRODUCT_IDS,
  buildVariantUpdate,
  planVariantUpdates,
} from '../scripts/variants/variantRows';
import type { VariantRecord } from '../scripts/variants/types';

const rec = (over: Partial<VariantRecord>): VariantRecord => ({
  product_id: 'lcw-1',
  provider: 'lcw',
  product_url: 'https://www.lcw.com/x-o-1',
  fetched_at: '2026-10-30T10:00:00.000Z',
  colors: [],
  sizes: [],
  found: true,
  ...over,
});

describe('buildVariantUpdate', () => {
  it('maps colors and sizes and keeps fetched_at', () => {
    const u = buildVariantUpdate(
      rec({
        colors: [{ name: 'Siyah', url: 'https://x/1', imageUrl: 'https://x/1.jpg' }],
        sizes: [{ label: '38', inStock: false }, { label: '40' }],
      }),
    );
    expect(u).toEqual({
      color_variants: [{ name: 'Siyah', url: 'https://x/1', imageUrl: 'https://x/1.jpg' }],
      size_options: [{ label: '38', inStock: false }, { label: '40' }],
      variants_fetched_at: '2026-10-30T10:00:00.000Z',
    });
  });

  it('writes null (not []) for empty lists', () => {
    const u = buildVariantUpdate(rec({ colors: [], sizes: [{ label: '38', inStock: true }] }));
    expect(u.color_variants).toBeNull();
    expect(u.size_options).toEqual([{ label: '38', inStock: true }]);
    expect(buildVariantUpdate(rec({})).size_options).toBeNull();
  });

  it("keeps colors with name '' but stores the name as null", () => {
    const u = buildVariantUpdate(
      rec({ colors: [{ name: '', url: 'https://x/2' }, { name: 'Beyaz', url: 'https://x/3' }] }),
    );
    expect(u.color_variants).toEqual([
      { name: null, url: 'https://x/2' },
      { name: 'Beyaz', url: 'https://x/3' },
    ]);
  });
});

describe('planVariantUpdates', () => {
  it('skips manual_review ids and errored fetches, and counts items', () => {
    const manual = MANUAL_REVIEW_PRODUCT_IDS[0];
    expect(MANUAL_REVIEW_PRODUCT_IDS).toHaveLength(12);
    const plan = planVariantUpdates([
      rec({ product_id: 'lcw-1', colors: [{ name: 'A', url: 'u' }], sizes: [{ label: '1' }, { label: '2' }] }),
      rec({ product_id: manual, colors: [{ name: 'B', url: 'u' }], sizes: [{ label: '1' }] }),
      rec({ product_id: 'flo-9', found: false, error: 'http_404' }),
      rec({ product_id: 'flo-8', found: false }),
    ]);
    expect(plan.updates.map((u) => u.id)).toEqual(['lcw-1', 'flo-8']);
    expect(plan.skippedManualReview).toBe(1);
    expect(plan.skippedErrors).toBe(1);
    expect(plan.colorCount).toBe(1);
    expect(plan.sizeCount).toBe(2);
    expect(plan.updates[1].values.color_variants).toBeNull();
  });
});
