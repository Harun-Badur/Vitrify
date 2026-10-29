import { insightWardrobeSignature, toInsightWardrobeItems } from '../lib/insightWardrobe';
import type { WardrobeItem } from '../types/wardrobe';

const stored = (patch: Partial<WardrobeItem>): WardrobeItem => ({
  id: 'w1', title: 'x', imageUrl: 'https://example.invalid/w1.jpg', category: 'lower_body', brand: '', createdAt: '2026-01-01', ...patch,
});

describe('toInsightWardrobeItems', () => {
  it('maps the single color slug to colorSlugs and keeps the subtype', () => {
    expect(toInsightWardrobeItems([stored({ color: 'navy', subcategory: 'jean' })])).toEqual([
      { id: 'w1', category: 'lower_body', subcategory: 'jean', colorSlugs: ['navy'], imageUrl: 'https://example.invalid/w1.jpg' },
    ]);
  });

  it('leaves color and subtype empty when the item has none (no guessing)', () => {
    const [mapped] = toInsightWardrobeItems([stored({})]);
    expect(mapped.colorSlugs).toBeUndefined();
    expect(mapped.subcategory).toBeNull();
  });

  it('an empty wardrobe maps to an empty list', () => {
    expect(toInsightWardrobeItems([])).toEqual([]);
  });

  it('signature changes with color or subtype edits', () => {
    const a = insightWardrobeSignature(toInsightWardrobeItems([stored({ color: 'navy' })]));
    const b = insightWardrobeSignature(toInsightWardrobeItems([stored({ color: 'siyah' })]));
    expect(a).not.toBe(b);
  });
});
