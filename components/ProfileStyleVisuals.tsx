import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Crown, Footprints, Layers, Shirt, ShoppingBag, Watch } from 'lucide-react-native';
import { PRICE_BANDS, type CategoryIcon, type FitShape } from '../lib/profileDisplay';
import type { StyleTile } from '../lib/profileStyleView';
import { colors, radius, spacing } from '../lib/theme';

const ICON_SIZE = 20;
const SHAPE_WIDTH: Record<FitShape, number> = { slim: 14, regular: 20, relaxed: 26, oversized: 32 };

function GarmentIcon({ icon }: { icon: CategoryIcon }) {
  const props = { size: ICON_SIZE, color: colors.text };
  switch (icon) {
    case 'outerwear': return <Layers {...props} />;
    case 'shoe': return <Footprints {...props} />;
    case 'bag': return <ShoppingBag {...props} />;
    case 'hat': return <Crown {...props} />;
    case 'accessory': return <Watch {...props} />;
    case 'pants':
      return (
        <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24">
          <Path d="M7 3h10l1.5 18h-5L12 11l-1.5 10h-5z" fill="none" stroke={colors.text} strokeWidth={1.8} strokeLinejoin="round" />
        </Svg>
      );
    case 'dress':
      return (
        <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24">
          <Path d="M9 3l1.5 5-3 13h9l-3-13L15 3" fill="none" stroke={colors.text} strokeWidth={1.8} strokeLinejoin="round" />
        </Svg>
      );
    default: return <Shirt {...props} />;
  }
}

function Silhouette({ shape }: { shape: FitShape }) {
  const width = SHAPE_WIDTH[shape];
  return (
    <View style={styles.silhouette} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.sleeves, { width: width + 14 }]} />
      <View style={[styles.torso, { width }]} />
    </View>
  );
}

/** Dimension-specific picture of a box: swatches, garment icons, silhouettes, brand badges or the price bar. */
export function TileVisual({ tile }: { tile: StyleTile }) {
  if (tile.state === 'empty' || tile.state === 'loading') return null;
  if (tile.id === 'color') {
    return <View style={styles.row}>{tile.swatches.map((hex, index) => (
      <View key={`${hex}-${index}`} style={[styles.swatch, { backgroundColor: hex }]} />))}</View>;
  }
  if (tile.id === 'category') {
    return <View style={styles.row}>{tile.icons.map((icon, index) => (
      <View key={`${icon}-${index}`} style={styles.iconCircle}><GarmentIcon icon={icon} /></View>))}</View>;
  }
  if (tile.id === 'fit') {
    return <View style={styles.row}>{tile.shapes.map((shape, index) => <Silhouette key={`${shape}-${index}`} shape={shape} />)}</View>;
  }
  if (tile.id === 'brand') {
    return <View style={styles.row}>{tile.brands.map(brand => (
      <View key={brand} style={styles.brandBadge}><Text style={styles.brandText} numberOfLines={1}>{brand}</Text></View>))}</View>;
  }
  if (tile.band) {
    return (
      <View style={styles.priceBar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {PRICE_BANDS.map((band, index) => (
          <View key={band} style={[styles.priceSegment, index === tile.band?.index && styles.priceActive]} />))}
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  iconCircle: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.hairline,
  },
  silhouette: { width: 46, height: 34, alignItems: 'center', gap: 2 },
  sleeves: { height: 8, borderRadius: 4, backgroundColor: colors.text },
  torso: { height: 24, borderRadius: 6, backgroundColor: colors.text },
  brandBadge: {
    maxWidth: '100%', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.chip,
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border,
  },
  brandText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  priceBar: { flexDirection: 'row', gap: spacing.xs, width: '100%' },
  priceSegment: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.border },
  priceActive: { backgroundColor: colors.profileRed },
});
