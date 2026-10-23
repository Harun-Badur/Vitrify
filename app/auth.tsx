import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowUpRight,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
} from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';
import * as Apple from 'expo-apple-authentication';
import Constants from 'expo-constants';
import PressableScale from '../components/PressableScale';
import { useAuthContext } from '../hooks/useAuthContext';
import {
  isAppleSignInAvailable,
  type SocialProvider,
} from '../services/socialAuthService';
import { isEmailRateLimitError } from '../lib/authError';
import { colors, radius, spacing } from '../lib/theme';

type AuthMode = 'login' | 'signup';
function GoogleMark() {
  // Official provider mark colors are independent of Vitrify's screen palette.
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" accessible={false}>
      <Path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.32 2.98-7.36Z"
      />
      <Path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.9 6.62-2.42l-3.24-2.51c-.9.6-2.05.97-3.38.97-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z"
      />
      <Path
        fill="#FBBC05"
        d="M6.41 13.92a6 6 0 0 1 0-3.84V7.49H3.07a10 10 0 0 0 0 9.02l3.34-2.59Z"
      />
      <Path
        fill="#EA4335"
        d="M12 5.96c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.49l3.34 2.59C7.2 7.72 9.4 5.96 12 5.96Z"
      />
    </Svg>
  );
}
export default function AuthScreen() {
  const { signIn, signUp, signInSocial } = useAuthContext();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<'email' | SocialProvider | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [info, setInfo] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(true);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const operation = useRef(false);
  const mounted = useRef(true);
  const passwordInput = useRef<TextInput>(null);
  const signupSent = useRef(false);
  const isLoading = busy !== null;
  const cooldown = Math.max(0, Math.ceil((retryAt - now) / 1000));
  useEffect(() => {
    mounted.current = true;
    void isAppleSignInAvailable().then((value) => {
      if (mounted.current) setAppleAvailable(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted.current) setReduceMotion(value);
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    if (retryAt <= Date.now()) return;
    const timer = setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= retryAt) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);
  const showMessage = (text: string, informational = false) => {
    if (!mounted.current) return;
    setInfo(informational);
    setMessage(text);
    AccessibilityInfo.announceForAccessibility(text);
  };
  const submit = async (provider: 'email' | SocialProvider) => {
    if (operation.current) return;
    if (provider === 'email') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        showMessage('Geçerli bir e-posta adresi gir.');
        return;
      }
      if (password.length < 6) {
        showMessage('Şifre en az 6 karakter olmalı.');
        return;
      }
      if (mode === 'signup' && (cooldown > 0 || signupSent.current)) return;
    }
    operation.current = true;
    setBusy(provider);
    setMessage(null);
    Keyboard.dismiss();
    try {
      if (provider !== 'email') {
        const result = await signInSocial(provider);
        if (result === 'cancelled')
          showMessage(
            'Giriş iptal edildi. Hazır olduğunda tekrar devam edebilirsin.',
            true,
          );
      } else if (mode === 'login')
        await signIn({ email: email.trim(), password });
      else {
        const result = await signUp({ email: email.trim(), password });
        if (result.needsEmailConfirmation) {
          signupSent.current = true;
          showMessage(
            'Doğrulama e-postanı kontrol et. Bağlantıyı onayladıktan sonra giriş yapabilirsin.',
            true,
          );
        }
      }
    } catch (error) {
      if (!mounted.current) return;
      if (
        isEmailRateLimitError(error) ||
        (error instanceof Error &&
          error.cause &&
          isEmailRateLimitError(error.cause))
      ) {
        setRetryAt(Date.now() + 60_000);
        setNow(Date.now());
      }
      // All service messages are sanitized; never log provider details or credentials.
      showMessage(
        error instanceof Error
          ? error.message
          : 'İşlem tamamlanamadı. Lütfen tekrar dene.',
      );
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(null);
    }
  };
  const changeMode = (next: AuthMode) => {
    if (operation.current) return;
    setMode(next);
    setMessage(null);
    setPassword('');
    setShowPassword(false);
  };
  const emailDisabled =
    isLoading || (mode === 'signup' && (cooldown > 0 || signupSent.current));
  const submitLabel =
    mode === 'login'
      ? 'Giriş Yap'
      : signupSent.current
        ? 'E-postanı Kontrol Et'
        : cooldown > 0
          ? `Tekrar dene · ${cooldown} sn`
          : 'Hesabını Oluştur';
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        style={styles.viewport}
        bounces={false}
        overScrollMode="never"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scroll,
          {
            paddingTop: insets.top + 16,
            paddingBottom: Math.max(insets.bottom, 16),
          },
        ]}
      >
        <View style={styles.content}>
          <Animated.View
            key={mode}
            entering={
              reduceMotion ? undefined : FadeInDown.delay(90).duration(420)
            }
            style={styles.panel}
          >
            <View style={styles.modeRow}>
              {(['login', 'signup'] as const).map((value) => (
                <Pressable
                  key={value}
                  onPress={() => changeMode(value)}
                  disabled={isLoading}
                  accessibilityRole="tab"
                  accessibilityState={{
                    selected: mode === value,
                    disabled: isLoading,
                  }}
                  accessibilityLabel={
                    value === 'login' ? 'Giriş yap' : 'Kayıt ol'
                  }
                  style={[styles.mode, mode === value && styles.selectedMode]}
                >
                  <Text
                    style={[
                      styles.modeText,
                      mode === value && styles.selectedModeText,
                    ]}
                  >
                    {value === 'login' ? 'Giriş yap' : 'Kayıt ol'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.formTitle}>
              {mode === 'login' ? 'Tekrar hoş geldin' : 'Stiline yer aç'}
            </Text>
            <Text style={styles.formSubtitle}>
              {mode === 'login'
                ? 'Kaldığın yerden devam et.'
                : 'İlk parçadan başlayalım.'}
            </Text>
            <PressableScale
              onPress={() => void submit('google')}
              disabled={isLoading}
              accessibilityRole="button"
              accessibilityLabel="Google ile Devam Et"
              accessibilityState={{
                disabled: isLoading,
                busy: busy === 'google',
              }}
              style={styles.socialButton}
            >
              {busy === 'google' ? (
                <ActivityIndicator color={colors.text} />
              ) : (
                <GoogleMark />
              )}
              <Text style={styles.socialText}>Google ile Devam Et</Text>
            </PressableScale>
            {appleAvailable && Platform.OS === 'ios' && (
              <View
                style={styles.appleWrap}
                pointerEvents={isLoading ? 'none' : 'auto'}
                accessibilityState={{
                  disabled: isLoading,
                  busy: busy === 'apple',
                }}
              >
                <Apple.AppleAuthenticationButton
                  buttonType={Apple.AppleAuthenticationButtonType.CONTINUE}
                  buttonStyle={Apple.AppleAuthenticationButtonStyle.BLACK}
                  cornerRadius={radius.button}
                  style={styles.appleButton}
                  onPress={() => void submit('apple')}
                  accessibilityLabel="Apple ile Devam Et"
                />
                {busy === 'apple' && (
                  <View style={styles.appleLoading}>
                    <ActivityIndicator color={colors.inverseText} />
                  </View>
                )}
              </View>
            )}
            {Constants.appOwnership === 'expo' && (
              <Text style={styles.buildHint}>
                Expo Go’da e-posta ile devam edebilirsin. Sosyal giriş
                development build’de kullanılabilir.
              </Text>
            )}
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerLabel}>veya e-posta ile</Text>
              <View style={styles.dividerLine} />
            </View>
            <Text style={styles.label}>E-POSTA</Text>
            <View style={styles.field}>
              <Mail size={18} color={colors.textSecondary} accessible={false} />
              <TextInput
                accessibilityLabel="E-posta"
                value={email}
                onChangeText={(value) => {
                  setEmail(value);
                  signupSent.current = false;
                }}
                placeholder="sen@ornek.com"
                placeholderTextColor={colors.placeholder}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="emailAddress"
                autoComplete="email"
                returnKeyType="next"
                onSubmitEditing={() => passwordInput.current?.focus()}
                editable={!isLoading}
                style={styles.input}
              />
            </View>
            <Text style={styles.label}>ŞİFRE</Text>
            <View style={styles.field}>
              <LockKeyhole
                size={18}
                color={colors.textSecondary}
                accessible={false}
              />
              <TextInput
                ref={passwordInput}
                accessibilityLabel="Şifre"
                value={password}
                onChangeText={setPassword}
                placeholder={mode === 'signup' ? 'En az 6 karakter' : 'Şifren'}
                placeholderTextColor={colors.placeholder}
                secureTextEntry={!showPassword}
                textContentType={mode === 'signup' ? 'newPassword' : 'password'}
                autoComplete={
                  mode === 'signup' ? 'new-password' : 'current-password'
                }
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={() => void submit('email')}
                editable={!isLoading}
                style={styles.input}
              />
              <Pressable
                onPress={() => setShowPassword((value) => !value)}
                accessibilityRole="button"
                accessibilityLabel={
                  showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'
                }
                hitSlop={8}
                style={styles.eye}
              >
                {showPassword ? (
                  <EyeOff size={20} color={colors.textSecondary} />
                ) : (
                  <Eye size={20} color={colors.textSecondary} />
                )}
              </Pressable>
            </View>
            {message && (
              <View style={[styles.notice, info && styles.infoNotice]}>
                <Text
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                  style={[styles.noticeText, info && styles.infoText]}
                >
                  {message}
                </Text>
              </View>
            )}
            <PressableScale
              onPress={() => void submit('email')}
              disabled={emailDisabled}
              accessibilityRole="button"
              accessibilityLabel={submitLabel}
              accessibilityState={{
                disabled: emailDisabled,
                busy: busy === 'email',
              }}
              style={[styles.submit, emailDisabled && styles.disabled]}
            >
              {busy === 'email' ? (
                <ActivityIndicator color={colors.inverseText} />
              ) : (
                <>
                  <Text style={styles.submitText}>{submitLabel}</Text>
                  <ArrowUpRight
                    size={20}
                    color={colors.inverseText}
                    accessible={false}
                  />
                </>
              )}
            </PressableScale>
            <Text style={styles.privacy}>
              Tercihlerin sana özel. Kontrol her zaman sende.
            </Text>
          </Animated.View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.input },
  viewport: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: spacing.xl },
  content: { width: '100%', maxWidth: 460, alignSelf: 'center' },
  panel: { paddingVertical: 8 },
  modeRow: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    padding: 4,
    borderRadius: radius.chip,
    marginBottom: 24,
  },
  mode: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.chip,
  },
  selectedMode: { backgroundColor: colors.text },
  modeText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  selectedModeText: { color: colors.inverseText },
  formTitle: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.6,
    color: colors.text,
  },
  formSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 6,
    marginBottom: 22,
  },
  socialButton: {
    minHeight: 54,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialText: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '600',
    flexShrink: 1,
  },
  appleWrap: { marginTop: 10 },
  appleButton: { width: '100%', height: 54 },
  appleLoading: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.text,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buildHint: {
    fontSize: 11,
    lineHeight: 17,
    color: colors.textSecondary,
    marginTop: 12,
  },
  divider: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    marginVertical: 24,
  },
  dividerLine: { height: 1, backgroundColor: colors.border, flex: 1 },
  dividerLabel: { color: colors.textSecondary, fontSize: 11 },
  label: {
    fontSize: 10,
    letterSpacing: 1.3,
    color: colors.textSecondary,
    fontWeight: '700',
    marginBottom: 8,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.bgSoft,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    paddingHorizontal: 14,
    marginBottom: 16,
    minHeight: 54,
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 16,
    fontSize: 15,
    color: colors.text,
  },
  eye: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notice: {
    padding: 12,
    backgroundColor: colors.bg,
    borderRadius: 12,
    marginBottom: 16,
  },
  infoNotice: { backgroundColor: colors.accentSoft },
  noticeText: { fontSize: 12, lineHeight: 19, color: colors.destructive },
  infoText: { color: colors.accentDark },
  submit: {
    minHeight: 54,
    borderRadius: radius.button,
    backgroundColor: colors.accent,
    paddingHorizontal: 18,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  submitText: {
    color: colors.inverseText,
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
  },
  disabled: { opacity: 0.6 },
  privacy: {
    textAlign: 'center',
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 18,
    lineHeight: 17,
  },

});
