import fs from 'fs';
import path from 'path';
import { assignInsightChips, createInsightChipSequence, selectInsightChip,
  type InsightChipContext, type InsightWardrobeItem } from '../lib/insightChip';
import type { Product } from '../types/product';

// The chip decision is pure; caching pairing inputs per wardrobe item must not move one chip.
// Golden produced by the pre-cache implementation: UPDATE_INSIGHT_GOLDEN=1 npx jest __tests__/insightChipEquivalence.test.ts
const catalog: Product[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/recommendation-catalog.snapshot.json'), 'utf8'));
const GOLDEN = path.join(__dirname, 'fixtures/insightChipEquivalence.golden.json');
const item = (id: string, category: string, subcategory: string | null, colorSlugs?: string[]): InsightWardrobeItem =>
  ({ id, category, subcategory, colorSlugs });
const wardrobes: Record<string, InsightWardrobeItem[]> = {
  empty: [],
  small: [item('a', 'upper_body', 'tisort', ['beyaz']), item('b', 'lower_body', 'jean', ['navy'])],
  mixed: [
    item('t1', 'upper_body', 'tisort', ['beyaz']), item('t2', 'upper_body', 'gomlek', ['siyah']), item('t3', 'upper_body', 'blazer', ['bej']),
    item('t4', 'upper_body', null, ['kirmizi']), item('b1', 'lower_body', 'jean', ['navy']), item('b2', 'lower_body', 'pantolon', ['siyah']),
    item('b3', 'lower_body', 'etek', ['yesil']), item('d1', 'dresses', null, ['siyah']), item('s1', 'shoes', 'sneaker', ['beyaz']),
    item('s2', 'shoes', 'bot', ['kahverengi']), item('g1', 'bags', 'canta', ['kahverengi']), item('x1', 'upper_body', 'tisort', []),
  ],
};
const contexts: Array<[string, Omit<InsightChipContext, 'recentKinds'>]> = [
  ['plain', { reasons: [], wardrobe: [], likeCount: 0 }],
  ['liked', { reasons: [], wardrobe: [], likeCount: 12 }],
];

const snapshot = () => {
  const out: Record<string, unknown> = {};
  for (const [name, wardrobe] of Object.entries(wardrobes)) {
    for (const [contextName, base] of contexts) {
      const context: InsightChipContext = { ...base, wardrobe, recentKinds: [] };
      out[`${name}/${contextName}/select`] = catalog.map(product => selectInsightChip(product, context));
      // The deck path: a rolling window assigned in order, as the Discover screen does after each swipe.
      let sequence = createInsightChipSequence();
      for (let start = 0; start + 4 <= catalog.length; start++) {
        sequence = assignInsightChips(catalog.slice(start, start + 4), { wardrobe, likeCount: base.likeCount }, sequence);
      }
      out[`${name}/${contextName}/sequence`] = [...sequence.chips.entries()];
    }
  }
  return out;
};

describe('insight chip equivalence (pairing inputs cached per wardrobe item)', () => {
  it('matches the pre-cache golden for every product and wardrobe', () => {
    const actual = JSON.parse(JSON.stringify(snapshot()));
    if (process.env.UPDATE_INSIGHT_GOLDEN === '1') { fs.writeFileSync(GOLDEN, `${JSON.stringify(actual, null, 1)}\n`); return; }
    expect(actual).toEqual(JSON.parse(fs.readFileSync(GOLDEN, 'utf8')));
    const chips = Object.values(actual).flat().filter(Boolean);
    expect(chips.length).toBeGreaterThan(100);
  });
});
