import * as Sentry from '@sentry/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import type { LogContext } from './logger.ts';
import { perfSetSpanSink } from './perfLog';
import { buildDeviceTags, scrubBreadcrumb, scrubEvent, scrubTransaction } from './sentryScrub';

/** Share of sessions that send performance data (also reported to Sentry as tracesSampleRate). */
export const TRACES_SAMPLE_RATE = 0.15;
const ANON_ID_KEY = 'sentry_anon_id';

let sentryReady = false;
let navigationIntegration: ReturnType<typeof Sentry.reactNavigationIntegration> | null = null;

// Sentry is off without a DSN and in development; the DSN only ever comes from the public env var.
const getSentryDsn = (): string | null => {
  if (__DEV__) {
    return null;
  }
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn) {
    return null;
  }
  return dsn;
};

export const isSentryEnabled = (): boolean => getSentryDsn() !== null;

const readDeviceTags = (): Record<string, string> => {
  const versionCode = Constants.expoConfig?.android?.versionCode;
  return buildDeviceTags({
    model: Device.modelName ?? null,
    osVersion: Device.osVersion ?? null,
    totalMemory: Device.totalMemory ?? null,
    appVersion: Constants.expoConfig?.version ?? null,
    versionCode: typeof versionCode === 'number' ? versionCode : null,
  });
};

// Random per-install id; never the account id, e-mail or any profile value.
const identifyAnonymously = async (): Promise<void> => {
  try {
    let id = await AsyncStorage.getItem(ANON_ID_KEY);
    if (!id) {
      id = `anon-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
      await AsyncStorage.setItem(ANON_ID_KEY, id);
    }
    Sentry.setUser({ id });
  } catch {
    // Without an id events are simply anonymous.
  }
};

const emitPerfSpan = (
  name: string,
  ms: number,
  attributes: Record<string, number | boolean | string>,
): void => {
  const endSeconds = Date.now() / 1000;
  const span = Sentry.startInactiveSpan({
    name,
    op: 'perf',
    forceTransaction: true,
    startTime: endSeconds - ms / 1000,
    attributes,
  });
  span.end(endSeconds);
};

export const initSentry = (): void => {
  if (sentryReady) {
    return;
  }

  const dsn = getSentryDsn();
  if (dsn === null) {
    return;
  }

  // One decision per session: sampled sessions send every transaction and the [PERF] spans.
  const sessionSampled = Math.random() < TRACES_SAMPLE_RATE;
  navigationIntegration = Sentry.reactNavigationIntegration();

  Sentry.init({
    dsn,
    enabled: true,
    sendDefaultPii: false,
    tracesSampleRate: TRACES_SAMPLE_RATE,
    tracesSampler: () => (sessionSampled ? 1 : 0),
    enableNativeFramesTracking: true,
    enableAppStartTracking: true,
    enableStallTracking: true,
    integrations: [navigationIntegration],
    beforeSend: (event) => scrubEvent(event as never) as typeof event,
    beforeSendTransaction: (event) => scrubTransaction(event as never) as typeof event,
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb as never) as typeof breadcrumb | null,
  });
  sentryReady = true;

  try {
    Sentry.setTags(readDeviceTags());
  } catch {
    // Tags are diagnostics only.
  }
  void identifyAnonymously();
  if (sessionSampled) {
    perfSetSpanSink(emitPerfSpan);
  }
};

/** Screen-transition tracing: pass the expo-router navigation container ref. */
export const registerSentryNavigation = (
  containerRef: Parameters<NonNullable<typeof navigationIntegration>['registerNavigationContainer']>[0],
): void => {
  if (!sentryReady || navigationIntegration === null) {
    return;
  }
  navigationIntegration.registerNavigationContainer(containerRef);
};

export const captureLoggedError = (
  message: string,
  context: LogContext | null,
): void => {
  if (!sentryReady) {
    return;
  }

  Sentry.captureException(new Error(message), {
    extra: context ?? undefined,
  });
};

export const captureUnhandledError = (
  error: Error,
  context?: LogContext,
): void => {
  if (!sentryReady) {
    return;
  }

  Sentry.captureException(error, {
    extra: context,
  });
};

/** A feed request hit its deadline; carries the duration only. */
export const captureFeedTimeout = (ms: number): void => {
  if (!sentryReady) {
    return;
  }

  Sentry.captureMessage('feed_timeout', {
    level: 'warning',
    tags: { feed: 'timeout' },
    extra: { ms },
  });
};

initSentry();
