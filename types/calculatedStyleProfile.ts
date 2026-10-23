import type { StyleProfileSnapshot } from './recommendation';
/** Shared reader for Discover, Profile and future outfit consumers. No new model.
 * algorithm is the configured producer, not proof of a row's historical version.
 * eventCount includes eligible legacy/negative events; it is not a like count.
 */
export interface CalculatedStyleProfile {
  snapshot: StyleProfileSnapshot;
  algorithm: 'v1' | 'v2';
  eventCount: number;
  computedAt: string | null;
}
export type CalculatedStyleProfileState = { state: 'loading' | 'error' }
  | { state: 'ready'; profile: CalculatedStyleProfile };
