import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Ellipse } from 'react-native-svg';
import { Compass, Sparkles, Wallet } from 'lucide-react-native';
import PressableScale from './PressableScale';
import { isWardrobeEvidenceKind, type InsightChip as InsightChipModel, type InsightChipKind } from '../lib/insightChip';
import { INSIGHT_CHIP_COPY } from '../lib/insightChipTemplates';
import { colors, radius, shadows, spacing } from '../lib/theme';

const ICON_SIZE = 14;
const THUMB_SIZE = 18;
const EYE_LOOK_PX = 1.6;
const EYE_LOOK_MS = 260;
const EYE_HOLD_MS = 180;
const EYE_BLINK_MS = 90;
const EYE_LOOP_PAUSE_MS = 2600;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);

/** Bir kez sağa-sola bakar, bir kez kırpar; yalnız `active` iken döner, reduce-motion'da durağan. */
export function InsightEyeIcon({ active, size = ICON_SIZE }: { active: boolean; size?: number }) {
  const reduceMotion = useReducedMotion();
  const look = useSharedValue(0);
  const open = useSharedValue(1);

  useEffect(() => {
    if (!active || reduceMotion) {
      cancelAnimation(look);
      cancelAnimation(open);
      look.value = 0;
      open.value = 1;
      return;
    }
    const ease = { duration: EYE_LOOK_MS, easing: Easing.inOut(Easing.quad) };
    look.value = withRepeat(withSequence(
      withTiming(EYE_LOOK_PX, ease),
      withDelay(EYE_HOLD_MS, withTiming(-EYE_LOOK_PX, ease)),
      withDelay(EYE_HOLD_MS, withTiming(0, ease)),
      withDelay(EYE_LOOP_PAUSE_MS + EYE_BLINK_MS * 2, withTiming(0, { duration: 0 })),
    ), -1);
    const lookPhaseMs = EYE_LOOK_MS * 3 + EYE_HOLD_MS * 2;
    open.value = withRepeat(withSequence(
      withDelay(lookPhaseMs, withTiming(0.1, { duration: EYE_BLINK_MS })),
      withTiming(1, { duration: EYE_BLINK_MS }),
      withDelay(EYE_LOOP_PAUSE_MS, withTiming(1, { duration: 0 })),
    ), -1);
    return () => {
      cancelAnimation(look);
      cancelAnimation(open);
    };
  }, [active, reduceMotion, look, open]);

  const lidProps = useAnimatedProps(() => ({ ry: 4.6 * open.value }));
  const pupilProps = useAnimatedProps(() => ({ cx: 12 + look.value * 1.5, r: 2.4 * Math.min(1, open.value * 1.4) }));

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
      <AnimatedEllipse cx={12} cy={12} rx={9.5} animatedProps={lidProps}
        stroke={colors.accent} strokeWidth={2} fill={colors.input} />
      <AnimatedCircle cy={12} animatedProps={pupilProps} fill={colors.accent} />
    </Svg>
  );
}

const StaticIcon = ({ kind }: { kind: InsightChipKind }) => {
  if (kind === 'budget') return <Wallet color={colors.accent} size={ICON_SIZE} />;
  if (kind === 'discovery') return <Compass color={colors.accent} size={ICON_SIZE} />;
  return <Sparkles color={colors.accent} size={ICON_SIZE} />;
};

export function InsightAiBadge() {
  return (
    <View style={styles.aiBadge}>
      <Text style={styles.aiBadgeText}>{INSIGHT_CHIP_COPY.aiBadge}</Text>
    </View>
  );
}

interface InsightChipProps {
  chip: InsightChipModel;
  /** Kart ekranda ve öndeyken true; göz döngüsü yalnız o zaman çalışır. */
  active: boolean;
  onPress: () => void;
}

export default function InsightChip({ chip, active, onPress }: InsightChipProps) {
  const wardrobeKind = isWardrobeEvidenceKind(chip.kind);
  return (
    <PressableScale
      onPress={onPress}
      style={styles.chip}
      accessibilityRole="button"
      accessibilityLabel={INSIGHT_CHIP_COPY.chipAccessibility(chip.label)}
      hitSlop={6}
    >
      {wardrobeKind ? <InsightEyeIcon active={active} /> : <StaticIcon kind={chip.kind} />}
      {chip.kind === 'wardrobe_match' && chip.matchedItem?.imageUrl ? (
        <Image source={{ uri: chip.matchedItem.imageUrl }} style={styles.thumb}
          contentFit="cover" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
      ) : null}
      <Text style={styles.label} numberOfLines={1}>{chip.label}</Text>
      <InsightAiBadge />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  chip: {
    position: 'absolute',
    left: spacing.lg,
    bottom: 30,
    maxWidth: '82%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.input,
    borderRadius: radius.chip,
    paddingLeft: spacing.sm + 2,
    paddingRight: spacing.xs + 2,
    paddingVertical: 6,
    ...shadows.chip,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: colors.surface,
  },
  label: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    flexShrink: 1,
  },
  aiBadge: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.chip,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  aiBadgeText: {
    color: colors.accentDark,
    fontSize: 10,
    fontWeight: '800',
  },
});
