import { PRICE_BAND_REASON_LABEL } from '../lib/displayReason';
import {
  BUDGET_CHIP_MIN_LIKES,
  MAX_CONSECUTIVE_SAME_KIND,
  MIN_WARDROBE_ITEMS_FOR_INSIGHT,
  assignInsightChips,
  createInsightChipSequence,
  isWardrobeEvidenceKind,
  parseReasonSignals,
  selectInsightChip,
  type InsightChipContext,
  type InsightChipKind,
  type InsightWardrobeItem,
} from '../lib/insightChip';
import { INSIGHT_CHIP_COPY } from '../lib/insightChipTemplates';
import type { Product } from '../types/product';

const product = (id: string, patch: Partial<Product> = {}): Product => ({
  id,
  imageUrl: `https://img/${id}.jpg`,
  title: `Ürün ${id}`,
  price: 100,
  brand: 'Marka',
  category: 'upper_body',
  garmentDescription: '',
  colorSlugs: ['siyah'],
  ...patch,
});

const wardrobeItem = (id: string, patch: Partial<InsightWardrobeItem> = {}): InsightWardrobeItem => ({
  id,
  category: 'lower_body',
  colorSlugs: ['siyah'],
  imageUrl: `https://w/${id}.jpg`,
  ...patch,
});

const context = (patch: Partial<InsightChipContext> = {}): InsightChipContext => ({
  reasons: [],
  wardrobe: [],
  likeCount: 0,
  recentKinds: [],
  ...patch,
});

const fullWardrobe = [
  wardrobeItem('w1'),
  wardrobeItem('w2', { category: 'shoes', colorSlugs: ['beyaz'] }),
  wardrobeItem('w3', { category: 'bags', colorSlugs: ['kahverengi'] }),
];

describe('parseReasonSignals', () => {
  it('maps the legacy reason labels to chip kinds', () => {
    const signals = parseReasonSignals([
      'Sevdiğin renk: Siyah', 'Sevdiğin marka', 'Bu kategoriyi sık beğeniyorsun',
      'Minimal stiline yakın', PRICE_BAND_REASON_LABEL, 'Yeni bir şey dene',
    ]);
    expect(signals.map(signal => signal.kind)).toEqual([
      'style_fit', 'style_fit', 'style_fit', 'style_fit', 'budget', 'discovery',
    ]);
  });

  it('tolerates old or malformed cached reasons without throwing', () => {
    expect(parseReasonSignals(undefined)).toEqual([]);
    expect(parseReasonSignals(null)).toEqual([]);
    expect(parseReasonSignals('Sevdiğin marka')).toEqual([]);
    expect(parseReasonSignals([42, null, {}, '   ', 'Bilinmeyen eski etiket'])).toEqual([]);
    expect(parseReasonSignals(['  Sevdiğin marka  '])).toEqual([{ kind: 'style_fit', label: 'Sevdiğin marka' }]);
  });
});

describe('selectInsightChip', () => {
  it('returns null when there is no evidence', () => {
    expect(selectInsightChip(product('p'), context())).toBeNull();
    expect(selectInsightChip(product('p'), context({ reasons: ['eski etiket'] }))).toBeNull();
  });

  it('follows the priority wardrobe match > completes wardrobe > style > budget > discovery', () => {
    const reasons = ['Yeni bir şey dene', PRICE_BAND_REASON_LABEL, 'Sevdiğin marka'];
    const likeCount = BUDGET_CHIP_MIN_LIKES;
    expect(selectInsightChip(product('p'), context({ reasons, likeCount, wardrobe: fullWardrobe }))?.kind)
      .toBe('wardrobe_match');
    const noColorMatch = fullWardrobe.map(item => ({ ...item, colorSlugs: ['mor'] }));
    expect(selectInsightChip(product('p'), context({ reasons, likeCount, wardrobe: noColorMatch }))?.kind)
      .toBe('completes_wardrobe');
    expect(selectInsightChip(product('p'), context({ reasons, likeCount }))?.kind).toBe('style_fit');
    expect(selectInsightChip(product('p'), context({ reasons: reasons.slice(0, 2), likeCount }))?.kind).toBe('budget');
    expect(selectInsightChip(product('p'), context({ reasons: reasons.slice(0, 1), likeCount }))?.kind).toBe('discovery');
  });

  it('only produces wardrobe chips with enough wardrobe pieces', () => {
    const tooFew = fullWardrobe.slice(0, MIN_WARDROBE_ITEMS_FOR_INSIGHT - 1);
    expect(selectInsightChip(product('p'), context({ wardrobe: tooFew }))).toBeNull();
    const chip = selectInsightChip(product('p'), context({ wardrobe: fullWardrobe }));
    expect(chip?.kind).toBe('wardrobe_match');
    expect(chip?.matchedItem?.id).toBe('w1');
    expect(chip?.evidence[0]).toMatchObject({ id: 'w1', source: 'wardrobe', imageUrl: 'https://w/w1.jpg' });
  });

  it('does not claim the wardrobe is completed when the category is already owned', () => {
    const owned = [...fullWardrobe.map(item => ({ ...item, colorSlugs: ['mor'] })),
      wardrobeItem('w4', { category: 'upper_body', colorSlugs: ['mor'] })];
    expect(selectInsightChip(product('p'), context({ wardrobe: owned }))).toBeNull();
  });

  it('marks wardrobe chips as animated-eye kinds and neutral chips as static', () => {
    expect(isWardrobeEvidenceKind('wardrobe_match')).toBe(true);
    expect(isWardrobeEvidenceKind('completes_wardrobe')).toBe(true);
    (['style_fit', 'budget', 'discovery'] as const).forEach(kind => expect(isWardrobeEvidenceKind(kind)).toBe(false));
  });

  it('uses fixed Turkish templates for the label', () => {
    expect(selectInsightChip(product('p'), context({ reasons: ['Sevdiğin marka'] }))?.label)
      .toBe(INSIGHT_CHIP_COPY.chipLabel.style_fit);
    expect(selectInsightChip(product('p'), context({ reasons: ['Yeni bir şey dene'] }))?.label)
      .toBe(INSIGHT_CHIP_COPY.chipLabel.discovery);
  });

  it('skips hidden kinds', () => {
    expect(selectInsightChip(product('p'), context({ reasons: ['Sevdiğin marka', 'Yeni bir şey dene'],
      hiddenKinds: new Set<InsightChipKind>(['style_fit']) }))?.kind).toBe('discovery');
  });
});

describe('budget evidence threshold', () => {
  it('is a named constant above a single like', () => {
    expect(BUDGET_CHIP_MIN_LIKES).toBeGreaterThan(1);
  });

  it('hides the budget chip below the threshold and shows it at the threshold', () => {
    const reasons = [PRICE_BAND_REASON_LABEL];
    expect(selectInsightChip(product('p'), context({ reasons, likeCount: 0 }))).toBeNull();
    expect(selectInsightChip(product('p'), context({ reasons, likeCount: BUDGET_CHIP_MIN_LIKES - 1 }))).toBeNull();
    const chip = selectInsightChip(product('p'), context({ reasons, likeCount: BUDGET_CHIP_MIN_LIKES }));
    expect(chip?.kind).toBe('budget');
    expect(chip?.label).toBe(INSIGHT_CHIP_COPY.chipLabel.budget);
  });

  it('falls through to a lower-priority chip when budget evidence is too thin', () => {
    expect(selectInsightChip(product('p'), context({ reasons: [PRICE_BAND_REASON_LABEL, 'Yeni bir şey dene'],
      likeCount: 1 }))?.kind).toBe('discovery');
  });
});

describe('frequency cap', () => {
  it(`never shows the same kind on ${MAX_CONSECUTIVE_SAME_KIND + 1} consecutive cards`, () => {
    expect(MAX_CONSECUTIVE_SAME_KIND).toBe(2);
    const style = ['Sevdiğin marka'];
    expect(selectInsightChip(product('p'), context({ reasons: style, recentKinds: ['style_fit'] }))?.kind).toBe('style_fit');
    expect(selectInsightChip(product('p'), context({ reasons: style, recentKinds: ['style_fit', 'style_fit'] }))).toBeNull();
    expect(selectInsightChip(product('p'), context({ reasons: style, recentKinds: ['style_fit', null, 'style_fit'] }))?.kind)
      .toBe('style_fit');
  });

  it('falls back to the next kind when the top kind is capped', () => {
    expect(selectInsightChip(product('p'), context({ reasons: ['Sevdiğin marka', 'Yeni bir şey dene'],
      recentKinds: ['style_fit', 'style_fit'] }))?.kind).toBe('discovery');
  });

  it('assigns a deck in order without three identical kinds in a row', () => {
    const deck = Array.from({ length: 7 }, (_, index) => product(`p${index}`, { reasons: ['Sevdiğin marka'] }));
    const state = assignInsightChips(deck, { wardrobe: [], likeCount: 0 }, createInsightChipSequence());
    expect(deck.map(item => state.chips.get(item.id)?.kind ?? null)).toEqual([
      'style_fit', 'style_fit', null, 'style_fit', 'style_fit', null, 'style_fit',
    ]);
  });

  it('keeps earlier assignments stable when the deck shrinks or grows', () => {
    const deck = Array.from({ length: 4 }, (_, index) => product(`p${index}`, { reasons: ['Sevdiğin marka'] }));
    const first = assignInsightChips(deck, { wardrobe: [], likeCount: 0 }, createInsightChipSequence());
    const more = [...deck.slice(2), product('p4', { reasons: ['Sevdiğin marka'] })];
    const second = assignInsightChips(more, { wardrobe: [], likeCount: 0 }, first);
    expect(second.chips.get('p2')).toBe(first.chips.get('p2'));
    expect(second.chips.get('p3')).toBe(first.chips.get('p3'));
    expect(second.chips.get('p4')?.kind).toBe('style_fit');
    expect(second.recentKinds).toEqual(['style_fit', 'style_fit']);
  });

  it('survives products from old cache entries without reasons', () => {
    const legacy = { ...product('old'), reasons: 'not-an-array' as unknown as string[] };
    const state = assignInsightChips([legacy, product('none')], { wardrobe: [], likeCount: 0 }, createInsightChipSequence());
    expect(state.chips.get('old')).toBeNull();
    expect(state.chips.get('none')).toBeNull();
  });
});
