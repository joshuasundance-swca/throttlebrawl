// The look fallback watch (run W-O; maintainer, 2026-10-01: "ink+60s but may change later"). Ink +
// 60s film is the default look, and its frame rate on the maintainer's phone is unverified. If the
// frames stay slow for a sustained stretch of a race on an ink look, app/ asks ui to offer a
// one-tap switch to the Classic look (a non-blocking note; ui remembers a "No thanks").
//
// A frame is slow when its interval passes `slowFactor` times the frame-rate cap's own interval
// (a 60 Hz frame times the settings' divisor), so a player who capped the frame rate at half is not
// told 30 fps is slow. The watch ignores a race's first `graceS` seconds (shaders compile, chunks
// load), then offers when slow frames fill `badShare` of the last `windowS` seconds. It offers at
// most once a race; a pause, the menu or a look change starts its window over. [default]

export const LOOK_FALLBACK = {
  /** Seconds of a race (or after a resume) never counted. */
  graceS: 3,
  /** The stretch the frames must stay slow over, seconds. */
  windowS: 6,
  /** The share of that stretch's time spent in slow frames that counts as "stays bad". */
  badShare: 0.6,
  /** A frame is slow past this many times the cap's interval (1.75 x 16.7 ms = 29 ms: under ~34 fps). */
  slowFactor: 1.75,
  /** One display frame at 60 Hz, ms. */
  baseMs: 1000 / 60,
} as const;

export interface LookFallbackContext {
  /** A race is running and not paused. */
  racing: boolean;
  /** The look is an ink look (anything but Classic). */
  inkLook: boolean;
  /** The frame-rate cap's divisor (1 full, 2 half, 3 a third). */
  divisor: number;
}

export interface LookFallbackWatch {
  /** One rendered frame's interval (ms). True on the one frame the offer should be made. */
  frame(intervalMs: number, ctx: LookFallbackContext): boolean;
  /** A new race: the window starts over and the race may offer again. */
  reset(): void;
}

export function createLookFallback(numbers: Partial<typeof LOOK_FALLBACK> = {}): LookFallbackWatch {
  const n = { ...LOOK_FALLBACK, ...numbers };
  // The window as parallel rings of intervals and their slow flags, with running sums.
  const ms: number[] = [];
  const slow: boolean[] = [];
  let total = 0;
  let slowTotal = 0;
  let grace = 0;
  let offered = false;
  const clear = () => {
    ms.length = 0;
    slow.length = 0;
    total = 0;
    slowTotal = 0;
    grace = 0;
  };
  return {
    frame(intervalMs, ctx) {
      if (!ctx.racing || !ctx.inkLook || !(intervalMs > 0)) {
        clear();
        return false;
      }
      if (offered) return false;
      if (grace < n.graceS * 1000) {
        grace += intervalMs;
        return false;
      }
      const isSlow = intervalMs > n.slowFactor * n.baseMs * Math.max(1, ctx.divisor);
      ms.push(intervalMs);
      slow.push(isSlow);
      total += intervalMs;
      if (isSlow) slowTotal += intervalMs;
      // Keep just enough frames to cover the window.
      while (ms.length > 1 && total - (ms[0] ?? 0) >= n.windowS * 1000) {
        const gone = ms.shift() ?? 0;
        total -= gone;
        if (slow.shift()) slowTotal -= gone;
      }
      if (total < n.windowS * 1000 || slowTotal < n.badShare * total) return false;
      offered = true;
      return true;
    },
    reset() {
      clear();
      offered = false;
    },
  };
}
