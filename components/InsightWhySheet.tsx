import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { X } from 'lucide-react-native';
import PressableScale from './PressableScale';
import { InsightAiBadge } from './InsightChip';
import type { InsightChip } from '../lib/insightChip';
import { INSIGHT_CHIP_COPY } from '../lib/insightChipTemplates';
import { colors, radius, spacing } from '../lib/theme';

const EVIDENCE_IMAGE_SIZE = 48;

interface InsightWhySheetProps {
  chip: InsightChip;
  visible: boolean;
  onClose: () => void;
  onOpenWardrobe: () => void;
  onHideKind: () => void;
}

/** "Neden bu öneri?" alt sayfası: kanıt parçaları, AI notu ve iki eylem. */
export default function InsightWhySheet({ chip, visible, onClose, onOpenWardrobe, onHideKind }: InsightWhySheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button"
        accessibilityLabel={INSIGHT_CHIP_COPY.close} />
      <View style={styles.sheet} accessibilityViewIsModal>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">{INSIGHT_CHIP_COPY.sheetTitle}</Text>
          <InsightAiBadge />
          <View style={styles.headerSpacer} />
          <PressableScale onPress={onClose} accessibilityRole="button" accessibilityLabel={INSIGHT_CHIP_COPY.close}
            hitSlop={8}>
            <X color={colors.textSecondary} size={20} />
          </PressableScale>
        </View>
        <Text style={styles.summary}>{chip.summary}</Text>
        <Text style={styles.sectionTitle}>{INSIGHT_CHIP_COPY.evidenceTitle}</Text>
        <View style={styles.evidenceList}>
          {chip.evidence.map(item => (
            <View key={`${item.source}:${item.id}`} style={styles.evidenceRow}>
              {item.imageUrl ? (
                <Image source={{ uri: item.imageUrl }} style={styles.evidenceImage}
                  contentFit="cover" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
              ) : <View style={styles.evidenceImage} />}
              <Text style={styles.evidenceLabel} numberOfLines={2}>{item.label}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.disclaimer}>{INSIGHT_CHIP_COPY.disclaimer}</Text>
        <PressableScale onPress={onOpenWardrobe} style={styles.primaryButton} accessibilityRole="button"
          accessibilityLabel={INSIGHT_CHIP_COPY.openWardrobe}>
          <Text style={styles.primaryButtonText}>{INSIGHT_CHIP_COPY.openWardrobe}</Text>
        </PressableScale>
        <PressableScale onPress={onHideKind} style={styles.secondaryButton} accessibilityRole="button"
          accessibilityLabel={INSIGHT_CHIP_COPY.hideKind}>
          <Text style={styles.secondaryButtonText}>{INSIGHT_CHIP_COPY.hideKind}</Text>
        </PressableScale>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.backdrop,
    opacity: 0.35,
  },
  sheet: {
    backgroundColor: colors.input,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerSpacer: { flex: 1 },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  summary: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  evidenceList: { gap: spacing.sm },
  evidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  evidenceImage: {
    width: EVIDENCE_IMAGE_SIZE,
    height: EVIDENCE_IMAGE_SIZE,
    borderRadius: spacing.sm,
    backgroundColor: colors.surface,
  },
  evidenceLabel: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  disclaimer: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  primaryButton: {
    backgroundColor: colors.text,
    borderRadius: radius.button,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: colors.inverseText,
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
});
