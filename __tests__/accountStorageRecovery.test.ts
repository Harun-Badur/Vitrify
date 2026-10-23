import AsyncStorage from '@react-native-async-storage/async-storage';
import { createWardrobeSlice } from '../store/wardrobeSlice';
import { createWardrobeCutout, uploadWardrobeCutout } from '../services/wardrobeCutoutService';
import { loadWardrobe } from '../services/wardrobeService';
import { resetAccountWriteFenceMemoryForTests } from '../lib/accountWriteFence';
import { drainOwnerWork, resetDeviceWorkForTests } from '../lib/accountDeviceWork';
import { accountStorageUploadInventory, storageUploadJournalPrefix } from '../services/accountStorageUpload';
import { createAccountDeletionRuntime } from '../services/accountDeletionRuntime';
import type { AppState } from '../store/useAppStore';
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///docs/', cacheDirectory: 'file:///cache/',
  getInfoAsync: async () => ({ exists: false }) }));
jest.mock('../services/wardrobeCutoutService', () => ({ wardrobeCutoutConfigured: () => true,
  createWardrobeCutout: jest.fn(), uploadWardrobeCutout: jest.fn() }));
jest.mock('../services/wardrobeService', () => {
  const actual = jest.requireActual<typeof import('../services/wardrobeService')>('../services/wardrobeService');
  return { ...actual, loadWardrobe: async (owner: string) => ({ ...(await actual.loadWardrobe(owner)),
    // These recovery fixtures model a previously verified cloud save. Real
    // offline/pending saves are tested separately and must not start inference.
    wardrobeSync: { state: 'synced', pending: 0 } }) };
});
beforeEach(async () => {
  await AsyncStorage.clear(); resetAccountWriteFenceMemoryForTests(); resetDeviceWorkForTests(); jest.clearAllMocks();
});
const item = { id: 'item', title: 'shirt', category: 'upper_body', brand: 'b', imageUrl: 'file:///original.jpg',
  createdAt: '2026-10-11', cutoutStatus: 'pending' };
function slice() {
  const state = { sessionUserId: 'A' } as AppState;
  const actions = createWardrobeSlice(((patch: unknown) => Object.assign(state, typeof patch === 'function' ? patch(state) : patch)) as never,
    (() => state) as never, {} as never);
  Object.assign(state, actions); return state;
}
it('provider failure persists blocked before dispatch and hydration never repeats it', async () => {
  await AsyncStorage.setItem('vitrify.wardrobe.v1.A', JSON.stringify({ wardrobeItems: [item], savedOutfits: [] }));
  jest.mocked(createWardrobeCutout).mockImplementation(async () => {
    expect((await loadWardrobe('A')).wardrobeItems[0].cutoutStatus).toBe('blocked');
    throw new Error('provider reply lost');
  });
  const first = slice(); await first.hydrateWardrobe('A'); await drainOwnerWork('A');
  expect((await loadWardrobe('A')).wardrobeItems[0].cutoutStatus).toBe('blocked');
  const restarted = slice(); await restarted.hydrateWardrobe('A'); await drainOwnerWork('A');
  expect(createWardrobeCutout).toHaveBeenCalledTimes(1); expect(uploadWardrobeCutout).not.toHaveBeenCalled();
});
it('upload failure keeps the durable local output and bounds automatic recovery through the idempotent upload service', async () => {
  await AsyncStorage.setItem('vitrify.wardrobe.v1.A', JSON.stringify({ wardrobeItems: [{ ...item, cutoutLocalUri: 'file:///docs/wardrobe/A/cutout.png' }], savedOutfits: [] }));
  jest.mocked(uploadWardrobeCutout).mockRejectedValue(new Error('unknown upload'));
  const first = slice(); await first.hydrateWardrobe('A'); await drainOwnerWork('A');
  expect(uploadWardrobeCutout).toHaveBeenCalledTimes(2);
  expect((await loadWardrobe('A')).wardrobeItems[0]).toMatchObject({ cutoutStatus: 'blocked', cutoutLocalUri: 'file:///docs/wardrobe/A/cutout.png' });
  const second = slice(); await second.hydrateWardrobe('A'); await drainOwnerWork('A');
  expect(uploadWardrobeCutout).toHaveBeenCalledTimes(4); expect(createWardrobeCutout).not.toHaveBeenCalled();
});
it('unverified stop checkpoint prevents all provider inference and upload', async () => {
  await AsyncStorage.setItem('vitrify.wardrobe.v1.A', JSON.stringify({ wardrobeItems: [item], savedOutfits: [] }));
  const implementation = jest.mocked(AsyncStorage.getItem).getMockImplementation()!;
  const read = jest.spyOn(AsyncStorage, 'getItem').mockImplementation(async key => {
    const value = await implementation(key);
    return key === 'vitrify.wardrobe.v1.A' && value?.includes('"cutoutStatus":"blocked"') ? 'checkpoint mismatch' : value;
  });
  try {
    const actions = slice(); await actions.hydrateWardrobe('A'); await drainOwnerWork('A');
    expect(createWardrobeCutout).not.toHaveBeenCalled(); expect(uploadWardrobeCutout).not.toHaveBeenCalled();
  } finally { read.mockRestore(); jest.mocked(AsyncStorage.getItem).mockImplementation(implementation); }
});
it('durable unresolved upload is independent of deletion after restart and B remains isolated', async () => {
  const key = storageUploadJournalPrefix('A') + encodeURIComponent('model-photos/A/model.jpg');
  await AsyncStorage.setItem(key, JSON.stringify({ owner: 'A', bucket: 'model-photos', path: 'A/model.jpg',
    request: 'request-A', state: 'UNKNOWN' }));
  const runtime = await createAccountDeletionRuntime('A', async () => true);
  expect(runtime.inventory.blockers).not.toContain('STORAGE_UPLOAD_UNRESOLVED');
  expect(runtime.inventory.coverageVerified).toBe(true);
  expect((await accountStorageUploadInventory('B')).unresolved).toEqual([]);
});
it('malformed upload journal blocks upload inventory, not deletion, and is not discarded', async () => {
  await AsyncStorage.setItem(storageUploadJournalPrefix('A') + 'broken', '{}');
  await expect(accountStorageUploadInventory('A')).rejects.toMatchObject({ code: 'STORAGE_JOURNAL_INVALID' });
  expect((await createAccountDeletionRuntime('A', async () => true)).inventory.coverageVerified).toBe(true);
  expect(await AsyncStorage.getItem(storageUploadJournalPrefix('A') + 'broken')).toBe('{}');
});
