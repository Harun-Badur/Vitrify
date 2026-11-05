import { memo, useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
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
const WHY_FADE_MS = 150;
const HEART_POP_SCALE = 1.3;
const HEART_POP_IN_MS = 90;
const HEART_POP_OUT_MS = 140;
const RAIL_ITEM_COUNT = 4;
// Touch targets are 48dp tall and tile the rail; the icons inside them are 14-25dp apart visually.
const RAIL_GAP = 2;
const RAIL_MIN_GAP = 0;
const LABEL_MAX_FONT_SCALE = 1.15;

/** Sığmazsa öğeler gizlenmez, aralıklar RAIL_MIN_GAP'e kadar sıkışır (daireler küçülmez). */
export function computeRailGap(count: number, maxHeight?: number): number {
  if (maxHeight === undefined || count < 2) return RAIL_GAP;
  const fitting = (maxHeight - count * HIT_SIZE) / (count - 1);
  return Math.min(RAIL_GAP, Math.max(RAIL_MIN_GAP, fitting));
}

// ~20% larger than before: circle 28->34, glyphs 13->16 and 19->23, touch minimum 44->48.
const TRY_SIZE = 34;
const TRY_ICON_SIZE = 16;
const ICON_SIZE = 23;
const HEART_SIZE = 23;
const HIT_SIZE = 48;
/** 44dp column + 2dp hitSlop each side = 48dp wide touch target; the column (and header axis) stays 44. */
const HIT_SLOP = { left: 2, right: 2 } as const;

interface DiscoverActionRailProps {
  onTry: () => void;
  onStore: () => void;
  onLike: () => void;
  liked: boolean;
  onWhy: () => void;
  /** Uyumlu'nun yeri her zaman ayrılır; chip yokken yalnız şeffaf, etkisiz ve erişilebilirlikten gizli. */
  whyVisible: boolean;
  /** Ray için kullanılabilir yükseklik (header altı boşluğu düşülmüş). */
  maxHeight?: number;
}

/** Boşluklar ve etiketler dahil tüm ray dikdörtgeni dokunuşu yutar. */
const claimTouch = (): boolean => true;

function DiscoverActionRail({ onTry, onStore, onLike, liked, onWhy, whyVisible, maxHeight }: DiscoverActionRailProps) {
  const gap = computeRailGap(RAIL_ITEM_COUNT, maxHeight);
  const whyOpacity = useSharedValue(whyVisible ? 1 : 0);
  useEffect(() => {
    whyOpacity.value = withTiming(whyVisible ? 1 : 0, { duration: WHY_FADE_MS });
  }, [whyVisible, whyOpacity]);
  const whyStyle = useAnimatedStyle(() => ({ opacity: whyOpacity.value }));
  // Short pop only when the card turns liked (not on mount, not when unliking); no loop.
  const heartScale = useSharedValue(1);
  const wasLiked = useRef(liked);
  useEffect(() => {
    if (liked && !wasLiked.current) {
      heartScale.value = withSequence(
        withTiming(HEART_POP_SCALE, { duration: HEART_POP_IN_MS }),
        withTiming(1, { duration: HEART_POP_OUT_MS }),
      );
    }
    wasLiked.current = liked;
  }, [liked, heartScale]);
  const heartStyle = useAnimatedStyle(() => ({ transform: [{ scale: heartScale.value }] }));
  return (
    <View style={[styles.rail, { gap }]} collapsable={false} onStartShouldSetResponder={claimTouch}>
      <PressableScale
        onPress={onTry}
        style={styles.item}
        hitSlop={HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel="Dene"
      >
        <View style={styles.tryCircle}>
          <ShadowedIcon name="sparkles" size={TRY_ICON_SIZE} />
        </View>
      </PressableScale>
      <PressableScale
        onPress={onStore}
        style={styles.item}
        hitSlop={HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel="Mağazaya git"
      >
        <ShadowedIcon name="shopping-bag" size={ICON_SIZE} />
      </PressableScale>
      <PressableScale
        onPress={onLike}
        style={styles.item}
        hitSlop={HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel={liked ? 'Beğenildi' : 'Beğen'}
        accessibilityState={{ selected: liked }}
      >
        <Animated.View style={heartStyle}>
          <ShadowedIcon name={liked ? 'heart-liked' : 'heart'} size={HEART_SIZE} />
        </Animated.View>
      </PressableScale>
      <Animated.View
        style={whyStyle}
        pointerEvents={whyVisible ? 'auto' : 'none'}
        accessibilityElementsHidden={!whyVisible}
        importantForAccessibility={whyVisible ? 'auto' : 'no-hide-descendants'}
      >
        <PressableScale
          onPress={onWhy}
          disabled={!whyVisible}
          hitSlop={HIT_SLOP}
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
        </PressableScale>
      </Animated.View>
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
    top: -5,
    right: -10,
    backgroundColor: colors.inverseText,
    borderRadius: 8,
    paddingHorizontal: 3,
    paddingVertical: 0,
  },
  badgeText: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: '800',
  },
});
