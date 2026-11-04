import { createElement, type ReactElement } from 'react';
import { Text } from 'react-native';
import ProfileStyleJourney from '../components/ProfileStyleJourney';
import ProfileStyleGrid from '../components/ProfileStyleGrid';
import ProfileOnlyYou from '../components/ProfileOnlyYou';
import { buildStyleJourney } from '../lib/profileStyleJourney';
import type { StyleJourneyInput } from '../lib/profileStyleJourney';
import { emptyStyleProfile } from '../lib/scoring';
import type { CalculatedStyleProfileState } from '../types/calculatedStyleProfile';
import type { WeightMap } from '../types/recommendation';

jest.mock('react-native-svg', () => ({ __esModule: true, default: 'Svg', Circle: 'Circle', Path: 'Path', Rect: 'Rect' }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_t, name) => (name === '__esModule' ? false : String(name)) }));
jest.mock('../components/PressableScale', () => 'PressableScale');
jest.mock('../components/ProfileSheet', () => ({
  __esModule: true,
  default: ({ visible, title, children }: { visible: boolean; title: string; children: unknown }) =>
    visible ? jest.requireActual('react').createElement('Sheet', { title }, children) : null,
}));

interface Node { props: Record<string, unknown> }
interface Tree {
  root: {
    findAllByType: (type: typeof Text) => Node[];
    findByProps: (props: Record<string, unknown>) => Node;
    findAllByProps: (props: Record<string, unknown>) => Node[];
  };
  update: (element: ReactElement) => void;
  unmount: () => void;
}
const renderer = jest.requireActual('react-test-renderer') as {
  create: (element: ReactElement) => Tree; act: (callback: () => void) => Promise<void>;
};
const texts = (view: Tree) => view.root.findAllByType(Text).map(node => node.props.children).flat().join(' ');
const base = (patch: Partial<StyleJourneyInput> = {}): StyleJourneyInput => ({
  userId: 'A', sessionUserId: 'A', sessionSyncStatus: 'success', wardrobeStatus: 'ready',
  likedProducts: [], passedProductIds: [], wardrobeItems: [], savedOutfits: [], profile: null, ...patch,
});
const ids = (count: number) => Array.from({ length: count }, (_, i) => `p${i}`);
const model = (weights: { colorW?: WeightMap; brandW?: WeightMap }): CalculatedStyleProfileState => ({
  state: 'ready',
  profile: { snapshot: { ...emptyStyleProfile('A'), ...weights }, algorithm: 'v2', eventCount: 9, computedAt: '2026-10-12T10:00:00Z' },
});
async function mount(element: ReactElement): Promise<Tree> {
  let view: Tree | undefined;
  await renderer.act(() => { view = renderer.create(element); });
  if (!view) throw new Error('No render');
  return view;
}

describe('Stil Yolculuğun boxes', () => {
  test('three boxes replace the percent ring; no percent text, no raw counter', async () => {
    const journey = buildStyleJourney(base({ passedProductIds: ids(174) }));
    const view = await mount(createElement(ProfileStyleJourney, { journey, onTask: jest.fn() }));
    try {
      const text = texts(view);
      for (const label of ['Stil Yolculuğun', 'Beğeni', 'Dolap parçası', 'Tercih']) expect(text).toContain(label);
      expect(text).toContain('Önerilerin şu an 174 değerlendirmene dayanıyor.');
      expect(text).not.toContain('%');
      expect(text).not.toContain('174/10');
      expect(view.root.findAllByProps({ accessibilityRole: 'progressbar' })).toHaveLength(0);
    } finally { await renderer.act(() => view.unmount()); }
  });
  test('complete boxes get the check badge, missing boxes the add badge and route on press', async () => {
    const journey = buildStyleJourney(base({ passedProductIds: ids(10) }));
    const onTask = jest.fn();
    const view = await mount(createElement(ProfileStyleJourney, { journey, onTask }));
    try {
      expect(view.root.findAllByProps({ testID: 'journey-liked-complete' }).length).toBeGreaterThan(0);
      expect(view.root.findAllByProps({ testID: 'journey-wardrobe-missing' }).length).toBeGreaterThan(0);
      expect(view.root.findAllByProps({ testID: 'journey-preferences-missing' }).length).toBeGreaterThan(0);
      await renderer.act(() => { (view.root.findByProps({ accessibilityLabel: 'Dolap parçası: 0, eksik. Ekle' }).props.onPress as () => void)(); });
      await renderer.act(() => { (view.root.findByProps({ accessibilityLabel: 'Tercih: 0/5, eksik. Ekle' }).props.onPress as () => void)(); });
      expect(onTask.mock.calls).toEqual([['wardrobe'], ['preferences']]);
    } finally { await renderer.act(() => view.unmount()); }
  });
  test('wardrobe still loading reads "Yükleniyor", never 0', async () => {
    const journey = buildStyleJourney(base({ wardrobeStatus: 'loading' }));
    const view = await mount(createElement(ProfileStyleJourney, { journey, onTask: jest.fn() }));
    try {
      expect(texts(view)).toContain('Yükleniyor');
      expect(view.root.findAllByProps({ testID: 'journey-wardrobe-loading' }).length).toBeGreaterThan(0);
    } finally { await renderer.act(() => view.unmount()); }
  });
  test('boxes have at least 44dp touch targets', async () => {
    const view = await mount(createElement(ProfileStyleJourney, { journey: buildStyleJourney(base()), onTask: jest.fn() }));
    try {
      const box = view.root.findByProps({ accessibilityLabel: 'Beğeni: 0, eksik. Ekle' });
      const style = ([] as Record<string, number>[]).concat(box.props.style as never).flat(2).reduce((all, part) => ({ ...all, ...part }), {});
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
    } finally { await renderer.act(() => view.unmount()); }
  });
});

describe('Stilin grid', () => {
  const learned = () => buildStyleJourney(base({ passedProductIds: ids(8), calculatedProfile: model({ colorW: { siyah: 1 }, brandW: { lcw: 1 } }) }));
  test('merges the two old lists under one heading with the source hint', async () => {
    const view = await mount(createElement(ProfileStyleGrid, { journey: learned(), onRetry: jest.fn(), onSelectSection: jest.fn() }));
    try {
      const text = texts(view);
      expect(text).toContain('Stilin');
      expect(text).toContain('Dokun, kaynağı gör');
      for (const label of ['Renk', 'Parça', 'Kesim', 'Marka', 'Fiyat']) expect(text).toContain(label);
      expect(text).toContain('LC Waikiki');
      expect(text).not.toContain('Eğilimlerin');
      expect(text).not.toContain('Tercihlerin');
    } finally { await renderer.act(() => view.unmount()); }
  });
  test('below the threshold a box is the dashed "Biraz daha beğen" state', async () => {
    const journey = buildStyleJourney(base({ passedProductIds: ids(2), calculatedProfile: model({ colorW: { siyah: 1 } }) }));
    const view = await mount(createElement(ProfileStyleGrid, { journey, onRetry: jest.fn(), onSelectSection: jest.fn() }));
    try {
      expect(texts(view)).toContain('Biraz daha beğen');
      expect(view.root.findAllByProps({ testID: 'style-tile-color-empty' }).length).toBeGreaterThan(0);
    } finally { await renderer.act(() => view.unmount()); }
  });
  test('error shows an explicit message and "Yeniden dene" which retries', async () => {
    const journey = buildStyleJourney(base({ passedProductIds: ids(9), calculatedProfile: { state: 'error' } }));
    const onRetry = jest.fn();
    const view = await mount(createElement(ProfileStyleGrid, { journey, onRetry, onSelectSection: jest.fn() }));
    try {
      const text = texts(view);
      expect(text).toContain('Stil profilin doğrulanamadı.');
      expect(text).toContain('Yeniden dene');
      expect(text).not.toContain('Keşfediliyor');
      await renderer.act(() => { (view.root.findByProps({ accessibilityLabel: 'Yeniden dene' }).props.onPress as () => void)(); });
      expect(onRetry).toHaveBeenCalledTimes(1);
    } finally { await renderer.act(() => view.unmount()); }
  });
  test('a tap opens the source sheet and its button starts the existing declaration flow', async () => {
    const onSelectSection = jest.fn();
    const view = await mount(createElement(ProfileStyleGrid, { journey: learned(), onRetry: jest.fn(), onSelectSection }));
    try {
      expect(texts(view)).not.toContain('Nereden öğrendik?');
      await renderer.act(() => { (view.root.findByProps({ accessibilityLabel: 'Renk: Siyah' }).props.onPress as () => void)(); });
      const text = texts(view);
      expect(text).toContain('Nereden öğrendik?');
      expect(text).toContain('Tüm etkileşimlerinden');
      expect(text).toContain('Bu bir tahmin. Sen seçersen öneriler senin seçimine göre çalışır.');
      await renderer.act(() => { (view.root.findByProps({ accessibilityLabel: 'Renk seç' }).props.onPress as () => void)(); });
      expect(onSelectSection).toHaveBeenCalledWith('colors');
      expect(texts(view)).not.toContain('Nereden öğrendik?');
    } finally { await renderer.act(() => view.unmount()); }
  });
  test('learned boxes disappear immediately on an account change and return from the same saved input', async () => {
    const input = base({ passedProductIds: ids(8), calculatedProfile: model({ colorW: { siyah: 1 } }) });
    const props = (journey: ReturnType<typeof buildStyleJourney>) => ({ journey, onRetry: jest.fn(), onSelectSection: jest.fn() });
    const view = await mount(createElement(ProfileStyleGrid, props(buildStyleJourney(input))));
    try {
      expect(texts(view)).toContain('Siyah');
      await renderer.act(() => { view.update(createElement(ProfileStyleGrid, props(buildStyleJourney({ ...input, userId: 'B' })))); });
      expect(texts(view)).not.toContain('Siyah');
      await renderer.act(() => { view.update(createElement(ProfileStyleGrid, props(buildStyleJourney(input)))); });
      expect(texts(view)).toContain('Siyah');
    } finally { await renderer.act(() => view.unmount()); }
  });
});

describe('Sadece sen belirlersin', () => {
  test('unset style and size are "+" boxes that open the existing sheets', async () => {
    const onOpen = jest.fn();
    const journey = buildStyleJourney(base());
    const view = await mount(createElement(ProfileOnlyYou, { journey, onOpen, disabled: false }));
    try {
      const text = texts(view);
      for (const label of ['Sadece sen belirlersin', 'Stil tarzı', 'Beden']) expect(text).toContain(label);
      expect(view.root.findAllByProps({ testID: 'only-you-style-add' }).length).toBeGreaterThan(0);
      await renderer.act(() => { (view.root.findByProps({ accessibilityLabel: 'Stil tarzı ekle' }).props.onPress as () => void)(); });
      await renderer.act(() => { (view.root.findByProps({ accessibilityLabel: 'Beden ekle' }).props.onPress as () => void)(); });
      expect(onOpen.mock.calls).toEqual([['style'], ['body']]);
    } finally { await renderer.act(() => view.unmount()); }
  });
});
