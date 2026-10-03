// Dial-Up's "Bad Connection", drawn (run W-U career polish; run W-T's grudge-rules follow-up: "Dial-Up
// has no see-through look while dropped"). While his connection is down he is a ghost: see-through,
// tinted like a dead screen, flickering at a choppy, uneven rate. For a moment after he reconnects
// he glitches back in, flashing between solid and see-through. Everything else draws solid.
//
// The sim says when: a `badConnection` event with `data.phase` `drop` starts it, `reconnect` ends it
// (sim/types.ts), and the snapshot must agree that he is still frozen (his signature move `lag` in
// its `act` phase), so a fall mid-drop, a missed event or a new race can never leave a ghost behind.
// Presentation only: wall-clock time is fine here. [default]
import type { EntitySnapshot, SimEvent } from '../../sim/api';

/** How long the glitch back in lasts after a reconnect, wall-clock seconds. [default] */
export const GHOST_REJOIN_S = 0.35;
/** The ghost's flicker rate, steps per second, and the see-through levels it steps through. */
const GHOST_HZ = 12;
const GHOST_STEPS = [0.22, 0.45, 0.1, 0.32, 0.55, 0.16, 0.38, 0.06, 0.28, 0.5, 0.2, 0.12];
/** The glitch back in: solid and see-through in turn, this many times a second. */
const REJOIN_HZ = 20;
const REJOIN_LOW = 0.3;

/** The ghost's see-through level at wall-clock `t` (1 is solid); `seed` staggers riders. */
export function ghostOpacity(t: number, seed: number): number {
  const i = Math.floor(t * GHOST_HZ + seed);
  const n = GHOST_STEPS.length;
  return GHOST_STEPS[((i % n) + n) % n] ?? 0.3;
}

/** The glitch back in after a reconnect: solid on alternate steps. */
export function rejoinOpacity(t: number): number {
  return Math.floor(t * REJOIN_HZ) % 2 === 0 ? 1 : REJOIN_LOW;
}

/** Whether the snapshot shows a rider frozen in a dropped connection (his lag move's act). */
export function frozenInLag(e: EntitySnapshot): boolean {
  const sig = e.signature ?? null;
  return (
    sig !== null && sig.move === 'lag' && sig.phase === 'act' && e.mode !== 'Tumble' && e.mode !== 'OnFoot'
  );
}

/** Which riders are ghosts now, from the sim's `badConnection` events and the snapshot. */
export class Ghosts {
  private readonly dropped = new Set<number>();
  private readonly rejoinUntil = new Map<number, number>();

  /** A step's events, at wall-clock `now`. */
  push(events: readonly SimEvent[], now: number): void {
    for (const ev of events) {
      if (ev.type !== 'badConnection') continue;
      const phase = ev.data['phase'];
      if (phase === 'drop') {
        this.dropped.add(ev.actor);
        this.rejoinUntil.delete(ev.actor);
      } else if (phase === 'reconnect') {
        // Only a rider seen dropped glitches back in (a reconnect is always after a drop).
        if (this.dropped.delete(ev.actor)) this.rejoinUntil.set(ev.actor, now + GHOST_REJOIN_S);
      }
    }
  }

  /** The rider's see-through level at wall-clock `t`: 1 solid, below 1 a ghost. */
  opacity(e: EntitySnapshot, t: number): number {
    if (this.dropped.has(e.id)) {
      if (frozenInLag(e)) return ghostOpacity(t, e.id * 5);
      // The snapshot moved on without a reconnect (he went down, the race restarted): solid again.
      this.dropped.delete(e.id);
    }
    const until = this.rejoinUntil.get(e.id);
    if (until !== undefined) {
      if (t < until) return rejoinOpacity(t);
      this.rejoinUntil.delete(e.id);
    }
    return 1;
  }
}
