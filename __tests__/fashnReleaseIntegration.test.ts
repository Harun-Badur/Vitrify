import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'node:util';
import ts from 'typescript';

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

function edge(options: { enabled?: boolean; paused?: boolean; authenticated?: boolean; admissionFails?: boolean; failure?: boolean } = {}) {
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
  const fetch = jest.fn(async (url: string) => {
    if (url.endsWith('/run')) {
      if (options.failure) throw Error('mock transport unknown');
      return new Response(JSON.stringify({ id: 'prediction-fixture' }));
    }
    if (url.endsWith('/status/prediction-fixture')) return new Response(JSON.stringify({ status: 'completed', output: ['data:image/png;base64,iVBORw0KGgo='] }));
    throw Error('Unexpected network route');
  });
  const cache = new Map<string, { exports: Record<string, unknown> }>();
  function load(filename: string): Record<string, unknown> {
    if (cache.has(filename)) return cache.get(filename)!.exports;
    const module = { exports: {} }; cache.set(filename, module);
    const js = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(js, {
      module, exports: module.exports, require: (name: string) => name.startsWith('jsr:') ? { createClient: () => admin } : load(path.resolve(path.dirname(filename), name)),
      Deno: { env: { get: (name: string) => ({ SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture', FASHN_API_KEY: 'fixture', VTON_TEST_TRIAL_ENABLED: options.paused ? 'paused' : options.enabled === false ? 'false' : 'true' }[name]) }, serve: (fn: typeof handler) => { handler = fn; } },
      Request, Response, Headers, URL, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
      crypto: webcrypto, atob, setTimeout: (fn: () => void) => { fn(); return 0; }, clearTimeout, fetch,
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


// Real service/contract code; only native, auth, journal and filesystem ports are doubled.
// This does not claim to re-test A1 durability or real PostgreSQL serialization.
function client(app: ReturnType<typeof edge>) {
  let request = 0;
  const observed = jest.fn();
  const written = jest.fn();
  const history = jest.fn();
  const jpeg = Buffer.from([255,216,255,224,0,16,74,70,73,70,0,1,1,0,0,1,0,1,0,0,255,192,0,17,8,0,32,0,32,3,1,34,0,2,17,1,3,17,1,255,217]).toString('base64');
  const mocks: Record<string, unknown> = {
    '../lib/accountDeviceWork': { captureOwnerPublication: () => () => true, trackOwnerWork: (_: unknown, work: unknown) => work },
    '../lib/accountWriteFence': { withAccountWriteGuard: (_: unknown, work: () => unknown) => work() },
    './ownedDeviceFiles': { createOwnedFileUnderGuard: (_: unknown, _kind: unknown, _uri: unknown, write: () => unknown) => write() },
    '../lib/analytics': { createUuid: () => 'result-fixture' },
    'expo-file-system/legacy': { cacheDirectory: 'file:///fixture/', EncodingType: { Base64: 'base64' }, makeDirectoryAsync: jest.fn(), writeAsStringAsync: written },
    'expo-file-system': { File: class { async base64() { return jpeg; } } },
    '../lib/logger': { logger: { error: jest.fn(), warn: jest.fn() } },
    '../lib/personPhotoPrepare': { withPreparedPersonJpeg: (_: unknown, uri: string, work: (uri: string) => unknown) => work(uri) },
    '../lib/supabase': { getRequiredSupabaseClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'fixture', user: { id: 'owner' } } } }) } }) },
    './vtonHistoryService': { appendTryOnHistory: history },
    './providerDeviceJournal': { beginProviderDeviceIntentUnderGuard: async () => ({ request: `client-${++request}` }), observeProviderDeviceResponseUnderGuard: observed },
  };
  const cache = new Map<string, { exports: Record<string, unknown> }>();
  const transport = jest.fn(async (url: string, init: RequestInit) => app.handler(new Request(url, init)));
  function load(filename: string): Record<string, unknown> {
    if (cache.has(filename)) return cache.get(filename)!.exports;
    const module = { exports: {} }; cache.set(filename, module);
    vm.runInNewContext(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
      module, exports: module.exports,
      require: (name: string) => mocks[name] ?? load(path.resolve(path.dirname(filename), `${name}.ts`)),
      process: { env: { EXPO_PUBLIC_VTON_PROXY_URL: 'https://fixture.invalid' } },
      fetch: transport, URL, AbortController, setTimeout, clearTimeout, Buffer, Uint8Array, console,
    }, { filename });
    return module.exports;
  }
  const service = load(path.resolve('services/vtonService.ts')) as unknown as {
    getVtonTrialStatus(owner: string): Promise<{ enabled: boolean; used: boolean }>;
    tryOnGarment(uri: string, product: string, options: object): Promise<string>;
    VtonServiceError: typeof Error;
  };
  return { ...service, transport, observed, written, history };
}

function modal(service: ReturnType<typeof client>, unavailable = false) {
  const text = readFileSync('components/VirtualTryOnModal.tsx', 'utf8');
  const source = ts.createSourceFile('modal.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback = '';
  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleTryOn' && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0].getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source); expect(callback).not.toBe('');
  const setTrialStatus = jest.fn(), setStatus = jest.fn(), setResultImageUrl = jest.fn(), setErrorMessage = jest.fn();
  const scope = {
    user: { id: 'owner' }, captureOwnerPublication: () => () => true,
    trialUnavailable: unavailable, status: 'idle', product: { id: 'fixture', title: 'Fixture', imageUrl: 'https://fixture.invalid/item.jpg' },
    personImageUri: 'file:///fixture.jpg', setStatus, setErrorMessage, resetMessage: '',
    track: jest.fn(), LEGACY_RECOMMENDATION_ID: 'fixture', tryOnGarment: service.tryOnGarment,
    setResultImageUrl, isInCloset: false, recordSessionProductAction: jest.fn(),
    VtonServiceError: service.VtonServiceError, logger: { error: jest.fn() }, Alert: { alert: jest.fn() },
    trialSetters: { current: { setTrialStatus, setTrialStatusError: jest.fn() } }, getVtonTrialStatus: service.getVtonTrialStatus,
  };
  const run = new Function(...Object.keys(scope), ts.transpile(`return (${callback});`, { target: ts.ScriptTarget.ES2020 }))(...Object.values(scope)) as () => Promise<void>;
  return { run, setTrialStatus, setStatus, setResultImageUrl, setErrorMessage };
}

test('successful mocked inference flows through actual proxy/helper/service/modal, then server denies a distinct second request', async () => {
  const app = edge(), service = client(app);
  expect(await service.getVtonTrialStatus('owner')).toEqual({ enabled: true, used: false });
  const view = modal(service); await view.run();
  expect(view.setStatus).toHaveBeenLastCalledWith('success');
  expect(view.setResultImageUrl).toHaveBeenCalledWith(expect.stringMatching(/\.png$/));
  expect(service.written).toHaveBeenCalledTimes(1);
  expect(service.observed).toHaveBeenCalledTimes(1);
  expect(service.history).toHaveBeenCalledTimes(1);
  expect(view.setTrialStatus).toHaveBeenLastCalledWith({ enabled: true, used: true });
  await expect(service.tryOnGarment('file:///fixture.jpg', 'https://fixture.invalid/item.jpg', {})).rejects.toThrow('Deneme hakkını kullandın');
  expect(app.fetch.mock.calls.filter(([url]) => url.endsWith('/run'))).toHaveLength(1);
  expect((await app.post('client-1')).status).toBe(409);
  const before = service.transport.mock.calls.length;
  await modal(service, true).run();
  expect(service.transport).toHaveBeenCalledTimes(before);
});

test('transport UNKNOWN keeps entitlement consumed, modal reports failure and status read disables another attempt', async () => {
  const app = edge({ failure: true }), service = client(app), view = modal(service);
  await view.run();
  expect(view.setStatus).toHaveBeenLastCalledWith('error');
  expect(view.setResultImageUrl).not.toHaveBeenCalled();
  expect(view.setTrialStatus).toHaveBeenLastCalledWith({ enabled: true, used: true });
  expect(service.observed).not.toHaveBeenCalled();
  expect(service.written).not.toHaveBeenCalled();
  await expect(service.tryOnGarment('file:///fixture.jpg', 'https://fixture.invalid/item.jpg', {})).rejects.toThrow('Deneme hakkını kullandın');
  expect(app.fetch).toHaveBeenCalledTimes(1);
});

test('proven server admission failure preserves entitlement and never dispatches the mocked provider', async () => {
  const app = edge({ admissionFails: true }), service = client(app), view = modal(service);
  await view.run();
  expect(view.setStatus).toHaveBeenLastCalledWith('error');
  expect(view.setTrialStatus).toHaveBeenLastCalledWith({ enabled: true, used: false });
  expect(app.fetch).not.toHaveBeenCalled();
});
