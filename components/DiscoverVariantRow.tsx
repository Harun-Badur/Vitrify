import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Image } from 'expo-image';
import PressableScale from './PressableScale';
import TouchClaim from './TouchClaim';
import { resolveSwatch } from '../lib/colorSwatch';
import { colors } from '../lib/theme';
import { fallbackColor, fitVariantRow, VARIANT_ROW_HEIGHT } from '../lib/discoverVariants';
import type { ColorVariant, Product } from '../types/product';

const DOT = 26;
const RING = 2;
const RING_GAP = 1.5;
const RING_OUTER = DOT + 2 * (RING + RING_GAP);
const RING_MARGIN = -(RING + RING_GAP);
const HIT_SLOP = 9;
const EDGE = '#E5E7EB';
const INK = '#111827';
const CHIP_INK = '#374151';

interface Props {
  product: Product;
  selectedIndex: number | null;
  onSelectColor: (index: number) => void;
}

function ColorPreview({ variant, selected, onPress }: {
  variant: ColorVariant; selected: boolean; onPress: () => void;
}) {
  const swatch = resolveSwatch(variant.name);
  const label = variant.name?.trim() || 'Renk';
  const imageUrl = variant.imageUrl?.trim();
  return (
    <PressableScale
      onPress={onPress}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={selected ? `${label}, seçili` : label}
      accessibilityState={{ selected }}
      style={[styles.dotRing, selected && styles.dotRingSelected]}
    >
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={styles.dot} contentFit="cover" />
      ) : (
        <View style={[styles.dot, { backgroundColor: swatch.kind === 'hex' ? swatch.hex : EDGE }]} />
      )}
    </PressableScale>
  );
}

function Chip({ label, out, a11y }: { label: string; out?: boolean; a11y: string }) {
  return (
    <View style={[styles.chip, out && styles.chipOut]} accessible accessibilityLabel={a11y}>
      <Text style={[styles.chipText, out && styles.chipTextOut]} maxFontSizeMultiplier={1.15}>
        {label}
      </Text>
    </View>
  );
}

/**
 * Right side of the price row. Always mounted with a fixed height so the footer never
 * changes size; the measured width decides how many colors/chips fit on this one line.
 */
export default function DiscoverVariantInline({ product, selectedIndex, onSelectColor }: Props) {
  const [width, setWidth] = useState(0);
  const handleLayout = useCallback((event: LayoutChangeEvent): void => {
    const next = Math.floor(event.nativeEvent.layout.width);
    setWidth((current) => (current === next ? current : next));
  }, []);

  const variants = product.colorVariants ?? [];
  const sizes = product.sizeOptions ?? [];
  const labels = useMemo(() => sizes.map((size) => size.label.toUpperCase()), [sizes]);
  const single = variants.length === 0 && sizes.length === 0 ? fallbackColor(product) : null;
  const fit = useMemo(() => fitVariantRow(width, variants.length, labels), [width, variants.length, labels]);

  const hasContent = width > 0 && (variants.length > 0 || sizes.length > 0 || single !== null);
  return (
    <View style={styles.slot} onLayout={handleLayout}>
      {hasContent ? (
        <TouchClaim>
          <View style={styles.cluster} collapsable={false}>
            {single ? (
              <View style={styles.row} accessible accessibilityLabel={single.name}>
                <View style={[styles.smallDot, { backgroundColor: single.hex }]} />
                <Text style={styles.colorName} numberOfLines={1} maxFontSizeMultiplier={1.15}>{single.name}</Text>
              </View>
            ) : null}
            {fit.colorCount > 0 ? (
              <View style={styles.row}>
                {variants.slice(0, fit.colorCount).map((variant, index) => (
                  <ColorPreview
                    key={`${index}:${variant.url}`}
                    variant={variant}
                    selected={selectedIndex === index}
                    onPress={() => onSelectColor(index)}
                  />
                ))}
                {fit.colorOverflow > 0 ? (
                  <Text style={styles.more} maxFontSizeMultiplier={1.15}>{`+${fit.colorOverflow}`}</Text>
                ) : null}
              </View>
            ) : null}
            {fit.colorCount > 0 && (fit.chipCount > 0 || fit.hiddenSizes > 0) ? <View style={styles.divider} /> : null}
            {fit.chipCount > 0 || fit.hiddenSizes > 0 ? (
              <View style={styles.chips}>
                {sizes.slice(0, fit.chipCount).map((size, index) => (
                  <Chip
                    key={`${size.label}:${index}`}
                    label={labels[index]}
                    out={size.inStock === false}
                    a11y={size.inStock === false ? `${labels[index]} beden, tükendi` : `${labels[index]} beden`}
                  />
                ))}
                {fit.hiddenSizes > 0 ? (
                  <Chip label={`+${fit.hiddenSizes}`} a11y={`${fit.hiddenSizes} beden daha`} />
                ) : null}
              </View>
            ) : null}
          </View>
        </TouchClaim>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    flex: 1, minWidth: 0, height: VARIANT_ROW_HEIGHT, flexDirection: 'row',
    justifyContent: 'flex-end', alignItems: 'center', overflow: 'hidden',
  },
  cluster: { flexDirection: 'row', alignItems: 'center', columnGap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', columnGap: 6 },
  dotRing: {
    width: RING_OUTER, height: RING_OUTER, borderRadius: 8 + RING + RING_GAP,
    margin: RING_MARGIN, borderWidth: RING, borderColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
  },
  dotRingSelected: { borderColor: INK },
  dot: { width: DOT, height: DOT, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: EDGE },
  smallDot: { width: 12, height: 12, borderRadius: 3, borderWidth: 1, borderColor: EDGE },
  colorName: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  more: { color: colors.textSecondary, fontSize: 11, fontWeight: '400' },
  divider: { width: 1, height: 16, backgroundColor: EDGE },
  chips: { flexDirection: 'row', alignItems: 'center', columnGap: 4 },
  chip: {
    height: 24, minWidth: 24, paddingHorizontal: 6, borderRadius: 8, borderWidth: 1,
    borderColor: EDGE, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.input,
  },
  chipOut: { opacity: 0.45 },
  chipText: { color: CHIP_INK, fontSize: 11, fontWeight: '400' },
  chipTextOut: { textDecorationLine: 'line-through' },
});
