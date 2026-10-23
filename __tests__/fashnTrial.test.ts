import { withFashnTrial, readFashnTrialStatus } from '../supabase/functions/_shared/fashnTrial';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'node:util';
import ts from 'typescript';

// Network-free RPC double. SQL row-lock/ACL checks are separate; this is not a DB race test.
function ledger() {
  let row: { request: string; hash: string; state: string; lease: string } | null = null;
  const rpc = jest.fn(async (_name: string, args: Record<string, unknown>) => {
    const action = args.p_action;
    if (action === 'status') return { data: { used: !!row && row.state !== 'not_sent' }, error: null };
    if (action === 'reserve') {
      if (row && row.request === args.p_request) return { data: { allowed: false, reason: row.hash === args.p_hash ? 'already_recorded' : 'request_conflict', state: row.state }, error: null };
      if (row && row.state !== 'not_sent') return { data: { allowed: false, reason: 'trial_used', state: row.state }, error: null };
      row = { request: String(args.p_request), hash: String(args.p_hash), state: 'reserved', lease: 'lease' };
      return { data: { allowed: true, lease: row.lease }, error: null };
    }
    if (!row || row.request !== args.p_request || row.lease !== args.p_lease) return { data: false, error: null };
    if (action === 'dispatch' && row.state === 'reserved') row.state = 'unknown';
    else if (action === 'release' && row.state === 'reserved') row.state = 'not_sent';
    else if (action === 'complete' && row.state === 'unknown') row.state = 'completed';
    else return { data: false, error: null };
    return { data: true, error: null };
  });
  return { rpc };
}

describe('temporary FASHN one-use overlay', () => {
  it('only one concurrent request reaches dispatch; replay returns stored state without provider work', async () => {
    const db = ledger(); const provider = jest.fn(async () => new Response('{}', { status: 200 }));
    const run = (request: string) => withFashnTrial(db, true, 'owner', request, 'hash', async claim => { await claim(); return provider(); });
    const results = await Promise.all([run('r1'), run('r2')]);
    expect(results.map(r => r.status).sort()).toEqual([200, 429]);
    expect(provider).toHaveBeenCalledTimes(1);
    const replay = await run('r1');
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({ state: 'completed', code: 'already_recorded' });
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it('preserves entitlement on proven pre-dispatch failure, without reusing an old identity', async () => {
    const db = ledger();
    await withFashnTrial(db, true, 'owner', 'r1', 'hash', async () => new Response('{}', { status: 422 }));
    expect(await readFashnTrialStatus(db, 'owner')).toEqual({ enabled: true, used: false });
    expect((await withFashnTrial(db, true, 'owner', 'r1', 'hash', async () => { throw Error('must not dispatch'); })).status).toBe(409);
    const next = await withFashnTrial(db, true, 'owner', 'r2', 'hash', async claim => { await claim(); return new Response('{}'); });
    expect(next.status).toBe(200);
  });
  it.each(['timeout', 'provider failure'])('never refunds dispatch after %s', async () => {
    const db = ledger();
    await withFashnTrial(db, true, 'owner', 'r1', 'hash', async claim => { await claim(); throw Error('unknown'); });
    expect(await readFashnTrialStatus(db, 'owner')).toEqual({ enabled: true, used: true });
    const provider = jest.fn();
    expect((await withFashnTrial(db, true, 'owner', 'r2', 'hash', provider)).status).toBe(429);
    expect(provider).not.toHaveBeenCalled();
  });
  it('fails closed when the dispatch checkpoint fails and never calls provider', async () => {
    const db = ledger(); const original = db.rpc;
    db.rpc = jest.fn(async (name, args) => args.p_action === 'dispatch' ? { data: false, error: null } : original(name, args));
    const provider = jest.fn();
    expect((await withFashnTrial(db, true, 'owner', 'r', 'hash', async claim => { await claim(); return provider(); })).status).toBe(503);
    expect(provider).not.toHaveBeenCalled();
    // The checkpoint may have committed despite a lost response: never release it.
    expect(db.rpc.mock.calls.some(([, args]) => args.p_action === 'release')).toBe(false);
  });
  it('does not change normal Free/Premium behavior while server flag is off', async () => {
    const db = ledger(); const work = jest.fn(async claim => { await claim(); return new Response('{}'); });
    expect((await withFashnTrial(db, false, 'owner', null, 'hash', work)).status).toBe(200);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('rejects request identity conflicts without invoking work', async () => {
    const db = ledger(); const work = jest.fn(async () => new Response('{}', { status: 422 }));
    await withFashnTrial(db, true, 'owner', 'r', 'first', work);
    const response = await withFashnTrial(db, true, 'owner', 'r', 'different', work);
    expect(await response.json()).toMatchObject({ code: 'request_conflict' });
    expect(work).toHaveBeenCalledTimes(1);
  });
  it('fails closed without SQL deployment; no work or secret logging', async () => {
    const work = jest.fn();
    const response = await withFashnTrial({ rpc: async () => ({ data: null, error: {} }) }, true, 'owner', 'r', 'hash', work);
    expect(response.status).toBe(503);
    expect(work).not.toHaveBeenCalled();
  });
});

function edge(options: { enabled?: boolean; paused?: boolean; authenticated?: boolean; admissionFails?: boolean } = {}) {
  const db = ledger(); const calls: string[] = [];
  const admin = {
    auth: { getUser: async () => ({ data: { user: options.authenticated === false ? null : { id: 'owner' } }, error: null }) },
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push(name);
      if (name === 'fashn_trial_gate') return db.rpc(name, args);
      if (name === 'consume_vton_quota') return { data: { allowed: true }, error: null };
      if (options.admissionFails) return { data: null, error: {} };
      if (name === 'provider_dispatch_admit') return { data: {
        operation: 'a1000000-0000-4000-8000-000000000001', lease: 'a1000000-0000-4000-8000-000000000002',
        owner: args.p_subject, provider: args.p_provider, request: args.p_request,
      }, error: null };
      return { data: true, error: null };
    },
  };
  let handler!: (request: Request) => Promise<Response>;
  const fetch = jest.fn(async () => new Response('{}', { status: 503 }));
  const cache = new Map<string, { exports: Record<string, unknown> }>();
  function load(filename: string): Record<string, unknown> {
    if (cache.has(filename)) return cache.get(filename)!.exports;
    const module = { exports: {} }; cache.set(filename, module);
    const js = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(js, {
      module, exports: module.exports, require: (name: string) => name.startsWith('jsr:') ? { createClient: () => admin } : load(path.resolve(path.dirname(filename), name)),
      Deno: { env: { get: (name: string) => ({ SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture', FASHN_API_KEY: 'fixture', VTON_TEST_TRIAL_ENABLED: options.paused ? 'paused' : options.enabled === false ? 'false' : 'true' }[name]) }, serve: (fn: typeof handler) => { handler = fn; } },
      Request, Response, Headers, URL, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
      crypto: webcrypto, atob, setTimeout, clearTimeout, fetch,
      console: { log: jest.fn(), error: jest.fn() },
    }, { filename });
    return module.exports;
  }
  load(path.resolve('supabase/functions/vton-proxy/index.ts'));
  const post = (id: string) => handler(new Request('https://fixture.invalid', {
    method: 'POST', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json', 'x-provider-request': id },
    body: JSON.stringify({ model_image: 'data:image/jpeg;base64,YWJj', product_image: 'https://fixture.invalid/item.jpg' }),
  }));
  return { post, handler, fetch, calls, db };
}

describe('actual vton-proxy trial wiring (all network mocked)', () => {
  it('parallel requests, provider HTTP failure, replay and second device produce only one provider POST', async () => {
    const app = edge();
    const responses = await Promise.all([app.post('r1'), app.post('r2')]);
    expect(responses.map(r => r.status).sort()).toEqual([429, 502]);
    // Hashing is asynchronous: either parallel request may win the reservation.
    const winningRequest = responses[0].status === 502 ? 'r1' : 'r2';
    expect((await app.post(winningRequest)).status).toBe(409);
    expect((await app.post('different-device')).status).toBe(429);
    expect(app.fetch).toHaveBeenCalledTimes(1);
    expect(app.fetch.mock.calls[0]).toBeDefined();
    expect(await readFashnTrialStatus(app.db, 'owner')).toEqual({ enabled: true, used: true });
  });
  it('guard rejection is proven pre-dispatch and preserves the trial', async () => {
    const app = edge({ admissionFails: true });
    expect((await app.post('r')).status).toBe(503);
    expect(app.fetch).not.toHaveBeenCalled();
    expect(await readFashnTrialStatus(app.db, 'owner')).toEqual({ enabled: true, used: false });
  });
  it('status is authenticated, read only and cannot trigger quota or provider work', async () => {
    const app = edge();
    const response = await app.handler(new Request('https://fixture.invalid', { headers: { Authorization: 'Bearer fixture' } }));
    expect(await response.json()).toEqual({ enabled: true, used: false });
    expect(app.calls).toEqual(['fashn_trial_gate']);
    expect(app.fetch).not.toHaveBeenCalled();
    const signedOut = edge({ authenticated: false });
    expect((await signedOut.post('r')).status).toBe(401);
    expect(signedOut.calls).toEqual([]);
  });
  it('disabled trial overlay retains existing quota and provider path', async () => {
    const app = edge({ enabled: false }); await app.post('r');
    expect(app.calls).not.toContain('fashn_trial_gate');
    expect(app.calls).toContain('consume_vton_quota');
    expect(app.fetch).toHaveBeenCalledTimes(1);
  });
  it('rollout/rollback pause closes admission without touching history, quota or provider', async () => {
    const app = edge({ paused: true });
    expect((await app.post('r')).status).toBe(503);
    expect(app.calls).toEqual([]);
    expect(app.fetch).not.toHaveBeenCalled();
  });
});

test('SQL package has owner cascade, row serialization, unique live claim, private ACL and conservative history', () => {
  const sql = readFileSync('supabase/proposals/fashn_test_trial.sql', 'utf8');
  expect(sql.match(/references auth.users\(id\) on delete cascade/g)).toHaveLength(2);
  expect(sql).toContain("pg_advisory_xact_lock(hashtextextended('fashn-test:'");
  expect(sql).toContain("where state<>'not_sent'");
  expect(sql).toContain('perform deletion_private.lock_writer(p_owner)');
  expect(sql).toContain('from public,anon,authenticated,service_role');
  expect(sql).toContain('from public,anon,authenticated;');
  expect(sql).toContain('to service_role;');
  expect(sql).toContain("and state='reserved'");
  expect(sql).toContain('public.fashn_test_prior_users');
  expect(sql).toMatch(/insert into public\.fashn_test_prior_users\s+select id from auth\.users\s*;/);
  expect(sql).not.toMatch(/delete from|truncate|update deletion_private/i);
});
