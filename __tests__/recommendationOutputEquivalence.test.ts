import fs from 'fs';
import path from 'path';
import type { Product } from '../types/product';
import { complementaryProductsForDisplay } from '../src/intelligence/recommendations/complementaryProductsForDisplay';
import {
  completeDiscoverRecommendationsAsync,
  prepareDiscoverRankingAsync,
} from '../src/intelligence/recommendations/getDiscoverRecommendations';
import { anchorContext } from '../src/recommendationCache/feedPacket';

// Timing-only changes (cached footwear/conflict results, identity memo keys, foreground pause) must not
// move a single recommendation. The golden file was produced by the engine before those changes:
// UPDATE_EQUIVALENCE_GOLDEN=1 npx jest __tests__/recommendationOutputEquivalence.test.ts rewrites it.
const catalog: Product[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/recommendation-catalog.snapshot.json'), 'utf8'));
const GOLDEN = path.join(__dirname, 'fixtures/recommendationOutputEquivalence.golden.json');
const POOL_SIZE = 80;
const owned = [
  { id: 'owned-top', category: 'top', color: 'black', style_tags: ['casual', 'minimal'] },
  { id: 'owned-bottom', category: 'bottom', color: 'white', style_tags: ['casual'] },
  { id: 'owned-shoes', category: 'shoes', color: 'beige', style_tags: ['casual', 'minimal'] },
];
// Same options the app uses between slices, minus platform timer latency.
const options = { budgetMs: 1_000_000 };

interface AnchorSnapshot {
  anchorId: string;
  poolInput: number;
  rankedCount: number;
  finalIds: string[];
  displayIds: string[];
  firstRankValue: unknown;
  exposedFinalIds: string[];
}

const snapshot = async (): Promise<AnchorSnapshot[]> => {
  const pool = catalog.slice(0, POOL_SIZE);
  const out: AnchorSnapshot[] = [];
  const info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  try {
    for (const [index, anchor] of catalog.entries()) {
      const wardrobe = index % 5 === 0 ? owned : [];
      const context = anchorContext(pool.filter(product => product.id !== anchor.id), anchor, wardrobe, new Map());
      const prepared = await prepareDiscoverRankingAsync(context.input, options);
      const result = await completeDiscoverRecommendationsAsync(prepared, new Map(), options);
      const best = prepared.ranked[0];
      // A second pass with the first selection exposed exercises exposure-dependent selection only.
      const exposed = new Map(complementaryProductsForDisplay(result, anchor.id).map(product => [product.id, 1]));
      const second = await completeDiscoverRecommendationsAsync(prepared, exposed, options);
      out.push({
        anchorId: anchor.id,
        poolInput: context.input.catalogProducts.length,
        rankedCount: prepared.ranked.length,
        finalIds: result.flatMap(entry => entry.candidate.items.map(item => `${item.sourceType}:${item.sourceId}:${item.role}`)),
        displayIds: complementaryProductsForDisplay(result, anchor.id).map(product => product.id),
        firstRankValue: best ? { ...best.rankingValue, id: best.candidate.id } : null,
        exposedFinalIds: complementaryProductsForDisplay(second, anchor.id).map(product => product.id),
      });
    }
  } finally {
    info.mockRestore();
  }
  return out;
};

describe('recommendation output equivalence (timing-only optimisations)', () => {
  it('matches the pre-optimisation golden for every snapshot anchor', async () => {
    const actual = await snapshot();
    if (process.env.UPDATE_EQUIVALENCE_GOLDEN === '1') {
      fs.writeFileSync(GOLDEN, `${JSON.stringify(actual, null, 1)}\n`);
      return;
    }
    const golden: AnchorSnapshot[] = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    expect(actual).toHaveLength(golden.length);
    expect(actual.length).toBeGreaterThanOrEqual(30);
    actual.forEach((entry, index) => expect(entry).toEqual(golden[index]));
  }, 600_000);
});
