import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseClient } from '../lib/supabase';
import { perfTraceEntries, resetPerfTrace, setPerfTraceOverrideForTests } from '../lib/perfTrace';
import { fetchRecommendationCatalog } from '../services/productService';
import { fetchPassedProductIds } from '../services/likeService';
import { useAppStore } from '../store/useAppStore';

jest.mock('../lib/supabase', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('expo/virtual/env', () => ({ env: process.env }), { virtual: true });
jest.mock('../services/likeService', () => ({
  fetchLikedProducts: jest.fn().mockResolvedValue([]),
  fetchPassedProductIds: jest.fn().mockResolvedValue([]),
}));

const entries = (label: string) => perfTraceEntries().filter(entry => entry.label === label);

beforeEach(() => {
  resetPerfTrace();
  setPerfTraceOverrideForTests(true);
});
afterEach(() => {
  setPerfTraceOverrideForTests(null);
  jest.restoreAllMocks();
});

describe('catalog load measurement', () => {
  const catalogClient = (count: number) => {
    const rows = Array.from({ length: count }, (_, index) => ({
      id: `p-${index}`, provider: 'trendyol', external_id: String(index), title: `Siyah Gömlek ${index}`,
      brand: 'Trendyol', price: 100, currency: 'TRY', image_url: 'https://example.com/p.jpg',
      product_url: `https://example.com/p-${index}`, category: 'upper_body', affiliate_url: null,
      created_at: '2026-01-01T00:00:00.000Z',
    }));
    const ranges: number[] = [];
    const client = {
      from: () => {
        const query = {
          select: () => query, order: () => query, not: () => query,
          in: () => Promise.resolve({ data: [], error: null }),
          range: (start: number, end: number) => {
            ranges.push(start);
            return Promise.resolve({ data: rows.slice(start, end + 1), error: null });
          },
        };
        return query;
      },
    };
    return { client, ranges };
  };

  it('records the total load time once and the number of pages that were consumed', async () => {
    const { client } = catalogClient(81);
    jest.mocked(getSupabaseClient).mockReturnValue(client as never);
    await fetchRecommendationCatalog();
    expect(entries('catalog_load')).toHaveLength(1);
    // Page 1 has 81 rows (more remain); page 2 ends the scan. The speculative empty read is not a page.
    expect(entries('catalog_load_pages').map(entry => entry.ms)).toEqual([2]);
  });

  it('returns the same pool with the trace off and records nothing', async () => {
    const on = catalogClient(81);
    jest.mocked(getSupabaseClient).mockReturnValue(on.client as never);
    const traced = (await fetchRecommendationCatalog()).map(product => product.id);
    resetPerfTrace();
    setPerfTraceOverrideForTests(false);
    const off = catalogClient(81);
    jest.mocked(getSupabaseClient).mockReturnValue(off.client as never);
    expect((await fetchRecommendationCatalog()).map(product => product.id)).toEqual(traced);
    expect(off.ranges).toEqual(on.ranges);
    expect(perfTraceEntries()).toEqual([]);
  });
});

describe('session hydration measurement', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useAppStore.getState().resetSession();
    resetPerfTrace();
  });

  it('records one duration when the session sync succeeds', async () => {
    await useAppStore.getState().hydrateSession('owner');
    expect(useAppStore.getState().sessionSyncStatus).toBe('success');
    expect(entries('session_hydrate')).toHaveLength(1);
  });

  it('records one duration when the session sync fails, without changing the error state', async () => {
    jest.mocked(fetchPassedProductIds).mockRejectedValueOnce(new Error('offline'));
    await useAppStore.getState().hydrateSession('owner');
    expect(useAppStore.getState().sessionSyncStatus).toBe('error');
    expect(entries('session_hydrate')).toHaveLength(1);
  });

  it('records nothing while the trace is off', async () => {
    setPerfTraceOverrideForTests(false);
    await useAppStore.getState().hydrateSession('owner');
    expect(useAppStore.getState().sessionSyncStatus).toBe('success');
    expect(perfTraceEntries()).toEqual([]);
  });
});
