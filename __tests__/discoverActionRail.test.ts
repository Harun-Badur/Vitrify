import fs from 'fs';
import path from 'path';
import { createElement, type ElementType, type ReactElement } from 'react';
import DiscoverActionRail, {
  computeRailGap, DISCOVER_ICON_CENTER_FROM_RIGHT, RAIL_COLUMN_WIDTH,
} from '../components/DiscoverActionRail';
import ShadowedIcon from '../components/ShadowedIcon';

jest.mock('react-native', () => ({
  Text: 'Text', View: 'View', Image: 'Image',
  StyleSheet: { create: (styles: unknown) => styles, flatten: (s: unknown) => s },
}));
jest.mock('../components/PressableScale', () => 'PressableScale');

interface TestNode {
  props: Record<string, any>;
  findAllByType: (type: ElementType | string) => TestNode[];
  findByType: (type: ElementType | string) => TestNode;
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
    const iconNames = (tree: { root: TestNode }): unknown[] => tree.root.findAllByType(ShadowedIcon).map(n => n.props.name);
    expect(iconNames(idle)).toContain('heart');
    expect(iconNames(idle)).not.toContain('heart-liked');
    expect(iconNames(liked)).toContain('heart-liked');
    const labels = (tree: { root: TestNode }) => tree.root.findAllByType('Text').map(t => t.props.children);
    expect(labels(idle)).toEqual(expect.arrayContaining(['Dene', 'Mağaza', 'Beğen', 'Uyumlu', 'AI']));
    expect(labels(idle).filter(c => c === 'AI')).toHaveLength(1);
  });
});

describe('touch absorption and shadowed icons', () => {
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
    expect(tree.root.findAllByType(ShadowedIcon).map(n => n.props.name)).toEqual([
      'sparkles', 'shopping-bag', 'heart', 'badge-check',
    ]);
  });

  it('baked-shadow PNG overflows a layout box that stays at the requested size', () => {
    const tree = mount(createElement(ShadowedIcon, { name: 'heart', size: 24 }));
    const box = tree.root.findAllByType('View')[0];
    expect(box.props.style).toEqual({ width: 24, height: 24 });
    expect(box.props.pointerEvents).toBe('none');
    const image = tree.root.findByType('Image');
    const style = Object.assign({}, ...[image.props.style].flat());
    expect(style).toMatchObject({ position: 'absolute', width: 32, height: 32, top: -4, left: -4 });
    expect(image.props.source).toBeDefined();
  });

  it('ships light and dark variants at @1x/@2x/@3x for every icon', () => {
    const names = ['sparkles', 'shopping-bag', 'heart', 'heart-liked', 'badge-check', 'search', 'sliders-horizontal'];
    for (const name of names) for (const tone of ['light', 'dark']) for (const suffix of ['', '@2x', '@3x']) {
      expect(fs.existsSync(path.join(root, 'assets/icons', `${name}-${tone}${suffix}.png`))).toBe(true);
    }
    const light = mount(createElement(ShadowedIcon, { name: 'search', size: 21 })).root.findByType('Image').props.source;
    const dark = mount(createElement(ShadowedIcon, { name: 'search', size: 21, tone: 'dark' })).root.findByType('Image').props.source;
    expect(light).not.toEqual(dark);
  });

  it('shrunk rail keeps every item at least 44dp to touch', () => {
    const tree = mount(createElement(DiscoverActionRail, { ...handlers(), liked: false, onWhy: jest.fn() }));
    for (const button of buttons(tree)) {
      const style = Object.assign({}, ...[button.props.style].flat());
      expect(style.width).toBeGreaterThanOrEqual(44);
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
    }
    const sizes = tree.root.findAllByType(ShadowedIcon).map(n => n.props.size);
    expect(sizes).toEqual([13, 19, 19, 19]);
  });
});

describe('device-robust alignment', () => {
  it('rail gap shrinks to 4dp minimum instead of hiding items', () => {
    expect(computeRailGap(4)).toBe(6);
    expect(computeRailGap(4, 400)).toBe(6);
    expect(computeRailGap(4, 188)).toBe(4);
    expect(computeRailGap(4, 100)).toBe(4);
    expect(computeRailGap(4, 190)).toBeCloseTo(4.67, 1);
    expect(computeRailGap(4, 192)).toBeCloseTo(5.33, 1);
  });

  it('rail keeps all items under a tight maxHeight and applies the computed gap', () => {
    const tree = mount(createElement(DiscoverActionRail, { ...handlers(), liked: false, onWhy: jest.fn(), maxHeight: 188 }));
    expect(buttons(tree)).toHaveLength(4);
    const host = tree.root.findAllByType('View')[0];
    expect(Object.assign({}, ...[host.props.style].flat())).toMatchObject({ width: RAIL_COLUMN_WIDTH, gap: 4 });
  });

  it('labels cap font scaling at 1.15', () => {
    const tree = mount(createElement(DiscoverActionRail, { ...handlers(), liked: false, onWhy: jest.fn() }));
    for (const text of tree.root.findAllByType('Text')) expect(text.props.maxFontSizeMultiplier).toBe(1.15);
  });

  it('header icons and rail share one centre axis and the header offsets the rail by the same constant', () => {
    expect(DISCOVER_ICON_CENTER_FROM_RIGHT).toBe(38);
    const index = read('app/(tabs)/index.tsx');
    const card = read('components/SwipeCard.tsx');
    expect(index).toMatch(/FILTER_HIT_SIZE = RAIL_COLUMN_WIDTH/);
    expect(index).toMatch(/headerActionsRight = DISCOVER_EDGE_MARGIN - Math\.max\(insets\.right, spacing\.lg\)/);
    expect(index).toMatch(/styles\.headerActions, \{ right: headerActionsRight \}/);
    expect(card).toMatch(/right: DISCOVER_EDGE_MARGIN/);
    expect(index).toMatch(/railTopInset=\{railTopInset\}/);
    expect(index).toMatch(/\(insets\.top > 0 \? insets\.top : layout\.statusBarFallback\)/);
  });

  it('header controls cannot leak taps to the card: RNGH walks children last-first, ignoring zIndex', () => {
    const index = read('app/(tabs)/index.tsx');
    const bodyAt = index.indexOf('styles.body,');
    const headerAt = index.indexOf('styles.header,');
    expect(bodyAt).toBeGreaterThan(-1);
    expect(headerAt).toBeGreaterThan(bodyAt);
    const headerOpen = index.lastIndexOf('<View', headerAt);
    expect(index.slice(headerOpen, headerAt)).toMatch(/pointerEvents="box-none"/);
    expect(index).toMatch(/header: \{\s*position: 'absolute'[\s\S]*?zIndex: HEADER_Z_INDEX/);
  });

  it('rail and its labels/gaps are later siblings of the card detector and claim every touch', () => {
    const card = read('components/SwipeCard.tsx');
    const detectorEnd = card.indexOf('</GestureDetector>', card.indexOf('<GestureDetector gesture={cardGesture}>'));
    expect(card.indexOf('styles.railAnchor')).toBeGreaterThan(detectorEnd);
    const tree = mount(createElement(DiscoverActionRail, { ...handlers(), liked: false, onWhy: jest.fn() }));
    expect(tree.root.findAllByType('View')[0].props.onStartShouldSetResponder()).toBe(true);
  });

  it('first segment label starts at the 16dp content edge and caps font scaling', () => {
    const seg = read('components/FeedModeSegment.tsx');
    expect(seg).toMatch(/overlayOption: \{ paddingHorizontal: 0, marginRight: 22 \}/);
    expect(seg).toMatch(/maxFontSizeMultiplier=\{1\.15\}/);
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
    expect(index).toMatch(/<ShadowedIcon name="search" size=\{21\}/);
    expect(index).toMatch(/<ShadowedIcon name="sliders-horizontal" size=\{21\}/);
    expect(read('components/FeedModeSegment.tsx')).not.toMatch(/opacity: isActive \? 1 : 0\.65/);
  });

  it('segment labels share the rail label shadow: 14sp bold white, inactive 85%', () => {
    const seg = read('components/FeedModeSegment.tsx');
    expect(seg).toMatch(/overlayLabel: \{[^}]*fontSize: 14[^}]*fontWeight: '700'[^}]*textShadowColor: 'rgba\(0, 0, 0, 0\.6\)'/);
    expect(seg).toMatch(/overlayLabelInactive: \{ color: 'rgba\(255, 255, 255, 0\.85\)' \}/);
    expect(read('components/DiscoverActionRail.tsx')).toMatch(/ICON_SIZE = 19/);
  });

  it('the header only adds readable shadows, no new layers', () => {
    expect(index).toMatch(/textShadowColor/);
    expect(index).not.toMatch(/LinearGradient|BlurView/);
  });
});
