import { useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore, type AppState } from '../store/useAppStore';

/**
 * Store selection that stops following the store while the screen is blurred.
 * Tabs stay mounted after their first visit (Expo Router ignores freezeOnBlur), so
 * without this every Discover swipe re-renders hidden tabs. The last focused value
 * is kept while blurred; refocusing re-reads the store, so the screen shows current data.
 * The selector's result is compared shallowly.
 */
export function useFocusGatedSelection<T extends object>(
  focused: boolean,
  selector: (state: AppState) => T,
): T {
  const last = useRef<{ value: T } | null>(null);
  const value = useAppStore(useShallow((state: AppState) =>
    !focused && last.current ? last.current.value : selector(state)));
  last.current = { value };
  return value;
}
