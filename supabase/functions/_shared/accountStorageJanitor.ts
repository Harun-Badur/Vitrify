import { createDeletionReceipt } from './accountDeletionFoundation.ts';
import { deletionStorageAdapter, listOwnedStorageObjects, type DeletionStoragePort } from './accountDeletionStorage.ts';

export interface StorageJanitorCandidate { owner: string; request: string }
export interface StorageJanitorPort {
  // Trusted server binding must revalidate the SAME durable deletion request,
  // permanent owner fence AND Auth absence on every call. An orphan listing or
  // age/expiry alone never grants removal authority. No client evidence accepted.
  assertDeletedOwner(candidate: StorageJanitorCandidate): Promise<void>;
  // Includes closed legacy/signed/TUS admission and physical drain. Janitor does
  // not turn an UNKNOWN operation into terminal or certify account completion.
  barrier(candidate: StorageJanitorCandidate): Promise<boolean>;
  list(bucket: string, prefix: string, offset: number): Promise<{ name: string; id: string | null }[]>;
  remove: DeletionStoragePort['remove'];
}
export type StorageJanitorResult = { state: 'VERIFIED' | 'BLOCKED'; code: string };

/** One bounded attempt per scheduled invocation; no retry/reset/history repair.
 * Shares the deletion sweep's bucket, ownership, chunking and barrier guards.
 * Scheduler/DB authorization binding intentionally required, never inferred.
 */
export async function runStorageJanitor(port: StorageJanitorPort,
  candidate: StorageJanitorCandidate): Promise<StorageJanitorResult> {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (!candidate || !uuid.test(candidate.owner) || typeof candidate.request !== 'string' ||
    !candidate.request.trim() || candidate.request.length > 200) {
    return { state: 'BLOCKED', code: 'JANITOR_IDENTITY_INVALID' };
  }
  // Copy before the first await; a mutable caller cannot switch owners mid-sweep.
  const identity = Object.freeze({ owner: candidate.owner, request: candidate.request });
  const guard = async () => {
    await port.assertDeletedOwner(identity);
    if (await port.barrier(identity) !== true) throw new Error('Janitor drain unverified');
  };
  const adapter = deletionStorageAdapter({
    assertLease: async owner => {
      if (owner !== identity.owner) throw new Error('Janitor owner mismatch');
      await port.assertDeletedOwner(identity);
    },
    barrier: () => port.barrier(identity),
    objects: (bucket, owner) => listOwnedStorageObjects(owner,
      (prefix, offset) => port.list(bucket, prefix, offset), guard),
    remove: (bucket, paths) => port.remove(bucket, paths),
  });
  try {
    const receipt = createDeletionReceipt(identity.request, identity.owner);
    await adapter.cleanup(receipt);
    const proof = await adapter.verify(receipt);
    return proof.complete ? { state: 'VERIFIED', code: 'JANITOR_SWEEP_VERIFIED' } :
      { state: 'BLOCKED', code: 'JANITOR_OBJECTS_REMAIN' };
  } catch {
    // Partial removal is possible; neither claim completion nor leak SDK errors.
    return { state: 'BLOCKED', code: 'JANITOR_SWEEP_UNVERIFIED' };
  }
}

// The legacy candidate API above is retained for existing callers/tests only.
// The daily Edge entry point exclusively uses this bounded A1 implementation.
export const JANITOR_BUCKETS = ['model-photos', 'wardrobe-cutouts'] as const;
export const JANITOR_MIN_OBJECT_AGE_MS = 60 * 60 * 1000;
export const JANITOR_FAILED_AGE_HOURS = 24;
export const JANITOR_FAILED_ATTEMPTS = 2;
export const JANITOR_RETENTION_DAYS = 90;
export const JANITOR_PAGE_SIZE = 100;
export const JANITOR_MAX_PAGES = 200;
export const JANITOR_MAX_OBJECTS = 1000;
export const JANITOR_MAX_OWNERS = 1000;
export interface JanitorEntry { name: string; id: string | null; created_at?: string | null; updated_at?: string | null }
export interface JanitorOwner { subject: string; authExists: boolean; staleFailed: boolean; activeLease: boolean }
export interface JanitorCounts { found: number; deleted: number; skipped: number; errors: number; retentionFound: number; retentionDeleted: number }
export interface ScheduledJanitorPort {
  list(bucket: string, prefix: string, offset: number): Promise<JanitorEntry[]>;
  /** Service-only batch RPC. Missing rows/errors never mean Auth absence. */
  metadata(owners: string[]): Promise<JanitorOwner[]>;
  remove(bucket: string, paths: string[]): Promise<void>;
  retention(dryRun: boolean): Promise<{ found: number; deleted: number }>;
  now?(): number;
  log?(event: 'JANITOR_RUN', counts: JanitorCounts): void;
}
const OWNER_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const safeName = (value: string) => !!value && value !== '.' && value !== '..' && !/[\\/\u0000]/.test(value);

/** Default dry-run. All inventory pages are collected before any remove, so
 * our deletions cannot shift offset pagination. Concurrent external changes
 * can still be missed; the next daily run handles them. No UNKNOWN transitions.
 */
export async function runScheduledStorageJanitor(port: ScheduledJanitorPort, deleteEnabled = false): Promise<JanitorCounts> {
  deleteEnabled = deleteEnabled === true;
  const counts: JanitorCounts = { found: 0, deleted: 0, skipped: 0, errors: 0, retentionFound: 0, retentionDeleted: 0 };
  const now = (port.now ?? Date.now)();
  let pages = 0;
  const roots: { bucket: string; owner: string }[] = [];
  const objects: { bucket: string; owner: string; path: string; old: boolean }[] = [];
  const read = async (bucket: string, prefix: string, offset: number) => {
    if (pages >= JANITOR_MAX_PAGES) return null;
    pages++;
    try {
      const entries = await port.list(bucket, prefix, offset);
      if (!Array.isArray(entries) || entries.length > JANITOR_PAGE_SIZE) throw new Error('Invalid page');
      return entries;
    } catch { counts.errors++; return null; }
  };
  // Root snapshot before any object removal (both allowlisted buckets only).
  for (const bucket of JANITOR_BUCKETS) {
    for (let offset = 0; pages < JANITOR_MAX_PAGES && roots.length < JANITOR_MAX_OWNERS; offset += JANITOR_PAGE_SIZE) {
      const entries = await read(bucket, '', offset); if (!entries) break;
      for (const item of entries) {
        if (roots.length >= JANITOR_MAX_OWNERS) break;
        if (item.id === null && OWNER_UUID.test(item.name)) roots.push({ bucket, owner: item.name });
        else counts.skipped++;
      }
      if (entries.length < JANITOR_PAGE_SIZE) break;
    }
  }
  for (const root of roots) {
    const folders = [root.owner]; const seen = new Set(folders);
    for (let cursor = 0; cursor < folders.length && pages < JANITOR_MAX_PAGES && objects.length < JANITOR_MAX_OBJECTS; cursor++) {
      const prefix = folders[cursor];
      for (let offset = 0; pages < JANITOR_MAX_PAGES && objects.length < JANITOR_MAX_OBJECTS; offset += JANITOR_PAGE_SIZE) {
        const entries = await read(root.bucket, prefix, offset); if (!entries) break;
        for (const item of entries) {
          if (objects.length >= JANITOR_MAX_OBJECTS) break;
          if (typeof item.name !== 'string' || !safeName(item.name)) { counts.skipped++; continue; }
          const path = prefix + '/' + item.name;
          if (item.id === null) {
            if (!seen.has(path) && folders.length < JANITOR_MAX_PAGES * JANITOR_PAGE_SIZE) { seen.add(path); folders.push(path); }
            continue;
          }
          if (typeof item.id !== 'string' || !item.id) { counts.skipped++; continue; }
          const created = Date.parse(item.created_at ?? '');
          const updated = item.updated_at === undefined ? created : Date.parse(item.updated_at ?? '');
          const age = now - Math.max(created, updated);
          objects.push({ ...root, path, old: Number.isFinite(age) && age >= JANITOR_MIN_OBJECT_AGE_MS }); counts.found++;
        }
        if (entries.length < JANITOR_PAGE_SIZE) break;
      }
    }
  }
  const owners = [...new Set(objects.map(item => item.owner))];
  const inspect = async (ids: string[]) => {
    const result = new Map<string, JanitorOwner>();
    try {
      const rows = await port.metadata(ids);
      if (!Array.isArray(rows)) throw new Error('Invalid metadata');
      for (const id of ids) {
        const matches = rows.filter(row => row?.subject === id);
        if (matches.length === 1 && typeof matches[0].authExists === 'boolean' && typeof matches[0].staleFailed === 'boolean' && typeof matches[0].activeLease === 'boolean') result.set(id, matches[0]);
        else counts.errors++;
      }
    } catch { counts.errors++; }
    return result;
  };
  const metadata = new Map<string, JanitorOwner>();
  for (let offset = 0; offset < owners.length; offset += JANITOR_PAGE_SIZE) {
    for (const [key, value] of await inspect(owners.slice(offset, offset + JANITOR_PAGE_SIZE))) metadata.set(key, value);
  }
  const eligible = (row?: JanitorOwner) => !!row && !row.activeLease && (!row.authExists || row.staleFailed);
  const groups = new Map<string, typeof objects>();
  for (const item of objects) {
    if (!item.old || !eligible(metadata.get(item.owner))) { counts.skipped++; continue; }
    if (!deleteEnabled) { counts.skipped++; continue; }
    const key = item.bucket + ':' + item.owner;
    const group = groups.get(key) ?? []; group.push(item); groups.set(key, group);
  }
  for (const group of groups.values()) {
    for (let offset = 0; offset < group.length; offset += JANITOR_PAGE_SIZE) {
      const batch = group.slice(offset, offset + JANITOR_PAGE_SIZE);
      // Check current lease/failure eligibility immediately before each remove.
      // This is conservative observation, not a lock spanning the Storage API.
      const fresh = await inspect([batch[0].owner]);
      if (!eligible(fresh.get(batch[0].owner))) { counts.skipped += batch.length; continue; }
      try { await port.remove(batch[0].bucket, batch.map(item => item.path)); counts.deleted += batch.length; }
      catch { counts.errors++; }
    }
  }
  try {
    const retention = await port.retention(!deleteEnabled);
    if (!retention || !Number.isSafeInteger(retention.found) || !Number.isSafeInteger(retention.deleted) || retention.found < 0 || retention.deleted < 0 || retention.deleted > retention.found || (!deleteEnabled && retention.deleted !== 0)) throw new Error('Invalid retention counts');
    counts.retentionFound = retention.found; counts.retentionDeleted = retention.deleted;
  } catch { counts.errors++; }
  // No identity, path, provider error, receipt or configuration is logged.
  port.log?.('JANITOR_RUN', { ...counts });
  return counts;
}
