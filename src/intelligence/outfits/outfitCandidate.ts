import { isOutfitRole, type OutfitRole, type Product } from '../../../types/product';
import { UPPER_SUBCATEGORY_ROLE } from '../pairing/outfitRules.ts';

// The structural rules live in the pairing module (Faz 4 S3); these names stay for existing imports.
export {
  hasCoreFootwear,
  hasGenderConflict,
  hasHardConflict,
  isCatalogRoleCompatible,
  isValidOutfitItems,
} from '../pairing/outfitRules.ts';

/** Fields already present on public.wardrobe_items that candidate generation needs. */
export interface WardrobeItemForCandidate {
  id: string;
  category: string;
  subcategory?: string | null;
}

export type OutfitSourceType = 'wardrobe' | 'catalog';

export type OutfitCandidateItem<T extends WardrobeItemForCandidate = WardrobeItemForCandidate> =
  | {
      sourceType: 'wardrobe';
      sourceId: string;
      role: OutfitRole;
      wardrobeItem: T;
      product?: never;
    }
  | {
      sourceType: 'catalog';
      sourceId: string;
      role: OutfitRole;
      product: Product;
      wardrobeItem?: never;
    };

export interface OutfitCandidate<T extends WardrobeItemForCandidate = WardrobeItemForCandidate> {
  id: string;
  items: OutfitCandidateItem<T>[];
  roles: OutfitRole[];
  sources: OutfitSourceType[];
}

export const OUTFIT_ROLE_ORDER: readonly OutfitRole[] = [
  'top', 'bottom', 'one_piece', 'outerwear', 'shoes', 'bag', 'hat', 'accessory',
];

const CATEGORY_ROLE: Readonly<Record<string, OutfitRole>> = {
  lower_body: 'bottom',
  dresses: 'one_piece',
  shoes: 'shoes',
  bags: 'bag',
  hats: 'hat',
  accessories: 'accessory',
};

export const resolveWardrobeRole = (item: WardrobeItemForCandidate): OutfitRole | null => {
  const category = item.category.trim().toLocaleLowerCase('tr-TR');
  if (isOutfitRole(category)) return category;
  if (category === 'upper_body') {
    const subcategory = item.subcategory?.trim().toLocaleLowerCase('tr-TR') ?? '';
    return UPPER_SUBCATEGORY_ROLE[subcategory] ?? null;
  }
  return CATEGORY_ROLE[category] ?? null;
};
