import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDeletionReceipt, type DeletionReceipt } from '../supabase/functions/_shared/accountDeletionFoundation';

let mockAdmin: any;
jest.mock('jsr:@supabase/supabase-js@2',()=>({createClient:()=>mockAdmin}),{virtual:true});
const capability='a'.repeat(64);
test('Kabin install proposal preserves existing job RPCs and Auth cascade; includes original path ownership', () => {
  const sql = readFileSync('reports/backend/proposals/20261014_a1_kabin_install.sql','utf8');
  expect(sql).not.toMatch(/create (?:or replace )?function public\.(claim_discover|publish_discover|finish_discover)/i);
  expect(sql).toContain('before insert or update'); expect(sql).not.toMatch(/before delete on/i);
  expect(sql).toContain('style_preference_actions'); expect(sql).toContain('wardrobe_items');
  expect(sql).toContain('lease_held_by_other'); expect(sql).toContain('drain_remaining_ms');
  expect(sql).toContain('original-'); expect(sql).toContain('auth.uid()');
  expect(sql).toContain('-- ROLLBACK');
});
function fixture() {
  let handler!: (request:Request)=>Promise<Response>;
  let held=false, fenced=false, authExists=true, fault='', infrastructure=true;
  let durable:DeletionReceipt|undefined;
  const remaining=new Set(['jobs_payload','db','recommendation_cache']);
  const calls:string[]=[];
  const files=new Map([['model-photos',new Set(['A/model.jpg'])],['wardrobe-cutouts',new Set(['A/nested/cutout.png'])]]);
  let removeStarted!:()=>void, finishRemove!:()=>void;
  const started=new Promise<void>(resolve=>{removeStarted=resolve;});
  const paused=new Promise<void>(resolve=>{finishRemove=resolve;});
  let pause=false, drain=0, purgeFault=false, removeFault=false, authFault='', checkpointFault='';
  const operations=new Set(['storage_resolutions','storage_operations','provider_operations']);
  const rpc=jest.fn(async(name:string,args:any={})=>{
    calls.push(name+(args.p_layer?':'+args.p_layer:''));
    if(name==='deletion_readiness')return {data:{protocol:'vitrify.deletion.v1',ready:infrastructure,
      writerCoverage:false,postAuthRecovery:infrastructure,blockers:infrastructure?[]:['fence_unavailable']},error:null};
    if(name==='deletion_storage_barrier')return {data:false,error:null};
    if(name==='deletion_storage_barrier_snapshot')return {data:{provider:null,unresolved:1},error:null};
    if(name==='deletion_begin'){
      if(held)return {data:null,error:{code:'55P03',message:'lease_held_by_other'}};
      held=true;fenced=true;durable??=createDeletionReceipt(args.p_request,'A');
      return {data:{receipt:JSON.parse(JSON.stringify(durable)),lease:'lease-A',drain_remaining_ms:drain},error:null};
    }
    if(name==='deletion_purge_operations'){if(purgeFault)return {data:null,error:{message:'purge'}};operations.clear();return {data:{storage_resolutions:1,storage_operations:1,provider_operations:1},error:null};}
    if(name==='deletion_release'){held=false;return {data:null,error:null};}
    if(name==='deletion_assert_lease')return {data:'A',error:held?null:{message:'Lease lost'}};
    if(name==='deletion_save'){
      if(checkpointFault && Object.entries(args.p_receipt.layers).some(([layer,value]:[string,any])=>layer+':'+value.state===checkpointFault)){checkpointFault='';throw new Error('Injected checkpoint transport loss');}
      durable=JSON.parse(JSON.stringify(args.p_receipt));return {data:null,error:null};
    }
    if(name==='deletion_verify'){
      return {data:args.p_layer==='write_fence'?fenced:args.p_layer==='auth'?!authExists:!remaining.has(args.p_layer),error:null};
    }
    if(name==='deletion_clean'){
      if(fault===args.p_layer)return {data:null,error:{message:'Injected pre-auth failure'}};
      remaining.delete(args.p_layer);return {data:null,error:null};
    }
    throw new Error('Unexpected RPC');
  });
  const deleteUser=jest.fn(async()=>{calls.push('auth-delete');if(authFault){const message=authFault;authFault='';if(message==='User owns Storage objects')files.get('model-photos')!.add('A/late.jpg');return {error:{message}};}authExists=false;return {error:null};});
  const remove=jest.fn(async(bucket:string,paths:string[])=>{
    calls.push('remove:'+bucket);if(removeFault)return {error:{message:'Injected remove failure'}};
    if(pause){removeStarted();await paused;pause=false;}
    paths.forEach(path=>files.get(bucket)!.delete(path));return {error:null};
  });
  mockAdmin={rpc,auth:{getUser:async()=>({data:{user:authExists?{id:'A'}:null},error:null}),admin:{deleteUser}},
    storage:{from:(bucket:string)=>({list:async(prefix:string,options:{offset:number})=>{
      const entries=new Map<string,{name:string;id:string|null}>();
      for(const path of files.get(bucket)!)if(path.startsWith(prefix+'/')){
        const suffix=path.slice(prefix.length+1),name=suffix.split('/')[0];
        entries.set(name,{name,id:suffix.includes('/')?null:'object-'+name});
      }
      return {data:[...entries.values()].slice(options.offset,options.offset+100),error:null};
    },remove:(paths:string[])=>remove(bucket,paths)})}};
  (globalThis as any).Deno={env:{get:(name:string)=>name==='SUPABASE_URL'?'https://fake.invalid':'fake-key'},serve:(value:typeof handler)=>{handler=value;}};
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:require('node:crypto').webcrypto});
  jest.isolateModules(()=>{require('../supabase/functions/delete-account/index');});
  const initial=()=>{
    const device=createDeletionReceipt('request-A','A');
    for(const name of ['queue','async_storage','local_files','memory_cache'] as const)device.layers[name]={state:'VERIFIED',attempts:1,evidence:['fake device proof']};
    return handler(new Request('https://fake.invalid',{method:'POST',headers:{Authorization:'Bearer fake'},
      body:JSON.stringify({requestId:'request-A',recoveryToken:capability,deviceCheckpoint:device})}));
  };
  const recover=()=>handler(new Request('https://fake.invalid',{method:'POST',headers:{'x-deletion-recovery':capability},body:JSON.stringify({requestId:'request-A'})}));
  return {rpc,deleteUser,remove,calls,initial,recover,handler,started,finishRemove,
    setCheckpointFault:(value:string)=>{checkpointFault=value;},setRemoveFault:(value:boolean)=>{removeFault=value;},setAuthFault:(value:string)=>{authFault=value;},setDrain:(ms:number)=>{drain=ms;},setPurgeFault:(value:boolean)=>{purgeFault=value;},operations:()=>operations.size,pauseRemove:()=>{pause=true;},fault:(name:string)=>{fault=name;},fenced:()=>fenced,authExists:()=>authExists,
    durable:()=>durable,unavailable:()=>{infrastructure=false;}};
}
afterEach(()=>{delete (globalThis as any).Deno;});

it('step 4: actual Edge binding ignores unverified writerCoverage and never calls either Storage barrier RPC',async()=>{
  const f=fixture(),response=await f.initial();
  expect(response.status).toBe(200);expect((await response.json()).complete).toBe(true);
  expect(f.rpc.mock.calls.map(([name])=>name)).not.toContain('deletion_storage_barrier');
  expect(f.rpc.mock.calls.map(([name])=>name)).not.toContain('deletion_storage_barrier_snapshot');
  expect(f.deleteUser).toHaveBeenCalledTimes(1);
  expect(f.calls.indexOf('deletion_clean:db')).toBeLessThan(f.calls.indexOf('auth-delete'));
  expect(f.calls.indexOf('remove:model-photos')).toBeLessThan(f.calls.indexOf('auth-delete'));
});
it('step 4/T3: durable layer failure keeps fence and Auth; recovery completes without repeating sweep',async()=>{
  const f=fixture();f.fault('jobs_payload');
  const first=await f.initial();expect((await first.json()).complete).toBe(false);
  expect(f.durable()!.layers.jobs_payload).toMatchObject({state:'RETRY_REQUIRED',errorCode:'CLEANUP_OR_VERIFICATION_FAILED'});
  expect(f.durable()!.layers.auth.state).toBe('BLOCKED');expect(f.authExists()).toBe(true);
  expect(f.deleteUser).not.toHaveBeenCalled();expect(f.fenced()).toBe(true);
  const sweepCalls=f.remove.mock.calls.length;
  f.fault('');expect((await (await f.recover()).json()).complete).toBe(true);
  expect(f.remove).toHaveBeenCalledTimes(sweepCalls);expect(f.deleteUser).toHaveBeenCalledTimes(1);expect(f.fenced()).toBe(true);
});
it('step 4/T9: identical recovery POST twice returns the same completed receipt and one Auth deletion',async()=>{
  const f=fixture();expect((await (await f.initial()).json()).complete).toBe(true);
  const first=await (await f.recover()).json(),second=await (await f.recover()).json();
  expect(second).toEqual(first);expect(f.deleteUser).toHaveBeenCalledTimes(1);
});
it('step 4/T9: concurrent initial requests have one lease holder and one completion',async()=>{
  const f=fixture();f.pauseRemove();
  const first=f.initial();await f.started;
  const duplicate=await f.initial();expect(duplicate.status).toBe(503);
  expect(await duplicate.json()).toMatchObject({detail:'lease_held_by_other'});
  f.finishRemove();expect((await (await first).json()).complete).toBe(true);
  const replay=await f.recover();expect((await replay.json()).receipt).toEqual(f.durable());
  expect(f.deleteUser).toHaveBeenCalledTimes(1);
});
it('step 4: unavailable real infrastructure still refuses without acquiring a lease',async()=>{
  const f=fixture();f.unavailable();const response=await f.initial();
  expect(response.status).toBe(503);expect(await response.json()).toMatchObject({detail:'fence_unavailable'});
  expect(f.rpc.mock.calls.map(([name])=>name)).not.toContain('deletion_begin');expect(f.deleteUser).not.toHaveBeenCalled();
});
it('step 4: no active server deletion binding imports accountStorageBarrier',()=>{
  const source=readFileSync(resolve(__dirname,'../supabase/functions/delete-account/index.ts'),'utf8');
  expect(source).not.toContain('accountStorageBarrier');expect(source).not.toContain('assessStorageBarrier');
});

it('FAZ 4b drain uses internal DB duration; no sweep and device proof survives recovery',async()=>{
 const f=fixture();f.setDrain(90000);const response=await f.initial();expect(response.status).toBe(503);expect(f.remove).not.toHaveBeenCalled();expect(f.deleteUser).not.toHaveBeenCalled();expect(f.durable()!.layers.queue.state).toBe('VERIFIED');
 f.setDrain(0);expect((await (await f.recover()).json()).complete).toBe(true);
});
it('FAZ 4b purge failure keeps Auth and retry clears operations then finishes',async()=>{
 const f=fixture();f.setPurgeFault(true);expect((await (await f.initial()).json()).complete).toBe(false);expect(f.deleteUser).not.toHaveBeenCalled();expect(f.operations()).toBe(3);
 f.setPurgeFault(false);expect((await (await f.recover()).json()).complete).toBe(true);expect(f.operations()).toBe(0);expect(f.calls.lastIndexOf('deletion_purge_operations')).toBeLessThan(f.calls.indexOf('auth-delete'));
});

it.each(['write_fence','storage','jobs_payload','db','recommendation_cache','auth'])('FAZ 4b T3: crash before %s cleanup resumes from durable RUNNING',async layer=>{
 const f=fixture();f.setCheckpointFault(layer+':RUNNING');expect((await f.initial()).status).toBe(503);expect(f.deleteUser).not.toHaveBeenCalled();
 expect((await (await f.recover()).json()).complete).toBe(true);expect(f.deleteUser).toHaveBeenCalledTimes(1);
});
it.each(['write_fence','storage','jobs_payload','db','recommendation_cache','auth'])('FAZ 4b T3: lost %s verification checkpoint recovers idempotently',async layer=>{
 const f=fixture();f.setCheckpointFault(layer+':VERIFIED');expect((await f.initial()).status).toBe(503);
 expect((await (await f.recover()).json()).complete).toBe(true);expect(f.deleteUser).toHaveBeenCalledTimes(1);
});
it('FAZ 4b T3: actual Edge remove failure blocks Auth then recovers',async()=>{
 const f=fixture();f.setRemoveFault(true);expect((await (await f.initial()).json()).complete).toBe(false);expect(f.deleteUser).not.toHaveBeenCalled();
 f.setRemoveFault(false);expect((await (await f.recover()).json()).complete).toBe(true);
});
it('FAZ 4b T3: actual Edge ownership error sweeps the late object then completes',async()=>{
 const f=fixture();f.setAuthFault('User owns Storage objects');expect((await (await f.initial()).json()).complete).toBe(true);expect(f.deleteUser).toHaveBeenCalledTimes(2);
});
it('FAZ 4b T3: other Auth error stays retry-required until recovery',async()=>{
 const f=fixture();f.setAuthFault('Provider unavailable');expect((await (await f.initial()).json()).complete).toBe(false);expect(f.authExists()).toBe(true);expect(f.durable()!.layers.auth.state).toBe('RETRY_REQUIRED');
 expect((await (await f.recover()).json()).complete).toBe(true);
});
it('FAZ 4b T1: actual binding begins, sweeps, purges before Auth and saves completion',async()=>{
 const f=fixture();expect((await (await f.initial()).json()).complete).toBe(true);
 expect(f.calls.indexOf('deletion_begin')).toBeLessThan(f.calls.indexOf('remove:model-photos'));
 expect(f.calls.indexOf('remove:wardrobe-cutouts')).toBeLessThan(f.calls.indexOf('deletion_purge_operations'));
 expect(f.calls.indexOf('deletion_purge_operations')).toBeLessThan(f.calls.indexOf('auth-delete'));
 expect(f.calls.lastIndexOf('deletion_save')).toBeGreaterThan(f.calls.indexOf('auth-delete'));
 expect(f.durable()!.layers.vendor.evidence).toContain('UNKNOWN yüklemeler sweep ile silinir');expect(f.durable()!.layers.backup.evidence.join(' ')).toContain('doğrulanmadı');
});
