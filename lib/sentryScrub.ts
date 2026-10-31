import { perfRouteLabel } from './perfLog';

/**
 * Pure helpers that keep personal data out of Sentry events, breadcrumbs and transactions.
 * No Sentry import: the SDK hooks in lib/sentry.ts only call these.
 */
type Bag = Record<string, unknown>;

const REDACTED = '[gizlendi]';
const MAX_DEPTH = 4;

// Same spirit as lib/logger: identity and secrets, plus product / wardrobe / photo data.
const SENSITIVE_KEY_PATTERN =
  /(user_?id|e?mail|phone|token|password|secret|authorization|bearer|jwt|session|api_?key|base64|data_uri|raw_?search|search_?text|search_?query|^query$|username|product|wardrobe|dolap|closet|outfit|photo|image|uri|brand|title|^name$)/i;

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.?[A-Za-z0-9_-]*/g;
const BEARER_PATTERN = /Bearer\s+\S+/gi;
const SUPABASE_KEY_PATTERN = /sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g;
const ID_SEGMENT_PATTERN = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{3,})$/i;

export const scrubText = (text: string): string =>
  text
    .replace(BEARER_PATTERN, 'Bearer [gizlendi]')
    .replace(JWT_PATTERN, REDACTED)
    .replace(SUPABASE_KEY_PATTERN, REDACTED)
    .replace(EMAIL_PATTERN, REDACTED);

/** Drops query string and fragment, and replaces uuid / numeric path segments. */
export const scrubUrl = (url: string): string => {
  const base = url.split(/[?#]/)[0] ?? '';
  const match = /^([a-z][a-z0-9+.-]*:\/\/[^/]*)(\/.*)?$/i.exec(base);
  if (!match) return scrubText(base);
  const path = (match[2] ?? '').split('/').map(segment => (ID_SEGMENT_PATTERN.test(segment) ? ':id' : segment)).join('/');
  return scrubText(`${match[1]}${path}`);
};

// A URL-looking token inside free text (span descriptions, transaction names).
const scrubUrlsInText = (text: string): string =>
  scrubText(text).replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, scrubUrl);

const redactValue = (value: unknown, depth: number): unknown => {
  if (typeof value === 'string') return scrubUrlsInText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.slice(0, 10).map(item => redactValue(item, depth + 1));
  const output: Bag = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactValue(entry, depth + 1);
  }
  return output;
};

const redactBag = (bag: unknown): Bag | undefined =>
  bag && typeof bag === 'object' ? (redactValue(bag, 0) as Bag) : undefined;

type CrumbLike = { category?: string; message?: string; data?: Bag; [key: string]: unknown };

/** Returns the cleaned breadcrumb, or null to drop it. */
export const scrubBreadcrumb = <T extends CrumbLike>(crumb: T): T | null => {
  const category = crumb.category ?? '';
  if (category === 'console') return null;
  if (category === 'fetch' || category === 'xhr' || category === 'http') {
    const data = crumb.data ?? {};
    const kept: Bag = {};
    if (typeof data.url === 'string') kept.url = scrubUrl(data.url);
    if (typeof data.method === 'string') kept.method = data.method;
    if (typeof data.status_code === 'number') kept.status_code = data.status_code;
    return { ...crumb, message: undefined, data: kept };
  }
  if (category === 'navigation') {
    const data = crumb.data ?? {};
    const label = (value: unknown): string => perfRouteLabel(typeof value === 'string' ? value.split(/[?#]/)[0] : '');
    return { ...crumb, message: undefined, data: { from: label(data.from), to: label(data.to) } };
  }
  if (category.startsWith('ui.')) return { ...crumb, message: undefined, data: undefined };
  return {
    ...crumb,
    message: typeof crumb.message === 'string' ? scrubUrlsInText(crumb.message) : crumb.message,
    data: redactBag(crumb.data),
  };
};

type EventLike = {
  user?: Bag;
  request?: Bag;
  message?: string;
  extra?: Bag;
  contexts?: Bag;
  breadcrumbs?: CrumbLike[];
  exception?: { values?: { value?: string; [key: string]: unknown }[] };
  [key: string]: unknown;
};

const scrubBreadcrumbs = (crumbs: CrumbLike[] | undefined): CrumbLike[] | undefined =>
  crumbs?.map(crumb => scrubBreadcrumb(crumb)).filter((crumb): crumb is CrumbLike => crumb !== null);

export const scrubEvent = <T extends EventLike>(event: T): T => {
  const next: EventLike = { ...event };
  const userId = event.user?.id;
  next.user = typeof userId === 'string' ? { id: userId } : undefined;
  if (event.request) {
    const url = event.request.url;
    next.request = typeof url === 'string' ? { url: scrubUrl(url) } : undefined;
  }
  if (typeof event.message === 'string') next.message = scrubUrlsInText(event.message);
  if (event.extra) next.extra = redactBag(event.extra);
  if (event.exception?.values) {
    next.exception = {
      ...event.exception,
      values: event.exception.values.map(entry => ({
        ...entry,
        value: typeof entry.value === 'string' ? scrubUrlsInText(entry.value) : entry.value,
      })),
    };
  }
  if (event.breadcrumbs) next.breadcrumbs = scrubBreadcrumbs(event.breadcrumbs);
  return next as T;
};

type SpanLike = { description?: string; data?: Bag; [key: string]: unknown };

export const scrubTransaction = <T extends EventLike & { transaction?: string; spans?: SpanLike[] }>(event: T): T => {
  const next = scrubEvent(event) as T & { transaction?: string; spans?: SpanLike[] };
  if (typeof event.transaction === 'string') next.transaction = scrubUrlsInText(event.transaction);
  if (event.spans) {
    next.spans = event.spans.map(span => {
      const data: Bag = {};
      for (const [key, value] of Object.entries(span.data ?? {})) {
        if (/query|fragment/i.test(key)) continue;
        data[key] = typeof value === 'string' && /url/i.test(key) ? scrubUrl(value) : value;
      }
      return {
        ...span,
        description: typeof span.description === 'string' ? scrubUrlsInText(span.description) : span.description,
        data,
      };
    });
  }
  return next;
};

export type RamClass = 'dusuk' | 'orta' | 'yuksek' | 'bilinmiyor';

const GB = 1024 ** 3;

export const ramClass = (totalBytes: number | null | undefined): RamClass => {
  if (typeof totalBytes !== 'number' || !Number.isFinite(totalBytes) || totalBytes <= 0) return 'bilinmiyor';
  if (totalBytes < 3 * GB) return 'dusuk';
  if (totalBytes < 6 * GB) return 'orta';
  return 'yuksek';
};

export interface DeviceInfo {
  model: string | null;
  osVersion: string | null;
  totalMemory: number | null;
  appVersion: string | null;
  versionCode: number | null;
}

export const buildDeviceTags = (info: DeviceInfo): Record<string, string> => ({
  device_model: info.model ?? 'bilinmiyor',
  android_version: info.osVersion ?? 'bilinmiyor',
  ram_class: ramClass(info.totalMemory),
  app_version: info.appVersion ?? 'bilinmiyor',
  version_code: info.versionCode === null ? 'bilinmiyor' : String(info.versionCode),
});
