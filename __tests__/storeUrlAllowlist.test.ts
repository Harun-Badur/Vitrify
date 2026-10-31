const mockOpenURL = jest.fn(async () => undefined);
const mockCanOpenURL = jest.fn(async () => true);
const mockAlert = jest.fn();
const mockLoggerError = jest.fn();

jest.mock('react-native', () => ({
  Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
  Linking: {
    canOpenURL: (...args: unknown[]) => mockCanOpenURL(...(args as [])),
    openURL: (...args: unknown[]) => mockOpenURL(...(args as [])),
  },
}));
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../lib/logger', () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));
jest.mock('../lib/recsFeedState', () => ({ getLastRecommendationId: () => null }));
jest.mock('../lib/sessionIntent', () => ({ recordSessionProductAction: jest.fn() }));

import { isAllowedStoreUrl } from '../lib/storeUrlAllowlist';
import { openProductPage } from '../services/deeplinkService';
import type { Product } from '../types/product';

describe('isAllowedStoreUrl', () => {
  it.each([
    'https://www.trendyol.com/p/123',
    'https://www.hepsiburada.com/urun/abc',
    'https://www.amazon.com.tr/dp/B000',
    'https://www.boyner.com.tr/x',
    'https://eu.mavi.com/x',
    'https://www.lcw.com/x',
    'https://www.defacto.com.tr/x',
    'https://www.flo.com.tr/x',
    'https://trendyol.com/p/1?adjust_t=tag',
  ])('allows %s', url => {
    expect(isAllowedStoreUrl(url)).toBe(true);
  });

  it.each([
    'http://www.trendyol.com/p/1',
    'intent://scan/#Intent;scheme=zxing;end',
    'tel:+900000000000',
    'javascript:alert(1)',
    'kabin://auth',
    'https://evil-trendyol.com/p/1',
    'https://trendyol.com.evil.com/p/1',
    'https://www.trendyol.com@evil.com/p/1',
    'https://user:pw@www.trendyol.com/p/1',
    'https://example.com',
    'not a url',
    '',
  ])('rejects %s', url => {
    expect(isAllowedStoreUrl(url)).toBe(false);
  });
});

describe('openProductPage URL validation', () => {
  const base = { id: 'p1', imageUrl: 'x', title: 't' } as unknown as Product;

  beforeEach(() => jest.clearAllMocks());

  it('opens an allowed store url unchanged', async () => {
    await openProductPage({
      ...base,
      provider: 'trendyol',
      productUrl: 'https://www.trendyol.com/p/1',
    } as Product);
    expect(mockOpenURL).toHaveBeenCalledWith('https://www.trendyol.com/p/1');
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('opens the fallback url built from provider + externalId', async () => {
    await openProductPage({
      ...base,
      provider: 'hepsiburada',
      externalId: 'SKU1',
    } as Product);
    expect(mockOpenURL).toHaveBeenCalledWith('https://www.hepsiburada.com/urun/SKU1');
  });

  it('silently rejects a disallowed url: no open, no log, generic alert', async () => {
    await openProductPage({
      ...base,
      provider: 'trendyol',
      productUrl: 'intent://evil#Intent;end',
    } as Product);
    expect(mockCanOpenURL).not.toHaveBeenCalled();
    expect(mockOpenURL).not.toHaveBeenCalled();
    expect(mockLoggerError).not.toHaveBeenCalled();
    expect(mockAlert).toHaveBeenCalledWith('Bağlantı açılamadı', expect.any(String));
  });

  it('rejects a stored affiliateUrl on a foreign host', async () => {
    await openProductPage({
      ...base,
      provider: 'trendyol',
      affiliateUrl: 'https://evil.example.com/x',
    } as Product);
    expect(mockOpenURL).not.toHaveBeenCalled();
    expect(mockAlert).toHaveBeenCalledWith('Bağlantı açılamadı', expect.any(String));
  });
});
