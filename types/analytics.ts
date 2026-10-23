export type AnalyticsEventType =
  | 'like'
  | 'pass'
  | 'impression'
  | 'try_on_start'
  | 'try_on_success'
  | 'try_on_failure'
  | 'store_click'
  | 'dolap_add'
  | 'dolap_remove'
  | 'search'
  | 'filter'
  | 'back'
  | 'share'
  | 'feed_fallback';

export type AnalyticsPayload = Record<
  string,
  string | number | boolean | null
>;

/** Captured at action start; pass to track only after the durable write commits. */
export interface AnalyticsActionContext {
  readonly actionId: string;
  readonly userId: string;
  readonly origin: 'favorite' | 'pass' | 'wardrobe';
  readonly occurredAt: string;
}

export interface TrackParams {
  type: AnalyticsEventType;
  productId?: string | null;
  payload?: AnalyticsPayload;
}

export interface AnalyticsQueueItem {
  event_id: string;
  user_id: string;
  session_id: string;
  event_type: AnalyticsEventType;
  product_id: string | null;
  payload: AnalyticsPayload;
  created_at: string;
}

export const LEGACY_RECOMMENDATION_ID = 'legacy-feed';

export const ANALYTICS_QUEUE_KEY = 'kabin.analytics.queue.v1';
export const ANALYTICS_QUEUE_CAP = 500;
export const ANALYTICS_FLUSH_SIZE = 20;
export const ANALYTICS_FLUSH_INTERVAL_MS = 10_000;
export const IMPRESSION_MIN_DWELL_MS = 1_000;
