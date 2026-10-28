export type LogContext = Record<string, unknown>;

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const REDACTED = '[gizlendi]';
const TRUNCATED_SUFFIX = '…[kısaltıldı]';

// Kullanıcı kimliği, e-posta, token ve base64 gövdeler loga hiç girmemeli;
// Play Store veri güvenliği beyanında "log'a yazılmaz" taahhüdü buna dayanıyor.
const SENSITIVE_KEY_PATTERN =
  /(user_?id|e?mail|phone|token|password|secret|authorization|bearer|jwt|session|api_?key|base64|image_data_uri|raw_?search|search_?text|search_?query|^query$)/i;

const MAX_STRING_LENGTH = 240;
const MAX_ARRAY_ITEMS = 10;
const MAX_DEPTH = 3;

const truncate = (value: string): string =>
  value.length <= MAX_STRING_LENGTH
    ? value
    : `${value.slice(0, MAX_STRING_LENGTH)}${TRUNCATED_SUFFIX}`;

const sanitizeError = (error: Error): LogContext => ({
  name: error.name,
  message: truncate(error.message),
  ...(__DEV__ && error.stack ? { stack: error.stack } : {}),
});

const sanitizeValue = (value: unknown, depth: number): unknown => {
  if (value instanceof Error) {
    return sanitizeError(value);
  }

  if (typeof value === 'string') {
    return truncate(value);
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (depth >= MAX_DEPTH) {
    return TRUNCATED_SUFFIX;
  }

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeValue(item, depth + 1));
    return value.length > MAX_ARRAY_ITEMS
      ? [...items, `+${value.length - MAX_ARRAY_ITEMS} kayıt`]
      : items;
  }

  if (typeof value === 'object') {
    const output: LogContext = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? REDACTED
        : sanitizeValue(entry, depth + 1);
    }
    return output;
  }

  return truncate(String(value));
};

export const sanitizeLogContext = (
  context: LogContext | undefined,
): LogContext | null => {
  if (!context) {
    return null;
  }

  const output: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? REDACTED
      : sanitizeValue(value, 0);
  }
  return output;
};

// debug/info yalnızca geliştirmede; warn/error üretimde de görünür ama
// yalnızca ayıklanmış (PII'siz, kısaltılmış) bağlamla.
const isVerbose = (level: LogLevel): boolean =>
  __DEV__ || level === 'warn' || level === 'error';

const emit = (
  level: LogLevel,
  message: string,
  context?: LogContext,
): void => {
  if (!isVerbose(level)) {
    return;
  }

  const payload = sanitizeLogContext(context);

  if (level === 'error') {
    if (!__DEV__) {
      void import('./sentry.ts').then((sentry) => {
        sentry.captureLoggedError(message, payload);
      });
    }
    if (payload) {
      console.error(message, payload);
      return;
    }
    console.error(message);
    return;
  }

  if (level === 'warn') {
    if (payload) {
      console.warn(message, payload);
      return;
    }
    console.warn(message);
    return;
  }

  // Expo Go'da expo-notifications gibi beklenen atlamalar LogBox'ta kırmızı
  // görünmesin diye info/debug tek kanaldan console.info'a gider.
  if (payload) {
    console.info(message, payload);
    return;
  }
  console.info(message);
};

export const logger = {
  debug: (message: string, context?: LogContext): void =>
    emit('debug', message, context),
  info: (message: string, context?: LogContext): void =>
    emit('info', message, context),
  warn: (message: string, context?: LogContext): void =>
    emit('warn', message, context),
  error: (message: string, context?: LogContext): void =>
    emit('error', message, context),
};
