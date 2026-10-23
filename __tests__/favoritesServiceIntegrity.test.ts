import {fetchLikedProducts,insertLikedProduct,deleteLikedProduct} from '../services/likeService';
import {getRequiredSupabaseClient} from '../lib/supabase';
import {MOCK_PRODUCTS} from '../data/mockProducts';
jest.mock('../lib/supabase',()=>({getRequiredSupabaseClient:jest.fn()}));
jest.mock('../lib/logger',()=>({logger:{debug:jest.fn(),warn:jest.fn(),error:jest.fn()}}));
const p=MOCK_PRODUCTS[0];
const row={id:p.id,provider:'defacto',external_id:'1',title:'Live title',brand:'Live brand',price:140,currency:'TRY',
  image_url:'https://example.invalid/live.jpg',product_url:'https://example.invalid/product',affiliate_url:null,category:p.category,
  garment_description:'Live garment',images:['https://example.invalid/live.jpg'],created_at:'2026-01-01'};
function setup(options:any={}) {
  const calls:any[]=[];
  let catalogCalls=0;
  const client={auth:{getUser:async()=>({data:{user:{id:options.owner??'alice'}},error:null})},from:(table:string)=>{
    const filters:any[]=[];const q:any={
      select:()=>q,eq:(key:string,value:string)=>{filters.push([key,value]);return q;},
      in:()=>Promise.resolve({data:options.catalog??[row],error:options.legacyImages && catalogCalls++ === 0 ? {message:'column products.images does not exist'} : options.catalogError??null}),
      order:async()=>{if(options.readGate)await options.readGate;return {data:options.likes??[{product_id:p.id,product_snapshot:p,liked_at:'2026-01-01'}],error:null};},
      delete:()=>{calls.push([table,'delete',filters]);return q;},
      upsert:async(v:any)=>{calls.push([table,'upsert',v]);if(options.gate)await options.gate;return {error:null};},
      then:(resolve:any)=>Promise.resolve({data:[],error:table==='passed_products'?options.passError??null:null}).then(resolve),
    };return q;
  }};jest.mocked(getRequiredSupabaseClient).mockReturnValue(client as never);return calls;
}
test('missing snapshot is recovered from authoritative catalog; stale fields refresh',async()=>{
  setup({likes:[{product_id:p.id,product_snapshot:{},liked_at:'2026-01-01'}]});
  const liked=await fetchLikedProducts('alice');expect(liked).toHaveLength(1);
  expect(liked[0].product).toMatchObject({id:p.id,title:'Live title',brand:'Live brand',price:140,imageUrl:row.image_url});
});
test('catalog read error or unresolvable snapshot does not produce fake empty success',async()=>{
  setup({catalogError:{message:'private'}});await expect(fetchLikedProducts('alice')).rejects.toThrow();
  setup({catalog:[],likes:[{product_id:p.id,product_snapshot:{},liked_at:'2026-01-01'}]});
  await expect(fetchLikedProducts('alice')).rejects.toThrow();
});
test('missing catalog with valid saved snapshot is retained with explicit warning',async()=>{
  setup({catalog:[]});const liked=await fetchLikedProducts('alice');expect(liked).toHaveLength(1);
  expect((liked as any).warning).toBe('METADATA_SNAPSHOT_ONLY');
});
test('wrong session cannot read or delete another owner',async()=>{
  const calls=setup({owner:'bob'});await expect(fetchLikedProducts('alice')).rejects.toThrow();
  await expect(deleteLikedProduct('alice',p.id)).rejects.toThrow();expect(calls).toEqual([]);
});
test('delete waits for queued like; scopes by owner and product',async()=>{
  let release!:()=>void;const calls=setup({gate:new Promise<void>(r=>{release=r;})});
  const adding=insertLikedProduct('alice',p),removing=deleteLikedProduct('alice',p.id);
  for(let i=0;i<10;i++)await Promise.resolve();expect(calls).toHaveLength(1);
  release();await Promise.all([adding,removing]);
  expect(calls[2]).toEqual(['liked_products','delete',[['user_id','alice'],['product_id',p.id]]]);
});
test('like committed but pass cleanup failed is explicitly represented',async()=>{
  setup({passError:{message:'private'}});
  await expect(insertLikedProduct('alice',p)).rejects.toMatchObject({likeCommitted:true});
});
test('a write during read rejects the stale result, including the existing hydration caller',async()=>{
  let release!:()=>void;setup({readGate:new Promise<void>(r=>{release=r;})});
  const read=fetchLikedProducts('alice');for(let i=0;i<10;i++)await Promise.resolve();
  await insertLikedProduct('alice',p);release();await expect(read).rejects.toThrow();
});
test('legacy missing optional images column retries without losing the favorite',async()=>{
  setup({legacyImages:true});const liked=await fetchLikedProducts('alice');expect(liked).toHaveLength(1);
});
