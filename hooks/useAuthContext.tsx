import { createContext, useContext, type ReactNode } from 'react';
import { useAuth } from './useAuth';
import type { SocialAuthResult, SocialProvider } from '../services/socialAuthService';
import type {
  AuthUser,
  SignInParams,
  SignUpParams,
  SignUpResult,
} from '../types/auth';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  signIn: (params: SignInParams) => Promise<void>;
  signUp: (params: SignUpParams) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  signInSocial: (provider: SocialProvider) => Promise<SocialAuthResult>;
}

interface AuthProviderProps {
  children: ReactNode;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * useAuth kendi Supabase onAuthStateChange aboneliğini açar. Router'da birden
 * fazla ekran aynı anda mount olduğu için hook doğrudan çağrılırsa her ekran
 * ayrı bir abonelik ve ayrı bir oturum kopyası tutar. Provider tek kaynağı
 * garanti eder.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const auth = useAuth();

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export const useAuthContext = (): AuthContextValue => {
  const value = useContext(AuthContext);

  if (value === null) {
    throw new Error('useAuthContext yalnızca AuthProvider içinde kullanılır.');
  }

  return value;
};
