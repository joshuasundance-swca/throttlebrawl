// Event shake (docs/architecture.md, "Camera"): hits, crashes and landings add "trauma", which
// decays over time; the visible shake is trauma squared, times `camera.shakeScale`. The noise is a
// sum of sines at unrelated frequencies, so it is smooth and repeatable (no Math.random), which
// keeps screenshots and tests stable. Shake is applied to the output pose only, never to the
// springs, so it cannot build up.
import type { SimEvent } from '../sim/api';

/** Trauma added per event that involves the followed rider, before `camera.shakeScale`. */
export const SHAKE_TRAUMA: Readonly<Partial<Record<SimEvent['type'], { self: number; other: number }>>> = {
  // `self`: the followed rider is the actor; `other`: the followed rider is the event's target.
  crash: { self: 0.9, other: 0 },
  takedown: { self: 0.3, other: 0.8 },
  hit: { self: 0.2, other: 0.45 },
  kick: { self: 0.25, other: 0.5 },
  weaponGrab: { self: 0.15, other: 0.25 },
  land: { self: 0.35, other: 0 },
  bust: { self: 0, other: 0.4 },
};

/** Trauma lost per second. */
export const SHAKE_DECAY_PER_S = 1.4;

export interface ShakeSample {
  /** Sideways and vertical camera offset, metres. */
  side: number;
  up: number;
  /** Extra roll, radians. */
  roll: number;
}

export interface Shake {
  /** Adds trauma for events that involve the rider with this id. */
  add(events: readonly SimEvent[], followId: number): void;
  /** Advances the decay and noise clock, and returns this frame's offsets (already scaled). */
  step(dt: number, scale: number): ShakeSample;
  readonly trauma: number;
  reset(): void;
}

const MAX_SIDE_M = 0.22;
const MAX_UP_M = 0.16;
const MAX_ROLL = 0.05;

function noise(t: number, a: number, b: number, c: number): number {
  return (Math.sin(t * a) + Math.sin(t * b + 1.3) * 0.6 + Math.sin(t * c + 2.1) * 0.35) / 1.95;
}

export function createShake(): Shake {
  let trauma = 0;
  let t = 0;
  return {
    add(events, followId) {
      for (const e of events) {
        const amount = SHAKE_TRAUMA[e.type];
        if (!amount) continue;
        let add = 0;
        if (e.actor === followId) add = Math.max(add, amount.self);
        if (e.target === followId) add = Math.max(add, amount.other);
        trauma = Math.min(1, trauma + add);
      }
    },
    step(dt, scale) {
      if (dt > 0) {
        t += dt;
        trauma = Math.max(0, trauma - SHAKE_DECAY_PER_S * dt);
      }
      const s = Number.isFinite(scale) ? Math.max(0, scale) : 0;
      const amp = trauma * trauma * s;
      if (amp === 0) return { side: 0, up: 0, roll: 0 };
      return {
        side: noise(t, 37.1, 23.3, 51.7) * MAX_SIDE_M * amp,
        up: noise(t, 29.9, 41.3, 17.9) * MAX_UP_M * amp,
        roll: noise(t, 19.7, 33.1, 45.3) * MAX_ROLL * amp,
      };
    },
    get trauma() {
      return trauma;
    },
    reset() {
      trauma = 0;
    },
  };
}
