import { readFileSync } from 'node:fs';
import { accountStorageUploadHandler, validUploadPath, UPLOAD_HANDLER_DEADLINE_MS, type UploadServerClient } from '../supabase/functions/_shared/accountStorageUploadHandler';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const operation = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const lease = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const path = `${owner}/model.jpg`;
test('original PNG has an immutable UUID version path distinct from cutout and another owner', () => {
  expect(validUploadPath(owner, 'wardrobe-cutouts', `${owner}/${operation}/original-${lease}.png`)).toBe(true);
  expect(validUploadPath(owner, 'wardrobe-cutouts', `${owner}/${operation}/original.png`)).toBe(false);
  expect(validUploadPath(owner, 'wardrobe-cutouts', `${lease}/${operation}/original-${lease}.png`)).toBe(false);
});
const request = () => new Request('https://local.invalid', { method: 'POST', headers: {
  Authorization: 'Bearer synthetic', 'x-upload-bucket': 'model-photos', 'x-upload-path': path,
  'x-upload-request': 'synthetic-operation', 'content-type': 'image/jpeg',
}, body: new Uint8Array([255,216,255]) });

function fixture(point = '', objectPath = path, bucket = 'model-photos') {
  let fenced = false, object = false, state = 'NONE';
  const sweep = () => { fenced = true; object = false; };
  const hook = (at: string) => { if (point === at) sweep(); };
  const remove = jest.fn(async (_paths: string[]) => { object = false; return { data: [], error: null }; });
  const upload = jest.fn(async () => { hook('during-write'); object = true; hook('after-write');
    return { data: { id: operation, path: objectPath, fullPath: `${bucket}/${objectPath}` }, error: null }; });
  const rpc = jest.fn(async (name: string) => {
    if (name === 'storage_upload_start') { hook('before-start'); if (fenced) return { data: null, error: { code: '42501' } };
      state = 'UNKNOWN'; hook('after-start'); return { data: true, error: null }; }
    if (name === 'deletion_is_fenced') { hook('before-check'); const result = fenced; hook('after-check'); return { data: result, error: null }; }
    if (name === 'storage_upload_succeed') { state = 'SUCCEEDED'; hook('after-terminal'); return { data: true, error: null }; }
    throw new Error('Unexpected RPC');
  });
  const admit = jest.fn(async () => { hook('before-admit'); if (fenced) return { data: null, error: { code: '42501' } };
    state = 'ADMITTED'; hook('after-admit'); return { data: { operation, lease, owner, bucket, path: objectPath }, error: null }; });
  const admin = { auth: { getUser: async () => ({ data: { user: { id: owner } }, error: null }) }, rpc,
    storage: { from: () => ({ upload, remove }) } } as unknown as UploadServerClient;
  const user = { rpc: admit } as unknown as UploadServerClient;
  return { handler: accountStorageUploadHandler(admin, () => user), rpc, remove, upload, sweep,
    remaining: () => object, state: () => state };
}

describe('FAZ 3b — fake RPC/Storage only', () => {
  it('original photo physically uploads without upsert and uses the same fence/terminal protocol', async () => {
    const original=owner+'/'+operation+'/original-'+lease+'.png';
    const f=fixture('',original,'wardrobe-cutouts');
    const headers=new Headers(request().headers);
    headers.set('x-upload-bucket','wardrobe-cutouts');headers.set('x-upload-path',original);headers.set('content-type','image/png');
    const response=await f.handler(new Request('https://local.invalid',{method:'POST',headers,body:new Uint8Array([137,80,78,71])}));
    expect(response.status).toBe(200);
    expect(f.upload).toHaveBeenCalledWith(original,expect.any(ArrayBuffer),{contentType:'image/png',upsert:false});
    expect(f.rpc.mock.calls.map(([name])=>name)).toEqual(['storage_upload_start','deletion_is_fenced','storage_upload_succeed']);
  });
  it('model removal uses owner-bound Edge service role without upload/UNKNOWN mutations', async () => {
    const f = fixture(); const input = request();
    for (let i=0;i<2;i++) {
      const response = await f.handler(new Request(input.url, { method:'DELETE', headers:input.headers }));
      expect(response.status).toBe(200); expect(await response.json()).toEqual({protocol:'vitrify.storage-remove.v1',state:'REMOVED'});
    }
    expect(f.remove).toHaveBeenCalledWith([path]); expect(f.upload).not.toHaveBeenCalled();
    expect(f.rpc.mock.calls.map(([name])=>name)).toEqual(['deletion_is_fenced','deletion_is_fenced']);
    expect(f.state()).toBe('NONE');
  });
  it('fenced model removal refuses; another owner path or cutout removal is not allowed', async () => {
    const f = fixture(); f.sweep(); const input = request();
    expect((await f.handler(new Request(input.url,{method:'DELETE',headers:input.headers}))).status).toBe(503);
    expect(f.remove).not.toHaveBeenCalled();
    const headers = new Headers(input.headers); headers.set('x-upload-path', lease+'/model.jpg');
    expect((await fixture().handler(new Request(input.url,{method:'DELETE',headers}))).status).toBe(400);
    headers.set('x-upload-bucket','wardrobe-cutouts');headers.set('x-upload-path',owner+'/'+operation+'/cutout.png');
    expect((await fixture().handler(new Request(input.url,{method:'DELETE',headers}))).status).toBe(400);
  });
  it('T2a: admission fence rejects with no write', async () => {
    const f = fixture('before-admit'); const response = await f.handler(request());
    expect(response.status).toBe(503); expect((await response.json()).state).toBe('BLOCKED'); expect(f.upload).not.toHaveBeenCalled();
  });
  it('T2b: late fence compensates without succeed or record mutation', async () => {
    const f = fixture('during-write'); const response = await f.handler(request());
    expect(response.status).toBe(503); expect((await response.json()).state).toBe('BLOCKED');
    expect(f.remove).toHaveBeenCalledWith([path]); expect(f.remaining()).toBe(false); expect(f.state()).toBe('UNKNOWN');
    expect(f.rpc.mock.calls.map(([name]) => name)).not.toContain('storage_upload_succeed');
  });
  it('T2c: no fence succeeds after read-only check', async () => {
    const f = fixture(); expect((await f.handler(request())).status).toBe(200);
    expect(f.rpc.mock.calls.map(([name]) => name)).toEqual(['storage_upload_start','deletion_is_fenced','storage_upload_succeed']);
    expect(f.remove).not.toHaveBeenCalled();
  });
  it('T2d: failed remove never succeeds; logs only a fixed event', async () => {
    const f = fixture('during-write'); f.remove.mockResolvedValue({ data: null, error: { message: `${owner}/${path}/SECRET` } } as any);
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try { expect((await f.handler(request())).status).toBe(503); expect(f.remaining()).toBe(true);
      expect(log).toHaveBeenCalledWith('ACCOUNT_STORAGE_UPLOAD_CLEANUP_FAILED'); expect(f.state()).toBe('UNKNOWN'); }
    finally { log.mockRestore(); }
  });
  it('T2e: failed fence query cleans the confirmed object and fails closed', async () => {
    const f = fixture(); const rpc = f.rpc.getMockImplementation()!;
    f.rpc.mockImplementation(async name => name === 'deletion_is_fenced' ? { data: null, error: { code: 'offline' } } : rpc(name));
    expect((await f.handler(request())).status).toBe(503); expect(f.remove).toHaveBeenCalledWith([path]); expect(f.state()).toBe('UNKNOWN');
  });
  it('T2f: deadline aborts response; late confirmed write is cleaned without terminal', async () => {
    jest.useFakeTimers(); const f = fixture(); let finish!: (value: any) => void, started!: () => void;
    const dispatched = new Promise<void>(resolve => { started = resolve; });
    f.upload.mockImplementation(() => new Promise(resolve => { finish = resolve; started(); }));
    try { const pending = f.handler(request()); await dispatched;
      await jest.advanceTimersByTimeAsync(UPLOAD_HANDLER_DEADLINE_MS); expect((await pending).status).toBe(503);
      finish({ data: { id: operation, path, fullPath: `model-photos/${path}` }, error: null });
      await jest.advanceTimersByTimeAsync(0); expect(f.remove).toHaveBeenCalledWith([path]);
      expect(f.rpc.mock.calls.map(([name]) => name)).not.toContain('storage_upload_succeed'); }
    finally { jest.useRealTimers(); }
  });
  it.each(['before-admit','after-admit','before-start','after-start','during-write','after-write','before-check','after-check','after-terminal'])
    ('T2g: fence+sweep at %s leaves no completed residual in the controlled schedule', async point => {
      const f = fixture(point); await f.handler(request()); expect(f.remaining()).toBe(false);
    });
  it('deadline during fence query cleans the known object without waiting for RPC', async () => {
    jest.useFakeTimers(); const f = fixture(); const rpc = f.rpc.getMockImplementation()!;
    let started!: () => void; const queried = new Promise<void>(resolve => { started = resolve; });
    f.rpc.mockImplementation(async name => name === 'deletion_is_fenced' ? new Promise(resolve => { started(); }) : rpc(name));
    try { const pending = f.handler(request()); await queried;
      await jest.advanceTimersByTimeAsync(UPLOAD_HANDLER_DEADLINE_MS); expect((await pending).status).toBe(503);
      expect(f.remove).toHaveBeenCalledWith([path]); expect(f.remaining()).toBe(false); expect(f.state()).toBe('UNKNOWN'); }
    finally { jest.useRealTimers(); }
  });
  it('unresolved same path excludes a newer operation before compensation (migration 19 contract)', () => {
    const sql = readFileSync('reports/backend/isolated-a1-migration20/supabase/migrations/20261011000019_vitrify_a1_19.sql','utf8');
    expect(sql).toContain("where state in ('ADMITTED','UNKNOWN')");
    expect(sql).toContain("raise exception 'Unresolved upload blocks this path'");
    expect(sql).toContain('perform deletion_private.lock_writer(who)');
  });
  it('SQL is STABLE/read-only, missing owner fails closed, only service_role executes', () => {
    const sql = readFileSync('reports/backend/proposals/20261012_a1_phase3b_upload_fence.sql', 'utf8');
    const forward = sql.split('-- ROLLBACK')[0];
    expect(forward).toMatch(/stable/i); expect(forward).toContain('deletion_private.owner_gates');
    expect(forward).toContain('coalesce'); expect(forward).not.toMatch(/for update|lock_writer|\b(insert|update|delete)\b/i);
    expect(forward).toContain('from public, anon, authenticated, service_role'); expect(forward).toContain('to service_role');
  });
});
