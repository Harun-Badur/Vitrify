import AsyncStorage from '@react-native-async-storage/async-storage';
import { fenceAccountWrites, resetAccountWriteFenceMemoryForTests } from '../lib/accountWriteFence';
import { uploadModelPhoto, upsertStudioProfile, resolveSavedModelPhotoUri } from '../services/profileService';
import { createWardrobeCutout, uploadWardrobeCutout } from '../services/wardrobeCutoutService';
import { deviceDeletionAdapters } from '../services/deviceDeletionAdapters';
import { createDeletionReceipt } from '../lib/accountDeletionFoundation';
jest.mock('expo-file-system/legacy', () => ({ cacheDirectory: 'file:///cache/', documentDirectory: 'file:///docs/' }));
beforeEach(async () => { await AsyncStorage.clear(); resetAccountWriteFenceMemoryForTests(); });
it('fenced model/profile/cutout writers reject before upload, download or RPC side effects', async () => {
  await fenceAccountWrites('A');
  await expect(uploadModelPhoto('A', 'file:///photo.jpg', { onProgress: () => {} })).rejects.toThrow('deletion');
  await expect(upsertStudioProfile('A', { heightCm: 180 })).rejects.toThrow('deletion');
  await expect(resolveSavedModelPhotoUri('A')).rejects.toThrow('deletion');
  await expect(createWardrobeCutout('A', {} as never)).rejects.toThrow('deletion');
  await expect(uploadWardrobeCutout('A', {} as never)).rejects.toThrow('deletion');
});
it('A inventory cannot remove B private key even when coverage is asserted', async () => {
  const b = 'vitrify.privacy-lifecycle.v1.B'; await AsyncStorage.setItem(b, 'preserve');
  const adapters = deviceDeletionAdapters({ subjectId: 'A', coverageVerified: true, ownedFiles: [], extraOwnedKeys: [b] }, async () => true);
  await expect(adapters.async_storage!.cleanup(createDeletionReceipt('r', 'A'))).rejects.toThrow('ownership');
  expect(await AsyncStorage.getItem(b)).toBe('preserve');
});
