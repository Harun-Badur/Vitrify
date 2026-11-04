import { StyleSheet, Text, View } from 'react-native';
import { Pencil, Plus } from 'lucide-react-native';
import PressableScale from './PressableScale';
import { colors, radius, shadows, spacing } from '../lib/theme';
import type { StyleJourney } from '../lib/profileStyleJourney';
import { buildOnlyYou, type DeclarationSection } from '../lib/profileStyleView';

export default function ProfileOnlyYou({ journey, onOpen, disabled }: {
  journey: StyleJourney; onOpen: (section: DeclarationSection) => void; disabled: boolean;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Sadece sen belirlersin</Text>
      <View style={styles.row}>
        {buildOnlyYou(journey).map(box => (
          <PressableScale key={box.id} disabled={disabled} onPress={() => onOpen(box.section)} accessibilityRole="button"
            accessibilityLabel={box.value === null ? `${box.title} ekle` : `${box.title}: ${box.value}. Düzenle`}
            style={[styles.box, box.value === null && styles.boxEmpty]}>
            <View style={styles.copy}>
              <Text style={styles.title}>{box.title}</Text>
              <Text style={box.value === null ? styles.unset : styles.value} numberOfLines={2}>
                {box.value ?? 'Belirlenmedi'}
              </Text>
            </View>
            {box.value === null ? (
              <View testID={`only-you-${box.id}-add`} style={styles.add}>
                <Plus size={16} color={colors.inverseText} strokeWidth={3} />
              </View>
            ) : <Pencil size={16} color={colors.textSecondary} />}
          </PressableScale>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  heading: { color: colors.text, fontSize: 20, fontWeight: '800', marginTop: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  box: {
    flex: 1, minWidth: 0, minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.md, borderRadius: radius.box, backgroundColor: colors.input, borderWidth: 1,
    borderColor: colors.hairline, ...shadows.segment,
  },
  boxEmpty: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.profileRed },
  copy: { flex: 1, minWidth: 0, gap: spacing.xs },
  title: { color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '700' },
  value: { color: colors.textSecondary, fontSize: 12, lineHeight: 16 },
  unset: { color: colors.textSecondary, fontSize: 12, lineHeight: 16, opacity: 0.8 },
  add: {
    width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.profileRed,
  },
});
