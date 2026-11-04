import { useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import PressableScale from './PressableScale';
import ProfileSheet from './ProfileSheet';
import { TileVisual } from './ProfileStyleVisuals';
import { colors, radius, shadows, spacing } from '../lib/theme';
import type { StyleJourney } from '../lib/profileStyleJourney';
import {
  buildSourceSheet, buildStyleGrid, type DeclarationSection, type SourceSheetModel, type StyleTile,
} from '../lib/profileStyleView';

const SOURCE_COLORS = { liked: colors.profileRed, passed: colors.tabInactive, wardrobe: colors.text } as const;

export default function ProfileStyleGrid({ journey, onRetry, onSelectSection }: {
  journey: StyleJourney; onRetry: () => void; onSelectSection: (section: DeclarationSection) => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const singleColumn = width < 350 || fontScale > 1.3;
  const [openId, setOpenId] = useState<StyleTile['id'] | null>(null);
  const grid = buildStyleGrid(journey);
  const opened = grid.tiles.find(tile => tile.id === openId);
  const sheet: SourceSheetModel | null = opened ? buildSourceSheet(opened, journey) : null;
  return (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <Text style={styles.heading}>Stilin</Text>
        {grid.state === 'error' ? null : <Text style={styles.hint}>Dokun, kaynağı gör</Text>}
      </View>
      {grid.state === 'error' ? (
        <View style={styles.errorCard} accessibilityRole="alert">
          <Text style={styles.errorText}>{grid.errorText}</Text>
          <PressableScale onPress={onRetry} accessibilityRole="button" accessibilityLabel="Yeniden dene" style={styles.retry}>
            <Text style={styles.retryText}>Yeniden dene</Text>
          </PressableScale>
        </View>
      ) : (
        <View style={styles.grid}>
          {grid.tiles.map(tile => (
            <PressableScale key={tile.id} testID={`style-tile-${tile.id}-${tile.state}`}
              onPress={() => setOpenId(tile.id)} accessibilityRole="button"
              accessibilityLabel={`${tile.title}: ${tile.valueText}`}
              style={[styles.tile, (tile.wide || singleColumn) && styles.tileFull,
                (tile.state === 'empty' || tile.state === 'loading') && styles.tileEmpty]}>
              <Text style={styles.tileTitle}>{tile.title}</Text>
              {tile.label ? <Text style={styles.declared}>{tile.label}</Text> : null}
              <TileVisual tile={tile} />
              <Text style={tile.state === 'empty' || tile.state === 'loading' ? styles.emptyValue : styles.value}
                numberOfLines={2}>{tile.valueText}</Text>
            </PressableScale>
          ))}
        </View>
      )}
      {sheet ? (
        <ProfileSheet visible title={sheet.title} onClose={() => setOpenId(null)}>
          <View style={styles.sheetBody}>
            <TileVisual tile={sheet.tile} />
            <Text style={styles.sheetValue}>{sheet.valueText}</Text>
            {sheet.declared ? null : (
              <View style={styles.source}>
                <Text style={styles.sourceHeading}>{sheet.heading}</Text>
                <View style={styles.stack}>
                  {sheet.sources.filter(part => part.count > 0).map(part => (
                    <View key={part.id} style={{ flex: part.fraction, backgroundColor: SOURCE_COLORS[part.id] }} />))}
                </View>
                <View style={styles.legend}>
                  {sheet.sources.map(part => (
                    <View key={part.id} style={styles.legendItem}>
                      <View style={[styles.dot, { backgroundColor: SOURCE_COLORS[part.id] }]} />
                      <Text style={styles.legendText}>{part.label} {part.count}</Text>
                    </View>))}
                </View>
                <Text style={styles.note}>{sheet.sourceNote}</Text>
              </View>
            )}
            <Text style={styles.note}>{sheet.note}</Text>
            <PressableScale accessibilityRole="button" accessibilityLabel={sheet.button.label} style={styles.primary}
              onPress={() => { setOpenId(null); onSelectSection(sheet.button.section); }}>
              <Text style={styles.primaryText}>{sheet.button.label}</Text>
            </PressableScale>
          </View>
        </ProfileSheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  headingRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: spacing.sm },
  heading: { color: colors.text, fontSize: 20, fontWeight: '800' },
  hint: { color: colors.textSecondary, fontSize: 11, lineHeight: 15 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    width: '48%', flexGrow: 1, minHeight: 104, gap: spacing.sm, padding: spacing.md, borderRadius: radius.box,
    backgroundColor: colors.input, borderWidth: 1, borderColor: colors.hairline, ...shadows.segment,
  },
  tileFull: { width: '100%' },
  tileEmpty: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.tabInactive, backgroundColor: colors.bgSoft },
  tileTitle: { color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '700' },
  declared: {
    alignSelf: 'flex-start', color: colors.profileRed, fontSize: 10, lineHeight: 14, fontWeight: '700',
    paddingHorizontal: spacing.sm, borderRadius: radius.chip, backgroundColor: colors.accentSoft, overflow: 'hidden',
  },
  value: { color: colors.textSecondary, fontSize: 12, lineHeight: 16 },
  emptyValue: { color: colors.textSecondary, fontSize: 12, lineHeight: 16, fontWeight: '600' },
  errorCard: {
    gap: spacing.sm, padding: spacing.md, borderRadius: radius.box, backgroundColor: colors.input,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.profileRed,
  },
  errorText: { color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  retry: {
    minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.button,
    backgroundColor: colors.profileRed,
  },
  retryText: { color: colors.inverseText, fontSize: 14, fontWeight: '700' },
  sheetBody: { gap: spacing.md },
  sheetValue: { color: colors.text, fontSize: 18, lineHeight: 24, fontWeight: '800' },
  source: { gap: spacing.sm },
  sourceHeading: { color: colors.text, fontSize: 14, fontWeight: '700' },
  stack: { flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: colors.border },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: colors.textSecondary, fontSize: 12, lineHeight: 16 },
  note: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  primary: {
    minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.button,
    backgroundColor: colors.profileRed,
  },
  primaryText: { color: colors.inverseText, fontSize: 15, fontWeight: '700' },
});
