import type { OutfitCandidateItem } from '../src/intelligence/outfits/outfitCandidate';
import { catalogCompatibility } from '../src/intelligence/outfits/catalogCompatibility';
import { hasHardConflict, isValidOutfitItems } from '../src/intelligence/pairing/outfitRules';
import { isCatalogPairEligible } from '../src/intelligence/recommendations/catalogPairing';
import type { OutfitRole, Product } from '../types/product';

let sequence = 0;
const make = (title: string, category: Product['category'], outfitRole: OutfitRole, over: Partial<Product> = {}): Product => ({
  id: `p${sequence++}`, title, category, outfitRole, gender: 'women', brand: 'Marka', price: 100,
  imageUrl: 'https://example.com/x.jpg', garmentDescription: title, colorSlugs: ['siyah'], ...over,
});
const item = (product: Product): OutfitCandidateItem =>
  ({ sourceType: 'catalog', sourceId: product.id, role: product.outfitRole!, product });

const heel = make('Butigo Siyah Kadın Topuklu Ayakkabı', 'shoes', 'shoes', { subcategory: 'ayakkabi' });
const capUnisex = make('adidas BB CAP Siyah Unisex Şapka', 'hats', 'hat', { subcategory: 'sapka', gender: 'unisex' });
const straw = make('Butigo Hasır Şapka Kadın Krem', 'hats', 'hat', { subcategory: 'sapka' });
const garamond = make('Garamond Siyah Erkek Klasik Ayakkabı', 'shoes', 'shoes', { subcategory: 'ayakkabi', gender: 'men' });
const shorts = make('Erkek Haki Keten Şort', 'lower_body', 'bottom', { subcategory: 'sort', gender: 'men' });
const trousers = make('Erkek Lacivert Pantolon', 'lower_body', 'bottom', { subcategory: 'pantolon', gender: 'men' });
const balloon = make('Siyah Beli Lastikli Kadın Balon Pantolon', 'lower_body', 'bottom', { subcategory: 'pantolon' });
const plain = make('Siyah Kadın Pantolon', 'lower_body', 'bottom', { subcategory: 'pantolon' });
const top = make('Beyaz Kadın Tişört', 'upper_body', 'top', { subcategory: 'tisort' });
const topMen = make('Beyaz Erkek Tişört', 'upper_body', 'top', { subcategory: 'tisort', gender: 'men' });

describe('isCatalogPairEligible with combo groups', () => {
  it('rejects classic shoes with shorts and heels with a sports cap, but keeps the neutral controls', () => {
    expect(isCatalogPairEligible(garamond, shorts)).toBe(false);
    expect(isCatalogPairEligible(shorts, garamond)).toBe(false);
    expect(isCatalogPairEligible(garamond, trousers)).toBe(true);
    expect(isCatalogPairEligible(heel, capUnisex)).toBe(false);
    expect(isCatalogPairEligible(heel, straw)).toBe(true);
  });

  it('keeps a weak pair eligible (a penalty, not a block)', () => {
    expect(isCatalogPairEligible(heel, balloon)).toBe(true);
  });

  it('treats a product with an unknown group exactly as before', () => {
    const plainHat = make('Erkek Lacivert Şapka', 'hats', 'hat', { subcategory: 'sapka', gender: 'men' });
    expect(isCatalogPairEligible(garamond, plainHat)).toBe(true);
  });
});

describe('hasHardConflict with combo groups', () => {
  it('flags a hard group pair anywhere in the outfit, whichever role is the anchor', () => {
    expect(hasHardConflict([item(topMen), item(shorts), item(garamond)])).toBe(true);
    expect(hasHardConflict([item(top), item(plain), item(heel), item(capUnisex)])).toBe(true);
    expect(isValidOutfitItems([item(top), item(plain), item(heel), item(capUnisex)])).toBe(false);
  });

  it('does not flag weak pairs, unknown groups or wardrobe items', () => {
    expect(hasHardConflict([item(top), item(balloon), item(heel)])).toBe(false);
    expect(hasHardConflict([item(topMen), item(trousers), item(garamond)])).toBe(false);
    const owned: OutfitCandidateItem = { sourceType: 'wardrobe', sourceId: 'w1', role: 'hat', wardrobeItem: { id: 'w1', category: 'hat' } };
    expect(hasHardConflict([item(top), item(plain), item(heel), owned])).toBe(false);
  });
});

describe('catalogCompatibility weak penalty', () => {
  it('lowers a weak pair by 0.2 against an otherwise identical neutral pair', () => {
    const neutral = catalogCompatibility(heel, plain);
    const weak = catalogCompatibility(heel, balloon);
    expect(weak.score).toBeCloseTo(neutral.score - 0.2, 10);
    expect(weak.color).toBe(neutral.color);
    expect(Object.keys(weak).sort()).toEqual(Object.keys(neutral).sort());
  });

  it('never goes below zero and leaves unknown and compatible pairs untouched', () => {
    const lowColor = make('Siyah Beli Lastikli Kadın Balon Pantolon', 'lower_body', 'bottom', { colorSlugs: ['kirmizi'] });
    const lowHeel = make('Butigo Mor Kadın Topuklu Ayakkabı', 'shoes', 'shoes', { colorSlugs: ['sari'] });
    expect(catalogCompatibility(lowHeel, lowColor).score).toBe(0);
    const unknownHat = make('Erkek Lacivert Şapka', 'hats', 'hat', { gender: 'men' });
    expect(catalogCompatibility(heel, unknownHat).score).toBeCloseTo(catalogCompatibility(heel, straw).score, 10);
  });

  it('is stable on repeated calls (memoized base, penalty outside the memo)', () => {
    expect(catalogCompatibility(heel, balloon).score).toBe(catalogCompatibility(heel, balloon).score);
  });
});
