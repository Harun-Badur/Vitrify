import type { OutfitRole, Product } from '../types/product';
import { getDiscoverRecommendations } from '../src/intelligence/recommendations/getDiscoverRecommendations';
import { complementaryProductsForDisplay } from '../src/intelligence/recommendations/complementaryProductsForDisplay';
import {
  hasHardConflict,
  isValidOutfitItems,
  type OutfitCandidateItem,
} from '../src/intelligence/outfits/outfitCandidate';

const CATEGORY_BY_ROLE: Readonly<Record<OutfitRole, Product['category']>> = {
  top: 'upper_body',
  outerwear: 'upper_body',
  bottom: 'lower_body',
  one_piece: 'dresses',
  shoes: 'shoes',
  bag: 'bags',
  hat: 'hats',
  accessory: 'accessories',
};

const DEFAULT_SUBCATEGORY: Readonly<Partial<Record<OutfitRole, string>>> = {
  top: 'tisort',
  outerwear: 'ceket',
  bottom: 'jean',
  one_piece: 'elbise',
  shoes: 'ayakkabi',
  accessory: 'aksesuar',
};

const product = (id: string, outfitRole: OutfitRole, extra: Partial<Product> = {}): Product => ({
  id, title: id, brand: 'Example', price: 1000, imageUrl: `https://example.com/${id}.jpg`,
  garmentDescription: id, gender: 'men', outfitRole, category: CATEGORY_BY_ROLE[outfitRole],
  subcategory: DEFAULT_SUBCATEGORY[outfitRole], ...extra,
});

const item = (value: Product): OutfitCandidateItem => ({
  sourceType: 'catalog', sourceId: value.id, role: value.outfitRole ?? 'accessory', product: value,
});

const visibleSet = (anchor: Product, pool: readonly Product[]): Product[] =>
  complementaryProductsForDisplay(getDiscoverRecommendations({ wardrobeItems: [],
    catalogProducts: [anchor, ...pool], requiredCatalogProductId: anchor.id, firstOnly: true }), anchor.id);

const OUTER_SUBTYPES = new Set(['ceket', 'blazer', 'mont', 'kaban', 'palto']);
const isOuterLayer = (value: Product): boolean => value.outfitRole === 'outerwear' ||
  (value.outfitRole === 'top' && OUTER_SUBTYPES.has(value.subcategory ?? ''));

/** Structural expectations of a visible Discover set, stated independently of the implementation. */
const expectStructurallyValid = (anchor: Product, shown: readonly Product[]): void => {
  const set = [anchor, ...shown];
  const roles = set.map(value => value.outfitRole);
  expect(new Set(roles).size).toBe(roles.length);
  expect(set.filter(isOuterLayer).length).toBeLessThanOrEqual(1);
  if (roles.includes('one_piece')) {
    expect(roles).not.toContain('top');
    expect(roles).not.toContain('bottom');
  }
};

const suitBlazer = product('trendyol-929681071', 'top', {
  title: 'Gri Çizgili Kruvaze Takım Elbise', subcategory: 'blazer',
});

describe('Invalid complement sets', () => {
  it('rejects two shoes, two coats and duplicate bottoms', () => {
    const top = product('top', 'top');
    const bottom = product('bottom', 'bottom');
    expect(isValidOutfitItems([top, bottom, product('shoe-a', 'shoes'), product('shoe-b', 'shoes')].map(item)))
      .toBe(false);
    expect(isValidOutfitItems([top, bottom, product('coat-a', 'outerwear'), product('coat-b', 'outerwear')].map(item)))
      .toBe(false);
    expect(isValidOutfitItems([top, bottom, product('bottom-b', 'bottom')].map(item))).toBe(false);
  });

  it('accepts top + bottom + shoes and dress + shoes', () => {
    const shoes = product('shoes', 'shoes');
    expect(isValidOutfitItems([product('top', 'top'), product('bottom', 'bottom'), shoes].map(item))).toBe(true);
    expect(isValidOutfitItems([product('dress', 'one_piece', { gender: 'women' }),
      product('heels', 'shoes', { gender: 'women' })].map(item))).toBe(true);
  });

  it('treats a top whose canonical subtype is outerwear as an outer layer', () => {
    const coat = product('trendyol-896837377', 'outerwear', { subcategory: 'ceket' });
    const outfit = [suitBlazer, product('bottom', 'bottom'), product('shoes', 'shoes')];
    expect(isValidOutfitItems(outfit.map(item))).toBe(true);
    expect(hasHardConflict([...outfit, coat].map(item))).toBe(true);
    expect(isValidOutfitItems([...outfit, coat].map(item))).toBe(false);
  });

  it('keeps an outerwear role whose subtype only implies a top (cardigan inferred as tisort)', () => {
    const cardigan = product('boyner-15647412', 'outerwear', { title: 'Bej Kadın Çizgili Hırka', subcategory: 'tisort' });
    expect(isValidOutfitItems([product('top', 'top'), product('bottom', 'bottom'), cardigan].map(item))).toBe(true);
  });

  it('fills the removed outer-layer slot from the next valid ranked alternative', () => {
    const coat = product('coat', 'outerwear');
    const pool = [product('bottom', 'bottom'), product('shoes', 'shoes'), coat, product('belt', 'accessory')];
    const shown = visibleSet(suitBlazer, pool);
    expect(shown.map(value => value.id)).not.toContain('coat');
    expect(shown.map(value => value.outfitRole)).toEqual(['bottom', 'shoes', 'accessory']);
    expectStructurallyValid(suitBlazer, shown);
  });

  it('shows fewer products instead of an invalid set when no valid alternative exists', () => {
    const shown = visibleSet(suitBlazer, [product('bottom', 'bottom'), product('shoes', 'shoes'), product('coat', 'outerwear')]);
    expect(shown.map(value => value.id)).toEqual(['bottom', 'shoes']);
    expectStructurallyValid(suitBlazer, shown);
  });

  it('never shows the suit blazer with a coat when a coat is the anchor', () => {
    const coat = product('defacto-3430253', 'outerwear', { title: 'Kahve Erkek Süet Ceket' });
    const shown = visibleSet(coat, [suitBlazer, product('tee', 'top'), product('bottom', 'bottom'), product('shoes', 'shoes')]);
    expect(shown.map(value => value.id)).not.toContain(suitBlazer.id);
    expect(shown.map(value => value.id)).toContain('tee');
    expectStructurallyValid(coat, shown);
  });

  // Pairs labelled "uyumsuz" in the Phase 6.2 blind human review; roles are the canonical catalog roles.
  it.each([
    ['P09 shoes+shoes', product('trendyol-1087064695', 'shoes'), product('trendyol-889961099', 'shoes')],
    ['P12 shoes+shoes', product('trendyol-1137621323', 'shoes'), product('boyner-1716227', 'shoes')],
    ['P23 shoes+shoes', product('trendyol-956741885', 'shoes'), product('trendyol-894158863', 'shoes')],
    ['P28 outerwear+outerwear', product('trendyol-896837377', 'outerwear'), product('defacto-3315755', 'outerwear')],
    ['P01 bottom+bottom', product('trendyol-822488656', 'bottom', { subcategory: 'pantolon' }),
      product('hepsiburada-HBC00007MX5CG', 'bottom', { subcategory: 'pantolon' })],
    ['P18 bottom+bottom', product('defacto-3408872', 'bottom', { subcategory: 'esofman' }),
      product('hepsiburada-gysnsetk12656ek', 'bottom')],
    ['P04 one_piece+bottom', product('mavi-1310944-91749', 'one_piece'), product('trendyol-1868883', 'bottom')],
    ['P24 bottom+one_piece', product('defacto-3408872', 'bottom', { subcategory: 'esofman' }),
      product('trendyol-920942405', 'one_piece')],
    ['P11 one_piece+one_piece', product('trendyol-1173071782', 'one_piece'), product('trendyol-1186649317', 'one_piece')],
    ['P16 one_piece+top', product('defacto-2843240', 'one_piece'), product('trendyol-833204531', 'top')],
    ['P15 top+top', product('hepsiburada-HBC0000CUWXMV', 'top'), product('defacto-3159839', 'top')],
    ['B0 suit blazer+coat', suitBlazer, product('trendyol-896837377', 'outerwear')],
  ])('%s never appears in one visible set', (_label, anchor, rejected) => {
    const alternatives = [product('alt-top', 'top'), product('alt-bottom', 'bottom'),
      product('alt-shoes', 'shoes'), product('alt-coat', 'outerwear'), product('alt-belt', 'accessory')]
      .filter(value => value.outfitRole !== anchor.outfitRole);
    const shown = visibleSet(anchor, [rejected, ...alternatives]);
    expect(shown.map(value => value.id)).not.toContain(rejected.id);
    expect(shown.length).toBeGreaterThan(0);
    expectStructurallyValid(anchor, shown);
  });
});
