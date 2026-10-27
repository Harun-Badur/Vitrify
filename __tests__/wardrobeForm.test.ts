import {
  canSaveWardrobeForm,
  editTitle,
  formFromItem,
  initialFormState,
  resolveTitle,
  selectCategory,
  selectColor,
  selectSubcategory,
} from '../lib/wardrobeForm';
import type { WardrobeItem } from '../types/wardrobe';

const item = (extra: Partial<WardrobeItem> = {}): WardrobeItem => ({
  id: 'a', title: 'Eski ad', brand: '', imageUrl: 'x.jpg', category: 'upper_body', createdAt: '', ...extra,
});

describe('wardrobe form state', () => {
  it('starts empty on upper_body without auto-selecting a multi-option category', () => {
    expect(initialFormState()).toMatchObject({ category: 'upper_body', subcategory: '', color: '', title: '', titleTouched: false });
  });

  it('selects the only subtype of single-option categories and keeps the color', () => {
    let state = selectColor(initialFormState(), 'navy');
    state = selectCategory(state, 'dresses');
    expect(state).toMatchObject({ category: 'dresses', subcategory: 'elbise', color: 'navy' });
    state = selectCategory(state, 'bags');
    expect(state).toMatchObject({ category: 'bags', subcategory: 'canta', color: 'navy' });
  });

  it('resets a subtype that is invalid for the new category but keeps a valid one', () => {
    let state = selectSubcategory(initialFormState(), 'gomlek');
    state = selectCategory(state, 'lower_body');
    expect(state.subcategory).toBe('');
    state = selectSubcategory(state, 'jean');
    expect(selectCategory(state, 'lower_body').subcategory).toBe('jean');
    expect(selectCategory(selectSubcategory(initialFormState(), 'tisort'), 'upper_body').subcategory).toBe('tisort');
  });

  it('ignores a subtype or color that is not in the vocabulary', () => {
    expect(selectSubcategory(initialFormState(), 'sneaker').subcategory).toBe('');
    expect(selectColor(initialFormState(), 'nope').color).toBe('');
  });

  it('requires a photo, a valid subtype and a palette color', () => {
    const ready = selectColor(selectSubcategory(initialFormState(), 'gomlek'), 'navy');
    expect(canSaveWardrobeForm('file:///a.jpg', ready)).toBe(true);
    expect(canSaveWardrobeForm('', ready)).toBe(false);
    expect(canSaveWardrobeForm('file:///a.jpg', { ...ready, color: '' })).toBe(false);
    expect(canSaveWardrobeForm('file:///a.jpg', { ...ready, subcategory: '' })).toBe(false);
    expect(canSaveWardrobeForm('file:///a.jpg', { ...ready, color: 'camel' })).toBe(false);
    expect(canSaveWardrobeForm('file:///a.jpg', selectColor(selectCategory(initialFormState(), 'dresses'), 'cok_renkli'))).toBe(true);
  });
});

describe('auto title', () => {
  it('follows subtype and color while the user has not typed', () => {
    let state = selectSubcategory(initialFormState(), 'gomlek');
    expect(state.title).toBe('');
    state = selectColor(state, 'navy');
    expect(state.title).toBe('Lacivert gömlek');
    state = selectColor(state, 'siyah');
    expect(state.title).toBe('Siyah gömlek');
    state = selectCategory(state, 'dresses');
    expect(state.title).toBe('Siyah elbise');
  });

  it('never overwrites a name the user typed, even after later choices', () => {
    let state = editTitle(initialFormState(), 'Benim gömleğim');
    state = selectColor(selectSubcategory(state, 'gomlek'), 'navy');
    expect(state.title).toBe('Benim gömleğim');
    state = selectColor(state, 'siyah');
    expect(state).toMatchObject({ title: 'Benim gömleğim', titleTouched: true });
  });

  it('falls back to the auto title on save when the name is blank', () => {
    const state = editTitle(selectColor(selectSubcategory(initialFormState(), 'gomlek'), 'navy'), '   ');
    expect(resolveTitle(state)).toBe('Lacivert gömlek');
    expect(resolveTitle(editTitle(state, ' Özel ad '))).toBe('Özel ad');
  });
});

describe('form from an existing item', () => {
  it('keeps stored subtype and color and locks the existing title', () => {
    const state = formFromItem(item({ subcategory: 'gomlek', color: 'navy' }));
    expect(state).toMatchObject({ category: 'upper_body', subcategory: 'gomlek', color: 'navy', title: 'Eski ad', titleTouched: true });
    expect(canSaveWardrobeForm('x.jpg', state)).toBe(true);
  });

  it('makes an old item without the fields choose them, auto-selecting single-option categories', () => {
    const old = formFromItem(item());
    expect(old).toMatchObject({ subcategory: '', color: '' });
    expect(canSaveWardrobeForm('x.jpg', old)).toBe(false);
    expect(formFromItem(item({ category: 'dresses' })).subcategory).toBe('elbise');
  });

  it('drops stored values that are no longer valid for the category', () => {
    expect(formFromItem(item({ subcategory: 'sneaker', color: 'camel' }))).toMatchObject({ subcategory: '', color: '' });
  });
});
