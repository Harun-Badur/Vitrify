'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {classifyDbError,diagnose,validateSession}=require('./style-v2-db-diagnostic.cjs');
const db=()=>({host:'aws-1-eu-central-1.pooler.supabase.com',user:'postgres.sdjxseqfkturkfohkfni',port:'5432',password:'fake'});
test('session parameters must match the observed Dashboard host',()=>{assert.doesNotThrow(()=>validateSession(db()));for(const change of [{host:'aws-0-eu-central-1.pooler.supabase.com'},{host:'db.sdjxseqfkturkfohkfni.supabase.co'},{user:'postgres'},{port:'6543'}])assert.throws(()=>validateSession({...db(),...change}));});
test('native errors map to safe fixed categories',()=>{
  for(const [message,expected] of [['could not translate host name x to address','DB_DNS_FAILED'],['connection refused','DB_TCP_UNREACHABLE'],['SSL error: certificate verify failed','DB_TLS_FAILED'],['password authentication failed for user private','DB_AUTH_FAILED'],['ERROR: permission denied for function f','DB_SELECT_PERMISSION_FAILED'],['unrecognized secret text','DB_UNKNOWN_CONNECTION_ERROR']])assert.equal(classifyDbError({message},message),expected);
});
test('ambiguous errors remain unknown and are never emitted',()=>assert.equal(classifyDbError({code:'ENOENT'},'secret postgresql://private'),'DB_UNKNOWN_CONNECTION_ERROR'));
const good={dns:async()=>{},tcp:async()=>{},tls:async()=>{},select:async()=>true};
test('DNS failure prevents TCP, TLS and password attempt',async()=>{let called=false;const r=await diagnose(db(),{...good,dns:async()=>{throw Error();},select:async()=>{called=true;}});assert.equal(r.code,'DB_DNS_FAILED');assert.equal(called,false);assert.equal(r.stages.auth,'NOT VERIFIED');});
test('TCP failure prevents password attempt',async()=>{let called=false;const r=await diagnose(db(),{...good,tcp:async()=>{throw Error();},select:async()=>{called=true;}});assert.equal(r.code,'DB_TCP_UNREACHABLE');assert.equal(called,false);});
test('TLS failure prevents password attempt',async()=>{let called=false;const r=await diagnose(db(),{...good,tls:async()=>{throw Error();},select:async()=>{called=true;}});assert.equal(r.code,'DB_TLS_FAILED');assert.equal(called,false);});
test('auth failure is separated from SELECT failure',async()=>{const e=Object.assign(Error(),{safeCode:'DB_AUTH_FAILED'});const r=await diagnose(db(),{...good,select:async()=>{throw e;}});assert.equal(r.stages.auth,'FAIL');assert.equal(r.stages.select,'NOT VERIFIED');});
test('permission rejection proves connection but SELECT fails',async()=>{const e=Object.assign(Error(),{safeCode:'DB_SELECT_PERMISSION_FAILED'});const r=await diagnose(db(),{...good,select:async()=>{throw e;}});assert.equal(r.stages.auth,'PASS');assert.equal(r.stages.database,'PASS');assert.equal(r.stages.select,'FAIL');});
test('successful identity SELECT verifies connection without activation',async()=>{const input=db();const r=await diagnose(input,good);assert.equal(r.status,'CONNECTION VERIFIED');assert.equal(r.writerActivated,false);assert.equal(input.password,null);});
