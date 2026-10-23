import { createElement, type ReactElement } from 'react';
import { Text } from 'react-native';
import ProfileStyleJourney from '../components/ProfileStyleJourney';
import { buildStyleJourney } from '../lib/profileStyleJourney';
import type { StyleJourneyInput } from '../lib/profileStyleJourney';
jest.mock('react-native-svg', () => ({ __esModule: true, default: 'Svg', Circle: 'Circle' }));
jest.mock('lucide-react-native', () => ({ Sparkles: 'Sparkles', Lock: 'Lock', ChevronRight: 'ChevronRight', Palette: 'Palette', Shirt: 'Shirt', Layers: 'Layers', Ruler: 'Ruler', Tag: 'Tag', Database: 'Database', ShoppingBag: 'ShoppingBag' }));
jest.mock('../components/PressableScale', () => 'PressableScale');
interface Tree {
  root: { findAllByType: (type: typeof Text) => Array<{ props: { children: unknown } }>;
    findByProps: (props: Record<string, unknown>) => { props: { onPress: () => void; accessibilityValue: { now: number } } } };
  update: (element: ReactElement) => void;
  unmount: () => void;
}
const renderer = jest.requireActual('react-test-renderer') as {
  create: (element: ReactElement) => Tree; act: (callback: () => void) => Promise<void>;
};
const empty = () => buildStyleJourney({ userId: 'A', sessionUserId: 'A', sessionSyncStatus: 'success',
  wardrobeStatus: 'ready', likedProducts: [], passedProductIds: [], wardrobeItems: [], savedOutfits: [], profile: null });
test('renders the existing progress/card language with explicit meaning and locked insights', async () => {
  let view: Tree | undefined; const task = jest.fn();
  try {
    await renderer.act(() => { view = renderer.create(createElement(ProfileStyleJourney, { journey: empty(), onTask: task })); });
    if (!view) throw new Error('No render');
    const text = view.root.findAllByType(Text).map(node => node.props.children).join(' ');
    expect(text).toContain('Stil Yolculuğun');
    expect(text).toContain('model doğruluğu');
    expect(text).toContain('Henüz keşfedilmedi');
    expect(view.root.findByProps({ accessibilityLabel: 'Keşif adımlarının tamamlanması' }).props.accessibilityValue.now).toBe(0);
    await renderer.act(() => { view?.root.findByProps({ accessibilityLabel: empty().task.label }).props.onPress(); });
    expect(task).toHaveBeenCalledWith('discover');
    await renderer.act(() => { view?.update(createElement(ProfileStyleJourney, { journey: empty(), onTask: task })); });
    expect(view.root.findByProps({ accessibilityLabel: 'Keşif adımlarının tamamlanması' }).props.accessibilityValue.now).toBe(0);
  } finally { await renderer.act(() => view?.unmount()); }
});
test('unlocked insights disappear immediately on account change and return from the same saved input', async () => {
  const input: StyleJourneyInput = { userId: 'A', sessionUserId: 'A', sessionSyncStatus: 'success', wardrobeStatus: 'ready',
    passedProductIds: [], wardrobeItems: [], savedOutfits: [], profile: null,
    likedProducts: Array.from({ length: 5 }, (_,i) => ({ likedAt: '2026-10-12', notifyOnPriceDrop: false,
      product: { id: `p${i}`, title: 'Fixture', brand: 'Fixture', imageUrl: 'https://example.invalid/photo',
        price: 100, garmentDescription: 'Fixture', category: 'upper_body', colors: [{ name: 'Siyah', hex: '#111111' }] } })) };
  const task = jest.fn(); let view: Tree | undefined;
  try {
    await renderer.act(() => { view = renderer.create(createElement(ProfileStyleJourney, { journey: buildStyleJourney(input), onTask: task })); });
    if (!view) throw new Error('No render');
    expect(view.root.findByProps({ accessibilityLabel: 'Renk eğilimlerin: Keşfedildi' })).toBeDefined();
    await renderer.act(() => { view?.update(createElement(ProfileStyleJourney, { journey: buildStyleJourney({ ...input, userId: 'B' }), onTask: task })); });
    expect(view.root.findByProps({ accessibilityLabel: 'Renk eğilimlerin: Henüz keşfedilmedi' })).toBeDefined();
    expect(view.root.findAllByType(Text).map(node => node.props.children).join(' ')).not.toContain('Siyah');
    await renderer.act(() => { view?.update(createElement(ProfileStyleJourney, { journey: buildStyleJourney(input), onTask: task })); });
    expect(view.root.findByProps({ accessibilityLabel: 'Renk eğilimlerin: Keşfedildi' })).toBeDefined();
  } finally { await renderer.act(() => view?.unmount()); }
});
test('renders five tendencies, hides technical counters and keeps the next step usable on a V2 error', async () => {
  const journey = buildStyleJourney({ userId: 'A', sessionUserId: 'A', sessionSyncStatus: 'success', wardrobeStatus: 'ready', likedProducts: [], passedProductIds: Array.from({ length: 191 }, (_, i) => String(i)), wardrobeItems: [], savedOutfits: [], profile: null, calculatedProfile: { state: 'error' } });
  let view: Tree | undefined;
  await renderer.act(() => { view = renderer.create(createElement(ProfileStyleJourney, { journey, onTask: jest.fn() })); });
  const text = view!.root.findAllByType(Text).map(node => node.props.children).join(' ');
  for (const label of ['Renk eğilimlerin', 'Parça tercihlerin', 'Kesim eğilimlerin', 'Marka eğilimlerin', 'Fiyat eğilimlerin']) expect(text).toContain(label);
  expect(text).not.toContain('191');
  expect(text).not.toContain('Otomatik tarz');
  expect(view!.root.findByProps({ accessibilityLabel: journey.task.label })).toBeDefined();
  await renderer.act(() => view?.unmount());
});
