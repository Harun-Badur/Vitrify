import AsyncStorage from '@react-native-async-storage/async-storage';
import { createElement } from 'react';
import { Pressable, Text } from 'react-native';
import type { ReactTestRenderer } from 'react-test-renderer';
import ProductPrefChoiceScreen from '../components/ProductPrefChoiceScreen';
import ProductPrefSetting from '../components/ProductPrefSetting';
import {
  PRODUCT_PREF_PROMPT_COUNT_KEY, productPrefLabel, productPrefStorageKey, shouldShowProductPrefPrompt,
  type ProductPref, type ProductPrefProfileGateway,
} from '../lib/productPreference';
import { resetAccountWriteFenceMemoryForTests } from '../lib/accountWriteFence';
import { resetDeviceWorkForTests } from '../lib/accountDeviceWork';
import { getRequiredSupabaseClient } from '../lib/supabase';
import { supabaseProductPrefGateway } from '../services/productPrefProfileGateway';
import { chooseProductPref, endProductPrefSession, skipProductPrefPrompt, startProductPrefSession } from '../services/productPrefSync';
import { useAppStore } from '../store/useAppStore';

jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///docs/', cacheDirectory: 'file:///cache/' }));
jest.mock('lucide-react-native', () => ({ Check: 'Icon' }));
jest.mock('../components/PressableScale', () => 'PressableScale');
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('../lib/supabase', () => ({ getRequiredSupabaseClient: jest.fn() }));
const { create, act } = jest.requireActual<typeof import('react-test-renderer')>('react-test-renderer');

const gateway = (profileValue: unknown = null) => ({
  read: jest.fn(async (_userId: string): Promise<unknown> => profileValue),
  write: jest.fn(async (_userId: string, _pref: ProductPref): Promise<void> => undefined),
}) satisfies ProductPrefProfileGateway;
const failing = () => ({
  read: jest.fn(async (_userId: string): Promise<unknown> => { throw new Error('network'); }),
  write: jest.fn(async (_userId: string, _pref: ProductPref): Promise<void> => { throw new Error('network'); }),
}) satisfies ProductPrefProfileGateway;
const flush = () => new Promise(resolve => setImmediate(resolve));
const realSetProductPref = useAppStore.getState().setProductPref;

beforeEach(async () => {
  await AsyncStorage.clear();
  resetDeviceWorkForTests(); resetAccountWriteFenceMemoryForTests();
  endProductPrefSession();
  useAppStore.setState({ productPref: null, productPrefPromptCount: 0, setProductPref: realSetProductPref });
});

describe('choice screen display rules', () => {
  it('pure rule: only while unchosen and shown fewer than twice', () => {
    expect(shouldShowProductPrefPrompt(null, 0)).toBe(true);
    expect(shouldShowProductPrefPrompt(null, 1)).toBe(true);
    expect(shouldShowProductPrefPrompt(null, 2)).toBe(false);
    expect(shouldShowProductPrefPrompt('hepsi', 0)).toBe(false);
  });
  it('first launch with nothing chosen anywhere shows the screen', async () => {
    await expect(startProductPrefSession('A', gateway())).resolves.toBe('prompt');
    expect(useAppStore.getState().productPref).toBeNull();
  });
  it('"Şimdi değil" twice stops the screen for good and keeps the preference NULL', async () => {
    await expect(startProductPrefSession('A', gateway())).resolves.toBe('prompt');
    await skipProductPrefPrompt();
    await expect(startProductPrefSession('A', gateway())).resolves.toBe('prompt');
    await skipProductPrefPrompt();
    useAppStore.setState({ productPrefPromptCount: 0 });
    await expect(startProductPrefSession('A', gateway())).resolves.toBe('done');
    expect(await AsyncStorage.getItem(PRODUCT_PREF_PROMPT_COUNT_KEY)).toBe('2');
    expect(useAppStore.getState().productPref).toBeNull();
    expect(await AsyncStorage.getItem(productPrefStorageKey('A'))).toBeNull();
  });
  it('a choice closes it for good and persists locally and to the profile', async () => {
    const g = gateway();
    await expect(startProductPrefSession('A', g)).resolves.toBe('prompt');
    await chooseProductPref('A', 'kadin', g);
    expect(useAppStore.getState().productPref).toBe('kadin');
    expect(await AsyncStorage.getItem(productPrefStorageKey('A'))).toBe('kadin');
    expect(g.write).toHaveBeenCalledWith('A', 'kadin');
    useAppStore.setState({ productPref: null });
    await expect(startProductPrefSession('A', gateway('kadin'))).resolves.toBe('done');
    expect(useAppStore.getState().productPref).toBe('kadin');
  });
  it('a value chosen on another device (profile only) skips the screen and is stored locally', async () => {
    await expect(startProductPrefSession('A', gateway('erkek'))).resolves.toBe('done');
    expect(useAppStore.getState().productPref).toBe('erkek');
    expect(await AsyncStorage.getItem(productPrefStorageKey('A'))).toBe('erkek');
  });
  it('a stale sync never overrides a newer choice', async () => {
    let release!: (value: unknown) => void;
    const slow: ProductPrefProfileGateway = { read: () => new Promise(resolve => { release = resolve; }), write: jest.fn(async () => undefined) };
    await AsyncStorage.setItem(productPrefStorageKey('A'), 'hepsi');
    await expect(startProductPrefSession('A', slow)).resolves.toBe('done');
    await chooseProductPref('A', 'kadin', slow);
    release('erkek'); await flush();
    expect(useAppStore.getState().productPref).toBe('kadin');
  });
});

describe('gateway failure keeps the local value', () => {
  it('read failure: local value applies and the profile is not overwritten', async () => {
    await AsyncStorage.setItem(productPrefStorageKey('A'), 'erkek');
    const g = failing();
    await expect(startProductPrefSession('A', g)).resolves.toBe('done');
    await flush();
    expect(useAppStore.getState().productPref).toBe('erkek');
    expect(g.write).not.toHaveBeenCalled();
  });
  it('read failure with nothing local still shows the screen', async () => {
    await expect(startProductPrefSession('A', failing())).resolves.toBe('prompt');
  });
  it('a hanging read times out to the local value', async () => {
    const hang: ProductPrefProfileGateway = { read: () => new Promise(() => {}), write: jest.fn() };
    await expect(startProductPrefSession('A', hang, 10)).resolves.toBe('prompt');
  });
  it('write failure: the choice still applies and stays local', async () => {
    await expect(chooseProductPref('A', 'erkek', failing())).resolves.toBeUndefined();
    expect(useAppStore.getState().productPref).toBe('erkek');
    expect(await AsyncStorage.getItem(productPrefStorageKey('A'))).toBe('erkek');
  });
});

describe('Supabase gateway', () => {
  const client = (sessionUserId: string | null, result: { data?: unknown; error?: unknown }) => {
    interface Query { select: jest.Mock; update: jest.Mock; eq: jest.Mock; maybeSingle: jest.Mock; then: (resolve: (value: unknown) => void) => void }
    const query: Query = {
      select: jest.fn(() => query), update: jest.fn(() => query), eq: jest.fn(() => query),
      maybeSingle: jest.fn(async () => result), then: (resolve: (value: unknown) => void) => resolve(result),
    };
    const from = jest.fn(() => query);
    jest.mocked(getRequiredSupabaseClient).mockReturnValue({
      auth: { getSession: async () => ({ data: { session: sessionUserId ? { user: { id: sessionUserId } } : null } }) }, from,
    } as never);
    return { from, query };
  };
  it('reads only the signed-in user row', async () => {
    const { from, query } = client('A', { data: { product_gender_pref: 'kadin' }, error: null });
    await expect(supabaseProductPrefGateway.read('A')).resolves.toBe('kadin');
    expect(from).toHaveBeenCalledWith('profiles');
    expect(query.select).toHaveBeenCalledWith('product_gender_pref');
    expect(query.eq).toHaveBeenCalledWith('id', 'A');
  });
  it('writes only the signed-in user row', async () => {
    const { query } = client('A', { error: null });
    await supabaseProductPrefGateway.write('A', 'erkek');
    expect(query.update).toHaveBeenCalledWith({ product_gender_pref: 'erkek' });
    expect(query.eq).toHaveBeenCalledWith('id', 'A');
  });
  it('refuses another user and surfaces query errors', async () => {
    const { from } = client('B', { data: null, error: null });
    await expect(supabaseProductPrefGateway.read('A')).rejects.toThrow();
    await expect(supabaseProductPrefGateway.write('A', 'kadin')).rejects.toThrow();
    expect(from).not.toHaveBeenCalled();
    client('A', { data: null, error: { message: 'denied' } });
    await expect(supabaseProductPrefGateway.read('A')).rejects.toThrow();
    await expect(supabaseProductPrefGateway.write('A', 'kadin')).rejects.toThrow();
  });
});

describe('choice screen', () => {
  it('asks the question with three labelled options and "Şimdi değil"', async () => {
    const onSelect = jest.fn(), onSkip = jest.fn(); let view!: ReactTestRenderer;
    await act(() => { view = create(createElement(ProductPrefChoiceScreen, { onSelect, onSkip })); });
    expect(view.root.findAllByType(Text).some(node => node.props.children === 'Ne tür ürünler görmek istersin?')).toBe(true);
    for (const label of ['Kadın', 'Erkek', 'Hepsi']) expect(view.root.findByProps({ accessibilityLabel: label })).toBeDefined();
    await act(async () => view.root.findByProps({ accessibilityLabel: 'Erkek' }).props.onPress());
    expect(onSelect).toHaveBeenCalledWith('erkek');
    await act(async () => view.root.findByProps({ accessibilityLabel: 'Şimdi değil' }).props.onPress());
    expect(onSkip).toHaveBeenCalledTimes(1);
    await act(() => view.unmount());
  });
});

describe('Profile "Ürün tercihi" row', () => {
  const row = ({ valueLabel, open }: { valueLabel: string; open: () => void }) =>
    createElement(Pressable, { accessibilityLabel: 'row', onPress: open }, createElement(Text, null, valueLabel));
  const render = async () => {
    let view!: ReactTestRenderer;
    await act(() => { view = create(createElement(ProductPrefSetting, { userId: 'A', children: row })); });
    return view;
  };
  it('shows "Hepsi" when nothing was chosen and the chosen label otherwise', async () => {
    expect(productPrefLabel(null)).toBe('Hepsi');
    const view = await render();
    expect(view.root.findByType(Text).props.children).toBe('Hepsi');
    await act(async () => { useAppStore.setState({ productPref: 'erkek' }); });
    expect(view.root.findAllByType(Text)[0].props.children).toBe('Erkek');
    await act(() => view.unmount());
  });
  it('changing it calls setProductPref and closes the sheet', async () => {
    const setProductPref = jest.fn();
    useAppStore.setState({ setProductPref });
    const view = await render();
    await act(async () => view.root.findByProps({ accessibilityLabel: 'row' }).props.onPress());
    expect(view.root.findByProps({ title: 'Ürün tercihi' }).props.visible).toBe(true);
    await act(async () => view.root.findByProps({ accessibilityLabel: 'Kadın' }).props.onPress());
    expect(setProductPref).toHaveBeenCalledWith('kadin');
    expect(view.root.findByProps({ title: 'Ürün tercihi' }).props.visible).toBe(false);
    await act(() => view.unmount());
  });
});
