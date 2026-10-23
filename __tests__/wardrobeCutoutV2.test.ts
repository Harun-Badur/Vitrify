import AsyncStorage from '@react-native-async-storage/async-storage';
import { createWardrobeCutoutV2, cutoutV2Key, transientCutoutPreparationFailure, type CutoutV2Backend, type CutoutV2Identity, type CutoutV2Job } from '../services/wardrobeCutoutV2';
import { fenceAccountWrites, resetAccountWriteFenceMemoryForTests, withAccountWriteGuard } from '../lib/accountWriteFence';
import { ownerWorkEvidence, resetDeviceWorkForTests, setDeviceSessionOwner } from '../lib/accountDeviceWork';

let mockRequest = 0;
jest.mock('../lib/analytics', () => ({ createUuid: () => `request-${++mockRequest}` }));
const id: CutoutV2Identity = { owner: 'owner-A', wardrobeItemId: 'item-A', originalVersion: 'a'.repeat(64) };
const storageSet = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
const storageGet = jest.mocked(AsyncStorage.getItem).getMockImplementation()!;
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
function fixture(enabled = true) {
  let exists = true, version = id.originalVersion, status = 'pending', protocol: 2 | undefined = 2;
  const response = (job: CutoutV2Job) => ({ protocol: 'vitrify.cutout.v2' as const, ...job.identity, request: job.request, resultId: 'result-A', pngSha256: 'b'.repeat(64) });
  const prepare = jest.fn<ReturnType<CutoutV2Backend['prepare']>, Parameters<CutoutV2Backend['prepare']>>(async () => ({ value: 'local-prepared', cleanup: async () => {} }));
  const dispatch = jest.fn<ReturnType<CutoutV2Backend['dispatch']>, Parameters<CutoutV2Backend['dispatch']>>(async (job: CutoutV2Job) => response(job));
  const statusRead = jest.fn<ReturnType<CutoutV2Backend['status']>, Parameters<CutoutV2Backend['status']>>(async () => ({ state: 'UNKNOWN' }));
  const saveVerified = jest.fn(async () => ({ uri: 'file:///owned/result.png', pngSha256: 'b'.repeat(64) }));
  const verifyOwnedPng = jest.fn(async () => true);
  const backend: CutoutV2Backend = { contract: 'vitrify.cutout.v2', prepare, dispatch, status: statusRead };
  const options = { currentItem: () => exists ? { originalVersion: version, cutoutStatus: status, cutoutProtocol: protocol } : undefined,
    backend: enabled ? backend : undefined, artifacts: { saveVerified, verifyOwnedPng } };
  return { service: createWardrobeCutoutV2(options), reopen: () => createWardrobeCutoutV2(options), response, prepare, dispatch, statusRead, saveVerified, verifyOwnedPng,
    remove: () => { exists = false; }, replace: () => { version = 'c'.repeat(64); }, legacy: () => { status = 'blocked'; }, legacyPending: () => { protocol = undefined; } };
}
beforeEach(async () => { jest.restoreAllMocks(); jest.mocked(AsyncStorage.setItem).mockImplementation(storageSet); jest.mocked(AsyncStorage.getItem).mockImplementation(storageGet); await AsyncStorage.clear(); resetAccountWriteFenceMemoryForTests(); resetDeviceWorkForTests(); setDeviceSessionOwner(id.owner); mockRequest = 0; });

test('asynchronous backend ACK retains DISPATCH_POSSIBLE without artifact or redispatch', async () => {
  const f = fixture();
  f.dispatch.mockImplementation(async job => ({ protocol: 'vitrify.cutout.v2', ...job.identity, request: job.request, state: 'DISPATCH_POSSIBLE' }));
  expect((await f.service.run(id)).state).toBe('DISPATCH_POSSIBLE');
  expect(f.saveVerified).not.toHaveBeenCalled();
  await expect(f.reopen().run(id)).rejects.toMatchObject({ code: 'CUTOUT_V2_UNKNOWN' });
  expect(f.dispatch).toHaveBeenCalledTimes(1);
});

test('default backend is disabled, creates no dispatch journal and never calls provider', async () => {
  const f = fixture(false);
  await expect(f.service.run(id)).rejects.toMatchObject({ code: 'CUTOUT_V2_BACKEND_UNAVAILABLE' });
  expect(await AsyncStorage.getItem(cutoutV2Key(id))).toBeNull(); expect(f.dispatch).not.toHaveBeenCalled();
});
test('crash before dispatch recovers PRE_DISPATCH with the same identity/request', async () => {
  const f = fixture(); const first = await f.service.createNew(id);
  expect(first.state).toBe('PRE_DISPATCH');
  f.dispatch.mockImplementation(async job => {
    expect(JSON.parse((await AsyncStorage.getItem(cutoutV2Key(id)))!)).toMatchObject({ state: 'DISPATCH_POSSIBLE', request: first.request, identity: id });
    return f.response(job);
  });
  const result = await f.reopen().run(id);
  expect(result).toMatchObject({ state: 'ARTIFACT_SAVED', request: first.request, identity: id });
  expect(f.dispatch).toHaveBeenCalledTimes(1);
});
test('journal write/read-back failure prevents provider dispatch', async () => {
  const f = fixture(); await f.service.createNew(id);
  jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key, value) => {
    if (key === cutoutV2Key(id) && JSON.parse(value).state === 'DISPATCH_POSSIBLE') throw new Error('disk failure');
    await storageSet(key, value);
  });
  await expect(f.service.run(id)).rejects.toThrow(); expect(f.dispatch).not.toHaveBeenCalled();
});
test('lost dispatch checkpoint acknowledgement fails closed on restart', async () => {
  const f = fixture(); await f.service.createNew(id);
  jest.spyOn(AsyncStorage, 'getItem').mockImplementation(async key => {
    const raw = await storageGet(key);
    if (key === cutoutV2Key(id) && raw && JSON.parse(raw).state === 'DISPATCH_POSSIBLE') throw new Error('read-back lost');
    return raw;
  });
  await expect(f.service.run(id)).rejects.toThrow(); expect(f.dispatch).not.toHaveBeenCalled();
  jest.mocked(AsyncStorage.getItem).mockImplementation(storageGet);
  await expect(f.reopen().run(id)).rejects.toMatchObject({ code: 'CUTOUT_V2_UNKNOWN' });
});
test('crash-after-dispatch / timeout remains UNKNOWN, with no automatic status or redispatch', async () => {
  const f = fixture(); f.dispatch.mockRejectedValueOnce(new Error('timeout'));
  await expect(f.service.run(id)).rejects.toThrow();
  expect((await f.service.read(id))?.state).toBe('DISPATCH_POSSIBLE');
  await expect(f.reopen().run(id)).rejects.toMatchObject({ code: 'CUTOUT_V2_UNKNOWN' });
  expect(f.dispatch).toHaveBeenCalledTimes(1); expect(f.statusRead).not.toHaveBeenCalled();
});
test('duplicate calls across instances dispatch once and keep a stable request', async () => {
  const f = fixture(); const first = await f.service.createNew(id);
  const results = await Promise.all([f.service.run(id), f.reopen().run(id)]);
  expect(results.map(job => job.request)).toEqual([first.request, first.request]); expect(f.dispatch).toHaveBeenCalledTimes(1);
});
test('only explicitly transient PRE_DISPATCH preparation retries, bounded durably to two attempts', async () => {
  const f = fixture(); f.prepare.mockRejectedValue(transientCutoutPreparationFailure());
  await expect(f.service.run(id)).rejects.toThrow();
  expect(f.prepare).toHaveBeenCalledTimes(2); expect(f.dispatch).not.toHaveBeenCalled();
  expect((await f.service.read(id))?.state).toBe('PRE_DISPATCH');
  await expect(f.reopen().run(id)).rejects.toMatchObject({ code: 'CUTOUT_V2_PREPARATION_LIMIT' });
  expect(f.prepare).toHaveBeenCalledTimes(2);
});
test('permanent preparation failure is not automatically retried', async () => {
  const f = fixture(); f.prepare.mockRejectedValueOnce(new Error('invalid input'));
  await expect(f.service.run(id)).rejects.toThrow();
  await expect(f.reopen().run(id)).rejects.toMatchObject({ code: 'CUTOUT_V2_PREPARATION_STOPPED' });
  expect(f.prepare).toHaveBeenCalledTimes(1); expect(f.dispatch).not.toHaveBeenCalled();
});
test('response identity mismatch never advances to RESPONSE_OBSERVED', async () => {
  const f = fixture(); f.dispatch.mockImplementation(async job => ({ ...f.response(job), request: 'other-request' }));
  await expect(f.service.run(id)).rejects.toMatchObject({ code: 'CUTOUT_V2_RESPONSE_INVALID' });
  expect((await f.service.read(id))?.state).toBe('DISPATCH_POSSIBLE'); expect(f.saveVerified).not.toHaveBeenCalled();
});
test('RESPONSE_OBSERVED recovers only the saved result identity; ARTIFACT_SAVED never re-enters provider', async () => {
  const f = fixture(); f.saveVerified.mockRejectedValueOnce(new Error('write interrupted'));
  await expect(f.service.run(id)).rejects.toThrow();
  expect((await f.service.read(id))?.state).toBe('RESPONSE_OBSERVED');
  await expect(f.reopen().run(id)).resolves.toMatchObject({ state: 'ARTIFACT_SAVED' });
  await f.reopen().run(id);
  expect(f.dispatch).toHaveBeenCalledTimes(1); expect(f.prepare).toHaveBeenCalledTimes(1); expect(f.saveVerified).toHaveBeenCalledTimes(2);
});
test('unverified artifact never commits ARTIFACT_SAVED', async () => {
  const f = fixture(); f.verifyOwnedPng.mockResolvedValue(false);
  await expect(f.service.run(id)).rejects.toMatchObject({ code: 'CUTOUT_V2_ARTIFACT_UNVERIFIED' });
  expect((await f.service.read(id))?.state).toBe('RESPONSE_OBSERVED');
});
test('explicit read-only status NOT_FOUND preserves UNKNOWN; a correlated result can be recovered', async () => {
  const f = fixture(); f.dispatch.mockRejectedValueOnce(new Error('lost response'));
  await expect(f.service.run(id)).rejects.toThrow();
  f.statusRead.mockResolvedValueOnce({ state: 'NOT_FOUND' });
  await expect(f.service.reconcile(id)).resolves.toMatchObject({ state: 'DISPATCH_POSSIBLE' });
  f.statusRead.mockImplementation(async job => ({ state: 'RESPONSE_OBSERVED', response: f.response(job) }));
  await expect(f.service.reconcile(id)).resolves.toMatchObject({ state: 'RESPONSE_OBSERVED' });
  await f.service.run(id); expect(f.dispatch).toHaveBeenCalledTimes(1);
});
test('legacy blocked and owner/provider UNKNOWN stay unchanged and block new V2 admission', async () => {
  const f = fixture(); f.legacy();
  await expect(f.service.createNew(id)).rejects.toMatchObject({ code: 'CUTOUT_V2_LEGACY_ITEM_BLOCKED' });
  const key = `vitrify.provider-dispatch.v1.${id.owner}.wardrobe-cutout.legacy-request`;
  const raw = JSON.stringify({ owner: id.owner, provider: 'wardrobe-cutout', request: 'legacy-request', state: 'UNKNOWN' });
  await AsyncStorage.setItem(key, raw);
  const fresh = fixture();
  await expect(fresh.service.createNew(id)).rejects.toMatchObject({ code: 'CUTOUT_V2_LEGACY_UNKNOWN' });
  expect(await AsyncStorage.getItem(key)).toBe(raw); expect(await AsyncStorage.getItem(cutoutV2Key(id))).toBeNull();
});
test('legacy pending without a durable new-item V2 marker cannot be assigned PRE_DISPATCH', async () => {
  const f = fixture(); f.legacyPending();
  await expect(f.service.createNew(id)).rejects.toMatchObject({ code: 'CUTOUT_V2_LEGACY_ITEM_BLOCKED' });
  expect(await AsyncStorage.getItem(cutoutV2Key(id))).toBeNull(); expect(f.dispatch).not.toHaveBeenCalled();
});
test('a legacy UNKNOWN appearing during preparation still prevents dispatch and cleans up', async () => {
  const f = fixture(), cleanup = jest.fn(async () => {});
  f.prepare.mockImplementation(async () => {
    await AsyncStorage.setItem(`vitrify.provider-dispatch.v1.${id.owner}.wardrobe-cutout.late-request`, JSON.stringify({ owner: id.owner, provider: 'wardrobe-cutout', request: 'late-request', state: 'UNKNOWN' }));
    return { value: 'local', cleanup };
  });
  await expect(f.service.run(id)).rejects.toMatchObject({ code: 'CUTOUT_V2_LEGACY_UNKNOWN' });
  expect(f.dispatch).not.toHaveBeenCalled(); expect(cleanup).toHaveBeenCalledTimes(1);
  expect((await f.service.read(id))?.state).toBe('PRE_DISPATCH');
});
test('unsupported/corrupt V2 journal fails closed without repair or dispatch', async () => {
  const f = fixture(); const job = await f.service.createNew(id);
  const raw = JSON.stringify({ ...job, version: 99 }); await AsyncStorage.setItem(cutoutV2Key(id), raw);
  await expect(f.service.read(id)).rejects.toMatchObject({ code: 'CUTOUT_V2_JOURNAL_INVALID' });
  expect(await AsyncStorage.getItem(cutoutV2Key(id))).toBe(raw); expect(f.dispatch).not.toHaveBeenCalled();
});
test('independent V2 item can advance while another correlated V2 request remains UNKNOWN', async () => {
  const f = fixture(); f.dispatch.mockRejectedValueOnce(new Error('lost response'));
  await expect(f.service.run(id)).rejects.toThrow();
  await expect(f.service.run({ ...id, wardrobeItemId: 'item-B' })).resolves.toMatchObject({ state: 'ARTIFACT_SAVED' });
  expect((await f.service.read(id))?.state).toBe('DISPATCH_POSSIBLE');
});
test.each(['remove', 'replace'] as const)('removed/replaced original cannot receive a late provider result: %s', async action => {
  const f = fixture(); f.dispatch.mockImplementation(async job => { f[action](); return f.response(job); });
  await expect(f.service.run(id)).rejects.toThrow(); expect(f.saveVerified).not.toHaveBeenCalled();
});
test('A to B to A account switch invalidates a late response', async () => {
  const f = fixture(); f.dispatch.mockImplementation(async job => { setDeviceSessionOwner('owner-B'); setDeviceSessionOwner(id.owner); return f.response(job); });
  await expect(f.service.run(id)).rejects.toThrow(); expect(f.saveVerified).not.toHaveBeenCalled();
});
test('deletion drains the real provider and cleanup, without late publication or a held network mutex', async () => {
  const f = fixture(), started = deferred(), response = deferred(), cleanupStarted = deferred(), cleanup = deferred();
  f.prepare.mockResolvedValue({ value: 'local', cleanup: async () => { cleanupStarted.resolve(); await cleanup.promise; } });
  f.dispatch.mockImplementation(async job => { started.resolve(); await response.promise; return f.response(job); });
  const work = f.service.run(id); const rejected = expect(work).rejects.toThrow();
  await started.promise;
  await expect(withAccountWriteGuard(id.owner, async () => 'independent-local-write')).resolves.toBe('independent-local-write');
  let drained = false; const fence = fenceAccountWrites(id.owner).then(() => { drained = true; });
  expect(ownerWorkEvidence(id.owner).pending).toBeGreaterThan(0);
  response.resolve(); await cleanupStarted.promise; expect(drained).toBe(false);
  cleanup.resolve(); await rejected; await fence;
  expect(f.saveVerified).not.toHaveBeenCalled(); expect(ownerWorkEvidence(id.owner).pending).toBe(0);
});
