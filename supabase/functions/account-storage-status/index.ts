import { createClient } from '@supabase/supabase-js';
import { accountStorageStatusHandler } from '../_shared/accountStorageReconciliation.ts';

const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), anon = Deno.env.get('SUPABASE_ANON_KEY');
if (!url || !key || !anon) throw new Error('Storage status configuration missing');
const options = { auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }) } };
Deno.serve(accountStorageStatusHandler(createClient(url, key, options), jwt => createClient(url, anon, {
  ...options, global: { ...options.global, headers: { Authorization: `Bearer ${jwt}` } },
})));
