import { otherDeviceFileReferences } from './ownedDeviceFiles';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { logger } from '../lib/logger';
import { withAccountWriteGuard } from '../lib/accountWriteFence';
import {
  mergeTryOnHistory,
  parseTryOnHistory,
  pruneTryOnHistory,
  vtonHistoryStorageKey,
  VTON_HISTORY_KEY_PREFIX,
  type TryOnHistoryEntry,
} from '../lib/vtonHistory';

const operations = new Map<string, Promise<unknown>>();
export const historyCleanupStorageKey = (userId: string): string => `${vtonHistoryStorageKey(userId)}.cleanup`;

function serialized<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  const result = (operations.get(userId) ?? Promise.resolve()).catch(() => undefined).then(() => withAccountWriteGuard(userId, operation));
  operations.set(userId, result);
  void result.finally(() => { if (operations.get(userId) === result) operations.delete(userId); }).catch(() => undefined);
  return result;
}

/** Never delete arbitrary imports, remote URLs or shared wardrobe cutouts. */
export function isOwnedHistoryResult(uri: string): boolean {
  const directory = FileSystem.cacheDirectory;
  return !!directory && uri.startsWith(directory) && (/^kabin-tryon-\d+\.png$/.test(uri.slice(directory.length)) || /^vitrify-owned\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+\.png$/.test(uri.slice(directory.length)));
}

/** Only history keys are read; auth/credential values are never inspected. */
export async function otherHistoryReferences(userId: string): Promise<Set<string>> {
  const references = new Set<string>(), own = vtonHistoryStorageKey(userId);
  const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(VTON_HISTORY_KEY_PREFIX + '.') && key !== own && !key.endsWith('.cleanup'));
  for (const key of keys) {
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) continue;
    const data: unknown = JSON.parse(raw), entries = parseTryOnHistory(raw);
    if (!Array.isArray(data) || entries.length !== data.length) throw new Error('Other history ownership unknown');
    entries.forEach(entry => references.add(entry.imageUri));
  }
  return references;
}

async function enforce(userId: string, incoming?: TryOnHistoryEntry) {
  const key = vtonHistoryStorageKey(userId), cleanupKey = historyCleanupStorageKey(userId);
  const existing = parseTryOnHistory(await AsyncStorage.getItem(key));
  const result = incoming ? mergeTryOnHistory(existing, incoming) : pruneTryOnHistory(existing);
  const journal = await AsyncStorage.getItem(cleanupKey);
  const parsed: unknown = journal === null ? [] : JSON.parse(journal);
  if (!Array.isArray(parsed) || !parsed.every(uri => typeof uri === 'string')) throw new Error('Invalid history cleanup journal');
  const retained = new Set(result.next.map(entry => entry.imageUri));
  const pending = [...new Set([...(parsed as string[]), ...result.evicted.map(entry => entry.imageUri)])].filter(uri => !retained.has(uri));
  // Durable intent before metadata removal: retry survives a crash or file failure.
  await AsyncStorage.setItem(cleanupKey, JSON.stringify(pending));
  await AsyncStorage.setItem(key, JSON.stringify(result.next));
  const remaining: string[] = [];
  const shared = pending.length ? await otherHistoryReferences(userId) : new Set<string>();
  for (const uri of pending) {
    if (!isOwnedHistoryResult(uri) || shared.has(uri)) { remaining.push(uri); continue; }
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
      if ((await FileSystem.getInfoAsync(uri)).exists) remaining.push(uri);
    } catch { remaining.push(uri); }
  }
  await AsyncStorage.setItem(cleanupKey, JSON.stringify(remaining));
  if (remaining.length) logger.warn('Deneme geçmişi dosya cleanup bekliyor', { pendingCount: remaining.length });
  return result;
}

/** Offline expiry + durable file retry on access; no network or timers. */
export const loadTryOnHistory = (userId: string): Promise<TryOnHistoryEntry[]> => serialized(userId, async () => {
  try { return (await enforce(userId)).next; }
  catch { logger.warn('Sanal deneme geçmişi cleanup tamamlanamadı'); return []; }
});

/** This service owns file cleanup; callers must not delete evicted URIs again. */
export const appendTryOnHistory = (userId: string, entry: TryOnHistoryEntry): Promise<TryOnHistoryEntry[]> =>
  serialized(userId, async () => (await enforce(userId, entry)).evicted);
