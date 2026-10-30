import { useMemo, type ReactElement } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

/**
 * RNGH (Android) skips handlerless, background-less ViewGroups ("transparent parts
 * pass touches through") and falls through to the card's tap/pan handlers. Cihaz
 * logu: rail/header ikonlarına dokunuş kartın tek dokunuş jestini de başlatıyordu.
 * Doğrudan çocuğu olduğu view RNGH'de dokunuş hedefi sayılır; Manual jest hiç
 * aktive olmadığı için içerideki Pressable'ların dokunuşu iptal edilmez.
 */
export default function TouchClaim({ children }: { children: ReactElement }) {
  const inert = useMemo(() => Gesture.Manual(), []);
  return <GestureDetector gesture={inert}>{children}</GestureDetector>;
}
