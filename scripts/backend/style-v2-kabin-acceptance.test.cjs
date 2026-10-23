'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {config,cleanupSql,runCases,TARGET}=require('./style-v2-kabin-acceptance.cjs');
const jwt=claims=>['header',Buffer.from(JSON.stringify(claims)).toString('base64url'),'synthetic'].join('.');
test('activation proposal separates global writer from atomic ACL/profile cutover and never backfills',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const read=n=>fs.readFileSync(path.join(__dirname,'../../reports/backend/proposals/20261013_style_v2_activate_'+n+'.sql'),'utf8');
 const writer=read('writer'),profile=read('profile'),pause=read('pause');
 for(const s of [writer,profile,pause]){assert.match(s,/begin;/);assert.match(s,/commit;/);assert.doesNotMatch(s,/delete from public\.(user_events|liked_products|passed_products|style_preference_actions|user_style_profiles)|(?:perform|select)\s+public\.recompute_profile\(/i);}
 assert.match(writer,/EXPECTED_MISSING_GATES/);assert.match(writer,/GLOBAL/);
 assert.match(profile,/exclude_with_approval/);assert.match(profile,/clock_timestamp\(\)/);
 assert.match(profile,/revoke insert,update,delete/);assert.match(profile,/has_column_privilege/);
 assert.match(profile,/lock table public.liked_products,public.passed_products/);
 assert.match(pause,/WRITER_GATE_MISMATCH/);assert.match(pause,/'enabled',false/);
});
const env=()=>({KABIN_V2_URL:TARGET,KABIN_V2_PUBLIC_KEY:jwt({role:'anon',ref:'hnujkabyyrlsxohjhxlg'}),
 KABIN_V2_A_JWT:jwt({role:'authenticated',iss:TARGET+'/auth/v1'}),KABIN_V2_B_JWT:jwt({role:'authenticated',iss:TARGET+'/auth/v1'}),KABIN_V2_DISPOSABLE:'yes'});
test('target and public/authenticated token guards reject staging/admin keys',()=>{
 assert.throws(()=>config({...env(),KABIN_V2_URL:'https://sdjxseqfkturkfohkfni.supabase.co'}),/TARGET/);
 assert.throws(()=>config({...env(),KABIN_V2_PUBLIC_KEY:jwt({role:'service_role'})}),/PUBLIC_KEY/);
 assert.throws(()=>config({...env(),KABIN_V2_A_JWT:jwt({role:'authenticated',iss:'wrong'})}),/JWT/);
});
test('writes and privileged scoped profile require separate explicit flags',()=>{
 assert.equal(config(env()).writes,false);
 assert.throws(()=>config({...env(),KABIN_V2_ALLOW_WRITES:'yes'}),/PROFILE_APPROVAL/);
});
test('default read-only runner never invokes RPC or cleanup',async()=>{
 let mutations=0;const backend={preflight:async()=>({writer:false}),rpc:async()=>{mutations++;},cleanup:async()=>{mutations++;}};
 const result=await runCases(backend,false,()=>{});assert.equal(result.status,'PREFLIGHT_READY');assert.equal(mutations,0);
});
test('writer OFF or incomplete cleanup preflight blocks before any write',async()=>{
 let writes=0;await assert.rejects(()=>runCases({preflight:async()=>({writer:false}),rpc:async()=>{writes++;}},true,()=>{}),/WRITER_OFF/);
 assert.equal(writes,0);
});
test('cleanup is guarded by exact manifest and refuses unknown account activity',()=>{
 const manifest={owners:['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'],
 products:['fixture'],actions:['10000000-0000-4000-8000-000000000001'],legacyEvents:['20000000-0000-4000-8000-000000000001']};
 const sql=cleanupSql(manifest);assert.match(sql,/UNEXPECTED_TEST_ACTIVITY/);assert.match(sql,/action_id=any/);
 assert.match(sql,/user_id=any/);assert.match(sql,/WRITER_MUST_BE_OFF/);assert.doesNotMatch(sql,/auth\.users|storage\.|(?:delete from|update|insert into) public\.recs_config/);
 assert.throws(()=>cleanupSql({...manifest,owners:['bad']}),/MANIFEST/);
});

function fake(){
 const data=new Map();const ledger=[];let paused=false,cleaned=false;
 const io={owners:['A','B'],id:n=>n,preflight:async()=>({writer:true}),
 rpc:async(name,op,index=0,expected=null,who=0,row)=>{
  if(who===1)return {error:{code:'40001'}};
  if(ledger.some(x=>x.action_id===name))return {data:{action_id:name,replayed:true}};
  const current=data.get(index)||{};
  if(!row&&['unlike','undo_pass'].includes(op)&&expected?.[0]!==current.target)return {error:{code:'40001'}};
  if(op==='favorite')data.set(index,{like:true,target:name});else if(op==='pass')data.set(index,{pass:true,target:name});else data.delete(index);
  ledger.push({action_id:name,request:{operation:op}});return {data:{action_id:name,replayed:false}};
 },read:async(table,index=0,who=0)=>who===1?[]:table==='style_preference_actions'?ledger:table==='liked_products'?(data.get(index)?.like?[{}]:[]):table==='passed_products'?(data.get(index)?.pass?[{}]:[]):[],
 foreignDelete:async()=>({data:[]}),foreignInsert:async()=>({error:{code:'42501'}}),foreignUpdate:async()=>({data:[]}),legacySeed:async()=>{data.set(1,{like:true});data.set(2,{pass:true});},
 scopedProfile:async()=>{},pauseForCleanup:async()=>{paused=true;},cleanup:async()=>{assert.equal(paused,true);cleaned=true;}};
 return {io,cleaned:()=>cleaned};
}
test('full acceptance choreography reaches guarded cleanup and reports fixed codes',async()=>{
 const f=fake(),logs=[];const r=await runCases(f.io,true,x=>logs.push(x));assert.equal(r.status,'ACCEPTANCE_PASS');assert.equal(f.cleaned(),true);
 assert.equal(logs.length,7);assert(logs.every(x=>/^PASS [A-Z_]+$/.test(x)));
});
test('ambiguous failure stops without automatic replay or cleanup',async()=>{
 const f=fake();let calls=0;f.io.rpc=async()=>{calls++;throw Error('synthetic-private-detail');};
 await assert.rejects(()=>runCases(f.io,true,()=>{}));assert.equal(calls,1);assert.equal(f.cleaned(),false);
});
