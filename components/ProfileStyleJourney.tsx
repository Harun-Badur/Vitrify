import { useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle } from 'react-native-svg';
import { ChevronRight, Layers, Palette, Shirt, Sparkles, Ruler, Tag, Database, ShoppingBag } from 'lucide-react-native';
import PressableScale from './PressableScale';
import { colors, radius, shadows, spacing } from '../lib/theme';
import type { JourneyTarget, StyleJourney } from '../lib/profileStyleJourney';

export default function ProfileStyleJourney({ journey, onTask }: {
  journey: StyleJourney; onTask: (target: JourneyTarget) => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const singleColumn = width < 350 || fontScale > 1.3;
  const [expanded, setExpanded] = useState<string | null>(null);
  const displayed = (['color', 'category', 'fit', 'brand', 'price'] as const).map(id => journey.insights.find(item => item.id === id) ?? { id, title: id, status: 'Henüz keşfedilmedi', summary: 'Yeterli veri yok', detail: 'V1 modunda bu eğilim hesaplanmıyor.' });
  const detail = expanded === 'progress' ? {
    title: 'İlerleme nasıl hesaplanır?',
    detail: '10 farklı değerlendirme %50, 3 dolap parçası %25, 2 geçerli kombin %15 ve belirttiğin bir stil/renk/marka tercih grubu %10 katkı sağlar. '
      + 'Yalnız mevcut kayıtlar sayılır; silme veya undo ile ilerleme değişebilir. Beden ve fiyat bilgileri bu yüzdeye dahil değildir. '
      + '100% tüm içgörülerin açıldığı veya modelin doğru olduğu anlamına gelmez; her içgörü kendi veri eşiğine bağlıdır.',
  } : displayed.find(insight => insight.id === expanded);
  const icons = { color: Palette, category: Shirt, outfits: Layers, style: Sparkles, fit: Ruler, brand: Tag, price: Database };
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Stil Profilin</Text>
      <LinearGradient colors={[colors.journeyLight, colors.journeyPink, colors.journeyLight]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.progressCard}>
        <View pointerEvents="none" style={styles.decoration} />
        <View style={styles.progressRow}>
          <View style={styles.heroIcon}><Sparkles color={colors.accent} size={32} /></View>
          <View style={styles.copy}>
            <Text style={styles.badge}>{journey.status}</Text>
            <Text style={styles.title}>Stil Yolculuğun</Text>
            <Text style={styles.description}>Küçük adımlarla tercihlerini keşfediyoruz.</Text>
          </View>
          <View style={styles.circle} accessibilityRole="progressbar"
            accessibilityLabel="Keşif adımlarının tamamlanması"
            accessibilityValue={{ min: 0, max: 100, now: journey.percent }}>
            <Svg width={64} height={64} viewBox="0 0 72 72">
              <Circle cx={36} cy={36} r={30} fill="none" stroke={colors.accentSoft} strokeWidth={5} />
              <Circle cx={36} cy={36} r={30} fill="none" stroke={colors.accent} strokeWidth={5}
                strokeLinecap="round" strokeDasharray={`${2*Math.PI*30}`}
                strokeDashoffset={2*Math.PI*30*(1-journey.percent/100)} rotation={-90} origin="36, 36" />
            </Svg>
            <Text style={styles.percent}>{journey.percent}%</Text>
          </View>
        </View>
        <PressableScale style={styles.explanation} accessibilityRole="button" accessibilityLabel="İlerleme nasıl hesaplanır?"
          accessibilityState={{ expanded: expanded === 'progress' }}
          onPress={() => setExpanded(current => current === 'progress' ? null : 'progress')}>
          <Text style={[styles.description, { flex: 1 }]}>Keşif adımları; model doğruluğu değildir.</Text>
          <ChevronRight size={15} color={colors.tabInactive} />
        </PressableScale>
        {journey.notice ? <Text style={styles.description}>{journey.notice}</Text> : (
          <PressableScale onPress={() => onTask(journey.task.target)} accessibilityRole="button"
            accessibilityLabel={journey.task.label} style={styles.task}>
            <ShoppingBag size={22} color={colors.accent} />
            <Text style={styles.taskText}>{journey.task.label}</Text>
            <ChevronRight size={16} color={colors.accentDark} />
          </PressableScale>
        )}
      </LinearGradient>
      <Text style={styles.heading}>Eğilimlerin</Text>
      <Text style={styles.description}>Etkileşimlerinden öğrenilen eğilimler. Kaynağı görmek için karta dokun.</Text>
      {journey.insightNotice ? <Text accessibilityRole="alert" style={styles.description}>{journey.insightNotice}</Text> : null}
      <View style={styles.grid}>
        {displayed.map(insight => {
          const Icon = icons[insight.id];
          const title = { color: 'Renk eğilimlerin', category: 'Parça tercihlerin', fit: 'Kesim eğilimlerin', brand: 'Marka eğilimlerin', price: 'Fiyat eğilimlerin', style: '', outfits: '' }[insight.id];
          return (
            <PressableScale key={insight.id} style={[styles.tile, (singleColumn || insight.id === 'price') && styles.tileFull]} accessibilityRole="button"
              accessibilityLabel={`${title}: ${insight.status}`}
              accessibilityState={{ expanded: expanded === insight.id }}
              onPress={() => setExpanded(current => current === insight.id ? null : insight.id)}>
              <View style={styles.icon}><Icon size={22} color={colors.text} /></View>
              <View style={styles.copy}>
                <Text style={styles.tileTitle}>{title}</Text>

                <Text style={styles.value} numberOfLines={3}>{journey.insightNotice ? 'Keşfediliyor' : insight.summary === 'Yeterli tercih verisi yok' || insight.summary === 'Yeterli metadata yok' ? 'Yeterli veri yok' : insight.summary}</Text>
              </View>
              <ChevronRight size={15} color={colors.tabInactive} />
            </PressableScale>
          );
        })}
      </View>
      {detail ? <View style={styles.detail}>
        <Text style={styles.tileTitle}>{detail.title}</Text>
        <Text style={styles.description}>{detail.detail}</Text>
      </View> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  tileFull: { width: '100%' },
  decoration: { position: 'absolute', width: 260, height: 150, borderRadius: 130, backgroundColor: colors.glass, opacity: 0.25, right: -50, top: -80, transform: [{ rotate: '-25deg' }] },
  heroIcon: { width: 44, height: 48, borderRadius: 14, backgroundColor: colors.glass, alignItems: 'center', justifyContent: 'center' },
  badge: { alignSelf: 'flex-start', color: colors.accentDark, backgroundColor: colors.journeyBadge, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 3, fontSize: 11 },
  section: { gap: spacing.sm },
  progressCard: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.card, backgroundColor: colors.accentSoft, overflow: 'hidden', borderWidth: 1, borderColor: colors.journeyPink },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  copy: { flex: 1, minWidth: 0, gap: spacing.xs },
  title: { color: colors.text, fontSize: 17, fontWeight: '800' },
  description: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  circle: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  percent: { position: 'absolute', color: colors.text, fontSize: 18, fontWeight: '800' },
  task: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 48, borderTopWidth: 1, borderTopColor: colors.accentSoft, paddingTop: spacing.sm },
  explanation: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs, minHeight: 44 },
  taskText: { flex: 1, color: colors.accentDark, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  heading: { color: colors.text, fontSize: 20, fontWeight: '800', marginTop: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { width: '48%', flexGrow: 1, minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.md, borderRadius: radius.card,
    backgroundColor: colors.input, borderWidth: 1, borderColor: colors.hairline, ...shadows.segment },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.input, borderWidth: 1, borderColor: colors.hairline, ...shadows.segment },
  tileTitle: { color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '700' },
  status: { color: colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: '600' },
  value: { color: colors.textSecondary, fontSize: 11, lineHeight: 15 },
  detail: { gap: spacing.xs, padding: spacing.md, borderRadius: radius.card,
    backgroundColor: colors.input, borderWidth: 1, borderColor: colors.hairline, ...shadows.segment },
});
