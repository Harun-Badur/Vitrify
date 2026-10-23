import { readFileSync } from 'fs';
import { join } from 'path';
import { createElement } from 'react';
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createDiscoverySlice, type DiscoverySlice } from '../store/discoverySlice';
import { getRequiredSupabaseClient } from '../lib/supabase';
import { fetchFeedProducts } from '../services/productService';
import { MOCK_PRODUCTS } from '../data/mockProducts';
import type { AppState } from '../store/useAppStore';

let mockV2Enabled = false;
jest.mock('../lib/preferenceFeatureFlags', () => ({ isPreferenceV2Enabled: () => mockV2Enabled }));
jest.mock('../lib/supabase', () => ({ getRequiredSupabaseClient: jest.fn() }));
jest.mock('../services/productService', () => ({ fetchFeedProducts: jest.fn() }));
jest.mock('../lib/analytics', () => ({ track: jest.fn(), getAnalyticsSessionId: () => '20000000-0000-4000-8000-000000000001' }));
jest.mock('../lib/sessionIntent', () => ({ recordSessionProductAction: jest.fn() }));
jest.mock('../lib/recsConfig', () => ({ invalidateStyleProfileSnapshot: jest.fn() }));
jest.mock('../lib/logger', () => ({ logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const renderer = jest.requireActual('react-test-renderer') as typeof import('react-test-renderer');
const owner = '00000000-0000-4000-8000-000000000001';
const products = Array.from({ length: 24 }, (_, i) => ({ ...MOCK_PRODUCTS[0], id: `browse-${i}` }));
const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
const preview = () => JSON.parse(readFileSync(join(__dirname, '..', 'eas.json'), 'utf8')).build.preview;

function backend() {
  const directWrites: string[] = [];
  const rpcOperations: string[] = [];
  const ledger: Record<string, unknown>[] = [];
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: owner } }, error: null }),
      getSession: async () => ({ data: { session: { user: { id: owner }, access_token: 'synthetic-test-token' } }, error: null }),
    },
    from: (table: string) => {
      let id = '';
      const q = {
        select: () => q, eq: (column: string, value: string) => { if (column === 'product_id') id = value; return q; },
        order: () => q, range: () => q, setHeader: () => q,
        maybeSingle: async () => ({ data: null, error: null }),
        upsert: async () => { directWrites.push(table); return { error: { code: '42501' } }; },
        delete: () => { directWrites.push(table); return { eq: () => ({ eq: async () => ({ error: { code: '42501' } }) }) }; },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: ledger.filter(row => row.product_id === id), error: null }).then(resolve),
      };
      return q;
    },
    rpc: (_name: string, args: Record<string, unknown>) => {
      rpcOperations.push(args.p_operation as string);
      ledger.push({ user_id: owner, product_id: args.p_product, action_id: args.p_action, kind: args.p_operation, revokes: args.p_expected ?? [] });
      const result = { data: { action_id: args.p_action, replayed: false }, error: null };
      const q = { setHeader: () => q, then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
      return q;
    },
  };
  jest.mocked(getRequiredSupabaseClient).mockReturnValue(client as never);
  return { directWrites, rpcOperations };
}

describe('Preview build writer selection and rendered active product', () => {
  let tree: ReturnType<typeof renderer.create>;
  const makeStore = () => create<DiscoverySlice & Pick<AppState, 'sessionUserId' | 'likedProducts'>>()((set, get, api) => ({
    ...createDiscoverySlice(set as never, get as never, api as never), sessionUserId: owner, likedProducts: [],
  }));
  let store: ReturnType<typeof makeStore>;
  let rendered: Array<string | null>;
  function ActiveCard() {
    const id = store(state => state.currentProducts[0]?.id ?? null);
    rendered.push(id);
    return createElement('ActiveCard', { productId: id, pageIndex: 0 });
  }
  const expectActive = (id: string | null) => {
    expect(tree.root.findByType('ActiveCard' as never).props.productId).toBe(id);
    expect(store.getState().currentProducts[0]?.id ?? null).toBe(id);
  };
  beforeEach(async () => {
    jest.clearAllMocks(); await AsyncStorage.clear(); mockV2Enabled = false;
    store = makeStore(); rendered = [];
    await renderer.act(async () => { store.setState({ currentProducts: products.slice(0, 3) }); tree = renderer.create(createElement(ActiveCard)); });
  });
  afterEach(async () => { await renderer.act(async () => { tree.unmount(); }); });

  it('reproduces A -> B -> A in the store and render when the build selects denied legacy DML', async () => {
    const b = backend();
    await renderer.act(async () => { store.getState().swipeLeft(products[0]); });
    await renderer.act(flush);
    expect(rendered).toEqual([products[0].id, products[1].id, products[0].id]);
    expectActive(products[0].id);
    expect(store.getState().passedStack).toEqual([]);
    expect(store.getState().undoPass()).toBe(false);
    expect(b.directWrites).toEqual(['passed_products']);
    expect(b.rpcOperations).toEqual([]);
  });

  it('uses the preview V2 build flag for A -> B -> C -> B -> A, 20 forward transitions, pagination and exhaustion', async () => {
    const config = preview();
    expect(config.environment).toBe('preview');
    expect(config.env?.EXPO_PUBLIC_PREFERENCE_V2_ENABLED).toBe('true');
    mockV2Enabled = config.env.EXPO_PUBLIC_PREFERENCE_V2_ENABLED === 'true';
    const b = backend();
    jest.mocked(fetchFeedProducts).mockResolvedValueOnce({ products: products.slice(0, 3), source: 'supabase', isPersonalized: false, hasMore: true });
    await renderer.act(async () => { await store.getState().loadFeed(owner); });
    const forward = async () => {
      const nextId = store.getState().currentProducts[1]?.id ?? null;
      await renderer.act(async () => { store.getState().swipeLeft(store.getState().currentProducts[0]); });
      expectActive(nextId);
      await renderer.act(flush);
      expectActive(nextId); // Acknowledgement must not restore the previous product.
    };
    await forward(); await forward(); expectActive(products[2].id);
    for (const id of [products[1].id, products[0].id]) {
      await renderer.act(async () => { expect(await store.getState().undoPass()).toBe(true); });
      expectActive(id);
    }
    jest.mocked(fetchFeedProducts).mockResolvedValueOnce({ products: [products[2], ...products.slice(3)], source: 'supabase', isPersonalized: false, hasMore: false });
    const visited: string[] = [];
    for (let step = 0; step < 20; step++) {
      visited.push(store.getState().currentProducts[0].id);
      if (step === 1) {
        const active = store.getState().currentProducts[0].id;
        await renderer.act(async () => { await Promise.all([store.getState().loadMoreFeed(), store.getState().loadMoreFeed()]); });
        expectActive(active);
      }
      await forward();
    }
    expect(new Set(visited).size).toBe(20);
    while (store.getState().currentProducts.length) await forward();
    expectActive(null); expect(store.getState().hasMore).toBe(false);
    expect(b.directWrites).toEqual([]);
    expect(b.rpcOperations).toContain('pass'); expect(b.rpcOperations).toContain('undo_pass');
  });
});
