// Haptics (docs/milestones/M2.md, "input-2"; docs/architecture.md, "Input": an output in
// input/feedback). `navigator.vibrate` patterns keyed by the player's own sim events: a hit landed,
// a hit taken, a takedown and a crash. Gated by the haptics toggle (on by default [decided]) and
// silently absent where the browser has no vibration. Patterns are [default].
//
// Not naggy: one buzz per sim step at most (the strongest event wins), and a weaker buzz never
// cuts into a stronger one that is still playing.
//
// The wheelie (playtest 3; the button since playtest 4): a 12 ms tick when the button is pressed (createInput pulses it on the
// wheelie flag's rising edge), a 30 ms buzz each time the front swings up into the `high` band (the
// loop-out warning), and the crash pattern on a loop-out.
import type { EntityId } from '../core';
import type { MovesSnapshot, SimEvent } from '../sim/api';

export type HapticKind = 'hitLanded' | 'hitTaken' | 'takedown' | 'crash' | 'wheelieStart' | 'wheelieHigh';

/** Vibration patterns, ms (on, off, on, ...). The hits scale with the hit's `hitImpulse`. */
export const HAPTIC_PATTERNS: Readonly<Record<HapticKind, readonly number[]>> = {
  hitLanded: [25],
  hitTaken: [45],
  takedown: [40, 50, 90],
  crash: [120, 40, 60],
  wheelieStart: [12],
  wheelieHigh: [30],
};

/** Stronger kinds win a step and are not interrupted by weaker ones. */
const PRIORITY: Readonly<Record<HapticKind, number>> = {
  wheelieStart: 1,
  hitLanded: 2,
  wheelieHigh: 3,
  hitTaken: 4,
  takedown: 5,
  crash: 6,
};

export type VibrateFn = (pattern: number | number[]) => boolean;

export interface Haptics {
  /** Whether this browser can vibrate (the settings toggle is hidden where it cannot). */
  readonly supported: boolean;
  setEnabled(on: boolean): void;
  enabled(): boolean;
  /** One sim step's events; `playerId` is the local player's entity. `nowMs` defaults to the clock. */
  onEvents(events: readonly SimEvent[], playerId: EntityId, nowMs?: number): HapticKind | null;
  /**
   * The player's moves from the sim step's snapshot (`SimSnapshot.moves`): a buzz when the wheelie's
   * band turns `high`, once per swing up, not every tick it stays there. Null, or undefined, is no
   * wheelie.
   */
  onMoves(moves: Pick<MovesSnapshot, 'wheelieBand'> | null | undefined, nowMs?: number): HapticKind | null;
  /** A one-off buzz (the Start tap's first vibration is platform's; this is for tests and menus). */
  pulse(kind: HapticKind): void;
}

/** The kind of buzz an event gives the player, or null. */
export function hapticKind(e: SimEvent, playerId: EntityId): HapticKind | null {
  switch (e.type) {
    case 'hit':
      if (e.actor === playerId) return 'hitLanded';
      if (e.target === playerId) return 'hitTaken';
      return null;
    case 'takedown':
      return e.actor === playerId ? 'takedown' : null;
    case 'crash':
      return e.actor === playerId ? 'crash' : null;
    case 'wheelieEnd':
      // A loop-out also emits its own crash; either way the player feels the crash pattern, once.
      return e.actor === playerId && e.data['loopOut'] === true ? 'crash' : null;
    default:
      return null;
  }
}

const impulseOf = (e: SimEvent): number | null => {
  const v = e.data['hitImpulse'];
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null;
};

/** The pattern for one event: hits grow with the hit's impulse (0..1) when combat reports one. */
export function hapticPattern(kind: HapticKind, impulse: number | null = null): number[] {
  const base = [...HAPTIC_PATTERNS[kind]];
  if ((kind === 'hitLanded' || kind === 'hitTaken') && impulse !== null)
    base[0] = Math.round((base[0] ?? 0) * (0.6 + 0.8 * impulse));
  return base;
}

const browserVibrate = (): VibrateFn | null => {
  const nav = (globalThis as { navigator?: { vibrate?: VibrateFn } }).navigator;
  return typeof nav?.vibrate === 'function' ? (p) => nav.vibrate!.call(nav, p) : null;
};

export interface HapticsOptions {
  /** The vibrate call; navigator.vibrate by default. Null means unsupported. */
  vibrate?: VibrateFn | null;
  enabled?: boolean;
  now?: () => number;
}

export function createHaptics(opts: HapticsOptions = {}): Haptics {
  const vibrate = opts.vibrate === undefined ? browserVibrate() : opts.vibrate;
  const clock = opts.now ?? (() => performance.now());
  let on = opts.enabled ?? true;
  let busyUntil = 0;
  let busyPriority = 0;
  let wheelieBand: MovesSnapshot['wheelieBand'] = null;

  const play = (kind: HapticKind, pattern: number[], nowMs: number): boolean => {
    if (!vibrate || !on) return false;
    if (nowMs < busyUntil && PRIORITY[kind] < busyPriority) return false;
    try {
      vibrate(pattern);
    } catch {
      return false; // a browser that throws (no user activation yet) is treated as silent
    }
    busyUntil = nowMs + pattern.reduce((s, v) => s + v, 0);
    busyPriority = PRIORITY[kind];
    return true;
  };

  return {
    supported: !!vibrate,
    setEnabled(v) {
      const wasOn = on;
      on = v;
      // Switching off stops a buzz that is still playing.
      if (wasOn && !v && vibrate && clock() < busyUntil) {
        try {
          vibrate(0);
        } catch {
          // nothing to stop
        }
        busyUntil = 0;
      }
    },
    enabled: () => on,
    onEvents(events, playerId, nowMs = clock()) {
      if (!vibrate || !on) return null;
      let best: { kind: HapticKind; e: SimEvent } | null = null;
      for (const e of events) {
        const kind = hapticKind(e, playerId);
        if (kind && (!best || PRIORITY[kind] > PRIORITY[best.kind])) best = { kind, e };
      }
      if (!best) return null;
      return play(best.kind, hapticPattern(best.kind, impulseOf(best.e)), nowMs) ? best.kind : null;
    },
    onMoves(moves, nowMs = clock()) {
      const band = moves?.wheelieBand ?? null;
      const turnedHigh = band === 'high' && wheelieBand !== 'high';
      wheelieBand = band;
      if (!turnedHigh || !vibrate || !on) return null;
      return play('wheelieHigh', hapticPattern('wheelieHigh'), nowMs) ? 'wheelieHigh' : null;
    },
    pulse(kind) {
      play(kind, hapticPattern(kind), clock());
    },
  };
}
