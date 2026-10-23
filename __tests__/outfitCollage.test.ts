import {
  createCollageLayout,
  wardrobeCollagePart,
  mergeCollageParts,
  type CollagePart,
} from '../lib/outfitCollage';
import type { WardrobeItem } from '../types/wardrobe';

const item = (
  id: string,
  category: WardrobeItem['category'],
): WardrobeItem => ({
  id,
  category,
  title: id,
  brand: '',
  createdAt: '',
  imageUrl: `original:${id}`,
  cutoutUrl: `cutout:${id}`,
  cutoutStatus: 'ready',
});
const owned = () => [
  wardrobeCollagePart(item('top', 'upper_body')),
  wardrobeCollagePart(item('bottom', 'lower_body')),
  wardrobeCollagePart(item('shoe', 'shoes')),
  wardrobeCollagePart(item('bag', 'bags')),
];

test('ready wardrobe cutouts use category-based flat lay', () => {
  const layout = createCollageLayout(owned());
  expect(layout.mode).toBe('flat-lay');
  const [top, bottom, shoe, bag] = layout.tiles;
  expect(top.y).toBeLessThan(bottom.y);
  expect(bottom.y).toBeLessThan(shoe.y);
  expect(bag.width * bag.height).toBeLessThan(top.width * top.height);
});

test('source, filenames and unverified cutouts never prove clean imagery', () => {
  for (const cutoutStatus of [
    undefined,
    'pending',
    'error',
    'blocked',
  ] as const) {
    expect(
      createCollageLayout([
        wardrobeCollagePart({ ...item('top', 'upper_body'), cutoutStatus }),
      ]).mode,
    ).toBe('moodboard');
  }
  expect(
    createCollageLayout([
      {
        key: 'old',
        source: 'wardrobe',
        sourceId: 'old',
        imageUrl: 'transparent.png',
      },
    ]).mode,
  ).toBe('moodboard');
});

test('favorites and mixed sources always use moodboard', () => {
  const catalog: CollagePart = {
    key: 'catalog:p',
    source: 'catalog',
    sourceId: 'p',
    imageUrl: 'model.jpg',
  };
  expect(createCollageLayout([catalog, { ...catalog, key: 'p2' }]).mode).toBe(
    'moodboard',
  );
  expect(createCollageLayout([...owned(), catalog]).mode).toBe('moodboard');
});

test.each([0, 1, 2, 3, 4, 5, 6, 7, 8])(
  '%i parts fit without overlapping, including repeated categories and missing images',
  (count) => {
    const parts = Array.from({ length: count }, (_, i) =>
      wardrobeCollagePart(item(String(i), 'upper_body')),
    );
    for (const input of [
      parts,
      parts.map((part, i) => ({
        ...part,
        imageUrl: i === 0 ? undefined : part.imageUrl,
      })),
    ]) {
      const { tiles } = createCollageLayout(input);
      expect(tiles).toHaveLength(count);
      for (const tile of tiles) {
        expect(tile.x).toBeGreaterThanOrEqual(0);
        expect(tile.y).toBeGreaterThanOrEqual(0);
        expect(tile.width).toBeGreaterThan(0);
        expect(tile.height).toBeGreaterThan(0);
        expect(tile.x + tile.width).toBeLessThanOrEqual(100.0001);
        expect(tile.y + tile.height).toBeLessThanOrEqual(100.0001);
        for (const other of tiles.filter((other) => other !== tile)) {
          expect(
            tile.x + tile.width <= other.x + 0.001 ||
              other.x + other.width <= tile.x + 0.001 ||
              tile.y + tile.height <= other.y + 0.001 ||
              other.y + other.height <= tile.y + 0.001,
          ).toBe(true);
        }
      }
    }
  },
);

test('remote originals cannot inherit cutout proof; known local cutouts retain their matching metadata', () => {
  const local = owned();
  const remote = local.map((part) => ({
    key: `remote:${part.key}`,
    source: part.source,
    sourceId: part.sourceId,
    imageUrl: 'original.jpg',
  }));
  expect(createCollageLayout(mergeCollageParts(remote, [])).mode).toBe(
    'moodboard',
  );
  const merged = mergeCollageParts(remote, local);
  expect(merged[0].key).toBe(remote[0].key);
  expect(merged[0].imageUrl).toBe(local[0].imageUrl);
  expect(createCollageLayout(merged).mode).toBe('flat-lay');
  // An older fetch may still carry metadata from a previous local snapshot.
  expect(createCollageLayout(mergeCollageParts(local, [])).mode).toBe(
    'moodboard',
  );
  expect(
    createCollageLayout(
      mergeCollageParts(
        remote,
        local.map((part) => ({ ...part, imageUrl: undefined })),
      ),
    ).mode,
  ).toBe('moodboard');
});

test('dress and accessory-only outfits keep every tile bounded', () => {
  for (const category of ['dresses', 'accessories', 'bags', 'hats'] as const) {
    const parts = Array.from({ length: 8 }, (_, i) =>
      wardrobeCollagePart(item(String(i), category)),
    );
    const layout = createCollageLayout(parts);
    expect(layout.tiles).toHaveLength(8);
    for (const tile of layout.tiles) {
      expect(Number.isFinite(tile.y)).toBe(true);
      expect(tile.y + tile.height).toBeLessThanOrEqual(100.0001);
    }
  }
  const unknown = { ...owned()[0], category: undefined };
  expect(createCollageLayout([unknown]).mode).toBe('moodboard');
});
