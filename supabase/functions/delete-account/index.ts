import { createClient } from 'jsr:@supabase/supabase-js@2';
import { deletionHandler, type DeletionPort, type DeletionLease } from '../_shared/accountDeletionCoordinator.ts';
import type { DeletionAdapter, DeletionReceipt } from '../_shared/accountDeletionFoundation.ts';
import { deletionStorageAdapter, listOwnedStorageObjects } from '../_shared/accountDeletionStorage.ts';
import { verifiedDeletionStorage, deleteAuthAfterStorage } from '../_shared/accountDeletionExecution.ts';
import {preparePremiumDeletion} from '../_shared/premiumDeletionCheckpoint.ts';

const url = Deno.env.get('SUPABASE_URL');
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !key) throw new Error('delete-account configuration missing');
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }) } });
const rpc = async (name: string, args: Record<string, unknown> = {}) => {
  const { data, error } = await admin.rpc(name, args);
  if (error) {
    // Only known deletion_begin reasons may be returned; never expose raw SQL.
    if (name === 'deletion_begin' && ['lease_held_by_other', 'fence_unavailable', 'lease_unavailable'].includes(error.message)) {
      throw Object.assign(new Error('Coordinator unavailable'), { code: error.message });
    }
    throw new Error('Coordinator unavailable');
  }
  return data;
};
const identity = (lease: DeletionLease) => ({ p_request: lease.receipt.requestId, p_lease: lease.lease });
const port: DeletionPort = {
  readiness: async () => {
    try {
      const value = await rpc('deletion_readiness');
      // v1 protocol note: writerCoverage still means all-writer attestation.
      // It is not a deletion prerequisite. Readiness checks fence/lease infrastructure;
      // deletion_begin alone decides whether this owner's lease can be acquired.
      const ready = value?.protocol === 'vitrify.deletion.v1' && value?.ready === true && value?.postAuthRecovery === true;
      return { ready, blockers: ready ? [] : Array.isArray(value?.blockers) ? value.blockers : ['fence_unavailable'] };
    } catch { return { ready: false, blockers: ['fence_unavailable'] }; }
  },
  authenticate: async token => { const { data, error } = await admin.auth.getUser(token); return error ? null : data.user?.id ?? null; },
  begin: async (subject, requestId, token) => {
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map(value => value.toString(16).padStart(2, '0')).join('');
    const value = await rpc('deletion_begin', { p_subject: subject, p_request: requestId, p_hash: hash });
    if (!value?.receipt || typeof value.lease !== 'string' || !Number.isSafeInteger(value.drain_remaining_ms) || value.drain_remaining_ms < 0) throw new Error('Lease/drain missing');
    return { receipt: value.receipt, lease: value.lease, drainRemainingMs: value.drain_remaining_ms };
  },
  save: async (lease, receipt) => { await rpc('deletion_save', { ...identity(lease), p_receipt: receipt }); },
  release: async lease => { await rpc('deletion_release', identity(lease)); },
  prepare:async lease=>{
    if(Deno.env.get('PREMIUM_A1_ENABLED')!=='true')return;
    await preparePremiumDeletion(admin,lease.receipt.requestId,lease.lease,'vitrify-rc-lifecycle-20261017',Deno.env.get('REVENUECAT_PROJECT_ID')?.trim()||null,Deno.env.get('REVENUECAT_ENVIRONMENT')?.trim()||null);
  },
  adapters: lease => {
    const deadline = Date.now() + 50_000;
    const guard = async () => { if (Date.now() > deadline) throw new Error('Retry budget exhausted'); await rpc('deletion_assert_lease', identity(lease)); };
    const fencedLease = async () => {
      await guard();
      return await rpc('deletion_verify', { ...identity(lease), p_layer: 'write_fence' }) === true;
    };
    const layer = (name: string): DeletionAdapter => ({ idempotent: true,
      cleanup: async () => { await guard(); await rpc('deletion_clean', { ...identity(lease), p_layer: name }); },
      verify: async () => { await guard(); const complete = await rpc('deletion_verify', { ...identity(lease), p_layer: name }) === true;
        return { complete, evidence: complete ? ['server verified ' + name + ' absent/fenced'] : [] }; } });
    const sweep = deletionStorageAdapter({ assertLease: async owner => {
          if (owner !== lease.receipt.subjectId) throw new Error('Storage lease owner mismatch');
          await guard();
        },
        // Legacy adapter slot is bound to the real fence/lease guard, not remote
        // upload terminal states. Enumeration/removal algorithm remains unchanged.
        barrier: fencedLease,
        objects: (bucket, owner) => listOwnedStorageObjects(owner, async (prefix, offset) => {
          const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
          if (error || !data) throw new Error('Storage inventory unavailable');
          return data;
        }, guard), remove: async (bucket, paths) => {
          const { error } = await admin.storage.from(bucket).remove(paths);
          if (error) throw new Error('Storage cleanup failed');
        } });
    const storage = verifiedDeletionStorage(sweep);
    return {
      write_fence: layer('write_fence'), jobs_payload: layer('jobs_payload'), db: layer('db'), recommendation_cache: layer('recommendation_cache'),
      storage,
      auth: { idempotent: true, cleanup: async ({ subjectId }: DeletionReceipt) => {
        if (subjectId !== lease.receipt.subjectId) throw new Error('Auth lease owner mismatch');
        await guard();
        await deleteAuthAfterStorage(lease.receipt, storage, async () => {
          await guard();
          const counts = await rpc('deletion_purge_operations', { subject: subjectId, ...identity(lease) });
          if (!counts || ['storage_resolutions','storage_operations','provider_operations'].some(name =>
            !Number.isSafeInteger(counts[name]) || counts[name] < 0)) throw new Error('Operation cleanup unverified');
        }, async () => {
          await guard();
          if (!await fencedLease()) throw new Error('Deletion fence lost');
          const { error } = await admin.auth.admin.deleteUser(subjectId);
          if (error) {
            // Inspect only to classify the owned-object signal; never log/return provider text.
            const owned = /(?:owner|owns|owning|ownership).*(?:storage|objects)|(?:storage|objects).*(?:owner|owns|owning|ownership)/i.test(error.message ?? '');
            throw Object.assign(new Error('Auth cleanup failed'), { code: owned ? 'STORAGE_OBJECTS_REMAIN' : 'AUTH_DELETE_FAILED' });
          }
        });
      }, verify: async () => {
        await guard(); const complete = await rpc('deletion_verify', { ...identity(lease), p_layer: 'auth' }) === true;
        return { complete, evidence: complete ? ['trusted auth.users absence verified'] : [] };
      } },
    };
  },
};
Deno.serve(deletionHandler(port));
