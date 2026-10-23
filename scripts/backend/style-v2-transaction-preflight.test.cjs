'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateDb,validateBaseline}=require('./style-v2-transaction-preflight.cjs');
test('direct staging connection is accepted',()=>assert.doesNotThrow(()=>validateDb({host:'db.sdjxseqfkturkfohkfni.supabase.co',user:'postgres',port:'5432',password:'fake'})));
test('pooler requires the staging project in the username',()=>{
  assert.doesNotThrow(()=>validateDb({host:'aws-0-eu-central-1.pooler.supabase.com',user:'postgres.sdjxseqfkturkfohkfni',port:'5432',password:'fake'}));
  assert.throws(()=>validateDb({host:'aws-0-eu-central-1.pooler.supabase.com',user:'postgres.other',port:'5432',password:'fake'}));
});
test('production, local or arbitrary endpoint is rejected',()=>{for(const host of ['db.other.supabase.co','localhost','example.com'])assert.throws(()=>validateDb({host,user:'postgres',port:'5432',password:'fake'}));});
test('existing profiles block before writer activation',()=>assert.throws(()=>validateBaseline({profiles:1,events:0,actions:0}),{message:'EXISTING_PROFILE_RESTORE_NOT_AUTHORIZED'}));
test('existing history blocks destructive cleanup assumptions',()=>{assert.throws(()=>validateBaseline({profiles:0,events:1,actions:0}));assert.throws(()=>validateBaseline({profiles:0,events:0,actions:1}));});
test('empty analytics baseline is accepted without deleting anything',()=>assert.doesNotThrow(()=>validateBaseline({profiles:0,events:0,actions:0})));
