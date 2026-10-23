import { createElement, type ElementType, type ReactElement } from 'react';
import {
  Alert,
  Dimensions,
  FlatList,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import AddWardrobeScreen from '../app/wardrobe/add';
import WardrobeListScreen from '../app/wardrobe/[section]';
import { MOCK_PRODUCTS } from '../data/mockProducts';
import type { WardrobeItem, SavedOutfit } from '../types/wardrobe';

interface Node {
  props: {
    onPress: () => void;
    onChangeText: (value: string) => void;
    disabled?: boolean;
    numColumns: number;
    width: number;
    imageHeight: number;
    favorite: boolean;
    wardrobe: boolean;
    item: { product: (typeof MOCK_PRODUCTS)[number] };
    onCombine: (product: (typeof MOCK_PRODUCTS)[number]) => void;
    onSwipeDelete: (product: (typeof MOCK_PRODUCTS)[number]) => void;
    source: { uri: string };
    data: {
      kind: string;
      item?: { product: (typeof MOCK_PRODUCTS)[number] };
    }[];
    style: StyleProp<ViewStyle>;
  };
}
interface Tree {
  root: {
    findByProps: (props: Record<string, unknown>) => Node;
    findByType: (type: ElementType) => Node;
    findAllByProps: (props: Record<string, unknown>) => Node[];
  };
  unmount: () => void;
  update: (element: ReactElement) => void;
}
const renderer = jest.requireActual('react-test-renderer') as {
  create: (element: ReactElement) => Tree;
  act: (callback: () => void | Promise<void>) => Promise<void>;
};
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockDismissTo = jest.fn();
const mockNavigate = jest.fn();
let mockParams: { section?: string; id?: string } = {};
const mockState = {
  wardrobeItems: [] as WardrobeItem[],
  savedOutfits: [] as SavedOutfit[],
  likedProducts: [] as { product: (typeof MOCK_PRODUCTS)[number] }[],
  wardrobeStatus: 'ready',
  wardrobeSync: undefined as {state:'pending'|'synced'|'conflict';pending:number;message?:string} | undefined,
  sessionUserId: 'owner',
  addWardrobeItem: jest.fn().mockResolvedValue(undefined),
  updateWardrobeItem: jest.fn().mockResolvedValue(undefined),
  removeWardrobeItem: jest.fn().mockResolvedValue(undefined),
  unlikeProduct: jest.fn().mockResolvedValue(undefined),
  hydrateWardrobe: jest.fn().mockResolvedValue(undefined),
  refreshWardrobe: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../store/useAppStore', () => ({
  useAppStore: Object.assign((selector: (state: typeof mockState) => unknown) =>
    selector(mockState), { getState: () => mockState }),
}));
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    back: () => mockBack(),
    dismissTo: (...args: unknown[]) => mockDismissTo(...args),
    navigate: (...args: unknown[]) => mockNavigate(...args),
  },
  Stack: { Screen: 'StackScreen' },
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (callback: () => void | (() => void)) => jest.requireActual<typeof import('react')>('react').useEffect(callback, [callback]),
}));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 12 }) }));
jest.mock('lucide-react-native', () => ({
  Layers: () => null,
  Shirt: () => null,
  Camera: () => null, ImagePlus: () => null, Footprints: () => null,
  Tag: () => null, ArrowDown: () => null, ChevronLeft: () => null,
}));
jest.mock('../components/PressableScale', () => 'PressableScale');
jest.mock('../components/VirtualTryOnModal', () => 'VirtualTryOnModal');
jest.mock('../app/(tabs)/liked', () => ({
  DolapProductCard: (props: { item: { product: { title: string } } }) => {
    const React = jest.requireActual('react') as typeof import('react');
    return React.createElement('DolapProductCard', {
      ...props,
      accessibilityLabel: `${props.item.product.title} Dolap kartı`,
    });
  },
  DolapAddCard: 'DolapAddCard',
  dolapCardStyles: {
    card: {},
    image: {},
    imageFallback: {},
    metaCopy: {},
    title: {},
    category: {},
  },
}));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

describe('Dolap child routes', () => {
  let tree: Tree;
  const mount = async (screen: ElementType): Promise<void> => {
    await renderer.act(async () => {
      tree = renderer.create(createElement(screen));
    });
  };
  const press = async (label: string): Promise<void> => {
    await renderer.act(async () =>
      tree.root.findByProps({ accessibilityLabel: label }).props.onPress(),
    );
  };
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
    mockState.wardrobeItems = [];
    mockState.savedOutfits = [];
    mockState.likedProducts = [];
    mockState.wardrobeSync = undefined;
    mockState.addWardrobeItem.mockResolvedValue(undefined);
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue({
      granted: true,
    } as ImagePicker.CameraPermissionResponse);
    jest
      .mocked(ImagePicker.requestMediaLibraryPermissionsAsync)
      .mockResolvedValue({
        granted: true,
      } as ImagePicker.MediaLibraryPermissionResponse);
    const result = {
      canceled: false,
      assets: [{ uri: 'file:///cache/selected.jpg', width: 100, height: 200 }],
    } as ImagePicker.ImagePickerResult;
    jest.mocked(ImagePicker.launchCameraAsync).mockResolvedValue(result);
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue(result);
  });
  afterEach(async () => {
    if (tree) await renderer.act(async () => tree.unmount());
    jest.restoreAllMocks();
  });

  it('shows pending cloud state and exposes a safe retry without hiding records', async () => {
    mockParams={section:'clothes'};
    mockState.wardrobeSync={state:'pending',pending:1,message:'Yerel kayıt korundu; bulut bekleniyor.'};
    await mount(WardrobeListScreen);
    expect(tree.root.findByProps({accessibilityLabel:'Dolap bulut durumu'})).toBeDefined();
    await press('Dolabı senkronize et');
    expect(mockState.refreshWardrobe).toHaveBeenCalledTimes(1);
  });
  it('does not show wardrobe sync warnings in the favorites-only list', async () => {
    mockParams={section:'favorites'};
    mockState.wardrobeSync={state:'pending',pending:1,message:'Bekliyor'};
    await mount(WardrobeListScreen);
    expect(tree.root.findAllByProps({accessibilityLabel:'Dolap bulut durumu'})).toHaveLength(0);
  });
  it.each(['Fotoğraf çek', 'Galeriden seç'])(
    'adds an actual image via %s and returns only after saving',
    async (label) => {
      await mount(AddWardrobeScreen);
      await press(label);
      await renderer.act(async () =>
        tree.root
          .findByProps({ accessibilityLabel: 'Kıyafet adı' })
          .props.onChangeText('Kendi gömleğim'),
      );
      await press('Kıyafeti kaydet');
      expect(mockState.addWardrobeItem).toHaveBeenCalledWith({
        title: 'Kendi gömleğim',
        brand: '',
        category: 'upper_body',
        imageUrl: 'file:///cache/selected.jpg',
      }, expect.objectContaining({ requestId: expect.any(String), onStage: expect.any(Function) }));
      expect(mockDismissTo).toHaveBeenCalledWith('/(tabs)/liked');
      const picker =
        label === 'Fotoğraf çek'
          ? ImagePicker.launchCameraAsync
          : ImagePicker.launchImageLibraryAsync;
      expect(picker).toHaveBeenCalledWith(
        expect.objectContaining({
          allowsEditing: false,
          mediaTypes: ['images'],
        }),
      );
    },
  );
  it('does not add a canceled photo or leave after a failed save', async () => {
    jest
      .mocked(ImagePicker.launchImageLibraryAsync)
      .mockResolvedValueOnce({ canceled: true, assets: null });
    await mount(AddWardrobeScreen);
    await press('Galeriden seç');
    await press('Kıyafeti kaydet');
    expect(mockState.addWardrobeItem).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockDismissTo).not.toHaveBeenCalled();
    await press('Galeriden seç');
    await renderer.act(async () =>
      tree.root
        .findByProps({ accessibilityLabel: 'Kıyafet adı' })
        .props.onChangeText('Gömlek'),
    );
    mockState.addWardrobeItem.mockRejectedValueOnce(new Error('disk full'));
    await press('Kıyafeti kaydet');
    expect(Alert.alert).not.toHaveBeenCalledWith('Kaydedilemedi', 'disk full');
    expect(tree.root.findByProps({ accessibilityLabel: 'Kayıt durumu' })).toBeDefined();
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockDismissTo).not.toHaveBeenCalled();
  });
  it('reports denied camera access and does not launch the camera', async () => {
    jest
      .mocked(ImagePicker.requestCameraPermissionsAsync)
      .mockResolvedValueOnce({
        granted: false,
      } as ImagePicker.CameraPermissionResponse);
    await mount(AddWardrobeScreen);
    await press('Fotoğraf çek');
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Fotoğraf izni gerekli',
      expect.any(String),
    );
  });
  it.each([
    [
      'clothes',
      'Kıyafetlerini eklemeye başla',
      'Kıyafet Ekle',
      '/wardrobe/add',
    ],
    [
      'outfits',
      'Henüz kombin oluşturmadın',
      'Yeni Kombin Oluştur',
      '/wardrobe/create',
    ],
  ])(
    'shows the %s empty CTA in the content center and opens its child route',
    async (section, text, cta, pathname) => {
      mockParams = { section };
      await mount(WardrobeListScreen);
      expect(tree.root.findByProps({ children: text })).toBeDefined();
      const listStyle = tree.root.findByType(FlatList).props;
      expect(listStyle.data).toEqual([]);
      await press(cta);
      expect(mockPush).toHaveBeenCalledWith({ pathname, params: {} });
    },
  );
  it('shows the favorites empty CTA and then uses real favorite data and product navigation', async () => {
    mockParams = { section: 'favorites' };
    await mount(WardrobeListScreen);
    expect(
      tree.root.findByProps({ children: 'Henüz favorin yok' }),
    ).toBeDefined();
    await press('Keşfet’ten Favorile');
    expect(mockNavigate).toHaveBeenCalledWith('/(tabs)');
    await renderer.act(async () => {
      tree.unmount();
      mockState.likedProducts = [{ product: MOCK_PRODUCTS[0] }];
      tree = renderer.create(createElement(WardrobeListScreen));
    });
    const entry = tree.root.findByType(FlatList).props.data[0];
    expect(entry.item?.product.title).toBe(MOCK_PRODUCTS[0].title);
    const card = tree.root.findByProps({
      accessibilityLabel: `${MOCK_PRODUCTS[0].title} Dolap kartı`,
    });
    await renderer.act(async () => card.props.onCombine(MOCK_PRODUCTS[0]));
    expect(mockPush).toHaveBeenLastCalledWith({
      pathname: '/wardrobe/create',
      params: { productId: MOCK_PRODUCTS[0].id, source: 'catalog' },
    });
  });
  it('removes an owned garment through its wardrobe action', async () => {
    mockParams = { section: 'clothes' };
    mockState.wardrobeItems = [
      {
        id: 'owned',
        title: 'Benim gömleğim',
        imageUrl: 'file:///owned.jpg',
        category: 'upper_body',
        brand: '',
        createdAt: '2026-09-28',
      },
    ];
    await mount(WardrobeListScreen);
    await renderer.act(async () =>
      tree.root
        .findByProps({ accessibilityLabel: 'Benim gömleğim Dolap kartı' })
        .props.onSwipeDelete(
          tree.root.findByProps({
            accessibilityLabel: 'Benim gömleğim Dolap kartı',
          }).props.item.product,
        ),
    );
    await renderer.act(async () =>
      jest
        .mocked(Alert.alert)
        .mock.lastCall?.[2]?.find((button) => button.text === 'Sil')
        ?.onPress?.(),
    );
    expect(mockState.removeWardrobeItem).toHaveBeenCalledWith('owned');
    expect(mockState.unlikeProduct).not.toHaveBeenCalled();
  });
  it.each([320, 390, 430])(
    'continues favorites in three equal columns on a %s px viewport',
    async (width) => {
      const original = Dimensions.get.bind(Dimensions);
      jest
        .spyOn(Dimensions, 'get')
        .mockImplementation((name) =>
          name === 'window'
            ? { width, height: 844, scale: 1, fontScale: 1 }
            : original(name),
        );
      mockParams = { section: 'favorites' };
      mockState.likedProducts = Array.from({ length: 7 }, (_, index) => ({
        product: {
          ...MOCK_PRODUCTS[0],
          id: `favorite-${index}`,
          title: `Favori ${index}`,
        },
      }));
      await mount(WardrobeListScreen);
      const grid = tree.root.findByType(FlatList);
      expect(grid.props.numColumns).toBe(3);
      expect(grid.props.data).toHaveLength(7);
      const cards = mockState.likedProducts.map(({ product }) =>
        tree.root.findByProps({
          accessibilityLabel: `${product.title} Dolap kartı`,
        }),
      );
      expect(new Set(cards.map((card) => card.props.width)).size).toBe(1);
      expect(new Set(cards.map((card) => card.props.imageHeight)).size).toBe(1);
      for (const card of cards) {
        expect(card.props.width).toBe((width - 48 - 12) / 3);
        expect(card.props.imageHeight).toBeGreaterThan(0);
        expect(card.props.favorite).toBe(true);
        expect(card.props.wardrobe).toBe(false);
      }
    },
  );
  it('keeps owned garments and their existing add card inside a three-column grid', async () => {
    mockParams = { section: 'clothes' };
    mockState.wardrobeItems = [
      {
        id: 'owned',
        title: 'Gömleğim',
        imageUrl: 'file:///owned.jpg',
        category: 'upper_body',
        brand: '',
        createdAt: '2026-09-28',
      },
    ];
    await mount(WardrobeListScreen);
    const grid = tree.root.findByType(FlatList);
    expect(grid.props.numColumns).toBe(3);
    expect(grid.props.data.map((entry) => entry.kind)).toEqual([
      'product',
      'add',
    ]);
    const card = tree.root.findByProps({
      accessibilityLabel: 'Gömleğim Dolap kartı',
    });
    expect(card.props.wardrobe).toBe(true);
    expect(card.props.favorite).toBe(false);
    expect(tree.root.findByProps({ outfit: false }).props.width).toBe(
      card.props.width,
    );
  });
  it('uses existing outfit card styles and adds the create card to the grid', async () => {
    mockParams = { section: 'outfits' };
    mockState.savedOutfits = [
      {
        id: 'saved',
        title: 'Günlük kombin',
        wardrobeItemIds: ['owned'],
        catalogProductIds: [],
        createdAt: '2026-09-28',
      },
    ];
    await mount(WardrobeListScreen);
    const grid = tree.root.findByType(FlatList);
    expect(grid.props.numColumns).toBe(3);
    expect(grid.props.data.map((entry) => entry.kind)).toEqual([
      'outfit',
      'add',
    ]);
    expect(tree.root.findByProps({ children: 'Günlük kombin' })).toBeDefined();
    expect(tree.root.findByProps({ outfit: true })).toBeDefined();
  });

  it('blocks same-frame duplicate saves while a slow request is in flight', async () => {
    await mount(AddWardrobeScreen);
    await press('Galeriden seç');
    await renderer.act(() => tree.root.findByProps({ accessibilityLabel: 'Kıyafet adı' }).props.onChangeText('Gömlek'));
    let finish!: () => void;
    mockState.addWardrobeItem.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const save = tree.root.findByProps({ accessibilityLabel: 'Kıyafeti kaydet' }).props.onPress;
    await renderer.act(() => { save(); save(); });
    expect(mockState.addWardrobeItem).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockDismissTo).not.toHaveBeenCalled();
    expect(tree.root.findByProps({ accessibilityLabel: 'Kıyafeti kaydet' }).props.disabled).toBe(true);
    await renderer.act(async () => { finish(); });
    expect(mockDismissTo).toHaveBeenCalledWith('/(tabs)/liked');
  });

  it('does not navigate after leaving during a pending save', async () => {
    await mount(AddWardrobeScreen);
    await press('Galeriden seç');
    await renderer.act(() => tree.root.findByProps({ accessibilityLabel: 'Kıyafet adı' }).props.onChangeText('Gömlek'));
    let finish!: () => void;
    mockState.addWardrobeItem.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    await renderer.act(() => { tree.root.findByProps({ accessibilityLabel: 'Kıyafeti kaydet' }).props.onPress(); });
    await renderer.act(() => tree.unmount());
    await renderer.act(async () => { finish(); });
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockDismissTo).not.toHaveBeenCalled();
  });

  it.each([['Üst', 'upper_body'], ['Alt', 'lower_body'], ['Ayakkabı', 'shoes'], ['Aksesuar', 'accessories']])('shows the %s category card and keeps its stored value', async (label, category) => {
    await mount(AddWardrobeScreen);
    await press('Galeriden seç');
    await renderer.act(() => tree.root.findByProps({ accessibilityLabel: 'Kıyafet adı' }).props.onChangeText('Parçam'));
    await press(`${label} kategorisi`);
    await press('Kıyafeti kaydet');
    expect(mockState.addWardrobeItem).toHaveBeenCalledWith(expect.objectContaining({ category }), expect.any(Object));
  });

  it.each(['dresses', 'bags', 'hats'] as const)('preserves legacy %s on edit without changing category semantics', async category => {
    mockParams = { id: 'old' };
    mockState.wardrobeItems = [{ id: 'old', title: 'Eski', brand: '', imageUrl: 'old.jpg', category, createdAt: '' }];
    await mount(AddWardrobeScreen);
    await press('Kıyafeti kaydet');
    expect(mockState.updateWardrobeItem).toHaveBeenCalledWith('old', expect.objectContaining({ category }), expect.any(Function));
  });


  it('retries a failed save with the same intent identity', async () => {
    await mount(AddWardrobeScreen);
    await press('Galeriden seç');
    await renderer.act(() => tree.root.findByProps({ accessibilityLabel: 'Kıyafet adı' }).props.onChangeText('Gömlek'));
    mockState.addWardrobeItem.mockRejectedValueOnce(new Error('disk full'));
    await press('Kıyafeti kaydet');
    const options = mockState.addWardrobeItem.mock.calls[0][1];
    await press('Kıyafeti kaydet');
    expect(mockState.addWardrobeItem.mock.calls[1][1].requestId).toBe(options.requestId);
    expect(mockDismissTo).toHaveBeenCalledWith('/(tabs)/liked');
  });

  it('ignores a picker result delivered after leaving the screen', async () => {
    let finish!: (value: ImagePicker.ImagePickerResult) => void;
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mount(AddWardrobeScreen);
    await renderer.act(() => { tree.root.findByProps({ accessibilityLabel: 'Galeriden seç' }).props.onPress(); });
    await renderer.act(() => tree.unmount());
    await renderer.act(async () => { finish({ canceled: false, assets: [{ uri: 'private.jpg', width: 10, height: 20 }] } as ImagePicker.ImagePickerResult); });
    expect(mockState.addWardrobeItem).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockDismissTo).not.toHaveBeenCalled();
  });


  it.each([['Üst', 'Elbise', 'dresses'], ['Aksesuar', 'Çanta', 'bags'], ['Aksesuar', 'Şapka', 'hats']])('retains %s / %s as a real stored subcategory', async (main, sub, category) => {
    await mount(AddWardrobeScreen);
    await press('Galeriden seç');
    await renderer.act(() => tree.root.findByProps({ accessibilityLabel: 'Kıyafet adı' }).props.onChangeText('Parça'));
    await press(`${main} kategorisi`);
    await press(`${sub} alt kategorisi`);
    await press('Kıyafeti kaydet');
    expect(mockState.addWardrobeItem).toHaveBeenCalledWith(expect.objectContaining({ category }), expect.any(Object));
  });

  it('prevents duplicate picker launches from same-frame taps', async () => {
    await mount(AddWardrobeScreen);
    const pick = tree.root.findByProps({ accessibilityLabel: 'Galeriden seç' }).props.onPress;
    await renderer.act(() => { pick(); pick(); });
    expect(ImagePicker.requestMediaLibraryPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
  });


  it('shows the actual pending stage then returns directly to Dolap without a local-save success dialog', async () => {
    await mount(AddWardrobeScreen);
    await press('Galeriden seç');
    await renderer.act(() => tree.root.findByProps({ accessibilityLabel: 'Kıyafet adı' }).props.onChangeText('Parça'));
    let finish!: () => void;
    mockState.addWardrobeItem.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    await renderer.act(() => { tree.root.findByProps({ accessibilityLabel: 'Kıyafeti kaydet' }).props.onPress(); });
    await renderer.act(() => mockState.addWardrobeItem.mock.calls[0][1].onStage('upload'));
    expect(tree.root.findAllByProps({ children: 'Fotoğraf güvenli biçimde yükleniyor…' }).length).toBeGreaterThan(0);
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockDismissTo).not.toHaveBeenCalled();
    mockState.wardrobeSync = { state: 'pending', pending: 1, message: 'internal implementation detail' };
    await renderer.act(async () => { finish(); });
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockDismissTo).toHaveBeenCalledWith('/(tabs)/liked');
    expect(mockState.wardrobeSync).toMatchObject({ state: 'pending', pending: 1 });
    expect(mockState.addWardrobeItem).toHaveBeenCalledTimes(1);
  });


  it('does not resubmit a completed intent before navigation unmounts the screen', async () => {
    await mount(AddWardrobeScreen);
    await press('Galeriden seç');
    await renderer.act(() => tree.root.findByProps({ accessibilityLabel: 'Kıyafet adı' }).props.onChangeText('Parça'));
    const save = tree.root.findByProps({ accessibilityLabel: 'Kıyafeti kaydet' }).props.onPress;
    await renderer.act(async () => { save(); });
    await renderer.act(async () => { save(); });
    expect(mockState.addWardrobeItem).toHaveBeenCalledTimes(1);
    expect(mockDismissTo).toHaveBeenCalledWith('/(tabs)/liked');
  });

});
