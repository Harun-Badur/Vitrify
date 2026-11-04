import { StyleSheet, Text, View } from 'react-native';
import { Check, ChevronRight, Plus } from 'lucide-react-native';
import PressableScale from './PressableScale';
import { colors, radius, shadows, spacing } from '../lib/theme';
import type { JourneyTarget, StyleJourney } from '../lib/profileStyleJourney';
import { buildJourneyBoxes, evaluationLine, type JourneyBox } from '../lib/profileStyleView';

const accessibilityFor = (box: JourneyBox): string =>
  box.state === 'loading' ? `${box.label}: yükleniyor`
    : box.state === 'complete' ? `${box.label}: ${box.value}, tamamlandı`
      : `${box.label}: ${box.value}, eksik. Ekle`;

export default function ProfileStyleJourney({ journey, onTask }: {
  journey: StyleJourney; onTask: (target: JourneyTarget) => void;
}) {
  const line = evaluationLine(journey);
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Stil Yolculuğun</Text>
      <Text style={styles.description}>Küçük adımlarla tercihlerini keşfediyoruz.</Text>
      <View style={styles.list}>
        {buildJourneyBoxes(journey).map(box => (
          <PressableScale key={box.id} onPress={() => onTask(box.target)} accessibilityRole="button"
            accessibilityLabel={accessibilityFor(box)}
            style={[styles.row, box.state === 'missing' && styles.rowMissing]}>
            {box.state === 'complete' ? (
              <View testID={`journey-${box.id}-complete`} style={[styles.badge, styles.badgeDone]}>
                <Check size={14} color={colors.inverseText} strokeWidth={3} />
              </View>
            ) : box.state === 'missing' ? (
              <View testID={`journey-${box.id}-missing`} style={[styles.badge, styles.badgeAdd]}>
                <Plus size={15} color={colors.inverseText} strokeWidth={3} />
              </View>
            ) : <View testID={`journey-${box.id}-loading`} style={[styles.badge, styles.badgeLoading]} />}
            <View style={styles.copy}>
              <Text style={styles.label}>{box.label}</Text>
              <Text style={[styles.value, box.state === 'loading' && styles.valueLoading]} numberOfLines={2}>{box.value}</Text>
            </View>
            <ChevronRight size={15} color={colors.tabInactive} />
          </PressableScale>
        ))}
      </View>
      {journey.notice ? <Text style={styles.description}>{journey.notice}</Text>
        : line ? <Text style={styles.evaluation}>{line}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm, padding: spacing.md, borderRadius: radius.box, backgroundColor: colors.input,
    borderWidth: 1, borderColor: colors.hairline, ...shadows.segment,
  },
  title: { color: colors.text, fontSize: 17, fontWeight: '800' },
  description: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  evaluation: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  list: { gap: spacing.sm },
  row: {
    minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm, borderRadius: radius.box, backgroundColor: colors.input,
    borderWidth: 1.5, borderColor: colors.border,
  },
  rowMissing: { borderStyle: 'dashed', borderColor: colors.profileRed },
  badge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  badgeDone: { backgroundColor: colors.text },
  badgeAdd: { backgroundColor: colors.profileRed },
  badgeLoading: { backgroundColor: colors.border },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  label: { color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: '700' },
  value: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  valueLoading: { fontWeight: '600' },
});
