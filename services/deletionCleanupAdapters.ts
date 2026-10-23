import type { SupabaseClient } from '@supabase/supabase-js';
import type { DeletionAdapter, DeletionLayer } from '../lib/accountDeletionFoundation';
import { deletionStorageAdapter, listOwnedStorageObjects } from '../supabase/functions/_shared/accountDeletionStorage';

export interface VerifiedOwnershipInventory {
  /** Must be established by a complete schema/bucket/ownership audit, never inferred from this list. */
  coverageVerified: boolean;
  tables: readonly { table: string; ownerColumn: string }[];
  buckets: readonly string[];
}

/** Trusted admin adapters, never called with a client JWT or an unverified partial inventory. */
export function serverDeletionAdapters(admin: SupabaseClient, inventory: VerifiedOwnershipInventory,
  safety?: { subjectId: string; assertLease(): Promise<void>; barrier(): Promise<boolean> }):
  Partial<Record<DeletionLayer, DeletionAdapter>> {
  const requireCoverage = () => {
    if (!inventory.coverageVerified || !inventory.tables.length || !inventory.buckets.length) throw new Error('Ownership coverage unverified');
    if (!safety || inventory.buckets.some(bucket => !['model-photos', 'wardrobe-cutouts'].includes(bucket)) ||
      !['model-photos', 'wardrobe-cutouts'].every(bucket => inventory.buckets.includes(bucket))) {
      throw new Error('Lease and physical Storage barrier required');
    }
  };
  const guard = async (subjectId: string) => {
    requireCoverage();
    if (!subjectId || subjectId !== safety!.subjectId) throw new Error('Deletion lease owner mismatch');
    await safety!.assertLease();
  };
  const objects = async (bucket: string, subjectId: string): Promise<string[]> => {
    return listOwnedStorageObjects(subjectId, async (prefix, offset) => {
        const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
        if (error || !data) throw error ?? new Error('Storage inventory unavailable');
        return data;
    }, () => guard(subjectId));
  };
  const storage = deletionStorageAdapter({ assertLease: guard, barrier: async () => safety!.barrier(), objects,
    remove: async (bucket, paths) => {
      const { error } = await admin.storage.from(bucket).remove(paths);
      if (error) throw error;
    } });
  const db: DeletionAdapter = { idempotent: true,
    cleanup: async ({ subjectId }) => {
      await guard(subjectId);
      for (const { table, ownerColumn } of inventory.tables) {
        await guard(subjectId);
        const { error } = await admin.from(table).delete().eq(ownerColumn, subjectId);
        if (error) throw error;
      }
    },
    verify: async ({ subjectId }) => {
      await guard(subjectId);
      for (const { table, ownerColumn } of inventory.tables) {
        await guard(subjectId);
        const { count, error } = await admin.from(table).select('*', { count: 'exact', head: true }).eq(ownerColumn, subjectId);
        if (error || count === null) throw error ?? new Error('DB verification unavailable');
        if (count !== 0) return { complete: false, evidence: [] };
      }
      return { complete: true, evidence: ['inventoried owned DB rows absent'] };
    } };
  // Auth absence after deletion requires a trusted inventory/list result. A generic getUser error is NOT proof.
  const auth: DeletionAdapter = { idempotent: true,
    cleanup: async ({ subjectId }) => { await guard(subjectId); if (!await safety!.barrier()) throw new Error('Physical Storage barrier lost');
      const { error } = await admin.auth.admin.deleteUser(subjectId); if (error) throw error; },
    verify: async ({ subjectId }) => {
      await guard(subjectId);
      for (let page = 1; ; page++) {
        await guard(subjectId);
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
        if (error || !data?.users) throw error ?? new Error('Auth verification unavailable');
        if (data.users.some(user => user.id === subjectId)) return { complete: false, evidence: [] };
        if (data.users.length < 100) return { complete: true, evidence: ['Auth list exhausted; subject absent'] };
      }
    } };
  return { storage, db, auth };
}
