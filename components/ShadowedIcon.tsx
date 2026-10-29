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

const HALO_COLOR = 'rgba(0, 0, 0, 0.4)';
const STROKE = 2;
const HALO_EXTRA_STROKE = 2.2;

/**
 * Outline icon with a dark halo: the same shape redrawn underneath with a
 * thicker, unfilled stroke. Stands in for drop-shadow, which RN cannot apply to
 * SVG, without blur or an offscreen layer.
 */
export default function ShadowedIcon({ icon: Icon, size, color = colors.inverseText, fill }: ShadowedIconProps) {
  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <View style={styles.layer}>
        <Icon color={HALO_COLOR} size={size} strokeWidth={STROKE + HALO_EXTRA_STROKE} fill="none" />
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
