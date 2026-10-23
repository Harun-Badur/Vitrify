import { useOwnedState } from '../hooks/useOwnedState';
import { trackOwnerWork } from '../lib/accountDeviceWork';
import { useEffect, useMemo } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import { logger } from '../lib/logger';
import { useAppStore } from '../store/useAppStore';
import { type SavedOutfit } from '../types/wardrobe';
import OutfitCollage from './OutfitCollage';
import {
  mergeCollageParts,
  wardrobeCollagePart,
  type CollagePart,
} from '../lib/outfitCollage';
import {
  fetchOutfitCoverParts,
  type OutfitCoverPart,
} from '../services/outfitCoverService';

export default function OutfitCover({
  outfit,
  style,
}: {
  outfit: SavedOutfit;
  style?: StyleProp<ViewStyle>;
}) {
  const owner = useAppStore((state) => state.sessionUserId);
  const clothes = useAppStore((state) => state.wardrobeItems);
  const favorites = useAppStore((state) => state.likedProducts);
  const currentProducts = useAppStore((state) => state.currentProducts);
  const local = useMemo(() => {
    const wardrobe = new Map(
      clothes.map((item) => [item.id, wardrobeCollagePart(item)]),
    );
    const catalog = new Map(
      [
        ...(currentProducts ?? []),
        ...favorites.map(({ product }) => product),
      ].map((product) => [product.id, product]),
    );
    return [
      ...outfit.wardrobeItemIds.map(
        (id): CollagePart =>
          wardrobe.get(id) ?? {
            key: `wardrobe:${id}`,
            source: 'wardrobe',
            sourceId: id,
          },
      ),
      ...outfit.catalogProductIds.map((id): CollagePart => ({
        key: `catalog:${id}`,
        source: 'catalog',
        sourceId: id,
        imageUrl: catalog.get(id)?.imageUrl,
        category: catalog.get(id)?.category,
      })),
    ];
  }, [
    clothes,
    favorites,
    currentProducts,
    outfit.wardrobeItemIds,
    outfit.catalogProductIds,
  ]);
  const [remote, setRemote] = useOwnedState<{
    id: string;
    parts: OutfitCoverPart[];
  } | null>(owner, null);
  useEffect(() => {
    let cancelled = false;
    const pending = fetchOutfitCoverParts(outfit, local);
    void (owner ? trackOwnerWork(owner, pending) : pending)
      .then((parts) => {
        if (!cancelled) setRemote({ id: outfit.id, parts });
      })
      .catch((error: unknown) =>
        logger.warn('Kombin cover görselleri yüklenemedi', {
          outfitId: outfit.id,
          error,
        }),
      );
    return () => {
      cancelled = true;
    };
  }, [outfit, local]);
  const resolved = useMemo(
    () =>
      remote?.id === outfit.id ? mergeCollageParts(remote.parts, local) : local,
    [remote, outfit.id, local],
  );
  const parts = resolved.length
    ? resolved
    : outfit.imageUrl
      ? [
          {
            key: outfit.id,
            source: 'catalog' as const,
            sourceId: outfit.id,
            imageUrl: outfit.imageUrl,
          },
        ]
      : [];
  return (
    <OutfitCollage
      parts={parts}
      style={style}
      accessibilityLabel={`${outfit.title} kombin cover`}
    />
  );
}
