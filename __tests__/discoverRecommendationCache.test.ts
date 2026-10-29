import { DiscoverRecommendationCache } from '../lib/discoverRecommendationCache';
import { anchorContext, decodeSnapshot, encodeSnapshot, type RecommendationFeedPacket } from '../src/recommendationCache/feedPacket';
import { serializeFinal } from '../src/recommendationCache/codec';
import { getDiscoverRecommendations } from '../src/intelligence/recommendations/getDiscoverRecommendations';
import { prepareRecommendationFeedPacket, processRecommendationJob, SupabaseRecommendationRecordStore } from '../scripts/lib/supabaseRecommendationCache';
import { RecommendationCacheWorker } from '../scripts/lib/recommendationCacheWorker';
import { createFinalCacheKey } from '../src/recommendationCache/fingerprint';
import type { Product } from '../types/product';

const top: Product = { id: 'top', title: 'Top', category: 'upper_body', outfitRole: 'top', price: 100,
  // Faz 4 S3b: complements need a known gender.
  brand: 'Brand', imageUrl: 'top.jpg', garmentDescription: 'Top', fit: undefined, gender: 'women' };
const bottom: Product = { ...top, id: 'bottom', title: 'Bottom', category: 'lower_body', outfitRole: 'bottom' };
const bag: Product = { ...top, id: 'bag', title: 'Bag', category: 'bags', outfitRole: 'bag' };
const catalog = [top, bottom, bag];
const wardrobe = [{ id: 'w', category: 'top', color: undefined, style_tags: ['casual'] }];
const store = () => {
  const rows = new Map<string, string>();
  return { read: async (key: { fingerprint: string }) => rows.get(key.fingerprint),
    write: async (key: { fingerprint: string }, payload: string) => { rows.set(key.fingerprint, payload); } };
};

describe('ready feed packet context and memory', () => {
  it('losslessly transports undefined metadata, nulls and exposure without changing snapshot order', () => {
    const snapshot = { catalog, wardrobe, null: null, exposure: [['bag', 2]], missing: undefined };
    expect(decodeSnapshot(encodeSnapshot(snapshot))).toStrictEqual(snapshot);
    expect(() => decodeSnapshot('{"wrong":true}')).toThrow();
  });
  it('attaches existing engine results in exact feed order; only activation credits exposure and undo pins results', async () => {
    const cache = new DiscoverRecommendationCache(catalog, [], 'u');
    const anchors = [bag, top, bottom];
    const request = cache.request(anchors, 1);
    const packet = await prepareRecommendationFeedPacket(new RecommendationCacheWorker(store()), request);
    expect(packet.entries.map(entry => entry.anchorProductId)).toEqual(anchors.map(anchor => anchor.id));
    expect(cache.accept(packet, anchors)).toBe(true); expect(cache.exposure.size).toBe(0);
    const first = cache.lookup(bag);
    expect(first).toStrictEqual(getDiscoverRecommendations(anchorContext(catalog, bag, [], new Map()).input));
    cache.activate(bag); const counts = new Map(cache.exposure);
    cache.activate(bag); expect(cache.exposure).toEqual(counts);
    expect(cache.lookup(top)).toBeDefined(); cache.activate(top);
    expect(cache.lookup(bag)).toBe(first);
    expect(anchors).toEqual([bag, top, bottom]);
  });
  it('never shows incorrect exposure, wardrobe, catalog, owner/session or generation results', async () => {
    const cache = new DiscoverRecommendationCache(catalog, [], 'u');
    const request = cache.request(catalog, 1);
    const packet = await prepareRecommendationFeedPacket(new RecommendationCacheWorker(store()), request);
    expect(cache.accept({ ...packet, generation: 2 }, catalog)).toBe(false);
    expect(new DiscoverRecommendationCache(catalog, [], 'other').accept(packet, catalog)).toBe(false);
    expect(new DiscoverRecommendationCache(catalog, wardrobe, 'u').accept(packet, catalog)).toBe(false);
    expect(new DiscoverRecommendationCache([{ ...top, price: 500 }, bottom, bag], [], 'u').accept(packet, catalog)).toBe(false);
    cache.accept(packet, catalog);
    expect(cache.lookup(bottom)).toBeUndefined(); // top not activated yet
    cache.exposure.set('bag', 100); expect(cache.lookup(top)).toBeUndefined();
    expect(cache.lookup({ ...top, price: 400 })).toBeUndefined();
  });
  it('distinguishes a cached empty result from miss and rejects wrong entry context even with a matching header', () => {
    const cache = new DiscoverRecommendationCache(catalog, [], null);
    const request = cache.request([top], 1);
    expect(cache.lookup(top)).toBeUndefined();
    const wrong = anchorContext(catalog, top, wardrobe, new Map());
    const packet: RecommendationFeedPacket = { ...request, entries: [{ anchorProductId: top.id, exposure: [], serialized: serializeFinal([], wrong) }] };
    expect(cache.accept(packet, [top])).toBe(false);
    packet.entries[0].serialized = serializeFinal([], anchorContext(catalog, top, [], new Map()));
    expect(cache.accept(packet, [top])).toBe(true); expect(cache.lookup(top)).toEqual([]);
    cache.activate(top); expect(cache.shown.has(top.id)).toBe(true); expect(cache.exposure.size).toBe(0);
  });
  it('publishes owner-bound codec records through the v2 claim RPC and denies writes without a matching claim', async () => {
    const rpc = jest.fn().mockResolvedValue({ error: null });
    const client = { rpc };
    const claim = { id: 'job', owner_id: 'owner', claim_token: 'token', claim_revision: 1, request_payload: '' };
    const context = anchorContext(catalog, top, wardrobe, new Map());
    const key = createFinalCacheKey(context), payload = serializeFinal(getDiscoverRecommendations(context.input), context);
    await new SupabaseRecommendationRecordStore(client as never, 'owner', claim).write(key, payload);
    expect(rpc.mock.calls[0][0]).toBe('publish_discover_recommendation_cache');
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_job: 'job', p_token: 'token', p_revision: 1, p_record: { kind: 'final', payload } });
    expect(rpc.mock.calls[0][1].p_record.cache_key_hash).toMatch(/^[a-f0-9]{64}$/);
    await expect(new SupabaseRecommendationRecordStore(client as never).write(key, payload)).rejects.toThrow('owner-bound v2 job claim');
    await expect(new SupabaseRecommendationRecordStore(client as never, 'other', claim).write(key, payload)).rejects.toThrow('owner-bound v2 job claim');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('rebinds a changed already-shown anchor on a new batch without counting exposure twice', async () => {
    const cache = new DiscoverRecommendationCache(catalog, [], 'u');
    const worker = new RecommendationCacheWorker(store());
    const first = cache.request(catalog, 1);
    cache.accept(await prepareRecommendationFeedPacket(worker, first), catalog); cache.activate(top);
    const counts = new Map(cache.exposure), changed = { ...top, currentPrice: 200 };
    const next = cache.request([changed], 2);
    expect(next.reusableAnchorIds).toEqual([]); expect(next.shownAnchorIds).toContain(top.id);
    const packet = await prepareRecommendationFeedPacket(worker, next);
    expect(packet.entries).toHaveLength(1);
    cache.accept(packet, [changed]); cache.activate(changed);
    expect(cache.exposure).toEqual(counts);
    const ready = cache.lookup(changed);
    expect(ready).toStrictEqual(getDiscoverRecommendations(anchorContext(catalog, changed, [], counts).input));
    cache.exposure.set('extra', 1); expect(cache.lookup(changed)).toBe(ready);
  });
  it('processes a claimed private job with the existing engine and publishes a lossless, canonical packet', async () => {
    const cache = new DiscoverRecommendationCache(catalog, wardrobe, 'owner');
    const request = cache.request([top], 1);
    const records: Record<string, unknown>[] = [];
    const finishes: Record<string, unknown>[] = [];
    const job = { id: 'job', owner_id: 'owner', claim_token: 'token', claim_revision: 1, request_payload: encodeSnapshot(request) };
    const client = {
      rpc: jest.fn(async (name: string, args?: Record<string, unknown>) => {
        if (name === 'claim_discover_recommendation_job_v2') return { data: job, error: null };
        if (name === 'publish_discover_recommendation_cache') { records.push(args!.p_record as Record<string, unknown>); return { error: null }; }
        if (name === 'finish_discover_recommendation_job') { finishes.push(args!); return { error: null }; }
        throw new Error(`unexpected rpc ${name}`);
      }),
      from: () => {
        const query = {
          select: () => query, eq: () => query, gt: () => query,
          maybeSingle: async () => ({ data: null, error: null }),
        };
        return query;
      },
    };
    expect(await processRecommendationJob(client as never)).toBe(true);
    expect(finishes).toHaveLength(1);
    expect(finishes[0]).toMatchObject({ p_job: 'job', p_token: 'token', p_revision: 1, p_error: null });
    expect(records.map(record => record.kind)).toEqual(['ranking', 'final']);
    const packet = JSON.parse(finishes[0].p_packet as string) as RecommendationFeedPacket;
    expect(cache.accept(packet, [top])).toBe(true);
    expect(cache.lookup(top)).toStrictEqual(getDiscoverRecommendations(anchorContext(catalog, top, wardrobe, new Map()).input));
  });
});
