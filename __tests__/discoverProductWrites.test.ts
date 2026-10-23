import {deletePassedProduct,insertPassedProduct,insertLikedProduct} from '../services/likeService';
import {getRequiredSupabaseClient} from '../lib/supabase';
import {MOCK_PRODUCTS} from '../data/mockProducts';
jest.mock('../lib/supabase',()=>({getRequiredSupabaseClient:jest.fn()}));
jest.mock('../lib/logger',()=>({logger:{debug:jest.fn(),warn:jest.fn(),error:jest.fn()}}));
const p=MOCK_PRODUCTS[0];
function backend() {
  let active='alice'; const calls:any[]=[];let gate:Promise<void>|null=null;
  const client={auth:{getUser:async()=>({data:{user:{id:active}},error:null})},from:(table:string)=>({
    upsert:async(value:any)=>{calls.push([table,'upsert',value.user_id]);if(gate)await gate;return {error:null};},
    delete:()=>{const filters:any[]=[];const q:any={eq:(k:string,v:string)=>{filters.push([k,v]);return q;},
      then:(resolve:any)=>{calls.push([table,'delete',filters]);return Promise.resolve({error:null}).then(resolve);}};return q;},
  })};
  jest.mocked(getRequiredSupabaseClient).mockReturnValue(client as never);
  return {calls,owner:(v:string)=>{active=v;},hold:(v:Promise<void>|null)=>{gate=v;}};
}
test('pass, undo and like are serialized and delete includes both owner and product filters',async()=>{
  const b=backend();let release!:()=>void;b.hold(new Promise<void>(r=>{release=r;}));
  const pass=insertPassedProduct('alice',p),undo=deletePassedProduct('alice',p.id),like=insertLikedProduct('alice',p);
  for(let i=0;i<8;i++)await Promise.resolve();expect(b.calls).toHaveLength(1);
  b.hold(null);release();await Promise.all([pass,undo,like]);
  expect(b.calls.map(c=>c.slice(0,2))).toEqual([['passed_products','upsert'],['passed_products','delete'],['liked_products','upsert'],['passed_products','delete']]);
  expect(b.calls[1][2]).toEqual([['user_id','alice'],['product_id',p.id]]);
  await deletePassedProduct('alice',p.id); // Repeated absent delete is safe.
});
test('queued old owner request is rejected before writing under a new session',async()=>{
  const b=backend();b.owner('bob');await expect(deletePassedProduct('alice',p.id)).rejects.toThrow();
  expect(b.calls).toEqual([]);
  await deletePassedProduct('bob',p.id);expect(b.calls[0][2][0]).toEqual(['user_id','bob']);
});
