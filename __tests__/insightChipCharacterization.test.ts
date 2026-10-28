import { PRICE_BAND_REASON_LABEL } from '../lib/displayReason';
import { selectInsightChip, type InsightChipContext, type InsightWardrobeItem } from '../lib/insightChip';
import type { Product } from '../types/product';

// Phase 4 S1: pins what selectInsightChip decides today, including where it disagrees with the
// compatibility policy (docs/faz4-uyum-ayrisma.md, rows C1–C6). Do not "fix" these here; the
// pairing module changes them deliberately in S4 with an approved diff list.

const product = (id: string, category: Product['category'], colorSlugs?: string[]): Product => ({
  id,
  imageUrl: `https://example.invalid/${id}.jpg`,
  title: id,
  price: 500,
  brand: 'Test',
  category,
  colorSlugs,
  garmentDescription: id,
});

const item = (id: string, category: string, colorSlugs?: string[]): InsightWardrobeItem =>
  ({ id, category, subcategory: null, colorSlugs });

const context = (wardrobe: InsightWardrobeItem[], overrides: Partial<InsightChipContext> = {}): InsightChipContext =>
  ({ reasons: [], wardrobe, likeCount: 0, recentKinds: [], ...overrides });

const kindOf = (subject: Product, ctx: InsightChipContext) => selectInsightChip(subject, ctx)?.kind ?? null;

describe('insight chip characterization (current behavior)', () => {
  it('matches a complementary wardrobe item that shares an exact color slug', () => {
    const chip = selectInsightChip(product('top', 'upper_body', ['navy']), context([
      item('jean', 'lower_body', ['navy']), item('tee', 'upper_body', ['beyaz']), item('sneaker', 'shoes', ['beyaz']),
    ]));
    expect(chip?.kind).toBe('wardrobe_match');
    expect(chip?.matchedItem?.id).toBe('jean');
  });

  it('C1: a dress never pairs with an upper-body wardrobe item, even an outer layer of the same color', () => {
    expect(kindOf(product('dress', 'dresses', ['siyah']), context([
      item('blazer', 'upper_body', ['siyah']), item('coat', 'upper_body', ['siyah']), item('shirt', 'upper_body', ['siyah']),
    ]))).toBeNull();
  });

  it('C2: an upper-body product never pairs with an upper-body wardrobe item (top with outer layer)', () => {
    expect(kindOf(product('shirt', 'upper_body', ['beyaz']), context([
      item('blazer', 'upper_body', ['beyaz']), item('coat', 'upper_body', ['beyaz']), item('cardigan', 'upper_body', ['beyaz']),
    ]))).toBeNull();
  });

  it('C3: a neutral color is not a match, unlike the outfit scorer which gives it 0.5', () => {
    expect(kindOf(product('top', 'upper_body', ['navy']), context([
      item('jean', 'lower_body', ['siyah']), item('tee', 'upper_body', ['beyaz']), item('sneaker', 'shoes', ['beyaz']),
    ]))).toBeNull();
  });

  it('C4: color slugs are compared without normalization', () => {
    expect(kindOf(product('top', 'upper_body', ['Navy']), context([
      item('jean', 'lower_body', ['navy']), item('tee', 'upper_body', ['beyaz']), item('sneaker', 'shoes', ['beyaz']),
    ]))).toBeNull();
  });

  it('C5: a wardrobe without the product category yields completes_wardrobe even when no item has a color', () => {
    const chip = selectInsightChip(product('bag', 'bags', ['siyah']), context([
      item('tee', 'upper_body'), item('jean', 'lower_body'), item('dress', 'dresses'),
    ]));
    expect(chip?.kind).toBe('completes_wardrobe');
    expect(chip?.evidence.map((entry) => entry.id)).toEqual(['tee', 'jean', 'dress', 'bag']);
  });

  it('C6: a hat pairs only with upper body and dresses, not with a lower-body item of the same color', () => {
    expect(kindOf(product('hat', 'hats', ['bej']), context([
      item('chino', 'lower_body', ['bej']), item('hat2', 'hats', ['bej']), item('loafer', 'shoes', ['bej']),
    ]))).toBeNull();
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
