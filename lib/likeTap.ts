import type { LikeInputSource } from '../types/analytics';

export type LikeTapDecision = 'require_auth' | 'like' | 'unlike' | 'none';

/** What a double tap or a heart-button press on the current card should do. */
export const decideLikeTap = (input: { canLike: boolean; liked: boolean; source: LikeInputSource }): LikeTapDecision => {
  if (!input.canLike) return 'require_auth';
  if (!input.liked) return 'like';
  // Already liked: the button toggles it off; a double tap only replays the heart, never a second event.
  return input.source === 'button' ? 'unlike' : 'none';
};
