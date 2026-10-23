import { validateWardrobeV2Snapshot } from '../services/wardrobeCutoutV2Snapshot';
import { createWardrobePersistence, type CloudSnapshot, type WardrobeCloudPort } from '../services/wardrobeCloudPersistence';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', result='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const item={id,title:'Top',brand:'',category:'upper_body' as const,createdAt:'date',updatedAt:'1',imageUrl:'https://unit.invalid/original',imageStoragePath:`${owner}/${id}/original-dddddddd-dddd-4ddd-8ddd-dddddddddddd.png`,originalVersion:'a'.repeat(64),cutoutProtocol:2 as const,cutoutStatus:'ready' as const,cutoutStoragePath:`${owner}/${id}/cutout-${result}.png`,cutoutResult:{jobId:result,requestId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',pngSha256:'b'.repeat(64),originalVersion:'a'.repeat(64)},cutoutUrl:'https://unit.invalid/result'};
const snapshot:CloudSnapshot={items:[item],outfits:[],photoVersion:1,cutoutVersion:2,cutoutReady:true};
test('fresh device/reopen projects cloud result and exact item confirmation',async()=>{
  const disk=new Map<string,string>();const storage={getItem:async(k:string)=>disk.get(k)??null,setItem:async(k:string,v:string)=>{disk.set(k,v);}};
  const cloud:WardrobeCloudPort={authenticate:async()=>{},snapshot:async()=>structuredClone(snapshot),apply:async()=>{throw new Error('no apply expected');}};
  expect(validateWardrobeV2Snapshot(owner,snapshot)).toEqual([item.cutoutStoragePath]);
  const first=await createWardrobePersistence(storage,cloud).load(owner);
  const reopened=await createWardrobePersistence(storage,cloud).load(owner);
  expect(first.wardrobeItems[0].cutoutResult).toEqual(item.cutoutResult);expect(reopened.wardrobeItems[0].cutoutUrl).toBe(item.cutoutUrl);
  expect(reopened.wardrobeConfirmedItems?.[id]).toMatchObject({owner,cloudItemId:id,originalVersion:'a'.repeat(64)});
  const offline=await createWardrobePersistence(storage,null).load(owner);expect(offline.wardrobeConfirmedItems).toEqual({});
});
test('unmatched result original version cannot be signed/displayed',()=>{
  expect(()=>validateWardrobeV2Snapshot(owner,{...snapshot,items:[{...item,cutoutResult:{...item.cutoutResult,originalVersion:'c'.repeat(64)}}]})).toThrow();
});
test('another item Storage UNKNOWN does not remove the healthy item confirmation',async()=>{
  const disk=new Map<string,string>();const storage={getItem:async(k:string)=>disk.get(k)??null,setItem:async(k:string,v:string)=>{disk.set(k,v);}};
  const cloud:WardrobeCloudPort={authenticate:async()=>{},snapshot:async()=>structuredClone(snapshot),apply:async()=>{throw new Error('no apply');},
    photoPath:(_owner,cloudId)=>`${owner}/${cloudId}/original-ffffffff-ffff-4fff-8fff-ffffffffffff.png`,
    uploadPhoto:async()=>{throw Object.assign(new Error('unknown'),{code:'WARDROBE_STORAGE_UNKNOWN'});}};
  const service=createWardrobePersistence(storage,cloud);await service.load(owner);
  const data=await service.save(owner,{wardrobeItems:[item,{...item,id:'pending-other',imageStoragePath:undefined,imageUrl:'file:///old.png',cutoutProtocol:undefined,cutoutResult:undefined}],savedOutfits:[]});
  expect(data.wardrobeSync).toMatchObject({state:'pending',pending:1});
  expect(data.wardrobeConfirmedItems?.[id]?.cloudItemId).toBe(id);expect(data.wardrobeConfirmedItems?.['pending-other']).toBeUndefined();
});
