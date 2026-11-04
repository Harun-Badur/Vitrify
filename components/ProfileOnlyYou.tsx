import { StyleSheet, Text, View } from 'react-native';
import { ChevronRight, Ruler, Shirt } from 'lucide-react-native';
import PressableScale from './PressableScale';
import { colors, radius, spacing } from '../lib/theme';
import type { StyleJourney } from '../lib/profileStyleJourney';
import { buildOnlyYou, type DeclarationSection } from '../lib/profileStyleView';

const ICONS = { style: Shirt, body: Ruler } as const;

export default function ProfileOnlyYou({ journey, onOpen, disabled }: {
  journey: StyleJourney; onOpen: (section: DeclarationSection) => void; disabled: boolean;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.headingBlock}>
        <Text style={styles.heading}>Sadece sen belirlersin</Text>
        <Text style={styles.sub}>Bunları tahmin etmiyoruz.</Text>
      </View>
      <View style={styles.card}>
        {buildOnlyYou(journey).map((box, index) => {
          const Icon = ICONS[box.id];
          return (
            <PressableScale key={box.id} disabled={disabled} onPress={() => onOpen(box.section)} accessibilityRole="button"
              accessibilityLabel={box.value === null ? `${box.title} ekle` : `${box.title}: ${box.value}. Düzenle`}
              style={[styles.row, index > 0 && styles.rowDivider]}>
              <View style={styles.icon}><Icon size={18} color={colors.ink} /></View>
              <View style={styles.copy}>
                <Text style={styles.title}>{box.title}</Text>
                <Text style={box.value === null ? styles.unset : styles.value} numberOfLines={1}>{box.value ?? 'Belirlenmedi'}</Text>
              </View>
              {box.value === null
                ? <Text testID={`only-you-${box.id}-add`} style={styles.add}>Ekle</Text>
                : <ChevronRight size={15} color={colors.line} />}
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  headingBlock: { gap: 2 },
  heading: { color: colors.text, fontSize: 20, fontWeight: '800' },
  sub: { color: colors.tabInactive, fontSize: 13, lineHeight: 18 },
  card: { borderRadius: radius.card, backgroundColor: colors.input, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  row: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  title: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '700' },
  unset: { color: colors.tabInactive, fontSize: 13, lineHeight: 18 },
  value: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  add: { color: colors.profileRed, fontSize: 14, fontWeight: '700' },
});
