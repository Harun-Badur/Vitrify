// Operator run ONLY after explicit approval. No .env loading, admin key or account creation/deletion.
'use strict';
const {randomUUID} = require('node:crypto');
const STAGING = 'https://sdjxseqfkturkfohkfni.supabase.co';
function config(env) {
  const names=['WARDROBE_STAGING_URL','WARDROBE_STAGING_ANON_KEY','WARDROBE_USER_A_JWT',
    'WARDROBE_USER_B_JWT','WARDROBE_USER_A_ID','WARDROBE_USER_B_ID'];
  if(names.some(n=>!env[n]) || env.WARDROBE_STAGING_URL!==STAGING ||
    env.WARDROBE_ALLOW_TEST_WRITES!=='yes' || env.WARDROBE_DISPOSABLE_USERS_ONLY!=='yes') throw Error('CONFIG_REQUIRED');
  for(const name of ['WARDROBE_USER_A_JWT','WARDROBE_USER_B_JWT']) {
    try {if(JSON.parse(Buffer.from(env[name].split('.')[1],'base64url')).role!=='authenticated') throw Error();}
    catch {throw Error('USER_JWT_REQUIRED');}
  }
  if(env.WARDROBE_USER_A_ID===env.WARDROBE_USER_B_ID) throw Error('DISTINCT_USERS_REQUIRED');
  if(!env.WARDROBE_STAGING_ANON_KEY.startsWith('sb_publishable_')) {
    try {if(JSON.parse(Buffer.from(env.WARDROBE_STAGING_ANON_KEY.split('.')[1],'base64url')).role!=='anon') throw Error();}
    catch {throw Error('PUBLIC_API_KEY_REQUIRED');}
  }
  return env;
}
const check = (value) => {if(!value) throw Error('ASSERTION_FAILED');};
const applied = r => check(!r.error && r.data==='applied');
const denied = r => check(r.error && r.error.code==='42501');
const equal = (a,b) => JSON.stringify(a)===JSON.stringify(b);
async function runCases(a,b,ownerA,ownerB,emit) {
  const item=randomUUID(), outfit=randomUUID(), rollback=randomUUID(), foreign=randomUUID();
  const idsA={item,outfits:[outfit,rollback]}, idsB={item:null,outfits:[foreign]};
  let initialA,initialB,ok=false,cleanup=false,step='BASELINE';
  const pass = name => emit('PASS '+name);
  const mutation=(owner,kind,id,version,value)=>({p_owner:owner,p_kind:kind,p_id:id,p_expected:version,p_value:value});
  const value={title:'wardrobe smoke',brand:'test',category:'upper_body',
    imageUrl:'https://example.invalid/wardrobe-test.jpg',createdAt:new Date().toISOString()};
  const outfitValue={title:'outfit smoke',wardrobeItemIds:[item],catalogProductIds:[],createdAt:value.createdAt};
  const snapshot=async () => {const r=await a.rpc('wardrobe_cloud_snapshot',{p_owner:ownerA});
    check(!r.error && r.data.owner===ownerA);return r.data;};
  try {
    initialA=await a.count();initialB=await b.count();
    step='CREATE_READ';
    applied(await a.rpc('wardrobe_apply_change',mutation(ownerA,'item',item,null,value)));
    applied(await a.rpc('wardrobe_apply_change',mutation(ownerA,'outfit',outfit,null,outfitValue)));
    let s=await snapshot(), saved=s.items.find(i=>i.id===item), savedOutfit=s.outfits.find(o=>o.id===outfit);
    check(saved && saved.title===value.title && savedOutfit && equal(savedOutfit.wardrobeItemIds,[item]));pass(step);
    step='RLS_ISOLATION';
    for(const table of ['wardrobe_items','outfits','outfit_items']) {
      const r=await b.read(table,table==='wardrobe_items'?item:outfit);check(!r.error && r.data.length===0);
    }
    denied(await b.rpc('wardrobe_cloud_snapshot',{p_owner:ownerA}));
    denied(await b.rpc('wardrobe_apply_change',mutation(ownerA,'item',item,saved.updatedAt,{...value,title:'forbidden'})));
    for(const table of ['wardrobe_items','outfits','outfit_items']) {
      const id=table==='wardrobe_items'?item:outfit;
      const r=await b.change(table,id,table==='outfit_items'?{position:9}:{name:'forbidden'});
      check((r.error && r.error.code==='42501') || (!r.error && r.data.length===0));
      const d=await b.remove(table,id);check((d.error && d.error.code==='42501') || (!d.error && d.data.length===0));
    }
    const wrong=await b.rpc('wardrobe_apply_change',mutation(ownerB,'item',item,saved.updatedAt,{...value,title:'forbidden'}));
    check(!wrong.error && wrong.data==='conflict');
    denied(await b.rpc('wardrobe_apply_change',mutation(ownerB,'outfit',foreign,null,outfitValue)));
    s=await snapshot();check(equal(s.items.find(i=>i.id===item),saved) && equal(s.outfits.find(o=>o.id===outfit),savedOutfit));pass(step);
    step='DUPLICATE';
    for(const [kind,id,v] of [['item',item,value],['outfit',outfit,outfitValue]]) {
      const r=await a.rpc('wardrobe_apply_change',mutation(ownerA,kind,id,null,v));check(!r.error && r.data==='conflict');
    }
    s=await snapshot();check(s.items.filter(i=>i.id===item).length===1 && s.outfits.filter(o=>o.id===outfit).length===1);pass(step);
    step='STALE_VERSION';
    applied(await a.rpc('wardrobe_apply_change',mutation(ownerA,'item',item,saved.updatedAt,{...value,title:'updated'})));
    const stale=await a.rpc('wardrobe_apply_change',mutation(ownerA,'item',item,saved.updatedAt,{...value,title:'stale'}));
    check(!stale.error && stale.data==='conflict');
    s=await snapshot();check(s.items.find(i=>i.id===item).title==='updated' && s.items.find(i=>i.id===item).updatedAt!==saved.updatedAt);pass(step);
    step='TRANSACTION_ROLLBACK';
    const originalLinks=await a.read('outfit_items',outfit);check(!originalLinks.error);
    const missing='wardrobe-test-'+randomUUID();check(!(await a.productExists(missing)));
    const bad={...outfitValue,title:'must rollback',catalogProductIds:[missing]};
    const update=await a.rpc('wardrobe_apply_change',mutation(ownerA,'outfit',outfit,savedOutfit.updatedAt,bad));
    check(update.error && update.error.code==='23503');
    const create=await a.rpc('wardrobe_apply_change',mutation(ownerA,'outfit',rollback,null,bad));
    check(create.error && create.error.code==='23503');
    s=await snapshot();check(equal(s.outfits.find(o=>o.id===outfit),savedOutfit) && !s.outfits.some(o=>o.id===rollback));
    const restoredLinks=await a.read('outfit_items',outfit);check(!restoredLinks.error && equal(restoredLinks.data,originalLinks.data));
    pass(step);
    step='RELATION_CASCADE';
    applied(await a.rpc('wardrobe_apply_change',mutation(ownerA,'item',item,s.items.find(i=>i.id===item).updatedAt,null)));
    s=await snapshot();check(!s.items.some(i=>i.id===item) && s.outfits.find(o=>o.id===outfit).wardrobeItemIds.length===0);
    const links=await a.read('outfit_items',outfit);check(!links.error && links.data.length===0);pass(step);ok=true;
  } catch {emit('FAIL '+step);}
  finally {
    // Attempt both owners independently even if one cleanup fails; never blanket-delete a user's rows.
    const cleaned=await Promise.allSettled([a.cleanup(idsA),b.cleanup(idsB)]);
    try {
      check(cleaned.every(r=>r.status==='fulfilled'));
      const remainingA=await a.remaining(idsA),remainingB=await b.remaining(idsB);
      check(remainingA===0 && remainingB===0);
      check(initialA && initialB && equal(await a.count(),initialA) && equal(await b.count(),initialB));
      cleanup=true;emit('PASS CLEANUP user_A_test_records=0 user_B_test_records=0 baseline_counts_restored=true');
    } catch {emit('FAIL CLEANUP');}
  }
  return {ok:ok&&cleanup,cleanup};
}
function port(client,owner) {
  const key=t=>t==='outfit_items'?'outfit_id':'id';
  const guard=r=>{if(r.error)throw Error('REQUEST_FAILED');return r.data;};
  const select=(t,id)=>client.from(t).select('*').eq(key(t),id);
  const count=async (t)=>{let q=client.from(t).select(t==='outfit_items'?'id,outfits!inner(user_id)':'id',{count:'exact',head:true});
    q=q.eq(t==='outfit_items'?'outfits.user_id':'user_id',owner);const r=await q;guard(r);check(Number.isInteger(r.count));return r.count;};
  return {
    rpc:(n,args)=>client.rpc(n,args), read:select,
    change:(t,id,v)=>client.from(t).update(v).eq(key(t),id).select(),
    remove:(t,id)=>client.from(t).delete().eq(key(t),id).select(),
    count:async()=>({items:await count('wardrobe_items'),outfits:await count('outfits'),relations:await count('outfit_items')}),
    productExists:async id=>guard(await client.from('products').select('id').eq('id',id)).length>0,
    cleanup:async ids=>{
      // FK CASCADE removes only relations of these generated outfits/items.
      guard(await client.from('outfits').delete().eq('user_id',owner).in('id',ids.outfits));
      if(ids.item)guard(await client.from('wardrobe_items').delete().eq('user_id',owner).eq('id',ids.item));
    },
    remaining:async ids=>{
      let total=guard(await client.from('outfits').select('id').in('id',ids.outfits)).length;
      total+=guard(await client.from('outfit_items').select('id').in('outfit_id',ids.outfits)).length;
      if(ids.item){total+=guard(await client.from('wardrobe_items').select('id').eq('id',ids.item)).length;
        total+=guard(await client.from('outfit_items').select('id').eq('wardrobe_item_id',ids.item)).length;}
      return total;
    },
  };
}
async function main() {
  const env=config(process.env);
  const {createClient}=require('@supabase/supabase-js');
  const clients=[];
  for(const letter of ['A','B']) {
    const jwt=env[`WARDROBE_USER_${letter}_JWT`];
    const client=createClient(STAGING,env.WARDROBE_STAGING_ANON_KEY,{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      global:{headers:{Authorization:`Bearer ${jwt}`},
        fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(20000)})},
    });
    // JWT signature/expiry verified remotely by Auth before any table write.
    const auth=await client.auth.getUser(jwt);
    check(!auth.error && auth.data.user && auth.data.user.id===env[`WARDROBE_USER_${letter}_ID`]);
    const profile=await client.from('users').select('id').eq('id',auth.data.user.id);
    check(!profile.error && profile.data.length===1);
    clients.push(client);
  }
  const result=await runCases(port(clients[0],env.WARDROBE_USER_A_ID),port(clients[1],env.WARDROBE_USER_B_ID),
    env.WARDROBE_USER_A_ID,env.WARDROBE_USER_B_ID,line=>process.stdout.write(line+'\n'));
  process.exitCode=result.ok?0:1;
}
module.exports={STAGING,config,runCases};
if(require.main===module)main().catch(()=>{process.stdout.write('FAIL PREFLIGHT\n');process.exitCode=1;});
