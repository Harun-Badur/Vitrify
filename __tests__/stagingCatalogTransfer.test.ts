import {stagingImportTarget,validateStagingCatalog,importFeed} from '../scripts/importFeed';
import {createClient} from '@supabase/supabase-js';
import {readFileSync} from 'node:fs';
import {parse} from 'csv-parse/sync';
jest.mock('dotenv',()=>({config:jest.fn()}));
jest.mock('@supabase/supabase-js',()=>({createClient:jest.fn()}));
afterEach(()=>jest.restoreAllMocks());
test('staging-only mode rejects wrong project and unapproved write, dry-run needs no key',()=>{
  expect(()=>stagingImportTarget({CATALOG_STAGING_URL:'https://production.invalid'},true)).toThrow();
  expect(()=>stagingImportTarget({CATALOG_STAGING_URL:'https://sdjxseqfkturkfohkfni.supabase.co'},false)).toThrow();
  expect(stagingImportTarget({CATALOG_STAGING_URL:'https://sdjxseqfkturkfohkfni.supabase.co'},true).url)
    .toBe('https://sdjxseqfkturkfohkfni.supabase.co');
});
test('local dry-run reads approved CSV without constructing a network client',async()=>{
  jest.mocked(createClient).mockClear();jest.spyOn(console,'log').mockImplementation(()=>{});
  jest.replaceProperty(process,'argv',['node','importFeed.ts','--staging-insert-only','--dry-run','reports/backend/staging-catalog-20-20261012.csv']);
  jest.replaceProperty(process,'env',{NODE_ENV:'test',CATALOG_STAGING_URL:'https://sdjxseqfkturkfohkfni.supabase.co'});
  await importFeed();expect(createClient).not.toHaveBeenCalled();
});
test('one atomic products batch skips existing rows and repeats without overwriting; no other table is accessed',async()=>{
  jest.spyOn(console,'log').mockImplementation(()=>{});
  const selected=JSON.parse(readFileSync('reports/backend/staging-catalog-20-20261012.json','utf8'));
  const initial={...selected[0],title:'Existing record must stay'};
  const db=new Map([[initial.provider+'|'+initial.external_id,initial]]);
  const from=jest.fn((table:string)=>{expect(table).toBe('products');return {upsert:(rows:any[],opts:any)=>{
    expect(opts).toEqual({onConflict:'provider,external_id',ignoreDuplicates:true});const inserted:any[]=[];
    for(const row of rows){const key=row.provider+'|'+row.external_id;if(!db.has(key)){db.set(key,row);inserted.push({id:row.id});}}
    return {select:async()=>({data:inserted,error:null})};
  }};});
  jest.mocked(createClient).mockReturnValue({from} as never);
  jest.replaceProperty(process,'argv',['node','importFeed.ts','--staging-insert-only','reports/backend/staging-catalog-20-20261012.csv']);
  jest.replaceProperty(process,'env',{NODE_ENV:'test',CATALOG_STAGING_URL:'https://sdjxseqfkturkfohkfni.supabase.co',CATALOG_STAGING_ADMIN_KEY:'fake-only',CATALOG_STAGING_ALLOW_INSERT:'yes'});
  await importFeed();await importFeed();expect(db.size).toBe(20);expect(db.get(initial.provider+'|'+initial.external_id)).toEqual(initial);
  expect(from).toHaveBeenCalledTimes(2);
});
test('the proposed 20 rows are exact existing approved products with distinct identities and real images',()=>{
  const source=JSON.parse(readFileSync('reports/catalog-expansion-v1/phase7.4-payload.json','utf8'));
  const selected=JSON.parse(readFileSync('reports/backend/staging-catalog-20-20261012.json','utf8'));
  expect(selected).toHaveLength(20);
  for(const p of selected)expect(source.some((r:any)=>JSON.stringify(r.product)===JSON.stringify(p))).toBe(true);
  const csv=parse(readFileSync('reports/backend/staging-catalog-20-20261012.csv','utf8'),{columns:true});
  const rows=csv.map((r:any)=>({...r,id:r.provider+'-'+r.external_id,price:Number(r.price)}));
  expect(()=>validateStagingCatalog(rows)).not.toThrow();
  expect(()=>validateStagingCatalog([...rows.slice(0,19),rows[0]])).toThrow();
  expect(()=>validateStagingCatalog(rows.map((r:any,i:number)=>i===0?{...r,image_url:'https://images.unsplash.com/fake.jpg'}:r))).toThrow();
});
