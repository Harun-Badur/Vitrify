import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FS from 'expo-file-system/legacy';
import { createWardrobeCutout, uploadWardrobeCutout, wardrobeCutoutConfigured } from '../services/wardrobeCutoutService';
import { resetAccountWriteFenceMemoryForTests, fenceAccountWrites } from '../lib/accountWriteFence';
import { ownerWorkEvidence, resetDeviceWorkForTests, setDeviceSessionOwner } from '../lib/accountDeviceWork';
import { providerDeviceJournalPrefix } from '../services/providerDeviceJournal';
import { uploadAccountStorage } from '../services/accountStorageUpload';

const mockProcess = jest.fn();
const mockWrite = jest.fn();
const mockRelease = jest.fn(async () => {});
const mockAvailable = jest.fn(() => true);
const mockFiles = new Map<string, number>();
const mockGetModule = jest.fn((_name?: string) => ({ process: mockProcess, write: mockWrite, release: mockRelease, isAvailable: mockAvailable }));
jest.mock('react-native', () => ({ Platform: { OS: 'android', select: (v: {android?: unknown}) => v.android } }));
jest.mock('expo-modules-core', () => ({ requireOptionalNativeModule: (name: string) => mockGetModule(name) }));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/', EncodingType: { Base64: 'base64' },
  makeDirectoryAsync: jest.fn(async () => {}), createUploadTask: jest.fn(),
  writeAsStringAsync: jest.fn(),
  getInfoAsync: jest.fn(async (uri: string) => ({ exists: mockFiles.has(uri), size: mockFiles.get(uri), isDirectory: false })),
  readAsStringAsync: jest.fn(async () => 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg=='),
}));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: {JPEG: 'jpeg'} }));
jest.mock('../lib/supabase', () => ({ getRequiredSupabaseClient: () => ({
  auth: { getSession: async () => ({ data: { session: { user: {id: 'owner'}, access_token: 'fixture' } } }) },
  storage: { from: () => ({ createSignedUrl: async () => ({data: {signedUrl: 'https://fixture.invalid/result'}, error: null}) }) },
}) }));
jest.mock('../services/accountStorageUpload', () => ({
  accountStorageUploadInventory: async () => ({keys: []}),
  storageUploadJournalPrefix: () => 'fixture.', reconcileAccountStorageUpload: jest.fn(),
  uploadAccountStorage: jest.fn(async () => {}),
}));
const item = { id: 'item', title: 'Fixture', brand: '', category: 'upper_body' as const,
  imageUrl: 'file:///documents/wardrobe/owner/original.png', createdAt: '2026-10-21' };
const originalFlag = process.env.EXPO_PUBLIC_WARDROBE_ON_DEVICE_CUTOUT;
beforeEach(async () => {
  await AsyncStorage.clear(); resetDeviceWorkForTests(); resetAccountWriteFenceMemoryForTests();
  jest.clearAllMocks(); mockFiles.clear(); setDeviceSessionOwner('owner');
  delete process.env.EXPO_PUBLIC_WARDROBE_CUTOUT_URL;
  process.env.EXPO_PUBLIC_WARDROBE_ON_DEVICE_CUTOUT = 'true';
  mockAvailable.mockReturnValue(true);
  mockProcess.mockResolvedValue({handle: 'fixture-handle', preprocessingMs: 3, inferenceMs: 4,
    pngEncodeMs: 2, totalMs: 12, modelLoadMs: 3, sampledPssMaxKb: 100});
  mockWrite.mockImplementation(async (_handle: string, uri: string) => { mockFiles.set(uri, 100); return {bytes: 100}; });
});
afterEach(() => {
  if (originalFlag === undefined) delete process.env.EXPO_PUBLIC_WARDROBE_ON_DEVICE_CUTOUT;
  else process.env.EXPO_PUBLIC_WARDROBE_ON_DEVICE_CUTOUT = originalFlag;
});

it('defaults OFF and does not load a native module merely to check configuration', () => {
  delete process.env.EXPO_PUBLIC_WARDROBE_ON_DEVICE_CUTOUT;
  expect(wardrobeCutoutConfigured()).toBe(false); expect(mockGetModule).not.toHaveBeenCalled();
});
it('runs locally despite legacy HTTP UNKNOWN, writes an owned PNG, then uses the existing safe Storage writer', async () => {
  const key = providerDeviceJournalPrefix('owner') + 'wardrobe-cutout.legacy';
  const legacy = JSON.stringify({owner: 'owner', provider: 'wardrobe-cutout', request: 'legacy', state: 'UNKNOWN'});
  await AsyncStorage.setItem(key, legacy);
  const uri = await createWardrobeCutout('owner', item);
  expect(uri).toMatch(/^file:\/\/\/documents\/wardrobe\/owner\/.+-cutout\.png$/);
  expect(mockProcess).toHaveBeenCalledWith(item.imageUrl, true);
  expect(mockWrite).toHaveBeenCalledWith('fixture-handle', uri);
  expect(mockRelease).toHaveBeenCalledWith('fixture-handle');
  expect(FS.createUploadTask).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(key)).toBe(legacy);
  await uploadWardrobeCutout('owner', {...item, cutoutLocalUri: uri});
  expect(uploadAccountStorage).toHaveBeenCalledWith(expect.objectContaining({owner: 'owner', bucket: 'wardrobe-cutouts', contentType: 'image/png', body: expect.any(ArrayBuffer)}));
});
it('fails closed without native support and never falls back to HTTP', async () => {
  mockAvailable.mockReturnValue(false);
  process.env.EXPO_PUBLIC_WARDROBE_CUTOUT_URL = 'https://fixture.invalid/v1/wardrobe/cutout';
  await expect(createWardrobeCutout('owner', item)).rejects.toMatchObject({code: 'CUTOUT_NATIVE_UNAVAILABLE'});
  expect(mockProcess).not.toHaveBeenCalled(); expect(FS.createUploadTask).not.toHaveBeenCalled();
});
it('discards a result after A to B to A without publishing a file and releases native memory', async () => {
  mockProcess.mockImplementationOnce(async () => {
    setDeviceSessionOwner('other'); setDeviceSessionOwner('owner');
    return {handle: 'late'};
  });
  await expect(createWardrobeCutout('owner', item)).rejects.toThrow();
  expect(mockWrite).not.toHaveBeenCalled(); expect(mockRelease).toHaveBeenCalledWith('late');
});
it('deletion waits for native completion and memory release, with no late file write', async () => {
  let finish!: (value: {handle: string}) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  mockProcess.mockImplementationOnce(() => { entered(); return new Promise(resolve => {finish = resolve;}); });
  const result = createWardrobeCutout('owner', item).catch(() => undefined);
  await started;
  let drained = false;
  const drain = fenceAccountWrites('owner').then(() => {drained = true;});
  await Promise.resolve(); expect(drained).toBe(false);
  finish({handle: 'fenced'}); await result; await drain;
  expect(mockWrite).not.toHaveBeenCalled(); expect(mockRelease).toHaveBeenCalledWith('fenced');
  expect(ownerWorkEvidence('owner').pending).toBe(0);
});
it('rejects a foreign source before native processing', async () => {
  await expect(createWardrobeCutout('owner', {...item, imageUrl: 'file:///documents/wardrobe/other/photo.png'})).rejects.toThrow();
  expect(mockProcess).not.toHaveBeenCalled();
});
it('retains an owned CREATING checkpoint if native file writing fails and releases memory', async () => {
  mockWrite.mockRejectedValueOnce(new Error('fixture-write-failed'));
  await expect(createWardrobeCutout('owner', item)).rejects.toThrow();
  expect(mockRelease).toHaveBeenCalledWith('fixture-handle');
  const ledger = JSON.parse((await AsyncStorage.getItem('vitrify.owned-files.v1.owner'))!);
  expect(ledger.intents).toEqual([expect.objectContaining({kind: 'cutout', state: 'CREATING'})]);
});
