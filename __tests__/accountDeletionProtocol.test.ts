import AsyncStorage from '@react-native-async-storage/async-storage';
import { ACCOUNT_DELETION_PROTOCOL, AccountDeletionPendingError, accountDeletionCheckpointKey, deleteAccount, resumeAccountDeletion, resumePendingAccountDeletions, completeAccountDeletion, getAccountDeletionProgress } from '../services/accountService';
import { resetAnalyticsForTests } from '../lib/analytics';
import { resetAccountWriteFenceMemoryForTests, isAccountWriteFenced } from '../lib/accountWriteFence';
import { createDeletionReceipt } from '../lib/accountDeletionFoundation';
import { getRandomBytesAsync } from 'expo-crypto';
jest.mock('expo-crypto', () => ({ getRandomBytesAsync: jest.fn() }), { virtual: true });
jest.mock('expo-file-system/legacy', () => ({ cacheDirectory: 'file:///cache/', documentDirectory: 'file:///docs/',
  deleteAsync: jest.fn(), getInfoAsync: jest.fn().mockResolvedValue({ exists: false }) }));
const mockSession = { data: { session: { access_token: 'mock-only', user: { id: 'owner' } } }, error: null };
jest.mock('../lib/supabase', () => ({ getRequiredSupabaseClient: () => ({ auth: { getSession: async () => mockSession } }),
  getSupabaseClient: () => ({ auth: { getSession: async () => mockSession } }) }));
const runtime = () => ({ inventory: { subjectId: 'owner', coverageVerified: true, ownedFiles: [], extraOwnedKeys: [] }, clearAndVerifyMemory: async () => true });
let originalFetch: typeof fetch;
beforeEach(async () => {
  mockSession.data.session.user.id = 'owner';
  jest.mocked(getRandomBytesAsync).mockReset().mockResolvedValue(new Uint8Array(32).fill(17));
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: require('node:crypto').webcrypto });
  originalFetch = global.fetch; await resetAnalyticsForTests(); await AsyncStorage.clear(); resetAccountWriteFenceMemoryForTests();
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://mock.invalid';
});
afterEach(() => { mockSession.data.session.user.id = 'owner'; global.fetch = originalFetch; delete process.env.EXPO_PUBLIC_SUPABASE_URL; });
it('no runtime inventory, legacy backend or offline preflight can never dispatch destructive POST', async () => {
  const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 405 }); global.fetch = fetchMock;
  await expect(deleteAccount()).rejects.toThrow('yerel'); expect(fetchMock).not.toHaveBeenCalled();
  await expect(deleteAccount(runtime())).rejects.toThrow('koordinatörü');
  expect(fetchMock.mock.calls.map(call => call[1].method)).toEqual(['GET']);
  fetchMock.mockRejectedValueOnce(new Error('offline'));
  await expect(deleteAccount(runtime())).rejects.toThrow('offline');
  expect(await isAccountWriteFenced('owner')).toBe(false);
});
it('HTTP 200 alone is not completion; checkpoint/fence survive for retry', async () => {
  global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ protocol: ACCOUNT_DELETION_PROTOCOL, ready: true, postAuthRecovery: true }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ deleted: true }) });
  await expect(deleteAccount(runtime())).rejects.toThrow('completion');
  const receipt = JSON.parse((await AsyncStorage.getItem(accountDeletionCheckpointKey('owner')))!);
  expect(receipt.layers.queue.state).toBe('VERIFIED'); expect(await isAccountWriteFenced('owner')).toBe(true);
});
it('verified server + local layers complete once; unknown vendor is not marked complete', async () => {
  const fetchMock = jest.fn(async (_url: unknown, options: { method: string; body?: string }) => {
    if (options.method === 'GET') return { ok: true, json: async () => ({ protocol: ACCOUNT_DELETION_PROTOCOL, ready: true, postAuthRecovery: true }) };
    const request = JSON.parse(options.body!), receipt = request.deviceCheckpoint ?? JSON.parse((await AsyncStorage.getItem(accountDeletionCheckpointKey('owner')))!);
    for (const layer of ['write_fence', 'storage', 'jobs_payload', 'auth', 'db', 'recommendation_cache'] as const) receipt.layers[layer] = { state: 'VERIFIED', attempts: 1, evidence: ['controlled server fixture absent'] };
    return { ok: true, json: async () => ({ protocol: ACCOUNT_DELETION_PROTOCOL, receipt }) };
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  await deleteAccount(runtime());
  const first = JSON.parse((await AsyncStorage.getItem(accountDeletionCheckpointKey('owner')))!);
  expect(first.layers.vendor.state).toBe('UNKNOWN');
  expect(first.recoveryToken).toBeUndefined(); expect(first.deviceInventory).toBeUndefined();
  await deleteAccount(runtime());
  const ids = fetchMock.mock.calls.filter(call => call[1].method === 'POST').map(call => JSON.parse(call[1].body!).requestId);
  expect(new Set(ids).size).toBe(1);
});
it('post-Auth recovery sends a persisted capability without reading a session or sending Authorization', async () => {
  const receipt = createDeletionReceipt('request', 'owner');
  for (const layer of Object.keys(receipt.layers) as (keyof typeof receipt.layers)[]) if (!['vendor', 'backup', 'export'].includes(layer))
    receipt.layers[layer] = { state: 'VERIFIED', attempts: 1, evidence: ['fixture verified'] };
  const pending = JSON.parse(JSON.stringify(receipt)); pending.layers.auth.state = 'RUNNING'; pending.layers.auth.evidence = [];
  await AsyncStorage.setItem(accountDeletionCheckpointKey('owner'), JSON.stringify({ ...pending, recoveryToken: 'a'.repeat(64) }));
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ protocol: ACCOUNT_DELETION_PROTOCOL, receipt }) });
  global.fetch = fetchMock;
  await resumeAccountDeletion('owner');
  expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json', 'x-deletion-recovery': 'a'.repeat(64) });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ requestId: 'request' });
  expect(JSON.parse((await AsyncStorage.getItem(accountDeletionCheckpointKey('owner')))! ).recoveryToken).toBeUndefined();
});
it('startup recovery uses durable device proof and does not submit unrelated B checkpoints', async () => {
  const receipt = createDeletionReceipt('pending', 'owner');
  for (const layer of ['queue', 'async_storage', 'local_files', 'memory_cache'] as const)
    receipt.layers[layer] = { state: 'VERIFIED', attempts: 1, evidence: ['device verified'] };
  await AsyncStorage.setItem(accountDeletionCheckpointKey('owner'), JSON.stringify({ ...receipt, recoveryToken: 'a'.repeat(64) }));
  await AsyncStorage.setItem(accountDeletionCheckpointKey('B'), JSON.stringify(createDeletionReceipt('not-started', 'B')));
  const response = JSON.parse(JSON.stringify(receipt));
  for (const layer of Object.keys(response.layers)) if (!['vendor', 'backup', 'export'].includes(layer))
    response.layers[layer] = { state: 'VERIFIED', attempts: 1, evidence: ['verified'] };
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ protocol: ACCOUNT_DELETION_PROTOCOL, receipt: response }) });
  global.fetch = fetchMock; await resumePendingAccountDeletions();
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  expect(JSON.parse((await AsyncStorage.getItem(accountDeletionCheckpointKey('B')))! ).layers.auth.state).toBe('PENDING');
});
it.each(['unavailable', 'wrong_length'])('native secure randomness %s cannot fence or dispatch destructive POST', async failure => {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  if (failure === 'unavailable') jest.mocked(getRandomBytesAsync).mockRejectedValueOnce(new Error('native unavailable'));
  else jest.mocked(getRandomBytesAsync).mockResolvedValueOnce(new Uint8Array(16));
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ protocol: ACCOUNT_DELETION_PROTOCOL, ready: true, postAuthRecovery: true }) });
  global.fetch = fetchMock;
  await expect(deleteAccount(runtime())).rejects.toThrow('anahtarı');
  expect(await isAccountWriteFenced('owner')).toBe(false); expect(fetchMock.mock.calls).toHaveLength(1);
});
it('Expo Go without Web Crypto persists a native 256-bit recovery capability before POST', async () => {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  const fetchMock = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ protocol: ACCOUNT_DELETION_PROTOCOL, ready: true, postAuthRecovery: true }) })
    .mockResolvedValueOnce({ ok: false, status: 503, text: async () => '{}' });
  global.fetch = fetchMock;
  await expect(deleteAccount(runtime())).rejects.toBeInstanceOf(AccountDeletionPendingError);
  expect(getRandomBytesAsync).toHaveBeenCalledWith(32);
  const saved = JSON.parse((await AsyncStorage.getItem(accountDeletionCheckpointKey('owner')))!);
  expect(saved.recoveryToken).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).recoveryToken).toBe(saved.recoveryToken);
});
it('an account change during native random generation cannot start local deletion or POST', async () => {
  jest.mocked(getRandomBytesAsync).mockImplementationOnce(async () => {
    mockSession.data.session.user.id = 'other';
    return new Uint8Array(32).fill(17);
  });
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ protocol: ACCOUNT_DELETION_PROTOCOL, ready: true, postAuthRecovery: true }) });
  global.fetch = fetchMock;
  await expect(deleteAccount(runtime())).rejects.toThrow('Oturum değişti');
  expect(fetchMock.mock.calls.map(call => call[1].method)).toEqual(['GET']);
  expect(await isAccountWriteFenced('owner')).toBe(false);
});
it('a pending critical server layer is checkpointed and cannot complete deletion', async () => {
  global.fetch = jest.fn(async (_url: unknown, options: { method: string; body?: string }) => {
    if (options.method === 'GET') return { ok: true, json: async () => ({ protocol: ACCOUNT_DELETION_PROTOCOL, ready: true, postAuthRecovery: true }) };
    const request = JSON.parse(options.body!), receipt = createDeletionReceipt(request.requestId, 'owner');
    return { ok: true, json: async () => ({ protocol: ACCOUNT_DELETION_PROTOCOL, receipt }) };
  }) as unknown as typeof fetch;
  await expect(deleteAccount(runtime())).rejects.toThrow('bekliyor');
  const saved = JSON.parse((await AsyncStorage.getItem(accountDeletionCheckpointKey('owner')))!);
  expect(saved.layers.storage.state).toBe('PENDING'); expect(saved.deviceInventory.subjectId).toBe('owner');
});
it('503 pending keeps the exact durable identity across an explicit retry', async () => {
  const fetchMock = jest.fn(async (_url: unknown, options: { method: string; body?: string }) => options.method === 'GET'
    ? { ok: true, json: async () => ({ protocol: ACCOUNT_DELETION_PROTOCOL, ready: true, postAuthRecovery: true }) }
    : { ok: false, status: 503, text: async () => JSON.stringify({ protocol: ACCOUNT_DELETION_PROTOCOL, detail: 'Deletion pending; retry with the same recovery identity' }) });
  global.fetch = fetchMock as unknown as typeof fetch;
  await expect(deleteAccount(runtime())).rejects.toBeInstanceOf(AccountDeletionPendingError);
  const saved = await AsyncStorage.getItem(accountDeletionCheckpointKey('owner'));
  const identity = JSON.parse(saved!);
  await expect(deleteAccount(runtime())).rejects.toBeInstanceOf(AccountDeletionPendingError);
  expect(await AsyncStorage.getItem(accountDeletionCheckpointKey('owner'))).toBe(saved);
  expect(getRandomBytesAsync).toHaveBeenCalledTimes(1);
  const posts = fetchMock.mock.calls.filter(call => call[1].method === 'POST');
  expect(posts).toHaveLength(2);
  for (const call of posts) expect(JSON.parse(call[1].body!).requestId).toBe(identity.requestId);
  expect(JSON.parse(posts[0][1].body!).recoveryToken).toBe(identity.recoveryToken);
  for (const call of posts.slice(1)) {
    const options = call[1] as { method: string; body?: string; headers?: Record<string, string> };
    expect(options.headers?.['x-deletion-recovery']).toBe(identity.recoveryToken);
    expect(options.headers?.Authorization).toBeUndefined();
  }
});
it('one confirmation continues a pending request automatically with the persisted identity', async () => {
  jest.useFakeTimers();
  try {
    const posts: { requestId: string; capability: string }[] = [];
    global.fetch = jest.fn(async (_url, options) => {
      if (options?.method === 'GET') return { ok: true, json: async () => ({ protocol: ACCOUNT_DELETION_PROTOCOL, ready: true, postAuthRecovery: true }) } as Response;
      const body = JSON.parse(String(options?.body));
      const headers = options?.headers as Record<string, string>;
      posts.push({ requestId: body.requestId, capability: body.recoveryToken ?? headers['x-deletion-recovery'] });
      if (posts.length === 1) return { ok: false, status: 503 } as Response;
      const saved = JSON.parse((await AsyncStorage.getItem(accountDeletionCheckpointKey('owner')))!);
      const receipt = createDeletionReceipt(saved.requestId, 'owner');
      for (const layer of Object.keys(receipt.layers) as (keyof typeof receipt.layers)[]) if (!['vendor','backup','export'].includes(layer))
        receipt.layers[layer] = { state: 'VERIFIED', attempts: 1, evidence: ['fixture verified'] };
      return { ok: true, json: async () => ({ protocol: ACCOUNT_DELETION_PROTOCOL, receipt }) } as Response;
    });
    const work = completeAccountDeletion(runtime());
    expect(completeAccountDeletion(runtime())).toBe(work);
    await jest.advanceTimersByTimeAsync(89_000);
    expect(posts).toHaveLength(1);
    expect(getAccountDeletionProgress('owner')?.phase).toBe('waiting');
    expect(getAccountDeletionProgress('other')).toBeNull();
    await jest.advanceTimersByTimeAsync(2_000);
    await work;
    expect(posts).toHaveLength(2); expect(posts[1]).toEqual(posts[0]);
    expect(getRandomBytesAsync).toHaveBeenCalledTimes(1);
    expect(getAccountDeletionProgress('owner')?.phase).toBe('completed');
  } finally { jest.useRealTimers(); }
});
it.each(['network', 'server', 'unknown'])('startup recovery stops on %s without new identity or endless retry', async failure => {
  jest.useFakeTimers();
  try {
    const receipt = createDeletionReceipt('persisted-request', 'owner');
    for (const layer of ['queue','async_storage','local_files','memory_cache'] as const)
      receipt.layers[layer] = { state: 'VERIFIED', attempts: 1, evidence: ['fixture verified'] };
    const saved = JSON.stringify({ ...receipt, recoveryToken: 'a'.repeat(64) });
    await AsyncStorage.setItem(accountDeletionCheckpointKey('owner'), saved);
    const reply = structuredClone(receipt); reply.layers.storage.state = 'UNKNOWN';
    global.fetch = jest.fn(async () => {
      if (failure === 'network') throw new Error('offline');
      return failure === 'server' ? { ok: false, status: 500 } as Response
        : { ok: true, json: async () => ({ protocol: ACCOUNT_DELETION_PROTOCOL, receipt: reply }) } as Response;
    });
    await resumePendingAccountDeletions();
    await jest.advanceTimersByTimeAsync(600_000);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(getRandomBytesAsync).not.toHaveBeenCalled();
    expect(getAccountDeletionProgress('owner')?.phase).toBe('stopped');
    const persisted = JSON.parse((await AsyncStorage.getItem(accountDeletionCheckpointKey('owner')))!);
    expect(persisted.requestId).toBe('persisted-request'); expect(persisted.recoveryToken).toBe('a'.repeat(64));
  } finally { jest.useRealTimers(); }
});
it('startup continues the durable request through pending then verified completion', async () => {
  jest.useFakeTimers();
  try {
    const receipt = createDeletionReceipt('restart-request', 'owner');
    for (const layer of ['queue','async_storage','local_files','memory_cache'] as const)
      receipt.layers[layer] = { state: 'VERIFIED', attempts: 1, evidence: ['fixture verified'] };
    await AsyncStorage.setItem(accountDeletionCheckpointKey('owner'), JSON.stringify({ ...receipt, recoveryToken: 'a'.repeat(64) }));
    const complete = structuredClone(receipt);
    for (const layer of Object.keys(complete.layers) as (keyof typeof complete.layers)[]) if (!['vendor','backup','export'].includes(layer))
      complete.layers[layer] = { state: 'VERIFIED', attempts: 1, evidence: ['fixture verified'] };
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ protocol: ACCOUNT_DELETION_PROTOCOL, receipt: complete }) });
    const work = resumePendingAccountDeletions();
    await jest.advanceTimersByTimeAsync(91_000); await work;
    expect(global.fetch).toHaveBeenCalledTimes(2);
    for (const call of jest.mocked(global.fetch).mock.calls) {
      expect(JSON.parse(String(call[1]?.body)).requestId).toBe('restart-request');
      expect((call[1]?.headers as Record<string,string>)['x-deletion-recovery']).toBe('a'.repeat(64));
    }
    expect(getAccountDeletionProgress('owner')?.phase).toBe('completed');
    expect(getRandomBytesAsync).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});
it('restart before device cleanup completes restores the existing identity and verifies local layers', async () => {
  const receipt = createDeletionReceipt('local-interruption', 'owner');
  await AsyncStorage.setItem(accountDeletionCheckpointKey('owner'), JSON.stringify({ ...receipt, recoveryToken: 'a'.repeat(64), deviceInventory: runtime().inventory }));
  global.fetch = jest.fn(async (_url, options) => {
    if (options?.method === 'GET') return { ok: true, json: async () => ({ protocol: ACCOUNT_DELETION_PROTOCOL, ready: true, postAuthRecovery: true }) } as Response;
    const body = JSON.parse(String(options?.body));
    expect(body.requestId).toBe('local-interruption'); expect(body.recoveryToken).toBe('a'.repeat(64));
    const completed = structuredClone(body.deviceCheckpoint);
    for (const layer of Object.keys(completed.layers)) if (!['vendor','backup','export'].includes(layer))
      completed.layers[layer] = { state: 'VERIFIED', attempts: 1, evidence: ['fixture verified'] };
    return { ok: true, json: async () => ({ protocol: ACCOUNT_DELETION_PROTOCOL, receipt: completed }) } as Response;
  });
  const restore = jest.fn(async () => runtime());
  await resumePendingAccountDeletions(restore);
  expect(restore).toHaveBeenCalledTimes(1);
  expect(getRandomBytesAsync).not.toHaveBeenCalled();
  expect(getAccountDeletionProgress('owner')?.phase).toBe('completed');
});
it('a completed tombstone on restart needs no request and publishes only verified completion', async () => {
  const receipt = createDeletionReceipt('already-completed', 'owner');
  for (const layer of Object.keys(receipt.layers) as (keyof typeof receipt.layers)[]) if (!['vendor','backup','export'].includes(layer))
    receipt.layers[layer] = { state: 'VERIFIED', attempts: 1, evidence: ['fixture verified'] };
  await AsyncStorage.setItem(accountDeletionCheckpointKey('owner'), JSON.stringify(receipt));
  global.fetch = jest.fn();
  await resumePendingAccountDeletions();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(getAccountDeletionProgress('owner')?.phase).toBe('completed');
});
it('automatic pending continuation has a finite budget and keeps the saved identity on stop', async () => {
  jest.useFakeTimers();
  try {
    global.fetch = jest.fn(async (_url, options) => options?.method === 'GET'
      ? { ok: true, json: async () => ({ protocol: ACCOUNT_DELETION_PROTOCOL, ready: true, postAuthRecovery: true }) } as Response
      : { ok: false, status: 503 } as Response);
    const outcome = completeAccountDeletion(runtime()).then(() => null, error => error);
    await jest.advanceTimersByTimeAsync(180_000);
    expect(await outcome).toBeInstanceOf(AccountDeletionPendingError);
    const calls = jest.mocked(global.fetch).mock.calls.filter(call => call[1]?.method === 'POST');
    expect(calls).toHaveLength(4);
    expect(getAccountDeletionProgress('owner')?.phase).toBe('stopped');
    const saved = JSON.parse((await AsyncStorage.getItem(accountDeletionCheckpointKey('owner')))!);
    expect(saved.recoveryToken).toMatch(/^[a-f0-9]{64}$/);
    await jest.advanceTimersByTimeAsync(600_000);
    expect(jest.mocked(global.fetch).mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(4);
  } finally { jest.useRealTimers(); }
});
