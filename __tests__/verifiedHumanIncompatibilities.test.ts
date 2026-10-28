import { complementaryProductsForDisplay } from '../src/intelligence/recommendations/complementaryProductsForDisplay';
import { getDiscoverRecommendations } from '../src/intelligence/recommendations/getDiscoverRecommendations';
import { HUMAN_DECISIONS_V1, isHumanIncompatible as isVerifiedHumanIncompatibility } from '../src/intelligence/pairing/humanDecisions';

const VERIFIED_HUMAN_INCOMPATIBILITIES = HUMAN_DECISIONS_V1.rows;
import { isValidOutfitItems, isCatalogRoleCompatible } from '../src/intelligence/outfits/outfitCandidate';
import type { OutfitRole, Product } from '../types/product';

const BELT = 'trendyol-879907284';
const OTHER_BELT = 'trendyol-48108999';
const VERIFIED_ANCHOR = 'hepsiburada-HBC0000A4I58H';

const catalog = (id: string, category: Product['category'], role: OutfitRole): Product => ({
  id,
  imageUrl: 'https://example.com/item.jpg',
  title: id,
  price: 100,
  brand: 'Test',
  category,
  outfitRole: role,
  garmentDescription: id,
  gender: 'women',
});

const complementsOf = (anchor: Product, pool: Product[]): Product[] =>
  complementaryProductsForDisplay(getDiscoverRecommendations({
    wardrobeItems: [],
    catalogProducts: [anchor, ...pool],
    requiredCatalogProductId: anchor.id,
    firstOnly: true,
  }), anchor.id);

describe('verified human incompatibilities', () => {
  it('keeps the thirteen reviewer selections and no other product', () => {
    expect(VERIFIED_HUMAN_INCOMPATIBILITIES).toHaveLength(13);
    expect(new Set(VERIFIED_HUMAN_INCOMPATIBILITIES.map((row) => row.productId))).toEqual(new Set([BELT]));
    expect(isVerifiedHumanIncompatibility(VERIFIED_ANCHOR, BELT)).toBe(true);
    expect(isVerifiedHumanIncompatibility(VERIFIED_ANCHOR, OTHER_BELT)).toBe(false);
    expect(isVerifiedHumanIncompatibility('unreviewed-anchor', BELT)).toBe(false);
  });

  it('drops the reviewed belt from a verified anchor and keeps another belt', () => {
    const anchor = catalog(VERIFIED_ANCHOR, 'upper_body', 'top');
    const pool = [
      catalog('bottom', 'lower_body', 'bottom'),
      catalog('shoes', 'shoes', 'shoes'),
      catalog(BELT, 'accessories', 'accessory'),
      catalog(OTHER_BELT, 'accessories', 'accessory'),
    ];
    const shown = complementsOf(anchor, pool);
    const recommendations = getDiscoverRecommendations({
      wardrobeItems: [],
      catalogProducts: [anchor, ...pool],
      requiredCatalogProductId: anchor.id,
      firstOnly: true,
    });
    const items = recommendations[0]?.candidate.items ?? [];
    expect(shown.map((product) => product.id)).not.toContain(BELT);
    expect(shown.map((product) => product.id)).toContain(OTHER_BELT);
    expect(items.every((item) => item.sourceType !== 'catalog' || isCatalogRoleCompatible(item.product, item.role))).toBe(true);
    expect(items.length === 0 || isValidOutfitItems(items)).toBe(true);
  });

  it('still allows the same belt with an anchor the reviewer did not mark', () => {
    const anchor = catalog('unreviewed-anchor', 'upper_body', 'top');
    const shown = complementsOf(anchor, [
      catalog('bottom', 'lower_body', 'bottom'),
      catalog('shoes', 'shoes', 'shoes'),
      catalog(BELT, 'accessories', 'accessory'),
    ]);
    expect(shown.map((product) => product.id)).toContain(BELT);
  });
});
