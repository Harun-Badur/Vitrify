import { logger } from '../lib/logger';
import { getRequiredSupabaseClient } from '../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createUuid, quiesceAnalyticsForDeletion } from '../lib/analytics';
import { createDeletionReceipt, DELETION_DECLARATIONS, deletionCompletion, isDeletionReceipt, runDeletionFoundation, type DeletionReceipt, type DeletionLayer } from '../lib/accountDeletionFoundation';
import { deviceDeletionAdapters, type LocalDeletionInventory } from './deviceDeletionAdapters';
import { clearCompletedOwnedFileLedger } from './ownedDeviceFiles';
import { getRandomBytesAsync } from 'expo-crypto';

export const ACCOUNT_DELETION_PROTOCOL = 'vitrify.deletion.v1';
/** Pending is not completion and never starts a fresh deletion identity. */
export class AccountDeletionPendingError extends Error {
  readonly code = 'DELETION_PENDING';
  constructor(readonly automaticRetry = true) {
    super('Hesap silme bekliyor; tamamlandığı henüz doğrulanamadı. Kalıcı kurtarma bilgisi korundu; aynı cihazda mevcut işlemi devam ettirebilirsin.');
    this.name = 'AccountDeletionPendingError';
  }
}
export const accountDeletionCheckpointKey = (userId: string) => `vitrify.deletion-checkpoint.v1.${encodeURIComponent(userId)}`;
type SavedDeletionReceipt = DeletionReceipt & { recoveryToken?: string; deviceInventory?: LocalDeletionInventory };
export interface AccountDeletionProgress {
  phase: 'preparing' | 'processing' | 'waiting' | 'completed' | 'stopped';
  message: string;
  attempt: number;
}
const progressByOwner = new Map<string, AccountDeletionProgress>();
const progressListeners = new Set<() => void>();
const activeDeletionFlows = new Map<string, Promise<void>>();
// Client scheduling only. The server still computes/enforces drain with DB time.
const CONTINUATION_DELAYS_MS = [90_000, 15_000, 30_000] as const;
export function subscribeAccountDeletionProgress(listener: () => void): () => void {
  progressListeners.add(listener);
  return () => { progressListeners.delete(listener); };
}
export function getAccountDeletionProgress(owner: string | null): AccountDeletionProgress | null {
  if (owner) return progressByOwner.get(owner) ?? null;
  // Recovery may outlive Auth. Never expose another owner's progress to account B.
  return [...progressByOwner.values()].find(value => value.phase !== 'completed') ?? null;
}
export function dismissAccountDeletionProgress(owner: string): void {
  if (progressByOwner.get(owner)?.phase !== 'stopped' || activeDeletionFlows.has(owner)) return;
  progressByOwner.delete(owner);
  for (const listener of progressListeners) listener();
}
function publishDeletionProgress(owner: string, progress: AccountDeletionProgress): void {
  progressByOwner.set(owner, progress);
  for (const listener of progressListeners) listener();
}
function mayContinueReceipt(receipt: DeletionReceipt): boolean {
  return (['write_fence','storage','jobs_payload','auth','db','recommendation_cache'] as const)
    .every(layer => !['UNKNOWN','RETRY_REQUIRED','BLOCKED'].includes(receipt.layers[layer].state));
}

/** One user authorization, one durable identity; bounded continuation, no new POST identity. */
export function completeAccountDeletion(runtime: AccountDeletionRuntime): Promise<void> {
  return continueDeletionFlow(runtime.inventory.subjectId, () => deleteAccount(runtime));
}
function continueDeletionFlow(owner: string, initial: () => Promise<void>): Promise<void> {
  const active = activeDeletionFlows.get(owner);
  if (active) return active;
  const work = (async () => {
    for (let attempt = 0; attempt <= CONTINUATION_DELAYS_MS.length; attempt++) {
      publishDeletionProgress(owner, { phase: attempt === 0 ? 'preparing' : 'processing', attempt: attempt + 1,
        message: attempt === 0 ? 'Mevcut silme isteği hazırlanıyor ve doğrulanıyor.' : 'Aynı kalıcı silme isteği sunucuda kontrol ediliyor.' });
      try {
        await (attempt === 0 ? initial() : resumeAccountDeletion(owner));
        publishDeletionProgress(owner, { phase: 'completed', attempt: attempt + 1, message: 'Hesap silme tamamlandığı doğrulandı.' });
        return;
      } catch (error) {
        if (!(error instanceof AccountDeletionPendingError) || !error.automaticRetry || attempt === CONTINUATION_DELAYS_MS.length) {
          publishDeletionProgress(owner, { phase: 'stopped', attempt: attempt + 1,
            message: 'Otomatik devam durdu. Tamamlanma doğrulanmadı; varsa kalıcı kurtarma kaydı korundu. Ağ veya sunucu sorunu giderildiğinde mevcut işlem devam ettirilebilir.' });
          throw error;
        }
        const delay = CONTINUATION_DELAYS_MS[attempt];
        publishDeletionProgress(owner, { phase: 'waiting', attempt: attempt + 1,
          message: `Güvenli bekleme sürüyor. ${delay / 1000} saniye sonra aynı isteği otomatik kontrol edeceğiz; yeniden silme onayı gerekmez.` });
        await new Promise<void>(resolve => setTimeout(resolve, delay));
      }
    }
  })().finally(() => { activeDeletionFlows.delete(owner); });
  activeDeletionFlows.set(owner, work);
  return work;
}

async function deletionFetch(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  // Server cleanup has a 50s work budget; allow its response plus network margin.
  const timer = setTimeout(() => controller.abort(), 75_000);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
export interface AccountDeletionRuntime {
  inventory: LocalDeletionInventory;
  /** Fresh snapshot only after persisted fence + actual writer drain, before removing metadata. */
  collectAfterFence?: () => Promise<LocalDeletionInventory>;
  /** Must clear and verify all owned app/session/recommendation memory and in-flight publishers. */
  clearAndVerifyMemory: () => Promise<boolean>;
}

interface DeleteAccountResponse {
  detail?: unknown;
}

const getDeleteAccountUrl = (): string => {
  const proxyUrl = process.env.EXPO_PUBLIC_VTON_PROXY_URL?.trim().replace(
    /\/+$/,
    '',
  );

  if (proxyUrl) {
    return proxyUrl.replace(/\/vton-proxy$/, '/delete-account');
  }

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim().replace(
    /\/+$/,
    '',
  );
  if (!supabaseUrl) {
    throw new Error('Hesap silme adresi çözümlenemedi.');
  }

  return `${supabaseUrl}/functions/v1/delete-account`;
};

const readDetail = (body: string): string | null => {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null && 'detail' in parsed) {
      const detail = (parsed as DeleteAccountResponse).detail;
      if (typeof detail === 'string' && detail.length > 0) {
        return detail;
      }
    }
  } catch (error) {
    logger.warn('Hesap silme yanıtı çözümlenemedi', { error });
  }
  return null;
};

export const deleteAccount = async (runtime?: AccountDeletionRuntime): Promise<void> => {
  if (runtime) {
    const raw = await AsyncStorage.getItem(accountDeletionCheckpointKey(runtime.inventory.subjectId));
    if (raw) {
      const saved: SavedDeletionReceipt = JSON.parse(raw);
      if (saved.subjectId === runtime.inventory.subjectId && deletionCompletion(saved).appControlledComplete) {
        if (saved.recoveryToken || saved.deviceInventory) await persistCompletedDeletion(accountDeletionCheckpointKey(saved.subjectId), saved);
        return;
      }
      if (saved.subjectId === runtime.inventory.subjectId && saved.recoveryToken &&
        (['queue', 'async_storage', 'local_files', 'memory_cache'] as const).every(layer => saved.layers?.[layer]?.state === 'VERIFIED')) {
        return resumeAccountDeletion(runtime.inventory.subjectId);
      }
    }
  }
  const client = getRequiredSupabaseClient();
  const { data, error } = await client.auth.getSession();

  if (error) {
    logger.error('Oturum okunamadı', { detail: error.message });
    throw new Error('Oturum doğrulanamadı. Çıkıp tekrar giriş yapmayı dene.');
  }

  const accessToken = data.session?.access_token?.trim();
  if (!accessToken) {
    throw new Error('Hesabı silmek için giriş yapmalısın.');
  }

  const userId = data.session?.user.id;
  if (!userId || !runtime?.inventory.coverageVerified || runtime.inventory.subjectId !== userId) {
    throw new Error('Doğrulanmış yerel hesap silme altyapısı hazır değil: geçici dosya ownership ve in-flight yayıncı kapsamı bekliyor.');
  }
  const url = getDeleteAccountUrl();
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` };
  const readiness = await deletionFetch(url, { method: 'GET', headers });
  const capabilities = readiness.ok ? await readiness.json() : null;
  if (capabilities?.protocol !== ACCOUNT_DELETION_PROTOCOL || capabilities?.ready !== true || capabilities?.postAuthRecovery !== true) {
    throw new Error('Doğrulanabilir hesap silme koordinatörü hazır değil.');
  }
  const key = accountDeletionCheckpointKey(userId), stored = await AsyncStorage.getItem(key);
  const receipt: DeletionReceipt & { deviceInventory?: LocalDeletionInventory; recoveryToken?: string } = stored ? JSON.parse(stored) : createDeletionReceipt(createUuid(), userId);
  if (!isDeletionReceipt(receipt) || receipt.subjectId !== userId) throw new Error('Hesap silme checkpoint geçersiz.');
  if (!receipt.recoveryToken) {
    // The async native API has no development Math.random fallback. Web Crypto
    // is not guaranteed in Expo Go; failure still stops before fence/POST.
    try {
      const bytes = await getRandomBytesAsync(32);
      if (!(bytes instanceof Uint8Array) || bytes.length !== 32) throw new Error('Invalid secure bytes');
      receipt.recoveryToken = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    } catch {
      throw new Error('Güvenli hesap kurtarma anahtarı üretilemiyor.');
    }
  }
  // Native randomness is asynchronous: recheck the actor before any checkpoint,
  // local fence/cleanup or destructive request. getSession reads the local session.
  const actor = await client.auth.getSession();
  if (actor.error || actor.data.session?.user.id !== userId) {
    throw new Error('Oturum değişti; hesap silme başlatılmadı.');
  }
  let inventory = receipt.deviceInventory ?? runtime.inventory;
  if (runtime.collectAfterFence) {
    await quiesceAnalyticsForDeletion(userId);
    const fresh = await runtime.collectAfterFence();
    inventory = { ...fresh, ownedFiles: [...new Set([...inventory.ownedFiles, ...fresh.ownedFiles])] };
  }
  if (inventory.subjectId !== userId || inventory.coverageVerified !== true || !Array.isArray(inventory.ownedFiles) ||
    !inventory.ownedFiles.every(uri => typeof uri === 'string') || !Array.isArray(inventory.extraOwnedKeys) ||
    !inventory.extraOwnedKeys.every(item => typeof item === 'string')) throw new Error('Kalıcı ownership inventory geçersiz.');
  const checkpoint = async (snapshot: DeletionReceipt) => {
    const value = JSON.stringify({ ...snapshot, deviceInventory: inventory, recoveryToken: receipt.recoveryToken });
    await AsyncStorage.setItem(key, value);
    if (await AsyncStorage.getItem(key) !== value) throw new Error('Hesap silme checkpoint doğrulanamadı.');
  };
  await checkpoint(receipt);
  const local = deviceDeletionAdapters(inventory, runtime.clearAndVerifyMemory);
  await runDeletionFoundation(receipt, local, checkpoint);
  for (const layer of ['queue', 'async_storage', 'local_files', 'memory_cache'] as DeletionLayer[]) {
    if (receipt.layers[layer].state !== 'VERIFIED') throw new Error('Yerel hesap temizliği bekliyor; tekrar denenebilir.');
  }

  const response = await deletionFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ requestId: receipt.requestId, recoveryToken: receipt.recoveryToken, deviceCheckpoint: {
      requestId: receipt.requestId, subjectId: receipt.subjectId, layers: receipt.layers,
    } }),
  });

  if (!response.ok) {
    if (response.status === 503) throw new AccountDeletionPendingError();
    const body = await response.text();
    const detail = readDetail(body);
    logger.error('Hesap silinemedi', { status: response.status });
    throw new Error(detail ?? 'Hesap silinemedi. Lütfen tekrar dene.');
  }

  const result = await response.json();
  if (result?.protocol !== ACCOUNT_DELETION_PROTOCOL || !isDeletionReceipt(result.receipt) || result.receipt.subjectId !== userId ||
    result.receipt?.requestId !== receipt.requestId) throw new Error('Hesap silme completion doğrulanamadı.');
  for (const layer of ['write_fence', 'storage', 'jobs_payload', 'auth', 'db', 'recommendation_cache'] as DeletionLayer[]) {
    const progress = result.receipt.layers?.[layer];
    if (!progress || !Array.isArray(progress.evidence) || !progress.evidence.every((value: unknown) => typeof value === 'string' && value.trim())) {
      throw new Error('Hesap silme katman kanıtı eksik.');
    }
    receipt.layers[layer] = progress;
  }
  await checkpoint(receipt);
  if (!deletionCompletion(receipt).appControlledComplete) throw new AccountDeletionPendingError(mayContinueReceipt(receipt));
  await persistCompletedDeletion(key, receipt);
};

async function persistCompletedDeletion(key: string, receipt: DeletionReceipt): Promise<void> {
  // UNKNOWN upload journals remain owned by the unchanged upload protocol.
  // Account completion must never wait for upload reconciliation/terminal proof.
  receipt.layers.vendor.evidence = [...new Set([...receipt.layers.vendor.evidence, ...DELETION_DECLARATIONS])];
  await clearCompletedOwnedFileLedger(receipt.subjectId);
  // Keep only the tombstone/proof; completed local paths and capability are no longer needed.
  const value = JSON.stringify({ requestId: receipt.requestId, subjectId: receipt.subjectId, layers: receipt.layers });
  await AsyncStorage.setItem(key, value);
  if (await AsyncStorage.getItem(key) !== value) throw new Error('Silme completion checkpoint doğrulanamadı.');
}

/** Explicit recovery entry point for a saved request; deliberately never reads Auth/session. */
const activeRecoveries = new Map<string, Promise<void>>();
export function resumeAccountDeletion(userId: string): Promise<void> {
  const active = activeRecoveries.get(userId);
  if (active) return active;
  const work = resumeAccountDeletionUnlocked(userId).finally(() => { activeRecoveries.delete(userId); });
  activeRecoveries.set(userId, work);
  return work;
}
async function resumeAccountDeletionUnlocked(userId: string): Promise<void> {
  const key = accountDeletionCheckpointKey(userId);
  const raw = await AsyncStorage.getItem(key);
  if (!raw) throw new Error('Kalıcı hesap silme isteği bulunamadı.');
  const receipt: SavedDeletionReceipt = JSON.parse(raw);
  if (!isDeletionReceipt(receipt) || receipt.subjectId !== userId) throw new Error('Kurtarma checkpoint geçersiz.');
  if (deletionCompletion(receipt).appControlledComplete) {
    if (receipt.recoveryToken || receipt.deviceInventory) await persistCompletedDeletion(key, receipt);
    return;
  }
  if (typeof receipt.recoveryToken !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.recoveryToken) ||
    !(['queue', 'async_storage', 'local_files', 'memory_cache'] as const).every(layer => receipt.layers[layer]?.state === 'VERIFIED')) {
    throw new Error('Kurtarma kimliği veya cihaz kanıtı geçersiz.');
  }
  const response = await deletionFetch(getDeleteAccountUrl(), { method: 'POST', headers: {
    'Content-Type': 'application/json', 'x-deletion-recovery': receipt.recoveryToken,
  }, body: JSON.stringify({ requestId: receipt.requestId }) });
  if (!response.ok) {
    if (response.status === 503) throw new AccountDeletionPendingError();
    throw new Error('Hesap silme bekliyor; tekrar denenebilir.');
  }
  const result = await response.json();
  if (result.protocol !== ACCOUNT_DELETION_PROTOCOL || !isDeletionReceipt(result.receipt) || result.receipt.subjectId !== userId ||
    result.receipt.requestId !== receipt.requestId) throw new Error('Kurtarma completion doğrulanamadı.');
  // Device/provider evidence remains the saved evidence; only server layers may advance.
  for (const layer of ['write_fence', 'storage', 'jobs_payload', 'auth', 'db', 'recommendation_cache'] as DeletionLayer[]) {
    receipt.layers[layer] = result.receipt.layers[layer];
  }
  const value = JSON.stringify(receipt);
  await AsyncStorage.setItem(key, value);
  if (await AsyncStorage.getItem(key) !== value) throw new Error('Kurtarma checkpoint doğrulanamadı.');
  if (!deletionCompletion(receipt).appControlledComplete) throw new AccountDeletionPendingError(mayContinueReceipt(receipt));
  await persistCompletedDeletion(key, receipt);
}

/** Startup recovery also works after Supabase has dropped the deleted user's session. */
export async function resumePendingAccountDeletions(restoreRuntime?: (owner: string) => Promise<AccountDeletionRuntime>): Promise<void> {
  const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith('vitrify.deletion-checkpoint.v1.'));
  for (const key of keys) {
    try {
      const receipt: SavedDeletionReceipt = JSON.parse(await AsyncStorage.getItem(key) ?? 'null');
      if (!isDeletionReceipt(receipt) || key !== accountDeletionCheckpointKey(receipt.subjectId)) continue;
      if (deletionCompletion(receipt).appControlledComplete) {
        if (receipt.recoveryToken || receipt.deviceInventory) await persistCompletedDeletion(key, receipt);
        publishDeletionProgress(receipt.subjectId, { phase: 'completed', attempt: 0, message: 'Kalıcı tamamlanma kaydı doğrulandı.' });
        continue;
      }
      if (typeof receipt.recoveryToken !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.recoveryToken)) continue;
      const deviceVerified = (['queue', 'async_storage', 'local_files', 'memory_cache'] as const)
        .every(layer => receipt.layers?.[layer]?.state === 'VERIFIED');
      if (deviceVerified) await continueDeletionFlow(receipt.subjectId, () => resumeAccountDeletion(receipt.subjectId));
      else if (restoreRuntime) await continueDeletionFlow(receipt.subjectId, async () => {
        // Existing local cleanup/checkpoint machinery; never forge device proof.
        await deleteAccount(await restoreRuntime(receipt.subjectId));
      });
    } catch { logger.warn('Hesap silme recovery bekliyor; kalıcı istek korundu.'); }
  }
}
