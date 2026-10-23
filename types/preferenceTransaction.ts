import type { Product } from './product';
export type PreferenceOperation = 'favorite' | 'pass' | 'unlike' | 'undo_pass';
export type PreferenceWriteReceipt = {
  mode: 'v2'; actionId: string; replayed: boolean; serverEvents: true;
};
export type PreferenceRpcArguments = {
  p_action: string; p_operation: PreferenceOperation; p_product: string; p_session: string;
  p_expected: string[] | null; p_snapshot: Product | null;
  /** Explicit current legacy relation row, never a fabricated historical action. */
  p_legacy_row?: string;
};
