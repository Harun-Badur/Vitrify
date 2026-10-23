import AsyncStorage from '@react-native-async-storage/async-storage';
import { ANALYTICS_QUEUE_KEY, flushAnalytics, quiesceAnalyticsForDeletion, resetAnalyticsForTests, track } from '../lib/analytics';
import { ACCOUNT_WRITE_FENCE_KEY, isAccountWriteFenced, resetAccountWriteFenceMemoryForTests } from '../lib/accountWriteFence';

const mockRpc = jest.fn();
const mockSession = jest.fn();
jest.mock('../lib/supabase', () => ({ getSupabaseClient: () => ({ rpc: mockRpc, auth: { getSession: mockSession } }) }));
const settle = () => new Promise(resolve => setTimeout(resolve, 40));
const old = { event_id: 'old', user_id: 'owner', session_id: 's', event_type: 'like', product_id: 'p', payload: {}, created_at: '2026-10-01' };
beforeEach(async () => {
  await resetAnalyticsForTests(); await AsyncStorage.clear(); resetAccountWriteFenceMemoryForTests();
  mockRpc.mockReset().mockResolvedValue({ error: null });
  mockSession.mockReset().mockResolvedValue({ data: { session: { user: { id: 'owner' } } }, error: null });
});
it('drains actual in-flight send before completion and never sends a late event/retry', async () => {
  await AsyncStorage.setItem(ANALYTICS_QUEUE_KEY, JSON.stringify([old, { ...old, event_id: 'other', user_id: 'other' }]));
  let resolve!: (result: { error: unknown }) => void;
  mockRpc.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const flushing = flushAnalytics(); await settle();
  let completed = false;
  const deletion = quiesceAnalyticsForDeletion('owner').then(() => { completed = true; });
  await settle(); expect(completed).toBe(false);
  track('like', 'late'); await settle();
  resolve({ error: { message: 'failed in-flight' } });
  await deletion;
  expect(JSON.parse((await AsyncStorage.getItem(ANALYTICS_QUEUE_KEY))!)).toEqual([{ ...old, event_id: 'other', user_id: 'other' }]);
  await flushing; await flushAnalytics(); expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(await AsyncStorage.getItem(ACCOUNT_WRITE_FENCE_KEY)).toContain('owner');
});
it('offline fence survives process memory restart and rejects a delayed old-session enqueue', async () => {
  let release!: (value: unknown) => void;
  mockSession.mockImplementationOnce(() => new Promise(done => { release = done; }));
  track('like', 'old-session'); await settle();
  await quiesceAnalyticsForDeletion('owner');
  release({ data: { session: { user: { id: 'owner' } } }, error: null }); await settle();
  expect(await AsyncStorage.getItem(ANALYTICS_QUEUE_KEY)).toBe('[]');
  resetAccountWriteFenceMemoryForTests();
  expect(await isAccountWriteFenced('owner')).toBe(true);
  expect(await isAccountWriteFenced('other')).toBe(false);
  await flushAnalytics(); expect(mockRpc).not.toHaveBeenCalled();
});
it('unfinished RPC blocks deletion completion; retry waits until it really settles', async () => {
  await AsyncStorage.setItem(ANALYTICS_QUEUE_KEY, JSON.stringify([old]));
  let resolve!: (result: { error: null }) => void;
  mockRpc.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const flushing = flushAnalytics(); await settle();
  await expect(quiesceAnalyticsForDeletion('owner', 5)).rejects.toThrow('pending');
  expect(await isAccountWriteFenced('owner')).toBe(true);
  resolve({ error: null }); await flushing;
  await quiesceAnalyticsForDeletion('owner');
  expect(await AsyncStorage.getItem(ANALYTICS_QUEUE_KEY)).toBe('[]');
});
