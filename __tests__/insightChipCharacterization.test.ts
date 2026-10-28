import { PRICE_BAND_REASON_LABEL } from '../lib/displayReason';
import { selectInsightChip, type InsightChipContext, type InsightWardrobeItem } from '../lib/insightChip';
import type { Product } from '../types/product';

// Phase 4 S1 pinned what selectInsightChip decided, including where it disagreed with the
// compatibility policy (docs/faz4-uyum-ayrisma.md, rows C1–C6). S4 moved the wardrobe decision into
// the pairing module; each C row below states old -> new. Products and wardrobe items now carry the
// role/subtype/color evidence the pairing decision reads (an unknown one means no chip).

const ROLE: Record<Product['category'], Product['outfitRole']> = {
  upper_body: 'top', lower_body: 'bottom', dresses: 'one_piece', shoes: 'shoes', bags: 'bag', hats: 'hat', accessories: 'accessory',
};
const product = (id: string, category: Product['category'], colorSlugs?: string[]): Product => ({
  id,
  outfitRole: ROLE[category],
  imageUrl: `https://example.invalid/${id}.jpg`,
  title: id,
  price: 500,
  brand: 'Test',
  category,
  colorSlugs,
  garmentDescription: id,
});

const SUBTYPE: Record<string, string> = {
  upper_body: 'tisort', lower_body: 'jean', dresses: 'elbise', shoes: 'sneaker', bags: 'canta', hats: 'sapka',
};
const item = (id: string, category: string, colorSlugs?: string[], subcategory: string | null = SUBTYPE[category] ?? null): InsightWardrobeItem =>
  ({ id, category, subcategory, colorSlugs });

const context = (wardrobe: InsightWardrobeItem[], overrides: Partial<InsightChipContext> = {}): InsightChipContext =>
  ({ reasons: [], wardrobe, likeCount: 0, recentKinds: [], ...overrides });

const kindOf = (subject: Product, ctx: InsightChipContext) => selectInsightChip(subject, ctx)?.kind ?? null;

describe('insight chip decisions after S4 (pairing module)', () => {
  it('matches a complementary wardrobe item that shares an exact color slug', () => {
    const chip = selectInsightChip(product('top', 'upper_body', ['navy']), context([
      item('jean', 'lower_body', ['navy']), item('tee', 'upper_body', ['beyaz']), item('sneaker', 'shoes', ['beyaz']),
    ]));
    expect(chip?.kind).toBe('wardrobe_match');
    expect(chip?.matchedItem?.id).toBe('jean');
  });

  it('C1 (old none -> new wardrobe_match): a dress pairs with an outer layer of the same color; a plain top still does not', () => {
    const chip = selectInsightChip(product('dress', 'dresses', ['siyah']), context([
      item('blazer', 'upper_body', ['siyah'], 'blazer'), item('coat', 'upper_body', ['siyah'], 'mont'), item('shirt', 'upper_body', ['siyah']),
    ]));
    expect(chip?.kind).toBe('wardrobe_match');
    expect(chip?.matchedItem?.id).toBe('blazer');
    expect(kindOf(product('dress', 'dresses', ['siyah']), context([
      item('shirt', 'upper_body', ['siyah']), item('tee', 'upper_body', ['siyah']), item('polo', 'upper_body', ['siyah'], 'polo'),
    ]))).toBeNull();
  });

  it('C2 (old none -> new wardrobe_match): a top pairs with an outer layer of the same color, not with another top', () => {
    const chip = selectInsightChip(product('shirt', 'upper_body', ['beyaz']), context([
      item('blazer', 'upper_body', ['beyaz'], 'blazer'), item('coat', 'upper_body', ['beyaz'], 'mont'), item('cardigan', 'upper_body', ['beyaz'], 'hirka'),
    ]));
    expect(chip?.kind).toBe('wardrobe_match');
    expect(chip?.matchedItem?.id).toBe('blazer');
    expect(kindOf(product('shirt', 'upper_body', ['beyaz']), context([
      item('a', 'upper_body', ['beyaz']), item('b', 'upper_body', ['beyaz'], 'polo'), item('c', 'upper_body', ['beyaz'], 'gomlek'),
    ]))).toBeNull();
  });

  it('C3 (old none -> new wardrobe_match): a neutral color is compatible, like the outfit scorer (0.5)', () => {
    const chip = selectInsightChip(product('top', 'upper_body', ['navy']), context([
      item('jean', 'lower_body', ['siyah']), item('tee', 'upper_body', ['beyaz']), item('sneaker', 'shoes', ['beyaz']),
    ]));
    expect(chip?.kind).toBe('wardrobe_match');
    expect(chip?.matchedItem?.id).toBe('jean');
  });

  it('C4 (old none -> new wardrobe_match): color slugs are normalized before comparing', () => {
    expect(kindOf(product('top', 'upper_body', ['Navy']), context([
      item('jean', 'lower_body', ['navy']), item('tee', 'upper_body', ['beyaz']), item('sneaker', 'shoes', ['beyaz']),
    ]))).toBe('wardrobe_match');
  });

  it('C5 (old completes_wardrobe -> new none): wardrobe items without a color are uncertain, no chip', () => {
    expect(kindOf(product('bag', 'bags', ['siyah']), context([
      item('tee', 'upper_body'), item('jean', 'lower_body'), item('dress', 'dresses'),
    ]))).toBeNull();
  });

  it('C6 (old none -> new wardrobe_match): a hat pairs with a lower-body item of a compatible color', () => {
    expect(kindOf(product('hat', 'hats', ['bej']), context([
      item('chino', 'lower_body', ['bej']), item('hat2', 'hats', ['bej']), item('loafer', 'shoes', ['bej']),
    ]))).toBe('wardrobe_match');
  });

  it('needs at least three wardrobe items for any wardrobe chip', () => {
    expect(kindOf(product('top', 'upper_body', ['navy']), context([
      item('jean', 'lower_body', ['navy']), item('sneaker', 'shoes', ['navy']),
    ]))).toBeNull();
  });

  it('turns recs-feed style reasons into style_fit with profile evidence', () => {
    const chip = selectInsightChip(product('top', 'upper_body'), context([], {
      reasons: ['Sevdiğin renk: Lacivert', 'Minimal stiline yakın'],
    }));
    expect(chip?.kind).toBe('style_fit');
    expect(chip?.evidence.filter((entry) => entry.source === 'profile').map((entry) => entry.label))
      .toEqual(['Sevdiğin renk: Lacivert', 'Minimal stiline yakın']);
  });

  it('shows the budget chip only from five likes', () => {
    const subject = product('top', 'upper_body');
    expect(kindOf(subject, context([], { reasons: [PRICE_BAND_REASON_LABEL], likeCount: 4 }))).toBeNull();
    expect(kindOf(subject, context([], { reasons: [PRICE_BAND_REASON_LABEL], likeCount: 5 }))).toBe('budget');
  });

  it('gives the Discover deck no wardrobe chip today, since it passes an empty wardrobe', () => {
    expect(kindOf(product('top', 'upper_body', ['navy']), context([]))).toBeNull();
  });
});
