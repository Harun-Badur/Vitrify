import AsyncStorage from '@react-native-async-storage/async-storage';
import { cutoutV2DeviceInventory, cutoutV2Key } from '../services/wardrobeCutoutV2';
import { otherDeviceFileReferences } from '../services/ownedDeviceFiles';

beforeEach(async () => AsyncStorage.clear());
test('V2 namespace inventory is owner scoped and preserves another account', async () => {
  const identity = { owner: 'A', wardrobeItemId: 'item', originalVersion: 'a'.repeat(64) };
  const job = { version: 2, identity, request: 'request', state: 'PRE_DISPATCH', revision: 0, prepareAttempts: 0, preparationStopped: false };
  await AsyncStorage.setItem(cutoutV2Key(identity), JSON.stringify(job));
  await AsyncStorage.setItem(cutoutV2Key({ ...identity, owner: 'B' }), 'foreign');
  expect((await cutoutV2DeviceInventory('A')).keys).toEqual([cutoutV2Key(identity)]);
});
test('corrupt V2 namespace refuses cleanup coverage rather than silently dropping it', async () => {
  const identity = { owner: 'A', wardrobeItemId: 'item', originalVersion: 'a'.repeat(64) };
  await AsyncStorage.setItem(cutoutV2Key(identity), 'corrupt');
  await expect(cutoutV2DeviceInventory('A')).rejects.toThrow();
  expect(await AsyncStorage.getItem(cutoutV2Key(identity))).toBe('corrupt');
});
test('another account V2 artifact reference blocks shared file cleanup', async () => {
  const own = { owner:'A', wardrobeItemId:'item', originalVersion:'a'.repeat(64) };
  await AsyncStorage.setItem(cutoutV2Key(own), JSON.stringify({artifact:{uri:'file:///owned-only'}}));
  await AsyncStorage.setItem(cutoutV2Key({...own,owner:'B'}), JSON.stringify({artifact:{uri:'file:///shared'}}));
  const references=await otherDeviceFileReferences('A');
  expect(references.has('file:///shared')).toBe(true);
  expect(references.has('file:///owned-only')).toBe(false);
});
