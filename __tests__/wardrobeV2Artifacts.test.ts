import { createHash } from 'node:crypto';
import { createWardrobeV2Artifacts } from '../services/wardrobeCutoutV2Artifacts';
import { resetDeviceWorkForTests,setDeviceSessionOwner } from '../lib/accountDeviceWork';
import { resetAccountWriteFenceMemoryForTests,withAccountWriteGuard } from '../lib/accountWriteFence';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CutoutV2Job, CutoutV2Response } from '../services/wardrobeCutoutV2';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',itemId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',resultId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const bytes=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DQAAAEgQGALFXOsAAAAABJRU5ErkJggg==','base64'));
const hash=async(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
const identity={owner,wardrobeItemId:itemId,originalVersion:'a'.repeat(64)};
const response:CutoutV2Response={protocol:'vitrify.cutout.v2',...identity,request:'request',resultId,pngSha256:createHash('sha256').update(bytes).digest('hex')};
const job:CutoutV2Job={version:2,identity,request:'request',state:'RESPONSE_OBSERVED',revision:2,prepareAttempts:1,preparationStopped:false,response};
function fixture(){
  const manifest=jest.fn(async():Promise<Record<string,unknown>>=>({...response,state:'SUCCEEDED',bucket:'wardrobe-cutouts',key:`${owner}/${itemId}/cutout-${resultId}.png`,byteLength:bytes.length}));
  const writeOwned=jest.fn(async()=> 'file:///owned/result.png');
  const download=jest.fn(async()=>bytes);
  return{manifest,writeOwned,download,service:createWardrobeV2Artifacts({manifest,writeOwned,download,hash,readOwned:async()=>bytes})};
}
beforeEach(async()=>{await AsyncStorage.clear();resetDeviceWorkForTests();resetAccountWriteFenceMemoryForTests();setDeviceSessionOwner(owner);await withAccountWriteGuard(owner,async()=>{});});
test('verified private PNG is persisted only after exact manifest and byte digest',async()=>{
  const f=fixture();expect(await f.service.saveVerified(job,response)).toEqual({uri:'file:///owned/result.png',pngSha256:response.pngSha256});expect(f.writeOwned).toHaveBeenCalledWith(job,response,bytes);
});
test('foreign result key never downloads or writes',async()=>{
  const f=fixture();f.manifest.mockResolvedValueOnce({...response,state:'SUCCEEDED',bucket:'wardrobe-cutouts',key:'foreign',byteLength:bytes.length});
  await expect(f.service.saveVerified(job,response)).rejects.toThrow();expect(f.download).not.toHaveBeenCalled();expect(f.writeOwned).not.toHaveBeenCalled();
});
test('wrong PNG bytes never enter owned storage',async()=>{
  const f=fixture();f.download.mockResolvedValueOnce(new Uint8Array(bytes.length));await expect(f.service.saveVerified(job,response)).rejects.toThrow();expect(f.writeOwned).not.toHaveBeenCalled();
});
test('account A -> B -> A invalidates in-flight download',async()=>{
  const f=fixture();f.download.mockImplementationOnce(async()=>{setDeviceSessionOwner('other');setDeviceSessionOwner(owner);return bytes;});
  await expect(f.service.saveVerified(job,response)).rejects.toThrow();expect(f.writeOwned).not.toHaveBeenCalled();
});
