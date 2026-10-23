import { observeWardrobeV2Hints } from '../services/wardrobeCutoutV2Realtime';
import { ownerWorkEvidence,resetDeviceWorkForTests,setDeviceSessionOwner } from '../lib/accountDeviceWork';
import { fenceAccountWrites,resetAccountWriteFenceMemoryForTests } from '../lib/accountWriteFence';
import AsyncStorage from '@react-native-async-storage/async-storage';
beforeEach(async()=>{await AsyncStorage.clear();resetDeviceWorkForTests();resetAccountWriteFenceMemoryForTests();setDeviceSessionOwner('owner');});
const row={owner_id:'owner',id:'job',wardrobe_item_id:'item',original_version:'a'.repeat(64),revision:1,state:'SUCCEEDED'};
test('hints are owner scoped, monotonic and ignored after A -> B -> A',async()=>{
  let receive!:(row:unknown)=>void;const hint=jest.fn();
  const stop=observeWardrobeV2Hints('owner',callback=>{receive=callback;return async()=>true;},hint);
  receive({...row,owner_id:'foreign'});receive(row);receive(row);receive({...row,revision:0});expect(hint).toHaveBeenCalledTimes(1);
  setDeviceSessionOwner('B');setDeviceSessionOwner('owner');receive({...row,revision:2});expect(hint).toHaveBeenCalledTimes(1);stop();
});
test('account deletion drain waits for actual channel removal acknowledgement',async()=>{
  let settle!:(ok:boolean)=>void;const removed=new Promise<boolean>(resolve=>{settle=resolve;});
  observeWardrobeV2Hints('owner',()=>()=>removed,()=>{});
  const fence=fenceAccountWrites('owner');await Promise.resolve();await Promise.resolve();
  expect(ownerWorkEvidence('owner').nonempty).toBe(1);settle(true);await fence;
  expect(ownerWorkEvidence('owner')).toMatchObject({pending:0,nonempty:0});
});
