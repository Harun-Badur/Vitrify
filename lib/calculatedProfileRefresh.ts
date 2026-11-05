import type { CalculatedStyleProfileState } from '../types/calculatedStyleProfile';

export type CalculatedRefreshReason = 'focus' | 'changed' | 'retry';

/** State to show while a refresh runs, or null to keep the current one.
 * A plain focus keeps a verified value and refreshes behind it. A committed
 * preference change or an explicit retry drops to loading: a revoked
 * preference must never stay on screen as current while the read is open.
 */
export function refreshStartState(
  previous: CalculatedStyleProfileState, reason: CalculatedRefreshReason,
): CalculatedStyleProfileState | null {
  if (reason === 'focus' && previous.state === 'ready') return null;
  return { state: 'loading' };
}
