import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { pruneTryOnHistory, VTON_HISTORY_MAX_AGE_MS, vtonHistoryStorageKey } from '../lib/vtonHistory';
import { appendTryOnHistory, historyCleanupStorageKey, loadTryOnHistory } from '../services/vtonHistoryService';

jest.mock('expo-file-system/legacy', () => ({ cacheDirectory: 'file:///cache/',
  deleteAsync: jest.fn().mockResolvedValue(undefined), getInfoAsync: jest.fn().mockResolvedValue({ exists: false }) }));
const entry = (ts: number, imageUri = `file:///cache/kabin-tryon-${ts}.png`) => ({ productId: 'p', title: 'p', ts, imageUri });
beforeEach(async () => { await AsyncStorage.clear(); jest.clearAllMocks(); });

it('expires exactly at 30 days and caps at 20 using the recorded clock', () => {
  const now = 100 * VTON_HISTORY_MAX_AGE_MS, expired = entry(now - VTON_HISTORY_MAX_AGE_MS);
  const result = pruneTryOnHistory([expired, ...Array.from({ length: 21 }, (_, n) => entry(now - n))], now);
  expect(result.next).toHaveLength(20); expect(result.evicted).toContain(expired);
  expect(pruneTryOnHistory([entry(now + 1)], now).next).toHaveLength(1);
});
it('offline load removes metadata and retries the file after failure', async () => {
  const old = entry(Date.now() - VTON_HISTORY_MAX_AGE_MS - 1000);
  await AsyncStorage.setItem(vtonHistoryStorageKey('u'), JSON.stringify([old]));
  jest.mocked(FileSystem.deleteAsync).mockRejectedValueOnce(new Error('failed'));
  expect(await loadTryOnHistory('u')).toEqual([]);
  expect(JSON.parse((await AsyncStorage.getItem(historyCleanupStorageKey('u')))!)).toEqual([old.imageUri]);
  await loadTryOnHistory('u'); expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(2);
  expect(await AsyncStorage.getItem(historyCleanupStorageKey('u'))).toBe('[]');
});
it('never deletes retained/shared URIs or arbitrary imported cutouts', async () => {
  const now = Date.now(), shared = entry(now - VTON_HISTORY_MAX_AGE_MS - 1000);
  await AsyncStorage.setItem(vtonHistoryStorageKey('u'), JSON.stringify([shared, entry(shared.ts, 'file:///wardrobe/cutout.png')]));
  await appendTryOnHistory('u', entry(now, shared.imageUri));
  expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
  expect(JSON.parse((await AsyncStorage.getItem(historyCleanupStorageKey('u')))!)).toEqual(['file:///wardrobe/cutout.png']);
});
it('serializes concurrent appends and never deletes without a durable journal', async () => {
  await Promise.all([appendTryOnHistory('u', entry(Date.now())), appendTryOnHistory('u', entry(Date.now() + 1))]);
  expect(await loadTryOnHistory('u')).toHaveLength(2);
  const old = entry(Date.now() - VTON_HISTORY_MAX_AGE_MS - 1000);
  await AsyncStorage.setItem(vtonHistoryStorageKey('u'), JSON.stringify([old]));
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('no journal write'));
  await loadTryOnHistory('u');
  expect(JSON.parse((await AsyncStorage.getItem(vtonHistoryStorageKey('u')))!)).toEqual([old]);
});
