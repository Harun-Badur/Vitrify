import { StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import PressableScale from './PressableScale';
import { PRODUCT_PREF_OPTIONS, type ProductPref } from '../lib/productPreference';
import { colors, radius, spacing } from '../lib/theme';

interface ProductPrefOptionsProps {
  /** NULL marks no option as selected. */
  value: ProductPref | null;
  onSelect: (pref: ProductPref) => void;
  disabled?: boolean;
}

/** Kadın / Erkek / Hepsi, shared by the choice screen and the Profile sheet. */
export default function ProductPrefOptions({ value, onSelect, disabled = false }: ProductPrefOptionsProps) {
  return (
    <View style={styles.list} accessibilityRole="radiogroup">
      {PRODUCT_PREF_OPTIONS.map((option) => {
        const selected = option.value === value;
        return (
          <PressableScale
            key={option.value}
            onPress={() => onSelect(option.value)}
            disabled={disabled}
            style={[styles.option, selected && styles.optionSelected]}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected, disabled }}
          >
            <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option.label}</Text>
            {selected ? <Check color={colors.accent} size={20} /> : null}
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.md,
  },
  option: {
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.input,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  optionText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  optionTextSelected: {
    color: colors.accentDark,
    fontWeight: '700',
  },
});
