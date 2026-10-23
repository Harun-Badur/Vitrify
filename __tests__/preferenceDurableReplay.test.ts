import AsyncStorage from '@react-native-async-storage/async-storage';
import {insertLikedProduct,insertPassedProduct,deleteLikedProduct,fetchLikedProducts} from '../services/likeService';
import {getRequiredSupabaseClient} from '../lib/supabase';
import {MOCK_PRODUCTS} from '../data/mockProducts';
import {createAnalyticsAction} from '../lib/analyticsAction';
import type {applyPreferenceTransaction} from '../services/preferenceTransactionAdapter';
jest.mock('../lib/supabase',()=>({getRequiredSupabaseClient:jest.fn()}));
jest.mock('../lib/preferenceFeatureFlags',()=>({isPreferenceV2Enabled:()=>true}));
jest.mock('../lib/analytics',()=>({getAnalyticsSessionId:()=> '20000000-0000-4000-8000-000000000001'}));
jest.mock('../lib/logger',()=>({logger:{error:jest.fn(),warn:jest.fn(),debug:jest.fn()}}));
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002',product=MOCK_PRODUCTS[0];
function backend() {
  let owner=a,mode:'ok'|'lostCommitted'|'lostUncommitted'='ok',lookupFails=false;
  const ledger=new Map<string,Record<string,unknown>>(),requests:Array<Record<string,unknown>>=[];
  const client={auth:{getUser:async(token?:string)=>({data:{user:{id:token?.replace('test:','')??owner}},error:null}),
    getSession:async()=>({data:{session:{user:{id:owner},access_token:'test:'+owner}},error:null})},
    rpc:(_name:string,args:Record<string,unknown>)=>{requests.push(JSON.parse(JSON.stringify(args)));const actor=owner;
      const q={setHeader:()=>q,then:(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown)=>{
        if(mode!=='lostUncommitted')ledger.set(String(args.p_action),{user_id:actor,action_id:args.p_action,product_id:args.p_product,kind:args.p_operation,revokes:[],request:{operation:args.p_operation,product:args.p_product,session:args.p_session,expected:args.p_expected??[],snapshot:args.p_snapshot}});
        return mode==='ok'?Promise.resolve({data:{action_id:args.p_action,replayed:false},error:null,status:200}).then(resolve,reject):Promise.reject(Error('synthetic transport')).then(resolve,reject);
      }};return q;},
    from:(table:string)=>{const filters=new Map<string,unknown>();const q={select:()=>q,eq:(key:string,value:unknown)=>{filters.set(key,value);return q;},order:()=>q,range:()=>q,setHeader:()=>q,
      maybeSingle:async()=>({data:ledger.get(String(filters.get('action_id')))??null,error:lookupFails?{code:'TEST'}:null}),
      then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:table==='style_preference_actions'?[...ledger.values()].filter(row=>row.user_id===filters.get('user_id')&&row.product_id===filters.get('product_id')):[],error:null}).then(resolve)};return q;}};
  jest.mocked(getRequiredSupabaseClient).mockReturnValue(client as never);
  return {client,requests,ledger,owner:(value:string)=>{owner=value;},mode:(value:typeof mode)=>{mode=value;},lookupFails:(value:boolean)=>{lookupFails=value;}};
}
beforeEach(async()=>{jest.clearAllMocks();await AsyncStorage.clear();});
test('request is durably stored before the RPC can be sent',async()=>{
  const server=backend();jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(Error('disk'));
  await expect(insertLikedProduct(a,product)).rejects.toThrow();expect(server.requests).toEqual([]);
});
test('commit with lost response is verified by exact ledger request and cleared',async()=>{
  const server=backend();server.mode('lostCommitted');
  await expect(insertLikedProduct(a,product)).resolves.toMatchObject({serverEvents:true,replayed:true});
  expect(await AsyncStorage.getAllKeys()).toEqual([]);expect(server.ledger.size).toBe(1);
});
test('no commit stays unknown; next invocation after restart replays identical saved body',async()=>{
  const server=backend();server.mode('lostUncommitted');
  await expect(insertLikedProduct(a,product)).rejects.toMatchObject({code:'RESULT_UNVERIFIED'});
  expect((await AsyncStorage.getAllKeys()).length).toBe(1);
  // New action context and changed catalog data model a fresh process/store caller.
  server.mode('ok');await insertLikedProduct(a,{...product,title:'Changed since restart'});
  expect(server.requests[1]).toEqual(server.requests[0]);expect(server.ledger.size).toBe(1);
  expect(await AsyncStorage.getAllKeys()).toEqual([]);
});
test('A to B to A never replays A journal into B; A request identity survives',async()=>{
  const server=backend();server.mode('lostUncommitted');await expect(insertLikedProduct(a,product)).rejects.toThrow();
  server.owner(b);server.mode('ok');await insertLikedProduct(b,product);
  expect(server.requests[1].p_action).not.toEqual(server.requests[0].p_action);
  server.owner(a);await insertLikedProduct(a,product);expect(server.requests[2]).toEqual(server.requests[0]);
});
test('opposite intent cannot replace an unknown action or its undo target',async()=>{
  const server=backend();server.mode('lostUncommitted');await expect(insertLikedProduct(a,product)).rejects.toThrow();
  await expect(deleteLikedProduct(a,product.id)).rejects.toMatchObject({code:'PENDING_CONFLICT'});expect(server.requests).toHaveLength(1);
});
test('lookup errors and mismatched ledger replies never become confirmed success',async()=>{
  const server=backend();server.mode('lostCommitted');server.lookupFails(true);
  await expect(insertPassedProduct(a,product)).rejects.toMatchObject({code:'RESULT_UNVERIFIED'});
  server.lookupFails(false);const row=[...server.ledger.values()][0];row.product_id='different';
  await expect(insertPassedProduct(a,product)).rejects.toMatchObject({code:'LEDGER_INVALID'});
  expect(server.requests).toHaveLength(1);expect((await AsyncStorage.getAllKeys()).length).toBe(1);
});
test('fresh adapter module with no WeakMap replays the persisted session and snapshot',async()=>{
  const server=backend();server.mode('lostUncommitted');await expect(insertLikedProduct(a,product)).rejects.toThrow();
  let fresh:typeof applyPreferenceTransaction|undefined;
  jest.isolateModules(()=>{
    jest.doMock('@react-native-async-storage/async-storage',()=>AsyncStorage);
    jest.doMock('../lib/analytics',()=>({getAnalyticsSessionId:()=> '20000000-0000-4000-8000-000000000099'}));
    fresh=require('../services/preferenceTransactionAdapter').applyPreferenceTransaction;
  });
  if(!fresh)throw Error('MISSING_FRESH_ADAPTER');
  server.mode('ok');await fresh(server.client as never,a,product.id,'favorite',createAnalyticsAction(a,'favorite'),{...product,title:'New process'});
  expect(server.requests[1]).toEqual(server.requests[0]);expect(await AsyncStorage.getAllKeys()).toEqual([]);
});
test('existing favorites refresh reconciles only the current owner saved requests',async()=>{
  const server=backend();server.mode('lostUncommitted');await expect(insertLikedProduct(a,product)).rejects.toThrow();
  server.owner(b);server.mode('ok');await fetchLikedProducts(b);expect(server.requests).toHaveLength(1);
  server.owner(a);await fetchLikedProducts(a);expect(server.requests[1]).toEqual(server.requests[0]);
  expect(await AsyncStorage.getAllKeys()).toEqual([]);
});
test('invalid persisted request is preserved and blocks new writes',async()=>{
  const server=backend();server.mode('lostUncommitted');await expect(insertLikedProduct(a,product)).rejects.toThrow();
  const keys=await AsyncStorage.getAllKeys();await AsyncStorage.setItem(keys[0],'invalid');server.mode('ok');
  await expect(insertLikedProduct(a,product)).rejects.toMatchObject({code:'JOURNAL_UNAVAILABLE'});
  expect(server.requests).toHaveLength(1);expect(await AsyncStorage.getItem(keys[0])).toBe('invalid');
});
