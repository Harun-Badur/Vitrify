import AsyncStorage from '@react-native-async-storage/async-storage';
import { resetAccountWriteFenceMemoryForTests } from '../lib/accountWriteFence';
import { resetDeviceWorkForTests } from '../lib/accountDeviceWork';
import { loadWardrobe, saveWardrobe, saveWardrobeCutoutCheckpoint } from '../services/wardrobeService';

const mockRows: Record<string, unknown>[] = [];
const mockUpload = jest.fn().mockResolvedValue(undefined);
const mockClient = {
  auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } }, error: null })) },
  rpc: jest.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'wardrobe_cloud_snapshot') return { data: { owner: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', photoVersion: 1, items: [...mockRows], outfits: [] }, error: null };
    mockRows.push({ ...(args.p_value as object), updatedAt: 'v1' });
    return { data: 'applied', error: null };
  }),
  storage: { from: () => ({ createSignedUrls: async (paths: string[]) => ({ data: paths.map(path => ({ path, signedUrl: 'https://example.test/photo' })), error: null }) }) },
};
jest.mock('../lib/supabase', () => ({ getSupabaseClient: () => mockClient }));
jest.mock('../lib/analytics', () => ({ createUuid: () => 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }));
jest.mock('../services/accountStorageUpload', () => ({
  accountStorageUploadInventory: async () => ({ keys: [] }),
  storageUploadJournalPrefix: () => 'journal.',
  uploadAccountStorage: (...args: unknown[]) => mockUpload(...args),
}));
jest.mock('../services/ownedDeviceFiles', () => ({ withOwnedNativeFileUnderGuard: async (_owner: string, _source: string, create: () => Promise<string>, consume: (uri: string) => Promise<void>) => consume(await create()) }));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: async () => ({ uri: 'file:///prepared.png' }), SaveFormat: { PNG: 'png' } }));
jest.mock('expo-file-system/legacy', () => ({ readAsStringAsync: async () => 'aGVsbG8=', EncodingType: { Base64: 'base64' } }));

beforeEach(async () => {
  await AsyncStorage.clear(); resetDeviceWorkForTests(); resetAccountWriteFenceMemoryForTests(); mockRows.length = 0; jest.clearAllMocks();
});

it('concurrent cutout checkpoint and save/retry retain journal serialization without lock inversion or duplicate upload', async () => {
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const pause = new Promise<void>(resolve => { release = resolve; });
  mockClient.auth.getUser.mockImplementationOnce(async () => { entered(); await pause; return { data: { user: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } }, error: null }; });
  const owner = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const item = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Pantolon', brand: '', category: 'lower_body' as const, imageUrl: 'file:///original.jpg', createdAt: '2026-10-21' };
  const save = saveWardrobe(owner, { wardrobeItems: [item], savedOutfits: [] });
  await started;
  // Queued behind save in the owner journal; it must NOT hold the global guard.
  const checkpoint = saveWardrobeCutoutCheckpoint(owner, item.id, `${owner}/${item.id}/original-cccccccc-cccc-4ccc-8ccc-cccccccccccc.png`, { cutoutStatus: 'blocked' });
  release();
  await save; expect(await checkpoint).toBe(true);
  await saveWardrobe(owner, await loadWardrobe(owner));
  expect(mockUpload).toHaveBeenCalledTimes(1); expect(mockRows).toHaveLength(1);
  const journal = JSON.parse((await AsyncStorage.getItem(`vitrify.wardrobe.sync.v1.${owner}`))!);
  expect(journal.pending).toEqual([]);
  expect(journal.cache.wardrobeItems).toHaveLength(1);
  expect(journal.cache.wardrobeItems[0].cutoutStatus).toBe('blocked');
});

it('save with a local photo completes through the real nested uploadPhoto guard, with a bounded watchdog', async () => {
  const item = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Pantolon', brand: '', category: 'lower_body' as const, imageUrl: 'file:///original.jpg', createdAt: '2026-10-21' };
  const work = saveWardrobe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', { wardrobeItems: [item], savedOutfits: [] });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([work, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 150); })]);
    expect(result).not.toBeNull();
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(result?.wardrobeSync?.state).toBe('synced');
    expect(mockRows).toHaveLength(1);
  } finally { clearTimeout(timer); }
});
