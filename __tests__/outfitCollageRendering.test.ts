import { createElement, type ElementType, type ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import OutfitCollage from '../components/OutfitCollage';
import OutfitCover from '../components/OutfitCover';
import { wardrobeCollagePart, type CollagePart } from '../lib/outfitCollage';
import type { WardrobeItem, SavedOutfit } from '../types/wardrobe';
import type { Product } from '../types/product';

interface Node {
  props: {
    contentFit: string;
    contentPosition: string;
    cachePolicy: string;
    source: { uri: string };
    onError: () => void;
    style: object;
    parts: CollagePart[];
  };
}
interface Tree {
  root: {
    findAllByType: (type: ElementType | string) => Node[];
    findAllByProps: (props: object) => Node[];
  };
  update: (element: ReactElement) => void;
  unmount: () => void;
}
const renderer = jest.requireActual('react-test-renderer') as {
  create: (element: ReactElement) => Tree;
  act: (callback: () => void | Promise<void>) => Promise<void>;
};
jest.mock('expo-image', () => ({ Image: 'CollageImage' }));
jest.mock('lucide-react-native', () => ({ Shirt: 'Shirt' }));
const mockState = {
  sessionUserId: null,
  wardrobeItems: [] as WardrobeItem[],
  likedProducts: [] as { product: Product }[],
  currentProducts: [] as Product[],
};
jest.mock('../store/useAppStore', () => ({
  useAppStore: (selector: (state: typeof mockState) => unknown) =>
    selector(mockState),
}));
jest.mock('../lib/accountDeviceWork', () => ({
  trackOwnerWork: (_owner: string, work: Promise<unknown>) => work,
  captureOwnerPublication: () => () => true,
}));
const mockFetch = jest.fn();
jest.mock('../services/outfitCoverService', () => ({
  fetchOutfitCoverParts: (...args: unknown[]) => mockFetch(...args),
}));

beforeEach(() => {
  mockState.wardrobeItems = [];
  mockState.likedProducts = [];
  mockState.currentProducts = [];
  mockFetch.mockReset().mockImplementation(async (_outfit, local) => local);
});

const photo = (id: string): CollagePart => ({
  key: id,
  source: 'catalog',
  sourceId: id,
  imageUrl: `${id}.jpg`,
});
test('portrait and landscape panels preserve the complete image; failures have a placeholder and new URLs recover', async () => {
  let tree!: Tree;
  const render = (parts: CollagePart[]) =>
    createElement(OutfitCollage, { parts, style: { height: 190 } });
  await renderer.act(async () => {
    tree = renderer.create(render([photo('portrait'), photo('landscape')]));
  });
  try {
    const images = tree.root.findAllByType('CollageImage');
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image.props.contentFit).toBe('contain');
      expect(image.props.contentPosition).toBe('center');
      expect(image.props.cachePolicy).toBe('memory-disk');
      expect(StyleSheet.flatten(image.props.style)).toMatchObject({
        width: '100%',
        height: '100%',
      });
    }
    await renderer.act(async () => images[0].props.onError());
    expect(tree.root.findAllByType('CollageImage')).toHaveLength(1);
    expect(tree.root.findAllByType('Shirt')).toHaveLength(1);
    await renderer.act(async () =>
      tree.update(
        render([
          { ...photo('portrait'), imageUrl: 'new.jpg' },
          photo('landscape'),
        ]),
      ),
    );
    expect(tree.root.findAllByType('CollageImage')).toHaveLength(2);
  } finally {
    await renderer.act(async () => tree.unmount());
  }
});

test.each([0, 1, 2, 3, 4, 5, 6, 7, 8])(
  'renders %i pieces without dropping products',
  async (count) => {
    let tree!: Tree;
    const parts = Array.from({ length: count }, (_, i) => photo(String(i)));
    await renderer.act(async () => {
      tree = renderer.create(createElement(OutfitCollage, { parts }));
    });
    try {
      expect(tree.root.findAllByType('CollageImage')).toHaveLength(count);
      if (!count) expect(tree.root.findAllByType('Shirt')).toHaveLength(1);
    } finally {
      await renderer.act(async () => tree.unmount());
    }
  },
);

test('saved outfit adapter keeps verified local cutouts after remote originals resolve', async () => {
  mockState.wardrobeItems = ['upper_body', 'lower_body'].map((category, i) => ({
    id: String(i),
    title: '',
    brand: '',
    createdAt: '',
    category: category as WardrobeItem['category'],
    imageUrl: `original:${i}`,
    cutoutUrl: `cutout:${i}`,
    cutoutStatus: 'ready',
  }));
  mockFetch.mockResolvedValue(
    mockState.wardrobeItems.map((item) => ({
      key: `relation:${item.id}`,
      source: 'wardrobe',
      sourceId: item.id,
      imageUrl: item.imageUrl,
    })),
  );
  const outfit: SavedOutfit = {
    id: 'saved',
    title: 'Kombin',
    wardrobeItemIds: ['0', '1'],
    catalogProductIds: [],
    createdAt: '',
  };
  let tree!: Tree;
  await renderer.act(async () => {
    tree = renderer.create(createElement(OutfitCover, { outfit }));
  });
  try {
    const images = tree.root.findAllByType('CollageImage');
    expect(images.map((image) => image.props.source.uri)).toEqual(
      mockState.wardrobeItems.map((item) => wardrobeCollagePart(item).imageUrl),
    );
    expect(
      tree.root.findAllByProps({ testID: 'outfit-collage-flat-lay' }).length,
    ).toBeGreaterThan(0);
    expect(
      tree.root
        .findAllByType('CollageImage')
        .every((node) => node.props.cachePolicy === 'none'),
    ).toBe(true);
  } finally {
    await renderer.act(async () => tree.unmount());
  }
});

test('legacy cover-only records still display their image in moodboard mode', async () => {
  const outfit: SavedOutfit = {
    id: 'old',
    title: 'Eski',
    imageUrl: 'old.jpg',
    wardrobeItemIds: [],
    catalogProductIds: [],
    createdAt: '',
  };
  let tree!: Tree;
  await renderer.act(async () => {
    tree = renderer.create(createElement(OutfitCover, { outfit }));
  });
  try {
    expect(
      tree.root.findAllByProps({ testID: 'outfit-collage-moodboard' }).length,
    ).toBeGreaterThan(0);
    expect(tree.root.findAllByType('CollageImage')[0].props.source.uri).toBe(
      'old.jpg',
    );
  } finally {
    await renderer.act(async () => tree.unmount());
  }
});
