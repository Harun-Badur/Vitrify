import { readFileSync } from 'node:fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { accountStorageUploadHandler, type UploadServerClient } from '../supabase/functions/_shared/accountStorageUploadHandler';
import { uploadAccountStorage, accountStorageUploadInventory, clearCompletedStorageUploadJournal } from '../services/accountStorageUpload';
import type { SupabaseClient } from '@supabase/supabase-js';

// Compile the handler binding against the installed real SDK types; no client/network created.
const sdkBinding = (admin: SupabaseClient, user: (jwt: string) => SupabaseClient) => accountStorageUploadHandler(admin, user);
void sdkBinding;

const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const operation='cccccccc-cccc-4ccc-8ccc-cccccccccccc', lease='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const path=`${A}/model.jpg`;
let mockClient: any;
jest.mock('../lib/supabase', () => ({ getRequiredSupabaseClient: () => mockClient }));
function fixture(bucket='model-photos',objectPath=path) {
  let state='NONE', fenced=false; const order: string[]=[];
  const upload=jest.fn(async () => { order.push('bytes'); return { data:{id:operation,path:objectPath,fullPath:`${bucket}/${objectPath}`},error:null }; });
  const remove=jest.fn(async()=>({data:[],error:null}));
  const admit=jest.fn(async (_name: string,_args: Record<string,any>) => { order.push('admit'); if(fenced || state!=='NONE') return {data:null,error:'closed'};
    state='ADMITTED'; return {data:{operation,lease,owner:A,bucket,path:objectPath},error:null}; });
  const rpc=jest.fn(async (name: string) => {
    if(name==='deletion_is_fenced') { order.push('fence-read'); return {data:fenced,error:null}; }
    if(name==='storage_upload_start') { order.push('durable-unknown'); if(fenced || state!=='ADMITTED') return {data:false,error:'closed'};
      state='UNKNOWN'; return {data:true,error:null}; }
    if(name==='storage_upload_succeed') { order.push('terminal'); state='SUCCEEDED'; return {data:true,error:null}; }
    return {data:null,error:'unknown rpc'};
  });
  const admin={auth:{getUser:jest.fn(async token => ({data:{user:token==='valid-jwt'?{id:A}:null},error:token==='valid-jwt'?null:'denied'}))},rpc,
    storage:{from:jest.fn(() => ({upload,remove}))}} as unknown as UploadServerClient;
  const user={rpc:admit} as unknown as UploadServerClient;
  const factory=jest.fn(() => user);
  return {handler:accountStorageUploadHandler(admin,factory),admin,rpc,admit,upload,factory,order,
    state:()=>state,fence:()=>{fenced=true;}};
}
const request=(headers: Record<string,string>={}) => new Request('https://local.invalid', {method:'POST',
  headers:{Authorization:'Bearer valid-jwt','x-upload-bucket':'model-photos','x-upload-path':path,'x-upload-request':'request-A','Content-Type':'image/jpeg',...headers},
  body:new Uint8Array([255,216,255])});
describe('server upload handler and SDK bindings (controlled clients, no live Storage/PostgreSQL)', () => {
  it('rejects model photo above 5 MiB before admission even without Content-Length', async () => {
    const f = fixture();
    const req = request();
    const response = await f.handler(new Request(req, { body: new Uint8Array(5 * 1024 * 1024 + 1) }));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ state: 'REJECTED', code: 'MODEL_PHOTO_TOO_LARGE',
      maxBytes: 5 * 1024 * 1024, detail: 'Model fotoğrafı en fazla 5 MiB olabilir. Daha küçük bir fotoğraf seç.' });
    expect(f.admit).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled();
  });
  it('accepts exactly 5 MiB for model photo', async () => {
    const f = fixture();
    expect((await f.handler(new Request(request(), { body: new Uint8Array(5 * 1024 * 1024) }))).status).toBe(200);
    expect(f.upload).toHaveBeenCalledTimes(1);
  });
  it('keeps the 12 MiB wardrobe limit independent of the model limit', async () => {
    const objectPath = `${A}/item-1/cutout.png`, f = fixture('wardrobe-cutouts', objectPath);
    const req = request({ 'x-upload-bucket': 'wardrobe-cutouts', 'x-upload-path': objectPath, 'Content-Type': 'image/png' });
    expect((await f.handler(new Request(req, { body: new Uint8Array(12 * 1024 * 1024) }))).status).toBe(200);
  });
  it.each(['','Bearer malformed'])('rejects invalid JWT (%s) before admission',async Authorization=>{
    const f=fixture(); expect((await f.handler(request({Authorization}))).status).toBe(401);
    expect(f.admit).not.toHaveBeenCalled();expect(f.upload).not.toHaveBeenCalled();
  });
  it('rejects B path under A JWT regardless of supplied owner header',async()=>{
    const f=fixture();expect((await f.handler(request({'x-upload-path':`${B}/model.jpg`,'x-upload-owner':B}))).status).toBe(400);
    expect(f.admit).not.toHaveBeenCalled();
  });
  it.each(['public-cache','model-photos/other'])('rejects unapproved bucket %s',async bucket=>{
    const f=fixture();expect((await f.handler(request({'x-upload-bucket':bucket}))).status).toBe(400);expect(f.upload).not.toHaveBeenCalled();
  });
  it.each([`${A}/../model.jpg`,`${A}/x/model.jpg`,`${A}/model.png`])('rejects model path %s',async value=>{
    const f=fixture();expect((await f.handler(request({'x-upload-path':value}))).status).toBe(400);
  });
  it('missing admission RPC is fail-closed',async()=>{
    const f=fixture(); f.admit.mockResolvedValue({data:null,error:'missing function'} as any);
    expect((await f.handler(request())).status).toBe(503);expect(f.upload).not.toHaveBeenCalled();
  });
  it('fence after admission prevents physical dispatch',async()=>{
    const f=fixture();const admit=f.admit.getMockImplementation()!;f.admit.mockImplementation(async(name,args)=>{const op=await admit(name,args);f.fence();return op;});
    expect((await f.handler(request())).status).toBe(503);expect(f.upload).not.toHaveBeenCalled();
  });
  it('mismatched operation owner is rejected before start',async()=>{
    const f=fixture();f.admit.mockResolvedValue({data:{operation,lease,owner:B,bucket:'model-photos',path},error:null});
    expect((await f.handler(request())).status).toBe(503);expect(f.rpc).not.toHaveBeenCalled();expect(f.upload).not.toHaveBeenCalled();
  });
  it('UNKNOWN checkpoint failure sends zero bytes',async()=>{
    const f=fixture();f.rpc.mockResolvedValue({data:null,error:'checkpoint failed'});
    expect((await f.handler(request())).status).toBe(503);expect(f.upload).not.toHaveBeenCalled();
  });
  it('expired eligibility false response does not send bytes',async()=>{
    const f=fixture();f.rpc.mockResolvedValue({data:false,error:null});
    expect((await f.handler(request())).status).toBe(503);expect(f.upload).not.toHaveBeenCalled();
  });
  it('cutout PNG is routed through the same server operation bindings',async()=>{
    const cutoutPath=`${A}/item-1/cutout.png`;const f=fixture('wardrobe-cutouts',cutoutPath);
    const response=await f.handler(request({'x-upload-bucket':'wardrobe-cutouts','x-upload-path':cutoutPath,'Content-Type':'image/png'}));
    expect(response.status).toBe(200);expect(f.upload).toHaveBeenCalledWith(cutoutPath,expect.any(ArrayBuffer),{contentType:'image/png',upsert:true});
  });
  it('successful write returns SUCCEEDED only after terminal persistence',async()=>{
    const f=fixture();const response=await f.handler(request());expect(response.status).toBe(200);
    expect((await response.json()).state).toBe('SUCCEEDED');expect(f.state()).toBe('SUCCEEDED');
    expect(f.order).toEqual(['admit','durable-unknown','bytes','fence-read','terminal']);
    expect(f.factory).toHaveBeenCalledWith('valid-jwt',expect.any(AbortSignal));
    expect(f.admit).toHaveBeenCalledWith('storage_upload_admit',{p_bucket:'model-photos',p_path:path,p_request:'request-A'});
    expect(f.rpc).toHaveBeenCalledWith('storage_upload_start',expect.objectContaining({p_subject:A,p_operation:operation,p_lease:lease}));
  });
  it('terminal checkpoint rollback keeps UNKNOWN and returns no success',async()=>{
    const f=fixture();const rpc=f.rpc.getMockImplementation()!;f.rpc.mockImplementation(async name=>name==='storage_upload_succeed'?{data:null,error:'checkpoint failed'}:rpc(name));
    const response=await f.handler(request());expect(response.status).toBe(503);expect((await response.json()).state).toBe('UNKNOWN');expect(f.state()).toBe('UNKNOWN');
  });
  it('lost terminal RPC acknowledgement yields client UNKNOWN even if the DB committed success',async()=>{
    const f=fixture();const rpc=f.rpc.getMockImplementation()!;
    f.rpc.mockImplementation(async name=>{const value=await rpc(name);
      return name==='storage_upload_succeed'?{data:null,error:'reply lost after commit'}:value;});
    const response=await f.handler(request());expect(response.status).toBe(503);
    expect((await response.json()).state).toBe('UNKNOWN');expect(f.state()).toBe('SUCCEEDED');
    expect((await f.handler(request())).status).toBe(503);expect(f.upload).toHaveBeenCalledTimes(1);
  });
  it.each(['timeout','disconnect','abort'])('%s after dispatch leaves UNKNOWN without terminal',async error=>{
    const f=fixture();f.upload.mockRejectedValue(new Error(error));const response=await f.handler(request());
    expect(response.status).toBe(503);expect((await response.json()).state).toBe('UNKNOWN');expect(f.state()).toBe('UNKNOWN');expect(f.order).not.toContain('terminal');
  });
  it('Storage error is ambiguous even when a response exists',async()=>{
    const f=fixture();f.upload.mockResolvedValue({data:null,error:'provider 400'} as any);
    const response=await f.handler(request());expect((await response.json()).state).toBe('UNKNOWN');expect(f.state()).toBe('UNKNOWN');
  });
  it('duplicate unresolved operation cannot redispatch',async()=>{
    const f=fixture();f.upload.mockRejectedValue(new Error('disconnect'));
    expect((await f.handler(request())).status).toBe(503);expect((await f.handler(request())).status).toBe(503);
    expect(f.upload).toHaveBeenCalledTimes(1);expect(f.state()).toBe('UNKNOWN');
  });
  it('foreign Storage success response cannot terminalize A operation',async()=>{
    const f=fixture();f.upload.mockResolvedValue({data:{id:operation,path:`${B}/model.jpg`,fullPath:`model-photos/${B}/model.jpg`},error:null});
    expect((await f.handler(request())).status).toBe(503);expect(f.order).not.toContain('terminal');
  });
  it('late verified response under fence compensates and returns the admission BLOCKED code',async()=>{
    const f=fixture();let finish!: (value:any)=>void;let notify!: ()=>void;
    const dispatch=new Promise<void>(resolve=>{notify=resolve;});
    f.upload.mockImplementation(()=>new Promise(resolve=>{f.fence();finish=resolve;notify();}));
    const pending=f.handler(request());
    await dispatch; // Actual controlled dispatch, no timer/polling completion evidence.
    finish({data:{id:operation,path,fullPath:`model-photos/${path}`},error:null});
    const response=await pending;expect(response.status).toBe(503);expect((await response.json()).state).toBe('BLOCKED');
    expect(f.admin.storage.from('model-photos').remove).toHaveBeenCalledWith([path]);
    expect(f.state()).toBe('UNKNOWN');expect(f.order).not.toContain('terminal');
    expect((await f.handler(request())).status).toBe(503);expect(f.upload).toHaveBeenCalledTimes(1);
  });
  it('default operation identity is stable for identical bytes/path after a lost reply',async()=>{
    const f=fixture();const make=()=>{const req=request();req.headers.delete('x-upload-request');return req;};
    f.upload.mockRejectedValue(new Error('disconnect'));
    await f.handler(make());await f.handler(make());
    expect(f.admit.mock.calls[0][1].p_request).toMatch(/^[a-f0-9]{64}$/);
    expect(f.admit.mock.calls[1][1].p_request).toBe(f.admit.mock.calls[0][1].p_request);
    expect(f.upload).toHaveBeenCalledTimes(1);
  });
  it('separate upgrade declares owner-derived admission and service-only completion; barrier is untouched',()=>{
    const sql=readFileSync('reports/backend/proposals/20261011_account_storage_upload_upgrade.sql','utf8');
    expect(sql).toContain('who uuid:=auth.uid()');expect(sql).toContain('perform deletion_private.lock_writer(who)');
    expect(sql).toContain("set state='UNKNOWN',dispatch_started=eligible");
    expect(sql).toContain("where state in ('ADMITTED','UNKNOWN')");
    expect(sql).toContain('unique(subject,request)');expect(sql).toContain('to authenticated;');expect(sql).toContain('to service_role;');
    expect(sql).not.toMatch(/create (?:or replace )?function public\.deletion_(?:storage_barrier|readiness)/);
  });
});
describe('common application client',()=>{
  beforeEach(async()=>{await AsyncStorage.clear();mockClient={auth:{getUser:jest.fn(async()=>({data:{user:{id:A}},error:null}))},functions:{invoke:jest.fn()},storage:{from:jest.fn()}};});
  const input={owner:A,bucket:'model-photos' as const,path,body:new ArrayBuffer(1),contentType:'image/jpeg'};
  it.each(['buffer', 'blob'])('rejects oversized model %s locally without creating UNKNOWN or calling Auth/Edge', async kind => {
    const bytes = new Uint8Array(5 * 1024 * 1024 + 1);
    const body = kind === 'buffer' ? bytes.buffer : new Blob([bytes]);
    await expect(uploadAccountStorage({ ...input, body })).rejects.toMatchObject({ code: 'MODEL_PHOTO_TOO_LARGE',
      message: 'Model fotoğrafı en fazla 5 MiB olabilir. Daha küçük bir fotoğraf seç.' });
    expect(mockClient.auth.getUser).not.toHaveBeenCalled();
    expect(mockClient.functions.invoke).not.toHaveBeenCalled();
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });
  it('allows the exact 5 MiB client boundary', async () => {
    mockClient.functions.invoke.mockResolvedValue({data:{protocol:'vitrify.storage-upload.v1',state:'SUCCEEDED',operation,owner:A,bucket:'model-photos',path},error:null});
    await uploadAccountStorage({ ...input, body: new ArrayBuffer(5 * 1024 * 1024) });
    expect(mockClient.functions.invoke).toHaveBeenCalledTimes(1);
  });
  it('sends bytes only to the server endpoint, then validates matching terminal response',async()=>{
    mockClient.functions.invoke.mockResolvedValue({data:{protocol:'vitrify.storage-upload.v1',state:'SUCCEEDED',operation,owner:A,bucket:'model-photos',path},error:null});
    await uploadAccountStorage(input);expect(mockClient.functions.invoke).toHaveBeenCalledWith('account-storage-upload',expect.objectContaining({body:input.body}));expect(mockClient.storage.from).not.toHaveBeenCalled();
  });
  it.each(['UNKNOWN','BLOCKED'])('%s never becomes client success or automatic retry',async state=>{
    mockClient.functions.invoke.mockResolvedValue({data:{protocol:'vitrify.storage-upload.v1',state},error:null});
    await expect(uploadAccountStorage(input)).rejects.toMatchObject({code:'STORAGE_UPLOAD_UNCONFIRMED'});
    expect(mockClient.functions.invoke).toHaveBeenCalledTimes(1);expect(mockClient.storage.from).not.toHaveBeenCalled();
  });
  it('thrown client network error never triggers fallback or replay',async()=>{
    mockClient.functions.invoke.mockRejectedValue(new Error('disconnect'));
    await expect(uploadAccountStorage(input)).rejects.toMatchObject({code:'STORAGE_UPLOAD_UNCONFIRMED'});
    expect(mockClient.functions.invoke).toHaveBeenCalledTimes(1);expect(mockClient.storage.from).not.toHaveBeenCalled();
  });
  it('lost reply stays durably unresolved across a new call and cannot be discarded',async()=>{
    mockClient.functions.invoke.mockRejectedValue(new Error('reply lost'));
    await expect(uploadAccountStorage(input)).rejects.toMatchObject({code:'STORAGE_UPLOAD_UNCONFIRMED'});
    expect((await accountStorageUploadInventory(A)).unresolved).toHaveLength(1);
    await expect(uploadAccountStorage(input)).rejects.toMatchObject({code:'STORAGE_UPLOAD_UNRESOLVED'});
    await expect(clearCompletedStorageUploadJournal(A)).rejects.toMatchObject({code:'STORAGE_UPLOAD_UNRESOLVED'});
    expect(mockClient.functions.invoke).toHaveBeenCalledTimes(1);
  });
  it('intent read-back failure sends no bytes',async()=>{
    const implementation=jest.mocked(AsyncStorage.getItem).getMockImplementation()!;
    const read=jest.spyOn(AsyncStorage,'getItem');
    read.mockResolvedValueOnce(null).mockResolvedValueOnce('mismatched checkpoint');
    try {
      await expect(uploadAccountStorage(input)).rejects.toMatchObject({code:'STORAGE_JOURNAL_UNVERIFIED'});
      expect(mockClient.functions.invoke).not.toHaveBeenCalled();
    } finally { read.mockRestore();jest.mocked(AsyncStorage.getItem).mockImplementation(implementation); }
  });
  it('concurrent callers cannot queue a replay to the same path',async()=>{
    let finish!: (result:any)=>void, notify!:()=>void;
    const started=new Promise<void>(resolve=>{notify=resolve;});
    mockClient.functions.invoke.mockImplementation(()=>new Promise(resolve=>{finish=resolve;notify();}));
    const first=uploadAccountStorage(input); await started;
    await expect(uploadAccountStorage(input)).rejects.toMatchObject({code:'STORAGE_UPLOAD_IN_FLIGHT'});
    finish({data:{protocol:'vitrify.storage-upload.v1',state:'SUCCEEDED',operation,owner:A,bucket:'model-photos',path},error:null});
    await first;expect(mockClient.functions.invoke).toHaveBeenCalledTimes(1);
    expect((await accountStorageUploadInventory(A)).unresolved).toEqual([]);
  });
  it('successful A journal is removed only by completion and B journal remains owned by B',async()=>{
    mockClient.functions.invoke.mockResolvedValue({data:{protocol:'vitrify.storage-upload.v1',state:'SUCCEEDED',operation,owner:A,bucket:'model-photos',path},error:null});
    await uploadAccountStorage(input);
    mockClient.auth.getUser.mockResolvedValue({data:{user:{id:B}},error:null});
    mockClient.functions.invoke.mockRejectedValue(new Error('B unknown'));
    await expect(uploadAccountStorage({...input,owner:B,path:`${B}/model.jpg`})).rejects.toThrow();
    await clearCompletedStorageUploadJournal(A);
    expect((await accountStorageUploadInventory(A)).keys).toEqual([]);
    expect((await accountStorageUploadInventory(B)).unresolved).toHaveLength(1);
  });
});
