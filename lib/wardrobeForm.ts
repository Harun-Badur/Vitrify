import type { GarmentCategory } from '../types/product';
import type { WardrobeItem } from '../types/wardrobe';
import {
  COLORS,
  buildAutoTitle,
  defaultSubtype,
  colorLabel,
  isValidSubtype,
  subtypesForCategory,
} from './styleVocabulary';

export interface WardrobeFormState {
  category: GarmentCategory;
  /** Vocabulary slug; '' until chosen. */
  subcategory: string;
  /** Palette slug; '' until chosen. */
  color: string;
  title: string;
  /** Once the user typed a name, it is never replaced automatically. */
  titleTouched: boolean;
}

const validColor = (slug: string): boolean => COLORS.some(color => color.slug === slug);

const withAutoTitle = (state: WardrobeFormState): WardrobeFormState =>
  state.titleTouched
    ? state
    : { ...state, title: buildAutoTitle(state.color, state.subcategory, state.category) ?? '' };

export const initialFormState = (category: GarmentCategory = 'upper_body'): WardrobeFormState => ({
  category,
  subcategory: defaultSubtype(category) ?? '',
  color: '',
  title: '',
  titleTouched: false,
});

/** An invalid subtype is reset; a single-option category selects its only subtype; color is kept. */
export const selectCategory = (state: WardrobeFormState, category: GarmentCategory): WardrobeFormState =>
  withAutoTitle({
    ...state,
    category,
    subcategory: isValidSubtype(category, state.subcategory)
      ? state.subcategory
      : defaultSubtype(category) ?? '',
  });

export const selectSubcategory = (state: WardrobeFormState, subcategory: string): WardrobeFormState =>
  isValidSubtype(state.category, subcategory) ? withAutoTitle({ ...state, subcategory }) : state;

export const selectColor = (state: WardrobeFormState, color: string): WardrobeFormState =>
  validColor(color) ? withAutoTitle({ ...state, color }) : state;

export const editTitle = (state: WardrobeFormState, title: string): WardrobeFormState =>
  ({ ...state, title, titleTouched: true });

export const canSaveWardrobeForm = (
  uri: string,
  state: Pick<WardrobeFormState, 'category' | 'subcategory' | 'color'>,
): boolean =>
  uri.length > 0 && isValidSubtype(state.category, state.subcategory) && validColor(state.color);

/** What gets saved: the typed name, or the automatic one when the field is blank. */
export const resolveTitle = (state: WardrobeFormState): string =>
  state.title.trim() || buildAutoTitle(state.color, state.subcategory, state.category) || '';

/** Existing items keep their name; missing or stale subtype/color must be chosen again. */
export const formFromItem = (item: WardrobeItem): WardrobeFormState => ({
  category: item.category,
  subcategory: item.subcategory && isValidSubtype(item.category, item.subcategory)
    ? item.subcategory
    : defaultSubtype(item.category) ?? '',
  color: item.color && validColor(item.color) ? item.color : '',
  title: item.title,
  titleTouched: true,
});

type StyleFields = Pick<WardrobeItem, 'category' | 'subcategory' | 'color'>;

/** True when a stored subtype or color is absent or no longer valid; only a hint, never blocking. */
export const wardrobeMissingInfo = (item: StyleFields): boolean =>
  !isValidSubtype(item.category, item.subcategory) || !(item.color && validColor(item.color));

/** "Gömlek · Beyaz" for whatever is known; undefined when nothing is. */
export const wardrobeDetailText = (item: StyleFields): string | undefined => {
  const subtype = subtypesForCategory(item.category).find(option => option.slug === item.subcategory)?.label;
  const color = item.color && validColor(item.color) ? colorLabel(item.color) : undefined;
  return [subtype, color].filter(Boolean).join(' · ') || undefined;
};
