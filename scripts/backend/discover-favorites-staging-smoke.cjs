// OPERATOR RUN ONLY after explicit approval. No .env, admin key, account creation or raw error logging.
'use strict';
const {randomUUID}=require('node:crypto');
const {STAGING,config:existingConfig}=require('./wardrobe-staging-smoke.cjs');
const CATALOG_PAGE_SIZE=80,MAX_CATALOG_PAGES=10;
// Match gallery/category mapping without loading React Native. Keep fixture price validation strict.
const categories=['upper_body','lower_body','dresses','shoes','bags','hats','accessories'];
const providers=['amazon','trendyol','hepsiburada','mock','boyner','mavi','lcw','defacto','flo'];
function catalogFixture(row) {
  if(!row || typeof row.id!=='string' || !row.id.trim() || typeof row.title!=='string' || !row.title.trim()
    || typeof row.provider!=='string' || typeof row.external_id!=='string' || typeof row.currency!=='string'
    || typeof row.image_url!=='string' || typeof row.product_url!=='string' || typeof row.category!=='string'
    || !(typeof row.brand==='string' || row.brand===null)
    || !(typeof row.affiliate_url==='string' || row.affiliate_url===null)) return {reason:'shape'};
  if(!categories.includes(row.category))return {reason:'category'};
  if(!providers.includes(row.provider))return {reason:'provider'};
  let price=null;
  if(typeof row.price==='number')price=row.price;
  else if(typeof row.price==='string') {
    const token=row.price.trim().replace(',', '.');
    if(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(token))price=Number(token);
  }
  // Do not copy the application's invalid-price => zero fallback into a test fixture.
  if(price===null || !Number.isFinite(price) || price<0)return {reason:'price'};
  const images=Array.isArray(row.images)?row.images.filter(x=>typeof x==='string' && x.trim().length>0):[];
  const imageUrl=(images[0]??row.image_url).trim();
  try {const url=new URL(imageUrl);if(url.protocol!=='https:' || !url.hostname)return {reason:'image'};}
  catch {return {reason:'image'};}
  const brand=row.brand?.trim()||'Kabin';
  const product={id:row.id,title:row.title,brand,price,imageUrl,category:row.category,
    garmentDescription:`${brand} ${row.title}`.trim(),provider:row.provider,externalId:row.external_id,
    productUrl:row.product_url,affiliateUrl:row.affiliate_url?.trim()||undefined,
    images:images.length?images:undefined,
    colors:Array.isArray(row.colors)?row.colors.filter(x=>x && typeof x.name==='string' && typeof x.hex==='string'):undefined,
    sizes:Array.isArray(row.sizes)?row.sizes.filter(x=>typeof x==='string' && x.trim().length>0):undefined,createdAt:row.created_at};
  return {product:JSON.parse(JSON.stringify(product))};
}
const assert=value=>{if(!value)throw Error('CHECK_FAILED');};
class PreflightDiagnostic extends Error {
  constructor(code) { super('PREFLIGHT_DIAGNOSTIC');this.code=code; }
}
function diagnosticRows(result,section) {
  if(result.error) {
    const codes={'42703':'COLUMN_MISSING',PGRST204:'COLUMN_MISSING','42P01':'TABLE_UNAVAILABLE',
      PGRST205:'TABLE_UNAVAILABLE','42501':'ACCESS_DENIED'};
    const kind=(Object.hasOwn(codes,result.error.code)?codes[result.error.code]:null)
      || ([401,403].includes(result.status)?'AUTH_DENIED':'REQUEST_FAILED');
    throw new PreflightDiagnostic(section+'_'+kind);
  }
  if(!Array.isArray(result.data))throw new PreflightDiagnostic(section+'_INVALID_RESPONSE');
  return result.data;
}
function config(env) {
  const mapped={};
  for(const [old,key] of Object.entries({STAGING_URL:'STAGING_URL',STAGING_ANON_KEY:'ANON_KEY',
    USER_A_JWT:'USER_A_JWT',USER_B_JWT:'USER_B_JWT',USER_A_ID:'USER_A_ID',USER_B_ID:'USER_B_ID',
    ALLOW_TEST_WRITES:'ALLOW_TEST_WRITES',DISPOSABLE_USERS_ONLY:'DISPOSABLE_USERS_ONLY'})) {
    mapped['WARDROBE_'+old]=env['DISCOVER_FAVORITES_'+key];
  }
  existingConfig(mapped);return mapped;
}
const rows=r=>{assert(!r.error && Array.isArray(r.data));return r.data;};
const denied=r=>assert((r.error && r.error.code==='42501') || (!r.error && Array.isArray(r.data) && r.data.length===0));
const canonical=x=>Array.isArray(x)?x.map(canonical):x && typeof x==='object'
  ? Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const fingerprint=x=>JSON.stringify(canonical(Object.fromEntries(Object.entries(x).map(([k,v])=>[k,[...v].sort((a,b)=>a.id.localeCompare(b.id))]))));
async function runCases(a,b,emit,options={}) {
  const owned={likes:[randomUUID(),randomUUID(),randomUUID()],passes:[randomUUID(),randomUUID()]};
  let fixture,baseA,baseB,writing=false,cleanup=false,ok=false,step='PREFLIGHT';
  let diagnostic='PF_SCHEMA_A';
  const pass=label=>emit('PASS '+label);
  const readA=async kind=>rows(await a.read(kind,fixture.id));
  const insert=async(kind,id)=>{
    writing=true;const result=rows(await a.insert(kind,id,fixture));assert(result.length===1 && result[0].id===id);
  };
  const remove=async(kind,id)=>{rows(await a.remove(kind,fixture.id,id));assert((await readA(kind)).length===0);};
  try {
    await a.schema();diagnostic='PF_SCHEMA_B';await b.schema();
    diagnostic='PF_INVENTORY_A';baseA=await a.inventory();diagnostic='PF_INVENTORY_B';baseB=await b.inventory();
    diagnostic='PF_CATALOG';const candidates=await a.catalog();
    diagnostic='PF_FIXTURE_READ';
    for(const candidate of candidates) {
      const checks=await Promise.all(['likes','passes'].flatMap(kind=>[a.read(kind,candidate.id),b.read(kind,candidate.id)]));
      if(checks.every(r=>rows(r).length===0)){fixture=candidate;break;}
    }
    diagnostic=candidates.length===0?'PF_NO_USABLE_CATALOG':'PF_NO_SAFE_FIXTURE';assert(fixture);
    // Repeat the empty-key checks immediately before writing; never adopt existing rows.
    diagnostic='PF_FIXTURE_RECHECK';
    for(const port of [a,b])for(const kind of ['likes','passes'])assert(rows(await port.read(kind,fixture.id)).length===0);
    pass('PREFLIGHT');
    if(options.preflightOnly) return {status:'PREFLIGHT_PASS',cleanup:false};
    step='LIKE_READ_SNAPSHOT';await insert('likes',owned.likes[0]);
    const liked=(await readA('likes'))[0];assert(liked && same(liked.product_snapshot,fixture));pass(step);
    await insert('passes',owned.passes[0]);
    step='RLS_ISOLATION';
    for(const kind of ['likes','passes']) {
      const original=await readA(kind);
      assert(original.length===1);
      denied(await b.foreignRead(kind,fixture.id,original[0].id));
      denied(await b.foreignUpdate(kind,fixture.id,original[0].id));denied(await b.foreignRemove(kind,fixture.id,original[0].id));
      assert(same(await readA(kind),original));
    }pass(step);
    step='LIKE_DELETE';await remove('likes',owned.likes[0]);pass(step);
    step='PASS_UNDO';await remove('passes',owned.passes[0]);pass(step);
    step='PASS_LIKE_REPEAT';await insert('passes',owned.passes[1]);
    rows(await a.repeat('passes',owned.passes[1],fixture));
    assert((await readA('passes')).length===1 && (await readA('passes'))[0].id===owned.passes[1]);
    await insert('likes',owned.likes[1]);rows(await a.repeat('likes',owned.likes[1],fixture));
    assert((await readA('likes')).length===1 && (await readA('likes'))[0].id===owned.likes[1]);
    await remove('passes',owned.passes[1]);assert((await readA('likes')).length===1);pass(step);
    step='LIKE_DELETE_LIKE';await remove('likes',owned.likes[1]);
    await remove('likes',owned.likes[1]); // Repeated delete of our already absent row.
    await insert('likes',owned.likes[2]);assert((await readA('likes')).length===1);pass(step);
    step='EMPTY_VS_SQL_ERROR';assert((await readA('passes')).length===0);
    const invalid=await a.readError();
    emit(invalid.error?.code==='22P02' ? 'PASS EMPTY_VS_SQL_ERROR' : 'NOT VERIFIED SQL_ERROR_RESPONSE');
    ok=true;
  } catch(error) {
    emit(writing?'FAIL '+step:'BLOCKED PREFLIGHT '+diagnostic+(error instanceof PreflightDiagnostic?' '+error.code:''));
  }
  finally {
    if(writing) {
      try {
        // Exact generated primary keys + owner + product scope; no blanket user cleanup.
        await a.cleanup(owned,fixture.id);
        for(const port of [a,b])for(const kind of ['likes','passes'])assert(rows(await port.read(kind,fixture.id)).length===0);
        const finalA=await a.inventory(),finalB=await b.inventory();
        assert(fingerprint(baseA)===fingerprint(finalA) && fingerprint(baseB)===fingerprint(finalB));
        cleanup=true;emit('PASS CLEANUP test_likes=0 test_passes=0 original_rows_unchanged=true');
      } catch {emit('FAIL CLEANUP');}
    }
  }
  return {status:!writing?'BLOCKED':ok&&cleanup?'PASS':'FAIL',cleanup};
}
function port(client,owner,otherOwner,emit=()=>{}) {
  const table=kind=>kind==='likes'?'liked_products':'passed_products';
  const selection=kind=>kind==='likes'?'id,user_id,product_id,product_snapshot,liked_at,notify_on_price_drop':'id,user_id,product_id,passed_at';
  const scope=(query,who,product)=>query.eq('user_id',who).eq('product_id',product);
  const payload=(kind,id,product)=>({id,user_id:owner,product_id:product.id,
    ...(kind==='likes'?{product_snapshot:product,notify_on_price_drop:true}:{})});
  return {
    schema:async()=>{for(const kind of ['likes','passes'])diagnosticRows(await client.from(table(kind)).select(selection(kind)).limit(0),kind==='likes'?'SCHEMA_LIKES':'SCHEMA_PASSES');},
    inventory:async()=>{
      const result={};for(const kind of ['likes','passes']) {
        const r=await client.from(table(kind)).select('*',{count:'exact'}).eq('user_id',owner).limit(1001);
        const section=kind==='likes'?'INVENTORY_LIKES':'INVENTORY_PASSES';
        const data=diagnosticRows(r,section);
        if(!Number.isInteger(r.count))throw new PreflightDiagnostic(section+'_COUNT_UNAVAILABLE');
        if(r.count>1000)throw new PreflightDiagnostic(section+'_LIMIT');
        if(data.length!==r.count)throw new PreflightDiagnostic(section+'_TRUNCATED');
        result[kind]=data;
      }return result;
    },
    catalog:async()=>{
      let columns='id,provider,external_id,title,brand,price,currency,image_url,images,product_url,category,affiliate_url,colors,sizes,created_at';
      const candidates=[],seen=new Set();
      const summary={pages:0,scanned:0,usable:0,rejected_shape:0,rejected_price:0,rejected_image:0,rejected_category:0,rejected_provider:0,complete:false,limitReached:false};
      let offset=0;
      for(let page=0;page<MAX_CATALOG_PAGES;page++) {
        const query=()=>client.from('products').select(columns,{count:'exact'}).order('id').range(offset,offset+CATALOG_PAGE_SIZE-1);
        let r=await query();
        if(r.error && /column .*images.* does not exist/i.test(r.error.message) && columns.includes(',images')) {
          columns=columns.replace(',images','');r=await query();
        }
        const data=diagnosticRows(r,'CATALOG');
        if(!Number.isInteger(r.count) || r.count<0)throw new PreflightDiagnostic('CATALOG_COUNT_UNAVAILABLE');
        if(data.length>CATALOG_PAGE_SIZE)throw new PreflightDiagnostic('CATALOG_INVALID_RESPONSE');
        summary.pages++;summary.scanned+=data.length;
        for(const row of data) {
          const result=catalogFixture(row);
          if(result.reason)summary['rejected_'+result.reason]++;
          else if(!seen.has(result.product.id)){seen.add(result.product.id);candidates.push(result.product);summary.usable++;}
        }
        offset+=data.length;
        if(offset>=r.count){summary.complete=true;break;}
        if(data.length===0)throw new PreflightDiagnostic('CATALOG_TRUNCATED');
      }
      summary.limitReached=!summary.complete;
      emit('CATALOG_ELIGIBILITY '+JSON.stringify(summary));
      return candidates;
    },
    read:async(kind,product)=>{
      const r=await scope(client.from(table(kind)).select(selection(kind)),owner,product);
      diagnosticRows(r,kind==='likes'?'FIXTURE_LIKES':'FIXTURE_PASSES');return r;
    },
    insert:(kind,id,product)=>client.from(table(kind)).insert(payload(kind,id,product)).select(selection(kind)),
    // DO NOTHING on contention: never overwrite an unexpected existing fixture key.
    repeat:(kind,id,product)=>client.from(table(kind)).upsert(payload(kind,id,product),
      {onConflict:'user_id,product_id',ignoreDuplicates:true}).select(selection(kind)),
    remove:(kind,product,id)=>scope(client.from(table(kind)).delete(),owner,product).eq('id',id).select('id'),
    foreignRead:(kind,product,id)=>scope(client.from(table(kind)).select(selection(kind)),otherOwner,product).eq('id',id),
    foreignUpdate:(kind,product,id)=>scope(client.from(table(kind)).update(kind==='likes'?{notify_on_price_drop:false}:{passed_at:'2000-01-01T00:00:00Z'}),otherOwner,product).eq('id',id).select('id'),
    foreignRemove:(kind,product,id)=>scope(client.from(table(kind)).delete(),otherOwner,product).eq('id',id).select('id'),
    readError:()=>client.from('liked_products').select('id').eq('user_id',owner).eq('id','not-a-uuid').limit(0),
    cleanup:async(owned,product)=>{
      const settled=await Promise.allSettled(['likes','passes'].map(async kind=>rows(await scope(client.from(table(kind)).delete(),owner,product).in('id',owned[kind]).select('id'))));
      assert(settled.every(r=>r.status==='fulfilled'));
    },
  };
}
async function main() {
  let diagnostic='PF_CONFIG';
  try {
  const env=config(process.env);diagnostic='PF_CLIENT_SETUP';
  const {createClient}=require('@supabase/supabase-js'),clients=[];
  for(const letter of ['A','B']) {
    const jwt=env[`WARDROBE_USER_${letter}_JWT`];
    const client=createClient(STAGING,env.WARDROBE_STAGING_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      global:{headers:{Authorization:`Bearer ${jwt}`},fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(20000)})}});
    diagnostic=letter==='A'?'PF_AUTH_A':'PF_AUTH_B';
    const auth=await client.auth.getUser(jwt);assert(!auth.error && auth.data.user?.id===env[`WARDROBE_USER_${letter}_ID`]);
    diagnostic=letter==='A'?'PF_PROFILE_A':'PF_PROFILE_B';
    assert(diagnosticRows(await client.from('users').select('id').eq('id',auth.data.user.id),'PROFILE').length===1);clients.push(client);
  }
  const a=env.WARDROBE_USER_A_ID,b=env.WARDROBE_USER_B_ID;
  diagnostic='PF_RUN_SETUP';
  const emit=line=>process.stdout.write(line+'\n');
  const result=await runCases(port(clients[0],a,b,emit),port(clients[1],b,a,emit),emit,
    {preflightOnly:process.argv.includes('--preflight-only')});
  process.stdout.write('STATUS '+result.status+'\n');
  process.exitCode=['PASS','PREFLIGHT_PASS'].includes(result.status)?0:1;
  } catch(error) {
    process.stdout.write('BLOCKED PREFLIGHT '+diagnostic+(error instanceof PreflightDiagnostic?' '+error.code:'')+'\n');
    process.stdout.write('STATUS BLOCKED\n');process.exitCode=1;
  }
}
module.exports={STAGING,config,runCases,port};
if(require.main===module)main().catch(()=>{process.stdout.write('BLOCKED PREFLIGHT\n');process.exitCode=1;});
