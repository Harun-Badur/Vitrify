import { StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import PressableScale from './PressableScale';
import { colors, radius, spacing } from '../lib/theme';
import type { JourneyTarget, StyleJourney } from '../lib/profileStyleJourney';
import { buildJourneyStepper, type JourneyStep } from '../lib/profileStyleView';

const CIRCLE = 32;

function StepMark({ step }: { step: JourneyStep }) {
  const complete = step.state === 'complete';
  return (
    <View testID={`journey-step-${step.id}-${step.state}`}
      style={[styles.circle, complete && styles.circleDone, step.state === 'current' && styles.circleCurrent,
        (step.state === 'upcoming' || step.state === 'loading') && styles.circleQuiet]}>
      {complete ? <Check size={16} color={colors.ink} strokeWidth={3} /> : (
        <Text style={[styles.number, step.state === 'current' && styles.numberCurrent]}>{step.number}</Text>)}
    </View>
  );
}

export default function ProfileStyleJourney({ journey, onTask }: {
  journey: StyleJourney; onTask: (target: JourneyTarget) => void;
}) {
  const { total, subline, steps, next } = buildJourneyStepper(journey);
  return (
    <View style={styles.card}>
      <Text style={styles.overline}>STİL YOLCULUĞUN</Text>
      <View style={styles.totalRow}>
        <Text style={styles.total} accessibilityLabel={total === null ? 'Yükleniyor' : `${total} değerlendirme`}>
          {total === null ? '…' : String(total)}
        </Text>
        <Text style={styles.totalLabel}>değerlendirme</Text>
      </View>
      {subline ? <Text style={styles.subline}>{subline}</Text> : null}
      <View style={styles.steps}>
        {steps.map((step, index) => (
          <View key={step.id} style={styles.step}>
            {index < steps.length - 1 ? <View style={styles.connector} /> : null}
            <StepMark step={step} />
            <Text style={[styles.stepLabel, step.state === 'complete' && styles.stepLabelDone]} numberOfLines={2}>{step.label}</Text>
          </View>
        ))}
      </View>
      {journey.notice ? <Text style={styles.subline}>{journey.notice}</Text> : null}
      {next ? (
        <View style={styles.next}>
          <View style={styles.nextCopy}>
            <Text style={styles.overline}>SIRADAKİ ADIM</Text>
            <Text style={styles.nextText}>{next.text}</Text>
          </View>
          <PressableScale onPress={() => onTask(next.target)} accessibilityRole="button" accessibilityLabel="Ekle" style={styles.add}>
            <Text style={styles.addText}>Ekle</Text>
          </PressableScale>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md, padding: 20, borderRadius: radius.hero, backgroundColor: colors.ink },
  overline: { color: colors.inkMuted, fontSize: 11, lineHeight: 15, fontWeight: '700', letterSpacing: 1.6 },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  total: { color: colors.inverseText, fontSize: 48, lineHeight: 54, fontWeight: '800' },
  totalLabel: { color: colors.inkMuted, fontSize: 14, lineHeight: 20 },
  subline: { color: colors.inkMuted, fontSize: 13, lineHeight: 18, marginTop: -spacing.sm },
  steps: { flexDirection: 'row', marginTop: spacing.xs },
  step: { flex: 1, minWidth: 0, alignItems: 'center', gap: spacing.sm },
  connector: { position: 'absolute', top: CIRCLE / 2, left: '50%', right: '-50%', height: 1, backgroundColor: colors.inkLine },
  circle: { width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2, alignItems: 'center', justifyContent: 'center' },
  circleDone: { backgroundColor: colors.inverseText },
  circleCurrent: { borderWidth: 2, borderColor: colors.profileRed, backgroundColor: colors.ink },
  circleQuiet: { borderWidth: 1.5, borderColor: colors.inkLine, backgroundColor: colors.ink },
  number: { color: colors.inkMuted, fontSize: 13, fontWeight: '700' },
  numberCurrent: { color: colors.inverseText },
  stepLabel: { color: colors.inkMuted, fontSize: 11, lineHeight: 15, textAlign: 'center' },
  stepLabelDone: { color: colors.inverseText },
  next: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.md, borderTopWidth: 1,
    borderTopColor: colors.inkLine,
  },
  nextCopy: { flex: 1, minWidth: 0, gap: 2 },
  nextText: { color: colors.inverseText, fontSize: 15, lineHeight: 20, fontWeight: '700' },
  add: {
    minHeight: 44, minWidth: 72, paddingHorizontal: spacing.lg, borderRadius: 22, alignItems: 'center',
    justifyContent: 'center', backgroundColor: colors.profileRed,
  },
  addText: { color: colors.inverseText, fontSize: 14, fontWeight: '700' },
});
