import AsyncStorage from '@react-native-async-storage/async-storage';
import { analyticsPayloadForPersistence, hasUnapprovedRawSearch } from '../lib/analyticsPrivacy';
import { capAnalyticsQueue, flushAnalytics, resetAnalyticsForTests, track, ANALYTICS_QUEUE_KEY, ANALYTICS_QUEUE_CAP } from '../lib/analytics';

const mockRpc = jest.fn().mockResolvedValue({ error: null });
jest.mock('../lib/supabase', () => ({ getSupabaseClient: () => ({ rpc: mockRpc,
  auth: { getSession: async () => ({ data: { session: { user: { id: 'u' } } } }) } }) }));

beforeEach(async () => { await resetAnalyticsForTests(); await AsyncStorage.clear(); mockRpc.mockClear(); });

it('never cap-evicts historical raw search while bounding upload-eligible events', () => {
  const legacy = { event_id: 'old', user_id: 'u', session_id: 's', event_type: 'search' as const,
    product_id: null, payload: { query: 'held' }, created_at: '2026-01-01' };
  const safe = Array.from({ length: ANALYTICS_QUEUE_CAP + 1 }, (_, n) => ({ ...legacy,
    event_id: String(n), event_type: 'like' as const, payload: {} }));
  const result = capAnalyticsQueue([legacy, ...safe]);
  expect(result).toContain(legacy);
  expect(result.filter(item => item !== legacy)).toHaveLength(ANALYTICS_QUEUE_CAP);
});

it('new searches never persist or ingest raw text, without changing the supplied query', async () => {
  const payload = { query: 'private words', arbitrary: 'private alias', length: 13, category: 'top' };
  expect(analyticsPayloadForPersistence('search', payload)).toEqual({ length: 13 });
  expect(payload.query).toBe('private words');
  track('search', null, payload);
  await new Promise(resolve => setTimeout(resolve, 40));
  expect(await AsyncStorage.getItem(ANALYTICS_QUEUE_KEY)).not.toContain('private');
  await flushAnalytics();
  expect(mockRpc.mock.calls[0][1].p_batch[0].payload).toEqual({ length: 13 });
});

it('holds legacy raw records without uploading/deleting them or blocking other events', async () => {
  const legacy = { event_id: 'old', user_id: 'u', session_id: 's', event_type: 'search',
    product_id: null, payload: { query: 'legacy words' }, created_at: '2026-01-01' };
  await AsyncStorage.setItem(ANALYTICS_QUEUE_KEY, JSON.stringify([legacy]));
  track('like', 'p', { source: 'feed' });
  await new Promise(resolve => setTimeout(resolve, 40));
  await flushAnalytics();
  expect(mockRpc.mock.calls[0][1].p_batch.map((p: { event_type: string }) => p.event_type)).toEqual(['like']);
  expect(JSON.parse((await AsyncStorage.getItem(ANALYTICS_QUEUE_KEY))!)).toEqual([legacy]);
  expect(hasUnapprovedRawSearch(legacy as never)).toBe(true);
});
