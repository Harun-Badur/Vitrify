import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FS from 'expo-file-system/legacy';
import { createUuid } from '../lib/analytics';
import { accountWriteBlockedNow } from '../lib/accountWriteFence';
import { captureOwnerPublication } from '../lib/accountDeviceWork';

export const ownedFileLedgerKey = (owner: string) => `vitrify.owned-files.v1.${encodeURIComponent(owner)}`;
interface Intent { id: string; kind: string; state: 'CREATING' | 'READY' | 'RELEASE_PENDING'; opaque: boolean; paths: string[] }
interface Ledger { owner: string; version: 1; intents: Intent[] }
const queues = new Map<string, Promise<unknown>>();
const validOwner = (owner: string) => /^[a-zA-Z0-9-]+$/.test(owner);
export function safeOwnedCachePath(uri: string): boolean {
  return !!FS.cacheDirectory && uri.startsWith(FS.cacheDirectory) && uri.length > FS.cacheDirectory.length &&
    !/[\\]|\/\.{1,2}(?:\/|$)|%2e|%2f|%5c|[?#]/i.test(uri);
}
export async function readOwnedFileLedger(owner: string): Promise<Ledger> {
  if (!validOwner(owner)) throw new Error('Invalid file owner');
  const raw = await AsyncStorage.getItem(ownedFileLedgerKey(owner));
  if (raw === null) return { owner, version: 1, intents: [] };
  const value: Ledger = JSON.parse(raw);
  if (value.owner !== owner || value.version !== 1 || !Array.isArray(value.intents) ||
    !value.intents.every(item => typeof item.id === 'string' && typeof item.kind === 'string' && typeof item.opaque === 'boolean' &&
      ['CREATING', 'READY', 'RELEASE_PENDING'].includes(item.state) && Array.isArray(item.paths) && item.paths.every(path => typeof path === 'string')))
    throw new Error('Invalid file ownership ledger');
  return value;
}
async function update(owner: string, mutate: (ledger: Ledger) => void): Promise<void> {
  const task = (queues.get(owner) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const ledger = await readOwnedFileLedger(owner); mutate(ledger);
    const raw = JSON.stringify(ledger); await AsyncStorage.setItem(ownedFileLedgerKey(owner), raw);
    if (await AsyncStorage.getItem(ownedFileLedgerKey(owner)) !== raw) throw new Error('File ownership checkpoint unavailable');
  });
  queues.set(owner, task); await task;
}
export async function otherDeviceFileReferences(owner: string): Promise<Set<string>> {
  const references = new Set<string>();
  const prefixes = ['vitrify.owned-files.v1.', 'vitrify.wardrobe.v1.', 'kabin.vton.history.v1.', 'vitrify.wardrobe-cutout-jobs.v2.'];
  const own = new Set([ownedFileLedgerKey(owner), `vitrify.wardrobe.v1.${encodeURIComponent(owner)}`,
    `kabin.vton.history.v1.${owner}`, `kabin.vton.history.v1.${owner}.cleanup`]);
  const visit = (value: unknown) => {
    if (typeof value === 'string' && value.startsWith('file://')) references.add(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  for (const key of await AsyncStorage.getAllKeys()) if (!own.has(key) && !key.startsWith(`vitrify.wardrobe-cutout-jobs.v2.${encodeURIComponent(owner)}.`) && prefixes.some(prefix => key.startsWith(prefix))) {
    const raw = await AsyncStorage.getItem(key); if (raw !== null) visit(JSON.parse(raw));
  }
  return references;
}
/** Called ONLY inside an admitted account write guard. Intent is read-back before creating any file. */
export async function createOwnedFileUnderGuard(owner: string, kind: string, path: string, create: () => Promise<unknown>): Promise<string> {
  const current = captureOwnerPublication(owner);
  if (accountWriteBlockedNow(owner) || !current()) throw new Error('Owner deletion pending or session changed');
  const directory = FS.documentDirectory && `${FS.documentDirectory}wardrobe/${encodeURIComponent(owner)}/`;
  const ownCache = FS.cacheDirectory && (path.startsWith(`${FS.cacheDirectory}vitrify-owned/${encodeURIComponent(owner)}/`) || path === `${FS.cacheDirectory}kabin-model-${owner}.jpg`);
  if (!(ownCache && safeOwnedCachePath(path)) && !(directory && path.startsWith(directory) && !/[\\]|\/\.{1,2}(?:\/|$)|%2e|%2f|%5c/i.test(path))) throw new Error('Owned output path unsupported');
  if ((await otherDeviceFileReferences(owner)).has(path)) throw new Error('Shared file ownership blocked');
  const id = createUuid();
  await update(owner, ledger => { ledger.intents.push({ id, kind, state: 'CREATING', opaque: false, paths: [path] }); });
  if (accountWriteBlockedNow(owner) || !current()) throw new Error('Owner deletion pending or session changed');
  await create();
  await update(owner, ledger => { ledger.intents.find(item => item.id === id)!.state = 'READY'; });
  return path;
}
/** Native output is opaque until the call returns. A crash in that window leaves an explicit unresolved intent. */
export async function withOwnedNativeFileUnderGuard<T>(owner: string, source: string, create: () => Promise<string>, consume: (uri: string) => Promise<T>): Promise<T> {
  const current = captureOwnerPublication(owner);
  if (accountWriteBlockedNow(owner) || !current()) throw new Error('Owner deletion pending or session changed');
  const id = createUuid();
  await update(owner, ledger => { ledger.intents.push({ id, kind: 'native-manipulator', state: 'CREATING', opaque: true, paths: [] }); });
  if (accountWriteBlockedNow(owner) || !current()) {
    await update(owner, ledger => { ledger.intents = ledger.intents.filter(item => item.id !== id); });
    throw new Error('Owner deletion pending');
  }
  const uri = await create();
  // Only this native producer's dedicated directory is claimable. A returned
  // URI in another app/owner cache is not ownership evidence, even without a ledger.
  const nativeDirectory = FS.cacheDirectory && `${FS.cacheDirectory}ImageManipulator/`;
  if (uri === source || !nativeDirectory || !uri.startsWith(nativeDirectory) || !safeOwnedCachePath(uri) ||
    (await otherDeviceFileReferences(owner)).has(uri)) throw new Error('Native file ownership unsupported/shared');
  await update(owner, ledger => { const item = ledger.intents.find(item => item.id === id)!; item.paths = [uri]; item.state = 'READY'; });
  try { if (accountWriteBlockedNow(owner) || !current()) throw new Error('Owner deletion pending or session changed'); return await consume(uri); }
  finally {
    await update(owner, ledger => { ledger.intents.find(item => item.id === id)!.state = 'RELEASE_PENDING'; });
    if ((await otherDeviceFileReferences(owner)).has(uri)) throw new Error('Shared native file retained');
    await FS.deleteAsync(uri, { idempotent: true });
    if ((await FS.getInfoAsync(uri)).exists) throw new Error('Native file release unverified');
    await update(owner, ledger => { ledger.intents = ledger.intents.filter(item => item.id !== id); });
  }
}

/** Only full account completion may discard recovery ownership metadata; no guessed deletions here. */
export async function clearCompletedOwnedFileLedger(owner: string): Promise<void> {
  const ledger = await readOwnedFileLedger(owner);
  if (ledger.intents.some(item => item.opaque && item.paths.length === 0)) throw new Error('Native ownership unresolved');
  for (const path of ledger.intents.flatMap(item => item.paths)) if ((await FS.getInfoAsync(path)).exists) throw new Error('Owned file cleanup incomplete');
  await AsyncStorage.removeItem(ownedFileLedgerKey(owner));
  if (await AsyncStorage.getItem(ownedFileLedgerKey(owner)) !== null) throw new Error('Ownership recovery ledger removal unverified');
}
