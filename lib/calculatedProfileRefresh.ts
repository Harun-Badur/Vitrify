import type { SessionSyncStatus } from '../store/profileSlice';
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

/** What "Yeniden dene" does. The profile read starts only after a successful session sync,
 * so a failed sync is repeated first; its success starts the read through the focus effect.
 */
export function calculatedRetryAction(
  canRefresh: boolean, sessionSyncStatus: SessionSyncStatus,
): 'refresh' | 'resync' | 'none' {
  if (canRefresh) return 'refresh';
  return sessionSyncStatus === 'error' ? 'resync' : 'none';
}
