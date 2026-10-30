import { Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';

/** Pre-rendered by scripts/icons/generateRailIcons.cjs: 24dp glyph centred on a 32dp canvas. */
const GLYPH = 24;
const PAD = 4;

export type ShadowedIconName =
  | 'sparkles'
  | 'shopping-bag'
  | 'heart'
  | 'heart-liked'
  | 'badge-check'
  | 'search'
  | 'sliders-horizontal';

/** light: white outline + dark shadow; dark: #111827 outline + white shadow. */
export type ShadowedIconTone = 'light' | 'dark';

const SOURCES: Record<ShadowedIconTone, Record<ShadowedIconName, ImageSourcePropType>> = {
  light: {
    sparkles: require('../assets/icons/sparkles-light.png'),
    'shopping-bag': require('../assets/icons/shopping-bag-light.png'),
    heart: require('../assets/icons/heart-light.png'),
    'heart-liked': require('../assets/icons/heart-liked-light.png'),
    'badge-check': require('../assets/icons/badge-check-light.png'),
    search: require('../assets/icons/search-light.png'),
    'sliders-horizontal': require('../assets/icons/sliders-horizontal-light.png'),
  },
  dark: {
    sparkles: require('../assets/icons/sparkles-dark.png'),
    'shopping-bag': require('../assets/icons/shopping-bag-dark.png'),
    heart: require('../assets/icons/heart-dark.png'),
    'heart-liked': require('../assets/icons/heart-liked-dark.png'),
    'badge-check': require('../assets/icons/badge-check-dark.png'),
    search: require('../assets/icons/search-dark.png'),
    'sliders-horizontal': require('../assets/icons/sliders-horizontal-dark.png'),
  },
};

interface ShadowedIconProps {
  name: ShadowedIconName;
  size: number;
  tone?: ShadowedIconTone;
}

/**
 * Thin outline icon with a real Gaussian shadow, baked into PNGs because
 * react-native-svg filters are not trusted on low-end Android. The layout box
 * stays `size`; the shadow padding overflows it.
 */
export default function ShadowedIcon({ name, size, tone = 'light' }: ShadowedIconProps) {
  const scale = size / GLYPH;
  const canvas = (GLYPH + PAD * 2) * scale;
  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <Image
        source={SOURCES[tone][name]}
        fadeDuration={0}
        style={[styles.image, { width: canvas, height: canvas, top: -PAD * scale, left: -PAD * scale }]}
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

const styles = StyleSheet.create({
  image: { position: 'absolute' },
});
