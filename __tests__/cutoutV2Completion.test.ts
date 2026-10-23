import { readFileSync } from 'node:fs';
import { accountStorageUploadHandler, type UploadServerClient } from '../supabase/functions/_shared/accountStorageUploadHandler';
import { validCutoutPng } from '../supabase/functions/_shared/cutoutV2Png';

const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', item='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const job='cccccccc-cccc-4ccc-8ccc-cccccccccccc', operation='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const path=`${owner}/${item}/cutout-${job}.png`;
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DQAAAEgQGALFXOsAAAAABJRU5ErkJggg==','base64')).buffer;
const input=(body=png)=>new Request('https://unit.invalid/account-storage-upload',{method:'POST',headers:{'x-cutout-protocol':'vitrify.cutout.v2','x-cutout-job':job,'x-cutout-capability':'a'.repeat(64),'Content-Type':'image/png'},body});
function fixture(enabled=true) {
  let admitted=false, started=false, succeeded=false, fenced=false;
  const calls: string[]=[];
  const upload=jest.fn(async (_path: string, bytes: ArrayBuffer)=>{calls.push('write');expect(new Uint8Array(bytes)).toEqual(new Uint8Array(png));return {data:{id:operation,path,fullPath:`wardrobe-cutouts/${path}`},error:null};});
  const remove=jest.fn(async()=>({data:[],error:null}));
  const rpc=jest.fn(async(name:string,args:Record<string,unknown>):Promise<{data:unknown;error:unknown}>=>{
    const action=(args.p_value as Record<string,unknown>)?.job;
    if(name==='deletion_is_fenced')return{data:fenced,error:null};
    if(name==='storage_upload_start'){calls.push('unknown-checkpoint');if(started||fenced)return{data:false,error:null};started=true;return{data:true,error:null};}
    if(name==='storage_upload_succeed'){succeeded=true;calls.push('storage-proof');return{data:true,error:null};}
    expect(action).toBe(job);
    if(args.p_action==='source')return{data:fenced?null:{bucket:'wardrobe-cutouts'},error:null};
    if(args.p_action==='admit'){if(admitted||fenced)return{data:null,error:'denied'};admitted=true;return{data:{owner,bucket:'wardrobe-cutouts',path,operation,lease:item},error:null};}
    if(args.p_action==='finalize'){calls.push('publish');return{data:succeeded&&!fenced?{state:'SUCCEEDED',resultId:job}:null,error:null};}
    throw new Error('unexpected RPC');
  });
  const auth=jest.fn(async()=>({data:{user:null},error:null}));
  const admin: UploadServerClient={auth:{getUser:auth},rpc,storage:{from:()=>({upload,remove})}};
  return{handle:accountStorageUploadHandler(admin,()=>{throw new Error('V1 auth must not be impersonated');},undefined,enabled),upload,remove,rpc,auth,calls,fence:()=>{fenced=true;}};
}
test('OFF rejects completion before reading credentials or RPC',async()=>{
  const f=fixture(false);expect((await f.handle(input())).status).toBe(503);expect(f.rpc).not.toHaveBeenCalled();expect(f.upload).not.toHaveBeenCalled();
});
test('existing sole writer checkpoints UNKNOWN, writes immutable PNG once and publishes after proof',async()=>{
  const f=fixture();expect((await f.handle(input())).status).toBe(200);
  expect(f.calls).toEqual(['unknown-checkpoint','write','storage-proof','publish']);
  expect(f.upload).toHaveBeenCalledWith(path,png,{contentType:'image/png',upsert:false});
  expect((await f.handle(input())).status).toBe(503);expect(f.upload).toHaveBeenCalledTimes(1);expect(f.auth).not.toHaveBeenCalled();
});
test('PNG corruption is rejected before admission and Storage',async()=>{
  const corrupt=png.slice(0);new Uint8Array(corrupt)[45]^=1;
  expect(validCutoutPng(png)).toBe(true);expect(validCutoutPng(corrupt)).toBe(false);
  const f=fixture();expect((await f.handle(input(corrupt))).status).toBe(422);expect(f.upload).not.toHaveBeenCalled();
});
test('ambiguous upload is not published or resent',async()=>{
  const f=fixture();f.upload.mockRejectedValueOnce(new Error('timeout'));
  expect((await f.handle(input())).status).toBe(503);expect(f.calls).not.toContain('publish');
  await f.handle(input());expect(f.upload).toHaveBeenCalledTimes(1);
});
test('fence after physical write compensates and never publishes',async()=>{
  const f=fixture();f.upload.mockImplementationOnce(async()=>{f.fence();return{data:{id:operation,path,fullPath:`wardrobe-cutouts/${path}`},error:null};});
  expect((await f.handle(input())).status).toBe(503);expect(f.remove).toHaveBeenCalledTimes(1);expect(f.calls).not.toContain('publish');
});
test('migration uses existing A1 barrier operations, denied DML, OFF and stable canonical aliases',()=>{
  const sql=readFileSync('supabase/migrations/202610210001_cutout_v2.sql','utf8');
  expect(sql).toContain('enabled boolean not null default false');
  expect(sql).toContain('unique (owner_id, wardrobe_item_id, original_version)');
  expect(sql).toContain('primary key (owner_id, request_id)');
  expect(sql).toContain('insert into deletion_private.storage_operations');
  expect(sql).toContain('cutout_v2_private.original_version');
  expect(sql).toContain("p_owner::text||'/'||p_item::text||'/original-");
  expect(sql).toContain('CUTOUT_V2_A1_DEPENDENCY');
  expect(sql).toContain('create trigger cutout_v2_owner_fenced');
  expect(sql).toContain('create trigger cutout_v2_storage_changed');
  expect(sql).toContain('revoke all on function public.cutout_v2_command(text,jsonb) from public,anon,authenticated,service_role');
  expect(sql).not.toMatch(/create policy .*for (insert|update|delete)|storage[.]objects/i);
});
