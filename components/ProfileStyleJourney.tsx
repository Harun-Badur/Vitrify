import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Check } from 'lucide-react-native';
import PressableScale from './PressableScale';
import { colors, radius, spacing } from '../lib/theme';
import type { JourneyTarget, StyleJourney } from '../lib/profileStyleJourney';
import { buildJourneyCard, type JourneyRow } from '../lib/profileStyleView';

const RING = 92;
const STROKE = 4;
const RADIUS = (RING - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const MARK = 28;
const ADD_HEIGHT = 40;
const HIT = 44;
// Inner discs get more saturated as steps complete: 0-1 steps, 2 steps, 3 steps.
const RING_FILLS: ReadonlyArray<readonly [string, string, string]> = [
  ['#FBE9E6', '#F7C9C3', 'rgba(254, 56, 43, 0.55)'],
  ['#F7C9C3', '#F2A59C', 'rgba(254, 56, 43, 0.8)'],
  [colors.accent, colors.accent, colors.accent],
];
const SPARKLE = 'M0 -9 C1 -3 3 -1 9 0 C3 1 1 3 0 9 C-1 3 -3 1 -9 0 C-3 -1 -1 -3 0 -9 Z';

function FocusRing({ completed, label }: { completed: number; label: string }) {
  const [outer, middle, inner] = RING_FILLS[Math.max(0, completed - 1)];
  const center = RING / 2;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={styles.ring}>
      <Svg width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`}>
        <Circle cx={center} cy={center} r={RADIUS} fill="none" stroke={colors.line} strokeWidth={STROKE} />
        <Circle cx={center} cy={center} r={RADIUS} fill="none" stroke={colors.accent} strokeWidth={STROKE} strokeLinecap="round"
          strokeDasharray={`${CIRCUMFERENCE}`} strokeDashoffset={CIRCUMFERENCE * (1 - completed / 3)} rotation={-90} origin={`${center}, ${center}`} />
        <Circle cx={center} cy={center} r={36} fill={outer} />
        <Circle cx={center} cy={center} r={26} fill={middle} />
        <Circle cx={center} cy={center} r={16} fill={inner} />
        <Path d={SPARKLE} fill={colors.inverseText} transform={`translate(${center} ${center})`} />
      </Svg>
    </View>
  );
}

function RowMark({ row }: { row: JourneyRow }) {
  if (row.state === 'complete') {
    return <View style={[styles.mark, styles.markDone]}><Check size={16} color={colors.inverseText} strokeWidth={3} /></View>;
  }
  return <View style={[styles.mark, row.action?.kind === 'button' ? styles.markRed : styles.markQuiet]} />;
}

export default function ProfileStyleJourney({ journey, onTask }: {
  journey: StyleJourney; onTask: (target: JourneyTarget) => void;
}) {
  const card = buildJourneyCard(journey);
  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <FocusRing completed={card.completed} label={card.ringLabel} />
        <View style={styles.topCopy}>
          <Text style={styles.overline}>STİL YOLCULUĞUN</Text>
          <Text style={styles.title}>{card.title}</Text>
          <Text style={styles.lead}>Paylaştıkça önerilerin sana yaklaşır.</Text>
        </View>
      </View>
      <View style={styles.stages}>
        {card.stages.map((stage, index) => (
          <View key={stage} style={styles.stageItem}>
            <Text style={[styles.stageText, index === card.stage && styles.stageCurrent]} numberOfLines={1}>{stage}</Text>
            {index < card.stages.length - 1 ? <View style={styles.stageLine} /> : null}
          </View>
        ))}
      </View>
      <View>
        {card.rows.map((row, index) => (
          <View key={row.id} testID={`journey-row-${row.id}-${row.state}`} style={[styles.row, index > 0 && styles.rowDivider]}>
            <RowMark row={row} />
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>{row.title}</Text>
              <Text style={styles.rowSub} numberOfLines={2}>{row.subtitle}</Text>
            </View>
            {row.action?.kind === 'button' ? (
              <PressableScale onPress={() => onTask(row.action!.target)} hitSlop={(HIT - ADD_HEIGHT) / 2}
                accessibilityRole="button" accessibilityLabel={row.action.label} style={styles.add}>
                <Text style={styles.addText}>{row.action.label}</Text>
              </PressableScale>
            ) : row.action?.kind === 'link' ? (
              <PressableScale onPress={() => onTask(row.action!.target)} accessibilityRole="button"
                accessibilityLabel={row.action.label} style={styles.link}>
                <Text style={styles.linkText}>{row.action.label}</Text>
              </PressableScale>
            ) : row.action ? <Text style={styles.hint}>{row.action.label}</Text> : null}
          </View>
        ))}
      </View>
      {journey.notice ? <Text style={styles.lead}>{journey.notice}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.lg, padding: 20, borderRadius: radius.hero, backgroundColor: colors.input, borderWidth: 1, borderColor: colors.line },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  ring: { width: RING, height: RING },
  topCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  overline: { color: colors.tabInactive, fontSize: 12, lineHeight: 16, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.text, fontSize: 22, lineHeight: 28, fontWeight: '800' },
  lead: { color: colors.tabInactive, fontSize: 13, lineHeight: 18 },
  stages: { flexDirection: 'row', alignItems: 'center' },
  stageItem: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  stageText: { color: colors.tabInactive, fontSize: 12, lineHeight: 16, fontWeight: '600' },
  stageCurrent: { color: colors.text, fontWeight: '800' },
  stageLine: { flex: 1, height: 1, backgroundColor: colors.line },
  row: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  mark: { width: MARK, height: MARK, borderRadius: MARK / 2, alignItems: 'center', justifyContent: 'center' },
  markDone: { backgroundColor: colors.ink },
  markRed: { borderWidth: 2, borderColor: colors.accent },
  markQuiet: { borderWidth: 2, borderColor: colors.line },
  rowCopy: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '700' },
  rowSub: { color: colors.tabInactive, fontSize: 13, lineHeight: 18 },
  hint: { color: colors.tabInactive, fontSize: 12, lineHeight: 16, fontWeight: '600', maxWidth: 110, textAlign: 'right' },
  add: { height: ADD_HEIGHT, minWidth: 64, paddingHorizontal: spacing.lg, borderRadius: ADD_HEIGHT / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  addText: { color: colors.inverseText, fontSize: 14, fontWeight: '700' },
  link: { minHeight: HIT, minWidth: HIT, alignItems: 'center', justifyContent: 'center' },
  linkText: { color: colors.accent, fontSize: 14, fontWeight: '700' },
});
