import {
  wardrobeCutoutPresentation,
  resumableWardrobeCutout,
} from '../lib/wardrobeCutoutState';
import type { WardrobeItem } from '../types/wardrobe';
const item: WardrobeItem = {
  id: 'owned',
  title: '',
  brand: '',
  category: 'lower_body',
  imageUrl: 'original.jpg',
  createdAt: '',
};
test('only live jobs show processing; a restarted ambiguous inference is visible and cannot replay', () => {
  const blocked = { ...item, cutoutStatus: 'blocked' as const };
  expect(wardrobeCutoutPresentation(blocked, 'processing').text).toBe(
    'Arka plan düzenleniyor',
  );
  expect(wardrobeCutoutPresentation(blocked).text).toBe('Fotoğrafın korundu');
  expect(wardrobeCutoutPresentation(blocked).retry).toBe(false);
  expect(resumableWardrobeCutout(blocked)).toBe(false);
});
test('pending and completed-artifact recovery differ from missing provider configuration and unknown legacy records', () => {
  expect(
    wardrobeCutoutPresentation(
      { ...item, cutoutStatus: 'pending' },
      undefined,
      false,
    ).text,
  ).toContain('kullanılamıyor');
  expect(
    wardrobeCutoutPresentation(
      { ...item, cutoutStatus: 'pending' },
      undefined,
      true,
    ).retry,
  ).toBe(false);
  expect(
    wardrobeCutoutPresentation({
      ...item,
      cutoutStatus: 'blocked',
      cutoutLocalUri: 'processed.png',
    }).retry,
  ).toBe(false);
  expect(wardrobeCutoutPresentation(item, undefined, true).retry).toBe(false);
  expect(
    wardrobeCutoutPresentation({ ...item, cutoutStatus: 'ready', cutoutUrl: 'processed.png' }).text,
  ).toBe('Arka plan düzenlendi');
});

test('pending cutout shows cloud waiting until the save is confirmed', () => {
  expect(wardrobeCutoutPresentation({ ...item, cutoutStatus: 'pending' }, undefined, true, false).text).toBe('Bulut kaydı bekleniyor');
});
