import { assertStorageEmptyBeforeAuth, deletionStorageAdapter } from '../supabase/functions/_shared/accountDeletionStorage';
import { runStorageJanitor, type StorageJanitorPort } from '../supabase/functions/_shared/accountStorageJanitor';
import { createDeletionReceipt } from '../supabase/functions/_shared/accountDeletionFoundation';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const candidate = { owner: A, request: 'deletion-A' };
function fixture(count = 1) {
  const files = new Map([
    ['model-photos', new Set([...Array.from({ length: count }, (_, i) => `${A}/file-${i}.jpg`), `${B}/model.jpg`])],
    ['wardrobe-cutouts', new Set([`${A}/nested/cutout.png`, `${B}/nested/cutout.png`])],
  ]);
  const assertDeletedOwner = jest.fn(async (identity: typeof candidate) => {
    if (identity.owner !== A || identity.request !== candidate.request) throw new Error('Not deleted');
  });
  const barrier = jest.fn(async () => true);
  const list = jest.fn(async (bucket: string, prefix: string, offset: number) => {
    const entries = new Map<string, { name: string; id: string | null }>();
    for (const path of files.get(bucket)!) {
      if (!path.startsWith(prefix + '/')) continue;
      const suffix = path.slice(prefix.length + 1), name = suffix.split('/')[0];
      entries.set(name, { name, id: suffix.includes('/') ? null : `object-${name}` });
    }
    return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(offset, offset + 100);
  });
  const remove = jest.fn(async (bucket: string, paths: string[]) => {
    for (const path of paths) files.get(bucket)!.delete(path);
  });
  const port: StorageJanitorPort = { assertDeletedOwner, barrier, list, remove };
  return { files, assertDeletedOwner, barrier, list, remove, port };
}

describe('A1-lite guarded Storage lifecycle', () => {
  it('sweeps a crashed writer orphan, including nested cutout, and preserves B', async () => {
    const f = fixture();
    expect(await runStorageJanitor(f.port, candidate)).toEqual({ state: 'VERIFIED', code: 'JANITOR_SWEEP_VERIFIED' });
    expect([...f.files.get('model-photos')!]).toEqual([`${B}/model.jpg`]);
    expect([...f.files.get('wardrobe-cutouts')!]).toEqual([`${B}/nested/cutout.png`]);
  });
  it('enumerates all pages before deletion and removes in bounded chunks', async () => {
    const f = fixture(205);
    expect((await runStorageJanitor(f.port, candidate)).state).toBe('VERIFIED');
    expect(f.list.mock.calls).toContainEqual(['model-photos', A, 200]);
    expect(f.remove.mock.calls.filter(([bucket]) => bucket === 'model-photos').map(([, paths]) => paths.length)).toEqual([100, 100, 5]);
  });
  it.each([false, null, 'true', 1])('unproven drain %s cannot list or remove', async value => {
    const f = fixture(); f.barrier.mockResolvedValue(value as never);
    expect((await runStorageJanitor(f.port, candidate)).state).toBe('BLOCKED');
    expect(f.list).not.toHaveBeenCalled(); expect(f.remove).not.toHaveBeenCalled();
  });
  it('a live/recreated owner cannot authorize an orphan sweep', async () => {
    const f = fixture(); f.assertDeletedOwner.mockRejectedValue(new Error('Auth exists'));
    expect((await runStorageJanitor(f.port, candidate)).state).toBe('BLOCKED');
    expect(f.list).not.toHaveBeenCalled(); expect(f.remove).not.toHaveBeenCalled();
  });
  it.each([{ owner: B, request: candidate.request }, { owner: A, request: 'other-request' }, { owner: '../B', request: 'x' }, { owner: A, request: '' }])(
    'rejects foreign or invalid deletion identity %j', async identity => {
      const f = fixture(); expect((await runStorageJanitor(f.port, identity)).state).toBe('BLOCKED');
      expect(f.remove).not.toHaveBeenCalled();
    });
  it('does not trust absence when admission reopens during listing', async () => {
    const f = fixture(); f.list.mockImplementationOnce(async () => { f.barrier.mockResolvedValue(false); return []; });
    expect((await runStorageJanitor(f.port, candidate)).state).toBe('BLOCKED');
    expect(f.remove).not.toHaveBeenCalled();
  });
  it('revalidates authorization before every listing page', async () => {
    const f = fixture(101); const original = f.list.getMockImplementation()!;
    f.list.mockImplementationOnce(async (...args) => {
      const page = await original(...args); f.assertDeletedOwner.mockRejectedValue(new Error('Lost authorization')); return page;
    });
    expect((await runStorageJanitor(f.port, candidate)).state).toBe('BLOCKED');
    expect(f.list).toHaveBeenCalledTimes(1); expect(f.remove).not.toHaveBeenCalled();
  });
  it('partial remove failure stops without retry and reports no completion', async () => {
    const f = fixture(101); const original = f.remove.getMockImplementation()!;
    f.remove.mockImplementationOnce(original).mockRejectedValue(new Error('secret provider detail'));
    expect(await runStorageJanitor(f.port, candidate)).toEqual({ state: 'BLOCKED', code: 'JANITOR_SWEEP_UNVERIFIED' });
    expect(f.remove).toHaveBeenCalledTimes(2);
    expect([...f.files.get('model-photos')!].filter(path => path.startsWith(A + '/'))).toHaveLength(1);
  });
  it('list failure does not become empty Storage evidence', async () => {
    const f = fixture(); f.list.mockRejectedValue(new Error('Unavailable'));
    expect((await runStorageJanitor(f.port, candidate)).state).toBe('BLOCKED');
    expect(f.list).toHaveBeenCalledTimes(1); expect(f.remove).not.toHaveBeenCalled();
  });
  it('a late object appearing after sweep prevents VERIFIED', async () => {
    const f = fixture(); const original = f.remove.getMockImplementation()!;
    f.remove.mockImplementation(async (bucket, paths) => {
      await original(bucket, paths);
      if (bucket === 'wardrobe-cutouts') f.files.get('model-photos')!.add(`${A}/late.jpg`);
    });
    expect(await runStorageJanitor(f.port, candidate)).toEqual({ state: 'BLOCKED', code: 'JANITOR_OBJECTS_REMAIN' });
    expect(f.files.get('model-photos')!.has(`${A}/late.jpg`)).toBe(true);
  });
  it('sequential duplicate sweeps are idempotent without another remove', async () => {
    const f = fixture(); await runStorageJanitor(f.port, candidate); f.remove.mockClear();
    expect((await runStorageJanitor(f.port, candidate)).state).toBe('VERIFIED');
    expect(f.remove).not.toHaveBeenCalled();
  });
  it('concurrent authorized sweeps remain owner-isolated and idempotent', async () => {
    const f = fixture(101);
    const results = await Promise.all([runStorageJanitor(f.port, candidate), runStorageJanitor(f.port, candidate)]);
    expect(results.every(value => value.state === 'VERIFIED')).toBe(true);
    expect([...f.files.get('model-photos')!]).toEqual([`${B}/model.jpg`]);
    expect([...f.files.get('wardrobe-cutouts')!]).toEqual([`${B}/nested/cutout.png`]);
    expect(f.remove.mock.calls.every(([, paths]) => paths.every(path => path.startsWith(A + '/')))).toBe(true);
  });
  it('a mutable caller cannot switch the owner during authorization', async () => {
    const f = fixture(), mutable = { ...candidate };
    f.assertDeletedOwner.mockImplementation(async identity => {
      mutable.owner = B; expect(identity.owner).toBe(A); expect(Object.isFrozen(identity)).toBe(true);
    });
    expect((await runStorageJanitor(f.port, mutable)).state).toBe('VERIFIED');
    expect(f.list.mock.calls.every(([, prefix]) => prefix.startsWith(A))).toBe(true);
  });
  it('rejects malformed directory names before removal', async () => {
    const f = fixture(); f.list.mockResolvedValue([{ name: '../B', id: 'x' }]);
    expect((await runStorageJanitor(f.port, candidate)).state).toBe('BLOCKED'); expect(f.remove).not.toHaveBeenCalled();
  });
  it('rechecks Storage despite a saved VERIFIED receipt before Auth', async () => {
    const receipt = createDeletionReceipt(candidate.request, A);
    receipt.layers.storage = { state: 'VERIFIED', attempts: 1, evidence: ['historical empty listing'] };
    const objects = jest.fn(async () => [`${A}/late.jpg`]), remove = jest.fn();
    const adapter = deletionStorageAdapter({ assertLease: async () => {}, barrier: async () => true, objects, remove });
    const auth = jest.fn();
    await expect((async () => { await assertStorageEmptyBeforeAuth(adapter, receipt); auth(); })()).rejects.toThrow('Storage objects remain');
    expect(objects).toHaveBeenCalledTimes(2); expect(auth).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });
  it('checks both prefixes immediately before allowing the Auth step', async () => {
    const objects = jest.fn(async (_bucket: string, _owner: string) => []), order: string[] = [];
    const adapter = deletionStorageAdapter({ assertLease: async () => { order.push('guard'); }, barrier: async () => true,
      objects: async (bucket, owner) => { order.push(bucket); return objects(bucket, owner); }, remove: async () => {} });
    await assertStorageEmptyBeforeAuth(adapter, createDeletionReceipt(candidate.request, A)); order.push('auth');
    expect(order.indexOf('auth')).toBeGreaterThan(order.indexOf('wardrobe-cutouts'));
    expect(objects.mock.calls).toEqual([['model-photos', A], ['wardrobe-cutouts', A]]);
  });
  it('absence without evidence cannot authorize Auth', async () => {
    await expect(assertStorageEmptyBeforeAuth({ idempotent: true, cleanup: async () => {},
      verify: async () => ({ complete: true, evidence: [] }) }, createDeletionReceipt(candidate.request, A))).rejects.toThrow('unverified');
  });
});
