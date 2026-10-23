import { signInWithSocial } from '../services/socialAuthService';
import { getSupabaseClient } from '../lib/supabase';
import * as Browser from 'expo-web-browser';
import * as Apple from 'expo-apple-authentication';
import Constants, { AppOwnership } from 'expo-constants';
import { Platform } from 'react-native';
jest.mock('../lib/supabase', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
  WebBrowserResultType: { CANCEL: 'cancel' },
}));
jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: jest.fn(async () => true),
  signInAsync: jest.fn(),
  AppleAuthenticationScope: { EMAIL: 0 },
}));
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn(async () => new Uint8Array(32).fill(7)),
  digestStringAsync: jest.fn(async () => 'hashed-nonce'),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  AppOwnership: { Expo: 'expo' },
  default: { appOwnership: null },
}));

const auth = {
  getSession: jest.fn(async () => ({ data: { session: null }, error: null })),
  signInWithOAuth: jest.fn(async () => ({
    data: { url: 'https://example.com/oauth' },
    error: null,
  })),
  setSession: jest.fn(async () => ({
    data: { session: { user: { id: 'test-owner' } } },
    error: null,
  })),
  signInWithIdToken: jest.fn(async () => ({
    data: { session: { user: { id: 'test-owner' } } },
    error: null,
  })),
};
beforeEach(() => {
  jest.clearAllMocks();
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  jest.mocked(getSupabaseClient).mockReturnValue({ auth } as never);
  Constants.appOwnership = null;
  jest.replaceProperty(Platform, 'OS', 'android');
});
afterEach(() => jest.restoreAllMocks());

test('Google callback establishes the existing session only after attempt and target validation', async () => {
  jest.mocked(Browser.openAuthSessionAsync).mockImplementation(async () => {
    const request = auth.signInWithOAuth.mock.calls[0] as unknown as [
      { options: { redirectTo: string } },
    ];
    return {
      type: 'success',
      url: `${request[0].options.redirectTo}#access_token=test-access&refresh_token=test-refresh`,
    };
  });
  await expect(signInWithSocial('google')).resolves.toBe('signed_in');
  expect(auth.setSession).toHaveBeenCalledWith({
    access_token: 'test-access',
    refresh_token: 'test-refresh',
  });
  expect(auth.signInWithIdToken).not.toHaveBeenCalled();
});
test.each([
  'kabin://auth?attempt=wrong#access_token=x&refresh_token=y',
  'other://auth?attempt=wrong',
  'kabin://auth?attempt=wrong#error_description=private',
])('untrusted callback never sets a session', async (url) => {
  jest
    .mocked(Browser.openAuthSessionAsync)
    .mockResolvedValue({ type: 'success', url });
  await expect(signInWithSocial('google')).rejects.toMatchObject({
    code: 'SOCIAL_CALLBACK_INVALID',
  });
  expect(auth.setSession).not.toHaveBeenCalled();
});
test('cancelled browser does not report successful login', async () => {
  jest
    .mocked(Browser.openAuthSessionAsync)
    .mockResolvedValue({ type: Browser.WebBrowserResultType.CANCEL });
  await expect(signInWithSocial('google')).resolves.toBe('cancelled');
  expect(auth.setSession).not.toHaveBeenCalled();
});
test('Expo Go returns an actionable error without launching OAuth', async () => {
  Constants.appOwnership = AppOwnership.Expo;
  await expect(signInWithSocial('google')).rejects.toMatchObject({
    code: 'SOCIAL_DEV_BUILD_REQUIRED',
  });
  expect(auth.signInWithOAuth).not.toHaveBeenCalled();
});
test('an existing account cannot be replaced by an unrelated social attempt', async () => {
  auth.getSession.mockResolvedValue({
    data: { session: { user: { id: 'other-owner' } } },
    error: null,
  } as never);
  await expect(signInWithSocial('google')).rejects.toMatchObject({
    code: 'SOCIAL_SESSION_CHANGED',
  });
  expect(auth.signInWithOAuth).not.toHaveBeenCalled();
});
test('account changes during OAuth are not overwritten by an old callback', async () => {
  jest.mocked(Browser.openAuthSessionAsync).mockImplementation(async () => {
    const request = auth.signInWithOAuth.mock.calls[0] as unknown as [
      { options: { redirectTo: string } },
    ];
    auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'other-owner' } } },
      error: null,
    } as never);
    return {
      type: 'success',
      url: `${request[0].options.redirectTo}#access_token=x&refresh_token=y`,
    };
  });
  await expect(signInWithSocial('google')).rejects.toMatchObject({
    code: 'SOCIAL_SESSION_CHANGED',
  });
  expect(auth.setSession).not.toHaveBeenCalled();
});
test('Apple uses hashed native nonce and raw Supabase nonce on iOS', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  jest
    .mocked(Apple.signInAsync)
    .mockImplementation(
      async (options) =>
        ({
          identityToken: 'test-identity',
          state: options?.state,
        }) as Apple.AppleAuthenticationCredential,
    );
  await expect(signInWithSocial('apple')).resolves.toBe('signed_in');
  expect(Apple.signInAsync).toHaveBeenCalledWith(
    expect.objectContaining({ nonce: 'hashed-nonce' }),
  );
  expect(auth.signInWithIdToken).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: 'apple',
      token: 'test-identity',
      nonce: '07'.repeat(32),
    }),
  );
});
test('Apple is unavailable on Android', async () => {
  await expect(signInWithSocial('apple')).rejects.toMatchObject({
    code: 'SOCIAL_UNAVAILABLE',
  });
  expect(Apple.signInAsync).not.toHaveBeenCalled();
});
