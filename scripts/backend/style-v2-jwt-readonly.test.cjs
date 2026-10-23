'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {run,checkKey,TARGET}=require('./style-v2-jwt-readonly.cjs');
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
const token=value=>'x.'+Buffer.from(JSON.stringify(value)).toString('base64url')+'.x';
const tokens=ids.map(sub=>token({role:'authenticated',sub,iss:TARGET+'/auth/v1',exp:Math.floor(Date.now()/1000)+300}));
function input(){return {url:TARGET,disposable:true,key:token({role:'anon',ref:'sdjxseqfkturkfohkfni'}),A:{email:'a@example.invalid',password:'fake'},B:{email:'b@example.invalid',password:'fake'}};}
function fake({rows=false,leak=false,anonAllowed=false}={}){
  const calls=[];
  async function transport(url,options){
    calls.push({url,method:options.method});
    assert.equal(new URL(url).origin,TARGET);
    const path=new URL(url).pathname;
    let data,status=200;
    if(path==='/auth/v1/settings')data={};
    else if(path==='/auth/v1/token'){assert.equal(options.method,'POST');const i=JSON.parse(options.body).email.startsWith('a')?0:1;data={access_token:tokens[i]};}
    else if(path==='/auth/v1/user'){const i=tokens.indexOf(options.headers.Authorization.slice(7));data={id:ids[i]};}
    else {
      assert.equal(options.method,'GET');assert.equal(path,'/rest/v1/style_preference_actions');
      if(!options.headers.Authorization){status=anonAllowed?200:401;data=anonAllowed?[]:{code:'42501'};}
      else {const caller=ids[tokens.indexOf(options.headers.Authorization.slice(7))];const owner=new URL(url).searchParams.get('user_id').slice(3);data=(rows&&caller===owner)||(leak&&caller!==owner)?[{user_id:owner}]:[];}
    }
    return {ok:status>=200&&status<300,status,json:async()=>data};
  }
  return {transport,calls};
}
test('empty ledger proves endpoint only, never row isolation',async()=>{const f=fake(),i=input(),r=await run(i,f.transport);assert.equal(r.status,'PARTIAL');assert.equal(r.results.filter(x=>x.test.startsWith('row_isolation')).every(x=>x.status==='NOT VERIFIED'),true);assert.equal(i.key,null);assert.equal(i.A,null);});
test('existing own rows plus cross denial prove isolation',async()=>{const f=fake({rows:true}),r=await run(input(),f.transport);assert.equal(r.status,'VERIFIED READ-ONLY');assert.equal(r.results.filter(x=>x.test.startsWith('row_isolation')).every(x=>x.status==='PASS'),true);assert.equal(f.calls.filter(x=>x.method==='POST').length,2);assert.equal(f.calls.some(x=>x.url.includes('/rpc/')),false);});
test('cross-owner disclosure stops without further tests',async()=>{const f=fake({rows:true,leak:true}),r=await run(input(),f.transport);assert.equal(r.code,'CROSS_OWNER_LEAK');assert.equal(f.calls.some(x=>x.method!=='GET'&&!x.url.includes('/auth/v1/token?grant_type=password')),false);});
test('anon successful empty response is not claimed as denied',async()=>{const r=await run(input(),fake({anonAllowed:true}).transport);assert.equal(r.code,'ANON_NOT_DENIED');});
test('production target blocked before any request',async()=>{let called=false;const i=input();i.url='https://production.invalid';const r=await run(i,async()=>{called=true;});assert.equal(r.status,'BLOCKED');assert.equal(called,false);});
test('service role and wrong project keys rejected before request',()=>{assert.throws(()=>checkKey(token({role:'service_role',ref:'sdjxseqfkturkfohkfni'})));assert.throws(()=>checkKey(token({role:'anon',ref:'other'})));assert.throws(()=>checkKey('sb_secret_fake'));});
test('unconfirmed disposable scope cannot login',async()=>{let called=false;const i=input();i.disposable=false;const r=await run(i,async()=>{called=true;});assert.equal(r.status,'BLOCKED');assert.equal(called,false);});
test('provider errors are sanitized and credentials not serialized',async()=>{const i=input();const r=await run(i,async()=>{throw Error('details a@example.invalid secret');});assert.equal(r.code,'TRANSPORT_OR_RUNTIME_FAILED');assert.equal(JSON.stringify(r).includes('example.invalid'),false);assert.equal(JSON.stringify(r).includes('secret'),false);});
test('uppercase transport errors are not treated as trusted fixed codes',async()=>{const r=await run(input(),async()=>{throw Error('UNTRUSTED_PROVIDER_DETAIL');});assert.equal(r.code,'TRANSPORT_OR_RUNTIME_FAILED');});
