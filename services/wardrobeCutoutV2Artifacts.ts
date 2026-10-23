import * as FS from 'expo-file-system/legacy';
import { createUuid } from '../lib/analytics';
import { captureOwnerPublication } from '../lib/accountDeviceWork';
import { accountWriteBlockedNow, withAccountWriteGuard } from '../lib/accountWriteFence';
import { getRequiredSupabaseClient } from '../lib/supabase';
import { createOwnedFileUnderGuard, readOwnedFileLedger, otherDeviceFileReferences } from './ownedDeviceFiles';
import { decodeWardrobePhotoBytes } from '../lib/wardrobePhotoBytes';
import type { CutoutV2Artifact, CutoutV2Job, CutoutV2Response } from './wardrobeCutoutV2';
import type { WardrobeCutoutResult } from '../types/wardrobe';

const fail=()=>new Error('CUTOUT_V2_ARTIFACT_UNVERIFIED');
export async function restoreWardrobeV2Result(owner:string,cloudItemId:string,originalVersion:string):Promise<WardrobeCutoutResult|undefined>{
  const client=getRequiredSupabaseClient(),live=captureOwnerPublication(owner);
  const auth=await client.auth.getUser();if(auth.error||auth.data.user?.id!==owner||!live()||accountWriteBlockedNow(owner))throw fail();
  const {data,error}=await client.rpc('wardrobe_cutout_result',{p_owner:owner,p_item:cloudItemId,p_original:originalVersion});
  if(error||!live()||accountWriteBlockedNow(owner))throw fail();
  let r=data as Record<string,unknown>|null;
  if(r?.state==='COMPLETING' && typeof r.jobId==='string' && typeof r.request==='string')r=await invokeWardrobeCutoutV2(owner,'reconcile','POST',{jobId:r.jobId,requestId:r.request}) as Record<string,unknown>;
  if(r?.state!=='SUCCEEDED')return;
  if(r.protocol!=='vitrify.cutout.v2'||r.owner!==owner||r.wardrobeItemId!==cloudItemId||r.originalVersion!==originalVersion||typeof r.resultId!=='string'||typeof r.request!=='string'||typeof r.pngSha256!=='string'||!/^[a-f0-9]{64}$/.test(r.pngSha256)||!live())throw fail();
  return{jobId:r.resultId,requestId:r.request,pngSha256:r.pngSha256,originalVersion};
}
export const cutoutV2ResultPath=(job:CutoutV2Job,response:CutoutV2Response)=>{
  const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if(!uuid.test(job.identity.owner)||!uuid.test(job.identity.wardrobeItemId)||!uuid.test(response.resultId)||response.owner!==job.identity.owner||response.wardrobeItemId!==job.identity.wardrobeItemId||response.originalVersion!==job.identity.originalVersion||response.request!==job.request)throw fail();
  return `${job.identity.owner}/${job.identity.wardrobeItemId}/cutout-${response.resultId}.png`;
};
export async function invokeWardrobeCutoutV2(owner:string,route:string,method:'GET'|'POST',body?:Record<string,unknown>):Promise<unknown>{
  const client=getRequiredSupabaseClient(),live=captureOwnerPublication(owner);
  const auth=await client.auth.getUser();
  if(!live()||accountWriteBlockedNow(owner)||auth.error||auth.data.user?.id!==owner)throw fail();
  const result=await client.functions.invoke(`wardrobe-cutout-control/${route}`,{method,...(body?{body}:{})});
  const current=await client.auth.getUser();
  if(result.error||!live()||accountWriteBlockedNow(owner)||current.error||current.data.user?.id!==owner)throw fail();
  return result.data;
}
interface ArtifactPorts {
  manifest(job:CutoutV2Job):Promise<unknown>;
  download(job:CutoutV2Job,path:string):Promise<Uint8Array<ArrayBuffer>>;
  hash(bytes:Uint8Array<ArrayBuffer>):Promise<string>;
  writeOwned(job:CutoutV2Job,response:CutoutV2Response,bytes:Uint8Array<ArrayBuffer>):Promise<string>;
  readOwned(job:CutoutV2Job,uri:string):Promise<Uint8Array<ArrayBuffer>|undefined>;
}
/** Network phase is outside global guard; local creation uses the existing owner ledger. */
export function createWardrobeV2Artifacts(ports:ArtifactPorts){
  return {
    saveVerified:async(job:CutoutV2Job,response:CutoutV2Response):Promise<CutoutV2Artifact>=>{
      const live=captureOwnerPublication(job.identity.owner), path=cutoutV2ResultPath(job,response);
      const raw=await ports.manifest(job);
      if(!raw||typeof raw!=='object')throw fail();
      const r=raw as Record<string,unknown>;
      if(r.protocol!=='vitrify.cutout.v2'||r.state!=='SUCCEEDED'||r.owner!==job.identity.owner||r.wardrobeItemId!==job.identity.wardrobeItemId||r.originalVersion!==job.identity.originalVersion||r.request!==job.request||r.resultId!==response.resultId||r.pngSha256!==response.pngSha256||r.bucket!=='wardrobe-cutouts'||r.key!==path||!Number.isSafeInteger(r.byteLength)||Number(r.byteLength)<=0||Number(r.byteLength)>12582912)throw fail();
      const bytes=await ports.download(job,path);
      if(bytes.length!==r.byteLength||bytes.length>12582912||![137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)||await ports.hash(bytes)!==response.pngSha256||!live()||accountWriteBlockedNow(job.identity.owner))throw fail();
      const uri=await ports.writeOwned(job,response,bytes);
      if(!live()||accountWriteBlockedNow(job.identity.owner))throw fail();
      return{uri,pngSha256:response.pngSha256};
    },
    verifyOwnedPng:async(job:CutoutV2Job,artifact:CutoutV2Artifact)=>{
      const bytes=await ports.readOwned(job,artifact.uri);
      return !!bytes && bytes.length<=12582912 && !!job.response && artifact.pngSha256===job.response.pngSha256 && await ports.hash(bytes)===artifact.pngSha256;
    },
  };
}
const base64=(bytes:Uint8Array)=>{
  const chunks:string[]=[];
  for(let i=0;i<bytes.length;i+=24576)chunks.push(btoa(String.fromCharCode(...bytes.subarray(i,i+24576))));
  return chunks.join('');
};
export const wardrobeV2Artifacts=()=>createWardrobeV2Artifacts({
  manifest:job=>invokeWardrobeCutoutV2(job.identity.owner,`result?requestId=${encodeURIComponent(job.request)}`,'GET'),
  download:async(job,path)=>{
    const client=getRequiredSupabaseClient(),live=captureOwnerPublication(job.identity.owner);
    const auth=await client.auth.getUser();
    if(!live()||accountWriteBlockedNow(job.identity.owner)||auth.error||auth.data.user?.id!==job.identity.owner)throw fail();
    const {data,error}=await client.storage.from('wardrobe-cutouts').download(path);
    const authAfter=await client.auth.getUser();
    if(error||!data||data.size>12582912||!live()||authAfter.error||authAfter.data.user?.id!==job.identity.owner)throw fail();
    return new Uint8Array(await data.arrayBuffer());
  },
  hash:async bytes=>{
    const Crypto=await import('expo-crypto');
    return [...new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256,bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
  },
  writeOwned:(job,response,bytes)=>withAccountWriteGuard(job.identity.owner,async()=>{
    if(!FS.documentDirectory)throw fail();
    const dir=`${FS.documentDirectory}wardrobe/${encodeURIComponent(job.identity.owner)}/`;
    const uri=`${dir}cutout-v2-${response.resultId}-${createUuid()}.png`;
    await FS.makeDirectoryAsync(dir,{intermediates:true});
    await createOwnedFileUnderGuard(job.identity.owner,'wardrobe-cutout-v2',uri,()=>FS.writeAsStringAsync(uri,base64(bytes),{encoding:FS.EncodingType.Base64}));
    return uri;
  }),
  readOwned:async(job,uri)=>{
    const owner=job.identity.owner,dir=FS.documentDirectory&&`${FS.documentDirectory}wardrobe/${encodeURIComponent(owner)}/`;
    if(!dir||!uri.startsWith(dir)||/[\\]|\/\.{1,2}(?:\/|$)|%2e|%2f|%5c|[?#]/i.test(uri))return;
    const ledger=await readOwnedFileLedger(owner);
    if(!ledger.intents.some(i=>i.state==='READY'&&i.kind==='wardrobe-cutout-v2'&&i.paths.includes(uri))||(await otherDeviceFileReferences(owner)).has(uri))return;
    const info=await FS.getInfoAsync(uri);
    if(!info.exists||info.isDirectory||info.size>12582912)return;
    return decodeWardrobePhotoBytes(await FS.readAsStringAsync(uri,{encoding:FS.EncodingType.Base64}));
  },
});
