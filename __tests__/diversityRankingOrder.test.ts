import { searchOutfitCandidatesAsync, generateOutfitCandidatesAsync } from '../src/intelligence/outfits/generateOutfitCandidates';
import { rankDiversityCandidatesAsync, rankOutfitCandidatesAsync } from '../src/intelligence/outfits/rankOutfitCandidates';
import type { OutfitRole, Product } from '../types/product';

const product = (id: string, role: OutfitRole, category: Product['category']): Product => ({
  id, title: 'Ayni', brand: 'Ayni', price: 100, imageUrl: 'https://example.com/a.jpg', category, outfitRole: role,
  garmentDescription: id, gender: 'women', colorSlugs: ['siyah'] });
const anchor = product('anchor', 'top', 'upper_body');
// Same evidence on every alternative: only the candidate id can order these outfits.
const catalog = [anchor, ...['b-3', 'b-1', 'b-2'].map(id => product(id, 'bottom', 'lower_body')),
  ...['s-2', 's-1'].map(id => product(id, 'shoes', 'shoes')), ...['g-2', 'g-1'].map(id => product(id, 'bag', 'bags'))];
const input = { wardrobeItems: [], catalogProducts: catalog, requiredCatalogProductId: anchor.id };
const options = { budgetMs: 1_000_000 };

it('search hands back candidates in visit order; sorting them is the ranking step\'s job', async () => {
  const found = await searchOutfitCandidatesAsync(input, { canExtend: () => true, accept: () => true }, options);
  const ids = found.map(candidate => candidate.id);
  expect(ids).not.toEqual([...ids].sort());
  expect(new Set(ids).size).toBe(ids.length);
});

it('the diversity path keeps the id-then-stable-rank order of the reference path, including full ties', async () => {
  const maximal = { ...input, maximalOnly: true };
  const reference = await rankOutfitCandidatesAsync(await generateOutfitCandidatesAsync(maximal, options), anchor, options);
  const ranked = await rankDiversityCandidatesAsync(maximal, anchor, options);
  expect(ranked.length).toBeGreaterThan(5);
  expect(ranked.map(entry => [entry.candidate.id, entry.rank])).toEqual(reference.map(entry => [entry.candidate.id, entry.rank]));
  expect(ranked.map(entry => entry.rankingValue)).toEqual(reference.map(entry => entry.rankingValue));
});
