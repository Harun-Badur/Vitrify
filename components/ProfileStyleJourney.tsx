import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Check, Plus } from 'lucide-react-native';
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
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale > 1.3;
  const line = evaluationLine(journey);
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Stil Yolculuğun</Text>
      <Text style={styles.description}>Küçük adımlarla tercihlerini keşfediyoruz.</Text>
      <View style={[styles.row, stacked && styles.stacked]}>
        {buildJourneyBoxes(journey).map(box => (
          <PressableScale key={box.id} onPress={() => onTask(box.target)} accessibilityRole="button"
            accessibilityLabel={accessibilityFor(box)}
            style={[styles.box, box.state === 'missing' && styles.boxMissing, stacked && styles.boxStacked]}>
            {box.state === 'complete' ? (
              <View testID={`journey-${box.id}-complete`} style={[styles.badge, styles.badgeDone]}>
                <Check size={13} color={colors.inverseText} strokeWidth={3} />
              </View>
            ) : box.state === 'missing' ? (
              <View testID={`journey-${box.id}-missing`} style={[styles.badge, styles.badgeAdd]}>
                <Plus size={14} color={colors.inverseText} strokeWidth={3} />
              </View>
            ) : <View testID={`journey-${box.id}-loading`} />}
            <Text style={[styles.value, box.state === 'loading' && styles.valueLoading]} numberOfLines={1} adjustsFontSizeToFit>
              {box.value}
            </Text>
            <Text style={styles.label} numberOfLines={2}>{box.label}</Text>
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
  row: { flexDirection: 'row', gap: spacing.sm },
  stacked: { flexDirection: 'column' },
  box: {
    flex: 1, minWidth: 0, minHeight: 104, alignItems: 'center', justifyContent: 'flex-end', gap: spacing.xs,
    paddingHorizontal: spacing.sm, paddingBottom: spacing.md, paddingTop: spacing.lg, borderRadius: radius.box,
    backgroundColor: colors.input, borderWidth: 1.5, borderColor: colors.border,
  },
  boxStacked: { flex: 0, width: '100%', flexDirection: 'row', justifyContent: 'flex-start', gap: spacing.md },
  boxMissing: { borderStyle: 'dashed', borderColor: colors.profileRed },
  badge: {
    position: 'absolute', top: spacing.sm, right: spacing.sm, width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeDone: { backgroundColor: colors.text },
  badgeAdd: { backgroundColor: colors.profileRed },
  value: { color: colors.text, fontSize: 28, lineHeight: 34, fontWeight: '800', maxWidth: '100%' },
  valueLoading: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  label: { color: colors.textSecondary, fontSize: 12, lineHeight: 16, textAlign: 'center' },
});
