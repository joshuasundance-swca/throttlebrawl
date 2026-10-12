/** A completed CPU scene-render call; this does not assert GPU or screen presentation. */
export interface AppDrawnFrame {
  readonly timestampMs: number;
  readonly epoch: number;
  readonly eligible: boolean;
}

/** Live context only: positive ticks and a frame's historical synthetic flag are excluded. */
export interface FrameContext {
  state: string;
  race: boolean;
  snapshot: boolean;
  tickZero: boolean;
  uiPaused: boolean;
  loopPaused: boolean;
  hidden: boolean;
  contextHold: boolean;
  loading: boolean;
  visible: boolean;
  contextLost: boolean;
  countdown: boolean;
  lockstep: number | null;
}

export function liveFrameEligible(c: FrameContext): boolean {
  return (
    c.state === 'race' &&
    c.race &&
    c.snapshot &&
    !c.tickZero &&
    !c.uiPaused &&
    !c.loopPaused &&
    !c.hidden &&
    !c.contextHold &&
    !c.loading &&
    c.visible &&
    !c.contextLost &&
    !c.countdown &&
    c.lockstep === null
  );
}

export function nextFrameEpoch(epoch: number): number {
  if (!Number.isSafeInteger(epoch) || epoch < 0 || epoch === Number.MAX_SAFE_INTEGER)
    throw new Error('Frame observation epoch exhausted');
  return epoch + 1;
}

/** App-owned continuity and additive subscriptions, independent of tick-driver ownership. */
export function createFrameObservation(context: () => FrameContext) {
  let signature: FrameContext | null = null;
  let epoch = 0;
  const entries = new Map<
    object,
    {
      onFrame: (frame: Readonly<AppDrawnFrame>) => void;
      onError: (error: unknown) => void;
    }
  >();
  const invalidate = () => {
    epoch = nextFrameEpoch(epoch);
  };
  const refresh = () => {
    const next = context();
    if (
      signature &&
      (Object.keys(next) as (keyof FrameContext)[]).some((key) => next[key] !== signature?.[key])
    )
      invalidate();
    signature = next;
    return next;
  };
  return {
    refresh,
    invalidate,
    subscribe(onFrame: (frame: Readonly<AppDrawnFrame>) => void, onError: (error: unknown) => void) {
      const token = {};
      entries.set(token, { onFrame, onError });
      return () => {
        entries.delete(token);
      };
    },
    draw(timestampMs: number, synthetic: boolean, hasPose: boolean, render: () => void) {
      const before = refresh();
      if (!hasPose) {
        invalidate();
        return;
      }
      try {
        render();
      } catch (error) {
        refresh();
        invalidate();
        throw error;
      }
      const after = refresh();
      if (before.contextLost || after.contextLost) {
        invalidate();
        return;
      }
      if (entries.size === 0) return;
      const sample = Object.freeze({ timestampMs, epoch, eligible: liveFrameEligible(after) && !synthetic });
      for (const [token, entry] of [...entries]) {
        if (!entries.has(token)) continue;
        try {
          entry.onFrame(sample);
        } catch (error) {
          entries.delete(token);
          try {
            entry.onError(error);
          } catch (callbackError) {
            console.error('Frame observation error callback failed', callbackError);
          }
        }
      }
    },
  };
}
