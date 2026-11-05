import { createElement } from 'react';
import { Text } from 'react-native';
import type { ReactTestRenderer } from 'react-test-renderer';
import { MOCK_PRODUCTS } from '../data/mockProducts';
import { useFocusGatedSelection } from '../hooks/useFocusGatedSelection';
import { useAppStore } from '../store/useAppStore';

jest.mock('../services/likeService', () => ({
  fetchLikedProducts: jest.fn(), fetchPassedProductIds: jest.fn(), insertLikedProduct: jest.fn(),
  insertPassedProduct: jest.fn(), deleteLikedProduct: jest.fn(), deletePassedProduct: jest.fn(), updateLikedProductAlert: jest.fn(),
}));
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../lib/logger', () => ({ logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
const { create, act } = jest.requireActual<typeof import('react-test-renderer')>('react-test-renderer');

const liked = (count: number) => MOCK_PRODUCTS.slice(0, count).map(product => ({
  product, notifyOnPriceDrop: true, likedAt: '2026-01-01T00:00:00.000Z',
}));
let renders = 0;
function Probe({ focused }: { focused: boolean }) {
  renders++;
  const { likedCount, passedCount } = useFocusGatedSelection(focused, state => ({
    likedCount: state.likedProducts.length, passedCount: state.passedProductIds.length,
  }));
  return createElement(Text, null, `${likedCount}/${passedCount}`);
}
const text = (view: ReactTestRenderer) => view.root.findByType(Text).props.children as string;

beforeEach(() => {
  renders = 0;
  useAppStore.setState({ likedProducts: [], passedProductIds: [] });
});

test('a focused screen follows store changes', async () => {
  let view!: ReactTestRenderer;
  await act(async () => { view = create(createElement(Probe, { focused: true })); });
  await act(async () => { useAppStore.setState({ likedProducts: liked(2), passedProductIds: ['p1'] }); });
  expect(text(view)).toBe('2/1');
  await act(async () => view.unmount());
});

test('a blurred screen does not re-render on background swipes', async () => {
  let view!: ReactTestRenderer;
  await act(async () => { view = create(createElement(Probe, { focused: true })); });
  await act(async () => { view.update(createElement(Probe, { focused: false })); });
  const before = renders;
  for (let i = 1; i <= 5; i++) {
    await act(async () => { useAppStore.setState({ passedProductIds: Array.from({ length: i }, (_, n) => `p${n}`) }); });
  }
  await act(async () => { useAppStore.setState({ likedProducts: liked(3) }); });
  expect(renders).toBe(before);
  expect(text(view)).toBe('0/0');
  await act(async () => view.unmount());
});

test('returning to the screen shows the latest store data', async () => {
  let view!: ReactTestRenderer;
  await act(async () => { view = create(createElement(Probe, { focused: true })); });
  await act(async () => { view.update(createElement(Probe, { focused: false })); });
  await act(async () => { useAppStore.setState({ likedProducts: liked(3), passedProductIds: ['p1', 'p2'] }); });
  await act(async () => { view.update(createElement(Probe, { focused: true })); });
  expect(text(view)).toBe('3/2');
  await act(async () => { useAppStore.setState({ passedProductIds: ['p1'] }); });
  expect(text(view)).toBe('3/1');
  await act(async () => view.unmount());
});

test('a screen first mounted while blurred still reads current data', async () => {
  useAppStore.setState({ likedProducts: liked(1), passedProductIds: ['p1'] });
  let view!: ReactTestRenderer;
  await act(async () => { view = create(createElement(Probe, { focused: false })); });
  expect(text(view)).toBe('1/1');
  await act(async () => view.unmount());
});
