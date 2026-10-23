import AsyncStorage from '@react-native-async-storage/async-storage';
import { accountStorageUploadInventory, reconcileAccountStorageUpload, storageUploadJournalPrefix, uploadAccountStorage } from '../services/accountStorageUpload';
import { recordWardrobeNetworkFailure } from '../lib/wardrobeNetworkDiagnostics';
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const path = `${owner}/item/cutout.png`;
const mockInvoke = jest.fn();
jest.mock('../lib/supabase', () => ({ getRequiredSupabaseClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }, error: null }) }, functions: { invoke: mockInvoke } }) }));
jest.mock('../lib/analytics', () => ({ createUuid: () => 'request-1' }));
const key = storageUploadJournalPrefix(owner) + encodeURIComponent('wardrobe-cutouts/' + path);
const intent = { owner, bucket: 'wardrobe-cutouts', path, request: 'request-1', state: 'UNKNOWN' };
let log: jest.SpyInstance;
beforeEach(async () => { await AsyncStorage.clear(); mockInvoke.mockReset(); log = jest.spyOn(console, 'info').mockImplementation(() => {}); });
afterEach(() => { log.mockRestore(); });

it('diagnoses malformed local inventory without a network call, leaking bytes, or changing the journal', async () => {
  await AsyncStorage.setItem(key, 'private-invalid-json');
  await expect(accountStorageUploadInventory(owner)).rejects.toThrow();
  expect(mockInvoke).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(key)).toBe('private-invalid-json');
  expect(log.mock.calls).toContainEqual([JSON.stringify({ type: 'wardrobe_network_failure', stage: 'storageCheck', code: 'INVENTORY_READ_FAILED', transport: 'unknown', httpStatus: null })]);
  expect(JSON.stringify(log.mock.calls)).not.toContain('private');
});

it('reports the SDK HTTP status for reconciliation without reading the response body or replaying UNKNOWN', async () => {
  await AsyncStorage.setItem(key, JSON.stringify(intent));
  const json = jest.fn();
  mockInvoke.mockResolvedValue({ data: null, error: { name: 'FunctionsHttpError', context: { status: 503, json, body: 'private-token' } } });
  await expect(reconcileAccountStorageUpload({ owner, bucket: 'wardrobe-cutouts', path })).rejects.toMatchObject({ code: 'STORAGE_RECONCILIATION_UNAVAILABLE' });
  expect(log.mock.calls).toContainEqual([JSON.stringify({ type: 'wardrobe_network_failure', stage: 'storageCheck', code: 'STORAGE_RECONCILIATION_UNAVAILABLE', transport: 'http', httpStatus: 503 })]);
  expect(mockInvoke).toHaveBeenCalledTimes(1); expect(json).not.toHaveBeenCalled();
  expect(JSON.parse((await AsyncStorage.getItem(key))!).state).toBe('UNKNOWN');
  expect(JSON.stringify(log.mock.calls)).not.toContain('private');
});

it('reports upload HTTP rejection while retaining UNKNOWN and refusing blind replay', async () => {
  mockInvoke.mockResolvedValue({ data: null, error: { name: 'FunctionsHttpError', context: { status: 401, body: 'private-photo' } } });
  const input = { owner, bucket: 'wardrobe-cutouts' as const, path, contentType: 'image/png', body: new ArrayBuffer(8) };
  await expect(uploadAccountStorage(input)).rejects.toMatchObject({ code: 'STORAGE_UPLOAD_UNCONFIRMED' });
  expect(log.mock.calls).toContainEqual([JSON.stringify({ type: 'wardrobe_network_failure', stage: 'upload', code: 'STORAGE_UPLOAD_UNCONFIRMED', transport: 'http', httpStatus: 401 })]);
  await expect(uploadAccountStorage(input)).rejects.toMatchObject({ code: 'STORAGE_UPLOAD_UNRESOLVED' });
  expect(mockInvoke).toHaveBeenCalledTimes(1);
  expect(JSON.parse((await AsyncStorage.getItem(key))!).state).toBe('UNKNOWN');
  expect(JSON.stringify(log.mock.calls)).not.toContain('private');
});

it('uses a fixed fallback for arbitrary codes and never logs an error body or unverified status', () => {
  recordWardrobeNetworkFailure('upload', { code: 'private-arbitrary-code', message: 'private-message', context: { status: 401, body: 'private-photo' } }, 'UPLOAD_FAILED');
  expect(log.mock.calls).toEqual([[JSON.stringify({ type: 'wardrobe_network_failure', stage: 'upload', code: 'UPLOAD_FAILED', transport: 'unknown', httpStatus: null })]]);
});

it('does not emit network diagnostics outside development', () => {
  const runtime = globalThis as unknown as { __DEV__: boolean }, previous = runtime.__DEV__;
  try { runtime.__DEV__ = false; recordWardrobeNetworkFailure('upload', new Error('private'), 'UPLOAD_FAILED'); expect(log).not.toHaveBeenCalled(); }
  finally { runtime.__DEV__ = previous; }
});
