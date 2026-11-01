import { createElement, type ReactElement } from 'react';
import WardrobeItemSheet from '../components/WardrobeItemSheet';

interface TestNode {
  type: unknown;
  props: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}
interface TestTree {
  root: {
    findByProps: (props: Record<string, unknown>) => TestNode;
    findAllByProps: (props: Record<string, unknown>) => TestNode[];
    findAllByType: (type: string) => TestNode[];
  };
  unmount: () => void;
  update: (element: ReactElement) => void;
}
const renderer = jest.requireActual('react-test-renderer') as {
  create: (element: ReactElement) => TestTree;
  act: (callback: () => void | Promise<void>) => Promise<void>;
};
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => ({
  Modal: 'Modal',
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  PanResponder: { create: (config: unknown) => ({ panHandlers: config }) },
  StyleSheet: { create: (value: unknown) => value, absoluteFill: {}, hairlineWidth: 1 },
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('lucide-react-native', () => ({ Pencil: 'Pencil', Trash2: 'Trash2' }));
jest.mock('../components/PressableScale', () => 'PressableScale');

describe('WardrobeItemSheet', () => {
  let tree: TestTree;
  const onClose = jest.fn();
  const onEdit = jest.fn();
  const onDelete = jest.fn();
  const mount = async (visible = true): Promise<void> => {
    await renderer.act(() => {
      tree = renderer.create(
        createElement(WardrobeItemSheet, {
          visible, title: 'Siyah Ceket', subtitle: 'Üst', imageUri: 'file:///a.png', onClose, onEdit, onDelete,
        }),
      );
    });
  };
  const press = async (label: string): Promise<void> => {
    const node = tree.root.findAllByProps({ accessibilityLabel: label }).find(n => typeof n.props.onPress === 'function');
    await renderer.act(() => { node?.props.onPress(); });
  };
  const texts = (): unknown[] => tree.root.findAllByType('Text').map(n => n.props.children);
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => tree.unmount());

  it('is visible with title, subtitle and both actions, without a cancel button', async () => {
    await mount();
    expect(tree.root.findAllByType('Modal')[0].props.visible).toBe(true);
    expect(texts()).toEqual(expect.arrayContaining(['Siyah Ceket', 'Üst', 'Düzenle', 'Sil']));
    expect(texts()).not.toContain('İptal');
  });

  it('closes then edits when Düzenle is pressed', async () => {
    await mount();
    await press('Düzenle');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('asks for confirmation before deleting, and Vazgeç goes back without deleting', async () => {
    await mount();
    await press('Sil');
    expect(onDelete).not.toHaveBeenCalled();
    expect(texts()).toContain('Bu kıyafet silinsin mi?');
    await press('Vazgeç');
    expect(onDelete).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(texts()).toContain('Düzenle');
  });

  it('deletes only after the confirm step', async () => {
    await mount();
    await press('Sil');
    await press('Kıyafeti sil');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('closes from backdrop, hardware back and a downward drag', async () => {
    await mount();
    await renderer.act(() => { tree.root.findAllByType('Modal')[0].props.onRequestClose(); });
    await press('Kapat');
    expect(onClose).toHaveBeenCalledTimes(2);
    const handlers = tree.root.findAllByType('View').find(n => n.props.onPanResponderRelease)?.props;
    await renderer.act(() => { handlers?.onPanResponderRelease({}, { dy: 20, vy: 0.1 }); });
    expect(onClose).toHaveBeenCalledTimes(2);
    await renderer.act(() => { handlers?.onPanResponderRelease({}, { dy: 120, vy: 0.1 }); });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('resets the confirm step when reopened', async () => {
    await mount();
    await press('Sil');
    const props = { title: 'Siyah Ceket', onClose, onEdit, onDelete };
    await renderer.act(() => { tree.update(createElement(WardrobeItemSheet, { ...props, visible: false })); });
    await renderer.act(() => { tree.update(createElement(WardrobeItemSheet, { ...props, visible: true })); });
    expect(texts()).toContain('Düzenle');
  });
});
