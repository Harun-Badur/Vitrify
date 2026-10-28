import audit from './fixtures/genderOverwriteAudit.json';
import { computeCatalogEnrichment, mergeAttribute, type EnrichmentProductInput } from '../lib/catalogEnrichment';
import { inferColorsFromText } from '../lib/productAttributes';

// Test-only rows; never written to any database.
const product = (overrides: Partial<EnrichmentProductInput> = {}): EnrichmentProductInput => ({
  id: 'p-1', title: 'Örnek Ürün', brand: 'Fixture', category: 'upper_body', product_url: null,
  price: 100, current_price: null, image_url: 'https://example.invalid/p-1.jpg', gender: null, ...overrides,
});
const stored = (overrides: Partial<{ colors: unknown; fit: string | null; subcategory: string | null; gender: string | null }> = {}) =>
  ({ colors: [], fit: null, subcategory: null, gender: null, ...overrides });

describe('mergeAttribute', () => {
  it('keeps the existing value when the inference is unknown or empty', () => {
    for (const empty of [null, undefined, '', 'bilinmiyor']) {
      expect(mergeAttribute('erkek', empty)).toEqual({ value: 'erkek', review: null });
    }
    expect(mergeAttribute(['siyah'], [])).toEqual({ value: ['siyah'], review: null });
  });

  it('takes the inference when nothing is stored, without a review', () => {
    expect(mergeAttribute(null, 'kadin')).toEqual({ value: 'kadin', review: null });
    expect(mergeAttribute([], ['siyah'])).toEqual({ value: ['siyah'], review: null });
  });

  it('lets a different inference win but marks it for review', () => {
    expect(mergeAttribute('erkek', 'unisex')).toEqual({ value: 'unisex', review: { from: 'erkek', to: 'unisex' } });
    expect(mergeAttribute(['siyah', 'mavi'], ['siyah'])).toEqual({ value: ['siyah'], review: { from: 'siyah|mavi', to: 'siyah' } });
  });

  it('treats the same colors in another order as unchanged', () => {
    expect(mergeAttribute(['mavi', 'siyah'], ['siyah', 'mavi'])).toEqual({ value: ['mavi', 'siyah'], review: null });
  });

  it('never turns a known value into unknown, whatever the inputs', () => {
    for (const existing of ['kadin', 'erkek', 'unisex', 'tisort']) {
      for (const inferred of [null, undefined, '', 'bilinmiyor', 'kadin', 'cocuk']) {
        expect(mergeAttribute(existing, inferred).value).toBeTruthy();
      }
    }
  });
});

describe('computeCatalogEnrichment merge', () => {
  it('starts gender from the stored product_attributes value (women/men/unisex -> kadin/erkek/unisex)', () => {
    const base = product({ title: 'Basic Tişört', category: 'upper_body' });
    expect(computeCatalogEnrichment(base, stored({ gender: 'women' })).gender).toBe('kadin');
    expect(computeCatalogEnrichment(base, stored({ gender: 'men' })).gender).toBe('erkek');
    expect(computeCatalogEnrichment(base, stored({ gender: 'unisex' })).gender).toBe('unisex');
    expect(computeCatalogEnrichment(base, stored()).gender).toBeNull();
  });

  it('prefers the already written products.gender over the legacy attribute', () => {
    const result = computeCatalogEnrichment(product({ title: 'Basic Tişört', gender: 'erkek' }), stored({ gender: 'women' }));
    expect(result.gender).toBe('erkek');
  });

  it('flags a gender change for review instead of silently replacing it', () => {
    const result = computeCatalogEnrichment(product({ title: 'Kadın Siyah Tişört' }), stored({ gender: 'men', subcategory: 'tisort', colors: ['siyah'] }));
    expect(result.gender).toBe('kadin');
    expect(result.review).toEqual([{ field: 'gender', from: 'erkek', to: 'kadin' }]);
  });

  it('computes feed_eligible from the merged values', () => {
    // The title alone gives no gender, subtype or color; the stored values complete the record.
    const result = computeCatalogEnrichment(product({ title: 'Basic Ürün' }),
      stored({ gender: 'women', subcategory: 'tisort', colors: ['siyah'] }));
    expect(result).toMatchObject({ feedEligible: true, eligibilityMissing: [], subcategory: 'tisort', colors: ['siyah'] });
    expect(computeCatalogEnrichment(product({ title: 'Basic Ürün' }), stored()).eligibilityMissing)
      .toEqual(['gender', 'alt_tur', 'renk']);
  });

  it('does not let the category default replace a stored subtype, and fills only when empty', () => {
    const lower = product({ title: 'Erkek Slim Model', category: 'lower_body' });
    expect(computeCatalogEnrichment(lower, stored({ subcategory: 'jean' })))
      .toMatchObject({ subcategory: 'jean', review: [] });
    expect(computeCatalogEnrichment(lower, stored()).subcategory).toBe('pantolon');
  });

  it('keeps a stored fit and color when the title is silent', () => {
    const result = computeCatalogEnrichment(product({ title: 'Kadın Tişört' }), stored({ fit: 'slim', colors: ['bej'] }));
    expect(result).toMatchObject({ fit: 'slim', colors: ['bej'], review: [] });
    expect(result.changed).toEqual({ colors: false, subcategory: true, fit: false });
  });
});

describe('the 15 stored genders the old preview turned into bilinmiyor', () => {
  const expected: Record<string, string> = {
    'hepsiburada-HBCV0000CYITMK': 'unisex', // title silent: stored unisex survives
    'hepsiburada-HBCV0000FG17PA': 'kadin', // pareo_default
    'lcw-4868475': 'kadin', // skirt_default
    'lcw-4885993': 'kadin',
    'lcw-5114921': 'kadin',
    'lcw-5130015': 'kadin', // topuklu / abiye default
    'lcw-5141124': 'erkek', // portföy çantası: no evidence, stored erkek survives
    'lcw-5141130': 'erkek',
    'lcw-5142098': 'erkek',
    'lcw-5182282': 'kadin',
    'lcw-5215694': 'kadin',
    'lcw-5495414': 'erkek',
    'lcw-5534040': 'kadin', // baget çanta
    'lcw-5592980': 'kadin', // accessory_neutral is low confidence: stored kadin stays
    'trendyol-929681071': 'erkek', // Takım Elbise: stored erkek survives
  };

  it('covers exactly the fixture rows', () => {
    expect(audit.rows).toHaveLength(15);
    expect(audit.rows.map(row => row.id).sort()).toEqual(Object.keys(expected).sort());
  });

  it.each(audit.rows)('$id keeps a known gender', row => {
    const result = computeCatalogEnrichment(
      product({ id: row.id, title: row.title, category: row.category }),
      stored({ gender: row.storedGender }),
    );
    expect(result.gender).not.toBeNull();
    expect(result.gender).toBe(expected[row.id]);
  });

  it('flags none of them for review: only a high-confidence title token may change a stored gender', () => {
    const reviewed = audit.rows.filter(row => computeCatalogEnrichment(
      product({ id: row.id, title: row.title, category: row.category }), stored({ gender: row.storedGender }),
    ).review.some(entry => entry.field === 'gender')).map(row => row.id);
    expect(reviewed).toEqual([]);
  });

  it('medium rules fill an empty gender but never replace a stored one; a silent accessory stays unknown', () => {
    const kemer = product({ title: 'Mara Tokalı Kemer Kahverengi', category: 'accessories' });
    expect(computeCatalogEnrichment(kemer, stored({ gender: 'women' }))).toMatchObject({ gender: 'kadin', review: [] });
    // Rule v3: no gender word means no gender; unisex is never assumed.
    expect(computeCatalogEnrichment(kemer, stored())).toMatchObject({ gender: null, review: [], feedEligible: false });
    const etek = product({ title: 'Saten Etek', category: 'lower_body' });
    expect(computeCatalogEnrichment(etek, stored({ gender: 'men' })).gender).toBe('erkek');
    expect(computeCatalogEnrichment(etek, stored()).gender).toBe('kadin');
  });
});

describe('brand Mavi and shape words', () => {
  it('does not read the Mavi brand in the title as the color blue; the stored color survives', () => {
    expect(inferColorsFromText('Mavi Erkek Jean', 'Mavi')).toEqual([]);
    expect(inferColorsFromText('Erkek Garrett Mavi Edition Ekru Keten Jean Şort', 'MAVİ')).toEqual(['bej']);
    expect(inferColorsFromText('Mavi Kadın Adriana Siyah Jean Pantolon', 'Mavi Jeans')).toEqual(['siyah']);
    const result = computeCatalogEnrichment(
      product({ id: 'trendyol-831507713', title: 'Mavi Erkek Jean', brand: 'Mavi', category: 'lower_body' }),
      stored({ colors: ['mavi'], gender: 'men', subcategory: 'jean' }));
    expect(result).toMatchObject({ colors: ['mavi'], gender: 'erkek', review: [], changed: { colors: false } });
  });

  it('keeps a stored mavi next to a title color for a Mavi product', () => {
    const result = computeCatalogEnrichment(
      product({ title: 'Mavi Kadın Adriana Siyah Jean Pantolon', brand: 'Mavi', category: 'lower_body' }),
      stored({ colors: ['siyah', 'mavi'], gender: 'women', subcategory: 'jean' }));
    expect(result.colors).toEqual(['siyah', 'mavi']);
    expect(result.review).toEqual([]);
  });

  it('still reads blue for other brands', () => {
    expect(inferColorsFromText('Koton Mavi Kadın Elbise', 'Boyner')).toEqual(['mavi']);
    expect(inferColorsFromText('Mavi Kadın Elbise', null)).toEqual(['mavi']);
  });

  it('a Yarım Balıkçı Yaka tişört stays a tişört', () => {
    const result = computeCatalogEnrichment(
      product({ title: 'Kadın Standart Fit Kısa Kollu Yarım Balıkçı Yaka Siyah Tişört' }), stored({ subcategory: 'tisort' }));
    expect(result).toMatchObject({ subcategory: 'tisort', gender: 'kadin', review: [] });
  });

  it('a Yarım Balıkçı Yaka bluz moves from the wrong stored tisort to bluz and is flagged', () => {
    const result = computeCatalogEnrichment(
      product({ id: 'trendyol-951326392', title: 'Tudors Kadın Standart Fit Kısa Kollu Yarım Balıkçı Yaka Siyah Bluz' }),
      stored({ subcategory: 'tisort', colors: ['siyah'], gender: 'women' }));
    expect(result.subcategory).toBe('bluz');
    expect(result.review).toEqual([{ field: 'alt_tur', from: 'tisort', to: 'bluz' }]);
  });
});
