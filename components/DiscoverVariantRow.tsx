import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import PressableScale from './PressableScale';
import TouchClaim from './TouchClaim';
import { resolveSwatch } from '../lib/colorSwatch';
import { colors } from '../lib/theme';
import { fallbackColor, visibleColors, visibleSizes } from '../lib/discoverVariants';
import type { ColorVariant, Product, SizeOption } from '../types/product';

const DOT = 20;
const RING = 2;
const HIT_SLOP = 12;

interface InlineProps {
  product: Product;
  showColors: boolean;
  showSizes: boolean;
  selectedIndex: number | null;
  onSelectColor: (index: number) => void;
}

function ColorDot({ variant, selected, onPress }: {
  variant: ColorVariant; selected: boolean; onPress: () => void;
}) {
  const swatch = resolveSwatch(variant.name);
  const label = variant.name?.trim() || 'Renk';
  return (
    <PressableScale
      onPress={onPress}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={selected ? `${label}, seçili` : label}
      accessibilityState={{ selected }}
      style={[styles.dotRing, selected && styles.dotRingSelected]}
    >
      {swatch.kind === 'hex' ? (
        <View style={[styles.dot, { backgroundColor: swatch.hex }, swatch.light && styles.dotLight]} />
      ) : variant.imageUrl ? (
        <Image source={{ uri: variant.imageUrl }} style={styles.dot} contentFit="cover" />
      ) : (
        <View style={[styles.dot, styles.dotLight, { backgroundColor: colors.border }]} />
      )}
    </PressableScale>
  );
}

function SizeChips({ sizes }: { sizes: readonly SizeOption[] }) {
  const { shown, overflow } = visibleSizes(sizes);
  return (
    <>
      {shown.map(size => (
        <View
          key={size.label}
          style={[styles.chip, size.inStock === false && styles.chipOut]}
          accessible
          accessibilityLabel={size.inStock === false ? `${size.label} beden, tükendi` : `${size.label} beden`}
        >
          <Text
            style={[styles.chipText, size.inStock === false && styles.chipTextOut]}
            maxFontSizeMultiplier={1.15}
          >
            {size.label}
          </Text>
        </View>
      ))}
      {overflow > 0 ? (
        <View style={styles.chip}>
          <Text style={styles.chipText} maxFontSizeMultiplier={1.15}>{`+${overflow}`}</Text>
        </View>
      ) : null}
    </>
  );
}

/** Right side of the price row: color dots, hairline divider, size chips (when they fit). */
export function DiscoverVariantInline({
  product, showColors, showSizes, selectedIndex, onSelectColor,
}: InlineProps) {
  const variants = product.colorVariants ?? [];
  const single = showColors ? null : fallbackColor(product);
  const { shown, overflow } = visibleColors(variants);
  if (!showColors && !showSizes && !single) return null;
  return (
    <TouchClaim>
    <View style={styles.inline} collapsable={false}>
      {showColors ? (
        <View style={styles.dots}>
          {shown.map((variant, index) => (
            <ColorDot
              key={`${index}:${variant.url}`}
              variant={variant}
              selected={selectedIndex === index}
              onPress={() => onSelectColor(index)}
            />
          ))}
          {overflow > 0 ? (
            <Text style={styles.more} maxFontSizeMultiplier={1.15}>{`+${overflow}`}</Text>
          ) : null}
        </View>
      ) : single ? (
        <View style={styles.dots} accessible accessibilityLabel={single.name}>
          <View style={[styles.smallDot, { backgroundColor: single.hex }]} />
          <Text style={styles.colorName} numberOfLines={1} maxFontSizeMultiplier={1.15}>{single.name}</Text>
        </View>
      ) : null}
      {showSizes && (showColors || single) ? <View style={styles.divider} /> : null}
      {showSizes ? (
        <View style={styles.chips}>
          <SizeChips sizes={product.sizeOptions ?? []} />
        </View>
      ) : null}
    </View>
    </TouchClaim>
  );
}

/** Second line below the price row, left aligned. */
export function DiscoverSizesLine({ sizes }: { sizes: readonly SizeOption[] }) {
  return (
    <TouchClaim>
      <View style={styles.secondLine} collapsable={false}>
        <SizeChips sizes={sizes} />
      </View>
    </TouchClaim>
  );
}

const styles = StyleSheet.create({
  inline: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, justifyContent: 'flex-end', columnGap: 8 },
  dots: { flexDirection: 'row', alignItems: 'center', columnGap: 4 },
  dotRing: {
    width: DOT + RING * 4, height: DOT + RING * 4, borderRadius: (DOT + RING * 4) / 2,
    borderWidth: RING, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center',
  },
  dotRingSelected: { borderColor: colors.text },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, overflow: 'hidden' },
  dotLight: { borderWidth: 1, borderColor: colors.border },
  smallDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: colors.border },
  colorName: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  more: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  divider: { width: 1, height: 18, backgroundColor: colors.border },
  chips: { flexDirection: 'row', alignItems: 'center', columnGap: 6 },
  secondLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, rowGap: 6, marginTop: 8 },
  chip: {
    height: 28, minWidth: 28, paddingHorizontal: 8, borderRadius: 10, borderWidth: 1,
    borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.input,
  },
  chipOut: { opacity: 0.45 },
  chipText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  chipTextOut: { textDecorationLine: 'line-through' },
});

export default DiscoverVariantInline;
