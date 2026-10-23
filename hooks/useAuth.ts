import { setDeviceSessionOwner } from '../lib/accountDeviceWork';
import { isAccountWriteFenced } from '../lib/accountWriteFence';
import { useCallback, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabaseClient } from '../lib/supabase';
import { logger } from '../lib/logger';
import { toTurkishAuthMessage } from '../lib/authError';
import { ensureUserProfile } from '../services/likeService';
import type { AuthUser, SignInParams, SignUpParams, SignUpResult } from '../types/auth';
import { signInWithSocial, type SocialAuthResult, type SocialProvider } from '../services/socialAuthService';

interface UseAuthResult {
  user: AuthUser | null;
  loading: boolean;
  signIn: (params: SignInParams) => Promise<void>;
  signUp: (params: SignUpParams) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  signInSocial: (provider: SocialProvider) => Promise<SocialAuthResult>;
}

const mapAuthUser = (user: User | null | undefined): AuthUser | null => {
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    email: user.email ?? null,
  };
};

export const useAuth = (): UseAuthResult => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) {
      setUser(null);
      setLoading(false);
      return;
    }

    let isMounted = true;
    let authRevision = 0;

    const loadSession = async (): Promise<void> => {
      const revision = authRevision;
      try {
        const { data, error } = await client.auth.getSession();
        if (data.session?.user.id) await isAccountWriteFenced(data.session.user.id);
        if (revision !== authRevision) return;
        if (error) {
          throw error;
        }
        if (isMounted) {
          setDeviceSessionOwner(data.session?.user.id ?? null);
          setUser(mapAuthUser(data.session?.user));
        }
      } catch (error) {
        logger.error('Oturum okunamadı', { error });
        if (isMounted && revision === authRevision) {
          setDeviceSessionOwner(null);
          setUser(null);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void loadSession();

    const { data: listener } = client.auth.onAuthStateChange(
      (_event, session) => {
        if (!isMounted) {
          return;
        }
        authRevision++;
        setDeviceSessionOwner(session?.user.id ?? null);
        if (session?.user.id) void isAccountWriteFenced(session.user.id).catch(() => {});
        setUser(mapAuthUser(session?.user));
        setLoading(false);
      },
    );

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async ({ email, password }: SignInParams): Promise<void> => {
    const client = getSupabaseClient();
    if (!client) {
      throw new Error('Supabase yapılandırması eksik.');
    }

    const { data, error } = await client.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      if (__DEV__) {
        logger.error('Supabase giriş hatası', { detail: error.message });
      }
      throw new Error(toTurkishAuthMessage(error), { cause: error });
    }

    const mapped = mapAuthUser(data.user);
    if (mapped) {
      try {
        await ensureUserProfile(mapped);
      } catch (profileError) {
        logger.error('Profil senkronu başarısız', { error: profileError });
      }
    }
  }, []);

  const signUp = useCallback(async ({ email, password }: SignUpParams): Promise<SignUpResult> => {
    const client = getSupabaseClient();
    if (!client) {
      throw new Error('Supabase yapılandırması eksik.');
    }

    const { data, error } = await client.auth.signUp({
      email: email.trim(),
      password,
    });

    if (error) {
      if (__DEV__) {
        logger.error('Supabase kayıt hatası', { detail: error.message });
      }
      throw new Error(toTurkishAuthMessage(error), { cause: error });
    }

    const mapped = mapAuthUser(data.user);
    if (mapped && data.session) {
      try {
        await ensureUserProfile(mapped);
      } catch (profileError) {
        logger.error('Profil senkronu başarısız', { error: profileError });
      }
      return { needsEmailConfirmation: false };
    }

    return { needsEmailConfirmation: true };
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    const client = getSupabaseClient();
    if (!client) {
      setUser(null);
      return;
    }
    const { error } = await client.auth.signOut();
    if (error) {
      throw new Error(toTurkishAuthMessage(error));
    }
  }, []);

  const signInSocial = useCallback(async (provider: SocialProvider): Promise<SocialAuthResult> => {
    const result = await signInWithSocial(provider);
    if (result === 'signed_in') {
      const session = await getSupabaseClient()?.auth.getSession();
      const mapped = mapAuthUser(session?.data.session?.user);
      if (mapped) {
        try { await ensureUserProfile(mapped); }
        catch { logger.warn('Sosyal giriş profil senkronu bekliyor', { code: 'SOCIAL_PROFILE_SYNC_FAILED' }); }
      }
    }
    return result;
  }, []);
  return { user, loading, signIn, signUp, signOut, signInSocial };
};
