import { StyleSheet, Text, View } from 'react-native';
import { brandMonogram } from '../lib/profileDisplay';
import type { StyleTile } from '../lib/profileStyleView';
import { colors } from '../lib/theme';

const SWATCH = 26;
const MONOGRAM = 28;
const OVERLAP = 8;
const TIERS = ['₺', '₺₺', '₺₺₺'] as const;

/** Colour, brand and price pictures for a Stilin row. Parça and Kesim are text only. */
export function TileVisual({ tile }: { tile: StyleTile }) {
  if (tile.state === 'empty' || tile.state === 'loading') return null;
  if (tile.id === 'color') {
    return (
      <View style={styles.stack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {tile.swatches.map((hex, index) => (
          <View key={`${hex}-${index}`} style={[styles.swatch, index > 0 && styles.overlap, { backgroundColor: hex }]} />))}
      </View>
    );
  }
  if (tile.id === 'brand') {
    return (
      <View style={styles.stack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {tile.brands.map((brand, index) => (
          <View key={brand} style={[styles.monogram, index > 0 && styles.overlap]}>
            <Text style={styles.monogramText}>{brandMonogram(brand)}</Text>
          </View>))}
      </View>
    );
  }
  if (tile.id === 'price' && tile.band) {
    return (
      <View style={styles.tiers} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {TIERS.map((label, index) => {
          const active = index === tile.band?.tier;
          return (
            <View key={label} testID={active ? 'price-pill-active' : 'price-pill'} style={[styles.pill, active && styles.pillActive]}>
              <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
            </View>
          );
        })}
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  stack: { flexDirection: 'row', alignItems: 'center' },
  overlap: { marginLeft: -OVERLAP },
  swatch: { width: SWATCH, height: SWATCH, borderRadius: SWATCH / 2, borderWidth: 2, borderColor: colors.input },
  monogram: {
    width: MONOGRAM, height: MONOGRAM, borderRadius: MONOGRAM / 2, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.cream, borderWidth: 2, borderColor: colors.input,
  },
  monogramText: { color: colors.ink, fontSize: 10, fontWeight: '800' },
  tiers: { flexDirection: 'row', gap: 4 },
  pill: {
    minWidth: 28, paddingHorizontal: 6, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.cream,
  },
  pillActive: { backgroundColor: colors.ink },
  pillText: { color: colors.tabInactive, fontSize: 11, fontWeight: '700' },
  pillTextActive: { color: colors.inverseText },
});
