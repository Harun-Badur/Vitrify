import { ProductRepository } from '../services/productRepository';
import { createPairEligibilityMemo, isCatalogPairEligible } from '../src/intelligence/recommendations/catalogPairing';
import { selectDiverseComplementsAsync } from '../src/intelligence/recommendations/selectDiverseComplements';
import { rankOutfitCandidatesAsync } from '../src/intelligence/outfits/rankOutfitCandidates';
import { generateOutfitCandidatesAsync } from '../src/intelligence/outfits/generateOutfitCandidates';
import * as pairing from '../src/intelligence/pairing/pairing';
import type { OutfitRole, Product } from '../types/product';

jest.mock('../lib/supabase', () => ({ getSupabaseClient: jest.fn(() => null) }));

const product = (id: string, role: OutfitRole, category: Product['category'], gender: Product['gender'] = 'women'): Product => ({
  id, title: id, brand: id, price: 100, imageUrl: `https://example.com/${id}.jpg`, category, outfitRole: role,
  garmentDescription: id, gender });

afterEach(() => jest.restoreAllMocks());

describe('createPairEligibilityMemo', () => {
  it('evaluates a directional pair once and returns what isCatalogPairEligible returns', () => {
    const top = product('top', 'top', 'upper_body'), bottom = product('bottom', 'bottom', 'lower_body', 'men');
    const expected = [isCatalogPairEligible(top, bottom), isCatalogPairEligible(bottom, top)];
    const evaluate = jest.spyOn(pairing, 'evaluatePair');
    const eligible = createPairEligibilityMemo();
    expect([eligible(top, bottom), eligible(bottom, top), eligible(top, bottom), eligible(bottom, top)]).toEqual([...expected, ...expected]);
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it('drops remembered answers when register refreshes a product in place', () => {
    const repository = new ProductRepository(async () => []);
    const [top, bottom] = repository.register([product('top', 'top', 'upper_body'), product('bottom', 'bottom', 'lower_body')]);
    const eligible = createPairEligibilityMemo();
    expect(eligible(top, bottom)).toBe(true);
    // Same identity, new evidence: the identity-keyed row is stale from here on.
    repository.register([product('bottom', 'bottom', 'lower_body', 'men')]);
    expect(eligible(top, bottom)).toBe(isCatalogPairEligible(top, bottom));
    expect(eligible(top, bottom)).toBe(false);
  });

  it('keeps remembered answers when register sees the canonical object itself', () => {
    const repository = new ProductRepository(async () => []);
    const [top, bottom] = repository.register([product('top', 'top', 'upper_body'), product('bottom', 'bottom', 'lower_body')]);
    const eligible = createPairEligibilityMemo();
    eligible(top, bottom);
    const evaluate = jest.spyOn(pairing, 'evaluatePair');
    repository.register([top, bottom]);
    eligible(top, bottom);
    expect(evaluate).not.toHaveBeenCalled();
  });
});

it('selection evaluates each pair at most once however many outfits repeat the product', async () => {
  const catalog = [product('anchor', 'top', 'upper_body'),
    ...[1, 2, 3, 4].map(index => product(`bottom-${index}`, 'bottom', 'lower_body')),
    ...[1, 2, 3, 4].map(index => product(`shoes-${index}`, 'shoes', 'shoes')),
    ...[1, 2, 3, 4].map(index => product(`bag-${index}`, 'bag', 'bags'))];
  const candidates = await generateOutfitCandidatesAsync({ wardrobeItems: [], catalogProducts: catalog, requiredCatalogProductId: 'anchor', maximalOnly: true }, { budgetMs: 1_000_000 });
  const ranked = await rankOutfitCandidatesAsync(candidates, catalog[0], { budgetMs: 1_000_000 });
  expect(ranked.length).toBeGreaterThan(30);
  const evaluate = jest.spyOn(pairing, 'evaluatePair');
  const selection = await selectDiverseComplementsAsync(ranked, catalog[0], new Map(), { budgetMs: 1_000_000 });
  expect(selection?.products).toHaveLength(3);
  const pairs = evaluate.mock.calls.map(([input]) => `${input.anchor.id}|${input.candidate.id}`);
  expect(new Set(pairs).size).toBe(pairs.length);
});
