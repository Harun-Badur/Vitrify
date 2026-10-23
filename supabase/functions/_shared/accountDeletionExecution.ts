import type { DeletionAdapter, DeletionReceipt } from './accountDeletionFoundation.ts';
import { UPLOAD_HANDLER_DEADLINE_MS } from './accountStorageUploadHandler.ts';

export const DRAIN_MARGIN_MS = 30_000;
export const DELETION_DRAIN_WINDOW_MS = UPLOAD_HANDLER_DEADLINE_MS + DRAIN_MARGIN_MS;
export const STORAGE_EMPTY_CONFIRM_DELAY_MS = 100;
export const STORAGE_SWEEP_ATTEMPTS = 2;
export const AUTH_OWNERSHIP_ATTEMPTS = 3;
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Measurements are fresh on recovery; a persisted VERIFIED layer is historical. */
export function verifiedDeletionStorage(sweep: DeletionAdapter, delay = wait): DeletionAdapter {
  const verify: DeletionAdapter['verify'] = async receipt => {
    const first = await sweep.verify(receipt);
    if (!first.complete) return { complete: false, evidence: [] };
    await delay(STORAGE_EMPTY_CONFIRM_DELAY_MS);
    const second = await sweep.verify(receipt);
    return { complete: second.complete, evidence: second.complete ?
      ['durable fence/lease and both owned Storage prefixes verified empty twice'] : [] };
  };
  return { idempotent: true, verify, cleanup: async receipt => {
    for (let attempt = 0; attempt < STORAGE_SWEEP_ATTEMPTS; attempt++) {
      await sweep.cleanup(receipt);
      if ((await verify(receipt)).complete) return;
    }
    throw new Error('Storage verification remains nonempty');
  } };
}

export async function deleteAuthAfterStorage(receipt: DeletionReceipt, storage: DeletionAdapter,
  purge: () => Promise<void>, deleteUser: () => Promise<void>): Promise<void> {
  for (let attempt = 0; attempt < AUTH_OWNERSHIP_ATTEMPTS; attempt++) {
    if (!(await storage.verify(receipt)).complete) await storage.cleanup(receipt);
    if (!(await storage.verify(receipt)).complete) throw new Error('Storage remains before Auth');
    await purge();
    try { await deleteUser(); return; }
    catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'STORAGE_OBJECTS_REMAIN' ||
        attempt + 1 === AUTH_OWNERSHIP_ATTEMPTS) throw error;
      await storage.cleanup(receipt);
    }
  }
}
