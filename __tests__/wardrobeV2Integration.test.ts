import { createWardrobeV2Coordinator, itemCutoutV2Confirmed } from '../services/wardrobeCutoutV2Integration';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { resetAccountWriteFenceMemoryForTests, withAccountWriteGuard } from '../lib/accountWriteFence';
import { resetDeviceWorkForTests, setDeviceSessionOwner } from '../lib/accountDeviceWork';
import type { WardrobeItem } from '../types/wardrobe';
import type { CutoutV2Backend } from '../services/wardrobeCutoutV2';
import { beginProviderDeviceIntentUnderGuard } from '../services/providerDeviceJournal';

const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', cloudId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const original=`${owner}/${cloudId}/original-cccccccc-cccc-4ccc-8ccc-cccccccccccc.png`;
const version='a'.repeat(64), resultId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const item: WardrobeItem={id:'local-item',title:'Top',brand:'',category:'upper_body',createdAt:'date',imageUrl:'https://unit.invalid/original',imageStoragePath:original,cutoutProtocol:2,cutoutStatus:'pending',originalVersion:version};
const confirmation={owner,cloudItemId:cloudId,originalPath:original,originalVersion:version,cutoutProtocol:2 as const};
beforeEach(async()=>{await AsyncStorage.clear();resetAccountWriteFenceMemoryForTests();resetDeviceWorkForTests();setDeviceSessionOwner(owner);});
function fixture(enabled=true,ready=true){
  let current: WardrobeItem | undefined={...item};
  const publish=jest.fn(async(patch:Partial<WardrobeItem>)=>{current={...current!,...patch};});
  const dispatch=jest.fn<CutoutV2Backend['dispatch'] extends (...args: infer A)=>infer R ? R:never, Parameters<CutoutV2Backend['dispatch']>>(async job=>({protocol:'vitrify.cutout.v2',...job.identity,request:job.request,resultId,pngSha256:'b'.repeat(64)}));
  const backend:CutoutV2Backend={contract:'vitrify.cutout.v2',prepare:async()=>({value:null,cleanup:async()=>{}}),dispatch,status:async()=>({state:'UNKNOWN'})};
  const download=jest.fn(async()=>({uri:`file:///documents/wardrobe/${owner}/result.png`,pngSha256:'b'.repeat(64)}));
  const service=createWardrobeV2Coordinator({enabled,backendReady:()=>ready,current:()=>current?{item:current,confirmation}:undefined,backend:()=>backend,artifacts:{saveVerified:download,verifyOwnedPng:async()=>true},publish:async(_owner,_id,patch)=>publish(patch)});
  return{service,dispatch,download,publish,remove:()=>{current=undefined;},setItem:(patch:Partial<WardrobeItem>)=>{current={...current!,...patch};}};
}
test('item-specific confirmation allows an independent confirmed item without global sync',()=>{
  expect(itemCutoutV2Confirmed(owner,item,confirmation)).toBe(true);
  expect(itemCutoutV2Confirmed(owner,item,{...confirmation,owner:'foreign'})).toBe(false);
  expect(itemCutoutV2Confirmed(owner,item,{...confirmation,originalVersion:'c'.repeat(64)})).toBe(false);
  expect(itemCutoutV2Confirmed(owner,item,undefined)).toBe(false);
});
test.each([[false,true],[true,false]])('flag/backend readiness gates dispatch (%s,%s)',async(enabled,ready)=>{
  const f=fixture(enabled,ready);await f.service.resume(owner,item.id);expect(f.dispatch).not.toHaveBeenCalled();expect(f.publish).not.toHaveBeenCalled();
});
test('same original dispatches once, persists verified PNG and automatically publishes card patch',async()=>{
  const f=fixture();await Promise.all([f.service.resume(owner,item.id),f.service.resume(owner,item.id)]);
  expect(f.dispatch).toHaveBeenCalledTimes(1);expect(f.publish).toHaveBeenCalledWith(expect.objectContaining({cutoutStatus:'ready',cutoutLocalUri:expect.stringContaining('/result.png')}));
  await f.service.resume(owner,item.id);expect(f.dispatch).toHaveBeenCalledTimes(1);
});
test('legacy UNKNOWN remains a barrier to a NEW dispatch',async()=>{
  await withAccountWriteGuard(owner,()=>beginProviderDeviceIntentUnderGuard(owner,'wardrobe-cutout'));
  const f=fixture();await f.service.resume(owner,item.id);expect(f.dispatch).not.toHaveBeenCalled();
});
test('late result after item removal is not published',async()=>{
  const f=fixture();f.dispatch.mockImplementationOnce(async job=>{f.remove();return{protocol:'vitrify.cutout.v2',...job.identity,request:job.request,resultId,pngSha256:'b'.repeat(64)};});
  await f.service.resume(owner,item.id);expect(f.publish).not.toHaveBeenCalled();
});
test('fresh device restores a verified cloud manifest without reserve/execute, even with legacy UNKNOWN',async()=>{
  await withAccountWriteGuard(owner,()=>beginProviderDeviceIntentUnderGuard(owner,'wardrobe-cutout'));
  const f=fixture();f.setItem({cutoutStatus:'ready',cutoutResult:{jobId:resultId,requestId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',pngSha256:'b'.repeat(64),originalVersion:version}});
  await f.service.resume(owner,item.id);expect(f.dispatch).not.toHaveBeenCalled();expect(f.download).toHaveBeenCalledTimes(1);expect(f.publish).toHaveBeenCalledWith(expect.objectContaining({cutoutStatus:'ready'}));
});
