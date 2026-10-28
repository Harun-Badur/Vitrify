import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PressableScale from './PressableScale';
import ProductPrefOptions from './ProductPrefOptions';
import type { ProductPref } from '../lib/productPreference';
import { colors, spacing } from '../lib/theme';

interface ProductPrefChoiceScreenProps {
  onSelect: (pref: ProductPref) => void;
  onSkip: () => void;
}

/** Shown after sign-in/onboarding, before the tabs, while no preference is chosen. */
export default function ProductPrefChoiceScreen({ onSelect, onSkip }: ProductPrefChoiceScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top, spacing.xl), paddingBottom: Math.max(insets.bottom, spacing.xxl) }]}>
      <PressableScale
        onPress={onSkip}
        style={styles.skip}
        accessibilityRole="button"
        accessibilityLabel="Şimdi değil"
        accessibilityHint="Tüm ürünler gösterilir; tercihini daha sonra Profil'den seçebilirsin."
      >
        <Text style={styles.skipText}>Şimdi değil</Text>
      </PressableScale>
      <View style={styles.content}>
        <Text style={styles.title} accessibilityRole="header">Ne tür ürünler görmek istersin?</Text>
        <Text style={styles.body}>Keşfet akışın bu seçime göre hazırlanır. İstediğin zaman Profil'den değiştirebilirsin.</Text>
        <ProductPrefOptions value={null} onSelect={onSelect} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  skip: {
    alignSelf: 'flex-end',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  skipText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  body: {
    color: colors.textSecondary,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
});
