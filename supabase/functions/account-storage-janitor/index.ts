// LOCAL PREPARATION ONLY. Deployment/activation requires explicit approval.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { JANITOR_PAGE_SIZE, runScheduledStorageJanitor, type JanitorOwner } from '../_shared/accountStorageJanitor.ts';
import { storageJanitorHandler } from '../_shared/accountStorageJanitorHandler.ts';

const url = Deno.env.get('SUPABASE_URL');
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const token = Deno.env.get('A1_JANITOR_AUTH_TOKEN');
// Project/authorization guard in the handler runs before any privileged adapter.
const handler = storageJanitorHandler({ projectUrl: url, token,
  targetProjectRef: Deno.env.get('A1_JANITOR_PROJECT_REF'),
  deleteEnabled: Deno.env.get('A1_JANITOR_DELETE_ENABLED') === 'true',
  run: async enabled => {
    if (!url || !key) throw new Error('Janitor unavailable');
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }) } });
    const rpc = async (name: string, args: Record<string, unknown>) => {
      const { data, error } = await admin.rpc(name, args); if (error) throw new Error('Janitor RPC unavailable'); return data;
    };
    return runScheduledStorageJanitor({
      list: async (bucket, prefix, offset) => {
        const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: JANITOR_PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' } });
        if (error || !data) throw new Error('Janitor list unavailable'); return data;
      },
      metadata: async owners => await rpc('deletion_janitor_candidates', { owners }) as JanitorOwner[],
      remove: async (bucket, paths) => { const { error } = await admin.storage.from(bucket).remove(paths); if (error) throw new Error('Janitor remove unavailable'); },
      retention: async dryRun => await rpc('deletion_prune_tombstones', { p_dry_run: dryRun }),
      log: (event, counts) => console.log(event, JSON.stringify(counts)),
    }, enabled);
  },
});
Deno.serve(handler);
