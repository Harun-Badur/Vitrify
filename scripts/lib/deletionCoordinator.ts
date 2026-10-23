import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createDeletionReceipt, runDeletionFoundation, type DeletionAdapter, type DeletionLayer,
  type DeletionReceipt } from '../../lib/accountDeletionFoundation';

export interface DeletionOwnershipSnapshot {
  subjectId: string; schemaVersion: 1; coverageVerified: boolean;
  tables: readonly { table: string; ownerColumn: string }[]; buckets: readonly string[]; localFiles: readonly string[]; localKeys: readonly string[];
}
export interface DurableDeletionRecord { receipt: DeletionReceipt; fenced: true; inventory?: DeletionOwnershipSnapshot }
export interface DeletionStore {
  exclusive<T>(subjectId: string, operation: () => Promise<T>): Promise<T>;
  read(subjectId: string): Promise<DurableDeletionRecord | undefined>;
  write(record: DurableDeletionRecord): Promise<void>;
}

/** Trusted Node/offline coordinator store. Not a substitute for a deployed multi-host DB transaction. */
export class FileDeletionStore implements DeletionStore {
  constructor(private readonly root: string) {}
  private file(subjectId: string) {
    if (!subjectId.trim()) throw new Error('Subject required');
    return path.join(this.root, createHash('sha256').update(subjectId).digest('hex'));
  }
  async exclusive<T>(subjectId: string, operation: () => Promise<T>): Promise<T> {
    await mkdir(this.root, { recursive: true });
    const lockPath = this.file(subjectId) + '.lock';
    // No automatic stale-lock theft: a crashed operator/worker must be proved dead first.
    const lock = await open(lockPath, 'wx', 0o600);
    try { await lock.writeFile(String(process.pid)); await lock.sync(); return await operation(); }
    finally { await lock.close(); await unlink(lockPath); }
  }
  async read(subjectId: string): Promise<DurableDeletionRecord | undefined> {
    let text: string;
    try { text = await readFile(this.file(subjectId) + '.json', 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
    const record = JSON.parse(text) as DurableDeletionRecord;
    if (record.fenced !== true || record.receipt?.subjectId !== subjectId || !record.receipt.requestId || !record.receipt.layers) {
      throw new Error('Invalid deletion checkpoint');
    }
    return record;
  }
  async write(record: DurableDeletionRecord): Promise<void> {
    const destination = this.file(record.receipt.subjectId) + '.json', temporary = destination + '.' + randomUUID() + '.tmp';
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(record)); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, destination);
  }
}

/** Authentication/authorization occurs before invoking this trusted server entry point. */
export async function coordinateDeletion(store: DeletionStore, subjectId: string, requestId: string,
  adapters: Partial<Record<DeletionLayer, DeletionAdapter>>, writerCoverageVerified: boolean,
  ownership?: DeletionOwnershipSnapshot): Promise<DeletionReceipt> {
  return store.exclusive(subjectId, async () => {
    const existing = await store.read(subjectId);
    const receipt = existing?.receipt ?? createDeletionReceipt(requestId, subjectId);
    const inventory = existing?.inventory ?? ownership;
    if (existing?.inventory && ownership && JSON.stringify(existing.inventory) !== JSON.stringify(ownership)) throw new Error('Ownership inventory drift');
    const covered = writerCoverageVerified && inventory?.coverageVerified === true && inventory.subjectId === subjectId && inventory.schemaVersion === 1;
    await store.write({ receipt, fenced: true, inventory }); // irrevocable tombstone + inventory before cleanup
    const fence: DeletionAdapter = { idempotent: true, cleanup: async () => undefined,
      verify: async () => ({ complete: covered && (await store.read(subjectId))?.fenced === true,
        evidence: covered ? ['durable tombstone + ownership snapshot; all inventoried writers use exclusive guard'] : [] }) };
    return runDeletionFoundation(receipt, { ...adapters, write_fence: fence }, snapshot => store.write({ receipt: snapshot, fenced: true, inventory }));
  });
}

/** Holds the same owner lock throughout a write. Deletion cannot race a guarded writer. */
export async function withDeletionWriteGuard<T>(store: DeletionStore, subjectId: string, write: () => Promise<T>): Promise<T> {
  return store.exclusive(subjectId, async () => {
    if (await store.read(subjectId)) throw new Error('Owner is deletion-fenced');
    return write();
  });
}
