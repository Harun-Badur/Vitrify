import type { Product } from '../types/product';
import type { PassedStackEntry } from './discoverySlice';

/**
 * Temporary "complement detour" cards. A detour card is a normal Discover card that is shown
 * for this session only: it is never part of the canonical feed order and never rated.
 * Pure transitions over {deck, stack, detourIds}; the store adds events and bookkeeping.
 */
export interface DetourState {
  deck: Product[];
  stack: PassedStackEntry[];
  /** Temporary cards currently alive (deck front or stack). Source cards are never listed. */
  detourIds: string[];
}

/** Reaching the limit refuses a new detour; dropping the oldest would lose the source card. */
export const MAX_DETOUR_DEPTH = 20;
const STACK_LIMIT = 20;

const liveDetourIds = (s: DetourState): string[] => s.detourIds.filter(id =>
  s.deck[0]?.id === id || s.stack.some(entry => entry.product.id === id));

/** A→X: A leaves the deck front into the stack, X (the same object) takes its place. */
export const openDetour = (s: DetourState, x: Product): DetourState | null => {
  const source = s.deck[0];
  if (source === undefined || x.id === source.id) return null;
  if (s.stack.some(entry => entry.product.id === x.id)) return null;
  const live = liveDetourIds(s);
  if (live.length >= MAX_DETOUR_DEPTH) return null;
  return {
    deck: [x, ...s.deck.slice(1).filter(item => item.id !== x.id)],
    stack: [...s.stack.filter(entry => entry.product.id !== source.id), { product: source, kind: 'detour' as const }]
      .slice(-STACK_LIMIT),
    detourIds: [...live, x.id],
  };
};

/** Down swipe while the stack top is a detour entry: view only, the temporary card in front is deleted. */
export const popDetour = (s: DetourState): DetourState => {
  const top = s.stack[s.stack.length - 1];
  if (top === undefined || top.kind !== 'detour') return s;
  const front = s.deck[0];
  const frontIsTemp = front !== undefined && s.detourIds.includes(front.id);
  const rest = (frontIsTemp ? s.deck.slice(1) : s.deck).filter(item => item.id !== top.product.id);
  return {
    deck: [top.product, ...rest],
    stack: s.stack.slice(0, -1),
    detourIds: frontIsTemp ? s.detourIds.filter(id => id !== front.id) : s.detourIds,
  };
};

/** Up swipe past a temporary card (or past its source): every temporary card is deleted, sources stay. */
export const clearTemporary = (s: DetourState): DetourState => {
  if (s.detourIds.length === 0) return s;
  const temp = new Set(s.detourIds);
  return {
    deck: s.deck.filter(item => !temp.has(item.id)),
    stack: s.stack.filter(entry => !temp.has(entry.product.id)),
    detourIds: [],
  };
};
