import { createElement, type ReactElement } from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Text } from 'react-native';
import ProfileStyleJourney from '../components/ProfileStyleJourney';
import ProfileStyleGrid from '../components/ProfileStyleGrid';
import ProfileOnlyYou from '../components/ProfileOnlyYou';
import { buildStyleJourney } from '../lib/profileStyleJourney';
import type { StyleJourneyInput } from '../lib/profileStyleJourney';
import { emptyStyleProfile } from '../lib/scoring';
import type { CalculatedStyleProfileState } from '../types/calculatedStyleProfile';
import type { WeightMap } from '../types/recommendation';

jest.mock('react-native-svg', () => ({ __esModule: true, default: 'Svg', Circle: 'Circle', Path: 'Path', Rect: 'Rect', Defs: 'Defs', LinearGradient: 'LinearGradient', RadialGradient: 'RadialGradient', Stop: 'Stop' }));
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
    findAll: (predicate: (node: { type: unknown; props: Record<string, unknown> }) => boolean) => Node[];
  };
  update: (element: ReactElement) => void;
  unmount: () => void;
}
const renderer = jest.requireActual('react-test-renderer') as {
  create: (element: ReactElement) => Tree; act: (callback: () => void) => Promise<void>;
};
const hosts = (view: Tree, testID: string) =>
  view.root.findAll(node => typeof node.type === 'string' && node.props.testID === testID);
const texts = (view: Tree) => view.root.findAllByType(Text).map(node => node.props.children).flat().join(' ');
const base = (patch: Partial<StyleJourneyInput> = {}): StyleJourneyInput => ({
  userId: 'A', sessionUserId: 'A', sessionSyncStatus: 'success', wardrobeStatus: 'ready',
  likedProducts: [], passedProductIds: [], wardrobeItems: [], savedOutfits: [], profile: null, ...patch,
});
const ids = (count: number) => Array.from({ length: count }, (_, i) => `p${i}`);
const model = (weights: { colorW?: WeightMap; brandW?: WeightMap; subcategoryW?: WeightMap; fitW?: WeightMap }): CalculatedStyleProfileState => ({
  state: 'ready',
  profile: { snapshot: { ...emptyStyleProfile('A'), ...weights }, algorithm: 'v2', eventCount: 9, computedAt: '2026-10-12T10:00:00Z' },
});
async function mount(element: ReactElement): Promise<Tree> {
  let view: Tree | undefined;
  await renderer.act(() => { view = renderer.create(element); });
  if (!view) throw new Error('No render');
  return view;
}

describe('Stil Yolculuğun card', () => {
  const wardrobeItems = Array.from({ length: 3 }, (_, i) => ({ id: `w${i}`, title: 'F', brand: '', imageUrl: 'file://f', category: 'upper_body' as const, createdAt: '2026-10-12' }));
  const profile = { userId: 'A', heightCm: 170, weightKg: 60, topSize: 'M' as const, bottomSize: 'M' as const, styleTags: ['minimal' as const],
    modelPhotoPath: null, preferredColors: ['Siyah'], favoriteBrands: ['ZARA'], priceRange: { min: 1, max: 2 } };
  const render = (patch = {}, onTask = jest.fn()) =>
    mount(createElement(ProfileStyleJourney, { journey: buildStyleJourney(base(patch)), onTask }));

  test.each([
    [{}, 'Seni tanımaya başlıyoruz', 0],
    [{ passedProductIds: ids(10) }, 'Seni tanımaya başlıyoruz', 1],
    [{ passedProductIds: ids(10), wardrobeItems }, 'Seni tanıyoruz', 2],
    [{ passedProductIds: ids(10), wardrobeItems, profile }, 'Seni iyi tanıyoruz', 3],
  ])('stage title and ring label for %#', async (patch, title, done) => {
    const view = await render(patch);
    try {
      const text = texts(view);
      for (const part of ['STİL YOLCULUĞUN', title, 'Paylaştıkça önerilerin sana yaklaşır.', 'Tanışıyoruz', 'Tanıyoruz', 'İyi tanıyoruz']) {
        expect(text).toContain(part);
      }
      expect(view.root.findByProps({ accessibilityLabel: `Stil yolculuğu: 3 adımdan ${done} tamam` })).toBeDefined();
    } finally { await renderer.act(() => view.unmount()); }
  });
  test('rows: complete ones show a check, missing ones their action; Ekle opens the wardrobe flow, Belirt the preferences flow', async () => {
    const onTask = jest.fn();
    const view = await render({ passedProductIds: ids(10) }, onTask);
    try {
      expect(hosts(view, 'journey-row-liked-complete').length).toBe(1);
      expect(hosts(view, 'journey-row-wardrobe-missing').length).toBe(1);
      expect(texts(view)).toContain('10 değerlendirme · kullanılıyor');
      await renderer.act(() => { (view.root.findByProps({ accessibilityLabel: 'Ekle' }).props.onPress as () => void)(); });
      await renderer.act(() => { (view.root.findByProps({ accessibilityLabel: 'Belirt' }).props.onPress as () => void)(); });
      expect(onTask.mock.calls).toEqual([['wardrobe'], ['preferences']]);
    } finally { await renderer.act(() => view.unmount()); }
  });
  test('liked below the threshold reads N/10 with the hint', async () => {
    const view = await render({ passedProductIds: ids(4) });
    try {
      expect(texts(view)).toContain('4/10 değerlendirme');
      expect(texts(view)).toContain('Biraz daha beğen');
    } finally { await renderer.act(() => view.unmount()); }
  });
  test('wardrobe still loading reads "Yükleniyor", never 0/3, and offers no Ekle', async () => {
    const view = await render({ wardrobeStatus: 'loading', passedProductIds: ids(10) });
    try {
      expect(texts(view)).toContain('Yükleniyor');
      expect(texts(view)).not.toContain('0/3');
      expect(view.root.findAllByProps({ accessibilityLabel: 'Ekle' })).toHaveLength(0);
    } finally { await renderer.act(() => view.unmount()); }
  });
  test('Ekle is 40dp tall with a hit area of at least 44dp; Belirt has a 44dp hit area', async () => {
    const view = await render();
    try {
      const add = view.root.findByProps({ accessibilityLabel: 'Ekle' });
      const style = ([] as Record<string, number>[]).concat(add.props.style as never).flat(2).reduce((all, part) => ({ ...all, ...part }), {});
      const slop = (add.props.hitSlop as number | undefined) ?? 0;
      expect(style.height ?? style.minHeight).toBe(40);
      expect(40 + 2 * slop).toBeGreaterThanOrEqual(44);
      const link = view.root.findByProps({ accessibilityLabel: 'Belirt' });
      const linkStyle = ([] as Record<string, number>[]).concat(link.props.style as never).flat(2).reduce((all, part) => ({ ...all, ...part }), {});
      expect(linkStyle.minHeight).toBeGreaterThanOrEqual(44);
    } finally { await renderer.act(() => view.unmount()); }
  });
  test('no percent, points, badge or level wording', async () => {
    for (const patch of [{}, { passedProductIds: ids(10), wardrobeItems, profile }]) {
      const view = await render(patch);
      try { expect(texts(view)).not.toMatch(/%|puan|rozet|seviye|daha iyi/i); }
      finally { await renderer.act(() => view.unmount()); }
    }
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
  test('rows are full width: no two-column tile layout remains', async () => {
    const view = await mount(createElement(ProfileStyleGrid, { journey: learned(), onRetry: jest.fn(), onSelectSection: jest.fn() }));
    try {
      const row = view.root.findByProps({ accessibilityLabel: 'Renk: Siyah' });
      const style = ([] as Record<string, unknown>[]).concat(row.props.style as never).flat(2).reduce((all, part) => ({ ...all, ...part }), {});
      expect(style.width).toBeUndefined();
      expect(style.flexGrow).toBeUndefined();
      expect(Number(style.minHeight)).toBeGreaterThanOrEqual(68);
    } finally { await renderer.act(() => view.unmount()); }
  });
  test('Parça and Kesim sheets have the source bar but no "seç" button', async () => {
    const journey = buildStyleJourney(base({ passedProductIds: ids(8), calculatedProfile: model({ subcategoryW: { pantolon: 1 }, fitW: { slim: 1 } }) }));
    const onSelectSection = jest.fn();
    const view = await mount(createElement(ProfileStyleGrid, { journey, onRetry: jest.fn(), onSelectSection }));
    try {
      for (const label of ['Parça: Pantolon', 'Kesim: Dar']) {
        await renderer.act(() => { (view.root.findByProps({ accessibilityLabel: label }).props.onPress as () => void)(); });
        expect(texts(view)).toContain('Nereden öğrendik?');
        expect(view.root.findAllByProps({ accessibilityLabel: 'Parça seç' })).toHaveLength(0);
        expect(view.root.findAllByProps({ accessibilityLabel: 'Kesim seç' })).toHaveLength(0);
      }
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
      for (const label of ['Sadece sen belirlersin', 'Bunları tahmin etmiyoruz.', 'Stil tarzı', 'Beden', 'Belirlenmedi', 'Ekle']) expect(text).toContain(label);
      expect(view.root.findAllByProps({ testID: 'only-you-style-add' }).length).toBeGreaterThan(0);
      await renderer.act(() => { (view.root.findByProps({ accessibilityLabel: 'Stil tarzı ekle' }).props.onPress as () => void)(); });
      await renderer.act(() => { (view.root.findByProps({ accessibilityLabel: 'Beden ekle' }).props.onPress as () => void)(); });
      expect(onOpen.mock.calls).toEqual([['style'], ['body']]);
    } finally { await renderer.act(() => view.unmount()); }
  });
});

describe('presentation rules', () => {
  test('no dashed borders or card shadows remain in the profile style components', () => {
    for (const file of ['ProfileStyleJourney', 'ProfileStyleGrid', 'ProfileOnlyYou', 'ProfileStyleVisuals']) {
      const source = readFileSync(join(__dirname, '..', 'components', `${file}.tsx`), 'utf8');
      expect(source).not.toMatch(/dashed/);
      expect(source).not.toMatch(/\.\.\.shadows\./);
    }
  });
  test('Stilin is a single card holding all five rows', async () => {
    const journey = buildStyleJourney(base({ passedProductIds: ids(8), calculatedProfile: model({ colorW: { siyah: 1 } }) }));
    const view = await mount(createElement(ProfileStyleGrid, { journey, onRetry: jest.fn(), onSelectSection: jest.fn() }));
    try {
      expect(hosts(view, 'style-card')).toHaveLength(1);
    } finally { await renderer.act(() => view.unmount()); }
  });
  test('price row shows three tier pills, the active one marked, the band name and no amount', async () => {
    const priced = buildStyleJourney(base({ passedProductIds: ids(8), calculatedProfile: {
      state: 'ready', profile: { snapshot: { ...emptyStyleProfile('A'), priceBandW: { mid: 1 } }, algorithm: 'v2', eventCount: 9, computedAt: null } } }));
    const view = await mount(createElement(ProfileStyleGrid, { journey: priced, onRetry: jest.fn(), onSelectSection: jest.fn() }));
    try {
      expect(hosts(view, 'price-pill-active')).toHaveLength(1);
      expect(hosts(view, 'price-pill')).toHaveLength(2);
      expect(texts(view)).toContain('Orta');
    } finally { await renderer.act(() => view.unmount()); }
  });
});
