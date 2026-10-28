// Edge stand-in for @sentry/react-native, which lib/sentry.ts imports for the app.
// lib/logger.ts reaches it only when not in dev; the Edge runtime reports through its own logs.
export const init = (_options: unknown): void => {};
export const captureException = (_error: unknown, _context?: unknown): void => {};
