import AsyncStorage from '@react-native-async-storage/async-storage';
import { deviceDeletionAdapters } from '../services/deviceDeletionAdapters';
import { createDeletionReceipt } from '../lib/accountDeletionFoundation';
import { buildWardrobeOwnershipEvidence } from '../src/intelligence/evidence/sharedEvidence';
jest.mock('expo-file-system/legacy',()=>({documentDirectory:'file:///docs/',cacheDirectory:'file:///cache/'}));
beforeEach(async()=>{await AsyncStorage.clear();});
const pref=(owner:string)=>'vitrify.preference-request.v2:'+JSON.stringify([owner,'fixture']);
const adapter=()=>deviceDeletionAdapters({subjectId:'A',coverageVerified:true,ownedFiles:[],extraOwnedKeys:[]},async()=>true).async_storage!;
test('deletion clears only owner preference, wardrobe sync and legacy journals; preserves recovery and B',async()=>{
  const removed=[pref('A'),'vitrify.wardrobe.sync.v1.A','vitrify.wardrobe.sync.v1.A.legacy'];
  const kept=[pref('B'),'vitrify.wardrobe.sync.v1.B','vitrify.wardrobe.sync.v1.B.legacy','vitrify.deletion-checkpoint.A'];
  for(const k of [...removed,...kept])await AsyncStorage.setItem(k,'fixture');
  const a=adapter(),r=createDeletionReceipt('r','A');await a.cleanup(r);
  for(const k of removed)expect(await AsyncStorage.getItem(k)).toBeNull();
  for(const k of kept)expect(await AsyncStorage.getItem(k)).toBe('fixture');
  expect((await a.verify(r)).complete).toBe(true);
  await a.cleanup(r);expect((await a.verify(r)).complete).toBe(true);
});
test('late preference journal makes cleanup verification fail',async()=>{
  const a=adapter(),r=createDeletionReceipt('r','A');await a.cleanup(r);
  await AsyncStorage.setItem(pref('A'),'fixture');expect((await a.verify(r)).complete).toBe(false);
});
test('unassignable malformed preference key blocks cleanup without deleting unknown data',async()=>{
  await AsyncStorage.setItem('vitrify.preference-request.v2:broken','fixture');
  await expect(adapter().cleanup(createDeletionReceipt('r','A'))).rejects.toThrow();
  expect(await AsyncStorage.getItem('vitrify.preference-request.v2:broken')).toBe('fixture');
});
const item={id:'owned',title:'Fixture',imageUrl:'https://example.invalid/photo',brand:'Fixture',category:'upper_body' as const,createdAt:'2026-10-13'};
test('synced wardrobe is ownership, never positive preference; removal follows current snapshot',()=>{
  const a=buildWardrobeOwnershipEvidence('A','A',{wardrobeItems:[item,item],savedOutfits:[],wardrobeSync:{state:'synced',pending:0}});
  expect(a.counts).toMatchObject({owned:1,liked:0,passed:0});
  expect(buildWardrobeOwnershipEvidence('A','A',{wardrobeItems:[],savedOutfits:[],wardrobeSync:{state:'synced',pending:0}}).counts.owned).toBe(0);
});
test.each(['pending','conflict'] as const)('%s local wardrobe is not confirmed ownership',state=>{
  expect(buildWardrobeOwnershipEvidence('A','A',{wardrobeItems:[item],savedOutfits:[],wardrobeSync:{state,pending:1}}).status).toBe('unavailable');
});
test('owner B snapshot never becomes A ownership',()=>{
  expect(buildWardrobeOwnershipEvidence('A','B',{wardrobeItems:[item],savedOutfits:[],wardrobeSync:{state:'synced',pending:0}}).counts.owned).toBe(0);
});
