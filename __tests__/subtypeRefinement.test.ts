import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ENRICHMENT_ATTRIBUTE_VERSION,
  computeCatalogEnrichment,
  mergeAttribute,
  mergeSubcategory,
  type EnrichmentProductInput,
} from '../lib/catalogEnrichment';
import { inferSubcategory, matchSubcategoryFromTitle } from '../lib/productAttributes';
import {
  SUBTYPES,
  isValidSubtype,
  subtypesForCategory,
  toCatalogSubtype,
} from '../lib/styleVocabulary';
import { PAIRING_EVIDENCE_POLICY_V1 } from '../src/intelligence/pairing/pairingPolicy';

// Faz 4 S2b: `ceket` is split into mont / kaban / trenckot (blazer already had its own slug).

const upper = (title: string) => matchSubcategoryFromTitle(title, 'upper_body');

describe('rule version', () => {
  it('is 4', () => {
    expect(ENRICHMENT_ATTRIBUTE_VERSION).toBe(4);
  });
});

describe('title rules for the refined outerwear subtypes', () => {
  it.each([
    ['Erkek Siyah Şişme Mont', 'mont'],
    ['Kadın Kaban', 'kaban'],
    ['Erkek Palto Kaban Lacivert', 'kaban'],
    ['Kadın Bej Trençkot', 'trenckot'],
    ['Erkek Slim Fit Blazer Ceket', 'blazer'],
    ['Erkek Takım Elbise', 'blazer'],
    ['Erkek Deri Ceket', 'ceket'],
    ['Freecamp Softshell Erkek', 'ceket'],
    ['Rüzgarlık Jacket', 'ceket'],
  ])('%s -> %s', (title, expected) => {
    expect(upper(title)).toBe(expected);
  });

  it('matches whole words, not words that merely contain the key', () => {
    // Embedded/suffixed forms never get the specific slug (legacy start-of-word `ceket` is unchanged).
    expect(upper('Montaj Detaylı Üst')).not.toBe('mont');
    expect(upper('Kabanoz Tişört')).not.toBe('kaban');
    expect(upper('Trençkotlu Üst')).not.toBe('trenckot');
  });

  it('keeps the legacy start-of-word match as the uncertain `ceket`, never as unknown', () => {
    expect(upper('Montlu Kadın Üst')).toBe('ceket');
    expect(upper('Kabanlı Üst')).toBe('ceket');
    expect(upper('Trençkotu Kadın')).toBe('ceket');
  });

  it('does not read the new outerwear words in non-garment or lower-body titles', () => {
    // Legacy behavior (the uncertain `ceket` rule) is untouched; the new slugs are upper_body only.
    expect(matchSubcategoryFromTitle('Mont Detaylı Pantolon', 'lower_body')).not.toBe('mont');
    expect(matchSubcategoryFromTitle('Kaban Desenli Çanta', 'bags')).toBe('');
    expect(matchSubcategoryFromTitle('Trençkot Rengi Atkı', 'accessories')).toBe('');
  });

  it('leaves non-outerwear titles unchanged', () => {
    expect(upper('Kadın Siyah Oversize Tişört')).toBe('tisort');
    expect(upper('Kapüşonlu SWEATSHIRT')).toBe('hoodie');
    expect(upper('Erkek Kot Pantolon')).toBe('jean');
  });
});

describe('merge rule for the refinement', () => {
  const enrich = (title: string, subcategory: string | null, extra: Partial<EnrichmentProductInput> = {}) =>
    computeCatalogEnrichment(
      { id: 'p', title, brand: 'X', category: 'upper_body', product_url: null, price: 100, current_price: null,
        image_url: 'https://example.invalid/p.jpg', gender: 'erkek', ...extra },
      { colors: ['siyah'], fit: null, subcategory, gender: null },
    );

  it('refines a stored ceket without marking it for review', () => {
    const result = enrich('Erkek Siyah Şişme Mont', 'ceket');
    expect(result.subcategory).toBe('mont');
    expect(result.changed.subcategory).toBe(true);
    expect(result.review).toEqual([]);
  });

  it('refines ceket to every new slug', () => {
    for (const [title, slug] of [['Erkek Mont', 'mont'], ['Erkek Kaban', 'kaban'], ['Erkek Trençkot', 'trenckot'], ['Erkek Blazer', 'blazer']] as const) {
      expect(mergeSubcategory('ceket', slug)).toEqual({ value: slug, review: null });
      expect(enrich(title, 'ceket').subcategory).toBe(slug);
    }
  });

  it('never replaces a refined value with the less specific ceket', () => {
    for (const refined of ['mont', 'kaban', 'trenckot', 'blazer']) {
      expect(mergeSubcategory(refined, 'ceket')).toEqual({ value: refined, review: null });
    }
    expect(enrich('Montlu Üst', 'mont').subcategory).toBe('mont');
  });

  it('still reports a real contradiction for review and never turns a known value unknown', () => {
    expect(mergeSubcategory('tisort', 'mont')).toEqual({ value: 'mont', review: { from: 'tisort', to: 'mont' } });
    expect(mergeSubcategory('mont', 'kaban')).toEqual({ value: 'kaban', review: { from: 'mont', to: 'kaban' } });
    for (const known of ['ceket', 'mont', 'kaban', 'trenckot', 'blazer']) {
      for (const unknown of [null, undefined, '']) expect(mergeSubcategory(known, unknown).value).toBe(known);
    }
    expect(mergeSubcategory(null, 'mont')).toEqual({ value: 'mont', review: null });
  });

  it('is the generic merge for every other attribute', () => {
    expect(mergeAttribute('erkek', 'unisex').review).not.toBeNull();
  });

  it('keeps a stored subtype when the title has no keyword', () => {
    expect(enrich('Örnek Ürün', 'ceket').subcategory).toBe('ceket');
  });
});

describe('wardrobe vocabulary accepts the new slugs and keeps ceket', () => {
  it('lists mont, kaban and trenckot beside ceket and blazer', () => {
    const slugs = subtypesForCategory('upper_body').map(item => item.slug);
    expect(slugs).toEqual(expect.arrayContaining(['ceket', 'blazer', 'mont', 'kaban', 'trenckot']));
    for (const slug of ['ceket', 'blazer', 'mont', 'kaban', 'trenckot']) expect(isValidSubtype('upper_body', slug)).toBe(true);
  });

  it('gives every new slug complete season and formality attributes in the outer-layer slot', () => {
    for (const slug of ['mont', 'kaban', 'trenckot']) {
      const entry = SUBTYPES.upper_body.find(item => item.slug === slug)!;
      expect(entry.slot).toBe('dis_giyim');
      expect(entry.formality).toBeGreaterThanOrEqual(1);
      expect(entry.season).toBeDefined();
    }
  });

  it('maps wardrobe slugs to catalog slugs that the title rules infer for the same product', () => {
    for (const slug of ['mont', 'kaban', 'trenckot', 'blazer', 'ceket']) {
      expect(toCatalogSubtype('upper_body', slug)).toBe(slug);
    }
    for (const slug of ['mont', 'kaban', 'trenckot']) {
      const label = SUBTYPES.upper_body.find(item => item.slug === slug)!.label;
      expect(inferSubcategory(label, 'upper_body')).toBe(slug);
    }
  });

  it('accepts the new slugs in the cloud wardrobe payload', () => {
    const source = readFileSync(join(__dirname, '..', 'services/wardrobeCloudPersistence.ts'), 'utf8');
    expect(source).toMatch(/isValidSubtype\(item\.category, item\.subcategory\)/);
  });
});

describe('pairing evidence knows the new slugs', () => {
  const { seasonBySubtype, formalityBySubtype } = PAIRING_EVIDENCE_POLICY_V1;

  it('reports cold season for mont and kaban and formality for kaban', () => {
    expect(seasonBySubtype.mont).toBe('cold');
    expect(seasonBySubtype.kaban).toBe('cold');
    expect(formalityBySubtype.kaban).toBe('formal');
  });

  it('leaves unclear dimensions unknown (trenckot season, mont and ceket formality)', () => {
    expect(seasonBySubtype.trenckot).toBeUndefined();
    expect(seasonBySubtype.ceket).toBeUndefined();
    expect(formalityBySubtype.mont).toBeUndefined();
    expect(formalityBySubtype.ceket).toBeUndefined();
  });

  it('agrees with the style vocabulary for every subtype it maps', () => {
    const all = Object.values(SUBTYPES).flat();
    for (const [slug, season] of Object.entries(seasonBySubtype)) {
      const entry = all.find(item => item.slug === slug)!;
      expect(entry.season).toBe(season === 'cold' ? 'soguk' : 'sicak');
    }
    for (const [slug, formality] of Object.entries(formalityBySubtype)) {
      const entry = all.find(item => item.slug === slug)!;
      if (formality === 'formal') expect(entry.formality).toBeGreaterThanOrEqual(4);
      else expect(entry.formality).toBe(1);
    }
  });
});
