import { wardrobeImage, type WardrobeItem } from '../types/wardrobe';
import type { InsightWardrobeItem } from './insightChip';

/** Dolap kaydının chip girdisi: tek renk slug'ı ve alt tür aynen geçer; yoksa alan boş kalır (tahmin yok). */
export const toInsightWardrobeItems = (items: readonly WardrobeItem[]): InsightWardrobeItem[] =>
  items.map(item => ({
    id: item.id,
    category: item.category,
    subcategory: item.subcategory ?? null,
    colorSlugs: item.color ? [item.color] : undefined,
    imageUrl: wardrobeImage(item) || undefined,
  }));

/** Dolap değişince sıralı chip ataması baştan yapılsın diye kararlı bir parmak izi. */
export const insightWardrobeSignature = (items: readonly InsightWardrobeItem[]): string =>
  items.map(item => `${item.id}:${item.category}:${item.subcategory ?? ''}:${(item.colorSlugs ?? []).join(',')}`).join('|');
