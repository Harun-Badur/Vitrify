/**
 * Foreground activity gate for the cooperative recommendation engine.
 *
 * While the user drags or throws a card (and briefly after, while the next card renders), engine slices
 * wait instead of competing with the render. This only moves work in time: the engine keeps its slices,
 * order and results. Starvation guard: no slice waits longer than a cap; once the cap expires the engine
 * may run a short burst, so continuous swiping still lets the preparation finish.
 *
 * Uses Date.now (not performance.now) so the scheduler's own clock-read accounting is untouched.
 */
export const FOREGROUND_MAX_WAIT_MS = 400;
/** Cap for the current and next anchors, whose recommendation should be ready before the next swipe. */
export const FOREGROUND_PRIORITY_MAX_WAIT_MS = 120;
/** How long a released (starved) engine may run before it yields to the foreground again. */
export const FOREGROUND_BURST_MS = 120;
/** A touch whose end event was lost must not pause the engine for good. */
const TOUCH_EXPIRY_MS = 5_000;
const POLL_MS = 40;

let touches = 0;
let touchExpiresAt = 0;
let settleUntil = 0;
let burstUntil = 0;

const RESOLVED: Promise<void> = Promise.resolve();

const busyAt = (now: number): boolean => (touches > 0 && now < touchExpiresAt) || now < settleUntil;

export const isForegroundBusy = (): boolean => (touches > 0 || settleUntil > 0) && busyAt(Date.now());

/** A drag/touch on the card began. Pair with foregroundEnd. */
export const foregroundBegin = (): void => {
  touches += 1;
  touchExpiresAt = Date.now() + TOUCH_EXPIRY_MS;
};

/** The touch ended; the card animation and the render that follows keep the foreground busy for `settleMs`. */
export const foregroundEnd = (settleMs = 0): void => {
  touches = Math.max(0, touches - 1);
  foregroundSettle(settleMs);
};

/** Foreground work (animation, render) is expected for the next `ms`; never shortens an existing window. */
export const foregroundSettle = (ms: number): void => {
  if (ms > 0) settleUntil = Math.max(settleUntil, Date.now() + ms);
};

export const resetForegroundGate = (): void => {
  touches = 0; touchExpiresAt = 0; settleUntil = 0; burstUntil = 0;
};

/**
 * Resolves when the foreground is idle, or after `maxWaitMs` at the latest. Idle (the common case) returns an
 * already-resolved promise without creating a timer.
 */
export const waitForForeground = (signal?: AbortSignal, maxWaitMs = FOREGROUND_MAX_WAIT_MS): Promise<void> => {
  if (touches === 0 && settleUntil === 0) return RESOLVED;
  const start = Date.now();
  if (!busyAt(start) || start < burstUntil) return RESOLVED;
  return new Promise<void>(resolve => {
    const deadline = start + maxWaitMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (starved: boolean): void => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (starved) burstUntil = Date.now() + FOREGROUND_BURST_MS;
      resolve();
    };
    const onAbort = (): void => finish(false);
    const check = (): void => {
      const now = Date.now();
      if (!busyAt(now) || now < burstUntil) return finish(false);
      if (now >= deadline) return finish(true);
      timer = setTimeout(check, Math.min(POLL_MS, deadline - now));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(check, Math.min(POLL_MS, maxWaitMs));
  });
};

/** After the finger lifts: the throw/snap spring still runs and the pass commits right after it. */
export const FOREGROUND_SWIPE_SETTLE_MS = 450;
/** After a pass/undo commits: store update, card promotion and the next card's first image. */
export const FOREGROUND_RENDER_SETTLE_MS = 400;
