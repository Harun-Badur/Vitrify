import fs from 'fs';
import path from 'path';
import { createElement, type ElementType, type ReactElement } from 'react';
import DiscoverActionRail from '../components/DiscoverActionRail';
import ShadowedIcon from '../components/ShadowedIcon';

jest.mock('react-native', () => ({
  Text: 'Text', View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, flatten: (s: unknown) => s },
}));
jest.mock('lucide-react-native', () => ({
  Heart: 'Heart', ShoppingBag: 'ShoppingBag', Sparkles: 'Sparkles', BadgeCheck: 'BadgeCheck',
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

describe('touch absorption and halo icons', () => {
  it('rail root claims every touch inside its rectangle, gaps and labels included', () => {
    const tree = mount(createElement(DiscoverActionRail, { ...handlers(), liked: false }));
    const host = tree.root.findAllByType('View')[0];
    expect(host.props.onStartShouldSetResponder()).toBe(true);
  });

  it('each item is one pressable holding both icon and label', () => {
    const tree = mount(createElement(DiscoverActionRail, { ...handlers(), liked: false, onWhy: jest.fn() }));
    for (const button of buttons(tree)) {
      expect(button.findAllByType('Text').length).toBeGreaterThanOrEqual(1);
    }
    expect(tree.root.findAllByType('BadgeCheck').length).toBeGreaterThan(0);
  });

  it('halo copy is an unfilled thicker dark stroke under a white outline', () => {
    const tree = mount(createElement(ShadowedIcon, { icon: 'Heart' as never, size: 28 }));
    const [halo, top] = tree.root.findAllByType('Heart');
    expect(halo.props.fill).toBe('none');
    expect(halo.props.strokeWidth).toBeCloseTo(4.2);
    expect(halo.props.color).toBe('rgba(0, 0, 0, 0.4)');
    expect(top.props.fill).toBe('none');
    expect(top.props.strokeWidth).toBe(2);
    expect(top.props.color).toBe('#FFFFFF');
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

  it('mounts the rail as a sibling of the card gesture tree so rail touches never reach it', () => {
    const detectorStart = card.indexOf('<GestureDetector gesture={cardGesture}>');
    const detectorEnd = card.indexOf('</GestureDetector>', detectorStart);
    const railAt = card.indexOf('<DiscoverActionRail');
    expect(detectorStart).toBeGreaterThan(-1);
    expect(railAt).toBeGreaterThan(detectorEnd);
    expect(card).not.toMatch(/ctaNativeGesture/);
  });

  it('the header strip sits outside the deck and its tabs and icons are pressables', () => {
    expect(index).toMatch(/header: \{\s*position: 'absolute'[\s\S]*?zIndex: HEADER_Z_INDEX/);
    expect(index).toMatch(/<ShadowedIcon icon=\{Search\}/);
    expect(index).toMatch(/<ShadowedIcon icon=\{SlidersHorizontal\}/);
    expect(read('components/FeedModeSegment.tsx')).not.toMatch(/opacity: isActive \? 1 : 0\.65/);
  });

  it('the header only adds readable shadows, no new layers', () => {
    expect(index).toMatch(/textShadowColor/);
    expect(index).not.toMatch(/LinearGradient|BlurView/);
  });
});
