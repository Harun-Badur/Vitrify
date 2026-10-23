import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { captureOwnerPublication, setDeviceSessionOwner, resetDeviceWorkForTests, ownerWorkEvidence, trackOwnerWork, registerOwnerResource } from '../lib/accountDeviceWork';
import { fenceAccountWrites, resetAccountWriteFenceMemoryForTests, withAccountWriteGuard } from '../lib/accountWriteFence';
import { useOwnedState } from '../hooks/useOwnedState';
import { DiscoverRecommendationCache } from '../lib/discoverRecommendationCache';
import { loadDiscoverRecommendationPacket } from '../services/discoverRecommendationCacheService';
import { RecommendationMemoryCache } from '../src/recommendationCache/memoryCache';
import { RankingPreparationCache } from '../src/intelligence/recommendations/rankingPreparationCache';
const renderer = require('react-test-renderer');
const { act } = renderer;
let mockResolveQuery: (value: { data: never[]; error: null }) => void;
let mockQuery: Promise<{ data: never[]; error: null }>;
jest.mock('../lib/supabase', () => ({ getSupabaseClient: () => ({ from: () => {
  const query: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'gt', 'in', 'abortSignal']) query[name] = () => query;
  query.limit = () => mockQuery; return query;
} }) }));
jest.mock('../services/productRepository', () => ({ getProductRepository: () => ({ register: (items: unknown[]) => items }) }));
jest.mock('expo-file-system/legacy', () => ({ cacheDirectory: 'file:///cache/', documentDirectory: 'file:///docs/' }));
beforeEach(async () => { await AsyncStorage.clear(); resetDeviceWorkForTests(); resetAccountWriteFenceMemoryForTests();
  mockQuery = new Promise(resolve => { mockResolveQuery = resolve; }); });

it('A→B→A cannot revive a captured A publication; B admission remains independent', async () => {
  setDeviceSessionOwner('A'); const oldA = captureOwnerPublication('A'); setDeviceSessionOwner('B'); expect(oldA()).toBe(false);
  const b = captureOwnerPublication('B'); expect(b()).toBe(true); setDeviceSessionOwner('A'); expect(oldA()).toBe(false);
  await expect(withAccountWriteGuard('B', async () => {})).rejects.toThrow('session');
});
it('fence cannot claim drain while an actual owner promise is unresolved', async () => {
  let release!: () => void; const work = trackOwnerWork('A', new Promise<void>(resolve => { release = resolve; }));
  let completed = false; const fence = fenceAccountWrites('A').then(() => { completed = true; });
  await Promise.resolve(); expect(completed).toBe(false); expect(ownerWorkEvidence('A').pending).toBe(1);
  release(); await work; await fence; expect(ownerWorkEvidence('A')).toEqual({ fenced: true, pending: 0, nonempty: 0 });
});
it('a disposer that cannot prove empty leaves fence BLOCKED', async () => {
  registerOwnerResource('A', { stop: () => {}, empty: () => false });
  await expect(fenceAccountWrites('A')).rejects.toThrow('unverified');
  await expect(withAccountWriteGuard('A', async () => {})).rejects.toThrow('deletion');
});
it('React owner cell clears on commit; stale setter and queued functional update cannot republish A', async () => {
  let value: string | null = null, setter!: React.Dispatch<React.SetStateAction<string | null>>;
  function Probe({ owner }: { owner: string }) { const state = useOwnedState<string | null>(owner, null); value = state[0]; setter = state[1]; return null; }
  setDeviceSessionOwner('A'); let root: { update(node: React.ReactElement): void; unmount(): void };
  await act(async () => { root = renderer.create(React.createElement(Probe, { owner: 'A' })); });
  await act(async () => { setter('A-secret'); }); expect(value).toBe('A-secret'); const old = setter;
  let fence!: Promise<void>;
  await act(async () => { fence = fenceAccountWrites('A'); old(previous => previous + '-late'); await Promise.resolve(); });
  await fence; expect(value).toBeNull(); expect(ownerWorkEvidence('A')).toEqual({ fenced: true, pending: 0, nonempty: 0 });
  await act(async () => { setDeviceSessionOwner('B'); root!.update(React.createElement(Probe, { owner: 'B' })); });
  await act(async () => { setter('B-secret'); });
  await act(async () => { old('A-late'); }); expect(value).not.toBe('A-late');
  await act(async () => { root!.unmount(); });
});
it('fencing A closes cache/controllers and releases wardrobe references without disposing B', async () => {
  const a = new DiscoverRecommendationCache([], [{ id: 'private-A' }] as never, 'A');
  const b = new DiscoverRecommendationCache([], [{ id: 'private-B' }] as never, 'B');
  const stop = jest.fn(); a.onDispose(stop);
  await fenceAccountWrites('A'); expect(a.disposed).toBe(true); expect(a.wardrobe).toEqual([]); expect(stop).toHaveBeenCalledTimes(1);
  expect(b.disposed).toBe(false); expect(b.wardrobe).toHaveLength(1); expect(a.accept({} as never, [])).toBe(false);
  expect(() => a.request([], 1)).toThrow('disposed');
});
it('disposed memory/ranking caches cannot refill from late preparation', async () => {
  const memory = new RecommendationMemoryCache(); const key = { fingerprint: 'owner-A-private' } as never;
  memory.setRanking(key, {} as never); memory.dispose(); memory.setRanking(key, {} as never); expect(memory.getRanking(key).status).toBe('miss');
  const rankings = new RankingPreparationCache<object, string>(); const product = {};
  let resolve!: (value: string) => void; const pending = rankings.get(product, signal => {
    signal.addEventListener('abort', () => {}, { once: true }); return new Promise<string>(done => { resolve = done; });
  }); rankings.dispose(); resolve('late-A'); await pending;
  await expect(rankings.get(product, async () => 'new-A')).rejects.toThrow('disposed');
});
it('abort of real discovery query is not drain; late query completion never publishes a packet', async () => {
  const cache = new DiscoverRecommendationCache([], [], 'A'), publish = jest.fn(), signal = new AbortController();
  const request = cache.request([{}] as never, 1); const work = loadDiscoverRecommendationPacket(request, 'A', signal.signal, publish);
  // Wait until the actual DB query promise has been registered.
  for (let i = 0; i < 20 && ownerWorkEvidence('A').pending < 2; i++) await Promise.resolve();
  expect(ownerWorkEvidence('A').pending).toBeGreaterThanOrEqual(2);
  let drained = false; const fence = fenceAccountWrites('A').then(() => { drained = true; });
  await Promise.resolve(); expect(drained).toBe(false); mockResolveQuery({ data: [], error: null });
  await work; await fence; expect(publish).not.toHaveBeenCalled(); expect(cache.disposed).toBe(true);
});
