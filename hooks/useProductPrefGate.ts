import { useCallback, useEffect, useState } from 'react';
import type { ProductPref } from '../lib/productPreference';
import { chooseProductPref, endProductPrefSession, skipProductPrefPrompt, startProductPrefSession } from '../services/productPrefSync';

export type ProductPrefGate = 'checking' | 'prompt' | 'done';

/** Runs the login preference sync per signed-in user and says whether the choice screen is due. */
export function useProductPrefGate(userId: string | null) {
  const [gate, setGate] = useState<{ userId: string | null; value: ProductPrefGate }>({ userId: null, value: 'done' });

  useEffect(() => {
    if (userId === null) {
      endProductPrefSession();
      setGate({ userId: null, value: 'done' });
      return;
    }
    let cancelled = false;
    setGate({ userId, value: 'checking' });
    void startProductPrefSession(userId).then((value) => {
      if (!cancelled) setGate({ userId, value });
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const choose = useCallback((pref: ProductPref): void => {
    if (userId === null) return;
    setGate({ userId, value: 'done' });
    void chooseProductPref(userId, pref);
  }, [userId]);

  const skip = useCallback((): void => {
    setGate({ userId, value: 'done' });
    void skipProductPrefPrompt();
  }, [userId]);

  // Until the effect has run for a new user, treat it as still checking.
  return { gate: gate.userId === userId ? gate.value : 'checking' as ProductPrefGate, choose, skip };
}
