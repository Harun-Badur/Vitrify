import type { Product, OutfitRole } from '../types/product';
import type { WardrobeItem } from '../types/wardrobe';
import { generateWardrobeCatalogOutfits } from '../src/intelligence/outfits/generateWardrobeCatalogOutfits';

export const OUTFIT_SLOTS = [
  { key: 'upper_body', label: 'Üst' },
  { key: 'lower_body', label: 'Alt' },
  { key: 'dresses', label: 'Elbise' },
  { key: 'shoes', label: 'Ayakkabı' },
  { key: 'accessories', label: 'Aksesuar' },
] as const;
export type OutfitSlot = (typeof OUTFIT_SLOTS)[number]['key'];
export type OutfitChoice =
  | { key: string; source: 'wardrobe'; item: WardrobeItem }
  | { key: string; source: 'catalog'; item: Product };
export type OutfitSelection = Partial<Record<OutfitSlot, OutfitChoice>>;
export const choiceSlot = (choice: OutfitChoice): OutfitSlot | null => {
  const category = choice.item.category;
  if (
    category === 'upper_body' ||
    category === 'lower_body' ||
    category === 'shoes' || category === 'dresses'
  )
    return category;
  return ['accessories', 'bags', 'hats'].includes(category)
    ? 'accessories'
    : null;
};
export const canCreateOutfit = (selection: OutfitSelection): boolean =>
  selection.dresses ? !selection.upper_body && !selection.lower_body : Boolean(selection.upper_body && selection.lower_body);
/** Selecting a core form replaces only the mutually exclusive core pieces. */
export const selectOutfitChoice = (selection: OutfitSelection, choice: OutfitChoice): OutfitSelection => {
  const slot = choiceSlot(choice);
  if (!slot) return selection;
  const next = { ...selection, [slot]: choice };
  if (slot === 'dresses') { delete next.upper_body; delete next.lower_body; }
  if (slot === 'upper_body' || slot === 'lower_body') delete next.dresses;
  return next;
};

export function selectedOutfitCandidate(selection: OutfitSelection) {
  if (!canCreateOutfit(selection))
    throw new Error('Üst ve Alt parçalarını veya bir Elbise seçmelisin.');
  const chosen = OUTFIT_SLOTS.flatMap(({ key }) =>
    selection[key] ? [selection[key]!] : [],
  );
  for (const { key } of OUTFIT_SLOTS) {
    if (selection[key] && choiceSlot(selection[key]!) !== key)
      throw new Error('Seçilen parçanın kategorisi slotla eşleşmiyor.');
  }
  // Explicit slot choices supply the role that local photo-only clothes lack.
  const role = (choice: OutfitChoice): OutfitRole => {
    if (choice.item.category === 'upper_body') return 'top';
    if (choice.item.category === 'lower_body') return 'bottom';
    if (choice.item.category === 'dresses') return 'one_piece';
    if (choice.item.category === 'shoes') return 'shoes';
    if (choice.item.category === 'bags') return 'bag';
    if (choice.item.category === 'hats') return 'hat';
    return 'accessory';
  };
  const results = generateWardrobeCatalogOutfits({
    wardrobeItems: chosen.flatMap((choice) =>
      choice.source === 'wardrobe'
        ? [
            {
              ...choice.item,
              subcategory:
                choice.item.category === 'upper_body' ? 'top' : undefined,
            },
          ]
        : [],
    ),
    catalogProducts: chosen.flatMap((choice) =>
      choice.source === 'catalog'
        ? [{ ...choice.item, outfitRole: role(choice) }]
        : [],
    ),
    maximalOnly: true,
  });
  const exact = results.find(
    ({ candidate, rankingValue }) =>
      rankingValue.coreComplete && candidate.items.length === chosen.length,
  );
  if (!exact)
    throw new Error('Seçilen parçalarla geçerli bir kombin oluşturulamadı.');
  return exact.candidate;
}
