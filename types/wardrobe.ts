import type { GarmentCategory, Product } from './product';
export interface WardrobeCutoutResult {
  jobId: string; requestId: string; pngSha256: string; originalVersion: string;
}
export interface WardrobeItemConfirmation {
  owner: string; cloudItemId: string; originalPath: string; originalVersion?: string; cutoutProtocol?: 2;
}
export interface WardrobeItem {
  id: string;
  title: string;
  imageUrl: string;
  imageStoragePath?: string | null;
  imageLocalUri?: string;
  imageUrlExpiresAt?: number;
  // imageUrl always retains the original photo; cutouts are owned-clothes only.
  cutoutUrl?: string;
  cutoutLocalUri?: string;
  cutoutStoragePath?: string;
  cutoutUrlExpiresAt?: number;
  cutoutStatus?: 'pending' | 'ready' | 'error' | 'blocked';
  cutoutProtocol?: 2;
  originalVersion?: string;
  cutoutResult?: WardrobeCutoutResult;
  category: GarmentCategory;
  /** lib/styleVocabulary subtype slug. Local-only for now; older items may not have it. */
  subcategory?: string;
  /** lib/styleVocabulary color slug. Local-only for now; older items may not have it. */
  color?: string;
  brand: string;
  createdAt: string;
}

export const validWardrobeOriginalPath = (owner: string, path: string): boolean => {
  const parts = path.split('/');
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  return uuid.test(owner) && parts.length === 3 && parts[0] === owner && uuid.test(parts[1]) &&
    /^original-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}[.]png$/i.test(parts[2]);
};

const wardrobeImages = (item: WardrobeItem): string[] => [
  ...new Set(
    [item.cutoutUrl, item.cutoutLocalUri, item.imageUrl, item.imageLocalUri].filter(
      (uri): uri is string => typeof uri === 'string' && uri.trim().length > 0,
    ),
  ),
];

export const wardrobeImage = (item: WardrobeItem): string =>
  wardrobeImages(item)[0] ?? '';

export interface SavedOutfit {
  id: string;
  title: string;
  imageUrl?: string;
  wardrobeItemIds: string[];
  catalogProductIds: string[];
  createdAt: string;
}

// Presentation adapter only: owned clothes never enter catalog/favorites state.
export const wardrobeProduct = (item: WardrobeItem): Product => ({
  ...item,
  imageUrl: wardrobeImage(item),
  images: wardrobeImages(item),
  price: 0,
  garmentDescription: item.title,
});
