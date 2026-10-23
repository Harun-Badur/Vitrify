import type { AnalyticsEventType, AnalyticsPayload, AnalyticsQueueItem } from '../types/analytics';

const RAW_SEARCH_KEY = /^(query|text|q|raw_query|raw_search|search_query|search_text)$/i;

/** Persistence boundary only; temporary search/request and session intent stay intact. */
export function analyticsPayloadForPersistence(type: AnalyticsEventType, payload: AnalyticsPayload): AnalyticsPayload {
  return Object.fromEntries(Object.entries(payload).filter(([key, value]) =>
    !RAW_SEARCH_KEY.test(key) && (type !== 'search' || typeof value !== 'string')));
}

/** Legacy records are held for disposition, not deleted or re-uploaded. */
export function hasUnapprovedRawSearch(item: AnalyticsQueueItem): boolean {
  return Object.keys(item.payload).some(key => RAW_SEARCH_KEY.test(key)) ||
    (item.event_type === 'search' && Object.values(item.payload).some(value => typeof value === 'string'));
}
