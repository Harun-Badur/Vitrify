import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PressableScale from './PressableScale';
import ProductPrefOptions from './ProductPrefOptions';
import { COLOR_CHIP_LABELS, type FeedQueryFilters } from '../lib/feedQuery';
import { effectiveProductPref, type ProductPref } from '../lib/productPreference';
import { colors, radius, spacing } from '../lib/theme';
import { chooseProductPref } from '../services/productPrefSync';
import { useAppStore } from '../store/useAppStore';
import type { GarmentCategory } from '../types/product';

const CATEGORY_CHIPS: { value: GarmentCategory; label: string }[] = [
  { value: 'upper_body', label: 'Üst' },
  { value: 'lower_body', label: 'Alt' },
  { value: 'dresses', label: 'Elbise' },
];

const COLOR_CHIPS: { value: string; label: string }[] = [
  'siyah',
  'beyaz',
  'kirmizi',
  'mavi',
  'navy',
  'yesil',
  'pembe',
  'gri',
  'bej',
  'kahverengi',
].map((value) => ({
  value,
  label: COLOR_CHIP_LABELS[value] ?? value,
}));

const STYLE_CHIPS = [
  'midi',
  'maxi',
  'mini',
  'abiye',
  'triko',
  'saten',
] as const;

const PRICE_PRESETS: {
  label: string;
  priceMin?: number;
  priceMax?: number;
}[] = [
  { label: '<500₺', priceMax: 500 },
  { label: '500-1000₺', priceMin: 500, priceMax: 1000 },
  { label: '1000+₺', priceMin: 1000 },
];

interface FilterSheetProps {
  visible: boolean;
  filters: FeedQueryFilters;
  onClose: () => void;
  onApply: (filters: FeedQueryFilters) => void;
  /** Signed-in user; without one the product preference is shown but cannot change. */
  userId?: string | null;
}

interface ChipGroupProps<T extends string> {
  label: string;
  options: { value: T; label: string }[];
  selected: T | null;
  onSelect: (value: T | null) => void;
}

function ChipGroup<T extends string>({
  label,
  options,
  selected,
  onSelect,
}: ChipGroupProps<T>) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>{label}</Text>
      <View style={styles.chipRow}>
        {options.map((option) => {
          const isActive = selected === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onSelect(isActive ? null : option.value)}
              style={[styles.chip, isActive ? styles.chipActive : null]}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={option.label}
            >
              <Text
                style={[
                  styles.chipText,
                  isActive ? styles.chipTextActive : null,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function FilterSheet({
  visible,
  filters,
  onClose,
  onApply,
  userId = null,
}: FilterSheetProps) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<FeedQueryFilters>(filters);
  const productPref = useAppStore((state) => state.productPref);
  // The preference is not a filter: it has its own draft and "Temizle" never touches it.
  const [prefDraft, setPrefDraft] = useState<ProductPref>(effectiveProductPref(productPref));

  useEffect(() => {
    if (visible) {
      setDraft(filters);
      setPrefDraft(effectiveProductPref(productPref));
    }
  }, [filters, visible, productPref]);

  const handleClear = (): void => {
    setDraft({});
  };

  const handleApply = (): void => {
    if (userId && prefDraft !== effectiveProductPref(productPref)) {
      void chooseProductPref(userId, prefDraft);
    }
    onApply(draft);
    onClose();
  };

  const activePriceKey = (() => {
    for (const preset of PRICE_PRESETS) {
      if (
        draft.priceMin === preset.priceMin &&
        draft.priceMax === preset.priceMax
      ) {
        return preset.label;
      }
      if (
        preset.priceMin === undefined &&
        draft.priceMin === undefined &&
        draft.priceMax === preset.priceMax
      ) {
        return preset.label;
      }
      if (
        preset.priceMax === undefined &&
        draft.priceMax === undefined &&
        draft.priceMin === preset.priceMin
      ) {
        return preset.label;
      }
    }
    return null;
  })();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Filtreleri kapat"
        />
        <View
          testID="discover-filter-sheet"
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              paddingBottom: Math.max(insets.bottom, spacing.lg),
              paddingLeft: Math.max(insets.left, spacing.xl),
              paddingRight: Math.max(insets.right, spacing.xl),
            },
          ]}
        >
          <Text style={styles.title}>Filtrele</Text>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.options}
          >
            <View style={styles.group}>
              <Text style={styles.groupLabel}>Ürün tercihi</Text>
              <ProductPrefOptions value={prefDraft} onSelect={setPrefDraft} disabled={!userId} />
            </View>
            <ChipGroup
              label="Kategori"
              options={CATEGORY_CHIPS}
              selected={draft.category ?? null}
              onSelect={(category) =>
                setDraft((current) => {
                  const next = { ...current };
                  if (category === null) delete next.category;
                  else next.category = category;
                  return next;
                })
              }
            />
            <ChipGroup
              label="Renk"
              options={COLOR_CHIPS}
              selected={draft.color ?? null}
              onSelect={(color) =>
                setDraft((current) => {
                  const next = { ...current };
                  if (color === null) delete next.color;
                  else next.color = color;
                  return next;
                })
              }
            />
            <ChipGroup
              label="Stil"
              options={STYLE_CHIPS.map((style) => ({
                value: style,
                label: style,
              }))}
              selected={draft.style ?? null}
              onSelect={(style) =>
                setDraft((current) => {
                  const next = { ...current };
                  if (style === null) delete next.style;
                  else next.style = style;
                  return next;
                })
              }
            />
            <View style={styles.group}>
              <Text style={styles.groupLabel}>Fiyat</Text>
              <View style={styles.chipRow}>
                {PRICE_PRESETS.map((preset) => {
                  const isActive = activePriceKey === preset.label;
                  return (
                    <Pressable
                      key={preset.label}
                      onPress={() =>
                        setDraft((current) => {
                          const next = { ...current };
                          if (isActive) {
                            delete next.priceMin;
                            delete next.priceMax;
                            return next;
                          }
                          if (preset.priceMin !== undefined) {
                            next.priceMin = preset.priceMin;
                          } else {
                            delete next.priceMin;
                          }
                          if (preset.priceMax !== undefined) {
                            next.priceMax = preset.priceMax;
                          } else {
                            delete next.priceMax;
                          }
                          return next;
                        })
                      }
                      style={[styles.chip, isActive ? styles.chipActive : null]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isActive }}
                      accessibilityLabel={preset.label}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          isActive ? styles.chipTextActive : null,
                        ]}
                      >
                        {preset.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </ScrollView>
          <View style={styles.actions}>
            <PressableScale
              onPress={handleClear}
              style={styles.clearButton}
              accessibilityRole="button"
              accessibilityLabel="Temizle"
            >
              <Text style={styles.clearText}>Temizle</Text>
            </PressableScale>
            <PressableScale
              onPress={handleApply}
              style={styles.applyButton}
              accessibilityRole="button"
              accessibilityLabel="Uygula"
            >
              <Text style={styles.applyText}>Uygula</Text>
            </PressableScale>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.backdrop,
    opacity: 0.4,
  },
  sheet: {
    maxHeight: '100%',
    flexShrink: 1,
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  options: { paddingBottom: spacing.sm },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: spacing.lg,
  },
  group: {
    marginBottom: spacing.lg,
  },
  groupLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    minHeight: 48,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  chipTextActive: {
    color: colors.inverseText,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  clearButton: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  clearText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '700',
  },
  applyButton: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: radius.button,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  applyText: {
    color: colors.inverseText,
    fontSize: 16,
    fontWeight: '800',
  },
});
