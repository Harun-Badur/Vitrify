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
}

/** Boşluklar ve etiketler dahil tüm ray dikdörtgeni dokunuşu yutar. */
const claimTouch = (): boolean => true;

function DiscoverActionRail({ onTry, onStore, onLike, liked, onWhy }: DiscoverActionRailProps) {
  return (
    <View style={styles.rail} onStartShouldSetResponder={claimTouch}>
      <PressableScale
        onPress={onTry}
        style={styles.item}
        accessibilityRole="button"
        accessibilityLabel="Dene"
      >
        <View style={styles.tryCircle}>
          <ShadowedIcon name="sparkles" size={TRY_ICON_SIZE} />
        </View>
        <Text style={styles.label}>Dene</Text>
      </PressableScale>
      <PressableScale
        onPress={onStore}
        style={styles.item}
        accessibilityRole="button"
        accessibilityLabel="Mağazaya git"
      >
        <ShadowedIcon name="shopping-bag" size={ICON_SIZE} />
        <Text style={styles.label}>Mağaza</Text>
      </PressableScale>
      <PressableScale
        onPress={onLike}
        style={styles.item}
        accessibilityRole="button"
        accessibilityLabel="Beğen"
        accessibilityState={{ selected: liked }}
      >
        <ShadowedIcon name={liked ? 'heart-liked' : 'heart'} size={HEART_SIZE} />
        <Text style={styles.label}>Beğen</Text>
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
              <Text style={styles.badgeText}>{INSIGHT_CHIP_COPY.aiBadge}</Text>
            </View>
          </View>
          <Text style={styles.label}>Uyumlu</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

export default memo(DiscoverActionRail);

const styles = StyleSheet.create({
  rail: {
    alignItems: 'center',
    gap: 6,
  },
  item: {
    minWidth: HIT_SIZE,
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
