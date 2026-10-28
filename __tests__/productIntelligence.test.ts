import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { inferSubcategory, matchSubcategoryFromTitle } from '../lib/productAttributes';
import {
  buildProductIntelligence,
  type ProductSemanticAttributeRow,
} from '../src/intelligence/product/productIntelligence';
import { enrichProduct } from '../src/intelligence/style/productStyle';
import type { Product } from '../types/product';
import type { ProductIntelligence, ProductSignal } from '../types/productIntelligence';

const product = (id: string, title: string, patch: Partial<Product> = {}): Product => ({
  id, title, category: 'upper_body', brand: 'Example', price: 100,
  imageUrl: 'https://example.com/image.jpg', garmentDescription: title, ...patch,
});
const attr = (id: string, patch: Partial<ProductSemanticAttributeRow> = {}): ProductSemanticAttributeRow => ({
  product_id: id, gender: null, colors: [], fit: null, subcategory: null, brand_slug: null, price_band: null, ...patch,
});
const UNKNOWN = { value: null, origin: 'unknown', source: 'unknown', confidence: 'unknown' } as const;
const values = (signals: readonly ProductSignal<string>[]): (string | null)[] => signals.map(item => item.value);
const codes = (intelligence: ProductIntelligence): string[] => intelligence.conflicts.map(item => item.code);

describe('buildProductIntelligence: missing data', () => {
  it('keeps every unsupported field unknown instead of defaulting', () => {
    const result = buildProductIntelligence({ product: product('p1', 'Örnek Ürün') });
    expect(result).toMatchObject({
      version: 1, productId: 'p1', category: 'upper_body',
      subtype: UNKNOWN, gender: UNKNOWN, fit: UNKNOWN,
      material: UNKNOWN, season: UNKNOWN, occasion: UNKNOWN,
      colors: [], styleTags: [], conflicts: [],
    });
    // Neither the pipeline nor the contract guesses a subtype any more.
    expect(inferSubcategory('Örnek Ürün', 'upper_body')).toBeUndefined();
  });

  it('marks category-derived roles as derived, with low confidence where top/outerwear is ambiguous', () => {
    expect(buildProductIntelligence({ product: product('p1', 'Örnek Ürün') }).role).toEqual({
      value: 'top', origin: 'derived', source: 'category_rule', confidence: 'low',
    });
    expect(buildProductIntelligence({ product: product('p2', 'Örnek', { category: 'shoes' }) }).role).toEqual({
      value: 'shoes', origin: 'derived', source: 'category_rule', confidence: 'medium',
    });
  });

  it('derives price band from a usable price and stays unknown otherwise', () => {
    expect(buildProductIntelligence({ product: product('p1', 'Örnek', { price: 2000 }) }).priceBand)
      .toEqual({ value: 'high', origin: 'derived', source: 'price_rule', confidence: 'high' });
    expect(buildProductIntelligence({ product: product('p2', 'Örnek', { price: 0 }) }).priceBand).toEqual(UNKNOWN);
  });
});

describe('buildProductIntelligence: declared vs derived', () => {
  it('labels declared attribute rows as declared with unknown confidence', () => {
    const result = buildProductIntelligence({
      product: product('p1', 'Kadın Siyah Regular Tişört'),
      attributes: attr('p1', { gender: 'women', fit: 'regular', colors: ['siyah'], subcategory: 'tisort', outfit_role: 'top', price_band: 'mid' }),
    });
    for (const field of [result.gender, result.fit, result.subtype, result.role, result.priceBand, ...result.colors]) {
      expect(field).toMatchObject({ origin: 'declared', source: 'catalog_attribute', confidence: 'unknown' });
    }
    expect(result.conflicts).toEqual([]);
  });

  it('labels title evidence as derived and low confidence', () => {
    const result = buildProductIntelligence({ product: product('p1', 'Erkek Oversize Gömlek') });
    expect(result.gender).toEqual({ value: 'men', origin: 'derived', source: 'title_inferred', confidence: 'low' });
    expect(result.fit).toMatchObject({ value: 'oversized', source: 'title_inferred' });
    expect(result.subtype).toMatchObject({ value: 'gomlek', source: 'title_inferred' });
  });

  it('separates retailer variant colors from title colors', () => {
    const result = buildProductIntelligence({
      product: product('p1', 'Beyaz Gömlek', { colors: [{ name: 'Siyah', hex: '#000000' }] }),
    });
    expect(result.colors).toEqual([
      { value: 'siyah', origin: 'declared', source: 'catalog_variant', confidence: 'medium' },
      { value: 'beyaz', origin: 'derived', source: 'title_inferred', confidence: 'low' },
    ]);
  });

  it('treats curated title overrides as high-confidence declared evidence', () => {
    const result = buildProductIntelligence({ product: product('p1', 'Erkek Kahverengi Polo Yaka Tişört') });
    expect(result.fit).toEqual({ value: 'slim', origin: 'declared', source: 'curated_title_override', confidence: 'high' });
    expect(result.subtype.value).toBe('polo');
    expect(values(result.colors)).toEqual(['kahverengi']);
  });

  it('applies P0 catalog repairs as the highest-confidence role and subtype', () => {
    const id = 'boyner-15772029';
    const result = buildProductIntelligence({
      product: product(id, 'Erkek Taba Uzun Kollu Gömlek Yaka Süet Ceket'),
      attributes: attr(id, { subcategory: 'ceket' }),
    });
    expect(result.role).toEqual({ value: 'outerwear', origin: 'declared', source: 'catalog_repair', confidence: 'high' });
    expect(result.subtype).toMatchObject({ value: 'ceket', source: 'catalog_repair' });
    expect(codes(result)).not.toContain('role_subtype_mismatch');
  });

  it('reads season, occasion, material and style tags only from declared columns', () => {
    const result = buildProductIntelligence({
      product: product('p1', 'Yazlık Plaj Minimal Keten Gömlek'),
      attributes: attr('p1', { season: ' yaz ', occasion: '', material: 'unknown', style_tags: ['minimal', 'Minimal', ' ', 'unknown', 5, 'klasik'] }),
    });
    expect(result.season).toEqual({ value: 'yaz', origin: 'declared', source: 'catalog_attribute', confidence: 'unknown' });
    expect(result.occasion).toEqual(UNKNOWN);
    expect(result.material).toEqual(UNKNOWN);
    expect(values(result.styleTags)).toEqual(['minimal', 'klasik']);
    const titleOnly = buildProductIntelligence({ product: product('p2', 'Yazlık Plaj Minimal Keten Gömlek') });
    expect(titleOnly).toMatchObject({ season: UNKNOWN, occasion: UNKNOWN, material: UNKNOWN, styleTags: [] });
  });
});

describe('buildProductIntelligence: conflicting and unknown metadata', () => {
  it('keeps declared values and reports title disagreement instead of correcting it', () => {
    const result = buildProductIntelligence({
      product: product('p1', 'Kadın Siyah Oversize Gömlek'),
      attributes: attr('p1', { gender: 'men', fit: 'slim', colors: ['beyaz'], subcategory: 'tisort' }),
    });
    expect(result.gender.value).toBe('men');
    expect(result.fit.value).toBe('slim');
    expect(values(result.colors)).toEqual(['beyaz']);
    expect(result.subtype.value).toBe('tisort');
    expect(result.conflicts).toEqual(expect.arrayContaining([
      { field: 'gender', code: 'declared_inferred_mismatch', values: ['men', 'women'] },
      { field: 'fit', code: 'declared_inferred_mismatch', values: ['slim', 'oversized'] },
      { field: 'colors', code: 'declared_inferred_mismatch', values: ['beyaz', 'siyah'] },
      { field: 'subtype', code: 'declared_inferred_mismatch', values: ['tisort', 'gomlek'] },
    ]));
  });

  it('reports unrecognized declared values and falls back only to real evidence', () => {
    const result = buildProductIntelligence({
      product: product('p1', 'Örnek Ürün'),
      attributes: attr('p1', { gender: 'kadın', fit: 'Tapered', colors: ['desenli', 'unknown', 'mavi'], outfit_role: 'jacket', price_band: 'premium' }),
    });
    expect(result.gender).toEqual(UNKNOWN);
    expect(result.fit).toEqual(UNKNOWN);
    expect(values(result.colors)).toEqual(['mavi']);
    expect(result.role).toMatchObject({ value: 'top', source: 'category_rule' });
    expect(result.priceBand.source).toBe('price_rule');
    expect(result.conflicts).toEqual([
      { field: 'role', code: 'declared_value_rejected', values: ['jacket'] },
      { field: 'gender', code: 'declared_value_rejected', values: ['kadın'] },
      { field: 'fit', code: 'declared_value_rejected', values: ['tapered'] },
      { field: 'colors', code: 'declared_value_rejected', values: ['desenli'] },
      { field: 'priceBand', code: 'declared_value_rejected', values: ['premium'] },
    ]);
  });

  it('treats unknown placeholders as missing without reporting a conflict', () => {
    const result = buildProductIntelligence({
      product: product('p1', 'Örnek Ürün'),
      attributes: attr('p1', { gender: 'unknown', fit: 'unknown', colors: ['unknown'], subcategory: 'unknown' }),
    });
    expect(result).toMatchObject({ gender: UNKNOWN, fit: UNKNOWN, subtype: UNKNOWN, colors: [], conflicts: [] });
  });

  it('keeps a declared role that contradicts the category and flags it', () => {
    const result = buildProductIntelligence({
      product: product('p1', 'Örnek Ürün'),
      attributes: attr('p1', { outfit_role: 'shoes' }),
    });
    expect(result.role.value).toBe('shoes');
    expect(result.conflicts).toContainEqual({ field: 'role', code: 'role_category_mismatch', values: ['shoes', 'upper_body'] });
  });

  it('flags a role that the subtype contradicts without changing either', () => {
    const result = buildProductIntelligence({ product: product('p1', 'Kadın Siyah Ceket') });
    expect(result.role.value).toBe('top');
    expect(result.subtype.value).toBe('ceket');
    expect(result.conflicts).toContainEqual({ field: 'role', code: 'role_subtype_mismatch', values: ['top', 'ceket'] });
  });
});

describe('buildProductIntelligence: suit / blazer ambiguity', () => {
  it('keeps the curated blazer subtype and still reports suit ambiguity', () => {
    const result = buildProductIntelligence({
      product: product('p1', 'Gri Çizgili Kruvaze Takım Elbise'),
    });
    expect(result.subtype).toMatchObject({ value: 'blazer', source: 'curated_title_override' });
    expect(result.conflicts).toContainEqual({ field: 'subtype', code: 'suit_blazer_ambiguity', values: ['blazer'] });
  });

  it('preserves the existing elbise match on an uncurated suit and reports every contradiction', () => {
    const result = buildProductIntelligence({ product: product('p1', 'Lacivert Takım Elbise') });
    expect(result.subtype).toMatchObject({ value: 'elbise', source: 'title_inferred', confidence: 'low' });
    expect(result.role.value).toBe('top');
    expect(result.conflicts).toEqual([
      { field: 'subtype', code: 'subtype_category_mismatch', values: ['elbise', 'upper_body'] },
      { field: 'role', code: 'role_subtype_mismatch', values: ['top', 'elbise'] },
      { field: 'subtype', code: 'suit_blazer_ambiguity', values: ['elbise'] },
    ]);
  });

  it('keeps a declared blazer subtype on a suit title', () => {
    const result = buildProductIntelligence({
      product: product('p1', 'Takim Elbise Ceketi'),
      attributes: attr('p1', { subcategory: 'blazer' }),
    });
    expect(result.subtype).toMatchObject({ value: 'blazer', source: 'catalog_attribute' });
    expect(codes(result)).toContain('suit_blazer_ambiguity');
  });
});

describe('buildProductIntelligence: purity', () => {
  it('is deterministic and never mutates inputs', () => {
    const base = product('p1', 'Kadın Siyah Oversize Gömlek', { colors: [{ name: 'Beyaz', hex: '#fff' }] });
    const row = attr('p1', { gender: 'men', colors: ['desenli', 'mavi'], style_tags: ['minimal'] });
    const before = JSON.stringify([base, row]);
    Object.freeze(base); Object.freeze(row);
    const first = buildProductIntelligence({ product: base, attributes: row });
    const second = buildProductIntelligence({ product: base, attributes: row });
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(JSON.stringify([base, row])).toBe(before);
  });

  it('agrees with enrichProduct wherever evidence exists', () => {
    const cases: [Product, ProductSemanticAttributeRow | undefined][] = [
      [product('a', 'Kadın Siyah Regular Fit Tişört'), undefined],
      [product('b', 'Kadın Siyah Oversize Gömlek'), attr('b', { gender: 'men', fit: 'slim', colors: ['beyaz'] })],
      [product('c', 'Erkek Kahverengi Polo Yaka Tişört'), undefined],
      [product('boyner-15772029', 'Erkek Süet Ceket'), attr('boyner-15772029')],
      [product('trendyol-83134151', 'Altın Kolye', { category: 'accessories' }), attr('trendyol-83134151', { colors: ['beyaz', 'altin'] })],
      [product('d', 'Beyaz Gömlek', { colors: [{ name: 'Siyah', hex: '#000' }] }), attr('d', { outfit_role: 'outerwear' })],
    ];
    for (const [base, row] of cases) {
      const enriched = enrichProduct(base, row);
      const result = buildProductIntelligence({ product: base, attributes: row });
      expect(result.role.value).toBe(enriched.outfitRole);
      expect(result.gender.value ?? '').toBe(enriched.gender);
      expect(result.fit.value ?? '').toBe(enriched.fit);
      expect(values(result.colors)).toEqual(enriched.colorSlugs);
      if (result.subtype.value) expect(result.subtype.value).toBe(enriched.subcategory);
    }
  });

  it('exposes title keyword evidence separately from category fallbacks', () => {
    expect(matchSubcategoryFromTitle('Örnek Ürün')).toBe('');
    expect(matchSubcategoryFromTitle('Kot Pantolon')).toBe('jean');
    expect(inferSubcategory('Örnek Ürün', 'lower_body')).toBe('pantolon');
    expect(inferSubcategory('Kot Pantolon', 'lower_body')).toBe('jean');
  });
});

describe('Product Intelligence boundary', () => {
  const root = join(__dirname, '..');
  const sourceFiles = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });

  it('is not wired into candidate generation, ranking, selection or display yet', () => {
    const importers = ['app', 'components', 'services', 'store', 'lib', 'hooks', 'src']
      .map(dir => join(root, dir))
      .filter(dir => existsSync(dir))
      .flatMap(sourceFiles)
      .filter(path => /productIntelligence/.test(readFileSync(path, 'utf8')))
      .map(path => relative(root, path).replace(/\\/g, '/'));
    // The evidence, user, style and compatibility modules remain unwired;
    // their boundary tests enforce the absence of app consumers.
    expect(importers).toEqual([
      'services/productRepository.ts',
      'src/intelligence/compatibility/compatibilityGate.ts',
      'src/intelligence/evidence/sharedEvidence.ts',
      'src/intelligence/product/productIntelligence.ts',
      'src/intelligence/style/styleContext.ts',
      'src/intelligence/user/userSnapshot.ts',
      'src/intelligence/user/userSnapshotSource.ts',
    ]);
  });

  it('lets the repository reference the attribute context types only', () => {
    const source = readFileSync(join(root, 'services/productRepository.ts'), 'utf8');
    const imports = source.split(/\r?\n/).filter(line => /productIntelligence/.test(line));
    expect(imports).toEqual([expect.stringMatching(/^import type \{[^}]+\} from '\.\.\/src\/intelligence\/product\/productIntelligence';$/)]);
    expect(source).not.toMatch(/buildProductIntelligence/);
  });
});
