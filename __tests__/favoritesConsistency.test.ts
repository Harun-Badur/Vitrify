import {create} from 'zustand';
import {createFavoritesSlice} from '../store/favoritesSlice';
import {MOCK_PRODUCTS} from '../data/mockProducts';
import {deleteLikedProduct,fetchLikedProducts,insertLikedProduct} from '../services/likeService';
import {track} from '../lib/analytics';
import {recordSessionProductAction} from '../lib/sessionIntent';
import {PreferenceTransactionError} from '../services/preferenceTransactionAdapter';
jest.mock('../services/likeService',()=>({deleteLikedProduct:jest.fn(),fetchLikedProducts:jest.fn(),insertLikedProduct:jest.fn(),updateLikedProductAlert:jest.fn()}));
jest.mock('../lib/analytics',()=>({track:jest.fn()}));
jest.mock('../lib/sessionIntent',()=>({recordSessionProductAction:jest.fn()}));
jest.mock('../lib/logger',()=>({logger:{debug:jest.fn(),warn:jest.fn(),error:jest.fn()}}));
const p=MOCK_PRODUCTS[0],like={product:p,notifyOnPriceDrop:true,likedAt:'2026-01-01'};
function deferred<T>() {let resolve!:(v:T)=>void,reject!:(v:unknown)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};}
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
let store:any;
beforeEach(()=>{jest.clearAllMocks();jest.mocked(insertLikedProduct).mockResolvedValue(undefined);jest.mocked(deleteLikedProduct).mockResolvedValue(undefined);
  store=create((set,get,api)=>({...createFavoritesSlice(set as never,get as never,api as never),sessionUserId:'alice',currentProducts:[p],passedProductIds:[],passedStack:[]}));});
test('failed add reports error and retry is possible without duplicates',async()=>{
  jest.mocked(insertLikedProduct).mockRejectedValueOnce(Error('offline'));
  store.getState().swipeRight(p);await flush();
  expect(store.getState().likedProducts).toEqual([]);expect(store.getState().favoritesStatus).toBe('error');
  store.getState().swipeRight(p);await flush();expect(store.getState().likedProducts).toHaveLength(1);
});
test('a catalog favorite feeds the session profile with its catalog id',async()=>{
  store.getState().swipeRight(p);await flush();
  expect(recordSessionProductAction).toHaveBeenCalledWith('dolap_add',p);
  expect(track).toHaveBeenCalledWith('dolap_add',p.id,{source:'feed'},expect.objectContaining({origin:'favorite'}));
});
test('remove waits for backend; failure keeps existing favorite and explicit retry works',async()=>{
  const d=deferred<void>();jest.mocked(deleteLikedProduct).mockReturnValueOnce(d.promise);store.setState({likedProducts:[like]});
  const removing=store.getState().unlikeProduct(p.id);expect(store.getState().likedProducts).toEqual([like]);
  d.reject(Error('offline'));await expect(removing).rejects.toThrow();expect(store.getState().likedProducts).toEqual([like]);
  await store.getState().unlikeProduct(p.id);expect(store.getState().likedProducts).toEqual([]);
});
test('old add failure cannot remove a newer add',async()=>{
  const d=deferred<void>();jest.mocked(insertLikedProduct).mockReturnValueOnce(d.promise);
  store.getState().swipeRight(p);store.getState().swipeRight(p);await flush();d.reject(Error('old'));await flush();
  expect(store.getState().likedProducts).toHaveLength(1);
});
test('remove completion cannot erase a newer like',async()=>{
  const d=deferred<void>();jest.mocked(deleteLikedProduct).mockReturnValueOnce(d.promise);store.setState({likedProducts:[like]});
  const removing=store.getState().unlikeProduct(p.id);store.getState().swipeRight(p);d.resolve();await removing;
  expect(store.getState().likedProducts).toHaveLength(1);
});
test('stale refresh cannot overwrite local add; failed refresh preserves list',async()=>{
  const d=deferred<any>();jest.mocked(fetchLikedProducts).mockReturnValueOnce(d.promise);
  const refreshing=store.getState().refreshLikedProducts();await flush();store.getState().swipeRight(p);d.resolve([]);await refreshing;
  expect(store.getState().likedProducts).toHaveLength(1);
  jest.mocked(fetchLikedProducts).mockRejectedValueOnce(Error('offline'));
  await expect(store.getState().refreshLikedProducts()).rejects.toThrow();expect(store.getState().likedProducts).toHaveLength(1);
});
test('refresh waits for own pending writes and reverse-order refresh does not publish old data',async()=>{
  const writing=deferred<void>();jest.mocked(insertLikedProduct).mockReturnValueOnce(writing.promise);store.getState().swipeRight(p);
  jest.mocked(fetchLikedProducts).mockResolvedValueOnce([like]);const waiting=store.getState().refreshLikedProducts();await flush();
  expect(fetchLikedProducts).not.toHaveBeenCalled();writing.resolve();await waiting;
  const old=deferred<any>();jest.mocked(fetchLikedProducts).mockReturnValueOnce(old.promise).mockResolvedValueOnce([like]);
  const one=store.getState().refreshLikedProducts();await flush();await store.getState().refreshLikedProducts();old.resolve([]);await one;
  expect(store.getState().likedProducts).toEqual([like]);
});
test('old owner write failure and read result cannot change the new owner',async()=>{
  const d=deferred<void>();jest.mocked(insertLikedProduct).mockReturnValueOnce(d.promise);store.getState().swipeRight(p);
  store.setState({sessionUserId:'bob',likedProducts:[like],currentProducts:[]});d.reject(Error('old'));await flush();
  expect(store.getState().likedProducts).toEqual([like]);expect(store.getState().currentProducts).toEqual([]);
});
test('partial like commit preserves committed favorite and exposes pass cleanup failure',async()=>{
  const error=Object.assign(Error('partial'),{likeCommitted:true});jest.mocked(insertLikedProduct).mockRejectedValueOnce(error);
  store.setState({passedProductIds:[p.id],passedStack:[p]});store.getState().swipeRight(p);await flush();
  expect(store.getState().likedProducts).toHaveLength(1);expect(store.getState().favoritesStatus).toBe('error');
  expect(store.getState().passedProductIds).toEqual([p.id]);
});
test('fresh store reloads favorites from backend and a late old-owner read cannot publish',async()=>{
  jest.mocked(fetchLikedProducts).mockResolvedValueOnce([like]);await store.getState().refreshLikedProducts();
  expect(store.getState().likedProducts).toEqual([like]);
  const old=deferred<any>();jest.mocked(fetchLikedProducts).mockReturnValueOnce(old.promise);
  const loading=store.getState().refreshLikedProducts();await flush();
  store.setState({sessionUserId:'bob',likedProducts:[]});old.resolve([like]);await loading;
  expect(store.getState().likedProducts).toEqual([]);
});
test('favorite emits its unchanged pair only after commit with one owner-bound action',async()=>{
  const writing=deferred<void>();jest.mocked(insertLikedProduct).mockReturnValueOnce(writing.promise);
  store.getState().swipeRight(p);expect(track).not.toHaveBeenCalled();
  writing.resolve();await flush();
  const calls=jest.mocked(track).mock.calls;
  expect(calls.map(call=>call[0])).toEqual(['like','dolap_add']);
  expect(calls[0][3]).toMatchObject({userId:'alice',origin:'favorite',actionId:expect.any(String)});
  expect(calls[1][3]).toEqual(calls[0][3]);
});
test('independent favorite actions receive different IDs; failed write emits no committed evidence',async()=>{
  store.getState().swipeRight(p);await flush();
  store.getState().swipeRight(p);await flush();
  expect(jest.mocked(track).mock.calls[0][3]?.actionId).not.toBe(jest.mocked(track).mock.calls[2][3]?.actionId);
  jest.mocked(track).mockClear();jest.mocked(insertLikedProduct).mockRejectedValueOnce(Error('offline'));
  store.getState().swipeRight(p);await flush();expect(track).not.toHaveBeenCalled();
});
test('rapid unlike does not invent an SQL undo event or erase the real prior commit',async()=>{
  const writing=deferred<void>();jest.mocked(insertLikedProduct).mockReturnValueOnce(writing.promise);
  store.getState().swipeRight(p);const removing=store.getState().unlikeProduct(p.id);
  writing.resolve();await removing;await flush();
  expect(jest.mocked(track).mock.calls.map(call=>call[0])).toEqual(['like','dolap_add']);
  expect(store.getState().likedProducts).toEqual([]);
});
test('old-owner successful commit keeps its initiating owner in analytics, never new owner',async()=>{
  const writing=deferred<void>();jest.mocked(insertLikedProduct).mockReturnValueOnce(writing.promise);
  store.getState().swipeRight(p);store.setState({sessionUserId:'bob',likedProducts:[]});
  writing.resolve();await flush();
  expect(jest.mocked(track).mock.calls.every(call=>call[3]?.userId==='alice')).toBe(true);
  expect(jest.mocked(track).mock.calls).toHaveLength(2);expect(store.getState().likedProducts).toEqual([]);
});
test('partial like commit still proves the favorite pair when pass cleanup fails',async()=>{
  jest.mocked(insertLikedProduct).mockRejectedValueOnce(Object.assign(Error('partial'),{likeCommitted:true}));
  store.getState().swipeRight(p);await flush();
  expect(jest.mocked(track).mock.calls.map(call=>call[0])).toEqual(['like','dolap_add']);
  expect(store.getState().favoritesStatus).toBe('error');
});

test('transactional favorite keeps UI success without duplicating server analytics',async()=>{
  jest.mocked(insertLikedProduct).mockResolvedValueOnce({mode:'v2',actionId:'server-action',replayed:false,serverEvents:true});
  store.getState().swipeRight(p);await flush();
  expect(store.getState().likedProducts).toHaveLength(1);
  expect(track).not.toHaveBeenCalled();
});

test('atomic RPC failure rolls back optimistic favorite and emits no committed evidence',async()=>{
  jest.mocked(insertLikedProduct).mockRejectedValueOnce(Object.assign(Error('rejected'),{code:'RPC_REJECTED'}));
  store.getState().swipeRight(p);await flush();
  expect(store.getState().likedProducts).toEqual([]);
  expect(store.getState().favoritesStatus).toBe('error');
  expect(track).not.toHaveBeenCalled();
});

test('late transactional favorite cannot publish into the new account',async()=>{
  const writing=deferred<Awaited<ReturnType<typeof insertLikedProduct>>>();
  jest.mocked(insertLikedProduct).mockReturnValueOnce(writing.promise);
  store.getState().swipeRight(p);store.setState({sessionUserId:'bob',likedProducts:[]});
  writing.resolve({mode:'v2',actionId:'server-action',replayed:false,serverEvents:true});await flush();
  expect(store.getState().likedProducts).toEqual([]);expect(track).not.toHaveBeenCalled();
});
test('unknown commit is exposed as unverified rather than definitive failure',async()=>{
  jest.mocked(insertLikedProduct).mockRejectedValueOnce(new PreferenceTransactionError('RESULT_UNVERIFIED'));
  store.getState().swipeRight(p);await flush();
  expect(store.getState().favoritesError).toContain('henüz doğrulanamadı');
  expect(store.getState().favoritesStatus).toBe('error');expect(track).not.toHaveBeenCalled();
});
