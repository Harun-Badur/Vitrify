import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProductImages } from '../types/product';
import { MOCK_PRODUCTS } from '../data/mockProducts';

test('empty or duplicated gallery metadata preserves a usable cover and unique pages', () => {
  const product = MOCK_PRODUCTS[0];
  expect(getProductImages({ ...product, images: [' ', ''] })).toEqual([product.imageUrl]);
  expect(getProductImages({ ...product, images: [' https://example.com/a.jpg ', 'https://example.com/a.jpg'] })).toEqual(['https://example.com/a.jpg']);
});

test('V1 no longer advertises price alerts or exposes an unused price alert mutation', () => {
  const source = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');
  expect(source('components/OnboardingScreen.tsx')).not.toContain('Fiyat Düşünce Haber Ver');
  expect(source('store/favoritesSlice.ts')).not.toContain('updateLikeAlert');
  expect(source('services/likeService.ts')).not.toContain('updateLikedProductAlert');
  // Generic push registration remains available for other notifications.
  expect(source('services/notificationService.ts')).toContain('registerForPushNotifications');
});
