import { useOwnedState } from '../hooks/useOwnedState';
import { useCallback, useEffect } from 'react';
import {
  Dimensions,
  Modal,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { X } from 'lucide-react-native';
import PressableScale from './PressableScale';
import ProfileSheet from './ProfileSheet';
import { logger } from '../lib/logger';
import { colors, radius, spacing } from '../lib/theme';
import type { TryOnHistoryEntry } from '../lib/vtonHistory';
import { openProductPage } from '../services/deeplinkService';
import { loadTryOnHistory } from '../services/vtonHistoryService';
import type { Product } from '../types/product';

const GRID_GAP = spacing.sm;
const SHEET_PAD = spacing.xl;
const TILE_WIDTH =
  (Dimensions.get('window').width - SHEET_PAD * 2 - GRID_GAP) / 2;
const TILE_IMAGE_HEIGHT = TILE_WIDTH * 1.25;
const ICON_SIZE = 18;

interface TryOnHistorySheetProps {
  visible: boolean;
  userId: string | null;
  onClose: () => void;
}

const toStoreProduct = (entry: TryOnHistoryEntry): Product => ({
  id: entry.productId,
  imageUrl: entry.imageUri,
  title: entry.title,
  price: 0,
  brand: '',
  category: 'upper_body',
  garmentDescription: '',
  productUrl: entry.productUrl,
  affiliateUrl: entry.affiliateUrl,
});

export default function TryOnHistorySheet({
  visible,
  userId,
  onClose,
}: TryOnHistorySheetProps) {
  const [entries, setEntries] = useOwnedState<TryOnHistoryEntry[]>(userId, []);
  const [selected, setSelected] = useOwnedState<TryOnHistoryEntry | null>(userId, null);

  const loadEntries = useCallback(async (): Promise<void> => {
    if (!userId) {
      setEntries([]);
      return;
    }
    try {
      const history = await loadTryOnHistory(userId);
      setEntries(history);
    } catch (error) {
      logger.error('Deneme geçmişi yüklenemedi', { error });
      setEntries([]);
    }
  }, [userId]);

  useEffect(() => {
    if (!visible) {
      setSelected(null);
      return;
    }
    void loadEntries();
  }, [loadEntries, visible]);

  const handleOpenStore = (entry: TryOnHistoryEntry): void => {
    void openProductPage(toStoreProduct(entry));
  };

  return (
    <>
      <ProfileSheet visible={visible} title="Denemelerim" onClose={onClose}>
        {entries.length === 0 ? (
          <Text style={styles.empty}>Henüz deneme yok</Text>
        ) : (
          <View style={styles.grid}>
            {entries.map((item) => (
              <PressableScale
                key={`${item.ts}-${item.productId}`}
                onPress={() => setSelected(item)}
                style={styles.tile}
                accessibilityRole="button"
                accessibilityLabel={item.title}
              >
                <Image
                  cachePolicy="none"
                  source={{ uri: item.imageUri }}
                  style={styles.tileImage}
                  contentFit="cover"
                />
                <Text style={styles.tileTitle} numberOfLines={2}>
                  {item.title}
                </Text>
              </PressableScale>
            ))}
          </View>
        )}
      </ProfileSheet>

      <Modal
        visible={selected !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelected(null)}
      >
        {selected ? (
          <View style={styles.previewRoot}>
            <PressableScale
              onPress={() => setSelected(null)}
              style={styles.previewClose}
              accessibilityRole="button"
              accessibilityLabel="Kapat"
            >
              <X color={colors.inverseText} size={ICON_SIZE} />
            </PressableScale>
            <Image
              cachePolicy="none"
              source={{ uri: selected.imageUri }}
              style={styles.previewImage}
              contentFit="contain"
            />
            <Text style={styles.previewTitle} numberOfLines={2}>
              {selected.title}
            </Text>
            <PressableScale
              onPress={() => handleOpenStore(selected)}
              style={styles.storeButton}
              accessibilityRole="button"
              accessibilityLabel="Mağazaya git"
            >
              <Text style={styles.storeButtonText}>Mağazaya Git</Text>
            </PressableScale>
          </View>
        ) : null}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  empty: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: spacing.xxl,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
  tile: {
    width: TILE_WIDTH,
    backgroundColor: colors.input,
    borderRadius: radius.button,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  tileImage: {
    width: '100%',
    height: TILE_IMAGE_HEIGHT,
    backgroundColor: colors.bgSoft,
  },
  tileTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  previewRoot: {
    flex: 1,
    backgroundColor: colors.backdrop,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
  },
  previewClose: {
    alignSelf: 'flex-end',
    width: 40,
    height: 40,
    borderRadius: radius.chip,
    backgroundColor: colors.inverseSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewImage: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: radius.card,
    backgroundColor: colors.bgSoft,
  },
  previewTitle: {
    color: colors.inverseText,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  storeButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.button,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeButtonText: {
    color: colors.inverseText,
    fontSize: 16,
    fontWeight: '800',
  },
});
