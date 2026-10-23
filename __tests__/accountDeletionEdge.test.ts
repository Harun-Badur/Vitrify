import { createDeletionReceipt, deletionHandler, DEVICE_LAYERS, type DeletionPort, type DeletionLease } from '../supabase/functions/_shared/accountDeletionCoordinator';
import { DELETION_LAYERS, type DeletionReceipt, type DeletionAdapter, type DeletionLayer } from '../lib/accountDeletionFoundation';
import { serverDeletionAdapters } from '../services/deletionCleanupAdapters';

const token = 'a'.repeat(64);
function fixture() {
  let durable: DeletionReceipt | undefined;
  let held = false;
  const rows = new Set(['A', 'B']), files = new Set(['A/model.jpg', 'A/nested/cutout.png', 'B/model.jpg']);
  const users = new Set(['A', 'B']), calls: string[] = [];
  let fault = '';
  const admin = {
    from: () => ({ delete: () => ({ eq: async (_column: string, owner: string) => {
      calls.push('db'); if (fault === 'db-delete') return { error: new Error('DB unavailable') };
      rows.delete(owner); return { error: null };
    } }), select: () => ({ eq: async (_column: string, owner: string) => ({ error: fault === 'db-verify' ? new Error('DB read failed') : null,
      count: fault === 'db-null-count' ? null : Number(rows.has(owner)) }) }) }),
    storage: { from: () => ({ list: async (prefix: string) => ({ error: fault === 'storage-list' ? new Error('List failed') : null,
      data: [...new Set([...files].filter(file => file.startsWith(prefix + '/')).map(file => file.slice(prefix.length + 1).split('/')[0]))]
        .map(name => ({ name, id: files.has(prefix + '/' + name) ? name : null })) }),
      remove: async (paths: string[]) => { calls.push('storage'); if (fault === 'storage-delete') return { error: new Error('Remove failed') };
        paths.forEach(path => files.delete(path)); return { error: null }; } }) },
    auth: { admin: { listUsers: async () => ({ error: fault === 'auth-verify' ? new Error('Auth read failed') : null,
      data: { users: [...users].map(id => ({ id })) } }), deleteUser: async (id: string) => {
      calls.push('auth'); if (fault === 'auth-delete') return { error: new Error('Auth delete failed') };
      users.delete(id); return { error: null }; } } },
  };
  const adapters: Partial<Record<DeletionLayer, DeletionAdapter>> = serverDeletionAdapters(admin as never,
    { coverageVerified: true, tables: [{ table: 'users', ownerColumn: 'id' }], buckets: ['model-photos', 'wardrobe-cutouts'] },
    { subjectId: 'A', assertLease: async () => { if (fault === 'lease') throw new Error('Lease lost'); }, barrier: async () => fault !== 'barrier' });
  for (const layer of ['write_fence', 'jobs_payload', 'recommendation_cache'] as const) {
    let clean = false;
    adapters[layer] = { idempotent: true, cleanup: async () => { calls.push(layer); if (fault === layer) throw new Error('failed'); clean = true; },
      verify: async () => ({ complete: clean, evidence: clean ? ['fixture verified ' + layer] : [] }) };
  }
  const port: DeletionPort = {
    readiness: async () => fault !== 'readiness',
    authenticate: async value => value === 'valid' && users.has('A') ? 'A' : null,
    begin: async (subject, requestId, capability) => {
      if (held || capability !== token || (subject && subject !== 'A') || (durable && durable.requestId !== requestId)) throw new Error('Denied');
      held = true;
      durable ??= createDeletionReceipt(requestId, 'A');
      return { receipt: JSON.parse(JSON.stringify(durable)), lease: 'lease' };
    },
    save: async (_lease, receipt) => {
      if (fault === 'checkpoint') throw new Error('Persistence unavailable');
      if (fault === 'after-auth-save' && !users.has('A')) throw new Error('Response lost after Auth');
      durable = JSON.parse(JSON.stringify(receipt));
    },
    release: async () => { held = false; }, adapters: () => ({ ...adapters }),
  };
  const handler = deletionHandler(port);
  const initial = () => {
    const device = createDeletionReceipt('r1', 'A');
    for (const layer of DEVICE_LAYERS) device.layers[layer] = { state: 'VERIFIED', attempts: 1, evidence: ['device fixture verified'] };
    return handler(new Request('https://fixture.invalid', { method: 'POST', headers: { Authorization: 'Bearer valid' },
      body: JSON.stringify({ requestId: 'r1', recoveryToken: token, deviceCheckpoint: device }) }));
  };
  const recover = (capability = token) => handler(new Request('https://fixture.invalid', { method: 'POST',
    headers: { 'x-deletion-recovery': capability }, body: JSON.stringify({ requestId: 'r1' }) }));
  return { initial, recover, handler, rows, users, files, calls, port, fault: (value: string) => { fault = value; }, durable: () => durable };
}

it('GET readiness speaks v1; missing readiness never acquires a destructive lease', async () => {
  const f = fixture(); f.fault('readiness'); const begin = jest.spyOn(f.port, 'begin');
  const result = await f.handler(new Request('https://fixture.invalid', { headers: { Authorization: 'Bearer valid' } }));
  expect(await result.json()).toMatchObject({ protocol: 'vitrify.deletion.v1', ready: false, postAuthRecovery: false });
  expect((await f.initial()).status).toBe(503); expect(begin).not.toHaveBeenCalled(); expect(f.calls).toEqual([]);
});
it.each(['db-delete', 'db-verify', 'db-null-count', 'storage-list', 'storage-delete', 'jobs_payload', 'recommendation_cache', 'write_fence'])('%s failure prevents Auth and resumes safely', async fault => {
  const f = fixture(); f.fault(fault);
  const result = await f.initial(); expect(result.status).toBe(200);
  expect((await result.json()).complete).toBe(false); expect(f.users.has('A')).toBe(true); expect(f.calls).not.toContain('auth');
  f.fault(''); const resumed = await f.recover(); expect(resumed.status).toBe(200); expect((await resumed.json()).complete).toBe(true);
  expect(f.calls.filter(value => value === 'auth')).toHaveLength(1);
});
it('Auth is last; deleting A preserves B DB, nested Storage and Auth', async () => {
  const f = fixture(); const result = await f.initial(); expect((await result.json()).complete).toBe(true);
  expect(f.calls.at(-1)).toBe('auth'); expect([...f.rows]).toEqual(['B']); expect([...f.files]).toEqual(['B/model.jpg']); expect([...f.users]).toEqual(['B']);
  for (const layer of Object.keys(DELETION_LAYERS).filter(key => !['vendor', 'backup', 'export', 'auth'].includes(key)))
    expect(f.durable()!.layers[layer as DeletionLayer].state).toBe('VERIFIED');
  expect((await (await f.recover()).json()).complete).toBe(true); expect(f.calls.filter(value => value === 'auth')).toHaveLength(1);
});
it('failed durable checkpoint prevents all cleanup', async () => {
  const f = fixture(); f.fault('checkpoint'); expect((await f.initial()).status).toBe(503); expect(f.calls).toEqual([]); expect(f.users.has('A')).toBe(true);
});
it('lost post-Auth checkpoint recovers without JWT; absence avoids duplicate Auth deletion', async () => {
  const f = fixture(); f.fault('after-auth-save'); expect((await f.initial()).status).toBe(503); expect(f.users.has('A')).toBe(false);
  const authenticate = jest.spyOn(f.port, 'authenticate'); f.fault('');
  const result = await f.recover(); expect(result.status).toBe(200); expect((await result.json()).complete).toBe(true);
  expect(authenticate).not.toHaveBeenCalled(); expect(f.calls.filter(value => value === 'auth')).toHaveLength(1);
});
it.each(['auth-delete', 'auth-verify'])('%s does not manufacture completion and can retry', async fault => {
  const f = fixture(); f.fault(fault); const first = await f.initial(); expect((await first.json()).complete).toBe(false);
  f.fault(''); expect((await (await f.recover()).json()).complete).toBe(true);
});
it('invalid recovery capability and invalid initial JWT cannot clean up another account', async () => {
  const f = fixture(); expect((await f.recover('b'.repeat(64))).status).toBe(503); expect(f.calls).toEqual([]);
  expect((await f.handler(new Request('https://fixture.invalid', { method: 'POST', headers: { Authorization: 'Bearer bad' } }))).status).toBe(401);
});
