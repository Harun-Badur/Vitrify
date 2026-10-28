import { readFileSync } from 'fs';
import { join } from 'path';
import { selectInsightChip, type InsightChipContext, type InsightWardrobeItem } from '../lib/insightChip';
import { INSIGHT_CHIP_COPY } from '../lib/insightChipTemplates';
import { fromWardrobe } from '../src/intelligence/pairing/wardrobePairing';
import { colorCompatibility } from '../src/intelligence/pairing/pairing';
import type { PairItem } from '../src/intelligence/pairing/pairingTypes';
import type { OutfitRole, Product } from '../types/product';

// Faz 4 S4: the wardrobe chip decision comes from the pairing module (evaluatePair); insightChip
// no longer owns a category table or an exact-color rule. Wardrobe items skip the gender rule.

const product = (id: string, category: Product['category'], outfitRole: OutfitRole, colorSlugs?: string[],
  patch: Partial<Product> = {}): Product => ({
  id, imageUrl: `https://example.invalid/${id}.jpg`, title: id, price: 500, brand: 'Test', category, outfitRole,
  colorSlugs, garmentDescription: id, ...patch,
});
const item = (id: string, category: string, subcategory: string | null, colorSlugs?: string[]): InsightWardrobeItem =>
  ({ id, category, subcategory, colorSlugs });
const context = (wardrobe: InsightWardrobeItem[]): InsightChipContext =>
  ({ reasons: [], wardrobe, likeCount: 0, recentKinds: [] });
const filler = [item('f1', 'shoes', 'sneaker', ['beyaz']), item('f2', 'bags', 'canta', ['kahverengi'])];

describe('fromWardrobe adapter', () => {
  it('resolves a role from the category, and an upper-body role only from its subtype', () => {
    expect(fromWardrobe(item('a', 'lower_body', 'jean', ['navy'])).role.value).toBe('bottom');
    expect(fromWardrobe(item('b', 'upper_body', 'blazer', ['navy'])).role.value).toBe('outerwear');
    expect(fromWardrobe(item('c', 'upper_body', 'tisort', ['navy'])).role.value).toBe('top');
    expect(fromWardrobe(item('d', 'upper_body', null, ['navy'])).role.value).toBeNull();
    expect(fromWardrobe(item('e', 'upper_body', 'bilinmeyen', ['navy'])).role.value).toBeNull();
  });

  it('marks the item as a wardrobe item with no gender evidence, and normalizes colors', () => {
    const pair: PairItem = fromWardrobe(item('a', 'lower_body', 'jean', [' Navy ']));
    expect(pair.origin).toBe('wardrobe');
    expect(pair.gender.value).toBeNull();
    expect(colorCompatibility({ ...pair, colors: ['navy'] }, { ...pair, colors: ['navy'] })).toBe('compatible');
  });

  it('reports colors as unknown when the item has none', () => {
    const none = fromWardrobe(item('a', 'lower_body', 'jean'));
    expect(colorCompatibility(none, { ...none, colors: ['navy'] })).toBe('unknown');
    expect(colorCompatibility({ ...none, colors: ['kirmizi'] }, { ...none, colors: ['yesil'] })).toBe('incompatible');
    expect(colorCompatibility({ ...none, colors: ['kirmizi'] }, { ...none, colors: ['siyah'] })).toBe('compatible');
  });
});

describe('wardrobe chip decided by pairing (deliberate changes from the S1 characterization)', () => {
  it('C1 old none -> new chip: a dress pairs with an outer layer of the same color', () => {
    const chip = selectInsightChip(product('dress', 'dresses', 'one_piece', ['siyah']),
      context([item('blazer', 'upper_body', 'blazer', ['siyah']), ...filler]));
    expect(chip?.kind).toBe('wardrobe_match');
    expect(chip?.matchedItem?.id).toBe('blazer');
  });

  it('C1 unchanged: a dress still does not pair with a plain top (layering varies, not a complement)', () => {
    expect(selectInsightChip(product('dress', 'dresses', 'one_piece', ['siyah']),
      context([item('shirt', 'upper_body', 'gomlek', ['siyah']), item('s2', 'upper_body', 'tisort', ['siyah']),
        item('s3', 'upper_body', 'polo', ['siyah'])]))).toBeNull();
  });

  it('C2 old none -> new chip: an upper-body product pairs with an outer layer, not with another top', () => {
    const outer = selectInsightChip(product('shirt', 'upper_body', 'top', ['beyaz']),
      context([item('coat', 'upper_body', 'mont', ['beyaz']), ...filler]));
    expect(outer?.kind).toBe('wardrobe_match');
    expect(outer?.matchedItem?.id).toBe('coat');
    expect(selectInsightChip(product('shirt', 'upper_body', 'top', ['beyaz']),
      context([item('tee', 'upper_body', 'tisort', ['beyaz']), item('p', 'upper_body', 'polo', ['beyaz']),
        item('b', 'upper_body', 'bluz', ['beyaz'])]))).toBeNull();
  });

  it('C3 old none -> new chip: a neutral color is compatible', () => {
    const chip = selectInsightChip(product('top', 'upper_body', 'top', ['navy']),
      context([item('jean', 'lower_body', 'jean', ['siyah']), ...filler]));
    expect(chip?.kind).toBe('wardrobe_match');
    expect(chip?.matchedItem?.id).toBe('jean');
  });

  it('C3 unchanged: two different non-neutral colors are no evidence', () => {
    expect(selectInsightChip(product('top', 'upper_body', 'top', ['kirmizi']),
      context([item('pant', 'lower_body', 'pantolon', ['yesil']), item('own', 'upper_body', 'tisort', ['mor']),
        ...filler.map(entry => ({ ...entry, colorSlugs: ['mor'] }))]))).toBeNull();
  });

  it('C4 old none -> new chip: color slugs are normalized before comparing', () => {
    const chip = selectInsightChip(product('top', 'upper_body', 'top', ['Navy']),
      context([item('jean', 'lower_body', 'jean', ['navy']), ...filler]));
    expect(chip?.kind).toBe('wardrobe_match');
  });

  it('C5 old completes_wardrobe -> new none: wardrobe items without a color are uncertain, no chip', () => {
    expect(selectInsightChip(product('bag', 'bags', 'bag', ['siyah']),
      context([item('tee', 'upper_body', 'tisort'), item('jean', 'lower_body', 'jean'), item('dress', 'dresses', 'elbise')])))
      .toBeNull();
  });

  it('C5 still completes the wardrobe when the items are known but no color matches', () => {
    const chip = selectInsightChip(product('bag', 'bags', 'bag', ['kirmizi']),
      context([item('tee', 'upper_body', 'tisort', ['yesil']), item('jean', 'lower_body', 'jean', ['mor']), item('dress', 'dresses', 'elbise', ['sari'])]));
    expect(chip?.kind).toBe('completes_wardrobe');
    expect(chip?.evidence.map(entry => entry.id)).toEqual(['tee', 'jean', 'dress', 'bag']);
  });

  it('C6 old none -> new chip: a hat pairs with a bottom of a compatible color', () => {
    const chip = selectInsightChip(product('hat', 'hats', 'hat', ['bej']),
      context([item('chino', 'lower_body', 'pantolon', ['bej']), ...filler]));
    expect(chip?.kind).toBe('wardrobe_match');
  });

  it('an item with an unknown upper-body role is uncertain (no chip)', () => {
    expect(selectInsightChip(product('pant', 'lower_body', 'bottom', ['siyah']),
      context([item('u1', 'upper_body', null, ['siyah']), item('u2', 'upper_body', null, ['siyah']), item('u3', 'upper_body', null, ['siyah'])])))
      .toBeNull();
  });

  it('applies no gender rule to wardrobe items, even for a gendered product', () => {
    const chip = selectInsightChip(product('top', 'upper_body', 'top', ['siyah'], { gender: 'women' }),
      context([item('jean', 'lower_body', 'jean', ['siyah']), ...filler]));
    expect(chip?.kind).toBe('wardrobe_match');
  });

  it('a coarse season conflict stops the chip (mont product, şort in the wardrobe)', () => {
    expect(selectInsightChip(product('coat', 'upper_body', 'outerwear', ['siyah'], { title: 'Erkek Şişme Mont', subcategory: 'mont' }),
      context([item('shorts', 'lower_body', 'sort', ['siyah']), item('s', 'lower_body', 'sort', ['siyah']), item('s2', 'lower_body', 'sort', ['siyah'])])))
      .toBeNull();
  });
});

describe('chip text names a color and subtype only when both are reliable', () => {
  const evidenceLabel = (wardrobeItem: InsightWardrobeItem) => selectInsightChip(
    product('top', 'upper_body', 'top', ['navy']), context([wardrobeItem, ...filler]))?.evidence[0].label;

  it('writes "lacivert jean" for a known color and a valid subtype', () => {
    expect(evidenceLabel(item('jean', 'lower_body', 'jean', ['navy']))).toBe(INSIGHT_CHIP_COPY.wardrobeEvidence('lacivert jean'));
  });

  it('falls back to the category when the subtype is missing, invalid or unknown (diger)', () => {
    expect(evidenceLabel(item('p', 'lower_body', null, ['navy']))).toBe(INSIGHT_CHIP_COPY.wardrobeEvidence('alt giyim'));
    expect(evidenceLabel(item('p', 'lower_body', 'nope', ['navy']))).toBe(INSIGHT_CHIP_COPY.wardrobeEvidence('alt giyim'));
  });

  it('treats a color outside the vocabulary as unknown: no chip at all', () => {
    const chip = selectInsightChip(product('top', 'upper_body', 'top', ['navy']),
      context([item('p', 'lower_body', 'jean', ['ucube']), ...filler]));
    expect(chip?.matchedItem?.id).not.toBe('p');
  });
});

describe('insightChip owns no pairing rules', () => {
  const source = readFileSync(join(__dirname, '..', 'lib/insightChip.ts'), 'utf8');

  it('has no category table and no exact color comparison', () => {
    expect(source).not.toMatch(/COMPLEMENTS/);
    expect(source).not.toMatch(/colorSlugs \?\? \[\]\)\.some/);
    expect(source).toMatch(/evaluatePair|catalogPairing|wardrobePairing/);
  });
});
