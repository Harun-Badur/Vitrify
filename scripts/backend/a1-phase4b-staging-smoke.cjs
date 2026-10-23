// OPERATOR RUN ONLY. Does not load .env. No secret, user ID, payload or provider error output.
'use strict';
const { randomUUID, randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { inventory } = require('./a1-user-table-audit.cjs');
const STAGING = 'https://sdjxseqfkturkfohkfni.supabase.co';
const buckets = ['model-photos','wardrobe-cutouts'];
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
const required = name => { if (!process.env[name]) throw new Error('CONFIG_REQUIRED'); return process.env[name]; };
const emit = (label, values) => process.stdout.write(label+' '+JSON.stringify(values)+'\n');
const literal = value => "'"+String(value).replace(/'/g,"''")+"'";
function database(statement, json = false) {
  // Credentials stay in PG* env; SQL through stdin, never command-line literals/logs.
  const query = json ? `select coalesce(json_agg(x),'[]'::json) from (${statement}) x;` : statement;
  const result = spawnSync(process.env.A1_PSQL_BIN || 'psql',['-X','-q','-t','-A','-v','ON_ERROR_STOP=1'],
    { input: query, encoding:'utf8', env:process.env, timeout:30000, maxBuffer:4*1024*1024 });
  if (result.error || result.status !== 0) throw new Error('DATABASE_STEP_FAILED');
  return json ? JSON.parse(result.stdout.trim()) : undefined;
}
async function main() {
  if (required('A1_STAGING_URL') !== STAGING || required('A1_SYNTHETIC_FIXTURES_ONLY') !== 'yes') throw new Error('STAGING_ONLY');
  const host = required('PGHOST');
  if (!(host === 'db.sdjxseqfkturkfohkfni.supabase.co' ||
    (/^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(host) && required('PGUSER').endsWith('.sdjxseqfkturkfohkfni')))) throw new Error('STAGING_DB_ONLY');
  if (required('PGSSLMODE') !== 'verify-full') throw new Error('VERIFIED_DB_TLS_REQUIRED');
  const knownTables=new Set(inventory().map(row=>row.table));
  const installed=database("select distinct table_schema||'.'||table_name as name from information_schema.columns where table_schema in ('public','deletion_private') and column_name in ('user_id','owner_id','subject')",true);
  if(installed.some(row=>!knownTables.has(row.name)))throw new Error('UNINVENTORIED_STAGING_USER_TABLE');
  const { createClient } = require('@supabase/supabase-js');
  const options = { auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(70000)})} };
  const admin = createClient(STAGING,required('A1_STAGING_SERVICE_ROLE_KEY'),options);
  const anon = required('A1_STAGING_ANON_KEY');
  const jpeg=readFileSync(required('A1_JPEG_FIXTURE')),png=readFileSync(required('A1_PNG_FIXTURE'));
  if (!jpeg.length || jpeg.length>5*1024*1024 || !png.length || png.length>12*1024*1024) throw new Error('FIXTURE_SIZE');
  const fixtures=[];
  async function user() {
    const email=`a1-${randomUUID()}@example.invalid`,password=randomBytes(24).toString('hex');
    const created=await admin.auth.admin.createUser({email,password,email_confirm:true});
    if(created.error || !created.data.user)throw new Error('CREATE_SYNTHETIC_FAILED');
    const record={id:created.data.user.id,jwt:null};fixtures.push(record);
    const client=createClient(STAGING,anon,options),login=await client.auth.signInWithPassword({email,password});
    if(login.error || !login.data.session)throw new Error('LOGIN_FAILED');record.jwt=login.data.session.access_token;return record;
  }
  async function edgeUpload(record,bucket,item=randomUUID()) {
    const path=bucket==='model-photos'?`${record.id}/model.jpg`:`${record.id}/${item}/cutout.png`;
    const response=await fetch(STAGING+'/functions/v1/account-storage-upload',{method:'POST',signal:AbortSignal.timeout(70000),
      headers:{Authorization:`Bearer ${record.jwt}`,apikey:anon,'content-type':bucket==='model-photos'?'image/jpeg':'image/png',
        'x-upload-bucket':bucket,'x-upload-path':path,'x-upload-request':randomUUID()},body:bucket==='model-photos'?jpeg:png});
    return response.status===200 && (await response.json()).state==='SUCCEEDED';
  }
  async function objects(record,bucket,prefix=record.id) {
    const paths=[];for(let offset=0;offset<100000;offset+=100){
      const listed=await admin.storage.from(bucket).list(prefix,{limit:100,offset,sortBy:{column:'name',order:'asc'}});
      if(listed.error || !listed.data)throw new Error('LIST_FAILED');
      for(const item of listed.data){if(item.id)paths.push(prefix+'/'+item.name);else paths.push(...await objects(record,bucket,prefix+'/'+item.name));}
      if(listed.data.length<100)return paths;
    }throw new Error('LIST_BUDGET');
  }
  function seed(record) {
    const who=literal(record.id),job=literal(randomUUID()),key=literal(randomBytes(32).toString('hex'));
    const product=database('select id from public.products limit 1',true)[0]?.id;
    if(!product)throw new Error('CATALOG_FIXTURE_REQUIRED');const pid=literal(product);
    database(`begin;
      insert into public.profiles(id) values(${who}) on conflict do nothing;
      insert into public.liked_products(user_id,product_id,product_snapshot) values(${who},${pid},'{}');
      insert into public.passed_products(user_id,product_id) values(${who},${pid});
      insert into public.push_tokens(user_id,expo_push_token) values(${who},'synthetic-not-deliverable');
      insert into public.price_alerts(user_id,product_id,old_price,new_price) values(${who},${pid},2,1);
      insert into public.rate_limits(user_id) values(${who}) on conflict do nothing;
      insert into public.user_events(event_id,user_id,session_id,event_type) values(gen_random_uuid(),${who},gen_random_uuid(),'synthetic');
      insert into public.user_style_profiles(user_id) values(${who}) on conflict do nothing;
      insert into public.discover_recommendation_jobs(id,owner_id) values(${job},${who});
      insert into public.discover_recommendation_job_payloads(job_id,owner_id,request_payload) values(${job},${who},'synthetic-not-worker-codec');
      insert into deletion_private.cache_write_permits(transaction_id,owner_id,job_id,kind,cache_key_hash) values(txid_current(),${who},${job},'ranking',${key});
      insert into deletion_private.job_write_permits(transaction_id,job_id,owner_id,phase) values(txid_current(),${job},${who},'claim');
      insert into deletion_private.job_claims(job_id,owner_id,revision,token,lease_until,request_snapshot) values(${job},${who},1,gen_random_uuid(),clock_timestamp()+interval '10 minutes','synthetic');
      insert into public.discover_recommendation_cache(scope,owner_id,kind,cache_key_hash,engine_version,catalog_version,catalog_fingerprint,context_fingerprint,payload)
        values(${who},${who},'ranking',${key},'synthetic','synthetic','synthetic','synthetic','synthetic');
      with op as (insert into deletion_private.storage_operations(subject,request,bucket,path) values(${who},'synthetic-journal','wardrobe-cutouts',${who}||'/journal/cutout.png') returning *)
        insert into deletion_private.storage_resolutions(operation,subject,request,decision) select operation,subject,request,'NEVER_DISPATCHED' from op;
      insert into deletion_private.provider_operations(subject,provider,request,state) values(${who},'fashn','synthetic-provider','UNKNOWN');
      commit;`);
    const rows=counts(record);if(rows.some(row=>Number(row.count)<1))throw new Error('TABLE_FIXTURE_MISSING');
    emit('FIXTURES',{tables:rows.length});
  }
  function counts(record) {
    return database(inventory().filter(row=>!['deletion_private.receipts','deletion_private.owner_gates'].includes(row.table))
      .map(row=>`select ${literal(row.table)} as table_name,count(*)::int as count from ${row.table} where ${row.owner}=${literal(record.id)}`).join(' union all '),true);
  }
  async function deletion(record) {
    const requestId=randomUUID(),capability=randomBytes(32).toString('hex');
    const {createDeletionReceipt}=require('./a1-phase4b-smoke-receipt.cjs');
    const deviceCheckpoint=createDeletionReceipt(requestId,record.id);
    let replay=false;
    async function post(){return fetch(STAGING+'/functions/v1/delete-account',{method:'POST',signal:AbortSignal.timeout(70000),
      headers:{apikey:anon,'content-type':'application/json',...(replay?{'x-deletion-recovery':capability}:{Authorization:`Bearer ${record.jwt}`})},
      body:JSON.stringify({requestId,...(replay?{}:{recoveryToken:capability,deviceCheckpoint})})});}
    for(let attempt=0;attempt<60;attempt++){
      const response=await post();if(![200,503].includes(response.status))throw new Error('DELETION_RESPONSE');
      const result=await response.json();if(result.protocol!=='vitrify.deletion.v1')throw new Error('PROTOCOL');
      if(result.complete===true){replay=true;const again=await post();const repeated=await again.json();
        if(again.status!==200 || JSON.stringify(result.receipt)!==JSON.stringify(repeated.receipt))throw new Error('RECEIPT_REPLAY');return;}
      replay=true;await pause(5000);
    }throw new Error('DELETION_RETRY_BUDGET');
  }
  let parallel,stage='FIXTURES';
  try {
    const record=await user();for(const bucket of buckets)if(!await edgeUpload(record,bucket))throw new Error('EDGE_FIXTURE_UPLOAD');seed(record);
    stage='T2';let stop=false;const n=Number(process.env.A1_PARALLEL_UPLOADS || 4);
    if(!Number.isInteger(n)||n<1||n>16)throw new Error('PARALLEL_LIMIT');
    parallel=(async()=>{let accepted=0,rejected=0;for(let round=0;round<24&&!stop;round++){
      const batch=await Promise.allSettled(Array.from({length:n},()=>edgeUpload(record,'wardrobe-cutouts')));
      batch.forEach(r=>{if(r.status==='fulfilled'&&r.value)accepted++;else rejected++;});await pause(1000);
    }return {accepted,rejected};})();
    try{await deletion(record);}finally{stop=true;}
    const uploads=await parallel;const rows=counts(record),first=await Promise.all(buckets.map(b=>objects(record,b)));
    const authCount=database(`select count(*)::int as count from auth.users where id=${literal(record.id)}`,true)[0].count;
    const tombstones=database(`select (select count(*) from deletion_private.owner_gates where subject=${literal(record.id)})::int as gates,
      (select count(*) from deletion_private.receipts where subject=${literal(record.id)})::int as receipts`,true)[0];
    emit('ABSENCE',{tables:rows.map(r=>({table:r.table_name,count:r.count})),storage:first.map(x=>x.length),authAbsent:authCount===0,gates:tombstones.gates,receipts:tombstones.receipts});
    if(rows.some(r=>r.count!==0)||first.some(x=>x.length)||authCount!==0||tombstones.gates!==1||tombstones.receipts!==1)throw new Error('ABSENCE_FAILED');
    await pause(70000);const later=await Promise.all(buckets.map(b=>objects(record,b)));emit('T2',{...uploads,initialResidual:first.map(x=>x.length),laterResidual:later.map(x=>x.length),janitor:false});
    stage='T11';const ownership=await user();
    const jwtClient=createClient(STAGING,anon,{...options,global:{...options.global,headers:{Authorization:`Bearer ${ownership.jwt}`}}});
    const client=await jwtClient.storage.from('model-photos').upload(`${ownership.id}/model.jpg`,jpeg,{contentType:'image/jpeg',upsert:true});
    const service=await admin.storage.from('model-photos').upload(`${ownership.id}/model.jpg`,jpeg,{contentType:'image/jpeg',upsert:true});
    if(service.error)throw new Error('T11_SERVICE_UPLOAD');
    const meta=database(`select case when coalesce(nullif(to_jsonb(o)->>'owner_id',''),nullif(to_jsonb(o)->>'owner','')) is null then 'EMPTY'
      when coalesce(nullif(to_jsonb(o)->>'owner_id',''),nullif(to_jsonb(o)->>'owner',''))=${literal(ownership.id)} then 'SYNTHETIC_USER' else 'OTHER' end as owner_class
      from storage.objects o where bucket_id='model-photos' and name=${literal(ownership.id+'/model.jpg')}`,true);
    const deleted=await admin.auth.admin.deleteUser(ownership.id);
    emit('T11',{clientWriteDenied:!!client.error,clientOwnerObserved:client.error?'NOT_OBSERVABLE_POLICY_DENIED':'UNEXPECTED_CLIENT_WRITE',serviceOwner:meta[0]?.owner_class??'MISSING',deleteUserAccepted:!deleted.error});
    if(!client.error)throw new Error('T11_CLIENT_WRITE_ALLOWED');
    emit('RESULT',{pass:true});
  } catch {emit('RESULT',{pass:false,stage});process.exitCode=1;}
  finally {
    if(parallel)await parallel.catch(()=>{});
    for(const record of fixtures){
      let cleanupOk=true;try{
        for(const bucket of buckets){const paths=await objects(record,bucket);for(let i=0;i<paths.length;i+=100){const result=await admin.storage.from(bucket).remove(paths.slice(i,i+100));if(result.error)throw new Error('REMOVE');}}
        // Operator schema-owner cleanup of synthetic operation fixtures only.
        database(`begin; delete from deletion_private.storage_resolutions where subject=${literal(record.id)};
          delete from deletion_private.storage_operations where subject=${literal(record.id)};
          delete from deletion_private.provider_operations where subject=${literal(record.id)}; commit;`);
        const existing=await admin.auth.admin.getUserById(record.id);if(existing.data?.user){const result=await admin.auth.admin.deleteUser(record.id);if(result.error)throw new Error('AUTH');}
      }catch{cleanupOk=false;process.exitCode=1;}
      try{const remaining=await Promise.all(buckets.map(b=>objects(record,b)));const remainingRows=counts(record);
        const authRemaining=database(`select count(*)::int as count from auth.users where id=${literal(record.id)}`,true)[0].count;
        const ownedRows=remainingRows.reduce((n,r)=>n+Number(r.count),0);
        if(remaining.some(x=>x.length)||ownedRows||authRemaining){cleanupOk=false;process.exitCode=1;}
        emit('CLEANUP',{ok:cleanupOk,storage:remaining.map(x=>x.length),ownedRows,authRemaining:authRemaining!==0,tombstonesRetained:true});
      }catch{emit('CLEANUP',{ok:false,remaining:'UNVERIFIED'});process.exitCode=1;}
    }
  }
}
main().catch(()=>{emit('RESULT',{pass:false,stage:'CONFIG'});process.exitCode=1;});
