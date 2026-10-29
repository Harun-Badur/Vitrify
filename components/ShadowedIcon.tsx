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

const SHADOW_COLOR = 'rgba(0, 0, 0, 0.5)';
const SHADOW_STROKE = 3.2;

/**
 * Icon with a dark under-copy offset 1px down: stands in for drop-shadow, which
 * RN cannot apply to SVG, without blur or an offscreen layer.
 */
export default function ShadowedIcon({ icon: Icon, size, color = colors.inverseText, fill }: ShadowedIconProps) {
  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <View style={styles.under}>
        <Icon color={SHADOW_COLOR} size={size} strokeWidth={SHADOW_STROKE} fill={fill === undefined ? undefined : SHADOW_COLOR} />
      </View>
      <View style={styles.over}>
        <Icon color={color} size={size} strokeWidth={2} fill={fill} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  under: { position: 'absolute', top: 1, left: 0 },
  over: { position: 'absolute', top: 0, left: 0 },
});
