import AsyncStorage from '@react-native-async-storage/async-storage';
import type {PreferenceRpcArguments} from '../types/preferenceTransaction';
import {isProductSnapshot} from '../types/product';

export class PreferenceJournalError extends Error {
  constructor(){super('PREFERENCE_JOURNAL_UNAVAILABLE');}
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const key=(owner:string,product:string)=>'vitrify.preference-request.v2:'+JSON.stringify([owner,product]);
/** Key identity is sufficient for account cleanup, even if the request body is corrupt.
 * Unknown key ownership blocks cleanup; never infer it from a string prefix match.
 */
export async function preferenceRequestStorageKeys(owner:string):Promise<string[]> {
  const result:string[]=[];
  for(const entry of await AsyncStorage.getAllKeys()) {
    if(!entry.startsWith('vitrify.preference-request.v2:'))continue;
    let pair:unknown;
    try { pair=JSON.parse(entry.slice('vitrify.preference-request.v2:'.length)); } catch { throw new PreferenceJournalError(); }
    if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||!pair[0]||typeof pair[1]!=='string'||!pair[1])throw new PreferenceJournalError();
    if(pair[0]===owner)result.push(entry);
  }
  return result;
}
export async function listPreferenceRequests(owner:string):Promise<PreferenceRpcArguments[]> {
  try {
    const keys=await AsyncStorage.getAllKeys();const result:PreferenceRpcArguments[]=[];
    for(const entry of keys) {
      if(!entry.startsWith('vitrify.preference-request.v2:'))continue;
      const pair:unknown=JSON.parse(entry.slice('vitrify.preference-request.v2:'.length));
      if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||typeof pair[1]!=='string')throw new PreferenceJournalError();
      if(pair[0]!==owner)continue;
      if(result.length>=100)throw new PreferenceJournalError(); // Keep data, fail closed.
      const args=await readPreferenceRequest(owner,pair[1]);if(args)result.push(args);
    }
    return result;
  }catch{throw new PreferenceJournalError();}
}
// Contains only an owner-bound request, never JWT/session token/email. No automatic
// background sends, expiry or loss-inducing purge. Only used by the opt-in writer.
export async function readPreferenceRequest(owner:string,product:string):Promise<PreferenceRpcArguments|null> {
  try {
    const raw=await AsyncStorage.getItem(key(owner,product));if(raw===null)return null;
    const envelope:unknown=JSON.parse(raw);
    if(!object(envelope)||envelope.version!==1||envelope.owner!==owner||!object(envelope.args))throw new PreferenceJournalError();
    const r=envelope.args;
    if(typeof r.p_action!=='string'||!uuid.test(r.p_action)||typeof r.p_session!=='string'||!uuid.test(r.p_session)
      ||r.p_product!==product||!['favorite','pass','unlike','undo_pass'].includes(String(r.p_operation))
      ||!(r.p_expected===null||(Array.isArray(r.p_expected)&&r.p_expected.every(id=>typeof id==='string'&&uuid.test(id))))
      ||!(r.p_snapshot===null||(isProductSnapshot(r.p_snapshot)&&r.p_snapshot.id===product)))throw new PreferenceJournalError();
    if(r.p_operation==='favorite'&&r.p_snapshot===null)throw new PreferenceJournalError();
    if(['unlike','undo_pass'].includes(String(r.p_operation))&&r.p_expected===null)throw new PreferenceJournalError();
    if(r.p_legacy_row!==undefined && (typeof r.p_legacy_row!=='string'||!uuid.test(r.p_legacy_row)
      ||!['unlike','undo_pass'].includes(String(r.p_operation))||!Array.isArray(r.p_expected)||r.p_expected.length!==0||r.p_snapshot!==null))throw new PreferenceJournalError();
    // The guard checks every field against the exported RPC contract.
    return {p_action:r.p_action,p_session:r.p_session,p_product:product,
      p_operation:r.p_operation as PreferenceRpcArguments['p_operation'],
      p_expected:r.p_expected as string[]|null,p_snapshot:r.p_snapshot as PreferenceRpcArguments['p_snapshot'],
      ...(typeof r.p_legacy_row==='string'?{p_legacy_row:r.p_legacy_row}:{})};
  }catch{throw new PreferenceJournalError();}
}
export async function savePreferenceRequest(owner:string,args:PreferenceRpcArguments):Promise<PreferenceRpcArguments>{
  try {
    const serialized=JSON.stringify({version:1,owner,args});
    await AsyncStorage.setItem(key(owner,args.p_product),serialized);
    if(await AsyncStorage.getItem(key(owner,args.p_product))!==serialized)throw new PreferenceJournalError();
    const saved=await readPreferenceRequest(owner,args.p_product);
    if(!saved)throw new PreferenceJournalError();return saved;
  }catch{throw new PreferenceJournalError();}
}
export async function clearPreferenceRequest(owner:string,product:string):Promise<void>{
  try{await AsyncStorage.removeItem(key(owner,product));}catch{throw new PreferenceJournalError();}
}
