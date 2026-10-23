import { createHash } from 'node:crypto';
import { createDeletionReceipt, deletionHandler, type DeletionPort } from '../supabase/functions/_shared/accountDeletionCoordinator';
import { DELETION_LAYERS } from '../supabase/functions/_shared/accountDeletionFoundation';

// Local handler contract only. Real Supabase JWT/RPC/gateway validation awaits SQL setup.
const capability = 'a'.repeat(64);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function fixture() {
  const receipt = createDeletionReceipt('r1', 'A');
  for (const name of Object.keys(DELETION_LAYERS) as Array<keyof typeof DELETION_LAYERS>) {
    if (!['vendor', 'backup', 'export'].includes(name)) receipt.layers[name] = { state: 'VERIFIED', attempts: 1, evidence: ['controlled durable proof'] };
  }
  const authenticate = jest.fn(async (token: string) => token === 'valid-user-jwt' ? 'A' : null);
  const begin = jest.fn(async (subject: string | null, request: string, token: string) => {
    if (request !== 'r1' || digest(token) !== digest(capability) || (subject !== null && subject !== 'A')) throw new Error('Identity denied');
    return { receipt: JSON.parse(JSON.stringify(receipt)), lease: 'controlled-lease' };
  });
  const adapters = jest.fn(() => Object.fromEntries(Object.keys(DELETION_LAYERS).map(name => [name, {
    idempotent: true, cleanup: jest.fn(async () => { throw new Error('No new deletion permitted in this fixture'); }),
    verify: async () => ({ complete: true, evidence: ['controlled existing absence'] }),
  }])));
  const readiness = jest.fn(async () => true);
  const port: DeletionPort = { authenticate, begin, adapters, readiness, save: async () => {}, release: async () => {} };
  return { handler: deletionHandler(port), authenticate, begin, adapters, readiness, receipt };
}
it.each([undefined, 'bad-user-jwt'])('normal POST rejects missing/invalid user JWT (%s) before any coordinator work', async token => {
  const f = fixture();
  const headers: Record<string, string> = token ? { Authorization: 'Bearer ' + token } : {};
  const response = await f.handler(new Request('https://local.invalid', { method: 'POST', headers }));
  expect(response.status).toBe(401); expect(f.readiness).not.toHaveBeenCalled(); expect(f.begin).not.toHaveBeenCalled(); expect(f.adapters).not.toHaveBeenCalled();
});
it.each(['not-a-capability', capability])('GET cannot use a recovery header as authentication (%s)', async token => {
  const f = fixture();
  const response = await f.handler(new Request('https://local.invalid', { headers: { 'x-deletion-recovery': token } }));
  expect(response.status).toBe(401); expect(f.readiness).not.toHaveBeenCalled(); expect(f.begin).not.toHaveBeenCalled();
});
it('GET readiness requires independent user JWT validation', async () => {
  const f = fixture();
  const response = await f.handler(new Request('https://local.invalid', { headers: { Authorization: 'Bearer valid-user-jwt' } }));
  expect(response.status).toBe(200); expect(f.authenticate).toHaveBeenCalledWith('valid-user-jwt'); expect(f.begin).not.toHaveBeenCalled();
});
it('normal POST binds the coordinator subject to the independently validated user JWT', async () => {
  const f = fixture();
  const response = await f.handler(new Request('https://local.invalid', { method: 'POST',
    headers: { Authorization: 'Bearer valid-user-jwt' },
    body: JSON.stringify({ requestId: 'r1', recoveryToken: capability, deviceCheckpoint: f.receipt }) }));
  expect(response.status).toBe(200); expect(f.authenticate).toHaveBeenCalledWith('valid-user-jwt');
  expect(f.begin).toHaveBeenCalledWith('A', 'r1', capability);
});
it('a valid JWT cannot authorize another subject supplied in device proof', async () => {
  const f = fixture();
  const response = await f.handler(new Request('https://local.invalid', { method: 'POST',
    headers: { Authorization: 'Bearer valid-user-jwt' },
    body: JSON.stringify({ requestId: 'r1', recoveryToken: capability, deviceCheckpoint: { ...f.receipt, subjectId: 'B' } }) }));
  expect(response.status).toBe(400); expect(f.begin).not.toHaveBeenCalled(); expect(f.adapters).not.toHaveBeenCalled();
});
it('malformed recovery capability is rejected before the durable identity RPC', async () => {
  const f = fixture();
  const response = await f.handler(new Request('https://local.invalid', { method: 'POST',
    headers: { 'x-deletion-recovery': 'malformed' }, body: JSON.stringify({ requestId: 'r1' }) }));
  expect(response.status).toBe(400); expect(f.begin).not.toHaveBeenCalled(); expect(f.adapters).not.toHaveBeenCalled();
});
it('unsupported methods cannot enter authentication or coordinator execution', async () => {
  const f = fixture();
  const response = await f.handler(new Request('https://local.invalid', { method: 'PUT' }));
  expect(response.status).toBe(405); expect(f.authenticate).not.toHaveBeenCalled(); expect(f.begin).not.toHaveBeenCalled();
});
it('wrong recovery capability or request identity cannot obtain adapters, even with a valid JWT present', async () => {
  for (const [requestId, token] of [['r1', 'b'.repeat(64)], ['foreign-request', capability]]) {
    const f = fixture();
    const response = await f.handler(new Request('https://local.invalid', { method: 'POST',
      headers: { 'x-deletion-recovery': token, Authorization: 'Bearer valid-user-jwt' }, body: JSON.stringify({ requestId }) }));
    expect(response.status).toBe(503); expect(f.authenticate).not.toHaveBeenCalled(); expect(f.adapters).not.toHaveBeenCalled();
  }
});
it('valid recovery is bound to durable request/capability and works without any user JWT', async () => {
  const f = fixture();
  const response = await f.handler(new Request('https://local.invalid', { method: 'POST',
    headers: { 'x-deletion-recovery': capability }, body: JSON.stringify({ requestId: 'r1' }) }));
  expect(response.status).toBe(200); expect(f.authenticate).not.toHaveBeenCalled(); expect(f.begin).toHaveBeenCalledWith(null, 'r1', capability);
  expect(f.adapters).not.toHaveBeenCalled(); // Durable completion replay does not restart cleanup.
});
