import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import PressableScale from './PressableScale';
import ProfileSheet from './ProfileSheet';
import { TileVisual } from './ProfileStyleVisuals';
import { PROFILE_MENU_LABEL, colors, radius, spacing } from '../lib/theme';
import type { StyleJourney } from '../lib/profileStyleJourney';
import {
  buildSourceSheet, buildStyleGrid, type DeclarationSection, type SourceSheetModel, type StyleTile,
} from '../lib/profileStyleView';

const SOURCE_COLORS = { liked: colors.ink, passed: colors.tabInactive, wardrobe: colors.line } as const;

export default function ProfileStyleGrid({ journey, onRetry, onSelectSection }: {
  journey: StyleJourney; onRetry: () => void; onSelectSection: (section: DeclarationSection) => void;
}) {
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
        <View style={styles.card} accessibilityRole="alert">
          <View style={styles.errorBody}>
            <Text style={styles.errorText}>{grid.errorText}</Text>
            <PressableScale onPress={onRetry} accessibilityRole="button" accessibilityLabel="Yeniden dene" style={styles.retry}>
              <Text style={styles.retryText}>Yeniden dene</Text>
            </PressableScale>
          </View>
        </View>
      ) : (
        <View testID="style-card" style={styles.card}>
          {grid.tiles.map((tile, index) => {
            const quiet = tile.state === 'empty' || tile.state === 'loading';
            return (
              <PressableScale key={tile.id} testID={`style-tile-${tile.id}-${tile.state}`}
                onPress={() => setOpenId(tile.id)} accessibilityRole="button"
                accessibilityLabel={`${tile.title}: ${tile.valueText}`}
                style={[styles.row, index > 0 && styles.rowDivider]}>
                <Text style={styles.rowLabel} numberOfLines={1}>{tile.title}</Text>
                <View style={styles.rowContent}>
                  <TileVisual tile={tile} />
                  <Text style={quiet ? styles.quiet : styles.value} numberOfLines={1}>{tile.valueText}</Text>
                  {tile.label ? <Text style={styles.declared} numberOfLines={1}>{tile.label}</Text> : null}
                </View>
                <ChevronRight size={15} color={colors.line} />
              </PressableScale>
            );
          })}
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
            {sheet.button ? (
              <PressableScale accessibilityRole="button" accessibilityLabel={sheet.button.label} style={styles.primary}
                onPress={() => { setOpenId(null); if (sheet.button) onSelectSection(sheet.button.section); }}>
                <Text style={styles.primaryText}>{sheet.button.label}</Text>
              </PressableScale>
            ) : null}
          </View>
        </ProfileSheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  headingRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  heading: { color: colors.text, fontSize: 20, fontWeight: '800' },
  hint: { color: colors.tabInactive, fontSize: 11, lineHeight: 15 },
  card: { borderRadius: radius.card, backgroundColor: colors.input, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  row: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  rowLabel: { width: 92, ...PROFILE_MENU_LABEL },
  rowContent: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  value: { flexShrink: 1, color: colors.valueMuted, fontSize: 15, lineHeight: 20, fontWeight: '500' },
  quiet: { flexShrink: 1, color: colors.tabInactive, fontSize: 14, lineHeight: 20 },
  declared: { color: colors.tabInactive, fontSize: 10, lineHeight: 14, fontWeight: '600' },
  errorBody: { gap: spacing.md, padding: spacing.lg },
  errorText: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  retry: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.button, backgroundColor: colors.profileRed },
  retryText: { color: colors.inverseText, fontSize: 14, fontWeight: '700' },
  sheetBody: { gap: spacing.md },
  sheetValue: { color: colors.text, fontSize: 18, lineHeight: 24, fontWeight: '800' },
  source: { gap: spacing.sm },
  sourceHeading: { color: colors.text, fontSize: 14, fontWeight: '700' },
  stack: { flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: colors.line },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: colors.textSecondary, fontSize: 12, lineHeight: 16 },
  note: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  primary: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.button, backgroundColor: colors.profileRed },
  primaryText: { color: colors.inverseText, fontSize: 15, fontWeight: '700' },
});
