import AsyncStorage from '@react-native-async-storage/async-storage';
import { serverDeletionAdapters } from '../services/deletionCleanupAdapters';
import { deletionStorageAdapter, listOwnedStorageObjects } from '../supabase/functions/_shared/accountDeletionStorage';
import { createDeletionReceipt, deletionCompletion, isDeletionReceipt } from '../lib/accountDeletionFoundation';
import { accountDeletionCheckpointKey, resumeAccountDeletion, resumePendingAccountDeletions } from '../services/accountService';

jest.mock('expo-file-system/legacy', () => ({ cacheDirectory: 'file:///cache/', documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn(async () => ({ exists: false })) }));
const receipt = () => createDeletionReceipt('request-A', 'A');
const ready = () => {
  const saved = receipt();
  for (const layer of ['queue', 'async_storage', 'local_files', 'memory_cache'] as const)
    saved.layers[layer] = { state: 'VERIFIED', attempts: 1, evidence: ['saved device proof'] };
  return { ...saved, recoveryToken: 'a'.repeat(64) };
};
const completed = () => {
  const saved = ready();
  for (const layer of ['write_fence', 'storage', 'jobs_payload', 'db', 'recommendation_cache', 'auth'] as const)
    saved.layers[layer] = { state: 'VERIFIED', attempts: 1, evidence: ['server absence proof'] };
  return saved;
};
let originalFetch: typeof fetch;
beforeEach(async () => {
  originalFetch = global.fetch;
  await AsyncStorage.clear();
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://fixture.invalid';
});
afterEach(() => { global.fetch = originalFetch; delete process.env.EXPO_PUBLIC_SUPABASE_URL; });

it('legacy admin adapters require lease/barrier even when ownership is asserted', async () => {
  const from = jest.fn();
  const adapters = serverDeletionAdapters({ storage: { from } } as never,
    { coverageVerified: true, tables: [{ table: 'profiles', ownerColumn: 'id' }], buckets: ['model-photos', 'wardrobe-cutouts'] });
  await expect(adapters.storage!.cleanup(receipt())).rejects.toThrow('barrier');
  await expect(adapters.auth!.cleanup(receipt())).rejects.toThrow('barrier');
  expect(from).not.toHaveBeenCalled();
});
it.each(['B/model.jpg', 'A/../B/model.jpg', 'A//model.jpg', 'A\\model.jpg'])('foreign/unsafe inventory %s cannot reach remove', async path => {
  const remove = jest.fn();
  const adapter = deletionStorageAdapter({ assertLease: async () => {}, barrier: async () => true,
    objects: async () => [path], remove });
  await expect(adapter.cleanup(receipt())).rejects.toThrow('ownership');
  expect(remove).not.toHaveBeenCalled();
});
it('a valid A lease cannot authorize B Storage/DB/Auth cleanup', async () => {
  const from = jest.fn(), removeUser = jest.fn();
  const adapters = serverDeletionAdapters({ storage: { from }, from, auth: { admin: { deleteUser: removeUser } } } as never,
    { coverageVerified: true, tables: [{ table: 'profiles', ownerColumn: 'id' }], buckets: ['model-photos', 'wardrobe-cutouts'] },
    { subjectId: 'A', assertLease: async () => {}, barrier: async () => true });
  for (const layer of ['storage', 'db', 'auth'] as const) {
    await expect(adapters[layer]!.cleanup(createDeletionReceipt('foreign', 'B'))).rejects.toThrow('owner mismatch');
  }
  expect(from).not.toHaveBeenCalled(); expect(removeUser).not.toHaveBeenCalled();
});
it('paged and nested inventory is complete and checks lease before every page', async () => {
  const guard = jest.fn(async () => {});
  const list = jest.fn(async (prefix: string, offset: number) => prefix === 'A/nested' ? [{ name: 'cutout.png', id: 'object' }] :
    offset === 0 ? [{ name: 'nested', id: null }, ...Array.from({ length: 99 }, (_, i) => ({ name: `f${i}`, id: `id${i}` }))] : []);
  const paths = await listOwnedStorageObjects('A', list, guard);
  expect(paths).toHaveLength(100); expect(paths).toContain('A/nested/cutout.png');
  expect(list.mock.calls).toEqual([['A', 0], ['A/nested', 0], ['A', 100]]);
  expect(guard).toHaveBeenCalledTimes(4);
});
it('lease expiry on the next page stops listing without claiming absence', async () => {
  const guard = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('lease expired'));
  const list = jest.fn(async () => Array.from({ length: 100 }, (_, i) => ({ name: `f${i}`, id: `id${i}` })));
  await expect(listOwnedStorageObjects('A', list, guard)).rejects.toThrow('lease expired');
  expect(list).toHaveBeenCalledTimes(1);
});
it('a repeating full page cannot loop or manufacture a complete inventory', async () => {
  const list = jest.fn(async () => Array.from({ length: 100 }, (_, i) => ({ name: `f${i}`, id: `id${i}` })));
  await expect(listOwnedStorageObjects('A', list, async () => {})).rejects.toThrow('progress');
  expect(list).toHaveBeenCalledTimes(2);
});
it('malformed Storage entries fail instead of being treated as files', async () => {
  await expect(listOwnedStorageObjects('A', async () => [{ name: 'model.jpg' } as never], async () => {})).rejects.toThrow('entry');
});
it.each([null, { layers: {} }, { ...completed(), layers: { ...completed().layers, storage: { state: 'VERIFIED', attempts: 1 } } }])(
  'malformed receipt cannot become completion or throw in the completion predicate', value => {
    expect(isDeletionReceipt(value)).toBe(false);
    expect(deletionCompletion(value as never)).toEqual({ appControlledComplete: false, allLayersComplete: false });
  });
it('recovery without durable device evidence never sends a network request', async () => {
  await AsyncStorage.setItem(accountDeletionCheckpointKey('A'), JSON.stringify({ ...receipt(), recoveryToken: 'a'.repeat(64) }));
  global.fetch = jest.fn();
  await expect(resumeAccountDeletion('A')).rejects.toThrow('cihaz');
  expect(global.fetch).not.toHaveBeenCalled();
});
it('partial recovery persists server progress, keeps capability and does not adopt provider/device assertions', async () => {
  const saved = ready();
  await AsyncStorage.setItem(accountDeletionCheckpointKey('A'), JSON.stringify(saved));
  const partial = ready();
  partial.layers.storage = { state: 'VERIFIED', attempts: 1, evidence: ['server storage absent'] };
  partial.layers.vendor = { state: 'VERIFIED', attempts: 1, evidence: ['unsupported provider claim'] };
  partial.layers.queue.evidence = ['remote device claim'];
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ protocol: 'vitrify.deletion.v1', receipt: partial }) })) as never;
  await expect(resumeAccountDeletion('A')).rejects.toThrow('bekliyor');
  const persisted = JSON.parse((await AsyncStorage.getItem(accountDeletionCheckpointKey('A')))!);
  expect(persisted.layers.storage.state).toBe('VERIFIED'); expect(persisted.recoveryToken).toBe(saved.recoveryToken);
  expect(persisted.layers.vendor.state).toBe('UNKNOWN'); expect(persisted.layers.queue.evidence).toEqual(['saved device proof']);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
it('concurrent recovery entry points share one request and finalization', async () => {
  await AsyncStorage.setItem(accountDeletionCheckpointKey('A'), JSON.stringify(ready()));
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ protocol: 'vitrify.deletion.v1', receipt: completed() }) })) as never;
  await Promise.all([resumeAccountDeletion('A'), resumeAccountDeletion('A'), resumePendingAccountDeletions()]);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse((await AsyncStorage.getItem(accountDeletionCheckpointKey('A')))!).recoveryToken).toBeUndefined();
});
it('completed checkpoint with leftover capability is minimized locally after restart', async () => {
  await AsyncStorage.setItem(accountDeletionCheckpointKey('A'), JSON.stringify(completed()));
  global.fetch = jest.fn();
  await resumePendingAccountDeletions();
  expect(global.fetch).not.toHaveBeenCalled();
  const saved = JSON.parse((await AsyncStorage.getItem(accountDeletionCheckpointKey('A')))!);
  expect(saved.recoveryToken).toBeUndefined(); expect(deletionCompletion(saved).appControlledComplete).toBe(true);
});
it('malformed/foreign recovery reply preserves original checkpoint and capability', async () => {
  const value = JSON.stringify(ready()); await AsyncStorage.setItem(accountDeletionCheckpointKey('A'), value);
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ protocol: 'vitrify.deletion.v1', receipt: { ...completed(), subjectId: 'B' } }) })) as never;
  await expect(resumeAccountDeletion('A')).rejects.toThrow('completion');
  expect(await AsyncStorage.getItem(accountDeletionCheckpointKey('A'))).toBe(value);
});
