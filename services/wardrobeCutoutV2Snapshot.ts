import type { CloudSnapshot } from './wardrobeCloudPersistence';
import { validWardrobeOriginalPath } from '../types/wardrobe';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function validateWardrobeV2Snapshot(owner:string,snapshot:CloudSnapshot):string[]{
  if(snapshot.cutoutVersion!==2 || typeof snapshot.cutoutReady!=='boolean' || !Array.isArray(snapshot.items))throw new Error('CUTOUT_V2_SNAPSHOT_UNVERIFIED');
  const paths:string[]=[];
  for(const item of snapshot.items){
    if(item.cutoutProtocol!==2){if(item.cutoutResult)throw new Error('CUTOUT_V2_LEGACY_MANIFEST');continue;}
    if(!uuid.test(item.id)||!item.imageStoragePath||!validWardrobeOriginalPath(owner,item.imageStoragePath)||item.imageStoragePath.split('/')[1]!==item.id||!/^[a-f0-9]{64}$/.test(item.originalVersion??''))throw new Error('CUTOUT_V2_ORIGINAL_UNVERIFIED');
    const result=item.cutoutResult;
    if(!result){if(item.cutoutStoragePath)throw new Error('CUTOUT_V2_RESULT_UNVERIFIED');continue;}
    const path=`${owner}/${item.id}/cutout-${result.jobId}.png`;
    if(!uuid.test(result.jobId)||!uuid.test(result.requestId)||!/^[a-f0-9]{64}$/.test(result.pngSha256)||result.originalVersion!==item.originalVersion||item.cutoutStoragePath!==path||item.cutoutStatus!=='ready')throw new Error('CUTOUT_V2_RESULT_UNVERIFIED');
    paths.push(path);
  }
  return [...new Set(paths)];
}
