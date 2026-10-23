import { cutoutV2ControlHandler } from '../supabase/functions/_shared/cutoutV2Control';

const id = '11111111-1111-4111-8111-111111111111';
const request = (route: string, body?: object, token = 'session') => new Request(`https://unit.invalid/wardrobe-cutout-control/${route}`, {
  method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
});
function fixture(enabled = true) {
  const rpc = jest.fn(async (_action: string, _value: Record<string, unknown>): Promise<Record<string, unknown>> => ({ state: 'RESERVED', jobId: id, revision: 0 }));
  const dispatch = jest.fn(async () => {});
  const auth = jest.fn(async () => id);
  const source = jest.fn(async () => new Uint8Array([1]).buffer);
  return { rpc, dispatch, auth, source, handle: cutoutV2ControlHandler({ enabled, rpc, dispatch, auth, source }) };
}
test('V2 OFF prevents auth, RPC, reads and provider dispatch', async () => {
  const f = fixture(false);
  expect((await f.handle(request('reserve', { itemId: id, requestId: id, originalVersion: 'a'.repeat(64) }))).status).toBe(503);
  expect(f.rpc).not.toHaveBeenCalled(); expect(f.auth).not.toHaveBeenCalled(); expect(f.dispatch).not.toHaveBeenCalled();
});
test('reserve derives owner from authenticated session, rejects supplied owner', async () => {
  const f = fixture();
  expect((await f.handle(request('reserve', { owner: 'foreign', itemId: id, requestId: id, originalVersion: 'a'.repeat(64) }))).status).toBe(400);
  expect(f.rpc).not.toHaveBeenCalled();
});
test('failed atomic execute never sends provider request', async () => {
  const f = fixture(); f.rpc.mockRejectedValueOnce(new Error('CHECKPOINT_FAILED'));
  expect((await f.handle(request('execute', { jobId: id, requestId: id, revision: 0 }))).status).toBe(503);
  expect(f.dispatch).not.toHaveBeenCalled();
});
test('duplicate execute ACK does not dispatch again; no raw capability in owner response', async () => {
  const f = fixture();
  f.rpc.mockResolvedValue({ state: 'RUNNING', jobId: id, revision: 2 });
  const response = await f.handle(request('execute', { jobId: id, requestId: id, revision: 0 }));
  expect(response.status).toBe(202); expect(f.dispatch).not.toHaveBeenCalled();
  expect(await response.text()).not.toContain('Token');
});
test('status does not execute or invoke provider; missing stays UNKNOWN', async () => {
  const f = fixture(); f.rpc.mockResolvedValue({ state: 'UNKNOWN', jobId: id, revision: 0 });
  expect((await f.handle(request(`status?jobId=${id}&requestId=${id}`))).status).toBe(200);
  expect(f.rpc).toHaveBeenCalledWith('status', expect.objectContaining({ owner: id }));
  expect(f.dispatch).not.toHaveBeenCalled(); expect(f.source).not.toHaveBeenCalled();
});
test('claim uses scoped capability hash without forwarding session auth', async () => {
  const f = fixture();
  f.rpc.mockResolvedValue({ claimed: true, jobId: id });
  const r = new Request('https://unit.invalid/wardrobe-cutout-control/claim', { method: 'POST', headers: { 'x-cutout-capability': 'a'.repeat(64) }, body: JSON.stringify({ jobId: id }) });
  expect((await f.handle(r)).status).toBe(200);
  expect(f.auth).not.toHaveBeenCalled(); expect(f.rpc).toHaveBeenCalledWith('claim', expect.objectContaining({ job: id, tokenHash: expect.any(String) }));
});
