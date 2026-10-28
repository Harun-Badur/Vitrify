import {
  computeCatalogEnrichment,
  ENRICHMENT_ATTRIBUTE_SOURCE,
  ENRICHMENT_ATTRIBUTE_VERSION,
  feedEligibilityMissing,
} from '../lib/catalogEnrichment';
import {
  buildBackfillBackup,
  formatBackfillPlan,
  parseBackfillArgs,
  planCatalogBackfill,
  planCatalogRollback,
  type BackfillAttributeRow,
  type BackfillProductRow,
} from '../scripts/lib/catalogBackfill';

// Test-only rows; never written to any database.
const product = (overrides: Partial<BackfillProductRow> = {}): BackfillProductRow => ({
  id: 'p-1', title: 'Kadın Siyah Oversize Tişört', brand: 'Fixture', category: 'upper_body',
  product_url: 'https://example.invalid/urun/p-1', price: 100, current_price: null,
  image_url: 'https://example.invalid/p-1.jpg',
  gender: null, feed_eligible: false, eligibility_missing: null, attribute_source: null, attribute_version: null,
  ...overrides,
});
const attributes = (overrides: Partial<BackfillAttributeRow> = {}): BackfillAttributeRow => ({
  product_id: 'p-1', colors: [], fit: null, subcategory: null, ...overrides,
});

describe('feed eligibility rule', () => {
  const complete = { category: 'upper_body', gender: 'kadin', subcategory: 'tisort', colors: ['siyah'],
    price: 100, imageUrl: 'https://example.invalid/a.jpg' };

  it('requires category, feed gender, subtype, color, price and image; fit is optional', () => {
    expect(feedEligibilityMissing(complete)).toEqual([]);
    expect(feedEligibilityMissing({ ...complete, category: 'socks', gender: 'cocuk', subcategory: null,
      colors: [], price: 0, imageUrl: ' ' })).toEqual(['kategori', 'gender', 'alt_tur', 'renk', 'fiyat', 'gorsel']);
    expect(feedEligibilityMissing({ ...complete, gender: null })).toEqual(['gender']);
    expect(feedEligibilityMissing({ ...complete, gender: 'unisex' })).toEqual([]);
  });
});

describe('computeCatalogEnrichment', () => {
  it('infers every field from the title through the shared rules', () => {
    const result = computeCatalogEnrichment(product(), attributes());
    expect(result).toMatchObject({ gender: 'kadin', colors: ['siyah'], subcategory: 'tisort', fit: 'oversized',
      feedEligible: true, eligibilityMissing: [],
      attributeSource: ENRICHMENT_ATTRIBUTE_SOURCE, attributeVersion: ENRICHMENT_ATTRIBUTE_VERSION });
  });

  it('keeps a stored value when the title gives no evidence and never stores bilinmiyor', () => {
    const result = computeCatalogEnrichment(product({ title: 'Basic Tişört', product_url: 'https://example.invalid/x' }),
      attributes({ colors: ['bej'], fit: 'slim' }));
    expect(result.colors).toEqual(['bej']);
    expect(result.fit).toBe('slim');
    expect(result.gender).toBeNull();
    expect(result.eligibilityMissing).toEqual(['gender']);
    expect(result.feedEligible).toBe(false);
  });

  it('stores cocuk but keeps it out of the feed', () => {
    const result = computeCatalogEnrichment(product({ title: 'Çocuk Siyah Tişört' }), attributes());
    expect(result.gender).toBe('cocuk');
    expect(result.feedEligible).toBe(false);
  });
});

describe('backfill plan and dry-run output', () => {
  const products = [
    product(),
    product({ id: 'p-2', title: 'Siyah Tişört', product_url: 'https://example.invalid/x' }),
    product({ id: 'p-3', title: 'Erkek Lacivert Slim Pantolon', category: 'lower_body', feed_eligible: true,
      gender: 'erkek', eligibility_missing: [], attribute_source: ENRICHMENT_ATTRIBUTE_SOURCE,
      attribute_version: ENRICHMENT_ATTRIBUTE_VERSION }),
  ];
  const stored = [
    attributes(),
    attributes({ product_id: 'p-2', colors: ['siyah'], subcategory: 'tisort' }),
    attributes({ product_id: 'p-3', colors: ['navy'], subcategory: 'pantolon', fit: 'slim' }),
  ];

  it('defaults to dry-run; only --apply writes', () => {
    expect(parseBackfillArgs([])).toEqual({ apply: false, verbose: false });
    expect(parseBackfillArgs(['--apply', '--verbose'])).toEqual({ apply: true, verbose: true });
    expect(() => parseBackfillArgs(['--force'])).toThrow('Bilinmeyen argüman');
  });

  it('plans only real changes and leaves unchanged rows alone', () => {
    const plan = planCatalogBackfill(products, stored);
    expect(plan.products.map(change => change.id)).toEqual(['p-1', 'p-2']);
    expect(plan.products[1].after).toEqual({ gender: null, feed_eligible: false, eligibility_missing: ['gender'],
      attribute_source: ENRICHMENT_ATTRIBUTE_SOURCE, attribute_version: ENRICHMENT_ATTRIBUTE_VERSION });
    expect(plan.attributes).toEqual([{ product_id: 'p-1', mode: 'update',
      before: { colors: [], fit: null, subcategory: null },
      patch: { colors: ['siyah'], subcategory: 'tisort', fit: 'oversized' } }]);
    expect(plan.summary).toMatchObject({ total: 3, eligible: 2, ineligible: 1, missing: { gender: 1 },
      productChanges: 2, attributeUpdates: 1, attributeInserts: 0 });
  });

  it('inserts an attribute row only when none exists', () => {
    const plan = planCatalogBackfill([product()], []);
    expect(plan.attributes).toEqual([{ product_id: 'p-1', mode: 'insert', before: null,
      patch: { colors: ['siyah'], subcategory: 'tisort', fit: 'oversized' } }]);
  });

  it('prints what it would do without writing', () => {
    const lines = formatBackfillPlan(planCatalogBackfill(products, stored), { apply: false, verbose: true });
    expect(lines[0]).toMatch(/^DRY-RUN/);
    expect(lines.join('\n')).toContain('Ürün: 3; feed_eligible=true: 2; elenen: 1');
    expect(lines.join('\n')).toContain('Eksik alan: gender 1');
    expect(lines.join('\n')).toContain('p-1: gender ∅→kadin; feed_eligible false→true');
    expect(lines.join('\n')).toContain('Gerçek yazma için --apply');
  });

  it('never prints the service role key', () => {
    const secret = 'fixture-service-role-secret';
    process.env.SUPABASE_SERVICE_ROLE_KEY = secret;
    try {
      const text = formatBackfillPlan(planCatalogBackfill(products, stored), { apply: true, verbose: true }).join('\n');
      expect(text).not.toContain(secret);
    } finally {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    }
  });

  it('backs up previous values and plans an exact rollback', () => {
    const plan = planCatalogBackfill([product(), product({ id: 'p-9' })],
      [attributes({ colors: ['bej'], fit: 'slim', subcategory: 'bluz' })]);
    const backup = buildBackfillBackup(plan, '2026-10-28T00:00:00.000Z');
    expect(backup.products[0]).toEqual({ id: 'p-1', gender: null, feed_eligible: false,
      eligibility_missing: null, attribute_source: null, attribute_version: null });
    expect(backup.attributes).toEqual([
      { product_id: 'p-1', existed: true, colors: ['bej'], fit: 'slim', subcategory: 'bluz' },
      { product_id: 'p-9', existed: false, colors: null, fit: null, subcategory: null },
    ]);
    const rollback = planCatalogRollback(backup);
    expect(rollback.products[0]).toEqual({ id: 'p-1', values: { gender: null, feed_eligible: false,
      eligibility_missing: null, attribute_source: null, attribute_version: null } });
    expect(rollback.attributes).toEqual([
      { product_id: 'p-1', mode: 'restore', values: { colors: ['bej'], fit: 'slim', subcategory: 'bluz' } },
      { product_id: 'p-9', mode: 'delete' },
    ]);
  });

  it('rejects a backup with an unknown format', () => {
    expect(() => planCatalogRollback({ format: 'other' } as never)).toThrow('Yedek biçimi tanınmadı');
  });
});
