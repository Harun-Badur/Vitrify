import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handleMembershipRequest } from '../_shared/premiumBackend.ts';
import { membershipPorts, readMembershipConfig } from '../_shared/premiumRuntime.ts';
Deno.serve(async request => {
  try {
    const config = readMembershipConfig(name => Deno.env.get(name));
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
    return await handleMembershipRequest(request, membershipPorts(client, config), config, true);
  } catch { return new Response(JSON.stringify({ code: 'MEMBERSHIP_NOT_CONFIGURED' }), { status: 503, headers: { 'Content-Type': 'application/json' } }); }
});
