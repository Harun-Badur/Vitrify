import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseRecommendationRecordStore, processRecommendationJob, type RecommendationJobClaim } from '../scripts/lib/supabaseRecommendationCache';
import { createRankingCacheKey } from '../src/recommendationCache/fingerprint';
import { encodeSnapshot } from '../src/recommendationCache/feedPacket';
import { deletionStorageAdapter } from '../supabase/functions/_shared/accountDeletionStorage';
import { createDeletionReceipt, DELETION_LAYERS, runDeletionFoundation, type DeletionAdapter, type DeletionLayer } from '../supabase/functions/_shared/accountDeletionFoundation';

const request = { sessionId: 'session-A', generation: 1, contextFingerprint: 'private',
  candidatePool: [], anchors: [], wardrobeItems: [], exposure: [['private-exposure', 1]], shownAnchorIds: [] };
const job: RecommendationJobClaim = { id: 'job-A', owner_id: 'A', claim_token: 'token-1', claim_revision: 1, request_payload: encodeSnapshot(request) };
const key = createRankingCacheKey({ input: { catalogProducts: [], wardrobeItems: [], firstOnly: true } });
const client = (rpc: jest.Mock): SupabaseClient => ({ rpc, from: jest.fn(() => { throw new Error('Direct write path forbidden'); }) } as unknown as SupabaseClient);
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

describe('actual service-role worker RPC bindings (controlled transport, not PostgreSQL)', () => {
  it('public cache rejects even empty wardrobe; private context cannot escape into NULL-owner scope', async () => {
    const rpc = jest.fn();
    await expect(new SupabaseRecommendationRecordStore(client(rpc)).write(key, 'personal')).rejects.toThrow('public provenance');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('owner store without claim or with a foreign claim cannot publish', async () => {
    const rpc = jest.fn();
    await expect(new SupabaseRecommendationRecordStore(client(rpc), 'A').write(key, 'x')).rejects.toThrow('claim');
    await expect(new SupabaseRecommendationRecordStore(client(rpc), 'B', job).write(key, 'x')).rejects.toThrow('claim');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('cache publication carries claim revision/token; scope and owner are derived by the server', async () => {
    const rpc = jest.fn(async (_name: string, _args?: any) => ({ error: null }));
    await new SupabaseRecommendationRecordStore(client(rpc), 'A', job).write(key, 'private');
    expect(rpc).toHaveBeenCalledWith('publish_discover_recommendation_cache', expect.objectContaining({
      p_job: 'job-A', p_token: 'token-1', p_revision: 1, p_record: expect.objectContaining({ payload: 'private' }) }));
    expect(rpc.mock.calls[0][1].p_record).not.toHaveProperty('scope');
    expect(rpc.mock.calls[0][1].p_record).not.toHaveProperty('owner_id');
  });
  it('actual worker uses v2 payload snapshot and one atomic finish RPC, no direct payload/status writes', async () => {
    const rpc = jest.fn(async (name: string, _args?: any) => name === 'claim_discover_recommendation_job_v2' ? { data: job, error: null } : { error: null });
    expect(await processRecommendationJob(client(rpc))).toBe(true);
    expect(rpc.mock.calls.map(call => call[0])).toEqual(['claim_discover_recommendation_job_v2', 'finish_discover_recommendation_job']);
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_job: job.id, p_token: job.claim_token, p_revision: 1, p_error: null });
  });
  it('legacy/unowned claim is rejected before decoding or publication', async () => {
    const rpc = jest.fn(async () => ({ data: { id: 'legacy', owner_id: null }, error: null }));
    await expect(processRecommendationJob(client(rpc))).rejects.toThrow('v2 job claim');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('reclaimed worker token cannot publish; fresh B claim remains valid (reference RPC authority)', async () => {
    const tokens = new Map([['job-A', 'token-2'], ['job-B', 'token-B']]);
    const rpc = jest.fn(async (_name: string, args: { p_job: string; p_token: string }) => ({
      error: tokens.get(args.p_job) === args.p_token ? null : new Error('stale claim') }));
    await expect(new SupabaseRecommendationRecordStore(client(rpc), 'A', job).write(key, 'stale')).rejects.toThrow('stale');
    await expect(new SupabaseRecommendationRecordStore(client(rpc), 'B', { ...job, id: 'job-B', owner_id: 'B', claim_token: 'token-B' }).write(key, 'B')).resolves.toBeUndefined();
    await expect(new SupabaseRecommendationRecordStore(client(rpc), 'A', { ...job, claim_token: 'token-2', claim_revision: 2 }).write(key, 'retry')).resolves.toBeUndefined();
  });
  it('lost successful finish response cannot downgrade terminal completion with an error update', async () => {
    const rpc = jest.fn(async (name: string, args?: { p_error: string | null }) => {
      if (name === 'claim_discover_recommendation_job_v2') return { data: job, error: null };
      return { error: new Error(args?.p_error === null ? 'response lost after completion' : 'Terminal publication mismatch') };
    });
    await expect(processRecommendationJob(client(rpc))).rejects.toThrow('response lost after completion');
    expect(rpc.mock.calls).toHaveLength(2);
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_job: job.id, p_token: 'token-1', p_revision: 1, p_error: null });
  });
});

// Explicit transactional reference model, NOT an implementation of SQL or a
// PostgreSQL isolation/ACL proof. It exercises ordering requirements for the RPC
// contract and asynchronous transport; database execution remains BLOCKED.
class GateReference {
  private tails = new Map<string, Promise<unknown>>();
  fenced = new Set<string>(); rows = new Set<string>();
  transaction<T>(owner: string, action: () => Promise<T>): Promise<T> {
    const work = (this.tails.get(owner) ?? Promise.resolve()).catch(() => {}).then(action);
    this.tails.set(owner, work); return work;
  }
  write(owner: string, hold = Promise.resolve()) { return this.transaction(owner, async () => {
    if (this.fenced.has(owner)) throw new Error('fenced'); await hold; this.rows.add(owner);
  }); }
  fence(owner: string) { return this.transaction(owner, async () => { this.fenced.add(owner); }); }
}
describe('transactional ordering reference; real PostgreSQL execution BLOCKED', () => {
  it('writer admitted before deletion settles before tombstone; delayed writers after fence are denied', async () => {
    const model = new GateReference(), hold = deferred();
    const write = model.write('A', hold.promise); let fenced = false;
    const deletion = model.fence('A').then(() => { fenced = true; });
    await Promise.resolve(); await Promise.resolve(); expect(fenced).toBe(false);
    await model.write('B'); hold.resolve(); await Promise.all([write, deletion]);
    expect(model.rows).toEqual(new Set(['A', 'B']));
    await expect(model.write('A')).rejects.toThrow('fenced');
    model.rows.delete('A'); await expect(model.write('A')).rejects.toThrow('fenced');
    expect(model.rows).toEqual(new Set(['B']));
  });
  it('fence wins concurrent admission; late event/upload/job writer cannot recreate A', async () => {
    const model = new GateReference(); await model.fence('A');
    for (const _writer of ['event', 'style', 'job', 'metadata']) await expect(model.write('A')).rejects.toThrow('fenced');
    await model.write('B'); expect(model.rows).toEqual(new Set(['B']));
  });
});

function storageFixture() {
  const blobs = new Set(['model-photos/A/model.jpg', 'wardrobe-cutouts/A/cutout.png', 'model-photos/B/model.jpg']);
  let pending = 0, fenced = true, loseBarrier = false, removeFails = false;
  const port = { assertLease: jest.fn(async () => {}), barrier: jest.fn(async () => fenced && pending === 0),
    objects: jest.fn(async (bucket: string, owner: string) => {
      const paths = [...blobs].filter(uri => uri.startsWith(bucket + '/' + owner + '/')).map(uri => uri.slice(bucket.length + 1));
      if (loseBarrier) { pending++; loseBarrier = false; } return paths;
    }), remove: jest.fn(async (bucket: string, paths: string[]) => {
      if (removeFails) throw new Error('remove failed'); paths.forEach(path => blobs.delete(bucket + '/' + path));
    }) };
  return { port, blobs, adapter: deletionStorageAdapter(port),
    pending: (n: number) => { pending = n; }, fenced: (value: boolean) => { fenced = value; },
    lose: () => { loseBarrier = true; }, failRemove: (value: boolean) => { removeFails = value; } };
}
describe('actual Storage adapter with simulated provider races', () => {
  const receipt = () => createDeletionReceipt('delete-A', 'A');
  it('empty metadata/list is not drain while physical upload is pending; Auth is denied', async () => {
    const f = storageFixture(); f.pending(1); f.blobs.clear();
    const auth = jest.fn(async () => {}), adapters: Partial<Record<DeletionLayer, DeletionAdapter>> = {};
    for (const name of Object.keys(DELETION_LAYERS) as DeletionLayer[]) adapters[name] = {
      idempotent: true, cleanup: name === 'auth' ? auth : async () => {}, verify: async () => ({ complete: true, evidence: ['controlled layer'] }) };
    adapters.storage = f.adapter;
    const result = await runDeletionFoundation(receipt(), adapters, async () => {});
    expect(result.layers.storage.state).toBe('RETRY_REQUIRED'); expect(auth).not.toHaveBeenCalled();
    expect(f.port.objects).not.toHaveBeenCalled();
  });
  it('barrier loss during listing cannot create successful absence proof', async () => {
    const f = storageFixture(); f.blobs.clear(); f.lose();
    await expect(f.adapter.verify(receipt())).rejects.toThrow('drain');
  });
  it('late physical blob settlement is purged on retry; A/B isolation holds', async () => {
    const f = storageFixture(); f.pending(1);
    await expect(f.adapter.cleanup(receipt())).rejects.toThrow('drain');
    f.blobs.add('model-photos/A/late.png'); f.pending(0);
    await f.adapter.cleanup(receipt()); expect((await f.adapter.verify(receipt())).complete).toBe(true);
    expect(f.blobs).toEqual(new Set(['model-photos/B/model.jpg']));
  });
  it('Storage remove failure is retryable without a false success proof', async () => {
    const f = storageFixture(); f.failRemove(true);
    await expect(f.adapter.cleanup(receipt())).rejects.toThrow('remove failed');
    expect((await f.adapter.verify(receipt())).complete).toBe(false);
    f.failRemove(false); await f.adapter.cleanup(receipt()); expect((await f.adapter.verify(receipt())).complete).toBe(true);
  });
  it('expired lease fails before provider mutation; closed admission is required even with zero uploads', async () => {
    const f = storageFixture(); f.port.assertLease.mockRejectedValueOnce(new Error('lease expired'));
    await expect(f.adapter.cleanup(receipt())).rejects.toThrow('lease expired'); expect(f.port.remove).not.toHaveBeenCalled();
    f.fenced(false); await expect(f.adapter.verify(receipt())).rejects.toThrow('drain');
  });
});
