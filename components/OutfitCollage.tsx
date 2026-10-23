import { memo, useMemo, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Shirt } from 'lucide-react-native';
import { colors } from '../lib/theme';
import {
  createCollageLayout,
  type CollagePart,
  type CollageTile,
} from '../lib/outfitCollage';

const TileImage = memo(function TileImage({
  tile,
  flatLay,
}: {
  tile: CollageTile;
  flatLay: boolean;
}) {
  const { part } = tile;
  const [failedUrl, setFailedUrl] = useState<string>();
  return (
    <View
      style={{
        position: 'absolute',
        left: `${tile.x}%`,
        top: `${tile.y}%`,
        width: `${tile.width}%`,
        height: `${tile.height}%`,
        padding: flatLay ? 3 : 2,
      }}
    >
      <View style={[styles.panel, flatLay && styles.flatPanel]}>
        {part.imageUrl && failedUrl !== part.imageUrl ? (
          <Image
            source={{ uri: part.imageUrl }}
            style={styles.image}
            contentFit="contain"
            contentPosition="center"
            cachePolicy={part.source === 'wardrobe' ? 'none' : 'memory-disk'}
            recyclingKey={`${part.key}:${part.imageUrl}`}
            accessibilityLabel={`Kombin parçası ${part.sourceId}`}
            onError={() => setFailedUrl(part.imageUrl)}
          />
        ) : (
          <Shirt
            size={18}
            color={colors.textSecondary}
            accessibilityLabel="Görsel mevcut değil"
          />
        )}
      </View>
    </View>
  );
});

function OutfitCollage({
  parts,
  style,
  accessibilityLabel,
}: {
  parts: readonly CollagePart[];
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const layout = useMemo(() => createCollageLayout(parts), [parts]);
  return (
    <View
      style={[styles.cover, style]}
      accessibilityLabel={accessibilityLabel}
      testID={`outfit-collage-${layout.mode}`}
    >
      {layout.tiles.length ? (
        layout.tiles.map((tile) => (
          <TileImage
            key={tile.part.key}
            tile={tile}
            flatLay={layout.mode === 'flat-lay'}
          />
        ))
      ) : (
        <View style={styles.empty}>
          <Shirt size={24} color={colors.accent} />
        </View>
      )}
    </View>
  );
}

export default memo(OutfitCollage);

const styles = StyleSheet.create({
  cover: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  panel: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: 8,
    backgroundColor: colors.bgSoft,
  },
  flatPanel: { backgroundColor: 'transparent' },
  image: { width: '100%', height: '100%' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
