// When the takedown camera runs (docs/milestones/M2.md, camera-2; the architecture doc's `takedown`
// mode). It switches on at a `takedown` event credited to the followed rider, holds the victim in
// view while the slow motion runs, and lets go at the matching `slowmoEnd`. With no slow motion
// (the toggle is off, or the cooldown is running), it holds for `camera.takedownHoldS`.
//
// The blend runs on a linear progress p in [0, 1] at 1 / `camera.takedownBlendS` per second, eased
// with smoothstep. So it never overshoots, and once released it is fully off exactly one blend time
// later: the takedown framing ends by `slowmoEnd` plus its blend time.
import type { SimEvent } from '../sim/api';

/** A safety cap: a slow motion whose end never arrives lets go this long after the hold time. */
const SLOWMO_CAP_S = 4;

export interface TakedownParams {
  takedownBlendS: number;
  takedownHoldS: number;
}

export interface TakedownTracker {
  /** Reads a tick's events for takedowns credited to the rider with this id. */
  add(events: readonly SimEvent[], followId: number): void;
  /** Advances the blend by real seconds; returns the eased weight in [0, 1]. */
  step(dt: number, params: TakedownParams): number;
  /** The rider who went down, or -1 when no takedown framing runs. */
  readonly victim: number;
  /** The current eased weight, without advancing. */
  readonly weight: number;
  reset(): void;
}

const smoothstep = (p: number): number => p * p * (3 - 2 * p);

export function createTakedownTracker(): TakedownTracker {
  let active = false;
  let victim = -1;
  let cause: number | undefined;
  let slowmo = false;
  let releasing = false;
  let heldS = 0;
  let p = 0;

  const matches = (e: SimEvent): boolean =>
    cause === undefined || e.causeId === undefined || e.causeId === cause;

  return {
    add(events, followId) {
      for (const e of events) {
        if (e.actor !== followId) continue;
        if (e.type === 'takedown' && e.target !== undefined) {
          // A new takedown (a combo) re-aims the framing at the new victim and holds again.
          active = true;
          victim = e.target;
          cause = e.causeId;
          slowmo = false;
          releasing = false;
          heldS = 0;
        } else if (e.type === 'slowmoStart' && active && matches(e)) {
          slowmo = true;
        } else if (e.type === 'slowmoEnd' && active && matches(e)) {
          releasing = true;
        }
      }
    },
    step(dt, params) {
      if (!active) return 0;
      const d = Number.isFinite(dt) && dt > 0 ? dt : 0;
      if (!releasing) {
        heldS += d;
        const hold = Math.max(0, params.takedownHoldS);
        if (heldS >= (slowmo ? hold + SLOWMO_CAP_S : hold)) releasing = true;
      }
      const blend = Math.max(1e-3, params.takedownBlendS);
      p = Math.min(1, Math.max(0, p + ((releasing ? -1 : 1) * d) / blend));
      if (releasing && p <= 1e-9) {
        p = 0;
        active = false;
        victim = -1;
        cause = undefined;
      }
      return smoothstep(p);
    },
    get victim() {
      return active ? victim : -1;
    },
    get weight() {
      return smoothstep(p);
    },
    reset() {
      active = false;
      victim = -1;
      cause = undefined;
      slowmo = false;
      releasing = false;
      heldS = 0;
      p = 0;
    },
  };
}
