import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { join } from 'path';
import { b0PrimeSourcesPresent, loadB0PrimeDataset } from './fixtures/b0PrimeReplay';
import { completeDiscoverRecommendationsAsync, prepareDiscoverRankingAsync } from '../src/intelligence/recommendations/getDiscoverRecommendations';
import { complementaryProductsForDisplay } from '../src/intelligence/recommendations/complementaryProductsForDisplay';
import { selectRecommendationPool } from '../src/intelligence/recommendations/selectRecommendationPool';
import { anchorContext } from '../src/recommendationCache/feedPacket';

// Minutes long and backed by the gitignored reports/, so opt-in: B0_PREFERENCE_EQUIVALENCE=1 npx jest b0PrimePreference.
// Pinned from the engine before the lazy band: every preference pool, with and without a wardrobe.
const PINNED: Record<string, string> = {"hepsi:empty":"4f997d0f633f","hepsi:owned":"0e4f3023c929","kadin:empty":"f9f2cd045fd8","kadin:owned":"87c7f5660c89","erkek:empty":"2ae1b400ec96","erkek:owned":"506c103618ba"};
const root = join(__dirname, '..');
const enabled = process.env.B0_PREFERENCE_EQUIVALENCE === '1' && b0PrimeSourcesPresent(root) && existsSync(join(root, 'reports'));
const describeLocal = enabled ? describe : describe.skip;
const owned = [
  { id: 'owned-top', category: 'top', color: 'black', style_tags: ['casual', 'minimal'] },
  { id: 'owned-bottom', category: 'bottom', color: 'white', style_tags: ['casual'] },
  { id: 'owned-shoes', category: 'shoes', color: 'beige', style_tags: ['casual', 'minimal'] },
];
const allowed: Record<string, (gender: unknown) => boolean> = {
  hepsi: () => true,
  kadin: gender => gender === 'women' || gender === 'unisex',
  erkek: gender => gender === 'men' || gender === 'unisex',
};
const options = { budgetMs: 1e6 };
const summary = (result: readonly any[]) => result.map(entry => [entry.candidate.id, entry.rank, entry.rankingValue, entry.reasons,
  entry.sources, entry.displayProducts?.map((product: { id: string }) => product.id)]);

describeLocal('B0′ preference pools', () => {
  it.each(Object.keys(PINNED))('%s keeps ranked band, final and exposed results byte-identical', async name => {
    const [pref, wardrobeLabel] = name.split(':');
    const dataset = loadB0PrimeDataset(root);
    const pool = selectRecommendationPool([...dataset.products.values()].filter(product => allowed[pref](product.gender)));
    const hash = createHash('sha256');
    for (const anchor of [...pool, ...dataset.anchorIds.map(id => dataset.products.get(id)!)]) {
      const context = anchorContext(pool.filter(product => product.id !== anchor.id), anchor, wardrobeLabel === 'owned' ? owned : [], new Map());
      const prepared = await prepareDiscoverRankingAsync(context.input, options);
      const result = await completeDiscoverRecommendationsAsync(prepared, new Map(), options);
      const shown = complementaryProductsForDisplay(result, anchor.id);
      const exposure = new Map(shown.map(product => [product.id, 1]));
      exposure.set(shown[0]?.id ?? 'none', 9);
      const again = await completeDiscoverRecommendationsAsync(prepared, exposure, options);
      hash.update(JSON.stringify([anchor.id, prepared.ranked.map(entry => [entry.candidate.id, entry.rank, entry.rankingValue, entry.reasons]),
        summary(result), summary(again)]));
    }
    expect(hash.digest('hex').slice(0, 12)).toBe(PINNED[name]);
  }, 300_000);
});
