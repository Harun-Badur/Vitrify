import { UPPER_SUBCATEGORY_ROLE } from './outfitRules.ts';
import type { PairItem, PairRole } from './pairingTypes.ts';

/** The wardrobe item fields the pairing view reads; callers pass only a subtype they have validated. */
export interface PairWardrobeItem {
  id: string;
  category: string;
  subcategory?: string | null;
  colorSlugs?: readonly string[];
}

const CATEGORY_ROLE: Readonly<Record<string, PairRole>> = {
  lower_body: 'bottom',
  dresses: 'one_piece',
  shoes: 'shoes',
  bags: 'bag',
  hats: 'hat',
  accessories: 'accessory',
};

/**
 * Pairing view of a wardrobe item (Faz 4 S4). Gender is unknown and the item is marked as a
 * wardrobe item, so the gender rule does not apply to it. An upper-body item has a role only
 * through its subtype; without one the role stays unknown (uncertain, never guessed).
 */
export const fromWardrobe = (item: PairWardrobeItem): PairItem => {
  const category = item.category.trim().toLocaleLowerCase('tr-TR');
  const subtype = item.subcategory?.trim().toLocaleLowerCase('tr-TR') || null;
  const role: PairRole | null = category === 'upper_body'
    ? (subtype ? UPPER_SUBCATEGORY_ROLE[subtype] ?? null : null)
    : CATEGORY_ROLE[category] ?? null;
  return {
    id: item.id,
    origin: 'wardrobe',
    colors: item.colorSlugs ?? [],
    role: role === null
      ? { value: null, source: 'unknown', confidence: 'unknown' }
      : { value: role, source: 'category_rule', confidence: 'high' },
    gender: { value: null, source: 'unknown', confidence: 'unknown' },
    subtype: subtype === null
      ? { value: null, source: 'unknown', confidence: 'unknown' }
      : { value: subtype, source: 'product_snapshot', confidence: 'high' },
    conflicts: [],
  };
};
