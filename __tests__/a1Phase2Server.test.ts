import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDeletionReceipt, type DeletionReceipt } from '../supabase/functions/_shared/accountDeletionFoundation';

let mockAdmin: any;
jest.mock('jsr:@supabase/supabase-js@2',()=>({createClient:()=>mockAdmin}),{virtual:true});
const capability='a'.repeat(64);
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
  let pause=false;
  const rpc=jest.fn(async(name:string,args:any={})=>{
    calls.push(name+(args.p_layer?':'+args.p_layer:''));
    if(name==='deletion_readiness')return {data:{protocol:'vitrify.deletion.v1',ready:infrastructure,
      writerCoverage:false,postAuthRecovery:infrastructure,blockers:infrastructure?[]:['fence_unavailable']},error:null};
    if(name==='deletion_storage_barrier')return {data:false,error:null};
    if(name==='deletion_storage_barrier_snapshot')return {data:{provider:null,unresolved:1},error:null};
    if(name==='deletion_begin'){
      if(held)return {data:null,error:{code:'55P03',message:'lease_held_by_other'}};
      held=true;fenced=true;durable??=createDeletionReceipt(args.p_request,'A');
      return {data:{receipt:JSON.parse(JSON.stringify(durable)),lease:'lease-A',drain_remaining_ms:0},error:null};
    }
    if(name==='deletion_purge_operations')return {data:{storage_resolutions:0,storage_operations:0,provider_operations:0},error:null};
    if(name==='deletion_release'){held=false;return {data:null,error:null};}
    if(name==='deletion_assert_lease')return {data:'A',error:held?null:{message:'Lease lost'}};
    if(name==='deletion_save'){
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
  const deleteUser=jest.fn(async()=>{calls.push('auth-delete');authExists=false;return {error:null};});
  const remove=jest.fn(async(bucket:string,paths:string[])=>{
    calls.push('remove:'+bucket);
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
    pauseRemove:()=>{pause=true;},fault:(name:string)=>{fault=name;},fenced:()=>fenced,authExists:()=>authExists,
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
