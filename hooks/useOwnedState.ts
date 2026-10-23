import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { captureOwnerPublication, registerOwnerResource, trackOwnerWork } from '../lib/accountDeviceWork';

/** Guards both callback arrival and React's later application of a queued functional update. */
export function useOwnedState<T>(owner: string | null, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const cell = useRef({ owner, version: 0, cleared: true });
  const initialRef = useRef(initial);
  const commits = useRef<Array<() => void>>([]);
  if (cell.current.owner !== owner) cell.current = { owner, version: cell.current.version + 1, cleared: true };
  const version = cell.current.version, current = captureOwnerPublication(owner);
  const [snapshot, setSnapshot] = useState({ owner, version, value: initial });
  useLayoutEffect(() => { commits.current.splice(0).forEach(resolve => resolve()); });
  useEffect(() => {
    if (!owner) return;
    const resource = { stop: () => {
      if (cell.current.owner !== owner || (cell.current.cleared && commits.current.length === 0)) return;
      cell.current.version++; cell.current.cleared = true;
      const commit = new Promise<void>(resolve => commits.current.push(resolve));
      trackOwnerWork(owner, commit);
      setSnapshot({ owner, version: cell.current.version, value: initialRef.current });
    }, empty: () => cell.current.owner !== owner || (cell.current.cleared && commits.current.length === 0) };
    const unregister = registerOwnerResource(owner, resource);
    return () => { cell.current.version++; cell.current.cleared = true; commits.current.splice(0).forEach(resolve => resolve()); unregister(); };
  }, [owner]);
  const valid = () => current() && cell.current.owner === owner && cell.current.version === version;
  const setter: Dispatch<SetStateAction<T>> = action => {
    if (!valid()) return;
    setSnapshot(previous => {
      if (!valid()) return previous;
      const value = typeof action === 'function' ? (action as (value: T) => T)(previous.owner === owner && previous.version === version ? previous.value : initialRef.current) : action;
      cell.current.cleared = false;
      return { owner, version, value };
    });
  };
  return [valid() && snapshot.owner === owner && snapshot.version === version ? snapshot.value : initialRef.current, setter];
}
