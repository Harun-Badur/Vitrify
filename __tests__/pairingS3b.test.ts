import { readFileSync } from 'fs';
import { join } from 'path';
import { evaluatePair } from '../src/intelligence/pairing/pairing';
import { PAIRING_POLICY_V1, PAIRING_POLICY_V2 } from '../src/intelligence/pairing/pairingPolicy';
import { HUMAN_DECISIONS_V1, isHumanIncompatible } from '../src/intelligence/pairing/humanDecisions';
import type { PairItem, PairSignal } from '../src/intelligence/pairing/pairingTypes';
import { catalogPairDecision, pairItemFromProduct } from '../src/intelligence/recommendations/catalogPairing';
import { getDiscoverRecommendations } from '../src/intelligence/recommendations/getDiscoverRecommendations';
import { complementaryProductsForDisplay } from '../src/intelligence/recommendations/complementaryProductsForDisplay';
import type { OutfitRole, Product } from '../types/product';

// Faz 4 S3b: pairing decides complement eligibility. Fixtures use live-catalog titles (no user data).

const known = <T>(value: T, confidence: PairSignal<T>['confidence'] = 'high'): PairSignal<T> =>
  ({ value, source: 'catalog_repair', confidence });
const unknown = <T>(): PairSignal<T> => ({ value: null, source: 'unknown', confidence: 'unknown' });

const item = (id: string, patch: Partial<PairItem> = {}): PairItem => ({
  id, role: known('top'), gender: known('men'), subtype: unknown(), conflicts: [], ...patch,
});
const v2 = (anchor: PairItem, candidate: PairItem) =>
  evaluatePair({ anchor, candidate, sessionGender: null, policy: PAIRING_POLICY_V2 });

const product = (id: string, title: string, category: Product['category'], outfitRole: OutfitRole,
  patch: Partial<Product> = {}): Product => ({
  id, title, category, outfitRole, brand: 'B', price: 100, imageUrl: `https://example.com/${id}.jpg`,
  garmentDescription: title, gender: 'men', ...patch,
});

describe('policy versions', () => {
  it('V1 keeps the S2 decisions; V2 is the S3b policy', () => {
    expect(PAIRING_POLICY_V1.version).toBe(1);
    expect(PAIRING_POLICY_V2.version).toBe(2);
    const a = item('a', { gender: unknown() });
    const b = item('b', { role: known('bottom') });
    expect(evaluatePair({ anchor: a, candidate: b, sessionGender: null }).outcome).toBe('eligible');
    expect(v2(a, b).outcome).toBe('insufficient_evidence');
  });
});

describe('S3b gender rule (catalog↔catalog)', () => {
  const bottom = (gender: PairSignal<'women' | 'men' | 'unisex'>) => item('b', { role: known('bottom'), gender });

  it('unknown gender on either side is uncertain', () => {
    expect(v2(item('a'), bottom(unknown())).reasons).toEqual(['gender_unknown']);
    expect(v2(item('a', { gender: unknown() }), bottom(known('men'))).outcome).toBe('insufficient_evidence');
  });

  it('an unverified unisex is uncertain; an explicit unisex is compatible', () => {
    expect(v2(item('a'), bottom(known('unisex', 'unknown'))).reasons).toEqual(['gender_unisex_unverified']);
    expect(v2(item('a'), bottom(known('unisex', 'high'))).outcome).toBe('eligible');
  });

  it('women↔men without reliable evidence is uncertain, never a hard rejection (D1)', () => {
    expect(v2(item('a', { gender: known('men', 'unknown') }), bottom(known('women', 'unknown'))).reasons)
      .toEqual(['gender_conflict_unverified']);
    expect(v2(item('a'), bottom(known('women'))).outcome).toBe('rejected');
  });

  it('does not apply to wardrobe items', () => {
    const wardrobe = item('w', { origin: 'wardrobe', role: known('bottom'), gender: unknown() });
    const result = v2(item('a'), wardrobe);
    expect(result.outcome).toBe('eligible');
    expect(result.checks.find(check => check.check === 'gender')?.code).toBe('gender_not_applicable');
  });
});

describe('S3b season and formality (coarse, derived_from_subtype)', () => {
  const sub = (slug: string, confidence: PairSignal<string>['confidence'] = 'high') => known(slug, confidence);

  it('rejects a reliable coarse season conflict (T4: mont + şort)', () => {
    const result = v2(item('coat', { role: known('outerwear'), subtype: sub('mont') }), item('shorts', { role: known('bottom'), subtype: sub('sort') }));
    expect(result.outcome).toBe('rejected');
    expect(result.reasons).toEqual(['season_conflict']);
    expect(result.checks.find(check => check.check === 'season')?.evidence.map(entry => entry.source))
      .toEqual(['derived_from_subtype', 'derived_from_subtype']);
  });

  it('rejects a reliable coarse formality conflict (T1: takım elbise + kargo şort)', () => {
    const result = v2(item('suit', { role: known('outerwear'), subtype: sub('blazer') }), item('cargo', { role: known('bottom'), subtype: sub('kargo') }));
    expect(result.reasons).toEqual(['formality_conflict']);
  });

  it('an unreliable subtype makes a coarse conflict uncertain, not rejected', () => {
    const result = v2(item('coat', { role: known('outerwear'), subtype: sub('mont', 'unknown') }), item('shorts', { role: known('bottom'), subtype: sub('sort') }));
    expect(result.reasons).toEqual(['season_conflict_unverified']);
  });

  it('unknown season or formality does not decide', () => {
    expect(v2(item('a', { role: known('outerwear'), subtype: sub('ceket') }), item('b', { role: known('bottom'), subtype: sub('sort') })).outcome).toBe('eligible');
    expect(v2(item('a', { role: known('outerwear'), subtype: sub('mont') }), item('b', { role: known('bottom'), subtype: sub('jean') })).outcome).toBe('eligible');
  });
});

describe('human decisions moved into pairing (D3)', () => {
  it('keeps the 13 reviewer rows as versioned evidence and rejects only those pairs', () => {
    expect(HUMAN_DECISIONS_V1.version).toBe(1);
    expect(HUMAN_DECISIONS_V1.rows).toHaveLength(13);
    const [row] = HUMAN_DECISIONS_V1.rows;
    expect(isHumanIncompatible(row.anchorId, row.productId)).toBe(true);
    expect(isHumanIncompatible(row.productId, row.anchorId)).toBe(false);
    const result = v2(item(row.anchorId), item(row.productId, { role: known('accessory') }));
    expect(result.reasons).toEqual(['human_incompatible']);
    expect(result.checks.find(check => check.check === 'human_decision')?.evidence[0].source).toBe('human_review');
  });

  it('leaves no separate human-incompatibility module', () => {
    expect(() => readFileSync(join(__dirname, '..', 'src/intelligence/recommendations/verifiedHumanIncompatibilities.ts'))).toThrow();
  });
});

describe('catalog product adapter', () => {
  it('trusts a subtype only when the title names it, and unisex only with an explicit word', () => {
    const suit = pairItemFromProduct(product('s', 'Erkek Lacivert Takım Elbise', 'upper_body', 'outerwear', { subcategory: 'blazer' }));
    expect(suit.subtype.confidence).toBe('high');
    const guessed = pairItemFromProduct(product('g', 'Erkek Üst', 'upper_body', 'top', { subcategory: 'tisort' }));
    expect(guessed.subtype.confidence).toBe('unknown');
    expect(pairItemFromProduct(product('u', 'Unisex Şapka', 'hats', 'hat', { gender: 'unisex' })).gender.confidence).toBe('high');
    expect(pairItemFromProduct(product('c', 'adidas Cap', 'hats', 'hat', { gender: 'unisex' })).gender.confidence).toBe('unknown');
    expect(pairItemFromProduct(product('n', 'adidas Cap', 'hats', 'hat', { gender: '' })).gender.value).toBeNull();
  });

  it('decides T1 (suit + cargo shorts) as a formality conflict', () => {
    const suit = product('trendyol-929681071', 'Erkek Lacivert Takım Elbise', 'upper_body', 'outerwear', { subcategory: 'blazer' });
    const shorts = product('lcw-5489450', 'Erkek Kargo Şort', 'lower_body', 'bottom', { subcategory: 'kargo' });
    expect(catalogPairDecision(suit, shorts).reasons).toEqual(['formality_conflict']);
  });
});

describe('complement selection uses the pairing decision', () => {
  const recommend = (anchor: Product, pool: Product[]) => getDiscoverRecommendations({
    wardrobeItems: [], catalogProducts: [anchor, ...pool], requiredCatalogProductId: anchor.id, firstOnly: true,
  });
  const shown = (anchor: Product, pool: Product[]) =>
    complementaryProductsForDisplay(recommend(anchor, pool), anchor.id).map(entry => entry.id);

  const anchor = product('anchor', 'Erkek Tişört', 'upper_body', 'top', { subcategory: 'tisort' });

  it('never selects an uncertain (unknown gender) or ineligible complement, and does not force-fill', () => {
    const pool = [
      product('jean', 'Erkek Jean', 'lower_body', 'bottom', { subcategory: 'jean' }),
      product('shoe', 'Erkek Sneaker Ayakkabı', 'shoes', 'shoes'),
      product('cap', 'adidas Cap', 'hats', 'hat', { gender: '' }),
      product('belt', 'Deri Kemer', 'accessories', 'accessory', { gender: 'unisex' }),
    ];
    const ids = shown(anchor, pool);
    expect(ids).not.toContain('cap');
    expect(ids).not.toContain('belt');
    expect(ids.length).toBeLessThanOrEqual(3);
  });

  it('can return zero complements', () => {
    const pool = [product('cap', 'adidas Cap', 'hats', 'hat', { gender: '' })];
    expect(shown(anchor, pool)).toEqual([]);
  });

  it('rejects a coarse conflict between two complements, not only with the anchor', () => {
    const tee = product('tee', 'Erkek Tişört', 'upper_body', 'top', { subcategory: 'tisort' });
    const pool = [
      product('shorts', 'Erkek Şort', 'lower_body', 'bottom', { subcategory: 'sort' }),
      product('coat', 'Erkek Şişme Mont', 'upper_body', 'outerwear', { subcategory: 'mont' }),
      product('shoe', 'Erkek Sneaker Ayakkabı', 'shoes', 'shoes'),
    ];
    const ids = shown(tee, pool);
    expect(ids.includes('shorts') && ids.includes('coat')).toBe(false);
  });
});
