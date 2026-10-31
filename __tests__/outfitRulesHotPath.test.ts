import { hasCoreFootwear, isValidOutfitItems, markValidOutfitItems } from '../src/intelligence/pairing/outfitRules';
import type { OutfitRole } from '../types/product';

const ROLES: OutfitRole[] = ['top', 'bottom', 'one_piece', 'shoes', 'outerwear', 'bag', 'hat', 'accessory'];
const wardrobe = (role: OutfitRole, index: number) => ({
  sourceType: 'wardrobe' as const, sourceId: `w-${role}-${index}`, role,
  wardrobeItem: { id: `w-${role}-${index}`, category: role },
});
const legacyCoreFootwear = (items: { role: string }[]): boolean =>
  items.some(item => item.role === 'shoes') && (items.some(item => item.role === 'one_piece') ||
    (items.some(item => item.role === 'top') && items.some(item => item.role === 'bottom')));

describe('outfit rule hot paths keep their results', () => {
  it('hasCoreFootwear matches the original some() formulation for every role multiset up to size 3', () => {
    const lists: OutfitRole[][] = [[]];
    for (const a of ROLES) { lists.push([a]); for (const b of ROLES) { lists.push([a, b]); for (const c of ROLES) lists.push([a, b, c]); } }
    for (const roles of lists) {
      const items = roles.map(wardrobe);
      expect(hasCoreFootwear(items)).toBe(legacyCoreFootwear(items));
    }
  });

  it('isValidOutfitItems gives the same answer with or without the conflict pre-check', () => {
    const lists: OutfitRole[][] = [['top', 'bottom'], ['one_piece'], ['top', 'bottom', 'shoes'], ['top', 'top', 'bottom'],
      ['one_piece', 'top'], ['top'], ['top', 'bottom', 'outerwear', 'bag', 'hat']];
    for (const roles of lists) {
      const items = roles.map(wardrobe);
      expect(isValidOutfitItems(items, true)).toBe(isValidOutfitItems(items));
    }
  });

  it('treats duplicate sources as invalid and distinguishes source types', () => {
    const top = wardrobe('top', 1);
    expect(isValidOutfitItems([top, { ...wardrobe('bottom', 1), sourceId: top.sourceId }])).toBe(false);
    expect(isValidOutfitItems([top, wardrobe('bottom', 1)])).toBe(true);
  });

  it('answers a marked candidate list from the generation proof, but never an unmarked copy', () => {
    const invalid = [wardrobe('top', 1), wardrobe('shoes', 1)];
    expect(isValidOutfitItems(invalid)).toBe(false);
    markValidOutfitItems(invalid);
    expect(isValidOutfitItems(invalid)).toBe(true);
    expect(isValidOutfitItems([...invalid])).toBe(false);
  });
});
