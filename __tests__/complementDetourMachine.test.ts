import type { Product } from '../types/product';
import {
  MAX_DETOUR_DEPTH, clearTemporary, openDetour, popDetour, type DetourState,
} from '../store/detourState';

const mk = (id: string): Product => ({ id, title: id } as unknown as Product);
const feed = (n: number): Product[] => Array.from({ length: n }, (_, i) => mk(`p${i}`));
const ids = (ps: readonly { id: string }[]): string[] => ps.map(p => p.id);
const stackIds = (s: DetourState): string[] => s.stack.map(e => `${e.product.id}:${e.kind}`);
const start = (n = 6): DetourState => ({ deck: feed(n), stack: [], detourIds: [] });
const open = (s: DetourState, x: Product): DetourState => {
  const r = openDetour(s, x);
  if (r === null) throw new Error('refused');
  return r;
};

describe('openDetour (A→X)', () => {
  test('A leaves the deck front into the stack as detour; X (same object) becomes [0]', () => {
    const x = mk('x1');
    const s = open(start(), x);
    expect(s.deck[0]).toBe(x);
    expect(ids(s.deck)).toEqual(['x1', 'p1', 'p2', 'p3', 'p4', 'p5']);
    expect(stackIds(s)).toEqual(['p0:detour']);
    expect(s.detourIds).toEqual(['x1']);
  });
  test('X already ahead in the feed is moved out of its canonical slot (not shown twice)', () => {
    const base = start();
    const x = base.deck[3];
    const s = open(base, x);
    expect(s.deck[0]).toBe(x);
    expect(ids(s.deck)).toEqual(['p3', 'p1', 'p2', 'p4', 'p5']);
  });
  test('refuses opening the card already on screen or one already in the stack', () => {
    const s = start();
    expect(openDetour(s, s.deck[0])).toBeNull();
    const s2 = open(s, mk('x1'));
    expect(openDetour(s2, mk('p0'))).toBeNull();
  });
  test('no card to leave: refused', () => {
    expect(openDetour({ deck: [], stack: [], detourIds: [] }, mk('x'))).toBeNull();
  });
});

describe('chain A→X→Y', () => {
  test('X enters the stack as detour, Y is [0]', () => {
    const s = open(open(start(), mk('x')), mk('y'));
    expect(s.deck[0].id).toBe('y');
    expect(stackIds(s)).toEqual(['p0:detour', 'x:detour']);
    expect(s.detourIds).toEqual(['x', 'y']);
  });
});

describe('down swipe (popDetour)', () => {
  test('A→X→down: A returns to [0], X is deleted and does not come back', () => {
    const s = popDetour(open(start(), mk('x')));
    expect(ids(s.deck)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5']);
    expect(s.stack).toEqual([]);
    expect(s.detourIds).toEqual([]);
  });
  test('A→X→Y→down→down: Y deleted then X deleted, back at A', () => {
    const s1 = popDetour(open(open(start(), mk('x')), mk('y')));
    expect(ids(s1.deck).slice(0, 2)).toEqual(['x', 'p1']);
    expect(stackIds(s1)).toEqual(['p0:detour']);
    expect(s1.detourIds).toEqual(['x']);
    const s2 = popDetour(s1);
    expect(ids(s2.deck).slice(0, 2)).toEqual(['p0', 'p1']);
    expect(s2.detourIds).toEqual([]);
  });
  test('top is not a detour: untouched', () => {
    const s = start();
    expect(popDetour(s)).toBe(s);
  });
});

describe('up swipe from a temporary card (clearTemporary)', () => {
  test('A→X→up: X gone, A stays in the stack, A+1 is [0]', () => {
    const s = clearTemporary(open(start(), mk('x')));
    expect(ids(s.deck)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(stackIds(s)).toEqual(['p0:detour']);
    expect(s.detourIds).toEqual([]);
  });
  test('A→X→Y→up: Y and the intermediate X both gone, A stays', () => {
    const s = clearTemporary(open(open(start(), mk('x')), mk('y')));
    expect(ids(s.deck)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(stackIds(s)).toEqual(['p0:detour']);
  });
  test('A→X→up→down: from A+1 down returns A, not X', () => {
    const s = popDetour(clearTemporary(open(start(), mk('x'))));
    expect(ids(s.deck).slice(0, 2)).toEqual(['p0', 'p1']);
    expect(s.stack).toEqual([]);
  });
  test('a plain deck is untouched (same reference)', () => {
    const s = start();
    expect(clearTemporary(s)).toBe(s);
  });
});

describe('depth limit', () => {
  test('the 21st detour is refused; chain stays intact and source A stays at stack bottom', () => {
    let s = start(30);
    for (let i = 1; i <= MAX_DETOUR_DEPTH; i++) s = open(s, mk(`x${i}`));
    expect(s.detourIds).toHaveLength(MAX_DETOUR_DEPTH);
    expect(s.stack[0].product.id).toBe('p0');
    expect(openDetour(s, mk('x21'))).toBeNull();
  });
  test('after clearing, the chain can start again', () => {
    let s = start(30);
    for (let i = 1; i <= MAX_DETOUR_DEPTH; i++) s = open(s, mk(`x${i}`));
    s = clearTemporary(s);
    expect(openDetour(s, mk('again'))).not.toBeNull();
  });
});

// index.tsx derives lastPassed (the -1 page, and canUndo = lastPassed !== null) from the stack top.
const lastPassed = (s: DetourState): string | null => s.stack[s.stack.length - 1]?.product.id ?? null;

describe('previous page (-1) source and canUndo', () => {
  test('during a detour the -1 page is the source A and canUndo is true', () => {
    expect(lastPassed(open(start(), mk('x')))).toBe('p0');
  });
  test('after up-swipe from X the -1 page is still A (way back), not X', () => {
    expect(lastPassed(clearTemporary(open(start(), mk('x'))))).toBe('p0');
  });
  test('in a chain the -1 page is the previous card; after the up-swipe it is A again', () => {
    const s = open(open(start(), mk('x')), mk('y'));
    expect(lastPassed(s)).toBe('x');
    expect(lastPassed(clearTemporary(s))).toBe('p0');
  });
  test('back at A with an empty stack there is no -1 page and canUndo is false', () => {
    expect(lastPassed(popDetour(open(start(), mk('x'))))).toBeNull();
  });
});
