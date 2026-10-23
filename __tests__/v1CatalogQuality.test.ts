import { buildVerifiedColorPatch, summarizeV1Catalog } from '../scripts/lib/v1CatalogQuality';

const product = { id: 'fixture', title: 'Verified shirt', image_url: 'https://example.invalid/a.jpg',
  product_url: 'https://example.invalid/product', brand: null, category: 'upper_body', provider: 'lcw', price: 100 };
const review = { product_id: 'fixture', title: product.title, image_url: product.image_url,
  review_status: 'onaylandı', approved_color_slugs: 'mavi', reviewer_note: 'Previously approved source decision' };

test('only fills missing colors from matching approved evidence, never from a title', () => {
  const prepared = buildVerifiedColorPatch([product], [{ product_id: 'fixture', colors: [], gender: null }], [review]);
  expect(prepared.patches).toEqual([expect.objectContaining({ product_id: 'fixture', colors: ['mavi'], expected_colors: [] })]);
  const report = summarizeV1Catalog([product], [{ product_id: 'fixture', colors: [], gender: null }]);
  expect(report.missing).toMatchObject({ brand: 1, gender: 1, colors: 1, styleTags: 1 });
});

test('keeps populated metadata and rejects stale, ambiguous, or unapproved decisions', () => {
  expect(buildVerifiedColorPatch([product], [{ product_id: 'fixture', colors: ['siyah'] }], [review]).conflicts).toHaveLength(1);
  for (const input of [{ ...review, review_status: '' }, { ...review, title: 'Changed title' },
    { ...review, image_url: 'https://example.invalid/changed.jpg' }, { ...review, approved_color_slugs: 'imaginary' }]) {
    expect(buildVerifiedColorPatch([product], [{ product_id: 'fixture', colors: [] }], [input]).patches).toEqual([]);
  }
});

test('is idempotent and does not fabricate missing attributes or styles', () => {
  const first = buildVerifiedColorPatch([product], [{ product_id: 'fixture', colors: [] }], [review]);
  const second = buildVerifiedColorPatch([product], first.patches, [review]);
  expect(second.patches).toEqual([]);
  expect(first.patches[0]).not.toHaveProperty('gender');
  expect(first.patches[0]).not.toHaveProperty('style_tags');
});

test('duplicate review IDs cannot result in two writes to the same product', () => {
  const plan = buildVerifiedColorPatch([product], [{ product_id: 'fixture', colors: [] }], [review, review]);
  expect(plan.patches).toEqual([]);
});
