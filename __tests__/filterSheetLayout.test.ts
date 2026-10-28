import { createElement } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import FilterSheet from '../components/FilterSheet';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 34, left: 12, right: 12 }),
}));
jest.mock('../components/PressableScale', () => 'PressableScale');
jest.mock('lucide-react-native', () => ({ Check: 'Icon' }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///docs/', cacheDirectory: 'file:///cache/' }));
jest.mock('../lib/supabase', () => ({ getRequiredSupabaseClient: jest.fn() }));
const renderer = jest.requireActual('react-test-renderer');

test('keeps filter options scrollable and actions clear of the system gesture area', async () => {
  let view: any;
  const apply = jest.fn();
  await renderer.act(() => {
    view = renderer.create(
      createElement(FilterSheet, {
        visible: true,
        filters: {},
        onClose: jest.fn(),
        onApply: apply,
      }),
    );
  });
  try {
    expect(view.root.findByType(ScrollView)).toBeDefined();
    const sheet = view.root.findByProps({ testID: 'discover-filter-sheet' });
    expect(
      StyleSheet.flatten(sheet.props.style).paddingBottom,
    ).toBeGreaterThanOrEqual(34);
    await renderer.act(() =>
      view.root.findByProps({ accessibilityLabel: 'mavi' }).props.onPress(),
    );
    await renderer.act(() =>
      view.root.findByProps({ accessibilityLabel: 'Uygula' }).props.onPress(),
    );
    expect(apply).toHaveBeenCalledWith({ color: 'mavi' });
  } finally {
    await renderer.act(() => view.unmount());
  }
});
