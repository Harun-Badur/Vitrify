import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAccountDeletionRuntime } from '../services/accountDeletionRuntime';
import { accountDeletionCheckpointKey, deleteAccount } from '../services/accountService';
import { resetAnalyticsForTests } from '../lib/analytics';
import { resetAccountWriteFenceMemoryForTests } from '../lib/accountWriteFence';
import { resetDeviceWorkForTests, ownerWorkEvidence } from '../lib/accountDeviceWork';
import * as uploads from '../services/accountStorageUpload';
import * as providers from '../services/providerDeviceJournal';

jest.mock('expo-file-system/legacy', () => ({ cacheDirectory: 'file:///cache/', documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn(async () => ({ exists: false })), readDirectoryAsync: jest.fn(async () => []), deleteAsync: jest.fn(async () => {}) }));
jest.mock('../lib/supabase', () => ({ getRequiredSupabaseClient: () => ({ auth: {
  getSession: async () => ({ data: { session: { access_token: 'fake', user: { id: 'A' } } }, error: null }),
} }), getSupabaseClient: () => null }));

let originalFetch: typeof fetch;
beforeEach(async () => {
  originalFetch = global.fetch;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: require('node:crypto').webcrypto });
  await resetAnalyticsForTests(); await AsyncStorage.clear(); resetAccountWriteFenceMemoryForTests(); resetDeviceWorkForTests();
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://fake.invalid';
});
afterEach(() => { jest.restoreAllMocks(); global.fetch = originalFetch; delete process.env.EXPO_PUBLIC_SUPABASE_URL; });

export function fakeServer() {
  const fetchMock = jest.fn(async (_url: unknown, options: { method: string; body?: string }) => {
    if (options.method === 'GET') return { ok: true, json: async () => ({ protocol: 'vitrify.deletion.v1', ready: true, postAuthRecovery: true }) };
    const body = JSON.parse(options.body!), receipt = body.deviceCheckpoint;
    for (const layer of ['write_fence','storage','jobs_payload','db','recommendation_cache','auth']) {
      receipt.layers[layer] = { state: 'VERIFIED', attempts: 1, evidence: ['fake absence'] };
    }
    return { ok: true, json: async () => ({ protocol: 'vitrify.deletion.v1', receipt }) };
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

it('step 1: no real blocker gives coverage; actual fence/drain/device proofs are required before POST', async () => {
  const fetchMock = fakeServer(), runtime = await createAccountDeletionRuntime('A', async () => true);
  expect(runtime.inventory.coverageVerified).toBe(true);
  expect(runtime.inventory.blockers).toEqual([]);
  await deleteAccount(runtime);
  const post = fetchMock.mock.calls.find(([, options]) => options.method === 'POST');
  expect(post).toBeDefined();
  const saved = JSON.parse((await AsyncStorage.getItem(accountDeletionCheckpointKey('A')))!);
  for (const layer of ['queue','async_storage','local_files','memory_cache']) expect(saved.layers[layer].state).toBe('VERIFIED');
  expect(ownerWorkEvidence('A')).toEqual({ fenced: true, pending: 0, nonempty: 0 });
});

it('step 1: failed actual memory/device verification still blocks POST', async () => {
  const fetchMock = fakeServer(), runtime = await createAccountDeletionRuntime('A', async () => false);
  expect(runtime.inventory.coverageVerified).toBe(true);
  await expect(deleteAccount(runtime)).rejects.toThrow('Yerel hesap temizliği');
  expect(fetchMock.mock.calls.map(([, options]) => options.method)).toEqual(['GET']);
});

it('step 2: UNKNOWN upload cannot block POST or completion and its journal is untouched', async () => {
  const fetchMock = fakeServer();
  const key = uploads.storageUploadJournalPrefix('A') + encodeURIComponent('model-photos/A/model.jpg');
  const journal = JSON.stringify({ owner:'A',bucket:'model-photos',path:'A/model.jpg',request:'upload-A',state:'UNKNOWN' });
  await AsyncStorage.setItem(key,journal);
  const runtime=await createAccountDeletionRuntime('A',async()=>true);
  expect(runtime.inventory.coverageVerified).toBe(true);
  await expect(deleteAccount(runtime)).resolves.toBeUndefined();
  expect(fetchMock.mock.calls.some(([,options])=>options.method==='POST')).toBe(true);
  const receipt=JSON.parse((await AsyncStorage.getItem(accountDeletionCheckpointKey('A')))!);
  expect(receipt.layers.vendor.evidence).toContain('UNKNOWN yüklemeler sweep ile silinir');
  expect(await AsyncStorage.getItem(key)).toBe(journal);
});

it('step 2: provider retention/UNKNOWN information is a declaration, not a deletion prerequisite', async () => {
  fakeServer();
  const key=providers.providerDeviceJournalPrefix('A')+'fashn.request-A';
  const journal=JSON.stringify({owner:'A',provider:'fashn',request:'request-A',state:'UNKNOWN'});
  await AsyncStorage.setItem(key,journal);
  const runtime=await createAccountDeletionRuntime('A',async()=>true);
  expect(runtime.inventory.coverageVerified).toBe(true);
  await expect(deleteAccount(runtime)).resolves.toBeUndefined();
  const receipt=JSON.parse((await AsyncStorage.getItem(accountDeletionCheckpointKey('A')))!);
  expect(receipt.layers.vendor.state).toBe('UNKNOWN');
  expect(receipt.layers.vendor.evidence).toContain('sağlayıcı: politika gereği, doğrulanmadı');
  expect(await AsyncStorage.getItem(key)).toBe(journal);
});

it('step 2: deletion never calls UNKNOWN admission, inventory, reconciliation or journal cleanup', async () => {
  fakeServer();
  const spies = [jest.spyOn(uploads,'accountStorageUploadInventory'),jest.spyOn(uploads,'clearCompletedStorageUploadJournal'),
    jest.spyOn(uploads,'reconcileAccountStorageUpload'),jest.spyOn(uploads,'uploadAccountStorage'),jest.spyOn(providers,'providerDeviceInventory')];
  for (const spy of spies) spy.mockImplementation((async()=>{throw new Error('Upload/provider protocol must not be a deletion gate');}) as never);
  await expect(deleteAccount(await createAccountDeletionRuntime('A',async()=>true))).resolves.toBeUndefined();
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
});
