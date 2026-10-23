import { buildStyleJourney } from '../lib/profileStyleJourney';
import { fetchCalculatedStyleProfile, fetchStyleProfileSnapshot, invalidateStyleProfileSnapshot } from '../lib/recsConfig';
import { isPreferenceV2Enabled } from '../lib/preferenceFeatureFlags';
import { getSupabaseClient } from '../lib/supabase';
import { mapStyleProfileRow as clientMap, subscribeStyleProfileChanges } from '../lib/recsConfig';
import { mapStyleProfileRow as edgeMap } from '../supabase/functions/_shared/config';
import { writeFileSync } from 'node:fs';
jest.mock('../lib/supabase', () => ({getSupabaseClient:jest.fn()}));
jest.mock('../lib/preferenceFeatureFlags',()=>({isPreferenceV2Enabled:jest.fn(()=>false)}));
const snapshot = {userId:'A',colorW:{mavi:1},subcategoryW:{gomlek:1},brandW:{},fitW:{},priceBandW:{},styleTagWeights:{minimal:1},negativePreferences:[]};
const calculated = {snapshot,eventCount:1,computedAt:'2026-10-13T00:00:00Z',algorithm:'v2' as const};
const base = {userId:'A',sessionUserId:'A',sessionSyncStatus:'success' as const,wardrobeStatus:'ready' as const,
  likedProducts:[],passedProductIds:[],wardrobeItems:[],savedOutfits:[],profile:null};
test('V2 journey consumes the backend preference, not a second local preference model', () => {
  const result=buildStyleJourney({...base,calculatedProfile:{state:'ready' as const,profile:calculated}});
  expect(result.insights.find(x=>x.id==='color')?.summary).toContain('Mavi');
  expect(result.insights.find(x=>x.id==='color')?.detail).toContain('user_style_profiles');
  expect(result.insights.find(x=>x.id==='style')?.summary).not.toContain('minimal');
  expect(result.percent).toBe(0);
});
test('undo clearing server weights clears the insight; no historical local likes replace it', () => {
  const result=buildStyleJourney({...base,calculatedProfile:{state:'ready' as const,profile:{...calculated,snapshot:{...snapshot,colorW:{}},eventCount:0}}});
  expect(result.insights.find(x=>x.id==='color')?.summary).not.toContain('Mavi');
  expect(result.insights.find(x=>x.id==='color')?.detail).toContain('Yeterli');
});
test('account mismatch and read failure never display another or stale backend profile', () => {
  for(const state of [{state:'ready' as const,profile:{...calculated,snapshot:{...snapshot,userId:'B'}}},{state:'error' as const}]) {
    const result=buildStyleJourney({...base,calculatedProfile:state});
    expect(result.insights.find(x=>x.id==='color')?.summary).not.toContain('Mavi');
    expect(result.insightNotice).toBeTruthy();
  }
});
test('many weighted events do not manufacture journey progress or automatic style identity', () => {
  const result=buildStyleJourney({...base,calculatedProfile:{state:'ready' as const,profile:{...calculated,eventCount:1000}}});
  expect(result.percent).toBe(0);
  expect(result.insights.find(x=>x.id==='style')?.status).toBe('Henüz keşfedilmedi');
});
test('fresh authenticated reader returns the same profile shape consumed by scoring', async () => {
  const row={user_id:'A',color_w:{mavi:1},subcategory_w:{gomlek:1},brand_w:{},fit_w:{},price_band_w:{},style_tag_weights:{minimal:1},negative_preferences:[],event_count:1,computed_at:calculated.computedAt};
  const from=jest.fn((table:string)=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==='recs_config'?{value:{algorithm:'style-preference-v2',legacy_policy:'exclude_with_approval',activated_at:'2026-10-12T23:59:59Z'}}:row,error:null})};return q;});
  const client={auth:{getUser:async()=>({data:{user:{id:'A'}},error:null}),getSession:async()=>({data:{session:{user:{id:'A'}}},error:null})},from};
  jest.mocked(getSupabaseClient).mockReturnValue(client as never);
  const first=await fetchCalculatedStyleProfile('A');
  expect(first.snapshot).toEqual(snapshot);expect(first.algorithm).toBe('v2');
  await fetchCalculatedStyleProfile('A');expect(from).toHaveBeenCalledTimes(2);
  invalidateStyleProfileSnapshot('A');
  await fetchCalculatedStyleProfile('A');expect(from).toHaveBeenCalledTimes(4);
  await expect(fetchCalculatedStyleProfile('B')).rejects.toThrow();
});
test('V2 SQL-shaped profile has identical client and Edge scoring interpretation',()=>{
  const row={user_id:'A',color_w:{mavi:1,siyah:-0.4},subcategory_w:{gomlek:0.6},brand_w:{},fit_w:{regular:0.5},price_band_w:{mid:1},style_tag_weights:{minimal:1},negative_preferences:[{product_id:'p',at:'2026-10-13T00:00:00Z',colors:['siyah'],subcategory:'gomlek',fit:'regular',brand_slug:'brand',price_band:'mid'}]};
  expect(clientMap(row)).toEqual(edgeMap(row,'A'));
});
test('Discover and Profile share one in-flight V2 snapshot and cache with no extra table reads',async()=>{
 const owner='SHARED';invalidateStyleProfileSnapshot(owner);jest.mocked(isPreferenceV2Enabled).mockReturnValue(true);
 const row={user_id:owner,color_w:{mavi:1},subcategory_w:{gomlek:1},brand_w:{},fit_w:{},price_band_w:{},style_tag_weights:{},negative_preferences:[],event_count:1,computed_at:'2026-10-13T00:00:01Z'};
 const from=jest.fn((table:string)=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==='recs_config'?{value:{algorithm:'style-preference-v2',legacy_policy:'exclude_with_approval',activated_at:'2026-10-13T00:00:00Z'}}:row,error:null})};return q;});
 const getUser=jest.fn(async()=>({data:{user:{id:owner}},error:null}));
 jest.mocked(getSupabaseClient).mockReturnValue({auth:{getUser,getSession:async()=>({data:{session:{user:{id:owner}}},error:null})},from} as never);
 try {
  const [discover,profile]=await Promise.all([fetchStyleProfileSnapshot(owner),fetchCalculatedStyleProfile(owner)]);
  expect(discover).toBe(profile.snapshot);expect(profile.algorithm).toBe('v2');
  for(let i=0;i<10;i++)await Promise.all([fetchStyleProfileSnapshot(owner),fetchCalculatedStyleProfile(owner)]);
  expect(from).toHaveBeenCalledTimes(2);expect(getUser).toHaveBeenCalledTimes(1);
  invalidateStyleProfileSnapshot(owner);
  const refreshed=await fetchCalculatedStyleProfile(owner);expect(refreshed.snapshot).toEqual(discover);expect(from).toHaveBeenCalledTimes(4);
 } finally {jest.mocked(isPreferenceV2Enabled).mockReturnValue(false);invalidateStyleProfileSnapshot(owner);}
});

test('owner-scoped invalidation notifies the focused consumer without a network loop',()=>{
  const a=jest.fn(),b=jest.fn();const stopA=subscribeStyleProfileChanges('A',a),stopB=subscribeStyleProfileChanges('B',b);
  invalidateStyleProfileSnapshot('A');expect(a).toHaveBeenCalledTimes(1);expect(b).not.toHaveBeenCalled();
  stopA();stopB();invalidateStyleProfileSnapshot('A');expect(a).toHaveBeenCalledTimes(1);
});
test.each([undefined,'2026-10-13T01:00:00Z'])('reader rejects V2 snapshot with missing or later cutoff %s',async cutoff=>{
 invalidateStyleProfileSnapshot('C');
 const row={user_id:'C',color_w:{mavi:1},subcategory_w:{},brand_w:{},fit_w:{},price_band_w:{},style_tag_weights:{},negative_preferences:[],event_count:1,computed_at:'2026-10-13T00:00:00Z'};
 const from=jest.fn((table:string)=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==='recs_config'?{value:{algorithm:'style-preference-v2',legacy_policy:'exclude_with_approval',activated_at:cutoff}}:row,error:null})};return q;});
 jest.mocked(getSupabaseClient).mockReturnValue({auth:{getUser:async()=>({data:{user:{id:'C'}},error:null}),getSession:async()=>({data:{session:{user:{id:'C'}}},error:null})},from} as never);
 await expect(fetchCalculatedStyleProfile('C')).rejects.toThrow('geçiş sürümü');
});
test('V2 client scoring uses a bounded empty fallback without repeated stale profile reads',async()=>{
 invalidateStyleProfileSnapshot('D');jest.mocked(isPreferenceV2Enabled).mockReturnValue(true);
 const from=jest.fn((table:string)=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==='recs_config'?{value:{algorithm:'style-preference-v2'}}:null,error:null})};return q;});
 jest.mocked(getSupabaseClient).mockReturnValue({auth:{getUser:async()=>({data:{user:{id:'D'}},error:null}),getSession:async()=>({data:{session:{user:{id:'D'}}},error:null})},from} as never);
 try {
   expect((await fetchStyleProfileSnapshot('D')).colorW).toEqual({});
   expect((await fetchStyleProfileSnapshot('D')).colorW).toEqual({});expect(from).toHaveBeenCalledTimes(2);
 } finally {jest.mocked(isPreferenceV2Enabled).mockReturnValue(false);invalidateStyleProfileSnapshot('D');}
});
test('local comparable calculation timings are recorded, not Android or network latency claims',()=>{
  const v2={...base,calculatedProfile:{state:'ready' as const,profile:calculated}};
  const iterations=1000;
  for(let i=0;i<100;i++){buildStyleJourney(base);buildStyleJourney(v2);}
  const measure=(input:typeof base|typeof v2)=>{const start=performance.now();for(let i=0;i<iterations;i++)buildStyleJourney(input);return performance.now()-start;};
  const baseline=measure(base),after=measure(v2);
  writeFileSync('reports/release/style-profile-local-performance-20261013.json',JSON.stringify({scope:'Node/Jest pure calculation; NOT Android/render/network',fixture:'same empty local inventory and one precomputed server event',iterations,baselineMs:baseline,afterMs:after,baselinePerCallMs:baseline/iterations,afterPerCallMs:after/iterations,discoverLoadMs:'NOT VERIFIED',recsRequests:'NOT VERIFIED',profileRenderMs:'NOT VERIFIED',memory:'NOT VERIFIED',uncachedCandidateQueriesForTwoReads:4,cachedQueriesForTwoReads:2},null,2));
  expect(buildStyleJourney(v2).percent).toEqual(buildStyleJourney(base).percent);
});
