import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { readPrivacyLifecycle, recordPrivacyChoice, markModelPhotoSaved, removeModelPhotoLifecycle, resetPersonalizationLifecycle } from '../services/privacyLifecycleService';
import { deviceDeletionAdapters } from '../services/deviceDeletionAdapters';
import { createDeletionReceipt } from '../lib/accountDeletionFoundation';
import { fenceAccountWrites, resetAccountWriteFenceMemoryForTests } from '../lib/accountWriteFence';
import { resetDeviceWorkForTests } from '../lib/accountDeviceWork';
import { saveWardrobe, storeWardrobePhoto } from '../services/wardrobeService';
import { resetAnalyticsForTests } from '../lib/analytics';
import { appendTryOnHistory, loadTryOnHistory, historyCleanupStorageKey } from '../services/vtonHistoryService';
import { vtonHistoryStorageKey, VTON_HISTORY_MAX_AGE_MS } from '../lib/vtonHistory';
import { authorizedPurgeRecommendationCache } from '../scripts/lib/recommendationRetention';

jest.mock('../lib/supabase', () => ({ getSupabaseClient: () => null }));
jest.mock('expo-file-system/legacy', () => ({ cacheDirectory: 'file:///cache/', documentDirectory: 'file:///docs/',
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined), copyAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined), getInfoAsync: jest.fn().mockResolvedValue({ exists: false }) }));
beforeEach(async () => {
  await resetAnalyticsForTests(); await AsyncStorage.clear();
  resetAccountWriteFenceMemoryForTests();
  // A previous test's durable fence also marks the independent owner registry.
  // Clearing AsyncStorage and the write-fence cache alone does not reset it.
  resetDeviceWorkForTests();
  jest.clearAllMocks();
});
afterEach(() => jest.restoreAllMocks());
it('model photo requires explicit choice; failed removal persists pending state and resumes', async () => {
  await expect(markModelPhotoSaved('u', 0)).rejects.toThrow('Explicit');
  await recordPrivacyChoice('u', 'model_photo_storage', 'granted', 'copy-v1');
  await markModelPhotoSaved('u', (await readPrivacyLifecycle('u')).generation);
  await expect(removeModelPhotoLifecycle('u', async () => false)).rejects.toThrow('pending');
  expect((await readPrivacyLifecycle('u')).modelPhoto).toBe('REMOVE_PENDING');
  await expect(markModelPhotoSaved('u', 0)).rejects.toThrow();
  await removeModelPhotoLifecycle('u', async () => true);
  expect((await readPrivacyLifecycle('u')).modelPhoto).toBe('REMOVED');
  expect((await readPrivacyLifecycle('other')).modelPhoto).toBe('UNSET');
});
it('opt-out/reset is per-user, checkpointed, and does not change scorer inputs', async () => {
  await recordPrivacyChoice('u', 'personalization', 'granted', 'v1');
  await recordPrivacyChoice('u', 'personalization', 'withdrawn', 'v1');
  expect((await readPrivacyLifecycle('u')).personalization).toBe('OPTED_OUT');
  await expect(resetPersonalizationLifecycle('u', async () => false)).rejects.toThrow('pending');
  const pending = await readPrivacyLifecycle('u'); expect(pending.personalization).toBe('RESET_PENDING');
  await resetPersonalizationLifecycle('u', async () => true);
  expect((await readPrivacyLifecycle('u')).generation).toBeGreaterThan(pending.generation);
  await fenceAccountWrites('u');
  await expect(recordPrivacyChoice('u', 'personalization', 'granted', 'v2')).rejects.toThrow('deletion');
});
it('device adapter fails closed on missing inventory and retries files before verifying', async () => {
  const receipt = createDeletionReceipt('r', 'u');
  const unknown = deviceDeletionAdapters({ subjectId: 'u', coverageVerified: false, ownedFiles: [], extraOwnedKeys: [] }, async () => true);
  await expect(unknown.local_files!.verify(receipt)).rejects.toThrow('coverage');
  const adapters = deviceDeletionAdapters({ subjectId: 'u', coverageVerified: true,
    ownedFiles: ['file:///docs/wardrobe/u/cutout.png'], extraOwnedKeys: [] }, async () => true);
  jest.mocked(FileSystem.getInfoAsync).mockResolvedValueOnce({ exists: true } as never);
  expect((await adapters.local_files!.verify(receipt)).complete).toBe(false);
  await fenceAccountWrites('u');
  jest.mocked(FileSystem.deleteAsync).mockRejectedValueOnce(new Error('offline filesystem'));
  await expect(adapters.local_files!.cleanup(receipt)).rejects.toThrow();
  await adapters.local_files!.cleanup(receipt);
  expect((await adapters.local_files!.verify(receipt)).complete).toBe(true);
  const unsafe = deviceDeletionAdapters({ subjectId: 'u', coverageVerified: true,
    ownedFiles: ['file:///docs/wardrobe/other/photo.png'], extraOwnedKeys: [] }, async () => true);
  await expect(unsafe.local_files!.cleanup(receipt)).rejects.toThrow('unsupported');
});
it('20th retained, 21st evicts one owned file; opening offline later expires at exactly 30 days', async () => {
  const now = 5 * VTON_HISTORY_MAX_AGE_MS;
  const time = jest.spyOn(Date, 'now').mockReturnValue(now);
  for (let i = 0; i < 20; i++) await appendTryOnHistory('u', { productId: String(i), title: 'p', ts: now - 20 + i, imageUri: `file:///cache/kabin-tryon-${i}.png` });
  expect(await loadTryOnHistory('u')).toHaveLength(20); expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
  await appendTryOnHistory('u', { productId: '21', title: 'p', ts: now, imageUri: 'file:///cache/kabin-tryon-21.png' });
  expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1);
  time.mockReturnValue(now + VTON_HISTORY_MAX_AGE_MS);
  expect(await loadTryOnHistory('u')).toEqual([]);
  expect(await AsyncStorage.getItem(vtonHistoryStorageKey('u'))).toBe('[]');
  expect(await AsyncStorage.getItem(historyCleanupStorageKey('u'))).toBe('[]');
  expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(21);
});
it('cache purge requires a verified principal/scope before any query', async () => {
  const calls: string[] = [], query = { delete: () => { calls.push('delete'); return query; },
    eq: () => query, neq: () => query, lte: () => query,
    then: (resolve: (value: { error: null }) => unknown) => Promise.resolve(resolve({ error: null })) };
  const client = { from: () => query } as never;
  await expect(authorizedPurgeRecommendationCache(client, 'operator', { scope: 'u', engineVersion: 'v1', now: 0 }, async () => false)).rejects.toThrow('unauthorized');
  expect(calls).toEqual([]);
  await authorizedPurgeRecommendationCache(client, 'operator', { scope: 'u', engineVersion: 'v1', now: 0 }, async (principal, scope) => principal === 'operator' && scope === 'u');
  expect(calls).toHaveLength(2);
});
it('fence drains a running local file write and blocks late wardrobe/history recreation', async () => {
  let started!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  jest.mocked(FileSystem.copyAsync).mockImplementationOnce(() => { started(); return new Promise<void>(resolve => { release = resolve; }); });
  const photo = storeWardrobePhoto('u', 'item', 'file:///input.jpg');
  await ready;
  let fenced = false;
  const fencing = fenceAccountWrites('u').then(() => { fenced = true; });
  await new Promise(resolve => setTimeout(resolve, 5)); expect(fenced).toBe(false);
  release(); await photo; await fencing;
  await expect(saveWardrobe('u', { wardrobeItems: [], savedOutfits: [] })).rejects.toThrow('deletion');
  await expect(appendTryOnHistory('u', { productId: 'p', title: 'p', ts: Date.now(), imageUri: 'file:///cache/kabin-tryon-1.png' })).rejects.toThrow('deletion');
  expect(await AsyncStorage.getItem(vtonHistoryStorageKey('u'))).toBeNull();
});
it('an expired result shared by another user remains journaled and is never deleted', async () => {
  const now = Date.now(), uri = 'file:///cache/kabin-tryon-1.png';
  await AsyncStorage.setItem(vtonHistoryStorageKey('u'), JSON.stringify([{ productId: 'p', title: 'p', ts: now - VTON_HISTORY_MAX_AGE_MS, imageUri: uri }]));
  await AsyncStorage.setItem(vtonHistoryStorageKey('other'), JSON.stringify([{ productId: 'q', title: 'q', ts: now, imageUri: uri }]));
  expect(await loadTryOnHistory('u')).toEqual([]);
  expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(historyCleanupStorageKey('u'))).toBe(JSON.stringify([uri]));
});
