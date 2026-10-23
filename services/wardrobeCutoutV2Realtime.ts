import { captureOwnerPublication, registerOwnerResource, trackOwnerWork } from '../lib/accountDeviceWork';
/** Untrusted hints only. Caller revalidates current item/version and cloud result. */
export function observeWardrobeV2Hints(owner:string,subscribe:(receive:(row:unknown)=>void)=>()=>Promise<boolean>,hint:(cloudId:string,original:string,jobId:string)=>void){
  const live=captureOwnerPublication(owner),seen=new Map<string,number>();let closed=false,empty=false,closing:Promise<unknown>|undefined;
  const unsubscribe=subscribe(row=>{
    if(closed||!live()||!row||typeof row!=='object')return;
    const r=row as Record<string,unknown>;
    if(r.owner_id!==owner||!['SUCCEEDED','COMPLETING'].includes(String(r.state))||typeof r.id!=='string'||typeof r.wardrobe_item_id!=='string'||typeof r.original_version!=='string'||!/^[a-f0-9]{64}$/.test(r.original_version)||!Number.isSafeInteger(r.revision))return;
    if((seen.get(r.id)??-1)>=Number(r.revision))return;
    seen.set(r.id,Number(r.revision));while(seen.size>512)seen.delete(seen.keys().next().value!);
    hint(r.wardrobe_item_id,r.original_version,r.id);
  });
  let unregister=()=>{};
  const stop=()=>{
    closed=true;
    closing??=trackOwnerWork(owner,Promise.resolve().then(unsubscribe).then(ok=>{empty=ok;if(ok)unregister();},()=>{}));
  };
  unregister=registerOwnerResource(owner,{stop,empty:()=>empty});
  return stop;
}
