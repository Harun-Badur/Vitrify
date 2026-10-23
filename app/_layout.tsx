import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AppErrorBoundary from '../components/AppErrorBoundary';
import OnboardingScreen from '../components/OnboardingScreen';
import { AuthProvider, useAuthContext } from '../hooks/useAuthContext';
import { PremiumProvider } from '../hooks/usePremium';
import { initAnalytics, track } from '../lib/analytics';
import { logger } from '../lib/logger';
import { STACK_TRANSITION_MS } from '../lib/motion';
import {
  hasCompletedOnboarding,
  markOnboardingComplete,
} from '../lib/onboarding';
import { colors, spacing } from '../lib/theme';
import { useAppStore } from '../store/useAppStore';
import { resumePendingAccountDeletions, subscribeAccountDeletionProgress, getAccountDeletionProgress, dismissAccountDeletionProgress } from '../services/accountService';
import { createAccountDeletionRuntime } from '../services/accountDeletionRuntime';
import { useWardrobeCutoutResume } from '../hooks/useWardrobeCutoutResume';

const registerPushIfSupported = async (userId: string): Promise<void> => {
  if (Constants.appOwnership === 'expo') {
    return;
  }

  try {
    const { registerForPushNotifications } =
      await import('../services/notificationService');
    await registerForPushNotifications(userId);
  } catch (error: unknown) {
    logger.info('Push kaydı atlandı', { error });
  }
};

type OnboardingGate = 'checking' | 'required' | 'done';

function RootNavigator() {
  useWardrobeCutoutResume();
  useEffect(() => { void resumePendingAccountDeletions(owner => createAccountDeletionRuntime(owner, async () => {
    const store = useAppStore.getState();
    if (store.sessionUserId === owner) store.resetSession();
    return useAppStore.getState().sessionUserId !== owner;
  })).catch(() => {
    logger.warn('Hesap silme recovery deposu okunamadı.');
  }); }, []);
  const { user, loading, signOut } = useAuthContext();
  const [, refreshDeletionProgress] = useState(0);
  useEffect(() => subscribeAccountDeletionProgress(() => refreshDeletionProgress(revision => revision + 1)), []);
  const hydrateSession = useAppStore((state) => state.hydrateSession);
  const resetSession = useAppStore((state) => state.resetSession);
  const [onboardingGate, setOnboardingGate] =
    useState<OnboardingGate>('checking');

  const userId = user?.id ?? null;
  const deletionProgress = getAccountDeletionProgress(userId);
  useEffect(() => {
    if (userId && deletionProgress?.phase === 'completed') {
      void signOut().catch(() => logger.warn('Silme doğrulandı; yerel oturum kapatılamadı.'));
    }
  }, [userId, deletionProgress?.phase, signOut]);

  useEffect(() => {
    let cancelled = false;
    const loadGate = async (): Promise<void> => {
      const completed = await hasCompletedOnboarding();
      if (!cancelled) {
        setOnboardingGate(completed ? 'done' : 'required');
      }
    };
    void loadGate();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (userId === null) {
      resetSession();
      return;
    }
    void hydrateSession(userId);
    void registerPushIfSupported(userId);
  }, [hydrateSession, resetSession, userId]);

  const handleOnboardingComplete = useCallback((): void => {
    void markOnboardingComplete().then(() => {
      setOnboardingGate('done');
    });
  }, []);

  if (deletionProgress && deletionProgress.phase !== 'completed') {
    return (
      <View style={styles.boot} accessibilityLabel="Hesap silme durumu" accessibilityLiveRegion="polite">
        {deletionProgress.phase !== 'stopped' ? <ActivityIndicator color={colors.accent} size="large" /> : null}
        <Text style={styles.bootText}>{deletionProgress.phase === 'stopped' ? 'Silme işlemi güvenli durumda bekliyor' : 'Hesabın siliniyor'}</Text>
        <Text style={styles.deletionText}>{deletionProgress.message}</Text>
        <Text style={styles.deletionText}>Tamamlanma doğrulanmadan başarı gösterilmez. Uygulama kapanırsa mevcut kurtarma kaydıyla devam edilir.</Text>
        {deletionProgress.phase === 'stopped' && userId ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Bekleme bilgisini kapat"
            onPress={() => dismissAccountDeletionProgress(userId)}>
            <Text style={styles.bootText}>Tamam</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  if (loading || onboardingGate === 'checking') {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.bootText}>Vitrify açılıyor...</Text>
      </View>
    );
  }

  if (onboardingGate === 'required') {
    return <OnboardingScreen onComplete={handleOnboardingComplete} />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: styles.stackContent,
        animation: 'fade',
        animationDuration: STACK_TRANSITION_MS,
      }}
    >
      <Stack.Protected guard={user !== null}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="wardrobe" />
      </Stack.Protected>
      <Stack.Protected guard={user === null}>
        <Stack.Screen name="auth" />
      </Stack.Protected>
    </Stack>
  );
}

function AnalyticsRuntime() {
  const pathname = usePathname();
  const previousPathRef = useRef<string | null>(null);

  useEffect(() => {
    initAnalytics();
  }, []);

  useEffect(() => {
    const from = previousPathRef.current;
    if (from !== null && from !== pathname) {
      track('back', null, { from, to: pathname });
    }
    previousPathRef.current = pathname;
  }, [pathname]);

  return null;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <AppErrorBoundary>
        <AuthProvider>
          <PremiumProvider>
            <AnalyticsRuntime />
            <RootNavigator />
          </PremiumProvider>
        </AuthProvider>
        <StatusBar style="dark" />
      </AppErrorBoundary>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  deletionText: { marginTop: spacing.md, paddingHorizontal: spacing.xl, textAlign: 'center', color: colors.textSecondary },
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  stackContent: {
    backgroundColor: colors.bg,
  },
  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  bootText: {
    marginTop: spacing.lg,
    fontSize: 16,
    fontWeight: '700',
    color: colors.textSecondary,
  },
});
