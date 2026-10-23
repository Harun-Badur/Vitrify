'use strict';
// PREPARATION ONLY. No account creation, automatic activation, schema change or service-role key.
const {createHash}=require('node:crypto');const {execFile}=require('node:child_process');
const {createInterface}=require('node:readline/promises');
const TARGET='https://hnujkabyyrlsxohjhxlg.supabase.co',REF='hnujkabyyrlsxohjhxlg';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=code=>{throw Error(code);};const check=(v,code='ASSERTION_FAILED')=>{if(!v)fail(code);};
const payload=s=>{try{return JSON.parse(Buffer.from(s.split('.')[1],'base64url'));}catch{fail('JWT_INVALID');}};
function config(e){
 check(e.KABIN_V2_URL===TARGET,'TARGET_MISMATCH');check(e.KABIN_V2_DISPOSABLE==='yes','DISPOSABLE_REQUIRED');
 check(typeof e.KABIN_V2_PUBLIC_KEY==='string','PUBLIC_KEY_REQUIRED');
 if(!e.KABIN_V2_PUBLIC_KEY.startsWith('sb_publishable_')){const p=payload(e.KABIN_V2_PUBLIC_KEY);check(p.role==='anon'&&p.ref===REF,'PUBLIC_KEY_REQUIRED');}
 for(const name of ['KABIN_V2_A_JWT','KABIN_V2_B_JWT']){const p=payload(e[name]||'');check(p.role==='authenticated'&&p.iss===TARGET+'/auth/v1','JWT_TARGET_INVALID');}
 const writes=e.KABIN_V2_ALLOW_WRITES==='yes';
 if(writes){check(e.KABIN_V2_ALLOW_SCOPED_PROFILE==='yes','PROFILE_APPROVAL_REQUIRED');check(e.KABIN_V2_ALLOW_CLEANUP==='yes','CLEANUP_APPROVAL_REQUIRED');check(uuid.test(e.KABIN_V2_RUN_ID||''),'RUN_ID_REQUIRED');}
 return {e,writes};
}
const names=['like','unlike','pass','undo','like-new','undo-old','unlike-new','lost-response','remove-legacy-like','remove-legacy-pass','foreign-undo'];
function id(run,name){const h=createHash('sha256').update(run+':'+name).digest('hex').slice(0,32);return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);}
function makeManifest(owners,run){check(uuid.test(run||''),'RUN_ID_REQUIRED');return {owners,actions:names.map(n=>id(run,n)),legacyEvents:[id(run,'legacy-event')],legacyRows:[id(run,'legacy-like-row'),id(run,'legacy-pass-row')]};}
function cleanupSql(m){
 check(Array.isArray(m.owners)&&m.owners.length===2&&m.owners.every(x=>uuid.test(x))&&m.owners[0]!==m.owners[1],'MANIFEST_INVALID');
 check(m.actions.length>0&&m.actions.length<=32&&m.actions.every(x=>uuid.test(x))&&m.legacyEvents.every(x=>uuid.test(x)),'MANIFEST_INVALID');
 check((m.legacyRows||[]).every(x=>uuid.test(x)),'MANIFEST_INVALID');
 const arr=a=>"array["+a.map(x=>"'"+x+"'::uuid").join(',')+"]::uuid[]";
 const owners=arr(m.owners),actions=arr(m.actions),events=arr(m.legacyEvents),legacy=arr(m.legacyRows||[]);
 // Cleanup never touches Auth/config/Storage. Accounts must have an empty initial baseline.
 return `begin; do $$ begin
 if current_user<>'postgres' then raise exception 'TRUSTED_POSTGRES_REQUIRED';end if;
 if not exists(select 1 from pg_proc where oid='public.style_profile_events_v2(uuid,text)'::regprocedure and md5(regexp_replace(prosrc,'[[:space:]]+',' ','g'))='f2acd7054134d99a2d7e211cfe794604') then raise exception 'DB_METADATA_MISMATCH';end if;
 if exists(select 1 from public.recs_config where key='style_preference_writer_v2' and value->'enabled'='true'::jsonb) then raise exception 'WRITER_MUST_BE_OFF';end if;
 if exists(select 1 from public.style_preference_actions where user_id=any(${owners}) and not(action_id=any(${actions})))
 or exists(select 1 from public.user_events e where e.user_id=any(${owners}) and not(e.event_id=any(${events}))
  and not exists(select 1 from public.style_preference_actions a where a.user_id=e.user_id and a.action_id=any(${actions}) and e.event_id=any(a.event_ids)))
 then raise exception 'UNEXPECTED_TEST_ACTIVITY';end if;
 if exists(select 1 from public.liked_products r where r.user_id=any(${owners}) and not(r.id=any(${legacy})) and not exists(select 1 from public.style_preference_actions a where a.user_id=r.user_id and a.action_id=any(${actions}) and a.product_id=r.product_id))
 or exists(select 1 from public.passed_products r where r.user_id=any(${owners}) and not(r.id=any(${legacy})) and not exists(select 1 from public.style_preference_actions a where a.user_id=r.user_id and a.action_id=any(${actions}) and a.product_id=r.product_id))
 then raise exception 'UNRESOLVED_RELATION_STOP';end if;
 if exists(select 1 from public.user_style_profiles p where p.user_id=any(${owners}) and not exists(select 1 from public.style_preference_actions a where a.user_id=p.user_id and a.action_id=any(${actions}) and a.committed_at<=p.computed_at)) then raise exception 'PROFILE_PROVENANCE_STOP';end if;
 end $$;
 delete from public.liked_products where user_id=any(${owners}) and (id=any(${legacy}) or product_id in(select product_id from public.style_preference_actions where user_id=any(${owners}) and action_id=any(${actions})));
 delete from public.passed_products where user_id=any(${owners}) and (id=any(${legacy}) or product_id in(select product_id from public.style_preference_actions where user_id=any(${owners}) and action_id=any(${actions})));
 delete from public.user_events e where e.user_id=any(${owners}) and (e.event_id=any(${events}) or exists(select 1 from public.style_preference_actions a where a.user_id=e.user_id and a.action_id=any(${actions}) and e.event_id=any(a.event_ids)));
 delete from public.style_preference_actions where user_id=any(${owners}) and action_id=any(${actions});
 delete from public.user_style_profiles where user_id=any(${owners});
 commit; select json_build_object('remaining',(select count(*) from public.liked_products where user_id=any(${owners}))+(select count(*) from public.passed_products where user_id=any(${owners}))+(select count(*) from public.user_events where user_id=any(${owners}))+(select count(*) from public.style_preference_actions where user_id=any(${owners}))+(select count(*) from public.user_style_profiles where user_id=any(${owners})));`;
}
function pg(e){
 const host=e.KABIN_V2_DB_HOST,user=e.KABIN_V2_DB_USER;
 check((host==='db.'+REF+'.supabase.co'&&user==='postgres')||(/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host||'')&&user==='postgres.'+REF),'DB_TARGET_MISMATCH');
 check(e.KABIN_V2_DB_PORT==='5432'&&e.KABIN_V2_DB_PASSWORD,'DB_CONFIG_REQUIRED');
 return query=>new Promise((resolve,reject)=>{
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^PG/i.test(k)&&!/^KABIN_V2_/.test(k)));
  Object.assign(env,{PGPASSWORD:e.KABIN_V2_DB_PASSWORD,PGSSLMODE:'verify-full',PGSSLROOTCERT:'system',PGCONNECT_TIMEOUT:'10'});
  const child=execFile('C:/Users/Harun/AppData/Local/Temp/vitrify-pg17/pgsql/bin/psql.exe',
   ['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-h',host,'-p','5432','-U',user,'-d','postgres'],
   {env,windowsHide:true,timeout:30000,maxBuffer:262144},(error,out)=>{env.PGPASSWORD='';if(error)return reject(Error('DB_ACTION_FAILED_STOP'));try{resolve(JSON.parse(out.trim()));}catch{reject(Error('DB_RESULT_INVALID'));}});
  child.stdin.on('error',()=>{});child.stdin.end(query);
 });
}
async function backend(c){
 const {createClient}=require('@supabase/supabase-js');
 const client=token=>createClient(TARGET,c.e.KABIN_V2_PUBLIC_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:'Bearer '+token}}});
 const a=client(c.e.KABIN_V2_A_JWT),b=client(c.e.KABIN_V2_B_JWT);
 const verified=await Promise.all([a.auth.getUser(c.e.KABIN_V2_A_JWT),b.auth.getUser(c.e.KABIN_V2_B_JWT)]);
 check(verified.every(r=>!r.error&&uuid.test(r.data.user?.id||'')),'AUTH_FAILED');
 const owners=verified.map(r=>r.data.user.id);check(owners[0]!==owners[1],'DISTINCT_USERS_REQUIRED');
 const sql=(c.writes||c.e.KABIN_V2_DB_HOST)?pg(c.e):null;const run=c.e.KABIN_V2_RUN_ID;
 const manifest=c.writes?makeManifest(owners,run):{owners,actions:[],legacyEvents:[],legacyRows:[]};
 const rows=async(q)=>{const r=await q;check(!r.error&&Array.isArray(r.data),'READ_FAILED');return r.data;};
 const read=async(who,table,owner=owners[who],product)=>{let q=[a,b][who].from(table).select('*').eq('user_id',owner);if(product)q=q.eq('product_id',product);return rows(q);};
 const countAll=async()=>Promise.all(owners.map((owner,i)=>Promise.all(['liked_products','passed_products','user_events','style_preference_actions','user_style_profiles'].map(t=>read(i,t))).then(all=>all.map(r=>r.length))));
 let fixtures;
 const rpcTimes=[];
 return {
  manifest,owners,id:name=>id(run,name),
  preflight:async()=>{
   check((await countAll()).flat().every(n=>n===0),'EMPTY_TEST_BASELINE_REQUIRED');
   const cfg=await rows(a.from('recs_config').select('key,value').in('key',['style_preference_writer_v2','style_profile_v2']));
   const writer=cfg.find(x=>x.key==='style_preference_writer_v2')?.value?.enabled===true;
   check((cfg.find(x=>x.key==='style_profile_v2')?.value?.algorithm||'v1')==='v1','PROFILE_MUST_STAY_V1');
   fixtures=(await rows(a.from('products').select('id,title,price,image_url,category').order('id').limit(40))).filter(p=>typeof p.id==='string'&&p.id.length>0&&Number(p.price)>0&&/^https:\/\//.test(p.image_url||'')).slice(0,3);
   check(fixtures.length===3,'SAFE_FIXTURES_MISSING');
   if(sql){const r=await sql("select json_build_object('postgres',current_user='postgres','helper',(select md5(regexp_replace(prosrc,'[[:space:]]+',' ','g')) from pg_proc where oid='public.style_profile_events_v2(uuid,text)'::regprocedure));");check(r.postgres&&r.helper==='f2acd7054134d99a2d7e211cfe794604','DB_METADATA_MISMATCH');}
   return {writer};
  },
  rpc:async(name,op,index=0,expected=null,who=0,legacyRow)=>{
   const p=fixtures[index],args={p_action:id(run,name),p_operation:op,p_product:p.id,p_session:run};
   if(legacyRow)args.p_legacy_row=legacyRow;else Object.assign(args,{p_expected:expected,p_snapshot:op==='favorite'?{id:p.id,title:p.title,price:Number(p.price),imageUrl:p.image_url,category:p.category}:null});
   const started=performance.now();try{return await [a,b][who].rpc(legacyRow?'style_remove_legacy_preference_v2':'style_apply_preference_v2',args);}finally{rpcTimes.push(performance.now()-started);}
  },
  read:(table,index=0,who=0,owner)=>read(who,table,owner||owners[who],fixtures[index].id),
  foreignDelete:(table='liked_products')=>b.from(table).delete().eq('user_id',owners[0]).eq('product_id',fixtures[0].id).select('id'),
  foreignInsert:()=>b.from('liked_products').insert({user_id:owners[0],product_id:fixtures[0].id,product_snapshot:{id:fixtures[0].id}}),
  foreignUpdate:()=>b.from('liked_products').update({product_snapshot:{id:fixtures[0].id,title:'forbidden'}}).eq('user_id',owners[0]).eq('product_id',fixtures[0].id).select('id'),
  legacySeed:async()=>{
   check(!(await read(0,'liked_products',owners[0],fixtures[1].id)).length,'FIXTURE_DIRTY');
   for(const [table,index,name] of [['liked_products',1,'legacy-like-row'],['passed_products',2,'legacy-pass-row']]){
    const r=await a.from(table).insert({id:id(run,name),user_id:owners[0],product_id:fixtures[index].id,...(table==='liked_products'?{product_snapshot:{id:fixtures[index].id}}:{})});check(!r.error,'LEGACY_SEED_FAILED');
   }
   const r=await a.from('user_events').insert({event_id:id(run,'legacy-event'),user_id:owners[0],session_id:run,event_type:'like',product_id:fixtures[1].id,payload:{}});check(!r.error,'LEGACY_SEED_FAILED');
  },
  scopedProfile:async()=>{
   const before=await rows(a.from('user_style_profiles').select('computed_at').eq('user_id',owners[0]));check(before.length===1,'PROFILE_MISSING');
   const cutoff=await sql("select json_build_object('cutoff',clock_timestamp());");
   check(Date.parse(before[0].computed_at)<=Date.parse(cutoff.cutoff),'PROFILE_NOT_STALE');
   const r=await sql(`begin; do $$ begin perform set_config('request.jwt.claims',jsonb_build_object('sub','${owners[0]}')::text,true);perform public.recompute_profile_v2('${owners[0]}'::uuid,'exclude_with_approval');end $$;commit;select json_build_object('events',event_count,'computed_at',computed_at) from public.user_style_profiles where user_id='${owners[0]}'::uuid;`);
   check(r.events===1&&Date.parse(r.computed_at)>Date.parse(cutoff.cutoff),'EXCLUDE_OR_FRESHNESS_FAILED');
   check((await read(0,'user_events')).some(e=>e.event_id===id(run,'legacy-event')),'LEGACY_EVENT_LOST');
   const other=await rows(b.from('user_style_profiles').select('user_id').eq('user_id',owners[0]));check(other.length===0,'PROFILE_ISOLATION_FAILED');
  },
  pauseForCleanup:async()=>{
   const input=createInterface({input:process.stdin,output:process.stdout});
   try{check(await input.question('CLOSE_APPROVED_WRITER_GATE_THEN_TYPE_CLOSED: ')==='CLOSED','CLEANUP_PAUSE_STOP');}finally{input.close();}
   const r=await sql("select json_build_object('writer',exists(select 1 from public.recs_config where key='style_preference_writer_v2' and value->'enabled'='true'::jsonb));");check(!r.writer,'WRITER_MUST_BE_OFF');
  },
  cleanup:async()=>{const r=await sql(cleanupSql(manifest));check(r.remaining===0,'CLEANUP_REMAINS');check((await countAll()).flat().every(n=>n===0),'CLEANUP_VERIFY_FAILED');}
  ,measurements:()=>{const a=[...rpcTimes].sort((x,y)=>x-y);return a.length?{count:a.length,mean:a.reduce((x,y)=>x+y,0)/a.length,p95:a[Math.ceil(a.length*.95)-1]}:null;}
 };
}
async function runCases(io,writes,emit){
 const state=await io.preflight();if(!writes)return {status:'PREFLIGHT_READY',liveWrites:false};
 check(state.writer,'WRITER_OFF');check(typeof io.cleanup==='function'&&typeof io.scopedProfile==='function'&&typeof io.pauseForCleanup==='function','CLEANUP_UNAVAILABLE');
 const commit=async(name,op,index=0,expected=null,who=0,row)=>{const r=await io.rpc(name,op,index,expected,who,row);check(!r.error&&r.data?.action_id===io.id(name)&&typeof r.data.replayed==='boolean','RPC_FAILED');return r;};
 const empty=async(table,index=0)=>check((await io.read(table,index)).length===0,'RELATION_REMAINS');
 await commit('like','favorite');check((await io.read('liked_products')).length===1,'LIKE_MISSING');
 check((await commit('like','favorite')).data.replayed,'REPLAY_FAILED');emit('PASS LIKE_REPLAY');
 for(const table of ['liked_products','passed_products','style_preference_actions','user_events'])check((await io.read(table,0,1,io.owners[0])).length===0,'RLS_ISOLATION_FAILED');
 const foreign=await io.foreignDelete();check((foreign.error&&foreign.error.code==='42501')||(!foreign.error&&foreign.data.length===0),'RLS_DELETE_FAILED');
 const insert=await io.foreignInsert();check(insert.error?.code==='42501','RLS_INSERT_FAILED');
 const update=await io.foreignUpdate();check((update.error&&update.error.code==='42501')||(!update.error&&update.data.length===0),'RLS_UPDATE_FAILED');
 const undo=await io.rpc('foreign-undo','unlike',0,[io.id('like')],1);check(undo.error?.code==='40001','FOREIGN_UNDO_FAILED');
 check((await io.read('liked_products')).length===1,'FOREIGN_MUTATION');emit('PASS RLS_ISOLATION');
 await commit('unlike','unlike',0,[io.id('like')]);await empty('liked_products');
 await commit('pass','pass');check((await io.read('passed_products')).length===1,'PASS_MISSING');
 check((await io.read('passed_products',0,1,io.owners[0])).length===0,'PASS_RLS_FAILED');
 const foreignPass=await io.foreignDelete('passed_products');check((foreignPass.error&&foreignPass.error.code==='42501')||(!foreignPass.error&&foreignPass.data.length===0),'PASS_DELETE_FAILED');
 check((await io.read('passed_products')).length===1,'PASS_FOREIGN_MUTATION');
 await commit('undo','undo_pass',0,[io.id('pass')]);await empty('passed_products');
 await commit('like-new','favorite');const stale=await io.rpc('undo-old','unlike',0,[io.id('like')]);check(stale.error?.code==='40001','STALE_UNDO_FAILED');
 await commit('unlike-new','unlike',0,[io.id('like-new')]);emit('PASS PASS_EXACT_UNDO');
 // Controlled response loss AFTER real commit; not a physical network timeout.
 await commit('lost-response','favorite');
 const receipt=(await io.read('style_preference_actions')).filter(r=>r.action_id===io.id('lost-response'));
 check(receipt.length===1&&receipt[0].request.operation==='favorite','UNKNOWN_RECONCILIATION_FAILED');
 check((await commit('lost-response','favorite')).data.replayed,'UNKNOWN_REPLAY_FAILED');emit('PASS CONTROLLED_RESPONSE_DISCARD');
 await io.legacySeed();
 await commit('remove-legacy-like','unlike',1,null,0,io.id('legacy-like-row'));await empty('liked_products',1);
 await commit('remove-legacy-pass','undo_pass',2,null,0,io.id('legacy-pass-row'));await empty('passed_products',2);emit('PASS LEGACY_REMOVE');
 await io.scopedProfile();emit('PASS SCOPED_EXCLUDE_PROFILE');
 await io.pauseForCleanup();await io.cleanup();emit('PASS CLEANUP');
 const timing=io.measurements?.();if(timing)emit('MEASURE RPC_COUNT '+timing.count+' MEAN_MS '+timing.mean.toFixed(3)+' P95_MS '+timing.p95.toFixed(3));
 return {status:'ACCEPTANCE_PASS',liveWrites:true,globalProfileCutover:'NOT_VERIFIED',physicalNetworkTimeout:'NOT_VERIFIED'};
}
if(require.main===module)(async()=>{
 try{const c=config(process.env);const io=await backend(c);if(c.e.KABIN_V2_CLEANUP_ONLY==='yes'){check(c.writes,'CLEANUP_APPROVAL_REQUIRED');await io.cleanup();process.stdout.write('STATUS CLEANUP_PASS\n');return;}const r=await runCases(io,c.writes,s=>process.stdout.write(s+'\n'));process.stdout.write('STATUS '+r.status+'\n');}
 catch{process.stdout.write('STATUS BLOCKED_OR_FAILED_STOPPED\nCLEANUP NOT_VERIFIED\n');process.exitCode=1;}
})();
module.exports={TARGET,config,cleanupSql,runCases,makeManifest};
