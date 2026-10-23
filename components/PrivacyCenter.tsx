import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  ShieldCheck,
  ChevronRight,
  Database,
  Image,
  SlidersHorizontal,
  FileText,
  Trash2,
} from 'lucide-react-native';
import PressableScale from './PressableScale';
import { colors, radius, spacing } from '../lib/theme';
import {
  ACCOUNT_DELETION_URL,
  PRIVACY_URL,
  SUPPORT_EMAIL,
} from '../lib/privacy';
import { VTON_DISCLOSURE } from '../lib/vtonDisclosure';
import {
  PRIVACY_POLICY_CONTENT,
  PRIVACY_POLICY_DATE,
} from '../lib/privacyPolicyContent';
import { parsePolicyBlocks } from '../lib/privacyPolicy';

const policy = parsePolicyBlocks(PRIVACY_POLICY_CONTENT);
type Section = 'data' | 'photos' | 'permissions' | 'deletion';
interface Props {
  visible: boolean;
  onClose: () => void;
  onDeleteAccount: () => void;
  onOpenPreferences: () => void;
  disabled: boolean;
}

export default function PrivacyCenter({
  visible,
  onClose,
  onDeleteAccount,
  onOpenPreferences,
  disabled,
}: Props) {
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState<Section | null>(null);
  const [readingPolicy, setReadingPolicy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const afterDismiss = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      afterDismiss.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!visible) {
      setExpanded(null);
      setReadingPolicy(false);
      setLinkError(null);
    }
  }, [visible]);
  const back = () => {
    if (readingPolicy) {
      setReadingPolicy(false);
      setLinkError(null);
    } else onClose();
  };
  const openLink = async (url?: string) => {
    setLinkError(null);
    try {
      if (url) await Linking.openURL(url);
      else await Linking.openSettings();
    } catch {
      setLinkError('Bağlantı açılamadı. Lütfen tekrar dene.');
    }
  };
  const leaveFor = (action: () => void) => {
    // iOS must finish dismissing this screen before presenting the existing
    // Profile sheet or deletion alert. No new deletion state or operation.
    if (Platform.OS === 'ios') afterDismiss.current = action;
    onClose();
    if (Platform.OS !== 'ios') action();
  };
  const action = (
    label: string,
    onPress: () => void | Promise<void>,
    destructive = false,
  ) => (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      accessibilityState={{ disabled }}
      style={[styles.action, destructive && styles.destructiveAction]}
      onPress={onPress}
    >
      <Text style={[styles.actionText, destructive && styles.destructiveText]}>
        {label}
      </Text>
      <ChevronRight
        size={18}
        color={destructive ? colors.destructive : colors.accentDark}
      />
    </PressableScale>
  );
  const section = (
    id: Section,
    title: string,
    description: string,
    Icon: typeof Database,
    children: ReactNode,
  ) => (
    <View style={styles.card}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: expanded === id }}
        style={styles.row}
        onPress={() => {
          setLinkError(null);
          setExpanded((current) => (current === id ? null : id));
        }}
      >
        <View style={styles.icon}>
          <Icon size={22} color={colors.text} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.rowTitle}>{title}</Text>
          <Text style={styles.caption}>{description}</Text>
        </View>
        <ChevronRight size={18} color={colors.tabInactive} />
      </PressableScale>
      {expanded === id ? <View style={styles.details}>{children}</View> : null}
    </View>
  );
  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={back}
      presentationStyle="fullScreen"
      onDismiss={() => {
        const action = afterDismiss.current;
        afterDismiss.current = null;
        action?.();
      }}
    >
      <View
        accessibilityViewIsModal
        style={[
          styles.root,
          {
            paddingTop: insets.top,
            paddingLeft: insets.left,
            paddingRight: insets.right,
          },
        ]}
      >
        <View style={styles.header}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Geri"
            onPress={back}
            style={styles.back}
          >
            <ArrowLeft size={24} color={colors.text} />
          </PressableScale>
          <Text accessibilityRole="header" style={styles.headerTitle}>
            {readingPolicy ? 'Gizlilik Politikası' : 'Gizlilik Merkezi'}
          </Text>
        </View>
        <ScrollView
          key={readingPolicy ? 'policy' : 'center'}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Math.max(insets.bottom, spacing.xl) },
          ]}
          showsVerticalScrollIndicator
          accessibilityLabel={
            readingPolicy ? 'Tam gizlilik politikası' : 'Gizlilik bölümleri'
          }
        >
          {readingPolicy ? (
            <>
              <View style={styles.versionCard}>
                <Text style={styles.rowTitle}>
                  Bu uygulama sürümündeki politika
                </Text>
                <Text style={styles.body}>
                  Son güncelleme: {PRIVACY_POLICY_DATE}. Türkçe metin ve
                  İngilizce özeti aşağıda okuyabilirsin.
                </Text>
                {action('Yayımlanmış politikayı aç', () =>
                  openLink(PRIVACY_URL),
                )}
              </View>
              {policy.map((block, index) =>
                block.kind === 'table' ? (
                  <View key={`policy:${index}`} style={styles.table}>
                    {block.rows.map((row, rowIndex) => (
                      <View key={`row:${rowIndex}`} style={styles.tableRow}>
                        {row.map((cell, column) => (
                          <View key={`cell:${column}`} style={styles.cell}>
                            <Text style={styles.caption}>
                              {block.headers[column]}
                            </Text>
                            <Text selectable style={styles.body}>
                              {cell}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text
                    selectable
                    key={`policy:${index}`}
                    accessibilityRole={
                      block.kind === 'heading' ? 'header' : undefined
                    }
                    style={
                      block.kind === 'heading'
                        ? [
                            styles.policyHeading,
                            block.level === 1 && styles.policyTitle,
                          ]
                        : styles.body
                    }
                  >
                    {block.text}
                  </Text>
                ),
              )}
            </>
          ) : (
            <>
              <View style={styles.hero}>
                <View style={styles.shield}>
                  <ShieldCheck size={32} color={colors.accent} />
                </View>
                <Text style={styles.heroTitle}>
                  Gizliliğini tanı,{'\n'}seçimlerini yönet.
                </Text>
                <Text style={styles.body}>
                  Hangi verilerin kullanıldığını, fotoğraflarının nasıl
                  işlendiğini ve mevcut seçeneklerini burada bulabilirsin.
                </Text>
              </View>
              {section(
                'data',
                'Verilerim ve Gizliliğim',
                'Hesabın, etkileşimlerin ve kayıtların',
                Database,
                <>
                  <Text style={styles.body}>
                    Hesap bilgilerin, beğeni ve geçme kayıtların, dolabın, stil
                    tercihlerin ve kullanım etkileşimlerin uygulamanın sunduğu
                    özellikler için işlenir. Kayıtların bir bölümü Supabase
                    üzerinde, cihaz dosyaları ve deneme geçmişi ise cihazında
                    tutulur.
                  </Text>
                  <Text style={styles.body}>
                    Manuel tercihlerin ve etkileşimlerden hesaplanan eğilimlerin
                    farklı kaynaklardır. Keşif ilerlemesi model doğruluğunu
                    göstermez.
                  </Text>
                  {action('Veri tablosunu ve tam politikayı oku', () =>
                    setReadingPolicy(true),
                  )}
                  {action('Verilerim hakkında destek iste', () =>
                    openLink(`mailto:${SUPPORT_EMAIL}`),
                  )}
                </>,
              )}
              {section(
                'photos',
                'Fotoğraflar ve AI Deneme',
                'Aktarım, saklama ve silmenin sınırları',
                Image,
                <>
                  <Text style={styles.body}>{VTON_DISCLOSURE.lead}</Text>
                  {VTON_DISCLOSURE.items.map((item) => (
                    <Text key={item} style={styles.body}>
                      • {item}
                    </Text>
                  ))}
                  <Text style={styles.body}>
                    Cihaz geçmişi en fazla 20 kayıt tutar. 30 gün ve üzerindeki
                    kayıtlar geçmiş açıldığında veya yeni sonuç eklendiğinde
                    budanır; bu, tam 30. günde çalışan bir zamanlayıcı değildir.
                    Kaynak galeri fotoğrafları ve dışarı aktarılan kopyalar ayrı
                    kalır.
                  </Text>
                </>,
              )}
              {section(
                'permissions',
                'İzinlerim ve Tercihlerim',
                'Cihaz izinleri ve mevcut profil tercihleri',
                SlidersHorizontal,
                <>
                  <Text style={styles.body}>
                    Kamera, fotoğraf ve bildirim erişimini cihaz ayarlarından
                    yönetebilirsin. Kullanılabilir seçenekler Android/iOS
                    sürümüne göre değişir.
                  </Text>
                  {action('Cihaz izinlerini aç', () => openLink())}
                  {action('Tercihlerimi düzenle', () =>
                    leaveFor(onOpenPreferences),
                  )}
                  <Text style={styles.body}>
                    VTON kabulü hesabına ve açıklamanın sürümüne bağlıdır;
                    deneme ekranında alınır. Cihaz iznini kapatmak önceden
                    aktarılmış verileri silmez.
                  </Text>
                </>,
              )}
              <View style={styles.card}>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel="Gizlilik Politikası"
                  style={styles.row}
                  onPress={() => {
                    setLinkError(null);
                    setReadingPolicy(true);
                  }}
                >
                  <View style={styles.icon}>
                    <FileText size={22} color={colors.text} />
                  </View>
                  <View style={styles.copy}>
                    <Text style={styles.rowTitle}>Gizlilik Politikası</Text>
                    <Text style={styles.caption}>
                      Tam metin · {PRIVACY_POLICY_DATE}
                    </Text>
                  </View>
                  <ChevronRight size={18} color={colors.tabInactive} />
                </PressableScale>
              </View>
              {section(
                'deletion',
                'Hesap ve Veri Silme',
                'Mevcut silme akışı ve uygulama dışı talep',
                Trash2,
                <>
                  <Text style={styles.body}>
                    Aşağıdaki seçenek Profil’deki mevcut onay akışını açar. Bu
                    ekrana girmek hesabını silmez. Silme tamamlanamadığında
                    yeniden deneme gerekebilir; sağlayıcı ve yedeklerin
                    silinmesi bu istemci tarafından doğrulanmaz.
                  </Text>
                  {action(
                    'Hesap silme seçeneklerini aç',
                    () => leaveFor(onDeleteAccount),
                    true,
                  )}
                  {action('Uygulama dışından silme talebi', () =>
                    openLink(ACCOUNT_DELETION_URL),
                  )}
                  {action('Silme talebi için e-posta', () =>
                    openLink(
                      `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Hesap silme talebi')}`,
                    ),
                  )}
                </>,
              )}
              <Text style={styles.footnote}>
                Politika tarihi: {PRIVACY_POLICY_DATE}. Yayımlanmış kanonik
                adres tam politika ekranında erişilebilir.
              </Text>
            </>
          )}
          {linkError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {linkError}
            </Text>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  back: {
    width: 48,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { flex: 1, color: colors.text, fontSize: 21, fontWeight: '800' },
  content: { paddingHorizontal: spacing.lg, gap: spacing.md },
  hero: {
    padding: spacing.xl,
    borderRadius: radius.card,
    backgroundColor: colors.journeyLight,
    gap: spacing.md,
  },
  shield: {
    width: 60,
    height: 60,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.input,
  },
  heroTitle: {
    color: colors.text,
    fontSize: 27,
    lineHeight: 34,
    fontWeight: '800',
  },
  card: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.input,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
    minHeight: 84,
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 16,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, minWidth: 0, gap: spacing.xs },
  rowTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 22,
  },
  caption: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  body: { color: colors.text, fontSize: 14, lineHeight: 23 },
  details: {
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    padding: spacing.lg,
    gap: spacing.md,
  },
  action: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.bg,
    borderRadius: radius.button,
  },
  actionText: {
    flex: 1,
    color: colors.accentDark,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 21,
  },
  destructiveAction: { backgroundColor: colors.accentSoft },
  destructiveText: { color: colors.destructive },
  footnote: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 19,
    padding: spacing.sm,
  },
  versionCard: {
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.input,
    borderRadius: radius.card,
  },
  policyHeading: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '800',
    marginTop: spacing.md,
  },
  policyTitle: { fontSize: 22, lineHeight: 30 },
  table: { gap: spacing.sm },
  tableRow: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.button,
    backgroundColor: colors.input,
  },
  cell: { gap: spacing.xs },
  error: {
    color: colors.destructive,
    fontSize: 14,
    lineHeight: 22,
    padding: spacing.md,
  },
});
