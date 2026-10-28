import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { quiesceAnalyticsForDeletion, ANALYTICS_QUEUE_KEY, parseAnalyticsQueue } from '../lib/analytics';
import { ACCOUNT_WRITE_FENCE_KEY, isAccountWriteFenced, withAccountCleanupGuard } from '../lib/accountWriteFence';
import { vtonHistoryStorageKey } from '../lib/vtonHistory';
import { historyCleanupStorageKey, otherHistoryReferences } from './vtonHistoryService';
import type { DeletionAdapter, DeletionLayer } from '../lib/accountDeletionFoundation';
import { readOwnedFileLedger, safeOwnedCachePath, otherDeviceFileReferences } from './ownedDeviceFiles';
import { preferenceRequestStorageKeys } from '../lib/preferenceRequestJournal';
import { cutoutV2DeviceInventory } from './wardrobeCutoutV2';
import { productPrefStorageKey } from '../lib/productPreference';

export interface LocalDeletionInventory {
  subjectId: string;
  /** Durable snapshot collected BEFORE metadata removal; includes model photo and all derived paths. */
  coverageVerified: boolean;
  ownedFiles: readonly string[];
  extraOwnedKeys: readonly string[];
  blockers?: readonly string[];
}
/** Concrete device cleanup; unknown ownership never authorizes arbitrary file deletion. */
export function deviceDeletionAdapters(inventory: LocalDeletionInventory, clearMemory: () => Promise<boolean>):
  Partial<Record<DeletionLayer, DeletionAdapter>> {
  const requireCoverage = () => {
    if (!inventory.coverageVerified) throw new Error('Local ownership coverage unverified');
    if (!/^[a-zA-Z0-9-]+$/.test(inventory.subjectId)) throw new Error('Invalid local owner');
    if (inventory.extraOwnedKeys.some(key => key === ACCOUNT_WRITE_FENCE_KEY || key.startsWith('vitrify.deletion-checkpoint.'))) throw new Error('Cleanup cannot remove recovery tombstone/checkpoint');
    if (inventory.extraOwnedKeys.some(key => key !== `vitrify.privacy-lifecycle.v1.${encodeURIComponent(inventory.subjectId)}`)) throw new Error('Extra key ownership unsupported');
  };
  const keys = [vtonHistoryStorageKey(inventory.subjectId), historyCleanupStorageKey(inventory.subjectId),
    `vitrify.wardrobe.v1.${encodeURIComponent(inventory.subjectId)}`,
    `vitrify.wardrobe.sync.v1.${encodeURIComponent(inventory.subjectId)}`,
    `vitrify.wardrobe.sync.v1.${encodeURIComponent(inventory.subjectId)}.legacy`,
    productPrefStorageKey(inventory.subjectId), ...inventory.extraOwnedKeys];
  const scopedDirectory = FileSystem.documentDirectory &&
    `${FileSystem.documentDirectory}wardrobe/${encodeURIComponent(inventory.subjectId)}/`;
  let trackedPaths = new Set<string>();
  const readFileProof = async () => {
    const ledger = await readOwnedFileLedger(inventory.subjectId);
    if (ledger.intents.some(item => item.opaque && item.paths.length === 0)) throw new Error('Opaque native file ownership unresolved');
    trackedPaths = new Set(ledger.intents.flatMap(item => item.paths));
  };
  const safePath = (uri: string) => !/[\\]|\/\.{1,2}\//.test(uri) && !/%2e|%2f|%5c/i.test(uri) &&
    ((!!scopedDirectory && uri.startsWith(scopedDirectory)) || (!!FileSystem.cacheDirectory &&
      uri.startsWith(FileSystem.cacheDirectory) && (/^kabin-tryon-\d+\.png$/.test(uri.slice(FileSystem.cacheDirectory.length)) ||
        uri === `${FileSystem.cacheDirectory}kabin-model-${inventory.subjectId}.jpg` ||
        uri.startsWith(`${FileSystem.cacheDirectory}vitrify-owned/${encodeURIComponent(inventory.subjectId)}/`) ||
        (trackedPaths.has(uri) && safeOwnedCachePath(uri)))));
  const queue: DeletionAdapter = { idempotent: true,
    cleanup: () => quiesceAnalyticsForDeletion(inventory.subjectId),
    verify: async () => ({ complete: false, evidence: [] }) }; // drain is mandatory, never infer from empty disk queue
  // Verification after cleanup must also prove actual in-flight drain, not just tombstone presence.
  let drained = false;
  queue.cleanup = async () => { await quiesceAnalyticsForDeletion(inventory.subjectId); drained = true; };
  queue.verify = async () => {
    const absent = drained && await isAccountWriteFenced(inventory.subjectId) &&
      !parseAnalyticsQueue(await AsyncStorage.getItem(ANALYTICS_QUEUE_KEY)).some(item => item.user_id === inventory.subjectId);
    return { complete: absent, evidence: absent ? ['owner queue absent and actual RPC drain completed'] : [] };
  };
  const asyncStorage: DeletionAdapter = { idempotent: true,
    cleanup: async () => { requireCoverage(); const owned=[...keys,...await preferenceRequestStorageKeys(inventory.subjectId), ...(await cutoutV2DeviceInventory(inventory.subjectId)).keys]; for (const key of owned) await AsyncStorage.removeItem(key); },
    verify: async () => {
      requireCoverage(); const absent = (await Promise.all(keys.map(key => AsyncStorage.getItem(key)))).every(value => value === null)
        && (await preferenceRequestStorageKeys(inventory.subjectId)).length===0
        && (await cutoutV2DeviceInventory(inventory.subjectId)).keys.length===0;
      return { complete: absent, evidence: absent ? ['inventoried device keys absent; tombstone preserved'] : [] };
    } };
  const files: DeletionAdapter = { idempotent: true,
    cleanup: () => withAccountCleanupGuard(inventory.subjectId, async () => {
      requireCoverage(); await readFileProof(); const shared = await otherDeviceFileReferences(inventory.subjectId);
      (await otherHistoryReferences(inventory.subjectId)).forEach(uri => shared.add(uri));
      for (const uri of inventory.ownedFiles) {
        if (!safePath(uri) || shared.has(uri)) throw new Error('Local file ownership path unsupported/shared');
        await FileSystem.deleteAsync(uri, { idempotent: true });
      }
    }),
    verify: async () => {
      requireCoverage();
      await readFileProof();
      if (!inventory.ownedFiles.every(safePath)) return { complete: false, evidence: [] };
      const absent = (await Promise.all(inventory.ownedFiles.map(uri => FileSystem.getInfoAsync(uri)))).every(info => !info.exists);
      return { complete: absent, evidence: absent ? ['inventoried owned local files absent'] : [] };
    } };
  const memory: DeletionAdapter = { idempotent: true, cleanup: async () => { await clearMemory(); },
    verify: async () => { const empty = await clearMemory(); return { complete: empty, evidence: empty ? ['owner memory references cleared and verified'] : [] }; } };
  const adapters = { queue, async_storage: asyncStorage, local_files: files, memory_cache: memory };
  return Object.fromEntries(Object.entries(adapters).map(([layer, adapter]) => [layer, {
    idempotent: true,
    cleanup: async (receipt) => { if (receipt.subjectId !== inventory.subjectId) throw new Error('Device owner mismatch'); await adapter.cleanup(receipt); },
    verify: async (receipt) => { if (receipt.subjectId !== inventory.subjectId) throw new Error('Device owner mismatch'); return adapter.verify(receipt); },
  } satisfies DeletionAdapter]));
}
