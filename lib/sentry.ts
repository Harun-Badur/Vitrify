import * as Sentry from '@sentry/react-native';
import type { LogContext } from './logger.ts';

let sentryReady = false;

const getSentryDsn = (): string | null => {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn) {
    return null;
  }
  return dsn;
};

export const isSentryEnabled = (): boolean => getSentryDsn() !== null;

export const initSentry = (): void => {
  if (sentryReady) {
    return;
  }

  const dsn = getSentryDsn();
  if (dsn === null) {
    return;
  }

  Sentry.init({
    dsn,
    enabled: true,
    tracesSampleRate: 0,
  });
  sentryReady = true;
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

initSentry();
