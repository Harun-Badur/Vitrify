import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAccountDeletionRuntime } from '../services/accountDeletionRuntime';
jest.mock('expo-file-system/legacy', () => ({ cacheDirectory: 'file:///cache/', documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn(async (uri: string) => ({ exists: uri === 'file:///docs/wardrobe/A/', isDirectory: true })),
  readDirectoryAsync: jest.fn().mockResolvedValue(['photo.jpg']) }));
jest.mock('../lib/supabase', () => ({ getRequiredSupabaseClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'fixture', user: { id: 'A' } } } }) } }) }));
beforeEach(async () => { await AsyncStorage.clear(); });
it('profile runtime inventories scoped wardrobe and model cache without unconditional blockers', async () => {
  const runtime = await createAccountDeletionRuntime('A', async () => true);
  expect(runtime.inventory.ownedFiles).toEqual(['file:///cache/kabin-model-A.jpg', 'file:///docs/wardrobe/A/photo.jpg']);
  expect(runtime.inventory.extraOwnedKeys).toEqual(['vitrify.privacy-lifecycle.v1.A']);
  expect(runtime.inventory.coverageVerified).toBe(true); expect(runtime.inventory.blockers).toEqual([]);
});
it('invalid cleanup journal blocks ownership collection instead of deleting unknown or B files', async () => {
  await AsyncStorage.setItem('kabin.vton.history.v1.A.cleanup', JSON.stringify(['file:///docs/wardrobe/B/photo.jpg']));
  await expect(createAccountDeletionRuntime('A', async () => true)).rejects.toThrow('ownership');
});
