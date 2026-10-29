import { evidenceCopy } from '../lib/insightChipEvidence';
import { selectInsightChip, type InsightChipContext, type InsightWardrobeItem } from '../lib/insightChip';
import { colorCompatibility, pairEvidenceKinds } from '../src/intelligence/pairing/pairing';
import { fromWardrobe } from '../src/intelligence/pairing/wardrobePairing';
import { ACTIVE_CATALOG_PAIRING_POLICY } from '../src/intelligence/recommendations/catalogPairing';
import type { OutfitRole, Product } from '../types/product';

const product = (id: string, category: Product['category'], outfitRole: OutfitRole, colorSlugs?: string[],
  patch: Partial<Product> = {}): Product => ({
  id, imageUrl: `https://example.invalid/${id}.jpg`, title: id, price: 500, brand: 'Test', category, outfitRole,
  colorSlugs, garmentDescription: id, ...patch,
});
const item = (id: string, category: string, subcategory: string | null, colorSlugs?: string[]): InsightWardrobeItem =>
  ({ id, category, subcategory, colorSlugs });
const context = (wardrobe: InsightWardrobeItem[], reasons: unknown = []): InsightChipContext =>
  ({ reasons, wardrobe, likeCount: 0, recentKinds: [] });
const filler = [item('f1', 'shoes', 'sneaker', ['beyaz']), item('f2', 'bags', 'canta', ['kahverengi'])];

describe('evidence kind -> text table', () => {
  it('names only the color when color is the only evidence', () => {
    const copy = evidenceCopy(['color']);
    expect(copy?.phrase).toBe('Renk uyumlu');
    expect(copy?.label).not.toMatch(/tam uyumlu/i);
    expect(copy?.summary).toBe('Dolabındaki bir parçayla renk uyumlu.');
  });

  it('writes "resmiyet" for formality, never "tarz", in any key order', () => {
    expect(evidenceCopy(['color', 'formality'])?.phrase).toBe('Renk ve resmiyet uyumlu');
    expect(evidenceCopy(['formality', 'color'])?.phrase).toBe('Renk ve resmiyet uyumlu');
  });

  it('never uses the word "tarz" or a bare "uyumlu" claim', () => {
    for (const kinds of [['color'], ['color', 'formality'], ['color', 'season'], ['color', 'formality', 'season']] as const) {
      const copy = evidenceCopy(kinds);
      expect(copy).not.toBeNull();
      expect(`${copy?.phrase} ${copy?.label} ${copy?.summary}`).not.toMatch(/tarz/i);
      expect(copy?.label).not.toBe('Dolabındakiyle uyumlu');
    }
  });

  it('has no text without a color or without any evidence', () => {
    expect(evidenceCopy([])).toBeNull();
    expect(evidenceCopy(['formality'])).toBeNull();
  });
});

describe('pairEvidenceKinds (pairing module)', () => {
  const policy = ACTIVE_CATALOG_PAIRING_POLICY;
  const pair = (subtype: string | null, category: string, colors: string[]) =>
    fromWardrobe({ id: 'x', category, subcategory: subtype, colorSlugs: colors });

  it('lists color alone when subtypes carry no formality', () => {
    expect(pairEvidenceKinds(pair('tisort', 'upper_body', ['siyah']), pair('jean', 'lower_body', ['siyah']), policy)).toEqual(['color']);
  });

  it('adds formality when both reliable subtypes share it, and omits an unknown or incompatible color', () => {
    expect(pairEvidenceKinds(pair('hoodie', 'upper_body', ['siyah']), pair('sort', 'lower_body', ['siyah']), policy))
      .toEqual(['color', 'formality']);
    expect(pairEvidenceKinds(pair('hoodie', 'upper_body', ['kirmizi']), pair('sort', 'lower_body', ['yesil']), policy))
      .toEqual(['formality']);
    expect(pairEvidenceKinds(pair('hoodie', 'upper_body', []), pair('sort', 'lower_body', ['yesil']), policy)).toEqual(['formality']);
  });

  it('sanity: color helper agrees with the kinds', () => {
    const a = pair('tisort', 'upper_body', ['siyah']);
    const b = pair('jean', 'lower_body', ['mor']);
    expect(colorCompatibility(a, b)).toBe('compatible');
    expect(pairEvidenceKinds(a, b, policy)).toContain('color');
  });
});

describe('wardrobe chip text follows the evidence', () => {
  it('color-only match says "renk uyumlu" (no bare "uyumlu")', () => {
    const chip = selectInsightChip(product('top', 'upper_body', 'top', ['navy']),
      context([item('jean', 'lower_body', 'jean', ['siyah']), ...filler]));
    expect(chip?.kind).toBe('wardrobe_match');
    expect(chip?.label).toBe(evidenceCopy(['color'])?.label);
    expect(chip?.summary).toBe(evidenceCopy(['color'])?.summary);
    expect(chip?.label).not.toBe('Dolabındakiyle uyumlu');
  });

  it('color + shared formality says "renk ve resmiyet uyumlu"', () => {
    const chip = selectInsightChip(product('hoodie', 'upper_body', 'top', ['siyah'], { subcategory: 'hoodie' }),
      context([item('shorts', 'lower_body', 'sort', ['siyah']), ...filler]));
    expect(chip?.kind).toBe('wardrobe_match');
    expect(chip?.summary).toBe(evidenceCopy(['color', 'formality'])?.summary);
    expect(chip?.summary).toMatch(/resmiyet/);
  });
});

describe('Faz 5 chip behaviour with a real wardrobe', () => {
  it('empty wardrobe: no wardrobe chip, no crash; the product evidence alone shows no chip', () => {
    expect(selectInsightChip(product('top', 'upper_body', 'top', ['navy']), context([]))).toBeNull();
  });

  it('wardrobe under the minimum size: no wardrobe chip', () => {
    expect(selectInsightChip(product('top', 'upper_body', 'top', ['navy']),
      context([item('jean', 'lower_body', 'jean', ['siyah'])]))).toBeNull();
  });

  it('filled wardrobe: a chip with a non-empty label and summary', () => {
    const chip = selectInsightChip(product('top', 'upper_body', 'top', ['navy']),
      context([item('jean', 'lower_body', 'jean', ['siyah']), ...filler]));
    expect(chip?.label.trim().length).toBeGreaterThan(0);
    expect(chip?.summary.trim().length).toBeGreaterThan(0);
    expect(chip?.evidence.some(entry => entry.source === 'wardrobe')).toBe(true);
  });

  it('unknown product color: no wardrobe chip', () => {
    expect(selectInsightChip(product('top', 'upper_body', 'top', undefined),
      context([item('jean', 'lower_body', 'jean', ['siyah']), ...filler]))).toBeNull();
  });

  it('incompatible product (two different chromatic colors): no chip', () => {
    expect(selectInsightChip(product('top', 'upper_body', 'top', ['kirmizi']),
      context([item('pant', 'lower_body', 'pantolon', ['yesil']), item('own', 'upper_body', 'tisort', ['mor']),
        ...filler.map(entry => ({ ...entry, colorSlugs: ['mor'] }))]))).toBeNull();
  });

  it('wardrobe match wins over a style reason and over completes_wardrobe; one chip only', () => {
    const chip = selectInsightChip(product('top', 'upper_body', 'top', ['navy']),
      context([item('jean', 'lower_body', 'jean', ['siyah']), ...filler], ['Sevdiğin renk: Lacivert']));
    expect(chip?.kind).toBe('wardrobe_match');
  });

  it('falls back to a style reason when the wardrobe gives no chip', () => {
    expect(selectInsightChip(product('top', 'upper_body', 'top', ['navy']), context([], ['Sevdiğin renk: Lacivert']))?.kind)
      .toBe('style_fit');
  });
});
