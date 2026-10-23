export const VTON_HISTORY_CAP = 20;
export const VTON_HISTORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const VTON_HISTORY_KEY_PREFIX = 'kabin.vton.history.v1';

export interface TryOnHistoryEntry {
  productId: string;
  title: string;
  imageUri: string;
  ts: number;
  productUrl?: string;
  affiliateUrl?: string;
}

export interface HistoryMergeResult {
  next: TryOnHistoryEntry[];
  evicted: TryOnHistoryEntry[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isHistoryEntry = (value: unknown): value is TryOnHistoryEntry => {
  if (!isRecord(value)) {
    return false;
  }
  const productUrl = value.productUrl;
  const affiliateUrl = value.affiliateUrl;
  const productUrlOk =
    productUrl === undefined || typeof productUrl === 'string';
  const affiliateUrlOk =
    affiliateUrl === undefined || typeof affiliateUrl === 'string';
  return (
    typeof value.productId === 'string' &&
    typeof value.title === 'string' &&
    typeof value.imageUri === 'string' &&
    typeof value.ts === 'number' &&
    Number.isFinite(value.ts) &&
    productUrlOk &&
    affiliateUrlOk
  );
};

export const vtonHistoryStorageKey = (userId: string): string =>
  `${VTON_HISTORY_KEY_PREFIX}.${userId}`;

export const parseTryOnHistory = (raw: string | null): TryOnHistoryEntry[] => {
  if (raw === null || raw.trim().length === 0) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isHistoryEntry);
  } catch {
    return [];
  }
};

export const mergeTryOnHistory = (
  existing: TryOnHistoryEntry[],
  incoming: TryOnHistoryEntry,
  now: number = Date.now(),
): HistoryMergeResult => {
  return pruneTryOnHistory([incoming, ...existing], now);
};

/** Recorded device clock; future timestamps are not guessed to be expired. */
export const pruneTryOnHistory = (existing: TryOnHistoryEntry[], now: number = Date.now()): HistoryMergeResult => {
  const next = existing
    .filter(entry => now - entry.ts < VTON_HISTORY_MAX_AGE_MS)
    .slice()
    .sort((left, right) => right.ts - left.ts)
    .slice(0, VTON_HISTORY_CAP);
  const retained = new Set(
    next.map((entry) => `${entry.ts}:${entry.imageUri}`),
  );
  const evicted = existing.filter(
    (entry) => !retained.has(`${entry.ts}:${entry.imageUri}`),
  );
  return { next, evicted };
};
