'use strict';
// Read-only prerequisite checker. No writer activation, RPC or cleanup is implemented here.
const {execFile}=require('node:child_process');
const {classifyDbError}=require('./style-v2-db-diagnostic.cjs');
const {TARGET,checkKey}=require('./style-v2-jwt-readonly.cjs');
const REF='sdjxseqfkturkfohkfni';
const PSQL='C:/Users/Harun/AppData/Local/Temp/vitrify-pg17/pgsql/bin/psql.exe';
function validateDb(db) {
  if(!db||!db.password||db.port!=='5432')throw Error('DB_CONFIG_INVALID');
  const direct=db.host==='db.'+REF+'.supabase.co'&&db.user==='postgres';
  const pooler=/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(db.host)&&db.user==='postgres.'+REF;
  if(!direct&&!pooler)throw Error('DB_TARGET_MISMATCH');
}
function validateBaseline(b) {
  if(b.profiles>0)throw Error('EXISTING_PROFILE_RESTORE_NOT_AUTHORIZED');
  if(b.events>0||b.actions>0)throw Error('EXISTING_ANALYTICS_BASELINE_REQUIRES_REVIEW');
}
function sql(db,query) {
  return new Promise((resolve,reject)=>{
    const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^PG/i.test(name)));
    Object.assign(env,{PGPASSWORD:db.password,PGSSLMODE:'verify-full',PGSSLROOTCERT:'system',PGCONNECT_TIMEOUT:'10'});
    const child=execFile(PSQL,['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-h',db.host,'-p',db.port,'-U',db.user,'-d','postgres'],
      {env,windowsHide:true,timeout:20000,maxBuffer:262144},(error,out,stderr)=>{
        env.PGPASSWORD='';
        if(error)return reject(Error(classifyDbError(error,stderr)));
        try{resolve(JSON.parse(out.trim()));}catch{reject(Error('DB_RESULT_INVALID'));}
      });
    child.stdin.on('error',()=>{});child.stdin.end(query);
  });
}
async function run(input) {
  const checks=[];
  let subjects=[];
  const known=new Set(['DB_CONFIG_INVALID','DB_TARGET_MISMATCH','DB_CONNECTION_OR_SELECT_FAILED','DB_RESULT_INVALID',
    'DB_DNS_FAILED','DB_TCP_UNREACHABLE','DB_TLS_FAILED','DB_AUTH_FAILED','DB_SELECT_PERMISSION_FAILED','DB_UNKNOWN_CONNECTION_ERROR',
    'PUBLIC_KEY_TARGET_MISMATCH','PUBLIC_KEY_REQUIRED','TOKEN_INVALID','DB_ROLE_OR_ACTIVATION_MISMATCH',
    'AUTH_OR_JWT_FAILED','DISTINCT_ACCOUNTS_REQUIRED','EXISTING_PROFILE_RESTORE_NOT_AUTHORIZED',
    'EXISTING_ANALYTICS_BASELINE_REQUIRES_REVIEW','TARGET_OR_SCOPE_MISMATCH']);
  async function http(path,token,body){
    if(!['/auth/v1/settings','/auth/v1/user','/auth/v1/token?grant_type=password'].includes(path))throw Error('TARGET_OR_SCOPE_MISMATCH');
    const r=await fetch(TARGET+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(20000),
      headers:{apikey:input.key,...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})});
    const data=await r.json();if(!r.ok)throw Error('AUTH_OR_JWT_FAILED');return data;
  }
  try{
    if(input.url!==TARGET||input.disposable!==true)throw Error('TARGET_OR_SCOPE_MISMATCH');
    validateDb(input.db);checkKey(input.key);
    const dbState=await sql(input.db,"select jsonb_build_object('postgres',current_user='postgres','writer_missing',not exists(select 1 from public.recs_config where key='style_preference_writer_v2'),'profile_v1',not exists(select 1 from public.recs_config where key='style_profile_v2' and value->>'algorithm'='style-preference-v2'));");
    if(!dbState.postgres||!dbState.writer_missing||!dbState.profile_v1)throw Error('DB_ROLE_OR_ACTIVATION_MISMATCH');
    checks.push({test:'direct_db_tls_role_and_disabled_config',status:'PASS'});
    await http('/auth/v1/settings');
    for(const label of ['A','B']){
      const login=await http('/auth/v1/token?grant_type=password',null,input[label]);input[label]=null;
      const token=login.access_token;
      const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
      const user=await http('/auth/v1/user',token);
      if(user.id!==claims.sub||claims.role!=='authenticated'||claims.iss!==TARGET+'/auth/v1'||claims.exp*1000<=Date.now()
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id))throw Error('AUTH_OR_JWT_FAILED');
      subjects.push(user.id);checks.push({test:'auth_jwt_'+label,status:'PASS'});
    }
    if(subjects[0]===subjects[1])throw Error('DISTINCT_ACCOUNTS_REQUIRED');
    const owners=subjects.map(id=>"'"+id+"'::uuid").join(',');
    const baseline=await sql(input.db,"select jsonb_build_object('profiles',(select count(*) from public.user_style_profiles where user_id in ("+owners+")),'events',(select count(*) from public.user_events where user_id in ("+owners+")),'actions',(select count(*) from public.style_preference_actions where user_id in ("+owners+")));");
    const presence={existingProfile:baseline.profiles>0,existingEvents:baseline.events>0,existingLedger:baseline.actions>0};
    try{validateBaseline(baseline);}catch(e){return {status:'BLOCKED',code:e.message,checks,presence,writerActivated:false};}
    return {status:'PREFLIGHT_BASELINE_READY',checks,presence,writerActivated:false};
  }catch(error){return {status:'BLOCKED',code:known.has(error.message)?error.message:'LOCAL_OR_TRANSPORT_FAILED',checks,writerActivated:false};}
  finally{input.key=null;input.A=null;input.B=null;if(input.db)input.db.password=null;subjects=[];}
}
if(require.main===module)(async()=>{
  let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>20000)throw Error();}
  const input=JSON.parse(raw);raw='';const result=await run(input);process.stdout.write(JSON.stringify(result));process.exitCode=result.status==='BLOCKED'?1:0;
})().catch(()=>{process.stdout.write('{"status":"BLOCKED","code":"LOCAL_INPUT_FAILED","writerActivated":false}');process.exitCode=1;});
module.exports={validateDb,validateBaseline};
