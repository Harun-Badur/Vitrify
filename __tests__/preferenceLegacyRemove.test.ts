import AsyncStorage from '@react-native-async-storage/async-storage';
import { applyPreferenceTransaction } from '../services/preferenceTransactionAdapter';
import { createAnalyticsAction } from '../lib/analyticsAction';
import { readPreferenceRequest } from '../lib/preferenceRequestJournal';
jest.mock('../lib/analytics',()=>({getAnalyticsSessionId:()=> '20000000-0000-4000-8000-000000000001'}));
jest.mock('../lib/recsConfig',()=>({invalidateStyleProfileSnapshot:jest.fn()}));
const owner='00000000-0000-4000-8000-000000000001', rowId='30000000-0000-4000-8000-000000000001';
function backend(){
 const calls:Array<{name:string,args:Record<string,unknown>}>=[];let unknown=false;let committedRow:Record<string,unknown>|null=null;
 const client={auth:{getSession:async()=>({data:{session:{user:{id:owner},access_token:'synthetic'}},error:null}),getUser:async()=>({data:{user:{id:owner}},error:null})},
 from:(table:string)=>{const q={select:()=>q,eq:()=>q,order:()=>q,range:()=>q,setHeader:()=>q,
 maybeSingle:async()=>({data:table==='liked_products'?{id:rowId,user_id:owner,product_id:'fixture'}:table==='style_preference_actions'?committedRow:null,error:null}),
 then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:[],error:null}).then(resolve)};return q;},
 rpc:(name:string,args:Record<string,unknown>)=>{calls.push({name,args});const q={setHeader:()=>q,then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:unknown?null:{action_id:args.p_action,replayed:false},error:unknown?{code:'NETWORK_UNKNOWN'}:null}).then(resolve)};return q;}};
 return {client,calls,unknown:(v:boolean)=>{unknown=v;},committed:(v:Record<string,unknown>)=>{committedRow=v;}};
}
beforeEach(async()=>{await AsyncStorage.clear();});
test('empty ledger plus existing favorite routes explicit row-targeted RPC; no invented favorite action',async()=>{
 const b=backend();const a=createAnalyticsAction(owner,'favorite');
 await applyPreferenceTransaction(b.client as never,owner,'fixture','unlike',a,null);
 expect(b.calls).toEqual([{name:'style_remove_legacy_preference_v2',args:{p_action:a.actionId,p_operation:'unlike',p_product:'fixture',p_session:expect.any(String),p_legacy_row:rowId}}]);
});
test('lost legacy response reconciles an archived committed receipt without resending',async()=>{
 const b=backend();b.unknown(true);
 await expect(applyPreferenceTransaction(b.client as never,owner,'fixture','unlike',createAnalyticsAction(owner,'favorite'),null)).rejects.toThrow();
 const args=b.calls[0].args;
 b.committed({user_id:owner,product_id:'fixture',action_id:args.p_action,kind:'unlike',request:{operation:'unlike',product:'fixture',session:args.p_session,
  expected:[],snapshot:null,legacy_row:rowId,legacy_removed_row:{id:rowId,user_id:owner,product_id:'fixture',product_snapshot:{id:'fixture'}}}});
 const receipt=await applyPreferenceTransaction(b.client as never,owner,'fixture','unlike',createAnalyticsAction(owner,'favorite'),null);
 expect(receipt.replayed).toBe(true);expect(b.calls).toHaveLength(1);expect(await readPreferenceRequest(owner,'fixture')).toBeNull();
});
test('unknown legacy removal keeps exact row target across restart without CRUD fallback',async()=>{
 const b=backend();b.unknown(true);
 await expect(applyPreferenceTransaction(b.client as never,owner,'fixture','unlike',createAnalyticsAction(owner,'favorite'),null)).rejects.toThrow();
 expect(await readPreferenceRequest(owner,'fixture')).toMatchObject({p_legacy_row:rowId});
 b.unknown(false);await applyPreferenceTransaction(b.client as never,owner,'fixture','unlike',createAnalyticsAction(owner,'favorite'),null);
 expect(b.calls[1]).toEqual(b.calls[0]);
});
