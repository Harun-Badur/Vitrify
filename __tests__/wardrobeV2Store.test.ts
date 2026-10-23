import { createStore } from 'zustand/vanilla';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createWardrobeSlice } from '../store/wardrobeSlice';
import type { AppState } from '../store/useAppStore';
import { resetDeviceWorkForTests,setDeviceSessionOwner } from '../lib/accountDeviceWork';
import { resetAccountWriteFenceMemoryForTests } from '../lib/accountWriteFence';
jest.mock('../services/wardrobeCutoutV2Integration',()=>({...jest.requireActual('../services/wardrobeCutoutV2Integration'),WARDROBE_CUTOUT_V2_ENABLED:true}));
jest.mock('../services/wardrobeService',()=>({...jest.requireActual('../services/wardrobeService'),saveWardrobeCutoutCheckpoint:async()=>true}));
jest.mock('../services/wardrobeCutoutV2Artifacts',()=>({
  wardrobeV2Artifacts:()=>({saveVerified:async()=>({uri:'file:///documents/verified.png',pngSha256:'b'.repeat(64)}),verifyOwnedPng:async()=>true}),
  invokeWardrobeCutoutV2:(...args:unknown[])=>mockInvoke(...args),
}));
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',cloudId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const original=`${owner}/${cloudId}/original-cccccccc-cccc-4ccc-8ccc-cccccccccccc.png`;
const mockInvoke=jest.fn(async(...args:unknown[])=>{
  const body=args[3] as Record<string,unknown>;
  return{protocol:'vitrify.cutout.v2',owner,wardrobeItemId:cloudId,originalVersion:'a'.repeat(64),request:body.requestId,
    jobId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',revision:0,state:args[1]==='reserve'?'RESERVED':'SUCCEEDED',resultId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',pngSha256:'b'.repeat(64)};
});
beforeEach(async()=>{await AsyncStorage.clear();resetDeviceWorkForTests();resetAccountWriteFenceMemoryForTests();setDeviceSessionOwner(owner);mockInvoke.mockClear();});
test('real store V2 branch updates the card despite unrelated global pending',async()=>{
  const store=createStore<AppState>()((set,get,api)=>({...createWardrobeSlice(set,get,api),sessionUserId:owner} as AppState));
  store.setState({wardrobeStatus:'ready',wardrobeSync:{state:'pending',pending:1},wardrobeCutoutV2Available:true,wardrobeCutoutV2Ready:true,
    wardrobeItems:[{id:'local',title:'Top',brand:'',category:'upper_body',createdAt:'date',imageUrl:'https://unit.invalid/original',imageStoragePath:original,cutoutProtocol:2,originalVersion:'a'.repeat(64),cutoutStatus:'pending'}],
    wardrobeConfirmedItems:{local:{owner,cloudItemId:cloudId,originalPath:original,originalVersion:'a'.repeat(64),cutoutProtocol:2}}});
  const published=new Promise<void>(resolve=>{const unsubscribe=store.subscribe(state=>{if(state.wardrobeItems[0]?.cutoutStatus==='ready'){unsubscribe();resolve();}});});
  store.getState().resumeWardrobeCutouts();await published;
  expect(store.getState().wardrobeItems[0].cutoutLocalUri).toBe('file:///documents/verified.png');
  expect(mockInvoke).toHaveBeenCalledTimes(2);
},3000);
