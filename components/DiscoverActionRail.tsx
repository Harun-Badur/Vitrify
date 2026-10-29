import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Heart, Shirt, ShoppingBag, Sparkles } from 'lucide-react-native';
import PressableScale from './PressableScale';
import ShadowedIcon from './ShadowedIcon';
import { INSIGHT_CHIP_COPY } from '../lib/insightChipTemplates';
import { colors } from '../lib/theme';

const TRY_SIZE = 48;
const ICON_SIZE = 32;
const HEART_SIZE = 34;
const HIT_SIZE = 44;

interface DiscoverActionRailProps {
  onTry: () => void;
  onStore: () => void;
  onLike: () => void;
  liked: boolean;
  /** Yalnız insight chip varsa verilir; rayın en altında görünür. */
  onWhy?: () => void;
}

function DiscoverActionRail({ onTry, onStore, onLike, liked, onWhy }: DiscoverActionRailProps) {
  return (
    <View style={styles.rail}>
      <PressableScale
        onPress={onTry}
        style={styles.item}
        accessibilityRole="button"
        accessibilityLabel="Dene"
      >
        <View style={styles.tryCircle}>
          <Sparkles color={colors.inverseText} size={24} />
        </View>
        <Text style={styles.label}>Dene</Text>
      </PressableScale>
      <PressableScale
        onPress={onStore}
        style={styles.item}
        accessibilityRole="button"
        accessibilityLabel="Mağazaya git"
      >
        <ShadowedIcon icon={ShoppingBag} size={ICON_SIZE} />
        <Text style={styles.label}>Mağaza</Text>
      </PressableScale>
      <PressableScale
        onPress={onLike}
        style={styles.item}
        accessibilityRole="button"
        accessibilityLabel="Beğen"
        accessibilityState={{ selected: liked }}
      >
        <ShadowedIcon
          icon={Heart}
          size={HEART_SIZE}
          color={liked ? colors.accent : colors.inverseText}
          fill={liked ? colors.accent : 'none'}
        />
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
            <ShadowedIcon icon={Shirt} size={ICON_SIZE} />
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
    gap: 10,
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
    top: -6,
    right: -14,
    backgroundColor: colors.inverseText,
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  badgeText: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '800',
  },
  label: {
    color: colors.inverseText,
    fontSize: 12,
    fontWeight: '700',
    textShadowColor: 'rgba(0, 0, 0, 0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
