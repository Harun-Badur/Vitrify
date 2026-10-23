import { insertLikedProduct, insertPassedProduct, deleteLikedProduct, deletePassedProduct } from '../services/likeService';
import { getRequiredSupabaseClient } from '../lib/supabase';
import { isPreferenceV2Enabled } from '../lib/preferenceFeatureFlags';
import { createAnalyticsAction } from '../lib/analyticsAction';
import { MOCK_PRODUCTS } from '../data/mockProducts';
import AsyncStorage from '@react-native-async-storage/async-storage';
jest.mock('../lib/supabase',()=>({getRequiredSupabaseClient:jest.fn()}));
jest.mock('../lib/preferenceFeatureFlags',()=>({isPreferenceV2Enabled:jest.fn(()=>false)}));
jest.mock('../lib/analytics',()=>({getAnalyticsSessionId:()=> '20000000-0000-4000-8000-000000000001'}));
jest.mock('../lib/logger',()=>({logger:{debug:jest.fn(),warn:jest.fn(),error:jest.fn()}}));
const id='10000000-0000-4000-8000-000000000001';
const owner='00000000-0000-4000-8000-000000000001';
const p={...MOCK_PRODUCTS[0]};
function backend() {
  let current=owner;let error: {code:string}|null=null;
  let rows:unknown[]=[{user_id:owner,product_id:p.id,action_id:id,kind:'favorite',revokes:[]}];
  const writes:string[]=[];const rpcs:Array<Record<string,unknown>>=[];let pinned=0;
  let replayed=false;
  const client={auth:{getUser:async()=>({data:{user:{id:current}},error:null}),
    getSession:async()=>({data:{session:{user:{id:current},access_token:'synthetic-token'}},error:null})},
    rpc:(_name:string,args:Record<string,unknown>)=>{
      rpcs.push(args);const q={setHeader:(_key:string,_value:string)=>{pinned++;return q;},
        then:(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown)=>Promise.resolve({data:{action_id:args.p_action,replayed},error}).then(resolve,reject)};return q;
    },
    from:(table:string)=>{
      const q={select:(_columns:string)=>q,eq:(_key:string,_value:string)=>q,order:(_key:string,_options:unknown)=>q,
        setHeader:(_key:string,_value:string)=>{pinned++;return q;},range:(_start:number,_end:number)=>q,
        maybeSingle:async()=>({data:null,error:null}),
        upsert:async(_value:unknown,_options:unknown)=>{writes.push(table+':upsert');return {error:null};},
        delete:()=>{writes.push(table+':delete');return q;},
        then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:table==='style_preference_actions'?rows:[],error:null}).then(resolve)};return q;
    }};
  jest.mocked(getRequiredSupabaseClient).mockReturnValue(client as never);
  return {writes,rpcs,pinned:()=>pinned,rows:(value:unknown[])=>{rows=value;},owner:(value:string)=>{current=value;},error:(value:{code:string}|null)=>{error=value;},replay:()=>{replayed=true;}};
}
beforeEach(async()=>{jest.clearAllMocks();await AsyncStorage.clear();jest.mocked(isPreferenceV2Enabled).mockReturnValue(false);});
test('disabled v2 preserves direct like plus pass cleanup and never calls RPC',async()=>{
  const b=backend();await insertLikedProduct(owner,p);
  expect(b.writes).toEqual(['liked_products:upsert','passed_products:delete']);expect(b.rpcs).toEqual([]);
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
test('enabled v2 uses one transactional favorite RPC, bound authorization, no direct write',async()=>{
  jest.mocked(isPreferenceV2Enabled).mockReturnValue(true);const b=backend();
  const action=createAnalyticsAction(owner,'favorite');const result=await insertLikedProduct(owner,p,action);
  expect(b.rpcs).toHaveLength(1);expect(b.writes).toEqual([]);expect(b.pinned()).toBeGreaterThan(0);
  expect(b.rpcs[0]).toMatchObject({p_action:action.actionId,p_operation:'favorite',p_product:p.id});
  expect(result).toMatchObject({mode:'v2',serverEvents:true,actionId:action.actionId});
});
test('same action retry reuses frozen body and returns replay instead of another client pair',async()=>{
  jest.mocked(isPreferenceV2Enabled).mockReturnValue(true);const b=backend();const action=createAnalyticsAction(owner,'favorite');
  b.error({code:'NETWORK_UNKNOWN'});await expect(insertLikedProduct(owner,p,action)).rejects.toThrow();
  b.error(null);b.replay();const result=await insertLikedProduct(owner,{...p,title:'Changed metadata'},action);
  expect(b.rpcs[1]).toEqual(b.rpcs[0]);expect(result).toMatchObject({replayed:true,serverEvents:true});expect(b.writes).toEqual([]);
});
test('RPC missing/failure never falls back to legacy writes',async()=>{
  jest.mocked(isPreferenceV2Enabled).mockReturnValue(true);const b=backend();b.error({code:'PGRST202'});
  await expect(insertPassedProduct(owner,p)).rejects.toMatchObject({code:'RPC_REJECTED'});
  expect(b.writes).toEqual([]);
});
test('unlike reads exact active targets after restart rather than deriving them from timestamp/product',async()=>{
  jest.mocked(isPreferenceV2Enabled).mockReturnValue(true);const b=backend();
  await deleteLikedProduct(owner,p.id);
  expect(b.rpcs[0]).toMatchObject({p_operation:'unlike',p_expected:[id]});expect(b.writes).toEqual([]);
});
test('cancel replay keeps original targets even after a new like appears',async()=>{
  jest.mocked(isPreferenceV2Enabled).mockReturnValue(true);const b=backend();const action=createAnalyticsAction(owner,'favorite');
  await deleteLikedProduct(owner,p.id,action);b.rows([{user_id:owner,product_id:p.id,action_id:'10000000-0000-4000-8000-000000000099',kind:'favorite',revokes:[]}]);b.replay();
  await deleteLikedProduct(owner,p.id,action);expect(b.rpcs[1]).toEqual(b.rpcs[0]);
});
test('pass undo filters actual cancelled ledger entries',async()=>{
  jest.mocked(isPreferenceV2Enabled).mockReturnValue(true);const b=backend();
  b.rows([{user_id:owner,product_id:p.id,action_id:id,kind:'pass',revokes:[]},
    {user_id:owner,product_id:p.id,action_id:'10000000-0000-4000-8000-000000000002',kind:'undo_pass',revokes:[id]}]);
  await deletePassedProduct(owner,p.id);expect(b.rpcs[0].p_expected).toEqual([]);
});
test('legacy target rejection keeps data, never invokes legacy delete',async()=>{
  jest.mocked(isPreferenceV2Enabled).mockReturnValue(true);const b=backend();b.rows([]);b.error({code:'22023'});
  await expect(deleteLikedProduct(owner,p.id)).rejects.toThrow();expect(b.writes).toEqual([]);
});
test('wrong owner or product in ledger fails closed before RPC',async()=>{
  jest.mocked(isPreferenceV2Enabled).mockReturnValue(true);const b=backend();b.rows([{user_id:'B',product_id:p.id,action_id:id,kind:'favorite',revokes:[]}]);
  await expect(deleteLikedProduct(owner,p.id)).rejects.toMatchObject({code:'LEDGER_INVALID'});expect(b.rpcs).toEqual([]);
});
test('account change blocks old owner action before any RPC',async()=>{
  jest.mocked(isPreferenceV2Enabled).mockReturnValue(true);const b=backend();b.owner('B');
  await expect(insertLikedProduct(owner,p)).rejects.toThrow();expect(b.rpcs).toEqual([]);expect(b.writes).toEqual([]);
});
test('different product cannot reuse the same action identity',async()=>{
  jest.mocked(isPreferenceV2Enabled).mockReturnValue(true);const b=backend();const action=createAnalyticsAction(owner,'favorite');
  await insertLikedProduct(owner,p,action);
  await expect(insertLikedProduct(owner,{...p,id:'other'},action)).rejects.toMatchObject({code:'ACTION_MISMATCH'});expect(b.rpcs).toHaveLength(1);
});
