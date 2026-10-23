import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { coordinateDeletion, FileDeletionStore, withDeletionWriteGuard } from '../scripts/lib/deletionCoordinator';
import { FileJobLifecycleStore } from '../scripts/lib/fileJobLifecycleStore';
import { acknowledgeJobResult, publishCompletedJob, purgeCompletedPayload, JOB_RECOVERY_MAX_MS } from '../scripts/lib/jobPayloadLifecycle';
import { DELETION_LAYERS, deletionCompletion, type DeletionAdapter, type DeletionLayer } from '../lib/accountDeletionFoundation';
import { serverDeletionAdapters } from '../services/deletionCleanupAdapters';

const ownership = { subjectId: 'owner', schemaVersion: 1 as const, coverageVerified: true, tables: [{ table: 'users', ownerColumn: 'id' }], buckets: ['model-photos'], localFiles: [], localKeys: [] };
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'vitrify-p01-')); });
afterEach(async () => {
  if (!path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(root).startsWith('vitrify-p01-')) throw new Error('Unsafe fixture cleanup');
  await rm(root, { recursive: true, force: true });
});
function controlledAdapters() {
  const counts = new Map<string, number>();
  const adapters: Partial<Record<DeletionLayer, DeletionAdapter>> = {};
  for (const layer of Object.keys(DELETION_LAYERS) as DeletionLayer[]) {
    let absent = false;
    adapters[layer] = { idempotent: true, cleanup: async () => { counts.set(layer, (counts.get(layer) ?? 0) + 1); absent = true; },
      verify: async () => ({ complete: absent, evidence: absent ? ['controlled fixture absent'] : [] }) };
  }
  return { adapters, counts };
}
it('durably resumes Storage failure; duplicate requests use one receipt and do not repeat Auth', async () => {
  const store = new FileDeletionStore(root), fixture = controlledAdapters(), original = fixture.adapters.storage!;
  fixture.adapters.storage = { ...original, cleanup: async () => { throw new Error('Storage down'); } };
  const first = await coordinateDeletion(store, 'owner', 'r1', fixture.adapters, true, ownership);
  expect(first.layers.storage.state).toBe('RETRY_REQUIRED'); expect(first.layers.auth.state).toBe('BLOCKED');
  expect((await new FileDeletionStore(root).read('owner'))?.receipt.layers.storage.attempts).toBe(1);
  fixture.adapters.storage = original;
  const second = await coordinateDeletion(new FileDeletionStore(root), 'owner', 'duplicate-id', fixture.adapters, true, ownership);
  expect(second.requestId).toBe('r1'); expect(fixture.counts.get('auth')).toBe(1);
  await coordinateDeletion(store, 'owner', 'r3', fixture.adapters, true, ownership);
  expect(fixture.counts.get('auth')).toBe(1);
  expect(deletionCompletion(second)).toEqual({ appControlledComplete: true, allLayersComplete: false });
  await expect(withDeletionWriteGuard(store, 'owner', async () => undefined)).rejects.toThrow('fenced');
});
it('running guarded writer excludes deletion; unverified writer coverage blocks Auth', async () => {
  const store = new FileDeletionStore(root), fixture = controlledAdapters();
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const running = withDeletionWriteGuard(store, 'owner', () => { started(); return new Promise<void>(resolve => { release = resolve; }); });
  await ready;
  await expect(coordinateDeletion(store, 'owner', 'r', fixture.adapters, true, ownership)).rejects.toMatchObject({ code: 'EEXIST' });
  release(); await running;
  const receipt = await coordinateDeletion(store, 'owner', 'r', fixture.adapters, false);
  expect(receipt.layers.write_fence.state).toBe('RETRY_REQUIRED'); expect(receipt.layers.auth.state).toBe('BLOCKED');
});
it('missing ownership snapshot or failed durable checkpoint cannot permit Auth', async () => {
  const store = new FileDeletionStore(root), fixture = controlledAdapters();
  const missing = await coordinateDeletion(store, 'owner', 'r', fixture.adapters, true);
  expect(missing.layers.auth.state).toBe('BLOCKED'); expect(fixture.counts.get('auth')).toBeUndefined();
  jest.spyOn(store, 'write').mockRejectedValueOnce(new Error('checkpoint disk unavailable'));
  await expect(coordinateDeletion(store, 'owner', 'r', fixture.adapters, true, ownership)).rejects.toThrow('checkpoint');
  expect(fixture.counts.get('auth')).toBeUndefined();
});
it('job acknowledgment is owner/hash-bound; 24h expiry is completed-only and revision-safe', async () => {
  const store = new FileJobLifecycleStore(path.join(root, 'jobs'), new FileDeletionStore(path.join(root, 'owners')));
  await store.create({ id: 'j', ownerId: 'owner', status: 'running', attempt: 'a', revision: 0, requestPayload: 'private', resultPacket: null });
  const hash = await publishCompletedJob(store, 'j', 'a', 'result', 100, JOB_RECOVERY_MAX_MS);
  await expect(acknowledgeJobResult(store, 'j', 'other', hash, 101)).rejects.toThrow();
  expect(await purgeCompletedPayload(store, 'j', 1, 100 + JOB_RECOVERY_MAX_MS - 1)).toBe(false);
  expect(await purgeCompletedPayload(store, 'j', 0, 100 + JOB_RECOVERY_MAX_MS)).toBe(false);
  await acknowledgeJobResult(store, 'j', 'owner', hash, 102);
  await acknowledgeJobResult(store, 'j', 'owner', hash, 103);
  expect(await store.read('j')).toMatchObject({ requestPayload: null, resultPacket: null, acknowledgedAt: 102 });
  await store.create({ id: 'expired', ownerId: 'owner', status: 'running', attempt: 'b', revision: 0, requestPayload: 'p', resultPacket: null });
  await publishCompletedJob(store, 'expired', 'b', 'r', 0, JOB_RECOVERY_MAX_MS);
  expect(await purgeCompletedPayload(store, 'expired', 1, JOB_RECOVERY_MAX_MS)).toBe(true);
  for (const status of ['queued', 'running', 'error'] as const) {
    await store.create({ id: status, ownerId: 'owner', status, attempt: 'x', revision: 0, requestPayload: 'untouched', resultPacket: null });
    expect(await purgeCompletedPayload(store, status, 0, 2 * JOB_RECOVERY_MAX_MS)).toBe(false);
    expect((await store.read(status)).requestPayload).toBe('untouched');
  }
});
it('rejects stale worker attempts and any late publish after fenced job deletion', async () => {
  const owners = new FileDeletionStore(path.join(root, 'owners')), jobs = new FileJobLifecycleStore(path.join(root, 'jobs'), owners);
  await jobs.create({ id: 'j', ownerId: 'owner', status: 'running', attempt: 'new', revision: 0, requestPayload: 'p', resultPacket: null });
  const orphan = path.join(root, 'jobs', createHash('sha256').update('orphan').digest('hex') + '.json.abc.tmp');
  await writeFile(orphan, JSON.stringify({ id: 'orphan', ownerId: 'owner', requestPayload: 'interrupted-write' }));
  await expect(publishCompletedJob(jobs, 'j', 'old', 'r', 0, 1000)).rejects.toThrow('Stale');
  const fixture = controlledAdapters(); fixture.adapters.jobs_payload = jobs.deletionAdapter();
  await coordinateDeletion(owners, 'owner', 'r', fixture.adapters, true, ownership);
  await expect(readFile(orphan)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(publishCompletedJob(jobs, 'j', 'new', 'r', 0, 1000)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(jobs.create({ id: 'late', ownerId: 'owner', status: 'running', attempt: 'x', revision: 0, requestPayload: 'p', resultPacket: null })).rejects.toThrow('fenced');
});
it('concrete Storage adapter enumerates nested prefixes and verifies before Auth', async () => {
  const files = new Set(['owner/model.jpg', 'owner/item/cutout.png', 'other/model.jpg']);
  const users = new Set(['owner']), order: string[] = [];
  let storageFailed = true;
  const admin = { storage: { from: () => ({ list: async (prefix: string) => ({ error: null, data:
    [...new Set([...files].filter(file => file.startsWith(prefix + '/')).map(file => file.slice(prefix.length + 1).split('/')[0]))]
      .map(name => ({ name, id: files.has(prefix + '/' + name) ? name : null })) }),
    remove: async (paths: string[]) => {
      if (storageFailed) return { error: new Error('Storage unavailable') };
      order.push('storage'); paths.forEach(file => files.delete(file)); return { error: null };
    } }) },
    from: () => ({ select: () => ({ eq: async () => ({ error: null, count: 0 }) }) }),
    auth: { admin: { listUsers: async () => ({ data: { users: [...users].map(id => ({ id })) }, error: null }),
      deleteUser: async (id: string) => { order.push('auth'); users.delete(id); return { error: null }; } } } };
  const fixture = controlledAdapters();
  Object.assign(fixture.adapters, serverDeletionAdapters(admin as never, { coverageVerified: true,
    tables: [{ table: 'users', ownerColumn: 'id' }], buckets: ['model-photos', 'wardrobe-cutouts'] },
    { subjectId: 'owner', assertLease: async () => {}, barrier: async () => true }));
  const failed = await coordinateDeletion(new FileDeletionStore(root), 'owner', 'r', fixture.adapters, true, ownership);
  expect(failed.layers.storage.state).toBe('RETRY_REQUIRED'); expect(users.has('owner')).toBe(true);
  storageFailed = false;
  const receipt = await coordinateDeletion(new FileDeletionStore(root), 'owner', 'retry', fixture.adapters, true, ownership);
  expect(receipt.layers.auth.state).toBe('VERIFIED'); expect(order.indexOf('storage')).toBeLessThan(order.indexOf('auth'));
  expect([...files]).toEqual(['other/model.jpg']);
});
