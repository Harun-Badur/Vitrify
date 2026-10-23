'use strict';
const dns=require('node:dns/promises');
const net=require('node:net');
const tls=require('node:tls');
const {execFile}=require('node:child_process');
// Copied from this staging project's Dashboard > Connect > Session pooler, not inferred.
const HOST='aws-1-eu-central-1.pooler.supabase.com';
const USER='postgres.sdjxseqfkturkfohkfni';
const PSQL='C:/Users/Harun/AppData/Local/Temp/vitrify-pg17/pgsql/bin/psql.exe';
const CODES=new Set(['DB_DNS_FAILED','DB_TCP_UNREACHABLE','DB_TLS_FAILED','DB_AUTH_FAILED',
  'DB_TARGET_MISMATCH','DB_SELECT_PERMISSION_FAILED','DB_UNKNOWN_CONNECTION_ERROR']);
function classifyDbError(error,stderr='') {
  // Inspect only in memory; never return messages, stderr, URIs, usernames or errors.
  const text=String(stderr||error?.message||'');
  if(error?.code==='ENOTFOUND'||error?.code==='EAI_AGAIN'||/could not translate host name|Name or service not known|No such host is known/i.test(text))return 'DB_DNS_FAILED';
  if(/certificate verify failed|root certificate.*(?:does not exist|could not|not found)|could not (?:read|load) root certificate|SSL error|TLS handshake|server does not support SSL/i.test(text))return 'DB_TLS_FAILED';
  if(/password authentication failed|SASL authentication failed|no password supplied|Tenant or user not found/i.test(text))return 'DB_AUTH_FAILED';
  if(/permission denied for (?:function|schema|relation|table)/i.test(text))return 'DB_SELECT_PERMISSION_FAILED';
  if(error?.code==='ECONNREFUSED'||/connection refused|network is unreachable|No route to host|connection timed out/i.test(text))return 'DB_TCP_UNREACHABLE';
  return 'DB_UNKNOWN_CONNECTION_ERROR';
}
function validateSession(db){
  if(!db||db.host!==HOST||db.user!==USER||db.port!=='5432'||typeof db.password!=='string'||!db.password)throw Error('DB_TARGET_MISMATCH');
}
async function lookup(host){
  let timer;try{const result=await Promise.race([dns.lookup(host,{all:true}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error()),10000);})]);if(!result.length)throw Error();}finally{clearTimeout(timer);}
}
function socketCheck(host,secure){
  return new Promise((resolve,reject)=>{
    const socket=net.connect({host,port:5432});let wrapped,done=false;
    const timer=setTimeout(()=>finish(Error()),10000);
    function finish(error){if(done)return;done=true;clearTimeout(timer);wrapped?.destroy();socket.destroy();error?reject(error):resolve();}
    socket.on('error',finish);
    socket.on('connect',()=>{
      if(!secure)return finish();
      const request=Buffer.alloc(8);request.writeInt32BE(8,0);request.writeInt32BE(80877103,4);
      socket.write(request);
      socket.once('data',data=>{
        if(data.length!==1||data[0]!==83)return finish(Error());
        wrapped=tls.connect({socket,servername:host,rejectUnauthorized:true});
        wrapped.once('error',finish);wrapped.once('secureConnect',()=>finish(wrapped.authorized?null:Error()));
      });
    });
  });
}
function identity(db){
  return new Promise((resolve,reject)=>{
    const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^PG/i.test(name)));
    Object.assign(env,{PGPASSWORD:db.password,PGSSLMODE:'verify-full',PGSSLROOTCERT:'system',PGCONNECT_TIMEOUT:'10',PGOPTIONS:'-c default_transaction_read_only=on'});
    const child=execFile(PSQL,['-X','-q','-A','-t','-w','-v','ON_ERROR_STOP=1','-h',db.host,'-p','5432','-U',db.user,'-d','postgres'],
      {env,windowsHide:true,timeout:20000,maxBuffer:65536},(error,stdout,stderr)=>{
        env.PGPASSWORD='';
        if(error)return reject(Object.assign(Error(),{safeCode:classifyDbError(error,stderr)}));
        resolve(stdout.trim()==='postgres|postgres');
      });
    child.stdin.on('error',()=>{});child.stdin.end('SELECT current_database(), current_user;\n');
  });
}
async function diagnose(db,steps={dns:lookup,tcp:h=>socketCheck(h,false),tls:h=>socketCheck(h,true),select:identity}){
  const stages={parameters:'NOT VERIFIED',dns:'NOT VERIFIED',tcp:'NOT VERIFIED',tls:'NOT VERIFIED',auth:'NOT VERIFIED',database:'NOT VERIFIED',select:'NOT VERIFIED'};
  let code;
  try{
    try{validateSession(db);}catch{stages.parameters='FAIL';throw Object.assign(Error(),{safeCode:'DB_TARGET_MISMATCH'});}stages.parameters='PASS';
    for(const [name,failure] of [['dns','DB_DNS_FAILED'],['tcp','DB_TCP_UNREACHABLE'],['tls','DB_TLS_FAILED']]){
      try{await steps[name](db.host);stages[name]='PASS';}catch{stages[name]='FAIL';throw Object.assign(Error(),{safeCode:failure});}
    }
    try{
      const matches=await steps.select(db);stages.auth='PASS';stages.database='PASS';stages.select=matches?'PASS':'FAIL';
      if(!matches)throw Object.assign(Error(),{safeCode:'DB_TARGET_MISMATCH'});
    }catch(error){
      const safe=CODES.has(error.safeCode)?error.safeCode:'DB_UNKNOWN_CONNECTION_ERROR';
      if(safe==='DB_TLS_FAILED')stages.tls='FAIL';
      if(safe==='DB_AUTH_FAILED')stages.auth='FAIL';
      if(safe==='DB_SELECT_PERMISSION_FAILED'){stages.auth='PASS';stages.database='PASS';stages.select='FAIL';}
      throw Object.assign(Error(),{safeCode:safe});
    }
    return {status:'CONNECTION VERIFIED',stages,writerActivated:false};
  }catch(error){code=CODES.has(error.safeCode)?error.safeCode:'DB_UNKNOWN_CONNECTION_ERROR';return {status:'BLOCKED',code,stages,writerActivated:false};}
  finally{if(db)db.password=null;}
}
if(require.main===module)(async()=>{let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>10000)throw Error();}const db=JSON.parse(raw);raw='';const result=await diagnose(db);process.stdout.write(JSON.stringify(result));process.exitCode=result.status==='BLOCKED'?1:0;})().catch(()=>{process.stdout.write('{"status":"BLOCKED","code":"DB_UNKNOWN_CONNECTION_ERROR"}');process.exitCode=1;});
module.exports={classifyDbError,validateSession,diagnose};
