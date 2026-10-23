import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Crown, ChevronRight } from 'lucide-react-native';
import ProfileSheet from './ProfileSheet';
import { usePremium } from '../hooks/usePremium';
import { premiumLegalLinks } from '../services/revenueCatMobile';
import { colors, radius, spacing } from '../lib/theme';
import { PRIVACY_URL } from '../lib/privacy';

export default function PremiumMembership() {
  const { state, client } = usePremium();
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [linkError, setLinkError] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      void client.refresh();
    }, [client, state.owner]),
  );
  const membership = state.membership;
  const chosen =
    state.packages.find((p) => p.id === selected) ?? state.packages[0];
  const status = membership
    ? membership.tier === 'premium'
      ? 'Premium'
      : 'Ücretsiz hesap'
    : state.busy
      ? 'Üyelik kontrol ediliyor…'
      : 'Üyelik doğrulanamadı';
  const quota =
    membership?.dailyLimit != null
      ? `Günlük sınır: ${membership.dailyLimit} AI sanal deneme · 00.00 UTC’de yenilenir.`
      : 'Günlük hak bilgisi şu anda doğrulanamıyor.';
  const canPurchase = Boolean(
    chosen &&
    membership?.tier === 'free' &&
    membership.dailyLimit !== null &&
    !state.busy &&
    !state.awaitingVerification &&
    state.configured,
  );
  const link = async (url: string | null) => {
    if (!url) return;
    try {
      await Linking.openURL(url);
      setLinkError(null);
    } catch {
      setLinkError('Bağlantı açılamadı. Lütfen daha sonra tekrar dene.');
    }
  };
  return (
    <>
      <Pressable
        style={styles.card}
        accessibilityRole="button"
        accessibilityLabel={`Vitrify üyeliği: ${status}`}
        onPress={() => setOpen(true)}
      >
        <LinearGradient colors={[colors.journeyLight, colors.journeyPink]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.banner}>
        <View style={styles.crown}><Crown size={30} color={colors.accent} /></View>
        <View style={styles.bannerCopy}>
        <Text style={styles.title}>
          Vitrify {status === 'Premium' ? 'Premium' : 'Üyelik'}
        </Text>
        <Text style={styles.body} accessibilityLiveRegion="polite">
          {status}
        </Text>
        {membership ? <Text style={styles.body}>{quota}</Text> : null}
        </View>
        <View style={styles.bannerAction}><Text style={styles.link}>Üyeliği görüntüle</Text><ChevronRight color={colors.accent} size={20} /></View>
        </LinearGradient>
      </Pressable>
      <ProfileSheet
        visible={open}
        title="Vitrify Premium"
        onClose={() => setOpen(false)}
      >
        <View style={styles.content}>
          <Text style={styles.title}>{status}</Text>
          <Text style={styles.body}>{quota}</Text>
          {membership?.tier === 'premium' && membership.expiresAtMs ? (
            <Text style={styles.body}>
              {new Date(membership.expiresAtMs).toLocaleString('tr-TR')}{' '}
              tarihine kadar doğrulandı.
            </Text>
          ) : null}
          <Text style={styles.body}>
            Premium ile daha fazla AI sanal deneme ve tamamen reklamsız
            kullanım. Keşfet, Favoriler, Dolap ve manuel Kombin Oluştur ücretsiz
            kalır.
          </Text>
          {state.busy ? (
            <ActivityIndicator
              color={colors.accent}
              accessibilityLabel="Üyelik işlemi sürüyor"
            />
          ) : null}
          {state.message ? (
            <Text style={styles.body} accessibilityLiveRegion="polite">
              {state.message}
            </Text>
          ) : null}
          {!state.configured ? (
            <Text style={styles.body}>
              Premium satın alma henüz kullanıma hazır değil. Temel özellikleri
              kullanmaya devam edebilirsin.
            </Text>
          ) : null}
          {state.configured && !membership?.dailyLimit && membership ? (
            <Text style={styles.body}>
              Satın alma henüz kullanıma açılmadı.
            </Text>
          ) : null}
          {state.configured && membership?.tier !== 'premium'
            ? state.packages.map((pack) => (
                <Pressable
                  key={pack.id}
                  style={[
                    styles.option,
                    chosen?.id === pack.id && styles.selected,
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{
                    selected: chosen?.id === pack.id,
                    disabled: state.busy,
                  }}
                  disabled={state.busy}
                  onPress={() => setSelected(pack.id)}
                >
                  <Text style={styles.title}>
                    {pack.period === 'monthly' ? 'Aylık' : 'Yıllık'}
                  </Text>
                  <Text style={styles.body}>
                    {pack.price} / {pack.period === 'monthly' ? 'ay' : 'yıl'}
                  </Text>
                </Pressable>
              ))
            : null}
          {state.configured && membership?.tier !== 'premium' ? (
            <>
              <Text style={styles.body}>
                Abonelik iptal edilmedikçe seçilen dönemle otomatik yenilenir.
                Ücretsiz deneme sunulmaz. Ödemeyi mağaza onay ekranında kontrol
                et.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Premium aboneliği satın al"
                accessibilityState={{ disabled: !canPurchase }}
                disabled={!canPurchase}
                style={[styles.button, !canPurchase && styles.disabled]}
                onPress={() => {
                  if (chosen) void client.purchase(chosen.id);
                }}
              >
                <Text style={styles.buttonText}>Premium’a geç</Text>
              </Pressable>
            </>
          ) : null}
          {state.configured ? <>
          <Pressable
            accessibilityRole="button"
            disabled={state.busy || !state.configured}
            style={styles.action}
            onPress={() => void client.refresh(true)}
          >
            <Text style={styles.link}>Üyelik durumunu yenile</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={state.busy || !state.configured || !membership}
            style={styles.action}
            onPress={() => void client.restore()}
          >
            <Text style={styles.link}>Satın alımları geri yükle</Text>
          </Pressable>
          <Text style={styles.body}>
            Geri yükleme, satın alımın bağlı olduğu Vitrify hesabında yapılır.
            Hesap uyuşmazlığında destek al; otomatik transfer yapılmaz.
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={state.busy || !state.configured}
            style={styles.action}
            onPress={() => void client.manage()}
          >
            <Text style={styles.link}>Aboneliği mağazada yönet</Text>
          </Pressable>
          </> : null}
          {[
            [premiumLegalLinks.terms, 'Kullanım koşulları'],
            [PRIVACY_URL, 'Gizlilik politikası'],
            [premiumLegalLinks.support, 'Destek'],
          ].map(([url, label]) => (
            <Pressable
              key={label}
              accessibilityRole="link"
              disabled={!url}
              style={styles.action}
              onPress={() => void link(url)}
            >
              <Text style={styles.link}>{label}</Text>
            </Pressable>
          ))}
          {linkError ? (
            <Text accessibilityLiveRegion="polite" style={styles.body}>
              {linkError}
            </Text>
          ) : null}
        </View>
      </ProfileSheet>
    </>
  );
}
const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card, overflow: 'hidden', borderWidth: 1, borderColor: colors.journeyPink,
  },
  banner: { padding: spacing.md, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  crown: { width: 44, height: 48, borderRadius: 14, backgroundColor: colors.glass, alignItems: 'center', justifyContent: 'center' },
  bannerCopy: { flex: 1, minWidth: 100 },
  bannerAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.input, borderRadius: 16, paddingHorizontal: spacing.sm },
  content: { gap: spacing.lg, paddingBottom: spacing.lg },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  body: { color: colors.textSecondary, fontSize: 14, lineHeight: 22 },
  link: { color: colors.accentDark, fontSize: 15, fontWeight: '600' },
  option: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    padding: spacing.lg,
    gap: spacing.sm,
    minHeight: 64,
  },
  selected: {
    borderColor: colors.accentDark,
    backgroundColor: colors.accentSoft,
  },
  button: {
    backgroundColor: colors.accentDark,
    borderRadius: radius.button,
    padding: spacing.lg,
    minHeight: 48,
    alignItems: 'center',
  },
  disabled: { opacity: 0.45 },
  buttonText: { color: colors.inverseText, fontSize: 16, fontWeight: '700' },
  action: { minHeight: 48, justifyContent: 'center' },
});
