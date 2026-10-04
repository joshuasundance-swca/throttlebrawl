// Touch (docs/architecture.md, "Input"; docs/milestones/M1.md, "input-1"). Pure pointer
// bookkeeping by pointerId, so it is unit-testable without a DOM: createInput feeds it Pointer
// Events. Coordinates are CSS px relative to the play surface; times are event timestamps, ms.
//
// - The floating stick appears where the left thumb lands inside the stick zone; drag up for
//   scaled throttle, sideways to steer, lift to coast. Its base sits at least one stick radius
//   from the screen edge.
// - The wheelie (playtest 3): a quick tap of the stick, then a second press within wheelieTapMs of
//   the lift and within wheelieTapPx of that base, re-uses the first tap's base, so the thumb's
//   height above it is the throttle on the very first sample, and sets `wheelie` for as long as that
//   press holds (once the throttle is at the sim's 0.3 floor). Lifting is coast: the front comes down.
// - The brake button brakes while held.
// - The attack button sets `attack` on the press (one tick), with the auto-target side. Within
//   attackDragMs, a flat sideways drag beyond attackDragPx picks a side; within kickSwipeMs, a
//   swipe beyond kickSwipePx within kickConeDeg (60) of straight down turns it into a kick. The
//   directional kick (playtest 2, 2026-10-02): a kick swipe leaning more than kickSideDeg (20)
//   from straight down kicks to the side it leans to, and a swipe within 45 degrees of straight UP
//   is the straight kick at the rider ahead. Side and kick are level-held while the finger stays
//   down. After the windows the gesture is locked.
//   The press also asks to skip the run-back; the sim acts on it only while on foot.
// - Touches within EDGE_PX of the left or right edge are ignored: the back gesture owns them.
// - Every press is latched until a tick samples it, so a tap shorter than a tick is never lost.
import type { Rect } from '../../core';
import type { ActionState } from '../actions';
import type { InputThresholds } from '../tuning';
import { TapPair, WheelieLatch } from './wheelie-tap';

/** Touches this close to the left or right screen edge are ignored (the Android back gesture). */
export const EDGE_PX = 24;

export interface TouchZones {
  width: number;
  height: number;
  stick: Rect | null;
  brake: Rect | null;
  attack: Rect | null;
}

interface Stick {
  id: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
}

/** Where a quick tap's stick base was, for the second press of a double-tap to re-use. */
interface TapBase {
  x0: number;
  y0: number;
}

interface AttackGesture {
  id: number;
  x0: number;
  y0: number;
  t0: number;
  side: -1 | 0 | 1;
  kick: boolean;
  /** The swipe went up: the straight kick. */
  straight: boolean;
  /** The press has not been sampled yet. */
  fresh: boolean;
  /** The finger lifted; the gesture is cleared after the next sample. */
  released: boolean;
}

const inside = (r: Rect | null, x: number, y: number): boolean =>
  !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export type TouchTarget = 'stick' | 'brake' | 'attack' | null;

export class TouchState {
  private stick: Stick | null = null;
  private attack: AttackGesture | null = null;
  private readonly brakes = new Set<number>();
  private brakeLatched = false;
  private readonly t: InputThresholds;
  /** The wheelie's double-tap: the stick presses as taps, and the base the last tap had. */
  private readonly taps = new TapPair();
  private readonly latch = new WheelieLatch();
  private tapBase: TapBase | null = null;
  /** The newest event time, ms: the lift time of a caller that gives none. */
  private lastTime = 0;
  /** M2 input-2 options: tilt-only steering turns the stick's steering off; pull-back brake. */
  readonly options = { stickSteers: true, pullBackBrake: false };

  constructor(thresholds: InputThresholds) {
    this.t = thresholds;
  }

  /** A pointer went down. Returns what it grabbed, or null when it is not ours. */
  down(id: number, x: number, y: number, time: number, zones: TouchZones): TouchTarget {
    this.lastTime = time;
    if (x < EDGE_PX || x > zones.width - EDGE_PX) return null;
    if (inside(zones.attack, x, y)) {
      this.attack = {
        id,
        x0: x,
        y0: y,
        t0: time,
        side: 0,
        kick: false,
        straight: false,
        fresh: true,
        released: false,
      };
      return 'attack';
    }
    if (inside(zones.brake, x, y)) {
      this.brakes.add(id);
      this.brakeLatched = true;
      return 'brake';
    }
    if (!this.stick && inside(zones.stick, x, y)) {
      const r = this.t.stickRangePx;
      let x0 = clamp(x, r, Math.max(r, zones.width - r));
      let y0 = clamp(y, r, Math.max(r, zones.height - r));
      // The second press of a double-tap keeps the first tap's base, near enough to where it landed.
      const base = this.taps.press(time, this.t.wheelieTapMs) ? this.tapBase : null;
      const again = !!base && Math.hypot(x - base.x0, y - base.y0) <= this.t.wheelieTapPx;
      if (again) {
        x0 = base.x0;
        y0 = base.y0;
      }
      this.latch.press(again);
      this.tapBase = null;
      this.stick = { id, x0, y0, x, y };
      return 'stick';
    }
    return null;
  }

  move(id: number, x: number, y: number, time: number): void {
    this.lastTime = time;
    if (this.stick?.id === id) {
      this.stick.x = x;
      this.stick.y = y;
    }
    const g = this.attack;
    if (g?.id === id && !g.released) {
      const dx = x - g.x0;
      const dy = y - g.y0;
      const elapsed = time - g.t0;
      // The swipe's angle from straight down, 0..180 degrees (90 is flat sideways, 180 straight up).
      const fromDown = (Math.atan2(Math.abs(dx), dy) * 180) / Math.PI;
      if (!g.kick && elapsed <= this.t.kickSwipeMs && Math.hypot(dx, dy) >= this.t.kickSwipePx) {
        if (fromDown <= this.t.kickConeDeg) {
          g.kick = true;
          if (g.side === 0 && fromDown > this.t.kickSideDeg) g.side = dx > 0 ? 1 : -1;
        } else if (fromDown >= 135) {
          g.kick = true;
          g.straight = true;
          g.side = 0;
        }
      }
      if (
        g.side === 0 &&
        !g.kick &&
        elapsed <= this.t.attackDragMs &&
        Math.abs(dx) >= this.t.attackDragPx &&
        fromDown > this.t.kickConeDeg
      )
        g.side = dx > 0 ? 1 : -1;
    }
  }

  /**
   * A pointer lifted, was cancelled or lost its capture: all are a release. `time` is the event's
   * timestamp, ms (the newest event's when left out); a short stick press is a tap that may open a
   * double-tap.
   */
  up(id: number, time: number = this.lastTime): void {
    this.lastTime = Math.max(this.lastTime, time);
    if (this.stick?.id === id) {
      this.taps.lift(time, this.t.wheelieTapMs);
      this.tapBase = { x0: this.stick.x0, y0: this.stick.y0 };
      this.stick = null; // lift to coast
      this.latch.release();
    }
    this.brakes.delete(id);
    if (this.attack?.id === id) this.attack.released = true;
  }

  /** Releases everything (the window lost focus). */
  clear(): void {
    this.stick = null;
    this.taps.reset();
    this.latch.release();
    this.tapBase = null;
    this.brakes.clear();
    this.brakeLatched = false;
    if (this.attack) this.attack.released = true;
  }

  /** The stick's base while a thumb is on it, CSS px on the play surface, or null. */
  base(): { x: number; y: number } | null {
    return this.stick ? { x: this.stick.x0, y: this.stick.y0 } : null;
  }

  /** Writes this tick's touch actions into `a` and clears what the tick consumed. */
  sample(a: ActionState): void {
    if (this.stick) {
      const r = this.t.stickRangePx;
      const sx = clamp((this.stick.x - this.stick.x0) / r, -1, 1);
      const up = clamp((this.stick.y0 - this.stick.y) / r, 0, 1);
      const dz = this.t.stickDeadZone;
      // Past the dead zone, the response curve (stickSteerExpo; 1 is M1's straight line).
      const past = Math.abs(sx) <= dz ? 0 : (Math.abs(sx) - dz) / (1 - dz);
      const steer = past === 0 ? 0 : Math.sign(sx) * past ** Math.max(1, this.t.stickSteerExpo);
      if (steer !== 0 && this.options.stickSteers) a.steer = steer;
      a.throttle = Math.max(a.throttle, up);
      if (this.latch.sample(true, up)) a.wheelie = true;
      if (this.options.pullBackBrake) {
        // Pulling the stick down brakes, past the same dead zone as steering (M2 input-2).
        const down = clamp((this.stick.y - this.stick.y0) / r, 0, 1);
        if (down > dz) a.brake = Math.max(a.brake, (down - dz) / (1 - dz));
      }
    }
    if (this.brakes.size > 0 || this.brakeLatched) a.brake = 1;
    this.brakeLatched = false;
    const g = this.attack;
    if (g) {
      if (g.fresh) a.attack = true;
      if (g.side !== 0) a.attackSide = g.side;
      if (g.kick) a.kick = true;
      if (g.straight) a.kickStraight = true;
      a.skipRunBack = true;
      g.fresh = false;
      if (g.released) this.attack = null;
    }
  }
}
