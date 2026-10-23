'use strict';
// Operator-only: credentials arrive through stdin, never argv/env/files or logs.
const TARGET='https://sdjxseqfkturkfohkfni.supabase.co';
const REF='sdjxseqfkturkfohkfni';
function decode(token) { try{return JSON.parse(Buffer.from(token.split('.')[1],'base64url'));}catch{throw Error('TOKEN_INVALID');} }
function checkKey(key) {
  if(typeof key!=='string')throw Error('PUBLIC_KEY_REQUIRED');
  if(key.startsWith('sb_publishable_'))return;
  const claims=decode(key);
  if(claims.role!=='anon'||claims.ref!==REF)throw Error('PUBLIC_KEY_TARGET_MISMATCH');
}
async function run(input,transport=fetch) {
  const results=[];
  let sessions=[];
  const add=(test,status,http=null)=>results.push({test,status,...(http===null?{}:{http})});
  const stop=code=>{throw Error(code);};
  async function request(path,token,body) {
    // Only Auth password grant may POST; all data requests are bounded GET SELECT.
    const login=path==='/auth/v1/token?grant_type=password';
    if(body!==undefined&&!login)stop('METHOD_NOT_ALLOWED');
    if(!['/auth/v1/settings','/auth/v1/user','/auth/v1/token?grant_type=password'].includes(path)
       &&!/^\/rest\/v1\/style_preference_actions\?select=user_id&user_id=eq\.[0-9a-f-]{36}&limit=100$/.test(path))stop('PATH_NOT_ALLOWED');
    const response=await transport(TARGET+path,{method:login?'POST':'GET',redirect:'error',
      signal:AbortSignal.timeout(20000),headers:{apikey:input.key,...(token?{Authorization:'Bearer '+token}:{}),
        ...(login?{'Content-Type':'application/json'}:{})},...(login?{body:JSON.stringify(body)}:{})});
    let data;try{data=await response.json();}catch{data=null;}
    return {status:response.status,ok:response.ok,data};
  }
  try {
    if(input.url!==TARGET||input.disposable!==true)stop('TARGET_OR_TEST_SCOPE_INVALID');
    checkKey(input.key);
    const settings=await request('/auth/v1/settings');
    if(!settings.ok)stop('PUBLIC_KEY_NOT_ACCEPTED');
    add('staging_public_key','PASS',settings.status);
    for(const label of ['A','B']) {
      const credentials=input[label];
      if(!credentials||!credentials.email||!credentials.password)stop('CREDENTIALS_REQUIRED');
      const login=await request('/auth/v1/token?grant_type=password',null,credentials);
      input[label]=null;
      if(!login.ok||typeof login.data?.access_token!=='string')stop('AUTH_'+label+'_FAILED');
      const token=login.data.access_token;
      const claims=decode(token);
      if(claims.role!=='authenticated'||claims.iss!==TARGET+'/auth/v1'||!Number.isFinite(claims.exp)||claims.exp*1000<=Date.now())stop('JWT_'+label+'_INVALID');
      const user=await request('/auth/v1/user',token);
      if(!user.ok||user.data?.id!==claims.sub||! /^[0-9a-f-]{36}$/.test(claims.sub))stop('JWT_'+label+'_NOT_ACCEPTED');
      sessions.push({token,id:claims.sub,label});
      login.data=null;user.data=null;
      add('auth_'+label,'PASS',login.status);add('jwt_server_'+label,'PASS',user.status);
    }
    if(sessions[0].id===sessions[1].id)stop('DISTINCT_ACCOUNTS_REQUIRED');
    add('distinct_accounts','PASS');
    const presence=[];
    for(const session of sessions) {
      const own=await request('/rest/v1/style_preference_actions?select=user_id&user_id=eq.'+session.id+'&limit=100',session.token);
      if(!own.ok||!Array.isArray(own.data))stop('OWN_SELECT_'+session.label+'_FAILED');
      if(own.data.some(row=>row.user_id!==session.id))stop('OWNER_LEAK');
      presence.push(own.data.length>0);
      add('own_select_'+session.label,'PASS',own.status);
    }
    for(let i=0;i<2;i++) {
      const other=1-i,session=sessions[i];
      const crossed=await request('/rest/v1/style_preference_actions?select=user_id&user_id=eq.'+sessions[other].id+'&limit=100',session.token);
      if(!crossed.ok||!Array.isArray(crossed.data))stop('CROSS_SELECT_'+session.label+'_FAILED');
      if(crossed.data.length!==0)stop('CROSS_OWNER_LEAK');
      add('cross_select_'+session.label+'_empty','PASS',crossed.status);
      add('row_isolation_'+session.label,presence[other]?'PASS':'NOT VERIFIED');
    }
    const anon=await request('/rest/v1/style_preference_actions?select=user_id&user_id=eq.'+sessions[0].id+'&limit=100');
    if(![401,403].includes(anon.status)||anon.data?.code!=='42501')stop('ANON_NOT_DENIED');
    add('anon_select_denied','PASS',anon.status);
    return {status:presence.every(Boolean)?'VERIFIED READ-ONLY':'PARTIAL',results,
      rowsAvailableForBoth:presence.every(Boolean),mutatingRpcCalled:false};
  } catch(error) {
    // Never emit provider error text, request objects, identifiers or credentials.
    const trustedCodes=new Set(['TOKEN_INVALID','PUBLIC_KEY_REQUIRED','PUBLIC_KEY_TARGET_MISMATCH',
      'METHOD_NOT_ALLOWED','PATH_NOT_ALLOWED','TARGET_OR_TEST_SCOPE_INVALID','PUBLIC_KEY_NOT_ACCEPTED',
      'CREDENTIALS_REQUIRED','DISTINCT_ACCOUNTS_REQUIRED','OWNER_LEAK','CROSS_OWNER_LEAK','ANON_NOT_DENIED',
      ...['A','B'].flatMap(label=>['AUTH_'+label+'_FAILED','JWT_'+label+'_INVALID',
        'JWT_'+label+'_NOT_ACCEPTED','OWN_SELECT_'+label+'_FAILED','CROSS_SELECT_'+label+'_FAILED'])]);
    const code=trustedCodes.has(error.message)?error.message:'TRANSPORT_OR_RUNTIME_FAILED';
    if(['OWNER_LEAK','CROSS_OWNER_LEAK','ANON_NOT_DENIED'].includes(code))add('security_boundary','FAIL');
    return {status:'BLOCKED',code,results,mutatingRpcCalled:false};
  } finally {
    sessions.length=0;input.A=null;input.B=null;input.key=null;
  }
}
if(require.main===module) {
  (async()=>{
    let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>20000)throw Error('INPUT_TOO_LARGE');}
    const input=JSON.parse(raw);raw='';const result=await run(input);
    process.stdout.write(JSON.stringify(result));process.exitCode=result.status==='BLOCKED'?1:0;
  })().catch(()=>{process.stdout.write(JSON.stringify({status:'BLOCKED',code:'INPUT_OR_RUNTIME_FAILED'}));process.exitCode=1;});
}
module.exports={run,checkKey,TARGET};
