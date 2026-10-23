import { readFileSync } from 'node:fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { uploadAccountStorage } from '../services/accountStorageUpload';
import { runAdmittedStorageUpload, type StorageAdmissionPort, type ProviderOutcome } from '../supabase/functions/_shared/accountStorageAdmission';
import { deletionStorageAdapter } from '../supabase/functions/_shared/accountDeletionStorage';
import { createDeletionReceipt, runDeletionFoundation, DELETION_LAYERS } from '../supabase/functions/_shared/accountDeletionFoundation';

let mockClient: any;
jest.mock('../lib/supabase', () => ({ getRequiredSupabaseClient: () => mockClient }));
const input = { owner: 'A', bucket: 'model-photos' as const, path: 'A/model.jpg', body: new ArrayBuffer(1), contentType: 'image/jpeg' };
beforeEach(async () => { await AsyncStorage.clear(); mockClient = { auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'A' } }, error: null })) },
  functions: { invoke: jest.fn(async () => ({ data: null, error: new Error('not installed') })) }, storage: { from: jest.fn() } }; });

describe('application upload bypass closure', () => {
  it('missing server admission rejects before any physical Storage call', async () => {
    await expect(uploadAccountStorage(input)).rejects.toMatchObject({ code: 'STORAGE_UPLOAD_UNCONFIRMED' });
    expect(mockClient.storage.from).not.toHaveBeenCalled();
    expect(mockClient.functions.invoke).toHaveBeenCalledWith('account-storage-upload', expect.objectContaining({ body: input.body }));
  });
  it('foreign owner/path rejects without admission', async () => {
    await expect(uploadAccountStorage({ ...input, path: 'B/model.jpg' })).rejects.toMatchObject({ code: 'STORAGE_OWNER_PATH_INVALID' });
    expect(mockClient.functions.invoke).not.toHaveBeenCalled();
  });
  it('session changed to B cannot admit an A upload', async () => {
    mockClient.auth.getUser.mockResolvedValue({ data: { user: { id: 'B' } }, error: null });
    await expect(uploadAccountStorage(input)).rejects.toMatchObject({ code: 'STORAGE_OWNER_UNVERIFIED' });
    expect(mockClient.functions.invoke).not.toHaveBeenCalled();
  });
  it('an admission-only response cannot become client success or direct transport', async () => {
    mockClient.functions.invoke.mockResolvedValue({ data: { operation: 'op-A', state: 'ADMITTED' }, error: null });
    await expect(uploadAccountStorage(input)).rejects.toMatchObject({ code: 'STORAGE_UPLOAD_UNCONFIRMED' });
    expect(mockClient.functions.invoke).toHaveBeenCalledTimes(1);
    expect(mockClient.storage.from).not.toHaveBeenCalled();
  });
  it('server transport failure never produces client completion or fallback bytes', async () => {
    mockClient.functions.invoke.mockRejectedValueOnce(new Error('disconnect'));
    await expect(uploadAccountStorage(input)).rejects.toMatchObject({ code: 'STORAGE_UPLOAD_UNCONFIRMED' });
    expect(mockClient.storage.from).not.toHaveBeenCalled();
  });
  it('both former bypass sources bind to the shared flow', async () => {
    const profile = readFileSync('services/profileService.ts', 'utf8');
    const cutout = readFileSync('services/wardrobeCutoutService.ts', 'utf8');
    expect(profile).not.toMatch(/XMLHttpRequest|storage\/v1\/object/);
    expect(cutout).not.toMatch(/bucket\.upload\(/);
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
    jest.doMock('../lib/personPhotoPrepare', () => ({
      withPreparedPersonJpeg: async (_owner: string, uri: string, consume: (uri: string) => Promise<unknown>) => consume(uri),
    }));
    jest.doMock('expo-file-system/legacy', () => ({
      cacheDirectory: 'file:///cache/', EncodingType: { Base64: 'base64' }, readAsStringAsync: jest.fn(async () => png),
    }));
    const photo = { size: 3, type: 'image/jpeg' } as Blob;
    let restoreFetch = () => {};
    const directUpload = jest.fn(), signed = jest.fn();
    mockClient.auth.getSession = jest.fn(async () => ({ data: { session: { user: { id: 'A' }, access_token: 'fixture-token' } }, error: null }));
    mockClient.storage.from.mockReturnValue({ upload: directUpload, createSignedUrl: signed });
    try {
      await jest.isolateModulesAsync(async () => {
        const fence = require('../lib/accountWriteFence') as typeof import('../lib/accountWriteFence');
        const work = require('../lib/accountDeviceWork') as typeof import('../lib/accountDeviceWork');
        fence.resetAccountWriteFenceMemoryForTests(); work.resetDeviceWorkForTests();
        const shared = require('../services/accountStorageUpload') as typeof import('../services/accountStorageUpload');
        const denied = new Error('controlled admission failure');
        const upload = jest.spyOn(shared, 'uploadAccountStorage').mockRejectedValue(denied);
        const inventory = jest.spyOn(shared, 'accountStorageUploadInventory').mockResolvedValue({ keys: [], unresolved: [] });
        try {
          const profileService = require('../services/profileService') as typeof import('../services/profileService');
          const cutoutService = require('../services/wardrobeCutoutService') as typeof import('../services/wardrobeCutoutService');
          // Native preset initialization may install fetch during module loading.
          // Stub it afterwards so even the local file read is fully controlled.
          const localFetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ blob: async () => photo } as Response);
          restoreFetch = () => localFetch.mockRestore();
          const progress = jest.fn();
          await expect(profileService.uploadModelPhoto('A', 'file:///model.jpg', { onProgress: progress })).rejects.toBe(denied);
          await expect(cutoutService.uploadWardrobeCutout('A', { id: 'item', title: '', brand: '', category: 'upper_body', imageUrl: 'file:///original.jpg', createdAt: '', cutoutLocalUri: 'file:///cutout.png' })).rejects.toBe(denied);
          expect(upload).toHaveBeenCalledTimes(2);
          expect(upload).toHaveBeenNthCalledWith(1, { owner: 'A', bucket: 'model-photos', path: 'A/model.jpg', contentType: 'image/jpeg', body: photo });
          expect(upload).toHaveBeenNthCalledWith(2, { owner: 'A', bucket: 'wardrobe-cutouts', path: 'A/item/cutout.png', contentType: 'image/png', body: expect.any(ArrayBuffer) });
          const bytes = new Uint8Array(upload.mock.calls[1][0].body as ArrayBuffer);
          expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
          expect(localFetch).toHaveBeenCalledTimes(1); expect(localFetch).toHaveBeenCalledWith('file:///model.jpg');
          expect(progress).not.toHaveBeenCalledWith(1);
          expect(directUpload).not.toHaveBeenCalled(); expect(signed).not.toHaveBeenCalled();
          expect(mockClient.functions.invoke).not.toHaveBeenCalled();
        } finally { upload.mockRestore(); inventory.mockRestore(); }
      });
    } finally {
      restoreFetch();
      jest.dontMock('../lib/personPhotoPrepare'); jest.dontMock('expo-file-system/legacy');
    }
  });
});

// Controlled durable port, not a PostgreSQL or physical-provider attestation.
function fixture() {
  let fenced = false, expired = false, state = 'NONE';
  const operation = { operation: 'op-A', lease: 'opaque-lease', owner: 'A', bucket: 'model-photos', path: 'A/model.jpg' };
  const port: StorageAdmissionPort = {
    admit: jest.fn(async () => { if (fenced) throw new Error('fenced'); state = 'ADMITTED'; return operation; }),
    start: jest.fn(async () => { if (fenced) throw new Error('fenced'); state = 'UNKNOWN'; if (expired) throw new Error('expired'); return true; }),
    write: jest.fn(async () => ({ state: 'UNKNOWN' as const })),
    verifyTerminal: jest.fn(async () => false),
    terminal: jest.fn(async (_, terminal) => { state = terminal; }),
  };
  return { port, state: () => state, fence: () => { fenced = true; }, expire: () => { expired = true; } };
}
describe('trusted execution contract (controlled port only)', () => {
  it('false dispatch eligibility cannot start physical bytes', async () => {
    const f = fixture(); f.port.start = jest.fn(async () => false);
    await expect(runAdmittedStorageUpload(f.port, 'A', 'model-photos', 'A/model.jpg')).rejects.toThrow('STORAGE_DISPATCH_DENIED');
    expect(f.port.write).not.toHaveBeenCalled();
  });
  it('fence rejects a new admission before bytes', async () => {
    const f = fixture(); f.fence();
    await expect(runAdmittedStorageUpload(f.port, 'A', 'model-photos', 'A/model.jpg')).rejects.toThrow('fenced');
    expect(f.port.write).not.toHaveBeenCalled();
  });
  it('fence between admission and dispatch blocks the delayed writer', async () => {
    const f = fixture(); const admit = f.port.admit;
    f.port.admit = async (...args) => { const op = await admit(...args); f.fence(); return op; };
    await expect(runAdmittedStorageUpload(f.port, 'A', 'model-photos', 'A/model.jpg')).rejects.toThrow('fenced');
    expect(f.state()).toBe('ADMITTED'); expect(f.port.write).not.toHaveBeenCalled();
  });
  it.each(['timeout', 'disconnect', 'client abort', 'process lost'])('%s leaves UNKNOWN, never terminal', async error => {
    const f = fixture(); f.port.write = jest.fn(async () => { throw new Error(error); });
    await expect(runAdmittedStorageUpload(f.port, 'A', 'model-photos', 'A/model.jpg')).rejects.toThrow(error);
    expect(f.state()).toBe('UNKNOWN'); expect(f.port.terminal).not.toHaveBeenCalled();
  });
  it('lease expiry does not produce completion or dispatch', async () => {
    const f = fixture(); f.expire();
    await expect(runAdmittedStorageUpload(f.port, 'A', 'model-photos', 'A/model.jpg')).rejects.toThrow('expired');
    expect(f.state()).toBe('UNKNOWN'); expect(f.port.write).not.toHaveBeenCalled();
  });
  it('in-flight upload remains UNKNOWN across deletion and a late ambiguous response', async () => {
    const f = fixture(); let finish!: (value: ProviderOutcome) => void;
    f.port.write = jest.fn(() => new Promise(resolve => { finish = resolve; }));
    const running = runAdmittedStorageUpload(f.port, 'A', 'model-photos', 'A/model.jpg');
    // Advance only promise microtasks, no timer or fake completion evidence.
    await Promise.resolve(); await Promise.resolve();
    f.fence(); expect(f.state()).toBe('UNKNOWN');
    finish({ state: 'UNKNOWN' });
    await expect(running).rejects.toThrow('STORAGE_TERMINAL_UNVERIFIED');
    expect(f.port.terminal).not.toHaveBeenCalled();
  });
  it('unverified provider response cannot close an operation', async () => {
    const f = fixture(); f.port.write = jest.fn(async () => ({ state: 'COMMITTED' as const, proof: 'response-only' }));
    await expect(runAdmittedStorageUpload(f.port, 'A', 'model-photos', 'A/model.jpg')).rejects.toThrow('STORAGE_TERMINAL_UNVERIFIED');
    expect(f.state()).toBe('UNKNOWN');
  });
  it('foreign admission identity cannot dispatch A bytes under B operation', async () => {
    const f = fixture(); const admit = f.port.admit;
    f.port.admit = async (...args) => ({ ...await admit(...args), owner: 'B' });
    await expect(runAdmittedStorageUpload(f.port, 'A', 'model-photos', 'A/model.jpg')).rejects.toThrow('STORAGE_ADMISSION_IDENTITY_MISMATCH');
    expect(f.port.start).not.toHaveBeenCalled(); expect(f.port.write).not.toHaveBeenCalled();
  });
  it('failed durable terminal checkpoint leaves UNKNOWN even after a verified response', async () => {
    const f = fixture(); f.port.write = jest.fn(async () => ({ state: 'COMMITTED' as const, proof: 'controlled proof' }));
    f.port.verifyTerminal = jest.fn(async () => true);
    f.port.terminal = jest.fn(async () => { throw new Error('checkpoint failed'); });
    await expect(runAdmittedStorageUpload(f.port, 'A', 'model-photos', 'A/model.jpg')).rejects.toThrow('checkpoint failed');
    expect(f.state()).toBe('UNKNOWN');
  });
  it.each(['COMMITTED', 'REJECTED_BEFORE_WRITE'] as const)('verified %s has a distinct terminal outcome in the contract', async state => {
    const f = fixture(); f.port.write = jest.fn(async () => ({ state, proof: 'controlled provider proof' }));
    f.port.verifyTerminal = jest.fn(async () => true);
    if (state === 'COMMITTED') await runAdmittedStorageUpload(f.port, 'A', 'model-photos', 'A/model.jpg');
    else await expect(runAdmittedStorageUpload(f.port, 'A', 'model-photos', 'A/model.jpg')).rejects.toThrow('STORAGE_WRITE_REJECTED');
    expect(f.state()).toBe(state === 'COMMITTED' ? 'SUCCEEDED' : 'REJECTED');
  });
});

describe('deletion safety with outstanding writes and cleanup errors', () => {
  it.each(['unknown', 'list', 'remove'])('%s blocks Storage receipt and Auth-last', async failure => {
    const auth = jest.fn(async () => {});
    const storage = deletionStorageAdapter({ assertLease: async () => {}, barrier: async () => failure !== 'unknown',
      objects: async () => { if (failure === 'list') throw new Error('list failed'); return ['A/model.jpg']; },
      remove: async () => { throw new Error('remove failed'); } });
    const receipt = createDeletionReceipt('request-A', 'A');
    const adapters = Object.fromEntries(Object.keys(DELETION_LAYERS).map(layer => [layer,
      { idempotent: true as const, cleanup: layer === 'auth' ? auth : async () => {}, verify: async () => ({ complete: true, evidence: ['controlled proof'] }) }]));
    await runDeletionFoundation(receipt, { ...adapters, storage }, async () => {});
    expect(receipt.layers.storage.state).toBe('RETRY_REQUIRED');
    expect(receipt.layers.auth.state).toBe('BLOCKED'); expect(auth).not.toHaveBeenCalled();
  });
  it('cleanup stays in A prefixes and leaves B data untouched', async () => {
    const data = new Map([['model-photos', ['A/model.jpg', 'B/model.jpg']], ['wardrobe-cutouts', ['A/item/cutout.png', 'B/item/cutout.png']]]);
    const adapter = deletionStorageAdapter({ assertLease: async () => {}, barrier: async () => true,
      objects: async (bucket, owner) => data.get(bucket)!.filter(path => path.startsWith(owner + '/')),
      remove: async (bucket, paths) => { data.set(bucket, data.get(bucket)!.filter(path => !paths.includes(path))); } });
    await adapter.cleanup(createDeletionReceipt('request-A', 'A'));
    expect((await adapter.verify(createDeletionReceipt('request-A', 'A'))).complete).toBe(true);
    expect([...data.values()].flat()).toEqual(['B/model.jpg', 'B/item/cutout.png']);
  });
  it('SQL draft cannot expire or client-close a terminal operation, and admission is disabled', () => {
    const sql = readFileSync('reports/backend/proposals/20261010_account_deletion_coordinator.sql', 'utf8');
    expect(sql).toContain("raise exception 'Trusted Storage transport unavailable'");
    expect(sql).toContain("perform deletion_private.lock_writer(who)");
    expect(sql).toContain("update deletion_private.storage_operations set state='UNKNOWN'");
    expect(sql).toContain('if op.expires_at<=clock_timestamp() then return false; end if;');
    expect(sql).not.toMatch(/set state='(?:SUCCEEDED|REJECTED)'/);
    expect(sql).toContain('as $$ select false $$;');
  });
});
