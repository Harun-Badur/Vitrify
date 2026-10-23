import {create} from 'zustand';
import {createDiscoverySlice} from '../store/discoverySlice';
import {MOCK_PRODUCTS} from '../data/mockProducts';
import {insertPassedProduct,deletePassedProduct} from '../services/likeService';
import {fetchFeedProducts} from '../services/productService';
import {track} from '../lib/analytics';
jest.mock('../services/likeService',()=>({insertPassedProduct:jest.fn(),deletePassedProduct:jest.fn()}));
jest.mock('../services/productService',()=>({fetchFeedProducts:jest.fn()}));
jest.mock('../lib/analytics',()=>({track:jest.fn()}));
jest.mock('../lib/sessionIntent',()=>({recordSessionProductAction:jest.fn()}));
jest.mock('../lib/logger',()=>({logger:{debug:jest.fn(),warn:jest.fn(),error:jest.fn()}}));
const product=MOCK_PRODUCTS[0];
const deferred=()=>{let resolve!:()=>void; const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
let store:any;
beforeEach(()=>{
  jest.clearAllMocks();
  jest.mocked(insertPassedProduct).mockResolvedValue(undefined);
  jest.mocked(deletePassedProduct).mockResolvedValue(undefined);
  store=create((set,get,api)=>({...createDiscoverySlice(set as never,get as never,api as never),
    sessionUserId:'alice',likedProducts:[],currentProducts:[product]}));
});
test('undo waits for pass acknowledgement and delete, concurrent repeat shares one request',async()=>{
  const pass=deferred(),remove=deferred();
  jest.mocked(insertPassedProduct).mockReturnValue(pass.promise);
  jest.mocked(deletePassedProduct).mockReturnValue(remove.promise);
  store.getState().swipeLeft(product);
  const a=store.getState().undoPass(),b=store.getState().undoPass();
  expect(store.getState().passedProductIds).toEqual([product.id]);
  expect(deletePassedProduct).not.toHaveBeenCalled();
  pass.resolve();await flush();expect(deletePassedProduct).toHaveBeenCalledTimes(1);
  remove.resolve();expect(await a).toBe(true);expect(await b).toBe(true);
  expect(store.getState().currentProducts).toEqual([product]);
  expect(store.getState().passedStack).toEqual([]);
});
test('offline delete rejects, retains pass and retry succeeds',async()=>{
  store.getState().swipeLeft(product);await flush();
  jest.mocked(deletePassedProduct).mockRejectedValueOnce(Error('offline'));
  await expect(store.getState().undoPass()).rejects.toThrow();
  expect(store.getState().passedStack).toEqual([product]);
  expect(store.getState().currentProducts).toEqual([]);
  expect(await store.getState().undoPass()).toBe(true);
});
test('old undo completion cannot publish into another owner',async()=>{
  store.getState().swipeLeft(product);await flush();const d=deferred();
  jest.mocked(deletePassedProduct).mockReturnValue(d.promise);
  const undo=store.getState().undoPass();await flush();
  store.getState().invalidateDiscoveryWork();
  store.setState({sessionUserId:'bob',currentProducts:[],passedProductIds:[],passedStack:[]});
  d.resolve();expect(await undo).toBe(false);expect(store.getState().currentProducts).toEqual([]);
  expect(deletePassedProduct).toHaveBeenCalledWith('alice',product.id);
});
test('like during undo never restores a liked card',async()=>{
  store.getState().swipeLeft(product);await flush();const d=deferred();jest.mocked(deletePassedProduct).mockReturnValue(d.promise);
  const undo=store.getState().undoPass();await flush();
  store.setState({likedProducts:[{product}],passedStack:[],passedProductIds:[]});
  d.resolve();await undo;expect(store.getState().currentProducts).toEqual([]);
});
test('new pass during undo wins over old completion',async()=>{
  store.getState().swipeLeft(product);await flush();const d=deferred();jest.mocked(deletePassedProduct).mockReturnValue(d.promise);
  const undo=store.getState().undoPass();await flush();store.getState().swipeLeft(product);
  d.resolve();expect(await undo).toBe(false);expect(store.getState().passedProductIds).toEqual([product.id]);
});
test('new pass before original acknowledgement prevents the old undo from deleting it',async()=>{
  const d=deferred();jest.mocked(insertPassedProduct).mockReturnValueOnce(d.promise);
  store.getState().swipeLeft(product);const undo=store.getState().undoPass();
  store.getState().swipeLeft(product);d.resolve();await flush();
  expect(await undo).toBe(false);expect(deletePassedProduct).not.toHaveBeenCalled();
  expect(store.getState().passedProductIds).toEqual([product.id]);
});
test('explicit continuation retry preserves old deck and append order',async()=>{
  jest.mocked(fetchFeedProducts).mockResolvedValueOnce({products:[product],source:'supabase',isPersonalized:false,hasMore:true});
  await store.getState().loadFeed('alice');
  jest.mocked(fetchFeedProducts).mockRejectedValueOnce(Error('offline'));
  await store.getState().loadMoreFeed();expect(store.getState().feedStatus).toBe('error');
  jest.mocked(fetchFeedProducts).mockResolvedValueOnce({products:[MOCK_PRODUCTS[1]],source:'supabase',isPersonalized:false,hasMore:false});
  await store.getState().loadMoreFeed();expect(store.getState().feedStatus).toBe('success');
  expect(store.getState().currentProducts).toEqual([product,MOCK_PRODUCTS[1]]);
});
test('feed failure retains deck and subsequent explicit reload succeeds',async()=>{
  jest.mocked(fetchFeedProducts).mockRejectedValueOnce(Error('server'));
  await store.getState().loadFeed('alice');expect(store.getState().feedStatus).toBe('error');
  expect(store.getState().currentProducts).toEqual([product]);
  jest.mocked(fetchFeedProducts).mockResolvedValueOnce({products:[product],source:'supabase',isPersonalized:false,hasMore:false});
  await store.getState().loadFeed('alice');expect(store.getState().feedStatus).toBe('success');
});
test('pass emits owner-bound committed evidence only after the write succeeds',async()=>{
  const writing=deferred();jest.mocked(insertPassedProduct).mockReturnValueOnce(writing.promise);
  store.getState().swipeLeft(product);expect(track).not.toHaveBeenCalled();
  writing.resolve();await flush();
  expect(track).toHaveBeenCalledWith('pass',product.id,{source:'feed'},expect.objectContaining({userId:'alice',origin:'pass',actionId:expect.any(String)}));
});
test('failed pass produces no committed event',async()=>{
  jest.mocked(insertPassedProduct).mockRejectedValueOnce(Error('offline'));
  store.getState().swipeLeft(product);await flush();expect(track).not.toHaveBeenCalled();
});
test('rapid pass undo retains only the real pass event; SQL cancellation remains unsupported',async()=>{
  const writing=deferred();jest.mocked(insertPassedProduct).mockReturnValueOnce(writing.promise);
  store.getState().swipeLeft(product);const undo=store.getState().undoPass();
  writing.resolve();await undo;await flush();
  expect(jest.mocked(track).mock.calls.map(call=>call[0])).toEqual(['pass']);
  expect(store.getState().passedProductIds).toEqual([]);
});
