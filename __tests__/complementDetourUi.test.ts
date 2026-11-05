import { createElement, type ReactElement } from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import DiscoverRecommendations, { complementaryProductsForDisplay } from '../components/DiscoverRecommendations';
import { getDiscoverRecommendations } from '../src/intelligence/recommendations/getDiscoverRecommendations';
import type { OutfitRole, Product } from '../types/product';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
}));
jest.mock('lucide-react-native', () => ({ Check: 'Check', Heart: 'Heart' }));
jest.mock('../components/PressableScale', () => 'PressableScale');
jest.mock('../components/DiscoverProductImage', () => 'DiscoverProductImage');

interface TestNode { props: Record<string, unknown>; findByProps: (props: Record<string, unknown>) => TestNode; findAllByProps: (props: Record<string, unknown>) => TestNode[] }
interface TestTree { root: TestNode; unmount: () => void }
const renderer = jest.requireActual('react-test-renderer') as {
  act: (callback: () => void) => Promise<void>;
  create: (element: ReactElement) => TestTree;
};

const product = (id: string, role: OutfitRole): Product => ({
  id, brand: id, title: `${id} ürün`, price: 1299.9, imageUrl: `https://example.com/${id}.jpg`,
  category: role === 'bottom' ? 'lower_body' : role === 'shoes' ? 'shoes' : 'upper_body',
  outfitRole: role, garmentDescription: id, gender: 'women',
});
const top = product('top', 'top');
const catalog = [top, product('bottom', 'bottom'), product('jacket', 'outerwear'), product('shoes', 'shoes')];
const recommendations = getDiscoverRecommendations({
  wardrobeItems: [], catalogProducts: catalog, requiredCatalogProductId: top.id, firstOnly: true,
});
const displayed = complementaryProductsForDisplay(recommendations, top.id);

describe('complement mini card body tap', () => {
  let tree: TestTree;
  const onSelectProduct = jest.fn();
  const onOpenProduct = jest.fn();
  afterEach(async () => { if (tree) await renderer.act(() => tree.unmount()); });
  const mount = async (withOpen: boolean): Promise<void> => {
    jest.clearAllMocks();
    await renderer.act(() => {
      tree = renderer.create(createElement(DiscoverRecommendations, {
        currentProductId: top.id, recommendations, onSelectProduct, ...(withOpen ? { onOpenProduct } : {}),
      }));
    });
  };
  const bodyOf = (p: Product) => tree.root.findByProps({ testID: `discover-recommendation-card-${p.id}` });

  it('tapping the body opens that very product object, not the heart handler', async () => {
    await mount(true);
    expect(displayed.length).toBeGreaterThan(0);
    const target = displayed[0];
    (bodyOf(target).props.onPress as () => void)();
    expect(onOpenProduct).toHaveBeenCalledTimes(1);
    expect(onOpenProduct.mock.calls[0][0]).toBe(target);
    expect(onSelectProduct).not.toHaveBeenCalled();
  });
  it('the heart/check button keeps its own handler and has no body handler', async () => {
    await mount(true);
    const target = displayed[0];
    const hit = tree.root.findAllByProps({ accessibilityLabel: `${target.title} seç` })
      .find(node => typeof node.props.onPress === 'function');
    expect(hit).toBeDefined();
    (hit!.props.onPress as () => void)();
    expect(onSelectProduct).toHaveBeenCalledWith(target);
    expect(onOpenProduct).not.toHaveBeenCalled();
  });
  it('without onOpenProduct the card has no press handler', async () => {
    await mount(false);
    expect(bodyOf(displayed[0]).props.onPress).toBeUndefined();
  });
});

describe('gesture wiring (source)', () => {
  const swipeCard = readFileSync(join(__dirname, '..', 'components', 'SwipeCard.tsx'), 'utf8');
  it('the recommendation strip is rendered outside the card GestureDetector, so taps cannot reach the pan/double-tap/pinch', () => {
    const detectorEnd = swipeCard.indexOf('</GestureDetector>', swipeCard.indexOf('<GestureDetector gesture={cardGesture}>'));
    const strip = swipeCard.indexOf('<DiscoverRecommendations');
    expect(detectorEnd).toBeGreaterThan(0);
    expect(strip).toBeGreaterThan(detectorEnd);
  });
  it('SwipeCard forwards the tap with its own product as source and only while current', () => {
    expect(swipeCard).toMatch(/onOpenProduct=\{/);
    expect(swipeCard).toMatch(/isCurrent/);
  });
});
