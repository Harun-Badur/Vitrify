import { createElement, type ReactElement } from 'react';
import { Text } from 'react-native';
import DiscoverRecommendations, {
  type RecommendationStatus,
} from '../components/DiscoverRecommendations';

jest.mock('lucide-react-native', () => ({ Check: 'Check', Heart: 'Heart' }));
jest.mock('../components/DiscoverProductImage', () => 'DiscoverProductImage');
jest.mock('../components/PressableScale', () => 'PressableScale');

const renderer = jest.requireActual('react-test-renderer') as {
  create: (element: ReactElement) => {
    root: {
      findAllByType: (
        type: typeof Text,
      ) => Array<{ props: { children: unknown } }>;
    };
    unmount: () => void;
  };
  act: (callback: () => void) => Promise<void>;
};

test.each<[RecommendationStatus, string]>([
  ['loading', 'Tamamlayıcı parçalar hazırlanıyor.'],
  ['error', 'Tamamlayıcı parçalar yüklenemedi. Daha sonra tekrar dene.'],
])(
  'shows the correct %s state while keeping the section mounted',
  async (status, message) => {
    let tree!: ReturnType<typeof renderer.create>;
    await renderer.act(() => {
      tree = renderer.create(
        createElement(DiscoverRecommendations, {
          currentProductId: 'anchor',
          recommendations: [],
          status,
        }),
      );
    });
    try {
      const texts = tree.root
        .findAllByType(Text)
        .map((node) => node.props.children);
      expect(texts).toContain('Tarzını tamamlayan parçalar');
      expect(texts).toContain(message);
    } finally {
      await renderer.act(() => tree.unmount());
    }
  },
);

// Faz 4 S3b: a ready result with zero complements hides the whole section (no empty heading).
test('hides the section when the ready result has no complements', async () => {
  let tree!: ReturnType<typeof renderer.create>;
  await renderer.act(() => {
    tree = renderer.create(
      createElement(DiscoverRecommendations, { currentProductId: 'anchor', recommendations: [], status: 'ready' }),
    );
  });
  try {
    expect(tree.root.findAllByType(Text)).toHaveLength(0);
  } finally {
    await renderer.act(() => tree.unmount());
  }
});
