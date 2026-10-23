import { verifyRevenueCat, type MembershipConfig, type MembershipPorts, type MembershipSnapshot } from './premiumBackend.ts';

export interface MembershipRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: unknown }>;
  auth: { getUser(token: string): PromiseLike<{ data: { user: { id: string } | null }; error: unknown }> };
  from(name: string): any;
}
export function readMembershipConfig(env: (name: string) => string | undefined): MembershipConfig {
  const products = JSON.parse(env('REVENUECAT_PRODUCTS_JSON') ?? '{}');
  const config: MembershipConfig = {
    apiKey: env('REVENUECAT_SECRET_KEY') ?? '', entitlement: env('REVENUECAT_ENTITLEMENT_ID') ?? '',
    products, sandbox: env('REVENUECAT_ENVIRONMENT') === 'SANDBOX',
    webhookAuthorization: env('REVENUECAT_WEBHOOK_AUTHORIZATION') ?? '',
    appIds: (env('REVENUECAT_APP_IDS') ?? '').split(',').filter(Boolean),
    restorePolicy: env('REVENUECAT_RESTORE_POLICY')==='KEEP_ORIGINAL' ? 'KEEP_ORIGINAL' : undefined,
    a1Ready:env('PREMIUM_A1_ENABLED')==='true',
  };
  if (!config.a1Ready || !config.apiKey || !config.entitlement || !['PRODUCTION','SANDBOX'].includes(env('REVENUECAT_ENVIRONMENT') ?? '') ||
      !products || typeof products !== 'object' || Array.isArray(products) ||
      !['app_store','play_store'].every(store => Array.isArray(products[store]) && products[store].length > 0 && products[store].every((p: unknown) => typeof p === 'string' && p.length > 0))) throw new Error('MEMBERSHIP_NOT_CONFIGURED');
  return config;
}
export function membershipPorts(client: MembershipRpcClient, config: MembershipConfig): MembershipPorts {
  return {
    admit:async owner=>{
      const r=await client.rpc('premium_admission',{p_owner:owner});
      if(r.error||r.data!==true)throw new Error('ACCOUNT_DELETION_FENCED');return true;
    },
    authenticate: async token => {
      if (!token) return null;
      const result = await client.auth.getUser(token);
      return result.error ? null : result.data.user?.id ?? null;
    },
    binding: async owner => {
      const r = await client.rpc('premium_binding', { p_owner: owner });
      if (r.error || typeof r.data !== 'string') throw new Error('MEMBERSHIP_IDENTITY_UNAVAILABLE');
      return r.data;
    },
    ownerForBinding: async binding => {
      const r = await client.from('premium_identities').select('user_id').eq('app_user_id', binding).maybeSingle();
      if (r.error) throw new Error('MEMBERSHIP_IDENTITY_UNAVAILABLE');
      return r.data?.user_id ?? null;
    },
    verify: binding => verifyRevenueCat(binding, config),
    persist: async (owner, binding, s: MembershipSnapshot, event) => {
      const r = await client.rpc('premium_store_snapshot', {
        p_owner: owner, p_binding: binding, p_tier: s.tier, p_expires_ms: s.expiresAtMs,
        p_source_ms: s.sourceMs, p_transaction: s.transaction, p_store: s.store, p_event: event,
      });
      if (r.error) throw new Error('MEMBERSHIP_STORE_UNAVAILABLE');
      return r.data === true;
    },
  };
}
