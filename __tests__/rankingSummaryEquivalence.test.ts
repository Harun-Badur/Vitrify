import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Product } from '../types/product';
import { complementaryProductsForDisplay } from '../src/intelligence/recommendations/complementaryProductsForDisplay';
import {
  completeDiscoverRecommendationsAsync,
  prepareDiscoverRankingAsync,
} from '../src/intelligence/recommendations/getDiscoverRecommendations';
import { anchorContext } from '../src/recommendationCache/feedPacket';

// CPU-only changes must not move a ranked entry. Pinned from the engine before those changes; covers the whole
// ranked band (order, rank, rankingValue, reasons) plus the final result with and without exposure.
const EXPECTED = '1db1c2702e47c033893945f2794148ac56766098f03fb04c72d21d784093c3ca';
const catalog: Product[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/recommendation-catalog.snapshot.json'), 'utf8'));
const owned = [
  { id: 'owned-top', category: 'top', color: 'black', style_tags: ['casual', 'minimal'] },
  { id: 'owned-bottom', category: 'bottom', color: 'white', style_tags: ['casual'] },
  { id: 'owned-shoes', category: 'shoes', color: 'beige', style_tags: ['casual', 'minimal'] },
];
const options = { budgetMs: 1_000_000 };

it('keeps the full ranked band and final results byte-identical, with and without a wardrobe', async () => {
  const info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  const hash = createHash('sha256');
  for (const wardrobe of [[], owned]) {
    for (const anchor of catalog) {
      const context = anchorContext(catalog.filter(product => product.id !== anchor.id), anchor, wardrobe, new Map());
      const prepared = await prepareDiscoverRankingAsync(context.input, options);
      const result = await completeDiscoverRecommendationsAsync(prepared, new Map(), options);
      const shown = complementaryProductsForDisplay(result, anchor.id).map(product => product.id);
      const exposed = await completeDiscoverRecommendationsAsync(prepared, new Map(shown.map(id => [id, 1])), options);
      hash.update(JSON.stringify([anchor.id, wardrobe.length,
        prepared.ranked.map(entry => [entry.candidate.id, entry.rank, entry.rankingValue, entry.reasons]),
        shown, complementaryProductsForDisplay(exposed, anchor.id).map(product => product.id)]));
    }
  }
  info.mockRestore();
  expect(hash.digest('hex')).toBe(EXPECTED);
}, 120_000);
