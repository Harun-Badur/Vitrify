import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnalyticsActionContext } from '../types/analytics';
import type { Product } from '../types/product';
import type { PreferenceOperation, PreferenceRpcArguments, PreferenceWriteReceipt } from '../types/preferenceTransaction';
import { getAnalyticsSessionId } from '../lib/analytics';
import { invalidateStyleProfileSnapshot } from '../lib/recsConfig';
import {readPreferenceRequest,savePreferenceRequest,clearPreferenceRequest,PreferenceJournalError} from '../lib/preferenceRequestJournal';

export class PreferenceTransactionError extends Error {
  constructor(public readonly code: 'OWNER_MISMATCH' | 'ACTION_MISMATCH' | 'LEDGER_INVALID' | 'LEDGER_LIMIT' | 'RPC_REJECTED' | 'RESULT_UNVERIFIED' | 'PENDING_CONFLICT' | 'JOURNAL_UNAVAILABLE') {
    super(code === 'RESULT_UNVERIFIED' || code === 'PENDING_CONFLICT'
      ? 'İşlem sonucu doğrulanamadı. Aynı eylem kimliğiyle tekrar doğrulamak gerekiyor.'
      : 'Tercih işlemi tamamlanamadı. Kayıtlar korunuyor; oturumu ve bağlantıyı kontrol et.');
    this.name='PreferenceTransactionError';
  }
}
export const isPreferenceOutcomeUnknown=(error:unknown):boolean=>error instanceof PreferenceTransactionError&&
  ['RESULT_UNVERIFIED','PENDING_CONFLICT','LEDGER_INVALID','JOURNAL_UNAVAILABLE'].includes(error.code);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value && typeof value==='object' && !Array.isArray(value));
type Row={action_id:string;kind:string;revokes:string[]};
const prepared=new WeakMap<AnalyticsActionContext,{owner:string;product:string;operation:PreferenceOperation;args:Promise<PreferenceRpcArguments>}>();

async function actorToken(client:SupabaseClient,owner:string):Promise<string> {
  const session=await client.auth.getSession();
  if(session.error||session.data.session?.user.id!==owner||!session.data.session.access_token) throw new PreferenceTransactionError('OWNER_MISMATCH');
  const token=session.data.session.access_token;
  const verified=await client.auth.getUser(token);
  if(verified.error||verified.data.user?.id!==owner) throw new PreferenceTransactionError('OWNER_MISMATCH');
  return token; // Ephemeral only; never stored in the request memo, response or logs.
}
async function exactTargets(client:SupabaseClient,token:string,owner:string,product:string,operation:PreferenceOperation):Promise<string[]> {
  const rows=new Map<string,Row>();
  for(let page=0;page<20;page++) {
    const result=await client.from('style_preference_actions').select('user_id,product_id,action_id,kind,revokes')
      .eq('user_id',owner).eq('product_id',product).order('action_id',{ascending:true})
      .range(page*500,page*500+499).setHeader('Authorization',`Bearer ${token}`);
    if(result.error||!Array.isArray(result.data)) throw new PreferenceTransactionError('LEDGER_INVALID');
    for(const raw of result.data as unknown[]) {
      if(!record(raw)||raw.user_id!==owner||raw.product_id!==product||typeof raw.action_id!=='string'||!uuid.test(raw.action_id)
        ||typeof raw.kind!=='string'||!['favorite','pass','unlike','undo_pass','wardrobe','wardrobe_remove'].includes(raw.kind)
        ||!Array.isArray(raw.revokes)||!raw.revokes.every(id=>typeof id==='string'&&uuid.test(id))) throw new PreferenceTransactionError('LEDGER_INVALID');
      const row:Row={action_id:raw.action_id,kind:raw.kind,revokes:raw.revokes};
      const previous=rows.get(row.action_id);
      if(previous&&JSON.stringify(previous)!==JSON.stringify(row)) throw new PreferenceTransactionError('LEDGER_INVALID');
      rows.set(row.action_id,row);
    }
    if(result.data.length<500) {
      const revoked=new Set<string>();
      for(const row of rows.values()) for(const target of row.revokes) {
        const expected=row.kind==='favorite'||row.kind==='undo_pass'?'pass':row.kind==='unlike'?'favorite':row.kind==='wardrobe_remove'?'wardrobe':null;
        if(!expected||rows.get(target)?.kind!==expected||target===row.action_id) throw new PreferenceTransactionError('LEDGER_INVALID');
        revoked.add(target);
      }
      const kind=operation==='unlike'?'favorite':'pass';
      return [...rows.values()].filter(row=>row.kind===kind&&!revoked.has(row.action_id)).map(row=>row.action_id).sort();
    }
  }
  throw new PreferenceTransactionError('LEDGER_LIMIT'); // Never silently use a partial target set.
}
function copySnapshot(product:Product|null):Product|null {
  return product ? {...product,images:product.images?.slice(),colors:product.colors?.map(color=>({...color})),
    sizes:product.sizes?.slice(),colorSlugs:product.colorSlugs?.slice()}:null;
}
function stableJson(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(stableJson).join(',')+']';
  if(record(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stableJson(value[key])).join(',')+'}';
  return JSON.stringify(value)??'null';
}
async function committedRequest(client:SupabaseClient,token:string,owner:string,args:PreferenceRpcArguments):Promise<boolean>{
  const result=await client.from('style_preference_actions').select('user_id,product_id,action_id,kind,request')
    .eq('user_id',owner).eq('action_id',args.p_action).setHeader('Authorization',`Bearer ${token}`).maybeSingle();
  if(result.error)throw new PreferenceTransactionError('RESULT_UNVERIFIED');
  const row:unknown=result.data;if(row===null)return false;
  const expected={operation:args.p_operation,product:args.p_product,session:args.p_session,
    expected:[...new Set(args.p_expected??[])].sort(),snapshot:args.p_snapshot,
    ...(args.p_legacy_row?{legacy_row:args.p_legacy_row}:{})};
  const request=record(row)&&record(row.request)?{...row.request}:null;
  if(args.p_legacy_row && request) {
    const archived=request.legacy_removed_row;
    if(!record(archived)||archived.id!==args.p_legacy_row||archived.user_id!==owner||archived.product_id!==args.p_product)throw new PreferenceTransactionError('LEDGER_INVALID');
    delete request.legacy_removed_row; // Audit bytes are preserved server-side, not part of request identity.
  }
  if(!record(row)||row.user_id!==owner||row.action_id!==args.p_action||row.product_id!==args.p_product||row.kind!==args.p_operation
    ||stableJson(request)!==stableJson(expected))throw new PreferenceTransactionError('LEDGER_INVALID');
  return true;
}
/** Confirmed same-context replay uses the weak memo. Unresolved requests are
 * persisted before send; fresh callers/processes reuse that exact journal body.
 */
export async function applyPreferenceTransaction(client:SupabaseClient,owner:string,product:string,
  operation:PreferenceOperation,action:AnalyticsActionContext,snapshot:Product|null):Promise<PreferenceWriteReceipt> {
  try {
    if(action.userId!==owner||action.origin!==(['favorite','unlike'].includes(operation)?'favorite':'pass')) throw new PreferenceTransactionError('ACTION_MISMATCH');
    const token=await actorToken(client,owner);
    const pending=await readPreferenceRequest(owner,product);
    if(pending&&pending.p_operation!==operation)throw new PreferenceTransactionError('PENDING_CONFLICT');
    let entry=prepared.get(action);
    if(entry&&(entry.owner!==owner||entry.product!==product||entry.operation!==operation)) throw new PreferenceTransactionError('ACTION_MISMATCH');
    if(!entry) {
      const stableSnapshot=copySnapshot(snapshot);
      const args=pending?Promise.resolve(pending):(async():Promise<PreferenceRpcArguments>=>{
        const expected=['unlike','undo_pass'].includes(operation)?await exactTargets(client,token,owner,product,operation):null;
        let legacyRow:string|undefined;
        if(expected?.length===0) {
          const result=await client.from(operation==='unlike'?'liked_products':'passed_products').select('id,user_id,product_id')
            .eq('user_id',owner).eq('product_id',product).setHeader('Authorization',`Bearer ${token}`).maybeSingle();
          const row:unknown=result.data;
          if(result.error)throw new PreferenceTransactionError('LEDGER_INVALID');
          if(row!==null){if(!record(row)||row.user_id!==owner||row.product_id!==product||typeof row.id!=='string'||!uuid.test(row.id))throw new PreferenceTransactionError('LEDGER_INVALID');legacyRow=row.id;}
        }
        return {p_action:action.actionId,p_operation:operation,p_product:product,p_session:getAnalyticsSessionId(),
          p_snapshot:stableSnapshot,p_expected:expected,...(legacyRow?{p_legacy_row:legacyRow}:{})};
      })();
      entry={owner,product,operation,args};prepared.set(action,entry);
      void args.catch(()=>{if(prepared.get(action)?.args===args) prepared.delete(action);});
    }
    const args=pending??await savePreferenceRequest(owner,await entry.args);
    const receipt=(replayed:boolean):PreferenceWriteReceipt=>{
      invalidateStyleProfileSnapshot(owner); // Only confirmed commit/replay; no new network call.
      return {mode:'v2',actionId:args.p_action,replayed,serverEvents:true};
    };
    if(pending&&await committedRequest(client,token,owner,args)) {
      await clearPreferenceRequest(owner,product);return receipt(true);
    }
    let rejectionCode:string|undefined;
    try {
      const rpcArgs=args.p_legacy_row?{p_action:args.p_action,p_operation:args.p_operation,p_product:args.p_product,p_session:args.p_session,p_legacy_row:args.p_legacy_row}:args;
      const result=await client.rpc(args.p_legacy_row?'style_remove_legacy_preference_v2':'style_apply_preference_v2',rpcArgs).setHeader('Authorization',`Bearer ${token}`);
      if(!result.error) {
        const data:unknown=result.data;
        if(record(data)&&data.action_id===args.p_action&&typeof data.replayed==='boolean') {
          await clearPreferenceRequest(owner,product);return receipt(data.replayed);
        }
      }else rejectionCode=result.error.code;
    }catch{ /* Transport/clear failure can follow commit; verify below. */ }
    if(await committedRequest(client,token,owner,args)) {
      await clearPreferenceRequest(owner,product);return receipt(true);
    }
    // An empty lookup alone cannot disprove an in-flight commit. Keep the exact
    // journal except for explicit PostgreSQL/PostgREST transaction rejection.
    if(rejectionCode&&['22023','42501','40001','23505','23503','PGRST202'].includes(rejectionCode)) {
      await clearPreferenceRequest(owner,product);throw new PreferenceTransactionError('RPC_REJECTED');
    }
    throw new PreferenceTransactionError('RESULT_UNVERIFIED');
  } catch(error) {
    if(error instanceof PreferenceTransactionError) throw error;
    if(error instanceof PreferenceJournalError)throw new PreferenceTransactionError('JOURNAL_UNAVAILABLE');
    throw new PreferenceTransactionError('RESULT_UNVERIFIED'); // No provider/JWT details escape.
  }
}
