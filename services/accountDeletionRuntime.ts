import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { vtonHistoryStorageKey, parseTryOnHistory } from '../lib/vtonHistory';
import { historyCleanupStorageKey, isOwnedHistoryResult } from './vtonHistoryService';
import { privacyLifecycleKey } from './privacyLifecycleService';
import type { AccountDeletionRuntime } from './accountService';
import { readOwnedFileLedger, otherDeviceFileReferences } from './ownedDeviceFiles';
import { drainOwnerWork, ownerWorkEvidence } from '../lib/accountDeviceWork';
import { cutoutV2DeviceInventory } from './wardrobeCutoutV2';

export async function createAccountDeletionRuntime(subjectId: string, clearAndVerifyMemory: () => Promise<boolean>): Promise<AccountDeletionRuntime> {
  if (!/^[a-zA-Z0-9-]+$/.test(subjectId)) throw new Error('Geçersiz hesap kimliği.');
  const files = new Set<string>();
  const ledger = await readOwnedFileLedger(subjectId);
  const unresolved = ledger.intents.filter(item => item.opaque && item.paths.length === 0);
  ledger.intents.forEach(item => item.paths.forEach(uri => files.add(uri)));
  const raw = await AsyncStorage.getItem(vtonHistoryStorageKey(subjectId));
  const history = parseTryOnHistory(raw);
  if (raw !== null && (!Array.isArray(JSON.parse(raw)) || JSON.parse(raw).length !== history.length)) throw new Error('Geçmiş ownership envanteri geçersiz.');
  history.filter(item => isOwnedHistoryResult(item.imageUri)).forEach(item => files.add(item.imageUri));
  const journal = JSON.parse(await AsyncStorage.getItem(historyCleanupStorageKey(subjectId)) ?? '[]');
  if (!Array.isArray(journal) || !journal.every(value => typeof value === 'string' && isOwnedHistoryResult(value))) throw new Error('Dosya cleanup ownership envanteri doğrulanamadı.');
  journal.forEach(value => files.add(value));
  if (FileSystem.cacheDirectory) files.add(`${FileSystem.cacheDirectory}kabin-model-${subjectId}.jpg`);
  const directory = FileSystem.documentDirectory && `${FileSystem.documentDirectory}wardrobe/${encodeURIComponent(subjectId)}/`;
  const cutoutV2 = await cutoutV2DeviceInventory(subjectId);
  for (const uri of cutoutV2.artifacts) {
    if ((!directory || !uri.startsWith(directory)) && !files.has(uri)) throw new Error('Cutout artifact ownership unverified');
    files.add(uri);
  }
  if (directory && (await FileSystem.getInfoAsync(directory)).exists) {
    const walk = async (path: string): Promise<void> => {
      for (const name of await FileSystem.readDirectoryAsync(path)) {
        if (!name || /[/\\]|^\.{1,2}$/.test(name)) throw new Error('Güvensiz yerel dosya yolu.');
        const uri = path + name, info = await FileSystem.getInfoAsync(uri);
        if (info.exists && info.isDirectory) await walk(uri + '/'); else files.add(uri);
      }
    };
    await walk(directory);
  }
  const shared = await otherDeviceFileReferences(subjectId);
  // Inventory coverage uses actual ownership conditions. accountService separately
  // requires persisted fence, real drain and verified device cleanup before POST.
  const blockers = [...unresolved.map(() => 'OPAQUE_NATIVE_CREATION_INTERRUPTED'),
    ...[...files].filter(uri => shared.has(uri)).map(() => 'SHARED_FILE_REFERENCE')];
  const inventory = { subjectId, coverageVerified: blockers.length === 0, blockers,
    ownedFiles: [...files], extraOwnedKeys: [privacyLifecycleKey(subjectId)] };
  return { inventory,
    collectAfterFence: async () => (await createAccountDeletionRuntime(subjectId, clearAndVerifyMemory)).inventory,
    clearAndVerifyMemory: async () => {
      const drained = await drainOwnerWork(subjectId), proof = ownerWorkEvidence(subjectId);
      return drained && proof.fenced && proof.pending === 0 && proof.nonempty === 0 && await clearAndVerifyMemory();
    } };
}
