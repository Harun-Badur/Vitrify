import { createClient } from 'jsr:@supabase/supabase-js@2';
import { reconcileMembershipVton } from '../_shared/premiumVton.ts';
import { FASHN_API_BASE_URL } from '../vton-proxy/contract.ts';
const reply = (status: number, code: string) => new Response(JSON.stringify({ code }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
Deno.serve(async request => {
  if (request.method !== 'POST') return reply(405, 'METHOD_NOT_ALLOWED');
  if (Deno.env.get('VTON_MEMBERSHIP_ENABLED') !== 'true') return reply(503, 'MEMBERSHIP_NOT_ENABLED');
  try {
    const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1];
    if (!token) return reply(401, 'UNAUTHORIZED');
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
    const user = await admin.auth.getUser(token);
    if (user.error || !user.data.user) return reply(401, 'UNAUTHORIZED');
    const input = await request.json();
    if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(input.requestId)) return reply(400, 'INVALID_REQUEST');
    const ledger = await admin.from('premium_vton_requests').select('state,prediction_id').eq('user_id', user.data.user.id).eq('request_id', input.requestId).maybeSingle();
    if (ledger.error) return reply(503, 'RECONCILIATION_UNAVAILABLE');
    if (!ledger.data) return reply(404, 'REQUEST_NOT_FOUND');
    const state = await reconcileMembershipVton(admin, user.data.user.id, input.requestId, ledger.data, async prediction => {
      const key = Deno.env.get('FASHN_API_KEY');
      if (!key) throw new Error('PROVIDER_NOT_CONFIGURED');
      const response = await fetch(`${FASHN_API_BASE_URL}/status/${encodeURIComponent(prediction)}`, { headers: { Authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('PROVIDER_UNVERIFIED');
      const body = await response.json();
      return typeof body?.status === 'string' ? body.status : 'unknown';
    });
    return reply(state === 'unknown' ? 202 : 200, state);
  } catch { return reply(503, 'RECONCILIATION_UNVERIFIED'); }
});
