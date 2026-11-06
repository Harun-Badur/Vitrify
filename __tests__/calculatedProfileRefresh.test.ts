import { calculatedRetryAction, refreshStartState } from '../lib/calculatedProfileRefresh';
import { emptyStyleProfile } from '../lib/scoring';
import type { CalculatedStyleProfileState } from '../types/calculatedStyleProfile';

const ready: CalculatedStyleProfileState = {
  state: 'ready',
  profile: { snapshot: emptyStyleProfile('A'), algorithm: 'v2', eventCount: 3, computedAt: null },
};

describe('refreshStartState', () => {
  test('focus keeps a previously verified value and refreshes silently', () => {
    expect(refreshStartState(ready, 'focus')).toBeNull();
  });
  test('focus without a ready value shows loading (first open, after an error)', () => {
    expect(refreshStartState({ state: 'loading' }, 'focus')).toEqual({ state: 'loading' });
    expect(refreshStartState({ state: 'error' }, 'focus')).toEqual({ state: 'loading' });
  });
  test('a committed preference change drops to loading so a revoked preference is never shown as current', () => {
    expect(refreshStartState(ready, 'changed')).toEqual({ state: 'loading' });
  });
  test('retry always shows loading', () => {
    expect(refreshStartState(ready, 'retry')).toEqual({ state: 'loading' });
    expect(refreshStartState({ state: 'error' }, 'retry')).toEqual({ state: 'loading' });
  });
});

describe('calculatedRetryAction', () => {
  test('a running focus refresh is simply retried', () => {
    expect(calculatedRetryAction(true, 'success')).toBe('refresh');
  });
  test('a failed session sync is repeated: its success starts the profile read', () => {
    expect(calculatedRetryAction(false, 'error')).toBe('resync');
  });
  test('nothing to do while the sync is still open', () => {
    expect(calculatedRetryAction(false, 'loading')).toBe('none');
    expect(calculatedRetryAction(false, 'idle')).toBe('none');
  });
});
