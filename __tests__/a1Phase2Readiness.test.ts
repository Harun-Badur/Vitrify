import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDeletionReceipt, deletionHandler, type DeletionPort } from '../supabase/functions/_shared/accountDeletionCoordinator';

const sql = () => readFileSync(resolve(__dirname,'../reports/backend/proposals/20261011_a1_phase2_deletion_gates.sql'),'utf8');
const beforeRollback = () => sql().split('-- ROLLBACK SQL')[0];
const get = () => new Request('https://fake.invalid',{headers:{Authorization:'Bearer fake'}});
function port(fence: boolean, leases: boolean): DeletionPort {
  return {
    readiness: async () => ({ ready:fence&&leases, blockers:!fence?['fence_unavailable']:!leases?['lease_unavailable']:[] }) as never,
    authenticate: async () => 'A', begin: jest.fn(async () => { throw new Error('Unused'); }),
    save:async()=>{},release:async()=>{},adapters:()=>({}),
  };
}

it('step 3: real fence/lease readiness result speaks unchanged v1 ready boolean', async () => {
  const result=await deletionHandler(port(true,true))(get());
  expect(await result.json()).toMatchObject({protocol:'vitrify.deletion.v1',ready:true,postAuthRecovery:true,blockers:[]});
});
it.each([[false,true,'fence_unavailable'],[true,false,'lease_unavailable']] as const)(
  'step 3: unavailable infrastructure reports reason without beginning deletion (%s/%s)',async(fence,leases,reason)=>{
    const p=port(fence,leases), result=await deletionHandler(p)(get());
    expect(await result.json()).toMatchObject({ready:false,postAuthRecovery:false,blockers:[reason]});
    expect(p.begin).not.toHaveBeenCalled();
  });
it('step 3: an owner lease held by another request is refused by begin with a safe reason',async()=>{
  const p=port(true,true);
  p.begin=jest.fn(async()=>{throw Object.assign(new Error('never expose raw database detail'),{code:'lease_held_by_other'});});
  const device=createDeletionReceipt('request-A','A');
  for(const name of ['queue','async_storage','local_files','memory_cache'] as const) device.layers[name]={state:'VERIFIED',attempts:1,evidence:['fake device proof']};
  const result=await deletionHandler(p)(new Request('https://fake.invalid',{method:'POST',headers:{Authorization:'Bearer fake'},
    body:JSON.stringify({requestId:'request-A',recoveryToken:'a'.repeat(64),deviceCheckpoint:device})}));
  expect(result.status).toBe(503);
  expect(await result.json()).toMatchObject({protocol:'vitrify.deletion.v1',detail:'lease_held_by_other'});
});
it('step 3: SQL replaces readiness and caller gates without changing the barrier stub or adding tables',()=>{
  const body=beforeRollback();
  expect(body).toContain('create or replace function public.deletion_readiness()');
  expect(body).toContain("'writerCoverage',false");
  expect(body).toContain("'ready',fence_available and lease_available");
  expect(body).toContain("message='lease_held_by_other'");
  expect(body).toContain("interval '120 seconds'");
  expect(body).not.toMatch(/create table|drop function|create or replace function public.deletion_storage_barrier\(/i);
  expect(body).not.toMatch(/public\.deletion_storage_barrier\(p_request,p_lease\)/);
  expect(body).not.toContain('Coverage not attested');
  expect(sql()).toContain('-- ROLLBACK SQL');
});
it('step 5: migration 19 admission/start use the existing owner_gates row-lock fence checkpoint',()=>{
  const directory=resolve(__dirname,'../reports/backend/isolated-a1-migration20/supabase/migrations');
  const admission=readFileSync(resolve(directory,'20261011000019_vitrify_a1_19.sql'),'utf8');
  const gate=readFileSync(resolve(directory,'20261011000018_vitrify_a1_18.sql'),'utf8');
  expect(admission).toContain('perform deletion_private.lock_writer(who);');
  expect(admission).toContain('perform deletion_private.lock_writer(p_subject);');
  expect(gate).toContain('select fenced into stopped from deletion_private.owner_gates where subject=p_subject for update;');
  expect(gate).toContain("if stopped is distinct from false then raise exception 'Account deletion fenced or owner unavailable'");
  expect(beforeRollback()).not.toContain('create or replace function deletion_private.lock_writer');
});
