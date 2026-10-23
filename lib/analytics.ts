import { invalidateStyleProfileSnapshot } from './recsConfig';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, type AppStateStatus } from 'react-native';
import { logger } from './logger';
import { getSupabaseClient } from './supabase';
import type {
  AnalyticsEventType,
  AnalyticsPayload,
  AnalyticsQueueItem,
  AnalyticsActionContext,
} from '../types/analytics';
import { createUuid } from './analyticsAction';
export { createUuid } from './analyticsAction';
import {
  ANALYTICS_FLUSH_INTERVAL_MS,
  ANALYTICS_FLUSH_SIZE,
  ANALYTICS_QUEUE_CAP,
  ANALYTICS_QUEUE_KEY,
  IMPRESSION_MIN_DWELL_MS,
  LEGACY_RECOMMENDATION_ID,
} from '../types/analytics';
import { getLastFeedMode, getLastRecommendationId } from './recsFeedState';
import { analyticsPayloadForPersistence, hasUnapprovedRawSearch } from './analyticsPrivacy';
import { accountWriteBlockedNow, fenceAccountWrites, isAccountWriteFenced } from './accountWriteFence';

export {
  ANALYTICS_FLUSH_INTERVAL_MS,
  ANALYTICS_FLUSH_SIZE,
  ANALYTICS_QUEUE_CAP,
  ANALYTICS_QUEUE_KEY,
  IMPRESSION_MIN_DWELL_MS,
  LEGACY_RECOMMENDATION_ID,
};

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

const SESSION_ID = createUuid();
const queuedOrSentIds = new Set<string>();
const impressionKeys = new Set<string>();

let queue: AnalyticsQueueItem[] = [];
let queueHydrated = false;
let hydratePromise: Promise<void> | null = null;
let flushing = false;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let appStateSubscription: { remove: () => void } | null = null;
let backoffMs = INITIAL_BACKOFF_MS;
let initialized = false;
let queueEpoch = 0;
let persistence: Promise<unknown> = Promise.resolve();
const inFlight = new Map<Promise<unknown>, string>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isEventType = (value: unknown): value is AnalyticsEventType =>
  value === 'like' ||
  value === 'pass' ||
  value === 'impression' ||
  value === 'try_on_start' ||
  value === 'try_on_success' ||
  value === 'try_on_failure' ||
  value === 'store_click' ||
  value === 'dolap_add' ||
  value === 'dolap_remove' ||
  value === 'search' ||
  value === 'filter' ||
  value === 'back' ||
  value === 'share' ||
  value === 'feed_fallback';

const isPayloadValue = (
  value: unknown,
): value is string | number | boolean | null =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value));

const isPayload = (value: unknown): value is AnalyticsPayload => {
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every(isPayloadValue);
};

const isQueueItem = (value: unknown): value is AnalyticsQueueItem => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.event_id === 'string' &&
    typeof value.user_id === 'string' &&
    typeof value.session_id === 'string' &&
    isEventType(value.event_type) &&
    (typeof value.product_id === 'string' || value.product_id === null) &&
    isPayload(value.payload) &&
    typeof value.created_at === 'string'
  );
};

export const getAnalyticsSessionId = (): string => SESSION_ID;

export const capAnalyticsQueue = (
  items: AnalyticsQueueItem[],
): AnalyticsQueueItem[] => {
  const eligible = items.filter(item => !hasUnapprovedRawSearch(item));
  if (eligible.length <= ANALYTICS_QUEUE_CAP) return items;
  const retained = new Set(eligible.slice(-ANALYTICS_QUEUE_CAP));
  // Historical raw text awaits disposition and must not be silently cap-evicted.
  return items.filter(item => hasUnapprovedRawSearch(item) || retained.has(item));
};

export const parseAnalyticsQueue = (raw: string | null): AnalyticsQueueItem[] => {
  if (raw === null || raw.trim().length === 0) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isQueueItem);
  } catch {
    return [];
  }
};

const persistQueue = async (): Promise<void> => {
  const snapshot = JSON.stringify(queue);
  const write = persistence.catch(() => undefined).then(() => AsyncStorage.setItem(ANALYTICS_QUEUE_KEY, snapshot));
  persistence = write;
  try {
    await write;
  } catch (error) {
    logger.debug('Analytics kuyruk yazılamadı', { error });
  }
};

const hydrateQueue = async (): Promise<void> => {
  if (queueHydrated) {
    return;
  }
  if (hydratePromise) {
    await hydratePromise;
    return;
  }

  hydratePromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(ANALYTICS_QUEUE_KEY);
      const stored = capAnalyticsQueue(parseAnalyticsQueue(raw));
      queue = stored;
      for (const item of stored) {
        queuedOrSentIds.add(item.event_id);
      }
    } catch (error) {
      logger.debug('Analytics kuyruk okunamadı', { error });
      queue = [];
    } finally {
      queueHydrated = true;
    }
  })();

  await hydratePromise;
};

const readUserId = async (): Promise<string | null> => {
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }
  try {
    const { data, error } = await client.auth.getSession();
    if (error) {
      logger.debug('Analytics oturum okunamadı', { detail: error.message });
      return null;
    }
    return data.session?.user.id ?? null;
  } catch (error) {
    logger.debug('Analytics oturum okunamadı', { error });
    return null;
  }
};

const sendBatch = async (batch: AnalyticsQueueItem[]): Promise<boolean> => {
  const client = getSupabaseClient();
  if (!client) {
    logger.debug('Analytics flush atlandı: supabase yok');
    return false;
  }

  const owner = batch[0]?.user_id;
  if (!owner || await isAccountWriteFenced(owner) || await readUserId() !== owner) return false;
  if (accountWriteBlockedNow(owner)) return false;
  const request = Promise.resolve(client.rpc('ingest_events', { p_batch: batch }));
  inFlight.set(request, owner);
  let error;
  try { ({ error } = await request); } finally { inFlight.delete(request); }
  if (error) {
    logger.debug('Analytics ingest başarısız', { detail: error.message });
    return false;
  }
  if (batch.some(item => item.event_type !== 'impression' && item.event_type !== 'search' && item.event_type !== 'filter')) invalidateStyleProfileSnapshot(owner);
  return true;
};

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const flushAnalytics = async (): Promise<void> => {
  if (flushing) {
    return;
  }
  flushing = true;

  try {
    await hydrateQueue();

    while (queue.length > 0) {
      const owner = await readUserId();
      if (!owner || await isAccountWriteFenced(owner)) break;
      const batch = queue.filter(item => item.user_id === owner && !hasUnapprovedRawSearch(item)).slice(0, ANALYTICS_FLUSH_SIZE);
      if (batch.length === 0) break;
      const batchIds = new Set(batch.map((item) => item.event_id));
      const ok = await sendBatch(batch);

      if (!ok) {
        await wait(backoffMs);
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        return;
      }

      backoffMs = INITIAL_BACKOFF_MS;
      queue = queue.filter((item) => !batchIds.has(item.event_id));
      await persistQueue();
    }
  } catch (error) {
    logger.debug('Analytics flush beklenmeyen hata', { error });
  } finally {
    flushing = false;
  }
};

const enqueueItem = async (item: AnalyticsQueueItem, epoch: number): Promise<void> => {
  await hydrateQueue();
  if (epoch !== queueEpoch || await isAccountWriteFenced(item.user_id)) return;
  if (epoch !== queueEpoch || accountWriteBlockedNow(item.user_id)) return;

  if (queuedOrSentIds.has(item.event_id)) {
    return;
  }
  queuedOrSentIds.add(item.event_id);

  queue = capAnalyticsQueue([...queue, item]);
  await persistQueue();

  if (queue.length >= ANALYTICS_FLUSH_SIZE) {
    void flushAnalytics();
  }
};

export const track = (
  type: AnalyticsEventType,
  productId?: string | null,
  payload: AnalyticsPayload = {},
  committedAction?: AnalyticsActionContext,
): void => {
  const epoch = queueEpoch;
  void (async () => {
    try {
      // A bound write belongs to the user who initiated it, even if a new user
      // is now logged in. Existing flush owner checks keep it out of that JWT.
      const userId = committedAction?.userId ?? await readUserId();
      if (!userId) {
        logger.debug('Analytics atlandı: oturum yok', { type });
        return;
      }

      const item: AnalyticsQueueItem = {
        event_id: createUuid(),
        user_id: userId,
        session_id: SESSION_ID,
        event_type: type,
        product_id: productId?.trim() ? productId.trim() : null,
        payload: analyticsPayloadForPersistence(type, committedAction ? {
          ...payload, action_id: committedAction.actionId, action_origin: committedAction.origin,
          outcome: 'committed', action_version: 1,
        } : payload),
        created_at: committedAction?.occurredAt ?? new Date().toISOString(),
      };
      await enqueueItem(item, epoch);
    } catch (error) {
      logger.debug('Analytics track başarısız', { error });
    }
  })();
};

export const trackFeedImpression = (
  productId: string,
  position: number,
  dwellMs: number,
): void => {
  if (dwellMs < IMPRESSION_MIN_DWELL_MS) {
    return;
  }

  const recommendationId =
    getLastRecommendationId() ?? LEGACY_RECOMMENDATION_ID;
  const feedMode = getLastFeedMode();
  const key = `${recommendationId}:${SESSION_ID}:${productId}:${feedMode}`;
  if (impressionKeys.has(key)) {
    return;
  }
  impressionKeys.add(key);

  track('impression', productId, {
    position,
    dwell_ms: Math.round(dwellMs),
    recommendation_id: recommendationId,
    feed_mode: feedMode,
  });
};

const handleAppState = (status: AppStateStatus): void => {
  if (status === 'background' || status === 'inactive') {
    void flushAnalytics();
  }
};

export const initAnalytics = (): void => {
  if (initialized) {
    return;
  }
  initialized = true;
  void hydrateQueue();

  if (flushTimer === null) {
    flushTimer = setInterval(() => {
      void flushAnalytics();
    }, ANALYTICS_FLUSH_INTERVAL_MS);
  }

  if (appStateSubscription === null) {
    appStateSubscription = AppState.addEventListener('change', handleAppState);
  }
};

export const clearAnalyticsQueue = async (): Promise<void> => {
  queueEpoch++;
  await hydratePromise;
  await persistence.catch(() => undefined);
  queue = [];
  queuedOrSentIds.clear();
  impressionKeys.clear();
  queueHydrated = true;
  try {
    await AsyncStorage.removeItem(ANALYTICS_QUEUE_KEY);
  } catch (error) {
    logger.debug('Analytics kuyruk silinemedi', { error });
  }
};

/** Explicit deletion path: persist owner tombstone, drain actual RPCs, then verify owner queue absence. */
export async function quiesceAnalyticsForDeletion(userId: string, timeoutMs = 10_000): Promise<void> {
  await fenceAccountWrites(userId);
  await hydrateQueue();
  const pending = [...inFlight].filter(([, owner]) => owner === userId).map(([request]) => request);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([Promise.allSettled(pending), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Analytics drain pending')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
  queue = queue.filter(item => item.user_id !== userId);
  await persistQueue();
  const stored = parseAnalyticsQueue(await AsyncStorage.getItem(ANALYTICS_QUEUE_KEY));
  if (stored.some(item => item.user_id === userId) || [...inFlight.values()].includes(userId)) throw new Error('Analytics cleanup unverified');
}

export const resetAnalyticsForTests = async (): Promise<void> => {
  queueEpoch++;
  await persistence.catch(() => undefined);
  if (flushTimer !== null) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  appStateSubscription?.remove();
  appStateSubscription = null;
  initialized = false;
  flushing = false;
  queueHydrated = false;
  hydratePromise = null;
  queue = [];
  backoffMs = INITIAL_BACKOFF_MS;
  queuedOrSentIds.clear();
  impressionKeys.clear();
  await AsyncStorage.removeItem(ANALYTICS_QUEUE_KEY);
};
