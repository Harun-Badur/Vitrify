import fs from 'fs';
import path from 'path';
import type { Product } from '../types/product';
import { BAND_CAP_LIMIT, capCatalogBand } from '../src/intelligence/outfits/bandCap';
import { rankDiversityCandidatesAsync } from '../src/intelligence/outfits/rankOutfitCandidates';
import { isCatalogPairEligible } from '../src/intelligence/recommendations/catalogPairing';
import { catalogCompatibility } from '../src/intelligence/outfits/catalogCompatibility';
import { completeDiscoverRecommendationsAsync } from '../src/intelligence/recommendations/getDiscoverRecommendations';

const catalog: Product[] = JSON.parse(fs.readFileSync(path.join(__dirname,
  'fixtures/recommendation-catalog.snapshot.json'), 'utf8'));
const WORK = { budgetMs: 1_000_000 };

/** Mirrors prepareInput: only products pair-eligible with the anchor reach the search. */
const inputFor = (pool: readonly Product[], anchor: Product) => ({
  wardrobeItems: [], requiredCatalogProductId: anchor.id, maximalOnly: true,
  catalogProducts: [anchor, ...pool.filter(product => product.id !== anchor.id && isCatalogPairEligible(anchor, product))],
});
const pools = (): Product[][] => {
  const gender = (value: string) => catalog.filter(product => product.gender === value || product.gender === 'unisex').slice(0, 80);
  return [catalog.slice(0, 80), gender('women'), gender('men')].filter(pool => pool.length > 10);
};
const score = (anchor: Product) => (product: Product) => catalogCompatibility(anchor, product).score;

describe('capCatalogBand', () => {
  it('leaves normal anchors untouched and gives identical results with and without the cap', async () => {
    let untouched = 0, capped = 0;
    for (const pool of pools()) {
      for (const anchor of pool.filter(product => product.outfitRole)) {
        const input = inputFor(pool, anchor);
        if (capCatalogBand(input, anchor, score(anchor)) !== input.catalogProducts) { capped += 1; continue; }
        untouched += 1;
        const without = await rankDiversityCandidatesAsync(input, anchor, WORK, Infinity);
        const withCap = await rankDiversityCandidatesAsync(input, anchor, WORK);
        expect(withCap.map(entry => entry.candidate.id)).toEqual(without.map(entry => entry.candidate.id));
      }
    }
    expect(untouched).toBeGreaterThan(0);
    console.log(`bandCap: untouched=${untouched} capped=${capped}`);
  }, 300_000);

  it('keeps the anchor and the most compatible alternatives of a role when it trims', () => {
    const pool = catalog.slice(0, 80);
    const anchor = pool.find(product => product.outfitRole === 'top')!;
    const input = inputFor(pool, anchor);
    const rate = score(anchor);
    const kept = capCatalogBand(input, anchor, rate, 50);
    expect(kept.find(product => product.id === anchor.id)).toBeDefined();
    expect(kept.length).toBeLessThan(input.catalogProducts.length);
    const dropped = input.catalogProducts.filter(product => !kept.includes(product));
    for (const product of dropped) {
      const sameRole = kept.filter(other => other.outfitRole === product.outfitRole && other.id !== anchor.id);
      // Every dropped alternative is no better than the weakest one kept in its role.
      expect(sameRole.length).toBeGreaterThan(0);
      expect(rate(product)).toBeLessThanOrEqual(Math.min(...sameRole.map(rate)) + 1e-12);
    }
    expect(BAND_CAP_LIMIT).toBeGreaterThan(50);
  });

  it('reports overlap of the first outfits for heavy anchors', async () => {
    const rows: string[] = [];
    for (const limit of [1_000, 2_000, 4_000]) {
      let anchors = 0, overlap = 0, top1 = 0, wideTotal = 0, narrowTotal = 0;
      for (const pool of pools()) {
        for (const anchor of pool.filter(product => product.outfitRole)) {
          const input = inputFor(pool, anchor);
          if (capCatalogBand(input, anchor, score(anchor), limit) === input.catalogProducts) continue;
          const wide = await rankDiversityCandidatesAsync(input, anchor, WORK, Infinity);
          const narrow = await rankDiversityCandidatesAsync(input, anchor, WORK, limit);
          const left = wide.slice(0, 10).map(entry => entry.candidate.id);
          const right = new Set(narrow.slice(0, 10).map(entry => entry.candidate.id));
          anchors += 1; wideTotal += wide.length; narrowTotal += narrow.length;
          overlap += left.length ? left.filter(id => right.has(id)).length / left.length : 1;
          top1 += wide[0]?.candidate.id === narrow[0]?.candidate.id ? 1 : 0;
        }
      }
      rows.push(`limit=${limit} capped=${anchors} avgOverlap10=${(overlap / anchors).toFixed(2)} top1Same=${top1}/${anchors} avgBand ${Math.round(wideTotal / anchors)}->${Math.round(narrowTotal / anchors)}`);
    }
    console.log(`QUALITY\n${rows.join('\n')}`);
  }, 600_000);
});
void completeDiscoverRecommendationsAsync;
