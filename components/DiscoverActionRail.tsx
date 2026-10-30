import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import PressableScale from './PressableScale';
import ShadowedIcon from './ShadowedIcon';
import { INSIGHT_CHIP_COPY } from '../lib/insightChipTemplates';
import { colors } from '../lib/theme';

/**
 * Görünen glyph boyutu search ikonuyla (21dp kutuda 19.6/24 → ~17.1dp) eşit:
 * bag/heart/badge-check PNG'lerinde çizim 21.6/24 dolduğu için kutu 19dp.
 */
/** Header ve rail aynı kenar boşluğu ve sütun ekseni: ikon merkezi sağ kenardan 16 + 22dp. */
export const DISCOVER_EDGE_MARGIN = 16;
export const RAIL_COLUMN_WIDTH = 44;
export const DISCOVER_ICON_CENTER_FROM_RIGHT = DISCOVER_EDGE_MARGIN + RAIL_COLUMN_WIDTH / 2;
const RAIL_GAP = 6;
const RAIL_MIN_GAP = 4;
const LABEL_MAX_FONT_SCALE = 1.15;

/** Sığmazsa öğeler gizlenmez, aralıklar RAIL_MIN_GAP'e kadar sıkışır. */
export function computeRailGap(count: number, maxHeight?: number): number {
  if (maxHeight === undefined || count < 2) return RAIL_GAP;
  const fitting = (maxHeight - count * HIT_SIZE) / (count - 1);
  return Math.min(RAIL_GAP, Math.max(RAIL_MIN_GAP, fitting));
}

const TRY_SIZE = 28;
const TRY_ICON_SIZE = 13;
const ICON_SIZE = 19;
const HEART_SIZE = 19;
const HIT_SIZE = 44;

interface DiscoverActionRailProps {
  onTry: () => void;
  onStore: () => void;
  onLike: () => void;
  liked: boolean;
  /** Yalnız insight chip varsa verilir; rayın en altında görünür. */
  onWhy?: () => void;
  /** Ray için kullanılabilir yükseklik (header altı boşluğu düşülmüş). */
  maxHeight?: number;
}

/** Boşluklar ve etiketler dahil tüm ray dikdörtgeni dokunuşu yutar. */
const claimTouch = (): boolean => true;

function DiscoverActionRail({ onTry, onStore, onLike, liked, onWhy, maxHeight }: DiscoverActionRailProps) {
  const gap = computeRailGap(onWhy ? 4 : 3, maxHeight);
  return (
    <View style={[styles.rail, { gap }]} onStartShouldSetResponder={claimTouch}>
      <PressableScale
        onPress={onTry}
        style={styles.item}
        accessibilityRole="button"
        accessibilityLabel="Dene"
      >
        <View style={styles.tryCircle}>
          <ShadowedIcon name="sparkles" size={TRY_ICON_SIZE} />
        </View>
        <Text style={styles.label} maxFontSizeMultiplier={LABEL_MAX_FONT_SCALE}>Dene</Text>
      </PressableScale>
      <PressableScale
        onPress={onStore}
        style={styles.item}
        accessibilityRole="button"
        accessibilityLabel="Mağazaya git"
      >
        <ShadowedIcon name="shopping-bag" size={ICON_SIZE} />
        <Text style={styles.label} maxFontSizeMultiplier={LABEL_MAX_FONT_SCALE}>Mağaza</Text>
      </PressableScale>
      <PressableScale
        onPress={onLike}
        style={styles.item}
        accessibilityRole="button"
        accessibilityLabel="Beğen"
        accessibilityState={{ selected: liked }}
      >
        <ShadowedIcon name={liked ? 'heart-liked' : 'heart'} size={HEART_SIZE} />
        <Text style={styles.label} maxFontSizeMultiplier={LABEL_MAX_FONT_SCALE}>Beğen</Text>
      </PressableScale>
      {onWhy ? (
        <PressableScale
          onPress={onWhy}
          style={styles.item}
          accessibilityRole="button"
          accessibilityLabel="Neden bu öneri?"
        >
          <View>
            <ShadowedIcon name="badge-check" size={ICON_SIZE} />
            <View style={styles.badge}>
              <Text style={styles.badgeText} maxFontSizeMultiplier={LABEL_MAX_FONT_SCALE}>{INSIGHT_CHIP_COPY.aiBadge}</Text>
            </View>
          </View>
          <Text style={styles.label} maxFontSizeMultiplier={LABEL_MAX_FONT_SCALE}>Uyumlu</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

export default memo(DiscoverActionRail);

const styles = StyleSheet.create({
  rail: {
    width: RAIL_COLUMN_WIDTH,
    alignItems: 'center',
  },
  item: {
    width: RAIL_COLUMN_WIDTH,
    minHeight: HIT_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  tryCircle: {
    width: TRY_SIZE,
    height: TRY_SIZE,
    borderRadius: TRY_SIZE / 2,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    backgroundColor: colors.inverseText,
    borderRadius: 8,
    paddingHorizontal: 3,
    paddingVertical: 0,
  },
  badgeText: {
    color: colors.accent,
    fontSize: 7.5,
    fontWeight: '800',
  },
  label: {
    color: colors.inverseText,
    fontSize: 10.5,
    fontWeight: '700',
    textShadowColor: 'rgba(0, 0, 0, 0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
