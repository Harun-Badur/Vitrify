import { createClient } from 'jsr:@supabase/supabase-js@2';
import { CUTOUT_V2_ENABLED, cutoutV2ControlHandler, cutoutRpcFailure } from '../_shared/cutoutV2Control.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(60_000) }) },
});
Deno.serve(cutoutV2ControlHandler({
  enabled: CUTOUT_V2_ENABLED,
  auth: async jwt => { const { data, error } = await admin.auth.getUser(jwt); return error ? null : data.user?.id ?? null; },
  rpc: async (action, value) => {
    const { data, error } = action === 'status'
      ? await admin.rpc('cutout_v2_read', { p_owner: value.owner, p_job: value.job, p_request: value.request })
      : await admin.rpc('cutout_v2_command', { p_action: action, p_value: value });
    if (error) throw cutoutRpcFailure(error);
    if (!data || typeof data !== 'object') throw new Error('CUTOUT_V2_RPC_UNVERIFIED');
    return data;
  },
  dispatch: async (jobId, claimCapability) => {
    const endpoint = Deno.env.get('WARDROBE_CUTOUT_V2_PROVIDER');
    if (!endpoint || new URL(endpoint).protocol !== 'https:') throw new Error('CUTOUT_V2_PROVIDER_MISSING');
    // Fixed configured origin, never caller-controlled; never follow credential redirects.
    const response = await fetch(new URL('/v2/wardrobe/cutout', endpoint), { method: 'POST', redirect: 'error',
      signal: AbortSignal.timeout(50_000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId, claimCapability }) });
    if (!response.ok) throw new Error('CUTOUT_V2_DELIVERY_UNCERTAIN');
  },
  source: async (bucket, path) => {
    const { data, error } = await admin.storage.from(bucket).download(path);
    if (error || !data || data.size > 12582912) throw new Error('CUTOUT_V2_SOURCE_UNVERIFIED');
    return data.arrayBuffer();
  },
}));
