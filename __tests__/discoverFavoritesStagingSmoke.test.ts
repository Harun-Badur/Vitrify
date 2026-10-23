const smoke = require('../scripts/backend/discover-favorites-staging-smoke.cjs');
const jwt=(role:string)=>`x.${Buffer.from(JSON.stringify({role})).toString('base64url')}.x`;
const env={DISCOVER_FAVORITES_STAGING_URL:'https://sdjxseqfkturkfohkfni.supabase.co',
  DISCOVER_FAVORITES_ANON_KEY:jwt('anon'),DISCOVER_FAVORITES_USER_A_JWT:jwt('authenticated'),
  DISCOVER_FAVORITES_USER_B_JWT:jwt('authenticated'),DISCOVER_FAVORITES_USER_A_ID:'a',DISCOVER_FAVORITES_USER_B_ID:'b',
  DISCOVER_FAVORITES_ALLOW_TEST_WRITES:'yes',DISCOVER_FAVORITES_DISPOSABLE_USERS_ONLY:'yes'};
test('reuse staging guards: no production, elevated key, absent approval or same user',()=>{
  expect(()=>smoke.config(env)).not.toThrow();
  for(const changed of [{DISCOVER_FAVORITES_STAGING_URL:'https://production.invalid'},
    {DISCOVER_FAVORITES_ANON_KEY:jwt('service_role')},{DISCOVER_FAVORITES_ALLOW_TEST_WRITES:''},
    {DISCOVER_FAVORITES_USER_B_ID:'a'}])expect(()=>smoke.config({...env,...changed})).toThrow();
});
test('no safe catalog fixture blocks before any write or cleanup',async()=>{
  const writes=jest.fn(),cleanup=jest.fn(),emit=jest.fn();
  const port={schema:async()=>{},inventory:async()=>({likes:[],passes:[]}),catalog:async()=>[],
    insert:writes,cleanup};
  const result=await smoke.runCases(port,port,emit);
  expect(result.status).toBe('BLOCKED');expect(writes).not.toHaveBeenCalled();expect(cleanup).not.toHaveBeenCalled();
});
test('uncertain insert acknowledgement still cleans only generated row IDs and prints no provider details',async()=>{
  const cleanup=jest.fn(),emit=jest.fn();
  const port={schema:async()=>{},inventory:async()=>({likes:[],passes:[]}),
    catalog:async()=>[{id:'catalog',title:'Public product',brand:'Brand',price:1,imageUrl:'https://example.invalid/p',category:'upper_body',garmentDescription:'Product'}],
    read:async()=>({data:[],error:null}),insert:async()=>{throw Error('private JWT user data');},
    cleanup};
  const result=await smoke.runCases(port,port,emit);
  expect(result.status).toBe('FAIL');expect(result.cleanup).toBe(true);
  expect(cleanup).toHaveBeenCalledTimes(1);
  const owned=cleanup.mock.calls[0][0];expect(owned.likes).toHaveLength(3);expect(owned.passes).toHaveLength(2);
  for(const id of [...owned.likes,...owned.passes])expect(id).toMatch(/^[0-9a-f-]{36}$/);
  expect(emit.mock.calls.flat().join(' ')).not.toMatch(/private|JWT|catalog|Public product/);
});
test('cleanup failure makes the result FAIL and is never retried',async()=>{
  const cleanup=jest.fn(async()=>{throw Error('private');});
  const port={schema:async()=>{},inventory:async()=>({likes:[],passes:[]}),
    catalog:async()=>[{id:'p',title:'Product',brand:'Brand',price:1,imageUrl:'https://example.invalid/p',category:'upper_body',garmentDescription:'Product'}],
    read:async()=>({data:[],error:null}),insert:async()=>{throw Error('write');},cleanup};
  const r=await smoke.runCases(port,port,()=>{});expect(r.status).toBe('FAIL');expect(r.cleanup).toBe(false);
  expect(cleanup).toHaveBeenCalledTimes(1);
});
test('occupied fixture blocks instead of adopting or deleting existing rows',async()=>{
  const insert=jest.fn(),cleanup=jest.fn();const port={schema:async()=>{},inventory:async()=>({likes:[],passes:[]}),
    catalog:async()=>[{id:'occupied'}],read:async()=>({data:[{id:'existing'}],error:null}),insert,cleanup};
  expect((await smoke.runCases(port,port,()=>{})).status).toBe('BLOCKED');
  expect(insert).not.toHaveBeenCalled();expect(cleanup).not.toHaveBeenCalled();
});
test('read-only preflight distinguishes schema failure without provider information',async()=>{
  const emit=jest.fn(),insert=jest.fn(),cleanup=jest.fn();
  const a={schema:async()=>{throw Error('private JWT user detail');},insert,cleanup};
  const result=await smoke.runCases(a,a,emit,{preflightOnly:true});
  expect(result.status).toBe('BLOCKED');expect(emit).toHaveBeenCalledWith('BLOCKED PREFLIGHT PF_SCHEMA_A');
  expect(emit.mock.calls.flat().join(' ')).not.toMatch(/private|JWT|user detail/);
  expect(insert).not.toHaveBeenCalled();expect(cleanup).not.toHaveBeenCalled();
});
test('read-only preflight succeeds but never reaches CRUD or cleanup',async()=>{
  const insert=jest.fn(),cleanup=jest.fn(),emit=jest.fn();
  const port={schema:async()=>{},inventory:async()=>({likes:[],passes:[]}),catalog:async()=>[{id:'p'}],
    read:async()=>({data:[],error:null}),insert,cleanup};
  const r=await smoke.runCases(port,port,emit,{preflightOnly:true});
  expect(r).toEqual({status:'PREFLIGHT_PASS',cleanup:false});
  expect(insert).not.toHaveBeenCalled();expect(cleanup).not.toHaveBeenCalled();
});
test('schema and truncated inventory produce fixed codes, not provider payloads',async()=>{
  const q:any={select:()=>q,eq:()=>q,limit:async()=>({data:null,error:{code:'42703',message:'private provider payload'}})};
  const p=smoke.port({from:()=>q},'a','b');
  await expect(p.schema()).rejects.toMatchObject({code:'SCHEMA_LIKES_COLUMN_MISSING'});
  q.limit=async()=>({data:[],count:1,error:null});
  await expect(p.inventory()).rejects.toMatchObject({code:'INVENTORY_LIKES_TRUNCATED'});
});
test('all acceptance steps and cleanup run; JSONB object key order is not treated as metadata loss',async()=>{
  const records:any={likes:[],passes:[]},fixture={id:'p',title:'Product',brand:'Brand',price:1,imageUrl:'https://example.invalid/p',category:'upper_body',garmentDescription:'Product'};
  const clone=(v:any)=>JSON.parse(JSON.stringify(v));const emit=jest.fn();
  const a={schema:async()=>{},inventory:async()=>clone(records),catalog:async()=>[fixture],
    read:async(kind:string)=>({data:clone(records[kind]),error:null}),
    insert:async(kind:string,id:string,p:any)=>{const row={id,product_id:p.id,
      ...(kind==='likes'?{product_snapshot:Object.fromEntries(Object.entries(p).reverse())}:{})};records[kind].push(row);return {data:[clone(row)],error:null};},
    repeat:async()=>({data:[],error:null}),
    remove:async(kind:string,_p:string,id:string)=>{records[kind]=records[kind].filter((r:any)=>r.id!==id);return {data:[],error:null};},
    readError:async()=>({data:null,error:{code:'22P02'}}),
    cleanup:async(ids:any)=>{for(const kind of ['likes','passes'])records[kind]=records[kind].filter((r:any)=>!ids[kind].includes(r.id));},
  };
  const b={schema:async()=>{},inventory:async()=>({likes:[],passes:[]}),read:async()=>({data:[],error:null}),
    foreignRead:async()=>({data:[],error:null}),foreignUpdate:async()=>({data:[],error:null}),foreignRemove:async()=>({data:[],error:null})};
  const result=await smoke.runCases(a,b,emit);expect(result).toEqual({status:'PASS',cleanup:true});
  expect(emit).toHaveBeenCalledWith('PASS RLS_ISOLATION');expect(emit).toHaveBeenCalledWith('PASS EMPTY_VS_SQL_ERROR');
});
