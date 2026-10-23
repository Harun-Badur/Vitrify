import { isGarmentCategory, type GarmentCategory } from '../types/product';
import { wardrobeImage, type WardrobeItem } from '../types/wardrobe';
import type { OutfitCoverPart } from '../services/outfitCoverService';

/** Presentation metadata only; never persisted or inferred from image contents. */
export interface CollagePart extends OutfitCoverPart {
  category?: GarmentCategory;
  imageKind?: 'cutout';
}
export interface CollageTile {
  part: CollagePart;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function wardrobeCollagePart(item: WardrobeItem): CollagePart {
  const imageUrl = wardrobeImage(item);
  const verified =
    item.cutoutStatus === 'ready' &&
    !!imageUrl &&
    (imageUrl === item.cutoutUrl || imageUrl === item.cutoutLocalUri);
  return {
    key: `wardrobe:${item.id}`,
    source: 'wardrobe',
    sourceId: item.id,
    imageUrl,
    category: item.category,
    imageKind: verified ? 'cutout' : undefined,
  };
}

/** Use metadata only with its own URL, never attach cutout proof to a remote original. */
export function mergeCollageParts(
  remote: OutfitCoverPart[],
  local: CollagePart[],
): CollagePart[] {
  const known = new Map(
    local.map((part) => [`${part.source}:${part.sourceId}`, part]),
  );
  return remote.map((part) => {
    const cached = known.get(`${part.source}:${part.sourceId}`);
    return cached?.imageUrl
      ? { ...cached, key: part.key }
      : {
          key: part.key,
          source: part.source,
          sourceId: part.sourceId,
          imageUrl: part.imageUrl,
          category: cached?.category,
        };
  });
}

function moodboard(parts: readonly CollagePart[]): CollageTile[] {
  if (parts.length <= 1)
    return parts.map((part) => ({ part, x: 0, y: 0, width: 100, height: 100 }));
  // Two staggered columns keep every panel useful at the existing small card size.
  const leftCount = Math.ceil(parts.length / 2);
  return [parts.slice(0, leftCount), parts.slice(leftCount)].flatMap(
    (column, side) => {
      const weights = column.map((_, i) => ((i + side) % 2 === 0 ? 1.25 : 0.9));
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      let y = 0;
      return column.map((part, i) => {
        const height = (weights[i] / total) * 100;
        const tile = {
          part,
          x: side === 0 ? 0 : 56,
          y,
          width: side === 0 ? 56 : 44,
          height,
        };
        y += height;
        return tile;
      });
    },
  );
}

const accessory = (part: CollagePart) =>
  part.category === 'accessories' ||
  part.category === 'bags' ||
  part.category === 'hats';

function flatLay(parts: readonly CollagePart[]): CollageTile[] {
  const accessories = parts.filter(accessory);
  const main = parts.filter((part) => !accessory(part));
  const mainWidth = accessories.length ? 74 : 100;
  const bands = [
    { categories: ['upper_body', 'dresses'], weight: 0.42 },
    { categories: ['lower_body'], weight: 0.4 },
    { categories: ['shoes'], weight: 0.18 },
  ]
    .map((band) => ({
      ...band,
      parts: main.filter((part) => band.categories.includes(part.category!)),
    }))
    .filter((band) => band.parts.length);
  const total = bands.reduce((sum, band) => sum + band.weight, 0);
  let y = 0;
  const tiles = bands.flatMap((band) => {
    const height = (band.weight / total) * 100;
    // Repeated categories share their band instead of hiding one another.
    const columns = Math.min(band.parts.length, 2);
    const rows = Math.ceil(band.parts.length / columns);
    const result = band.parts.map((part, i) => ({
      part,
      x: ((i % columns) * mainWidth) / columns,
      y: y + (Math.floor(i / columns) * height) / rows,
      width: mainWidth / columns,
      height: height / rows,
    }));
    y += height;
    return result;
  });
  return [
    ...tiles,
    ...accessories.map((part, i) => ({
      part,
      x: main.length ? 74 : 25,
      y: i * Math.min(24, 100 / accessories.length),
      width: main.length ? 26 : 50,
      height: Math.min(24, 100 / accessories.length),
    })),
  ];
}

export function createCollageLayout(parts: readonly CollagePart[]): {
  mode: 'flat-lay' | 'moodboard';
  tiles: CollageTile[];
} {
  const clean =
    parts.length > 0 &&
    parts.every(
      (part) =>
        part.source === 'wardrobe' &&
        part.imageKind === 'cutout' &&
        !!part.imageUrl?.trim() &&
        isGarmentCategory(part.category),
    );
  return clean
    ? { mode: 'flat-lay', tiles: flatLay(parts) }
    : { mode: 'moodboard', tiles: moodboard(parts) };
}
