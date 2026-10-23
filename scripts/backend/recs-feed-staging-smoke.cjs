'use strict';
// Read-only: one Auth GET and three recs-feed POSTs. No SDK, login, CRUD or telemetry writes.
const REF = 'sdjxseqfkturkfohkfni';
const URL = `https://${REF}.supabase.co`;
const fail = code => { throw new Error(code); };
const payload = (token, code) => {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); }
  catch { return fail(code); }
};
async function run(env, fetcher = globalThis.fetch, emit = () => {}) {
  if (env.STAGING_SUPABASE_URL !== URL || env.STAGING_TEST_ACCOUNT_CONFIRMED !== 'true') fail('TARGET_BLOCKED');
  const key = env.STAGING_ANON_KEY;
  const token = env.STAGING_USER_JWT;
  if (typeof key !== 'string') fail('KEY_BLOCKED');
  const keyClaims = payload(key, 'KEY_BLOCKED');
  if (keyClaims?.ref !== REF || keyClaims?.role !== 'anon' || !(keyClaims.exp > Date.now()/1000)) fail('KEY_BLOCKED');
  if (typeof token !== 'string') fail('JWT_BLOCKED');
  const claims = payload(token, 'JWT_BLOCKED');
  if (claims?.iss !== `${URL}/auth/v1` || claims?.role !== 'authenticated'
    || typeof claims.sub !== 'string' || !(claims.exp > Date.now()/1000)) fail('JWT_BLOCKED');
  async function request(path, bearer, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const headers = { apikey: key, 'Content-Type': 'application/json' };
      if (bearer) headers.Authorization = `Bearer ${bearer}`;
      return await fetcher(`${URL}${path}`, {
        method: body === undefined ? 'GET' : 'POST', headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal, redirect: 'error',
      });
    } catch { return fail('NETWORK_OR_TIMEOUT'); }
    finally { clearTimeout(timer); }
  }
  const auth = await request('/auth/v1/user', token);
  if (auth.status !== 200) fail('AUTH_FAILED');
  let user;
  try { user = await auth.json(); } catch { fail('AUTH_RESPONSE'); }
  if (user?.id !== claims.sub) fail('AUTH_FAILED');
  emit('AUTH PASS');
  const input = { limit: 20, mode: 'personal', exclude_ids: [] };
  const path = '/functions/v1/recs-feed';
  const missing = await request(path, null, input);
  if (missing.status !== 401) fail('NO_JWT_NOT_401');
  emit('NO_JWT PASS');
  const invalid = await request(path, 'invalid-test-token', input);
  if (invalid.status !== 401) fail('INVALID_JWT_NOT_401');
  emit('INVALID_JWT PASS');
  const feed = await request(path, token, input);
  if (feed.status !== 200) fail('FEED_HTTP_FAILED');
  let result;
  try { result = await feed.json(); } catch { fail('FEED_RESPONSE'); }
  if (!Array.isArray(result?.items) || typeof result.has_more !== 'boolean') fail('FEED_RESPONSE');
  if (result.items.length === 0) fail('FEED_EMPTY');
  if (result.items.length > 20) fail('FEED_RESPONSE');
  const ids = new Set();
  for (const item of result.items) {
    const p = item?.product;
    if (typeof p?.id !== 'string' || ids.has(p.id) || p.provider !== 'flo'
      || typeof p.title !== 'string' || !p.title.trim()
      || typeof p.imageUrl !== 'string' || !/^https:\/\//.test(p.imageUrl)
      || !Number.isFinite(p.price) || p.price <= 0 || !Number.isFinite(item.score)) fail('FEED_RESPONSE');
    ids.add(p.id);
  }
  emit(`FEED PASS HTTP_200 COUNT_${result.items.length}`);
}
module.exports = { run };
if (require.main === module) {
  const allowed = new Set(['TARGET_BLOCKED','KEY_BLOCKED','JWT_BLOCKED','NETWORK_OR_TIMEOUT',
    'AUTH_FAILED','AUTH_RESPONSE','NO_JWT_NOT_401','INVALID_JWT_NOT_401','FEED_HTTP_FAILED','FEED_RESPONSE','FEED_EMPTY']);
  run(process.env, globalThis.fetch, line => console.log(line)).catch(error => {
    console.error(`STATUS FAIL ${allowed.has(error?.message) ? error.message : 'SMOKE_FAILED'}`);
    process.exitCode = 1;
  });
}
