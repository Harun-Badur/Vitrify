import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fenceAccountWrites, resetAccountWriteFenceMemoryForTests, withAccountWriteGuard } from '../lib/accountWriteFence';
import { fenceOwnerMemory, ownerWorkEvidence, resetDeviceWorkForTests, setDeviceSessionOwner } from '../lib/accountDeviceWork';
import { providerDeviceInventory, providerDeviceJournalPrefix } from '../services/providerDeviceJournal';
import { manipulateAsync } from 'expo-image-manipulator';
import type { StoreApi } from 'zustand';
import {
  wardrobeImage,
  wardrobeProduct,
  type WardrobeItem,
} from '../types/wardrobe';
import { createWardrobeSlice } from '../store/wardrobeSlice';
import type { AppState } from '../store/useAppStore';
import {
  createWardrobeCutout,
  uploadWardrobeCutout,
} from '../services/wardrobeCutoutService';
import { loadWardrobe, saveWardrobe, saveWardrobeCutoutCheckpoint, type WardrobeData } from '../services/wardrobeService';
import { getProductImages } from '../types/product';
import * as uploadRecovery from '../services/accountStorageUpload';
import { logger } from '../lib/logger';
import { accountStorageUploadMimeHeader } from '../lib/accountStorageUploadFetch';

const mockUpload = jest.fn().mockResolvedValue({ error: null });
const mockInvoke = jest.fn(async (_name: string, options: { headers: Record<string, string> }) => ({ error: null,
  data: { protocol: 'vitrify.storage-upload.v1', state: 'SUCCEEDED', operation: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    owner: 'owner', bucket: options.headers['x-upload-bucket'], path: options.headers['x-upload-path'] } }));
const mockFiles = new Set<string>();
const mockSigned = jest.fn().mockResolvedValue({
  data: { signedUrl: 'https://storage/cutout.png?token=signed' },
  error: null,
});
const mockSession = jest.fn().mockResolvedValue({
  data: { session: { user: { id: 'owner' }, access_token: 'token' } },
  error: null,
});
const mockTaskUpload = jest.fn();
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  cacheDirectory: 'file:///cache/',
  FileSystemUploadType: { BINARY_CONTENT: 0 },
  EncodingType: { Base64: 'base64' },
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
  writeAsStringAsync: jest.fn(async (uri: string) => { mockFiles.add(uri); }),
  readAsStringAsync: jest.fn(() => Promise.resolve(png)),
  deleteAsync: jest.fn(async (uri: string) => { mockFiles.delete(uri); }),
  getInfoAsync: jest.fn(async (uri: string) => ({ exists: mockFiles.has(uri), isDirectory: false })),
  createUploadTask: jest.fn(() => ({
    uploadAsync: mockTaskUpload,
    cancelAsync: jest.fn(),
  })),
}));
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  manipulateAsync: jest
    .fn()
    .mockImplementation(async () => { const uri = 'file:///cache/ImageManipulator/normalized.jpg'; mockFiles.add(uri); return { uri }; }),
}));
jest.mock('../lib/supabase', () => ({
  getSupabaseClient: () => null,
  getRequiredSupabaseClient: () => ({
    auth: { getSession: mockSession, getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }) },
    functions: { invoke: mockInvoke },
    storage: {
      from: () => ({ upload: mockUpload, createSignedUrl: mockSigned }),
    },
  }),
}));
jest.mock('../lib/logger', () => ({ logger: { warn: jest.fn() } }));
jest.mock('../services/wardrobeService', () => ({
  storeWardrobePhoto: jest
    .fn()
    .mockResolvedValue('file:///documents/original.jpg'),
  saveWardrobe: jest.fn(async (_owner: string, data: WardrobeData) => ({ ...data, wardrobeSync: { state: 'synced', pending: 0 } })),
  loadWardrobe: jest.fn(),
  saveWardrobeCutoutCheckpoint: jest.fn(async () => true),
}));
jest.mock('../services/wardrobeCutoutService', () => ({
  ...jest.requireActual('../services/wardrobeCutoutService'),
  createWardrobeCutout: jest.fn(),
  uploadWardrobeCutout: jest.fn(),
  wardrobeCutoutConfigured: () => true,
}));
const actual = jest.requireActual<
  typeof import('../services/wardrobeCutoutService')
>('../services/wardrobeCutoutService');
const item: WardrobeItem = {
  id: 'owned',
  title: 'Gömlek',
  brand: '',
  category: 'upper_body',
  imageUrl: 'file:///original.jpg',
  createdAt: '2026-09-30',
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function store() {
  const state = {
    sessionUserId: 'owner',
    wardrobeSync: { state: 'synced', pending: 0 },
    wardrobeItems: [],
    savedOutfits: [],
    wardrobeStatus: 'ready',
  } as unknown as AppState;
  Object.assign(
    state,
    createWardrobeSlice(
      (patch) =>
        Object.assign(
          state,
          typeof patch === 'function' ? patch(state) : patch,
        ),
      () => state,
      {} as StoreApi<AppState>,
    ),
  );
  state.wardrobeStatus = 'ready';
  return state;
}

beforeEach(async () => {
  await AsyncStorage.clear(); resetAccountWriteFenceMemoryForTests(); resetDeviceWorkForTests(); mockFiles.clear();
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_WARDROBE_CUTOUT_URL =
    'http://localhost:7010/v1/wardrobe/cutout';
  mockTaskUpload.mockResolvedValue({
    status: 200,
    body: JSON.stringify({ pngBase64: png }),
  });
  mockSession.mockResolvedValue({
    data: { session: { user: { id: 'owner' }, access_token: 'token' } },
    error: null,
  });
  jest
    .mocked(createWardrobeCutout)
    .mockResolvedValue('file:///documents/cutout.png');
  jest.mocked(uploadWardrobeCutout).mockResolvedValue({
    cutoutUrl: 'https://storage/cutout.png',
    cutoutStoragePath: 'owner/owned/cutout.png',
    cutoutUrlExpiresAt: Date.now() + 60000,
  });
});
afterAll(() => {
  delete process.env.EXPO_PUBLIC_WARDROBE_CUTOUT_URL;
});

describe('owned wardrobe cutout service', () => {
  it('preserves failed inference without an Expo warning, raw error log or automatic provider retry', async () => {
    const log = jest.spyOn(console, 'info').mockImplementation(() => {});
    try {
      jest.mocked(createWardrobeCutout).mockRejectedValueOnce(new Error('private-url-token-photo'));
      const state = store();
      await state.addWardrobeItem(item);
      await tick(); await tick();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(log.mock.calls).toContainEqual([JSON.stringify({ type: 'wardrobe_cutout_failure', stage: 'cutout', code: 'CUTOUT_SETUP_FAILED', httpStatus: null })]);
      expect(JSON.stringify(log.mock.calls)).not.toContain('private');
      expect(state.wardrobeItems[0].cutoutStatus).toBe('blocked');
      expect(state.wardrobeCutoutJobs).toEqual({});
      expect(createWardrobeCutout).toHaveBeenCalledTimes(1);
      expect(uploadWardrobeCutout).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
  it.each([401, 404, 413, 415, 422, 503])('reports only fixed diagnostics for provider HTTP %s and retains UNKNOWN', async status => {
    const log = jest.spyOn(console, 'info').mockImplementation(() => {});
    try {
      mockTaskUpload.mockResolvedValueOnce({ status, body: 'private-photo-and-token' });
      await expect(actual.createWardrobeCutout('owner', item)).rejects.toThrow();
      expect(log.mock.calls).toContainEqual([JSON.stringify({ type: 'wardrobe_network_failure', stage: 'cutoutProvider', code: 'CUTOUT_HTTP_REJECTED', transport: 'native', httpStatus: status })]);
      expect(log.mock.calls).toContainEqual([JSON.stringify({ type: 'wardrobe_cutout_failure', stage: 'cutoutProvider', code: 'CUTOUT_HTTP_REJECTED', httpStatus: status })]);
      expect((await providerDeviceInventory('owner')).unknown).toBe(1);
      expect(mockTaskUpload).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(log.mock.calls)).not.toContain('private');
    } finally { log.mockRestore(); }
  });

  it('distinguishes native transport rejection from an HTTP rejection without logging the native error', async () => {
    const log = jest.spyOn(console, 'info').mockImplementation(() => {});
    try {
      mockTaskUpload.mockRejectedValueOnce(new Error('private-native-url-token'));
      await expect(actual.createWardrobeCutout('owner', item)).rejects.toThrow();
      expect(log.mock.calls).toContainEqual([JSON.stringify({ type: 'wardrobe_network_failure', stage: 'cutoutProvider', code: 'CUTOUT_TRANSPORT_REJECTED', transport: 'native', httpStatus: null })]);
      expect(JSON.stringify(log.mock.calls)).not.toContain('private');
    } finally { log.mockRestore(); }
  });
  it('preserves legacy originals and prefers cutouts only in the wardrobe adapter', () => {
    expect(wardrobeImage(item)).toBe(item.imageUrl);
    const processed = {
      ...item,
      cutoutUrl: 'https://storage/cutout.png',
      cutoutLocalUri: 'file:///cutout.png',
    };
    expect(wardrobeImage(processed)).toBe(processed.cutoutUrl);
    expect(getProductImages(wardrobeProduct(processed))).toEqual([
      processed.cutoutUrl,
      processed.cutoutLocalUri,
      item.imageUrl,
    ]);
    expect(processed.imageUrl).toBe(item.imageUrl);
  });
  it('normalizes a separate copy, writes a PNG and removes only the temporary copy', async () => {
    const uri = await actual.createWardrobeCutout('owner', item);
    expect(manipulateAsync).toHaveBeenCalledWith(item.imageUrl, [], {
      format: 'jpeg',
      compress: 0.9,
    });
    expect(uri).toMatch(/-cutout\.png$/);
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(uri, png, {
      encoding: 'base64',
    });
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
      'file:///cache/ImageManipulator/normalized.jpg',
      { idempotent: true },
    );
  });
  it('rejects a different account before sending any photo', async () => {
    await expect(
      actual.createWardrobeCutout('another-user', item),
    ).rejects.toThrow('oturum');
    expect(manipulateAsync).not.toHaveBeenCalled();
  });
  it('uploads PNG bytes to the owner folder and signs a private URL', async () => {
    const result = await actual.uploadWardrobeCutout('owner', {
      ...item,
      cutoutLocalUri: 'file:///cutout.png',
    });
    expect(mockInvoke).toHaveBeenCalledWith('account-storage-upload', expect.objectContaining({
      body: expect.any(ArrayBuffer), headers: expect.objectContaining({
        [accountStorageUploadMimeHeader]: 'image/png', 'x-upload-path': 'owner/owned/cutout.png', 'x-upload-bucket': 'wardrobe-cutouts' }),
    }));
    expect(mockUpload).not.toHaveBeenCalled();
    expect(result.cutoutUrl).toContain('?token=signed');
    expect(mockSigned).toHaveBeenCalledWith('owner/owned/cutout.png', 604800);
    await actual.uploadWardrobeCutout('owner', { ...item, ...result });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('diagnoses checkpoint failure before provider dispatch without a warning', async () => {
    const log = jest.spyOn(console, 'info').mockImplementation(() => {});
    try {
      jest.mocked(saveWardrobeCutoutCheckpoint).mockRejectedValueOnce(new Error('private-checkpoint'));
      const state = store(); await state.addWardrobeItem(item); await tick(); await tick();
      expect(createWardrobeCutout).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(log.mock.calls).toContainEqual([JSON.stringify({ type: 'wardrobe_cutout_failure', stage: 'cutoutCheckpoint', code: 'CUTOUT_CHECKPOINT_FAILED', httpStatus: null })]);
      expect(JSON.stringify(log.mock.calls)).not.toContain('private');
    } finally { log.mockRestore(); }
  });

  it('treats a rejected signing response as a failed cutoutSign stage with safe HTTP metadata', async () => {
    const log = jest.spyOn(console, 'info').mockImplementation(() => {});
    try {
      mockSigned.mockResolvedValueOnce({ data: null, error: { name: 'StorageApiError', status: 403, message: 'private-url' } });
      await expect(actual.uploadWardrobeCutout('owner', { ...item, cutoutStoragePath: 'owner/owned/cutout.png' })).rejects.toThrow();
      expect(log.mock.calls).toContainEqual([JSON.stringify({ type: 'wardrobe_cutout_failure', stage: 'cutoutSign', code: 'CUTOUT_SIGN_FAILED', httpStatus: 403 })]);
      expect(JSON.stringify(log.mock.calls)).not.toContain('private');
    } finally { log.mockRestore(); }
  });
  it('rejects non-PNG processor responses', async () => {
    mockTaskUpload.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ pngBase64: 'bm90IGEgcG5n' }),
    });
    await expect(actual.createWardrobeCutout('owner', item)).rejects.toThrow(
      'PNG',
    );
    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
  });
  it('saves the original before inference and persists the cutout on the same item', async () => {
    const state = store();
    await state.addWardrobeItem(item);
    await tick();
    expect(saveWardrobe).toHaveBeenCalled();
    expect(state.wardrobeItems[0]).toMatchObject({
      imageUrl: 'file:///documents/original.jpg',
      cutoutLocalUri: 'file:///documents/cutout.png',
      cutoutStatus: 'ready',
    });
    expect(uploadWardrobeCutout).toHaveBeenCalledTimes(1);
  });
  it('keeps the original and local PNG and automatically recovers a transient Storage failure', async () => {
    jest
      .mocked(uploadWardrobeCutout)
      .mockRejectedValueOnce(new Error('offline'));
    const state = store();
    await state.addWardrobeItem(item);
    await tick();
    expect(state.wardrobeItems[0]).toMatchObject({
      imageUrl: 'file:///documents/original.jpg',
      cutoutLocalUri: 'file:///documents/cutout.png',
      cutoutStatus: 'ready',
    });
    expect(uploadWardrobeCutout).toHaveBeenCalledTimes(2);
    expect(createWardrobeCutout).toHaveBeenCalledTimes(1);
  });
  it('automatically recovers an existing local cutout without repeating inference or processing unknown legacy photos', async () => {
    const legacy = { ...item, id: 'legacy' };
    const retry = {
      ...item,
      cutoutLocalUri: 'file:///existing-cutout.png',
      cutoutStatus: 'error' as const,
    };
    jest.mocked(loadWardrobe).mockResolvedValueOnce({
      wardrobeItems: [legacy, retry],
      savedOutfits: [],
      wardrobeSync: { state: 'synced', pending: 0 },
    });
    const state = store();
    const favorites = (state.likedProducts = []);
    await state.hydrateWardrobe('owner');
    await tick();
    expect(createWardrobeCutout).not.toHaveBeenCalled();
    expect(uploadWardrobeCutout).toHaveBeenCalledTimes(1);
    expect(state.wardrobeItems[0]).toEqual(legacy);
    expect(state.wardrobeItems[1].cutoutStatus).toBe('ready');
    expect(state.likedProducts).toBe(favorites);
  });
  it('does not attach a result after the active account changes', async () => {
    let finish!: (uri: string) => void;
    jest.mocked(createWardrobeCutout).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const state = store();
    await state.addWardrobeItem(item);
    await tick();
    state.sessionUserId = 'other';
    state.wardrobeItems = [];
    finish('file:///documents/cutout.png');
    await tick();
    expect(state.wardrobeItems).toEqual([]);
    expect(uploadWardrobeCutout).not.toHaveBeenCalled();
  });

  it('resumes pending inference introduced by a later sync, not only initial hydration', async () => {
    const state = store();
    jest.mocked(loadWardrobe).mockResolvedValueOnce({ wardrobeItems: [{ ...item, cutoutStatus: 'pending' }], savedOutfits: [], wardrobeSync: { state: 'synced', pending: 0 } });
    await state.refreshWardrobe();
    await tick();
    expect(createWardrobeCutout).toHaveBeenCalledTimes(1);
    expect(state.wardrobeItems[0].cutoutStatus).toBe('ready');
  });

  it('does not replay an ambiguous provider call without a local cutout artifact', async () => {
    const state = store();
    state.wardrobeItems = [{ ...item, cutoutStatus: 'blocked' }];
    state.resumeWardrobeCutouts(); await tick();
    expect(createWardrobeCutout).not.toHaveBeenCalled();
    expect(uploadWardrobeCutout).not.toHaveBeenCalled();
  });

  it('coalesces repeated automatic resume events and retries an existing PNG without inference', async () => {
    const state = store();
    state.wardrobeItems = [{ ...item, cutoutStatus: 'blocked', cutoutLocalUri: 'file:///processed.png' }];
    state.resumeWardrobeCutouts(); state.resumeWardrobeCutouts(); await tick();
    expect(createWardrobeCutout).not.toHaveBeenCalled();
    expect(uploadWardrobeCutout).toHaveBeenCalledTimes(1);
    expect(state.wardrobeItems[0].cutoutStatus).toBe('ready');
  });

  it.each(['pending', 'conflict'] as const)('waits for a verified cloud commit after a %s local save', async status => {
    jest.mocked(saveWardrobe).mockResolvedValueOnce({ wardrobeItems: [{ ...item, id: 'request', cutoutStatus: 'pending' }], savedOutfits: [], wardrobeSync: { state: status, pending: 1 } });
    const state = store();
    await state.addWardrobeItem(item, { requestId: 'request' }); await tick();
    state.resumeWardrobeCutouts(); await tick();
    expect(createWardrobeCutout).not.toHaveBeenCalled();
    jest.mocked(loadWardrobe).mockResolvedValueOnce({ wardrobeItems: state.wardrobeItems, savedOutfits: [], wardrobeSync: { state: 'synced', pending: 0 } });
    await state.refreshWardrobe(); await tick();
    expect(createWardrobeCutout).toHaveBeenCalledTimes(1);
    expect(state.wardrobeItems[0].cutoutStatus).toBe('ready');
  });

  it('automatically retries a recoverable artifact once, then stops despite repeated focus/foreground events', async () => {
    jest.mocked(uploadWardrobeCutout).mockRejectedValue(new Error('network'));
    const state = store();
    await state.addWardrobeItem(item); await tick(); await tick();
    for (let i = 0; i < 5; i++) { state.resumeWardrobeCutouts(); await tick(); }
    expect(createWardrobeCutout).toHaveBeenCalledTimes(1);
    expect(uploadWardrobeCutout).toHaveBeenCalledTimes(2);
    expect(state.wardrobeCutoutJobs).toEqual({});
    expect(state.wardrobeItems[0].cutoutStatus).toBe('blocked');
    expect(state.wardrobeItems[0].imageUrl).toBe('file:///documents/original.jpg');
  });

  it('automatic Storage UNKNOWN recovery only reconciles and never resends bytes or re-enters inference', async () => {
    jest.mocked(uploadWardrobeCutout).mockImplementation(actual.uploadWardrobeCutout);
    mockInvoke.mockRejectedValueOnce(new Error('response lost'));
    const reconcile = jest.spyOn(uploadRecovery, 'reconcileAccountStorageUpload').mockResolvedValue('UNKNOWN');
    try {
      const state = store(); await state.addWardrobeItem(item); await tick(); await tick();
      for (let i = 0; i < 3; i++) { state.resumeWardrobeCutouts(); await tick(); }
      expect(createWardrobeCutout).toHaveBeenCalledTimes(1);
      expect(mockInvoke).toHaveBeenCalledTimes(1);
      expect(reconcile).toHaveBeenCalledTimes(1);
      expect(state.wardrobeItems[0].cutoutStatus).toBe('blocked');
      expect(state.wardrobeCutoutJobs).toEqual({});
    } finally { reconcile.mockRestore(); }
  });

  it('an UNKNOWN provider intent survives restart without dispatching a second paid request', async () => {
    await AsyncStorage.setItem(providerDeviceJournalPrefix('owner') + 'wardrobe-cutout.request-1', JSON.stringify({ owner: 'owner', provider: 'wardrobe-cutout', request: 'request-1', state: 'UNKNOWN' }));
    jest.mocked(createWardrobeCutout).mockImplementation(actual.createWardrobeCutout);
    jest.mocked(loadWardrobe).mockResolvedValueOnce({ wardrobeItems: [{ ...item, cutoutStatus: 'pending' }], savedOutfits: [], wardrobeSync: { state: 'synced', pending: 0 } });
    const first = store(); await first.hydrateWardrobe('owner'); await tick();
    expect(first.wardrobeItems[0].cutoutStatus).toBe('blocked');
    jest.mocked(loadWardrobe).mockResolvedValueOnce({ wardrobeItems: first.wardrobeItems, savedOutfits: [], wardrobeSync: { state: 'synced', pending: 0 } });
    const reopened = store(); await reopened.hydrateWardrobe('owner'); reopened.resumeWardrobeCutouts(); await tick();
    expect(mockTaskUpload).not.toHaveBeenCalled();
    expect(createWardrobeCutout).toHaveBeenCalledTimes(1);
    expect(reopened.wardrobeCutoutJobs).toEqual({});
    expect((await providerDeviceInventory('owner')).unknown).toBe(1);
  });


  it('uses an acknowledged cutout upload after a lost local completion without uploading bytes again', async () => {
    const value = { ...item, cutoutLocalUri: 'file:///cutout.png' };
    await actual.uploadWardrobeCutout('owner', value);
    await actual.uploadWardrobeCutout('owner', value);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('does not replay unresolved cutout bytes during recovery', async () => {
    const value = { ...item, cutoutLocalUri: 'file:///cutout.png' };
    mockInvoke.mockRejectedValueOnce(new Error('timeout'));
    await expect(actual.uploadWardrobeCutout('owner', value)).rejects.toThrow();
    const reconcile = jest.spyOn(uploadRecovery, 'reconcileAccountStorageUpload').mockResolvedValueOnce('UNKNOWN');
    try {
      await expect(actual.uploadWardrobeCutout('owner', value)).rejects.toThrow();
      expect(reconcile).toHaveBeenCalledTimes(1);
      expect(mockInvoke).toHaveBeenCalledTimes(1);
      expect(mockSigned).not.toHaveBeenCalled();
    } finally { reconcile.mockRestore(); }
  });


  it('admits a new wardrobe write while the provider response remains unresolved', async () => {
    let finish!: (value: { status: number; body: string }) => void;
    mockTaskUpload.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const inference = actual.createWardrobeCutout('owner', item);
    await tick();
    const copy = jest.fn(async () => undefined);
    const nextWrite = withAccountWriteGuard('owner', copy);
    const service = jest.requireActual<typeof import('../services/wardrobeService')>('../services/wardrobeService');
    let saved = false;
    const nextSave = service.saveWardrobe('owner', { wardrobeItems: [{ ...item, id: 'new-item' }], savedOutfits: [] }).then(result => { saved = true; return result; });
    await tick();
    try { expect(copy).toHaveBeenCalledTimes(1); expect(saved).toBe(true); }
    finally {
      finish({ status: 200, body: JSON.stringify({ pngBase64: png }) });
      await inference; await nextWrite; await nextSave;
    }
    expect((await nextSave).wardrobeItems[0].id).toBe('new-item');
    expect(copy).toHaveBeenCalledTimes(1);
  });

  it('never attaches a late result or dispatches a cutout upload after the account is fenced', async () => {
    let finish!: (uri: string) => void;
    jest.mocked(createWardrobeCutout).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const state = store();
    await state.addWardrobeItem(item);
    await tick();
    fenceOwnerMemory('owner');
    finish('file:///late-cutout.png');
    await tick();
    expect(uploadWardrobeCutout).not.toHaveBeenCalled();
    expect(state.wardrobeItems[0].cutoutLocalUri).toBeUndefined();
  });

  it('drains the actual pending provider and native cleanup after fencing, preserving UNKNOWN without a late file write', async () => {
    let finish!: (value: { status: number; body: string }) => void;
    mockTaskUpload.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const inference = actual.createWardrobeCutout('owner', item);
    const rejected = expect(inference).rejects.toThrow('deletion');
    await tick();
    let drained = false;
    const fence = fenceAccountWrites('owner').then(() => { drained = true; });
    await tick();
    expect(drained).toBe(false); expect(ownerWorkEvidence('owner').pending).toBeGreaterThan(0);
    finish({ status: 200, body: JSON.stringify({ pngBase64: png }) });
    await rejected; await fence;
    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
    expect(FileSystem.deleteAsync).toHaveBeenCalled();
    expect(ownerWorkEvidence('owner').pending).toBe(0);
    expect((await providerDeviceInventory('owner')).unknown).toBe(1);
  });

  it('does not accept a provider result across A to B to A session changes', async () => {
    setDeviceSessionOwner('owner');
    let finish!: (value: { status: number; body: string }) => void;
    mockTaskUpload.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const inference = actual.createWardrobeCutout('owner', item);
    const rejected = expect(inference).rejects.toThrow('session');
    await tick(); setDeviceSessionOwner('other'); setDeviceSessionOwner('owner');
    finish({ status: 200, body: JSON.stringify({ pngBase64: png }) });
    await rejected;
    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
    expect(ownerWorkEvidence('owner').pending).toBe(0);
  });

});
