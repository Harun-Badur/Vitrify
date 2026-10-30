import type { ComponentType } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../lib/theme';

interface IconProps {
  color?: string;
  size?: number;
  strokeWidth?: number;
  fill?: string;
}

interface ShadowedIconProps {
  icon: ComponentType<IconProps>;
  size: number;
  color?: string;
  fill?: string;
}

const STROKE = 1.6;
/** Yumuşak gölge: blur yerine kademeli, saydam, dolgusuz iki geniş stroke. */
const SOFT_INNER = { color: 'rgba(0, 0, 0, 0.3)', extra: 3 };
const SOFT_OUTER = { color: 'rgba(0, 0, 0, 0.2)', extra: 6 };

/**
 * Thin white outline icon with a soft shadow: the same shape redrawn underneath
 * with two wider, unfilled, translucent strokes. Stands in for drop-shadow,
 * which RN cannot apply to SVG, without blur or an offscreen layer.
 */
export default function ShadowedIcon({ icon: Icon, size, color = colors.inverseText, fill }: ShadowedIconProps) {
  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <View style={styles.layer}>
        <Icon color={SOFT_OUTER.color} size={size} strokeWidth={STROKE + SOFT_OUTER.extra} fill="none" />
      </View>
      <View style={styles.layer}>
        <Icon color={SOFT_INNER.color} size={size} strokeWidth={STROKE + SOFT_INNER.extra} fill="none" />
      </View>
      <View style={styles.layer}>
        <Icon color={color} size={size} strokeWidth={STROKE} fill={fill ?? 'none'} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, left: 0 },
});
