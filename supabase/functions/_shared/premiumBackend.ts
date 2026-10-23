export interface MembershipConfig {
  apiKey: string;
  entitlement: string;
  products: Record<string, string[]>;
  sandbox: boolean;
  webhookAuthorization: string;
  appIds?: string[];
  restorePolicy?: 'KEEP_ORIGINAL';
  a1Ready?: boolean;
}
export interface MembershipSnapshot {
  tier: 'free' | 'premium';
  expiresAtMs: number | null;
  sourceMs: number;
  transaction: string | null;
  store: string | null;
}
const record = (v: unknown): Record<string, any> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : null;
const date = (v: unknown): number => typeof v === 'string' ? Date.parse(v) : NaN;

/** Input must be fetched directly from RevenueCat, never supplied by the client. */
export function readRevenueCatSnapshot(raw: unknown, binding: string, config: MembershipConfig, now: number): MembershipSnapshot {
  const data = record(raw), subscriber = record(data?.subscriber);
  if (!config.entitlement || !subscriber || subscriber.original_app_user_id !== binding ||
      !Number.isFinite(now) || !Number.isSafeInteger(data?.request_date_ms) ||
      Math.abs(data!.request_date_ms - now) > 60_000) throw new Error('MEMBERSHIP_SOURCE_UNVERIFIED');
  const entitlements = record(subscriber.entitlements), subscriptions = record(subscriber.subscriptions);
  if (!entitlements || !subscriptions) throw new Error('MEMBERSHIP_SOURCE_UNVERIFIED');
  const free: MembershipSnapshot = { tier: 'free', expiresAtMs: null, sourceMs: data!.request_date_ms, transaction: null, store: null };
  if (!Object.hasOwn(entitlements, config.entitlement)) return free;
  const entitlement = record(entitlements[config.entitlement]);
  const product = entitlement?.product_identifier;
  const subscription = typeof product === 'string' ? record(subscriptions[product]) : null;
  if (!subscription || !['app_store', 'play_store'].includes(subscription.store) ||
      !config.products[subscription.store]?.includes(product) || subscription.is_sandbox !== config.sandbox ||
      subscription.ownership_type !== 'PURCHASED' ||
      !['string', 'number'].includes(typeof subscription.store_transaction_id)) throw new Error('MEMBERSHIP_PURCHASE_UNVERIFIED');
  const transaction = String(subscription.store_transaction_id);
  if (!transaction || transaction.length > 200 || (typeof subscription.store_transaction_id === 'number' && !Number.isSafeInteger(subscription.store_transaction_id))) throw new Error('MEMBERSHIP_PURCHASE_UNVERIFIED');
  if (subscription.refunded_at != null) {
    if (!Number.isFinite(date(subscription.refunded_at))) throw new Error('MEMBERSHIP_REFUND_UNVERIFIED');
    return { ...free, transaction, store: subscription.store };
  }
  const expiry = date(subscription.expires_date), entitlementExpiry = date(entitlement?.expires_date);
  const grace = subscription.grace_period_expires_date == null ? expiry : date(subscription.grace_period_expires_date);
  if (!Number.isFinite(expiry) || !Number.isFinite(entitlementExpiry) || !Number.isFinite(grace)) throw new Error('MEMBERSHIP_EXPIRY_UNVERIFIED');
  const until = Math.max(Math.min(expiry, entitlementExpiry), grace > expiry ? grace : -Infinity);
  return { ...free, tier: until > now ? 'premium' : 'free', expiresAtMs: until, transaction, store: subscription.store };
}

export async function verifyRevenueCat(binding: string, config: MembershipConfig, fetcher: typeof fetch = fetch, now?: number): Promise<MembershipSnapshot> {
  if (!config.apiKey || !config.entitlement || !binding) throw new Error('MEMBERSHIP_NOT_CONFIGURED');
  const response = await fetcher(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(binding)}`, {
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  // Including 404: unavailable evidence is not proof of a free account.
  if (!response.ok) throw new Error('MEMBERSHIP_SOURCE_UNAVAILABLE');
  return readRevenueCatSnapshot(await response.json(), binding, config, now ?? Date.now());
}

export interface MembershipPorts {
  admit(owner:string):Promise<boolean>;
  authenticate(token: string): Promise<string | null>;
  binding(owner: string): Promise<string>;
  ownerForBinding(binding: string): Promise<string | null>;
  verify(binding: string): Promise<MembershipSnapshot>;
  persist(owner: string, binding: string, snapshot: MembershipSnapshot, event: string | null): Promise<boolean>;
}
const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
function equalSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let mismatch = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) mismatch |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return mismatch === 0;
}
export async function handleMembershipRequest(request: Request, ports: MembershipPorts, config: MembershipConfig, webhook: boolean, identityOnly = false, quotaActive = false, admissionOnly=false): Promise<Response> {
  if (request.method !== 'POST') return reply(405, { code: 'METHOD_NOT_ALLOWED' });
  try {
    let owner: string, binding: string, eventId: string | null = null;
    if (webhook) {
      if (!config.webhookAuthorization || !equalSecret(request.headers.get('Authorization') ?? '', config.webhookAuthorization)) return reply(401, { code: 'UNAUTHORIZED' });
      const raw = await request.text();
      if (raw.length > 65536) return reply(413, { code: 'BODY_TOO_LARGE' });
      const event = record(record(JSON.parse(raw))?.event);
      if (!event || typeof event.id !== 'string' || !event.id || event.id.length > 200 ||
          !config.appIds?.includes(event.app_id) || event.environment !== (config.sandbox ? 'SANDBOX' : 'PRODUCTION')) return reply(400, { code: 'EVENT_UNVERIFIED' });
      // Never alias, transfer, provision an unknown owner or trust event entitlement fields.
      if (event.type === 'TRANSFER') return reply(409, { code: 'OWNERSHIP_REVIEW_REQUIRED' });
      if (typeof event.app_user_id !== 'string') return reply(400, { code: 'EVENT_UNVERIFIED' });
      binding = event.app_user_id;
      const found = await ports.ownerForBinding(binding);
      if (!found) return reply(409, { code: 'OWNER_UNAVAILABLE' });
      owner = found; eventId = event.id;
    } else {
      const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1] ?? '';
      const found = await ports.authenticate(token);
      if (!found) return reply(401, { code: 'UNAUTHORIZED' });
      owner = found;
      if(!await ports.admit(owner))return reply(503,{code:'ACCOUNT_DELETION_FENCED'});
      if(admissionOnly)return config.a1Ready&&config.restorePolicy==='KEEP_ORIGINAL'?reply(200,{admitted:true}):reply(503,{code:'PREMIUM_A1_NOT_READY'});
      binding = await ports.binding(owner);
      if (identityOnly) return reply(200, { appUserId: binding, sdkAllowed: config.a1Ready===true&&config.restorePolicy==='KEEP_ORIGINAL' });
    }
    if(!await ports.admit(owner))return reply(503,{code:'ACCOUNT_DELETION_FENCED'});
    const snapshot = await ports.verify(binding);
    if (!await ports.persist(owner, binding, snapshot, eventId)) return reply(503, { code: 'MEMBERSHIP_REFRESH_REQUIRED' });
    return reply(200, webhook ? { received: true } : { tier: snapshot.tier, expiresAtMs: snapshot.expiresAtMs, checkedAtMs: snapshot.sourceMs, appUserId: binding,
      quotaPolicyActive: quotaActive, vtonDailyLimit: quotaActive ? (snapshot.tier==='premium' ? 20 : 3) : null, vtonMinuteLimit: quotaActive ? 3 : null, storeProducts: config.products });
  } catch {
    // Never serialize upstream errors, URLs, tokens or response bodies.
    return reply(503, { code: 'MEMBERSHIP_UNVERIFIED' });
  }
}
