import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { useAuthContext } from './useAuthContext';
import { premiumClient } from '../services/revenueCatMobile';
import type { PremiumClientState } from '../services/premiumClient';
const PremiumContext = createContext<PremiumClientState | null>(null);
export function PremiumProvider({ children }: { children: ReactNode }) {
  const { user } = useAuthContext(),
    owner = user?.id ?? null;
  const state = useSyncExternalStore(
    premiumClient.subscribe,
    premiumClient.getSnapshot,
    premiumClient.getSnapshot,
  );
  useLayoutEffect(() => {
    void premiumClient.setOwner(owner, false);
  }, [owner]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      const current = premiumClient.getSnapshot();
      if (
        next === 'active' &&
        (current.membership ||
          current.packages.length > 0 ||
          current.awaitingVerification)
      )
        void premiumClient.refresh();
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!state.membership) return;
    const deadline = Math.min(
      state.membership.checkedAtMs + 60000,
      state.membership.expiresAtMs ?? Infinity,
    );
    const timer = setTimeout(
      () => premiumClient.invalidate(),
      Math.max(0, deadline - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [state.membership]);
  const visible =
    state.owner === owner
      ? state
      : {
          ...state,
          owner,
          membership: null,
          packages: [],
          busy: false,
          awaitingVerification: false,
          message: null,
        };
  return (
    <PremiumContext.Provider value={visible}>
      {children}
    </PremiumContext.Provider>
  );
}
export function usePremium() {
  const state = useContext(PremiumContext);
  if (!state) throw new Error('PremiumProvider required');
  return { state, client: premiumClient };
}
