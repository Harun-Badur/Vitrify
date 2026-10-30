import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { SEGMENT_PILL_SPRING } from '../lib/motion';
import { colors, layout, radius, shadows } from '../lib/theme';
import type { FeedMode } from '../types/recommendation';

interface FeedModeOption {
  mode: FeedMode;
  label: string;
}

interface FeedModeSegmentProps {
  overlay?: boolean;
  value: FeedMode;
  onChange: (mode: FeedMode) => void;
}

const OPTIONS: readonly FeedModeOption[] = [
  { mode: 'personal', label: 'Sana Özel' },
  { mode: 'trend', label: 'Trend' },
];

const SEGMENT_HIT_SLOP = { top: 8, bottom: 8, left: 4, right: 4 } as const;

export default function FeedModeSegment({
  value,
  onChange,
  overlay = false,
}: FeedModeSegmentProps) {
  const [optionWidths, setOptionWidths] = useState<number[]>([0, 0]);
  const pillX = useSharedValue<number>(layout.segmentInset);
  const pillWidth = useSharedValue<number>(0);
  const activeIndex = value === 'trend' ? 1 : 0;

  useEffect(() => {
    const width = optionWidths[activeIndex];
    if (width === undefined || width <= 0) {
      return;
    }
    const offset =
      layout.segmentInset +
      optionWidths.slice(0, activeIndex).reduce((sum, item) => sum + item, 0);
    pillX.value = withSpring(offset, SEGMENT_PILL_SPRING);
    pillWidth.value = withSpring(width, SEGMENT_PILL_SPRING);
  }, [activeIndex, optionWidths, pillWidth, pillX]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillX.value }],
    width: pillWidth.value,
  }));

  return (
    <View
      collapsable={false}
      style={[styles.track, overlay && styles.overlayTrack]}
      accessibilityRole="tablist"
      accessibilityLabel="Keşif modu"
    >
      {!overlay ? (
        <Animated.View pointerEvents="none" style={[styles.pill, pillStyle]} />
      ) : null}
      {OPTIONS.map((option, index) => {
        const isActive = option.mode === value;
        return (
          <Pressable
            key={option.mode}
            onPress={() => {
              if (option.mode !== value) {
                onChange(option.mode);
              }
            }}
            onLayout={(event) => {
              const nextWidth = event.nativeEvent.layout.width;
              setOptionWidths((current) => {
                if (current[index] === nextWidth) {
                  return current;
                }
                const next = [...current];
                next[index] = nextWidth;
                return next;
              });
            }}
            style={[styles.option, overlay && styles.overlayOption, overlay && isActive && styles.overlayActiveOption]}
            hitSlop={SEGMENT_HIT_SLOP}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={option.label}
          >
            <Text
              maxFontSizeMultiplier={1.15}
              style={[
                styles.label,
                isActive ? styles.labelActive : null,
                overlay && styles.overlayLabel,
                overlay && !isActive && styles.overlayLabelInactive,
              ]}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  overlayTrack: { padding: 0, backgroundColor: 'transparent' },
  /** İlk yazı kart içeriğiyle (16dp) aynı hizada başlasın: yatay iç boşluk yok. */
  overlayOption: { paddingHorizontal: 0, marginRight: 22 },
  overlayLabel: {
    color: colors.inverseText,
    fontSize: 14,
    fontWeight: '700',
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  overlayLabelInactive: { color: 'rgba(255, 255, 255, 0.85)' },
  overlayActiveOption: { borderBottomWidth: 1, borderBottomColor: colors.inverseText },
  track: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    height: layout.segmentHeight,
    padding: layout.segmentInset,
    backgroundColor: colors.segmentTrackBg,
  },
  pill: {
    position: 'absolute',
    top: layout.segmentInset,
    bottom: layout.segmentInset,
    left: 0,
    backgroundColor: colors.segmentActiveBg,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.segment,
  },
  option: {
    zIndex: 1,
    height: '100%',
    justifyContent: 'center',
    paddingHorizontal: layout.segmentOptionPaddingX,
  },
  label: {
    color: colors.tabInactive,
    fontSize: 14,
    fontWeight: '600',
  },
  labelActive: {
    color: colors.segmentActiveText,
    fontWeight: '700',
  },
});
