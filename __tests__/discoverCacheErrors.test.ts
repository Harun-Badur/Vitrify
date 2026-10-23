import {readCachedFinals} from '../services/discoverRecommendationCacheService';
import {getSupabaseClient} from '../lib/supabase';
jest.mock('../lib/supabase',()=>({getSupabaseClient:jest.fn()}));
const request={anchors:[]} as never;
function client(result:any) {
  const q:any={select:()=>q,eq:()=>q,gt:()=>q,in:()=>q,abortSignal:()=>q,limit:()=>Promise.resolve(result)};
  jest.mocked(getSupabaseClient).mockReturnValue({from:()=>q} as never);
}
test('optional cache backend error is reported while local recomputation remains possible',async()=>{
  client({data:null,error:{message:'private detail'}});const warn=jest.fn();
  expect(await readCachedFinals(request,null,new AbortController().signal,warn)).toEqual([]);
  expect(warn).toHaveBeenCalledTimes(1);expect(warn).toHaveBeenCalledWith();
});
test('valid empty cache is a normal miss, not an error',async()=>{
  client({data:[],error:null});const warn=jest.fn();
  expect(await readCachedFinals(request,null,new AbortController().signal,warn)).toEqual([]);
  expect(warn).not.toHaveBeenCalled();
});
