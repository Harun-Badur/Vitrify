import { create } from 'zustand';
import { createWardrobeSlice } from '../store/wardrobeSlice';
import type { AppState } from '../store/useAppStore';
import type { WardrobeData } from '../services/wardrobeService';
import { loadWardrobe, saveWardrobe, storeWardrobePhoto } from '../services/wardrobeService';
import { track } from '../lib/analytics';

jest.mock('../services/wardrobeService', () => ({loadWardrobe:jest.fn(),saveWardrobe:jest.fn(),storeWardrobePhoto:jest.fn()}));
jest.mock('../services/wardrobeCutoutService', () => ({wardrobeCutoutConfigured:()=>false,createWardrobeCutout:jest.fn(),uploadWardrobeCutout:jest.fn()}));
jest.mock('../lib/analytics',()=>({track:jest.fn()}));
jest.mock('../lib/logger',()=>({logger:{debug:jest.fn(),warn:jest.fn(),error:jest.fn()}}));
const input = {title:'Fixture',brand:'Fixture',category:'upper_body' as const,imageUrl:'local-fixture'};
const makeStore = () => create<AppState>()((set,get,api)=>({
  ...createWardrobeSlice(set,get,api),sessionUserId:'A',
} as AppState));
beforeEach(()=>{
  jest.clearAllMocks();
  jest.mocked(loadWardrobe).mockReset();
  jest.mocked(saveWardrobe).mockReset();
  jest.mocked(loadWardrobe).mockResolvedValue({wardrobeItems:[],savedOutfits:[],wardrobeSync:{state:'synced',pending:0}});
  jest.mocked(storeWardrobePhoto).mockResolvedValue('local-copy');
  jest.mocked(saveWardrobe).mockImplementation(async (_owner,data)=>({...data,wardrobeSync:{state:'synced',pending:0}}));
});
test('real wardrobe add emits a distinct owner-bound ownership event after cloud commit',async()=>{
  const store=makeStore();await store.getState().hydrateWardrobe('A');
  await store.getState().addWardrobeItem(input);
  expect(track).toHaveBeenCalledTimes(1);
  expect(track).toHaveBeenCalledWith('dolap_add',store.getState().wardrobeItems[0].id,
    {source:'wardrobe'},expect.objectContaining({userId:'A',origin:'wardrobe',actionId:expect.any(String)}));
  expect(jest.mocked(track).mock.calls[0][3]?.actionId).not.toBe(store.getState().wardrobeItems[0].id);
});
test.each(['pending','conflict'] as const)('local %s result is preserved but not reported as committed',async state=>{
  jest.mocked(saveWardrobe).mockImplementation(async (_owner,data)=>({...data,wardrobeSync:{state,pending:1}}));
  const store=makeStore();await store.getState().hydrateWardrobe('A');await store.getState().addWardrobeItem(input);
  expect(store.getState().wardrobeItems).toHaveLength(1);expect(track).not.toHaveBeenCalled();
});
test('failed wardrobe save never emits committed ownership',async()=>{
  jest.mocked(saveWardrobe).mockRejectedValueOnce(Error('synthetic'));
  const store=makeStore();await store.getState().hydrateWardrobe('A');
  await expect(store.getState().addWardrobeItem(input)).rejects.toThrow();expect(track).not.toHaveBeenCalled();
});
test('cloud acknowledgement after account switch remains attributed to initiating owner',async()=>{
  let finish!: (data:WardrobeData)=>void;
  const pending = new Promise<WardrobeData>(resolve=>{finish=resolve;});
  jest.mocked(saveWardrobe).mockReturnValueOnce(pending);
  const store=makeStore();await store.getState().hydrateWardrobe('A');
  const writing=store.getState().addWardrobeItem(input);
  for(let i=0;i<12;i++) await Promise.resolve();
  const saved=jest.mocked(saveWardrobe).mock.calls[0][1];
  store.setState({sessionUserId:'B',wardrobeItems:[],savedOutfits:[]});
  finish({...saved,wardrobeSync:{state:'synced',pending:0}});await writing;
  expect(track).toHaveBeenCalledWith('dolap_add',saved.wardrobeItems[0].id,{source:'wardrobe'},
    expect.objectContaining({userId:'A',origin:'wardrobe'}));
  expect(store.getState().wardrobeItems).toEqual([]);
});

test('refresh reconciles pending data without clearing visible wardrobe', async () => {
  const store = makeStore(); await store.getState().hydrateWardrobe('A');
  await store.getState().addWardrobeItem(input);
  const previous = store.getState().wardrobeItems;
  let finish!: (data: WardrobeData) => void;
  jest.mocked(loadWardrobe).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const refreshing = store.getState().refreshWardrobe();
  for (let i=0;i<12;i++) await Promise.resolve();
  expect(store.getState().wardrobeItems).toEqual(previous);
  expect(store.getState().wardrobeStatus).toBe('ready');
  finish({wardrobeItems:previous,savedOutfits:[],wardrobeSync:{state:'synced',pending:0}});
  await refreshing;
  expect(store.getState().wardrobeSync?.state).toBe('synced');
});

test('refresh waits for queued saves and does not discard an edit', async () => {
  const store = makeStore(); await store.getState().hydrateWardrobe('A');
  await store.getState().addWardrobeItem(input);
  let finish!: (data: WardrobeData) => void;
  jest.mocked(saveWardrobe).mockReturnValueOnce(new Promise(resolve => { finish=resolve; }));
  const editing=store.getState().updateWardrobeItem(store.getState().wardrobeItems[0].id,{...input,title:'Updated'});
  for(let i=0;i<12;i++) await Promise.resolve();
  const calls=jest.mocked(loadWardrobe).mock.calls.length;
  const refreshing=store.getState().refreshWardrobe();
  for(let i=0;i<12;i++) await Promise.resolve();
  expect(loadWardrobe).toHaveBeenCalledTimes(calls);
  const saved=jest.mocked(saveWardrobe).mock.calls.at(-1)![1];
  jest.mocked(loadWardrobe).mockResolvedValueOnce(saved);
  finish(saved); await editing; await refreshing;
  expect(store.getState().wardrobeItems[0].title).toBe('Updated');
});

test('failed refresh keeps records and exposes pending instead of success', async () => {
  const store=makeStore();await store.getState().hydrateWardrobe('A');await store.getState().addWardrobeItem(input);
  const previous=store.getState().wardrobeItems;
  jest.mocked(loadWardrobe).mockRejectedValueOnce(Error('synthetic'));
  await store.getState().refreshWardrobe();
  expect(store.getState().wardrobeItems).toEqual(previous);
  expect(store.getState().wardrobeSync).toMatchObject({state:'pending',message:expect.any(String)});
});

test('old refresh does not publish into a new account', async () => {
  const store=makeStore();await store.getState().hydrateWardrobe('A');
  let finish!: (data: WardrobeData) => void;
  jest.mocked(loadWardrobe).mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
  const refreshing=store.getState().refreshWardrobe();
  for(let i=0;i<12;i++)await Promise.resolve();
  store.getState().invalidateWardrobeWork();store.setState({sessionUserId:'B',wardrobeItems:[],savedOutfits:[]});
  finish({wardrobeItems:[{...input,id:'old',createdAt:'2026-10-13'}],savedOutfits:[]});await refreshing;
  expect(store.getState().wardrobeItems).toEqual([]);
});

describe('personal wardrobe removal', () => {
  const seeded = async () => {
    const store = makeStore(); await store.getState().hydrateWardrobe('A');
    await store.getState().addWardrobeItem(input);
    jest.mocked(track).mockClear();
    return { store, id: store.getState().wardrobeItems[0].id };
  };

  test('emits one owner-bound dolap_remove after cloud commit', async () => {
    const { store, id } = await seeded();
    await store.getState().removeWardrobeItem(id);
    expect(store.getState().wardrobeItems).toEqual([]);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('dolap_remove', id, { source: 'wardrobe' },
      expect.objectContaining({ userId: 'A', origin: 'wardrobe', actionId: expect.any(String) }));
  });

  test('failed save never emits dolap_remove', async () => {
    const { store, id } = await seeded();
    jest.mocked(saveWardrobe).mockRejectedValueOnce(Error('synthetic'));
    await expect(store.getState().removeWardrobeItem(id)).rejects.toThrow();
    expect(track).not.toHaveBeenCalled();
  });

  test.each(['pending', 'conflict'] as const)('local %s result is not reported as committed', async state => {
    const { store, id } = await seeded();
    jest.mocked(saveWardrobe).mockImplementation(async (_owner, data) => ({ ...data, wardrobeSync: { state, pending: 1 } }));
    await store.getState().removeWardrobeItem(id);
    expect(track).not.toHaveBeenCalled();
  });

  test('removing an unknown id emits nothing', async () => {
    const { store } = await seeded();
    await store.getState().removeWardrobeItem('missing');
    expect(track).not.toHaveBeenCalled();
  });

  test('personal item carries no catalog attributes in the event, so profile weights stay unchanged', async () => {
    const { store, id } = await seeded();
    await store.getState().removeWardrobeItem(id);
    const [, productId, payload] = jest.mocked(track).mock.calls[0];
    expect(productId).toMatch(/^wardrobe-/);
    expect(payload).toEqual({ source: 'wardrobe' });
  });
});
