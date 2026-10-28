import AsyncStorage from '@react-native-async-storage/async-storage';
import { createElement } from 'react';
import FilterSheet from '../components/FilterSheet';
import { resetAccountWriteFenceMemoryForTests } from '../lib/accountWriteFence';
import { resetDeviceWorkForTests } from '../lib/accountDeviceWork';
import { useAppStore } from '../store/useAppStore';

jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///docs/', cacheDirectory: 'file:///cache/' }));
jest.mock('lucide-react-native', () => ({ Check: 'Icon' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../components/PressableScale', () => 'PressableScale');
jest.mock('../lib/supabase', () => ({ getRequiredSupabaseClient: jest.fn() }));
const renderer = jest.requireActual('react-test-renderer');
const realSetProductPref = useAppStore.getState().setProductPref;

beforeEach(async () => {
  await AsyncStorage.clear();
  resetDeviceWorkForTests(); resetAccountWriteFenceMemoryForTests();
  useAppStore.setState({ productPref: null, setProductPref: realSetProductPref });
});

const mount = async (props: Record<string, unknown> = {}) => {
  let view: any;
  const onApply = jest.fn();
  await renderer.act(() => {
    view = renderer.create(createElement(FilterSheet, { visible: true, filters: {}, onClose: jest.fn(), onApply, userId: 'A', ...props }));
  });
  return { view, onApply };
};
const press = (view: any, label: string) =>
  renderer.act(() => view.root.findByProps({ accessibilityLabel: label }).props.onPress());

test('shows the Ürün tercihi section with the three options at the top', async () => {
  const { view } = await mount();
  try {
    for (const label of ['Kadın', 'Erkek', 'Hepsi']) expect(view.root.findByProps({ accessibilityLabel: label })).toBeDefined();
  } finally { await renderer.act(() => view.unmount()); }
});

test('Uygula sends the chosen preference to setProductPref once', async () => {
  const setProductPref = jest.fn();
  useAppStore.setState({ setProductPref });
  const { view, onApply } = await mount();
  try {
    await press(view, 'Erkek');
    expect(setProductPref).not.toHaveBeenCalled();
    await press(view, 'Uygula');
    expect(setProductPref).toHaveBeenCalledTimes(1);
    expect(setProductPref).toHaveBeenCalledWith('erkek');
    expect(onApply).toHaveBeenCalledWith({});
  } finally { await renderer.act(() => view.unmount()); }
});

test('Uygula without a preference change does not call setProductPref', async () => {
  const setProductPref = jest.fn();
  useAppStore.setState({ setProductPref });
  const { view } = await mount();
  try {
    await press(view, 'Uygula');
    expect(setProductPref).not.toHaveBeenCalled();
  } finally { await renderer.act(() => view.unmount()); }
});

test('Temizle clears filters but never changes the preference', async () => {
  const setProductPref = jest.fn();
  useAppStore.setState({ productPref: 'erkek', setProductPref });
  const { view, onApply } = await mount();
  try {
    await press(view, 'mavi');
    await press(view, 'Temizle');
    await press(view, 'Uygula');
    expect(onApply).toHaveBeenCalledWith({});
    expect(setProductPref).not.toHaveBeenCalled();
    expect(useAppStore.getState().productPref).toBe('erkek');
  } finally { await renderer.act(() => view.unmount()); }
});
