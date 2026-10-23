import { captureOwnerPublication } from '../lib/accountDeviceWork';
import { withAccountWriteWorkflow } from '../lib/accountWriteFence';
import { createWardrobeCutoutV2, type CutoutV2Backend, type CutoutV2Artifact, type CutoutV2Job, type CutoutV2Response } from './wardrobeCutoutV2';
import type { WardrobeItem, WardrobeItemConfirmation, WardrobeCutoutResult } from '../types/wardrobe';
import { itemCutoutV2Confirmed } from '../lib/wardrobeCutoutV2Gate';
export { itemCutoutV2Confirmed,WARDROBE_CUTOUT_V2_ENABLED } from '../lib/wardrobeCutoutV2Gate';
import type { WardrobeCutoutPatch } from '../lib/wardrobeCutoutState';

interface Options {
  enabled:boolean; backendReady():boolean;
  current(owner:string,localId:string):{item:WardrobeItem;confirmation?:WardrobeItemConfirmation}|undefined;
  backend(confirmed:(job:CutoutV2Job)=>boolean,owner:string):CutoutV2Backend;
  artifacts:{saveVerified(job:CutoutV2Job,response:CutoutV2Response):Promise<CutoutV2Artifact>;verifyOwnedPng(job:CutoutV2Job,artifact:CutoutV2Artifact):Promise<boolean>};
  publish(owner:string,localId:string,patch:WardrobeCutoutPatch):Promise<void>;
  restoreResult?:(owner:string,cloudItemId:string,originalVersion:string)=>Promise<WardrobeCutoutResult|undefined>;
}
export function createWardrobeV2Coordinator(options:Options) {
  const tasks=new Map<string,Promise<void>>();
  let generation=0;
  return {invalidate(){generation++;tasks.clear();},resume(owner:string,localId:string,completedHint=false):Promise<void>{
    const epoch=generation;
    const initial=options.current(owner,localId);
    if (!options.enabled || !options.backendReady() || !initial || !itemCutoutV2Confirmed(owner,initial.item,initial.confirmation)) return Promise.resolve();
    const c=initial.confirmation, identity={owner,wardrobeItemId:c.cloudItemId,originalVersion:c.originalVersion};
    const key=JSON.stringify([owner,localId,c.originalVersion]);
    const active=tasks.get(key);if(active)return active;
    const live=captureOwnerPublication(owner);
    const current=()=>{
      const now=options.current(owner,localId);
      return epoch===generation && live() && now && itemCutoutV2Confirmed(owner,now.item,now.confirmation) && now.confirmation.cloudItemId===identity.wardrobeItemId && now.confirmation.originalVersion===identity.originalVersion ? now : undefined;
    };
    const engine=createWardrobeCutoutV2({
      currentItem:()=>{const now=current();return now?{originalVersion:identity.originalVersion,cutoutStatus:now.item.cutoutStatus,cutoutProtocol:now.item.cutoutProtocol}:undefined;},
      backend:options.backend(()=>!!current(),owner),artifacts:options.artifacts,
    });
    const work=withAccountWriteWorkflow(owner,async()=>{
      let job=await engine.read(identity);
      const result=initial.item.cutoutResult ?? (!job && completedHint ? await options.restoreResult?.(owner,identity.wardrobeItemId,identity.originalVersion):undefined);
      if(!job && completedHint && !result)return; // a hint NEVER authorizes new dispatch
      if (!job && result) {
        const r=result;
        if(r.originalVersion!==identity.originalVersion)return;
        job=await engine.observeVerifiedResult(identity,{protocol:'vitrify.cutout.v2',...identity,request:r.requestId,resultId:r.jobId,pngSha256:r.pngSha256});
      }
      const wasWaiting=job?.state==='DISPATCH_POSSIBLE';
      if(wasWaiting) job=await engine.reconcile(identity,true);
      else job=await engine.run(identity);
      // One completion observation after execute ACK, not a polling loop.
      if(job.state==='DISPATCH_POSSIBLE' && !wasWaiting)job=await engine.reconcile(identity,true);
      if(job.state==='RESPONSE_OBSERVED')job=await engine.run(identity);
      if(job.state!=='ARTIFACT_SAVED' || !job.artifact || !current())return;
      const response=job.response!;
      if(current()?.item.cutoutLocalUri===job.artifact.uri && current()?.item.cutoutStatus==='ready')return;
      await options.publish(owner,localId,{cutoutStatus:'ready',cutoutLocalUri:job.artifact.uri,
        cutoutStoragePath:`${owner}/${identity.wardrobeItemId}/cutout-${response.resultId}.png`,
        cutoutUrl:undefined,cutoutUrlExpiresAt:undefined});
    }).catch(()=>{ /* Fail closed, keep original/checkpoint. No retry or warning popup. */ }).finally(()=>tasks.delete(key));
    tasks.set(key,work);return work;
  }};
}
