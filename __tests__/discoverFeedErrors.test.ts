import {fetchFeedProducts} from '../services/productService';
import {getSupabaseClient} from '../lib/supabase';
import {emptySessionIntent} from '../lib/scoring';
jest.mock('../lib/supabase',()=>({getSupabaseClient:jest.fn()}));
jest.mock('../lib/sessionIntent',()=>({buildIntent:()=>require('../lib/scoring').emptySessionIntent()}));
jest.mock('../lib/analytics',()=>({track:jest.fn()}));
jest.mock('../lib/logger',()=>({logger:{debug:jest.fn(),warn:jest.fn(),error:jest.fn()}}));
jest.mock('../lib/recsFeedState',()=>({setLastFeedMode:jest.fn(),setLastRecommendationId:jest.fn()}));
jest.mock('../lib/recsConfig',()=>({fetchRecsConfig:jest.fn(),fetchStyleProfileSnapshot:jest.fn()}));
jest.mock('../services/productRepository',()=>({productsById:jest.fn()}));
// Expo's build-time URL is not set under Jest; a fake local URL keeps the Edge path reachable without any real endpoint.
process.env.EXPO_PUBLIC_RECS_FEED_URL='http://localhost.invalid/recs-feed';
beforeEach(()=>{
  jest.mocked(getSupabaseClient).mockReturnValue({auth:{getSession:async()=>({data:{session:{access_token:'fake'}},error:null})}} as never);
});
afterEach(()=>jest.restoreAllMocks());
test.each([401,403,500])('Edge HTTP %s is an error, never an empty catalog fallback',async(status)=>{
  jest.spyOn(global,'fetch').mockResolvedValue({ok:false,status} as Response);
  await expect(fetchFeedProducts(20,'alice')).rejects.toMatchObject({code:status<500?'FEED_AUTH':'FEED_SERVER'});
});
test('network and malformed response are explicit errors',async()=>{
  const f=jest.spyOn(global,'fetch').mockRejectedValueOnce(Error('private provider detail'));
  await expect(fetchFeedProducts(20,'alice')).rejects.toMatchObject({code:'FEED_NETWORK'});
  f.mockResolvedValueOnce({ok:true,json:async()=>({})} as Response);
  await expect(fetchFeedProducts(20,'alice')).rejects.toMatchObject({code:'FEED_RESPONSE'});
});
test('valid empty final page remains successful exhaustion',async()=>{
  jest.spyOn(global,'fetch').mockResolvedValue({ok:true,json:async()=>({recommendation_id:'r',score_id:'s',config_version:'v',items:[],has_more:false})} as Response);
  await expect(fetchFeedProducts(20,'alice')).resolves.toMatchObject({products:[],source:'edge',hasMore:false});
});
test('session lookup error is not unavailable-edge success',async()=>{
  jest.mocked(getSupabaseClient).mockReturnValue({auth:{getSession:async()=>({data:{session:null},error:{message:'private'}})}} as never);
  await expect(fetchFeedProducts(20,'alice')).rejects.toMatchObject({code:'FEED_AUTH'});
});
test('a cold-start response after 1.2 seconds is accepted without retry or catalog fallback', async () => {
  jest.useFakeTimers();
  try {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation((_url, options) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ ok: true, json: async () => ({ recommendation_id: 'r', score_id: 's', config_version: 'v', items: [], has_more: false }) } as Response), 2000);
      options?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
    }));
    const assertion = expect(fetchFeedProducts(20, 'alice')).resolves.toMatchObject({ products: [], source: 'edge' });
    await jest.advanceTimersByTimeAsync(2100);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});
test('an actual deadline remains a visible bounded timeout without retry', async () => {
  jest.useFakeTimers();
  try {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const result = fetchFeedProducts(20, 'alice').then(() => null, error => error);
    await jest.advanceTimersByTimeAsync(10_001);
    expect(await result).toMatchObject({ code: 'FEED_TIMEOUT' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});
