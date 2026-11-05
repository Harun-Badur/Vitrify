import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';
import { Check, ChevronRight } from 'lucide-react-native';
import PressableScale from './PressableScale';
import { colors, radius, spacing } from '../lib/theme';
import type { JourneyTarget, StyleJourney } from '../lib/profileStyleJourney';
import { buildJourneyCard, type JourneyRow } from '../lib/profileStyleView';

const RING = 72;
const STROKE = 2.5;
const RADIUS = (RING - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const CENTER = RING / 2;
const MARK = 28;
// Core saturation grows with completed steps: 0-1 steps, 2 steps, 3 steps. Static drawing, no animation.
const CORE_TONES: ReadonlyArray<{ center: string; edge: string; glow: number }> = [
  { center: '#FF6A5E', edge: '#FBE9E6', glow: 0.14 },
  { center: '#FF4F42', edge: '#F7C9C3', glow: 0.2 },
  { center: '#FE382B', edge: '#FE6A5E', glow: 0.25 },
];
const STATE_TEXT = { complete: 'tamamlandı', missing: 'eksik', loading: 'yükleniyor' } as const;
const SPARKLE = 'M0 -9 C1 -3 3 -1 9 0 C3 1 1 3 0 9 C-1 3 -3 1 -9 0 C-3 -1 -1 -3 0 -9 Z';

function FocusRing({ completed, label }: { completed: number; label: string }) {
  const tone = CORE_TONES[Math.max(0, completed - 1)];
  const fraction = completed / 3;
  const angle = (fraction * 360 - 90) * (Math.PI / 180);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={styles.ring}>
      <Svg width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`}>
        <Defs>
          <LinearGradient id="journeyArc" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FE382B" />
            <Stop offset="1" stopColor="#FF7A6E" />
          </LinearGradient>
          <RadialGradient id="journeyCore" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={tone.center} />
            <Stop offset="1" stopColor={tone.edge} />
          </RadialGradient>
          <RadialGradient id="journeyGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#FE382B" stopOpacity={tone.glow} />
            <Stop offset="1" stopColor="#FE382B" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke="#F1EBE2" strokeWidth={STROKE} />
        {completed > 0 ? (
          <Circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke="url(#journeyArc)" strokeWidth={STROKE} strokeLinecap="round"
            strokeDasharray={`${CIRCUMFERENCE}`} strokeDashoffset={CIRCUMFERENCE * (1 - fraction)} rotation={-90} origin={`${CENTER}, ${CENTER}`} />
        ) : null}
        {completed > 0 ? (
          <Circle cx={CENTER + RADIUS * Math.cos(angle)} cy={CENTER + RADIUS * Math.sin(angle)} r={2} fill={colors.inverseText} opacity={0.9} />
        ) : null}
        <Circle cx={CENTER} cy={CENTER} r={30} fill="url(#journeyGlow)" />
        <Circle cx={CENTER} cy={CENTER} r={24} fill="url(#journeyCore)" />
        <Path d={SPARKLE} fill={colors.inverseText} transform={`translate(${CENTER} ${CENTER}) scale(0.9)`} />
        <Path d={SPARKLE} fill={colors.inverseText} opacity={0.8} transform={`translate(${CENTER + 13} ${CENTER - 13}) scale(0.4)`} />
      </Svg>
    </View>
  );
}

function RowMark({ row }: { row: JourneyRow }) {
  if (row.state === 'complete') {
    return <View style={[styles.mark, styles.markDone]}><Check size={16} color={colors.inverseText} strokeWidth={3} /></View>;
  }
  return <View style={[styles.mark, row.state === 'missing' && row.id === 'wardrobe' ? styles.markRed : styles.markQuiet]} />;
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
          <Text style={styles.title} numberOfLines={2}>{card.title}</Text>
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
        {card.rows.map((row, index) => {
          const content = (
            <>
              <RowMark row={row} />
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle}>{row.title}</Text>
                <Text style={styles.rowSub} numberOfLines={2}>{row.subtitle}</Text>
              </View>
              {row.hint ? <Text style={styles.hint}>{row.hint}</Text> : null}
              {row.target ? <View testID={`journey-chevron-${row.id}`}><ChevronRight size={15} color={colors.line} /></View> : null}
            </>
          );
          const rowStyle = [styles.row, index > 0 && styles.rowDivider];
          const testID = `journey-row-${row.id}-${row.state}`;
          const target = row.target;
          return target ? (
            <PressableScale key={row.id} testID={testID} onPress={() => onTask(target)} accessibilityRole="button"
              accessibilityLabel={row.id === 'preferences' ? row.title : `${row.title}, ${STATE_TEXT[row.state]}`} style={rowStyle}>
              {content}
            </PressableScale>
          ) : (
            <View key={row.id} testID={testID} style={rowStyle}
              accessibilityLabel={row.id === 'liked' ? undefined : `${row.title}, ${STATE_TEXT[row.state]}`}>
              {content}
            </View>
          );
        })}
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
});
