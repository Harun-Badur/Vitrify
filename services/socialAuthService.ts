import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import * as Apple from 'expo-apple-authentication';
import { getSupabaseClient } from '../lib/supabase';

export type SocialProvider = 'google' | 'apple';
export type SocialAuthResult = 'signed_in' | 'cancelled';
const messages = {
  SOCIAL_DEV_BUILD_REQUIRED:
    'Sosyal giriş için development build veya yayın sürümü gerekiyor. Expo Go’da e-posta ile devam edebilirsin.',
  SOCIAL_UNAVAILABLE: 'Bu cihazda Apple ile giriş kullanılamıyor.',
  SOCIAL_CONFIG_REQUIRED:
    'Sosyal giriş henüz yapılandırılmamış. Şimdilik e-posta ile devam edebilirsin.',
  SOCIAL_FAILED: 'Giriş tamamlanamadı. Bağlantını kontrol edip tekrar dene.',
  SOCIAL_CALLBACK_INVALID:
    'Giriş yanıtı doğrulanamadı. Güvenliğin için oturum açılmadı.',
  SOCIAL_SESSION_CHANGED:
    'Oturum değişti. Mevcut hesabından çıkış yapmadan başka hesaba geçilemez.',
  SOCIAL_BUSY: 'Bir giriş işlemi zaten devam ediyor.',
} as const;
export class SocialAuthError extends Error {
  constructor(readonly code: keyof typeof messages) {
    super(messages[code]);
  }
}
let active = false;
const nonce = async () => {
  const bytes = await Crypto.getRandomBytesAsync(32);
  if (bytes.length !== 32) throw new SocialAuthError('SOCIAL_FAILED');
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
};
export const isAppleSignInAvailable = async (): Promise<boolean> => {
  if (Platform.OS !== 'ios') return false;
  try {
    return await Apple.isAvailableAsync();
  } catch {
    return false;
  }
};

/** Keeps the existing Supabase implicit session contract; no manual email linking. */
export async function signInWithSocial(
  provider: SocialProvider,
): Promise<SocialAuthResult> {
  if (Constants.appOwnership === 'expo')
    throw new SocialAuthError('SOCIAL_DEV_BUILD_REQUIRED');
  if (active) throw new SocialAuthError('SOCIAL_BUSY');
  const client = getSupabaseClient();
  if (!client) throw new SocialAuthError('SOCIAL_CONFIG_REQUIRED');
  active = true;
  const requireSignedOut = async () => {
    const result = await client.auth.getSession();
    if (result.error) throw new SocialAuthError('SOCIAL_FAILED');
    if (result.data.session)
      throw new SocialAuthError('SOCIAL_SESSION_CHANGED');
  };
  try {
    await requireSignedOut();
    if (provider === 'apple') {
      if (!(await isAppleSignInAvailable()))
        throw new SocialAuthError('SOCIAL_UNAVAILABLE');
      const rawNonce = await nonce();
      const state = await nonce();
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce,
      );
      const credential = await Apple.signInAsync({
        requestedScopes: [Apple.AppleAuthenticationScope.EMAIL],
        nonce: hashedNonce,
        state,
      });
      if (!credential.identityToken || credential.state !== state)
        throw new SocialAuthError('SOCIAL_CALLBACK_INVALID');
      await requireSignedOut();
      const { data, error } = await client.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
        nonce: rawNonce,
      });
      if (error || !data.session) throw new SocialAuthError('SOCIAL_FAILED');
    } else {
      // Correlate the one browser attempt; never accept an arbitrary app deep link.
      const attempt = await nonce();
      const redirectTo = `kabin://auth?attempt=${attempt}`;
      const { data, error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          skipBrowserRedirect: true,
          queryParams: { prompt: 'select_account' },
        },
      });
      if (error || !data.url)
        throw new SocialAuthError('SOCIAL_CONFIG_REQUIRED');
      const response = await WebBrowser.openAuthSessionAsync(
        data.url,
        'kabin://auth',
      );
      if (response.type !== 'success') return 'cancelled';
      const callback = new URL(response.url);
      if (
        callback.protocol !== 'kabin:' ||
        callback.hostname !== 'auth' ||
        !['', '/'].includes(callback.pathname) ||
        callback.searchParams.get('attempt') !== attempt
      )
        throw new SocialAuthError('SOCIAL_CALLBACK_INVALID');
      const params = new URLSearchParams(callback.hash.slice(1));
      if (
        params.has('error') ||
        params.has('error_code') ||
        callback.searchParams.has('error')
      )
        throw new SocialAuthError('SOCIAL_FAILED');
      const access_token = params.get('access_token'),
        refresh_token = params.get('refresh_token');
      if (!access_token || !refresh_token)
        throw new SocialAuthError('SOCIAL_CALLBACK_INVALID');
      await requireSignedOut();
      const result = await client.auth.setSession({
        access_token,
        refresh_token,
      });
      if (result.error || !result.data.session)
        throw new SocialAuthError('SOCIAL_FAILED');
    }
    return 'signed_in';
  } catch (error) {
    if (error instanceof SocialAuthError) throw error;
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ERR_REQUEST_CANCELED'
    )
      return 'cancelled';
    throw new SocialAuthError('SOCIAL_FAILED');
  } finally {
    active = false;
  }
}
