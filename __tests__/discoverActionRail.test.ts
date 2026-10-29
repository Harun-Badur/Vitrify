import fs from 'fs';
import path from 'path';
import { createElement, type ElementType, type ReactElement } from 'react';
import DiscoverActionRail from '../components/DiscoverActionRail';

jest.mock('react-native', () => ({
  Text: 'Text', View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, flatten: (s: unknown) => s },
}));
jest.mock('lucide-react-native', () => ({
  Heart: 'Heart', ShoppingBag: 'ShoppingBag', Sparkles: 'Sparkles', Shirt: 'Shirt',
}));
jest.mock('../components/PressableScale', () => 'PressableScale');

interface TestNode {
  props: Record<string, any>;
  findAllByType: (type: ElementType | string) => TestNode[];
  findAllByProps: (props: Record<string, unknown>) => TestNode[];
}
const renderer = jest.requireActual('react-test-renderer') as {
  act: (callback: () => void) => void;
  create: (element: ReactElement) => { root: TestNode };
};
const root = path.join(__dirname, '..');
const read = (file: string): string => fs.readFileSync(path.join(root, file), 'utf8');

const mount = (element: ReactElement): { root: TestNode } => {
  let tree!: { root: TestNode };
  renderer.act(() => { tree = renderer.create(element); });
  return tree;
};
const handlers = () => ({ onTry: jest.fn(), onStore: jest.fn(), onLike: jest.fn() });
const buttons = (tree: { root: TestNode }) => tree.root.findAllByType('PressableScale');

describe('DiscoverActionRail', () => {
  it('orders Dene, Mağaza, Beğen and appends Uyumlu last only when a handler exists', () => {
    const h = handlers();
    const without = mount(createElement(DiscoverActionRail, { ...h, liked: false }));
    expect(buttons(without).map(b => b.props.accessibilityLabel)).toEqual(['Dene', 'Mağazaya git', 'Beğen']);
    const onWhy = jest.fn();
    const withWhy = mount(createElement(DiscoverActionRail, { ...h, liked: false, onWhy }));
    expect(buttons(withWhy).map(b => b.props.accessibilityLabel)).toEqual([
      'Dene', 'Mağazaya git', 'Beğen', 'Neden bu öneri?',
    ]);
  });

  it('wires each button to its handler and keeps a 44dp hit area', () => {
    const h = handlers();
    const onWhy = jest.fn();
    const tree = mount(createElement(DiscoverActionRail, { ...h, liked: false, onWhy }));
    const [dene, store, like, why] = buttons(tree);
    renderer.act(() => { dene.props.onPress(); store.props.onPress(); like.props.onPress(); why.props.onPress(); });
    expect(h.onTry).toHaveBeenCalledTimes(1);
    expect(h.onStore).toHaveBeenCalledTimes(1);
    expect(h.onLike).toHaveBeenCalledTimes(1);
    expect(onWhy).toHaveBeenCalledTimes(1);
    for (const button of buttons(tree)) {
      const style = Object.assign({}, ...[button.props.style].flat());
      const slop = typeof button.props.hitSlop === 'number' ? button.props.hitSlop : 0;
      expect(Math.max(style.minWidth ?? 0, style.width ?? 0) + slop * 2).toBeGreaterThanOrEqual(44);
      expect(Math.max(style.minHeight ?? 0, style.height ?? 0) + slop * 2).toBeGreaterThanOrEqual(44);
    }
  });

  it('fills the heart red once liked and marks the AI badge only on Uyumlu', () => {
    const h = handlers();
    const idle = mount(createElement(DiscoverActionRail, { ...h, liked: false, onWhy: jest.fn() }));
    const liked = mount(createElement(DiscoverActionRail, { ...h, liked: true, onWhy: jest.fn() }));
    const fillOf = (tree: { root: TestNode }): unknown => tree.root.findAllByType('Heart').pop()!.props.fill;
    expect(fillOf(idle)).toBe('none');
    expect(fillOf(liked)).not.toBe('none');
    const labels = (tree: { root: TestNode }) => tree.root.findAllByType('Text').map(t => t.props.children);
    expect(labels(idle)).toEqual(expect.arrayContaining(['Dene', 'Mağaza', 'Beğen', 'Uyumlu', 'AI']));
    expect(labels(idle).filter(c => c === 'AI')).toHaveLength(1);
  });
});

describe('SwipeCard presentation wiring (source contract)', () => {
  const card = read('components/SwipeCard.tsx');
  const index = read('app/(tabs)/index.tsx');

  it('drops the old CTA row, the expand button and the bottom-left chip', () => {
    expect(card).not.toMatch(/Mağazaya Git/);
    expect(card).not.toMatch(/Ürün görselini genişlet/);
    expect(card).not.toMatch(/styles\.expandButton/);
    expect(card).not.toMatch(/<InsightChip\b/);
    expect(card).toMatch(/<DiscoverActionRail/);
  });

  it('keeps price-drop info and the unchanged decision logic', () => {
    expect(card).toMatch(/hasCatalogPriceDrop\(product\)/);
    expect(card).not.toMatch(/insightChipPairing|selectInsightChip/);
  });

  it('single tap expands only after the double tap fails, without blocking pan', () => {
    expect(card).toMatch(/\.maxDelay\(SINGLE_TAP_DELAY_MS\)/);
    expect(card).toMatch(/requireExternalGestureToFail\(doubleTapGesture\)/);
    expect(card).toMatch(/Gesture\.Exclusive\(doubleTapGesture, panGesture, singleTapGesture\)/);
    expect(card).toMatch(/SINGLE_TAP_DELAY_MS = 250/);
  });

  it('the header only adds readable shadows, no new layers', () => {
    expect(index).toMatch(/textShadowColor/);
    expect(index).not.toMatch(/LinearGradient|BlurView/);
  });
});
