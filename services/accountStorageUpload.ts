import { getRequiredSupabaseClient } from '../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createUuid } from '../lib/analytics';
import { MODEL_PHOTO_MAX_BYTES, MODEL_PHOTO_TOO_LARGE, MODEL_PHOTO_SIZE_MESSAGE } from '../supabase/functions/_shared/accountStorageUploadLimits';
import { recordWardrobeNetworkFailure, wardrobeNetworkErrorMetadata } from '../lib/wardrobeNetworkDiagnostics';
import { accountStorageUploadMimeHeader } from '../lib/accountStorageUploadFetch';

export type AccountStorageBucket = 'model-photos' | 'wardrobe-cutouts';
export interface AccountStorageUpload {
  owner: string;
  bucket: AccountStorageBucket;
  path: string;
  body: Blob | ArrayBuffer;
  contentType: string;
}
const blocked = (code: string, diagnosticSource?: unknown) => Object.assign(
  new Error('Fotoğraf yüklemesi doğrulanamadı. Belirsiz işlem otomatik tekrarlanmayacak.'), { code }, wardrobeNetworkErrorMetadata(diagnosticSource));
export const storageUploadJournalPrefix = (owner: string) => `vitrify.storage-upload.v1.${encodeURIComponent(owner)}.`;
const journalKey = (input: Pick<AccountStorageUpload, 'owner' | 'bucket' | 'path'>) => storageUploadJournalPrefix(input.owner) + encodeURIComponent(input.bucket + '/' + input.path);
type ReconciledState = 'SUCCEEDED' | 'REJECTED_NO_DISPATCH' | 'UNKNOWN';
interface UploadJournal { owner: string; bucket: string; path: string; request: string; state: ReconciledState; operation?: string }
function parseJournal(raw: string, key: string, owner: string): UploadJournal {
  const record = JSON.parse(raw) as UploadJournal;
  if (!record || record.owner !== owner || !['model-photos', 'wardrobe-cutouts'].includes(record.bucket) ||
    typeof record.path !== 'string' || !record.path.startsWith(owner + '/') || typeof record.request !== 'string' || !record.request ||
    !['UNKNOWN', 'SUCCEEDED', 'REJECTED_NO_DISPATCH'].includes(record.state) ||
    key !== storageUploadJournalPrefix(owner) + encodeURIComponent(record.bucket + '/' + record.path) ||
    record.state !== 'UNKNOWN' && (typeof record.operation !== 'string' || !record.operation)) throw blocked('STORAGE_JOURNAL_INVALID');
  return record;
}
export async function accountStorageUploadInventory(owner: string): Promise<{ keys: string[]; unresolved: string[] }> {
  try {
  const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(storageUploadJournalPrefix(owner)));
  const unresolved: string[] = [];
  for (const key of keys) {
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) throw blocked('STORAGE_JOURNAL_CHANGED');
    if (parseJournal(raw, key, owner).state === 'UNKNOWN') unresolved.push(key);
  }
  return { keys, unresolved };
  } catch (error) { recordWardrobeNetworkFailure('storageCheck', error, 'INVENTORY_READ_FAILED'); throw error; }
}
export async function clearCompletedStorageUploadJournal(owner: string): Promise<void> {
  const inventory = await accountStorageUploadInventory(owner);
  if (inventory.unresolved.length) throw blocked('STORAGE_UPLOAD_UNRESOLVED');
  for (const key of inventory.keys) {
    await AsyncStorage.removeItem(key);
    if (await AsyncStorage.getItem(key) !== null) throw blocked('STORAGE_JOURNAL_REMOVAL_UNVERIFIED');
  }
}
const uploads = new Map<string, Promise<void>>();
const reconciliations = new Map<string, Promise<ReconciledState>>();

/** Explicit read-only reconciliation; missing/UNKNOWN/ADMITTED status never unlocks redispatch. */
export function reconcileAccountStorageUpload(input: Pick<AccountStorageUpload, 'owner' | 'bucket' | 'path'>): Promise<ReconciledState> {
  const key = journalKey(input);
  if (uploads.has(key)) {
    const error = blocked('STORAGE_UPLOAD_IN_FLIGHT');
    recordWardrobeNetworkFailure('storageCheck', error, 'RECONCILIATION_FAILED');
    return Promise.reject(error);
  }
  const active = reconciliations.get(key);
  if (active) return active;
  const work = (async () => {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) throw blocked('STORAGE_JOURNAL_MISSING');
    const journal = parseJournal(raw, key, input.owner);
    if (journal.state !== 'UNKNOWN') return journal.state;
    const client = getRequiredSupabaseClient(), identity = await client.auth.getUser();
    if (identity.error || identity.data.user?.id !== input.owner) throw blocked('STORAGE_OWNER_UNVERIFIED');
    const { data, error } = await client.functions.invoke('account-storage-status', {
      body: { request: journal.request, bucket: journal.bucket, path: journal.path },
    });
    if (error) throw blocked('STORAGE_RECONCILIATION_UNAVAILABLE', error);
    if (data?.protocol !== 'vitrify.storage-status.v1' || data.owner !== journal.owner || data.request !== journal.request ||
      data.bucket !== journal.bucket || data.path !== journal.path || typeof data.operation !== 'string' || !data.operation ||
      !['SUCCEEDED', 'REJECTED_NO_DISPATCH', 'UNKNOWN', 'ADMITTED'].includes(data.state)) throw blocked('STORAGE_RECONCILIATION_UNVERIFIED');
    if (!['SUCCEEDED', 'REJECTED_NO_DISPATCH'].includes(data.state)) {
      recordWardrobeNetworkFailure('storageCheck', { code: 'STORAGE_STATUS_PENDING', diagnosticTransport: 'http' }, 'RECONCILIATION_FAILED');
      return 'UNKNOWN' as const;
    }
    // CAS/read-back protects a changed journal; never consume status for a different request.
    if (await AsyncStorage.getItem(key) !== raw) throw blocked('STORAGE_JOURNAL_CHANGED');
    const terminal: ReconciledState = data.state;
    const value = JSON.stringify({ ...journal, state: terminal, operation: data.operation });
    await AsyncStorage.setItem(key, value);
    if (await AsyncStorage.getItem(key) !== value) throw blocked('STORAGE_JOURNAL_UNVERIFIED');
    return terminal;
  })().catch(error => { recordWardrobeNetworkFailure('storageCheck', error, 'RECONCILIATION_FAILED'); throw error; }).finally(() => { reconciliations.delete(key); });
  reconciliations.set(key, work);
  return work;
}

/** No direct Storage fallback. Only a trusted server transport may consume admission. */
export function uploadAccountStorage(input: AccountStorageUpload): Promise<void> {
  const key = journalKey(input);
  if (uploads.has(key) || reconciliations.has(key)) return Promise.reject(blocked('STORAGE_UPLOAD_IN_FLIGHT'));
  const work = uploadUnlocked(input, key).catch(error => { recordWardrobeNetworkFailure('upload', error, 'UPLOAD_FAILED'); throw error; }).finally(() => { uploads.delete(key); });
  uploads.set(key, work);
  return work;
}
async function uploadUnlocked(input: AccountStorageUpload, key: string): Promise<void> {
  const bodyBytes = input.body instanceof ArrayBuffer ? input.body.byteLength : input.body.size;
  if (input.bucket === 'model-photos' && bodyBytes > MODEL_PHOTO_MAX_BYTES) {
    // No dispatch or UNKNOWN journal exists yet. Existing ambiguous-operation
    // reconciliation and fail-closed behavior remain unchanged.
    throw Object.assign(new Error(MODEL_PHOTO_SIZE_MESSAGE), { code: MODEL_PHOTO_TOO_LARGE });
  }
  if (!input.owner || !input.path.startsWith(input.owner + '/') ||
      input.path.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\'))) {
    throw blocked('STORAGE_OWNER_PATH_INVALID');
  }
  const client = getRequiredSupabaseClient();
  const { data: identity, error: identityError } = await client.auth.getUser();
  if (identityError || identity.user?.id !== input.owner) throw blocked('STORAGE_OWNER_UNVERIFIED');
  const prior = await AsyncStorage.getItem(key);
  if (prior && parseJournal(prior, key, input.owner).state === 'UNKNOWN') throw blocked('STORAGE_UPLOAD_UNRESOLVED');
  const journal: UploadJournal = { owner: input.owner, bucket: input.bucket, path: input.path, request: createUuid(), state: 'UNKNOWN' };
  const save = async () => {
    const value = JSON.stringify(journal);
    await AsyncStorage.setItem(key, value);
    if (await AsyncStorage.getItem(key) !== value) throw blocked('STORAGE_JOURNAL_UNVERIFIED');
  };
  // Possible dispatch is durable before bytes reach the transport. No body/token is stored.
  await save();
  let result;
  try { result = await client.functions.invoke('account-storage-upload', {
      body: input.body,
      headers: { [accountStorageUploadMimeHeader]: input.contentType, 'x-upload-bucket': input.bucket, 'x-upload-path': input.path, 'x-upload-request': journal.request },
    });
  } catch (error) { throw blocked('STORAGE_UPLOAD_UNCONFIRMED', error); }
  const { data, error } = result;
  if (error) throw blocked('STORAGE_UPLOAD_UNCONFIRMED', error);
  if (data?.protocol !== 'vitrify.storage-upload.v1' || data.state !== 'SUCCEEDED' ||
    data.owner !== input.owner || data.bucket !== input.bucket || data.path !== input.path || typeof data.operation !== 'string' || !data.operation) {
    // Never retry an ambiguous request or fall back to direct Storage.
    throw Object.assign(blocked('STORAGE_UPLOAD_UNCONFIRMED'), { diagnosticCode: 'STORAGE_UPLOAD_RESPONSE_INVALID' });
  }
  journal.state = 'SUCCEEDED'; journal.operation = data.operation;
  await save();
}
