import * as attributes from '../lib/productAttributes';
import { catalogMetadataRepair, cleanDeclaredCatalogColors, declaredCatalogFit, declaredCatalogGender, P0_CATALOG_REPAIRS } from '../lib/catalogMetadata';
import { enrichProduct, preparedProductAttributes, type ProductAttributeRow } from '../src/intelligence/style/productStyle';
import { hasHardConflict, isValidOutfitItems } from '../src/intelligence/outfits/outfitCandidate';
import { catalogCompatibility } from '../src/intelligence/outfits/catalogCompatibility';
import { getDiscoverRecommendations } from '../src/intelligence/recommendations/getDiscoverRecommendations';
import { filterProducts } from '../src/intelligence/filters/productFilters';
import { toScoringCandidate } from '../src/intelligence/ranking/productCandidate';
import { attrsFromProduct } from '../lib/sessionIntent';
import { matchesHardConstraints, emptySessionIntent } from '../lib/scoring';
import type { Product, OutfitRole } from '../types/product';

const product = (id: string, title: string, category: Product['category'] = 'upper_body'): Product => ({
  id, title, category, brand: 'Example', price: 100, imageUrl: 'https://example.com/image.jpg', garmentDescription: title,
});
const attr = (id: string, patch: Partial<ProductAttributeRow> = {}): ProductAttributeRow => ({
  product_id: id, gender: null, colors: [], fit: null, subcategory: null, brand_slug: null, price_band: null, ...patch,
});

it.each([
  ['Hakiki Deri Kemer', []], ['HAKİKİ DERİ BOT', []], ['Hakim Yaka Elbise', []],
  ['Memory Foam Ayakkabı', []], ['Altınyıldız Beyaz Gömlek', ['beyaz']],
  ['Tapered Fit Jean', []], ['tasarım harikaları Şapka', []], ['Mora Örgü Atkı', []],
  ['Desenli Çiçekli Çizgili Floral Bluz', []],
  ['Siyah, WHITE / HAKİ ve Kırmızı', ['siyah', 'beyaz', 'kirmizi', 'yesil']],
  ['Blackberry black Siyahı siyah', ['siyah']],
])('extracts only actual color words from %s', (title, expected) => {
  expect(attributes.inferColorsFromText(title)).toEqual(expected);
});

it('excludes brand evidence while retaining explicit variant color names', () => {
  expect(attributes.inferColorsFromText('Mavi Erkek Jean', 'Mavi')).toEqual([]);
  expect(attributes.inferColorsFromText('Mora Örgü Atkı', 'Mora Örgü')).toEqual([]);
  expect(attributes.inferProductAttributes({ title: 'Mavi Erkek Jean', brand: 'Mavi', price: 100,
    category: 'lower_body', existingColorNames: ['Siyah'] }).colors).toEqual(['siyah']);
});

it('repairs legacy color errors at enrichment without dropping unrelated declared colors', () => {
  expect(cleanDeclaredCatalogColors('trendyol-83134151', ['beyaz', 'altin', 'desenli'])).toEqual(['beyaz']);
  expect(cleanDeclaredCatalogColors('other', ['yesil'])).toEqual(['yesil']);
  expect(cleanDeclaredCatalogColors('other', ['DESENLİ', 'unknown', '', null])).toEqual([]);
  const stale = attr('trendyol-889961099', { colors: ['mor', 'desenli'] });
  const loaded = enrichProduct(product(stale.product_id, 'Lumberjack Memory Foam Ayakkabı', 'shoes'), stale);
  expect(loaded.colorSlugs).toEqual([]);
  expect(stale.colors).toEqual(['mor', 'desenli']);
  expect(enrichProduct(product('pattern', 'Desenli Bluz'), attr('pattern', { colors: ['desenli'] })).colorSlugs).toEqual([]);
});

it('keeps unknown gender and fit empty, retaining explicit unisex/regular evidence', () => {
  expect(attributes.inferGenderFromTitle('Örnek Ürün')).toBeUndefined();
  expect(attributes.inferFitFromTitle('Örnek Ürün')).toBe('');
  expect(attributes.inferGenderFromTitle('Unisex Sneaker')).toBe('unisex');
  expect(attributes.inferGenderFromTitle('Uniseks Gözlük')).toBe('unisex');
  expect(attributes.inferFitFromTitle('Regular Fit Tişört')).toBe('regular');
  const unknown = enrichProduct(product('unknown', 'Örnek Ürün'), attr('unknown'));
  expect(unknown.gender).toBe('');
  expect(unknown.fit).toBe('');
  expect(toScoringCandidate(unknown)).toMatchObject({ gender: '', fit: '' });
  expect(attrsFromProduct(unknown)).toMatchObject({ gender: '', fit: '' });
  const other = enrichProduct(product('other', 'Örnek Ürün'), undefined);
  expect(catalogCompatibility(unknown, other).fit).toBe(0);
  expect(filterProducts([unknown], { gender: 'women' })).toEqual([]);
  expect(matchesHardConstraints(toScoringCandidate(unknown), {
    ...emptySessionIntent(), constraints: { category: null, gender: 'women', size: null },
  })).toBe(false);
  const explicit = enrichProduct(product('explicit', 'Örnek Ürün'), attr('explicit', { gender: 'unisex', fit: 'regular' }));
  expect(explicit).toMatchObject({ gender: 'unisex', fit: 'regular' });
});

it.each([
  ['boyner-15772029', 'Erkek Taba Uzun Kollu Gömlek Yaka Süet Ceket', 'upper_body', null, 'ceket', 'outerwear', 'ceket'],
  ['trendyol-367600412', 'Polo Exchange 1021 C1 60 Polarize Güneş Gözlüğü', 'accessories', 'accessory', 'polo', 'accessory', 'gozluk'],
  ['trendyol-736813153', 'Polo Exchange POLARİZE GÜNEŞ GÖZLÜĞÜ', 'accessories', 'accessory', 'polo', 'accessory', 'gozluk'],
  ['hepsiburada-HBCV0000H0CMNI', 'Yazlık Etek Kombinleri | Etek Modelleri 2026 - Etek Ceket Takımı', 'lower_body', 'bottom', 'ceket', 'bottom', 'etek'],
] as const)('repairs %s before generation and permits a complete valid outfit', (id, title, category, role, subtype, expectedRole, expectedSubtype) => {
  // Faz 4 S3b: complements need a known gender; the repair under test is role/subtype only.
  const row = attr(id, { outfit_role: role, subcategory: subtype, gender: 'men' });
  const loaded = enrichProduct(product(id, title, category), row);
  expect(loaded).toMatchObject({ outfitRole: expectedRole, subcategory: expectedSubtype });
  expect(row).toMatchObject({ outfit_role: role, subcategory: subtype });
  expect(hasHardConflict([{ sourceType: 'catalog', sourceId: id, role: expectedRole, product: loaded }])).toBe(false);
  const core = (['top', 'bottom', 'shoes'] as OutfitRole[]).filter(r => r !== expectedRole).map(r => ({
    ...product(r, r, r === 'bottom' ? 'lower_body' : r === 'shoes' ? 'shoes' : 'upper_body'), outfitRole: r, gender: 'men' as const,
  }));
  const recommendations = getDiscoverRecommendations({ wardrobeItems: [], catalogProducts: [loaded, ...core],
    requiredCatalogProductId: id, firstOnly: true });
  expect(recommendations.length).toBeGreaterThan(0);
  expect(isValidOutfitItems(recommendations[0].candidate.items)).toBe(true);
});

it('limits subtype repairs to the four P0 IDs and leaves generic inference unchanged', () => {
  expect(Object.keys(P0_CATALOG_REPAIRS)).toHaveLength(4);
  expect(catalogMetadataRepair('defacto-3287863')).toBeUndefined();
  const row = attr('other', { subcategory: 'polo', outfit_role: 'accessory' });
  expect(enrichProduct(product('other', 'Polo Gözlük', 'accessories'), row).subcategory).toBe('polo');
  expect(row.subcategory).toBe('polo');
  expect(attributes.inferSubcategory('Örnek Ürün', 'upper_body')).toBeUndefined();
});

it('prepares once and performs no metadata extraction inside repeated recommendation runs', () => {
  const pool = [enrichProduct(product('top', 'Kadın Siyah Regular Fit Tişört'), attr('top', { outfit_role: 'top' })),
    enrichProduct(product('bottom', 'Kadın Siyah Regular Fit Pantolon', 'lower_body'), attr('bottom', { outfit_role: 'bottom' })),
    enrichProduct(product('shoes', 'Kadın Siyah Ayakkabı', 'shoes'), attr('shoes', { outfit_role: 'shoes' }))];
  pool.push(enrichProduct(product('unknown', 'Örnek Ürün'), attr('unknown')));
  const gender = jest.spyOn(attributes, 'inferGenderFromTitle');
  const infer = jest.spyOn(attributes, 'inferProductAttributes');
  const colors = jest.spyOn(attributes, 'inferColorsFromText');
  try {
    for (let i = 0; i < 3; i++) {
      getDiscoverRecommendations({ wardrobeItems: [], catalogProducts: pool, requiredCatalogProductId: 'top', firstOnly: true, catalogFilters: { gender: 'women' } });
      expect(preparedProductAttributes(pool[0])).toBe(preparedProductAttributes(pool[0]));
    }
    expect(gender).not.toHaveBeenCalled();
    expect(infer).not.toHaveBeenCalled();
    expect(colors).not.toHaveBeenCalled();
  } finally { gender.mockRestore(); infer.mockRestore(); colors.mockRestore(); }
});

it('normalizes missing server metadata without fabricated gender or fit', () => {
  for (const value of [null, undefined, '', 'unknown']) {
    expect(declaredCatalogGender(value)).toBe('');
    expect(declaredCatalogFit(value)).toBe('');
  }
  expect(declaredCatalogGender('unisex')).toBe('unisex');
  expect(declaredCatalogFit('regular')).toBe('regular');
  expect(enrichProduct(product('invalid', 'Örnek Ürün'), attr('invalid', { gender: 'unknown', fit: 'unknown' })))
    .toMatchObject({ gender: '', fit: '' });
});
