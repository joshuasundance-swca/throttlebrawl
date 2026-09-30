// The hit jolt (docs/milestones/M2.md, camera-2): a landed hit knocks the camera a short way
// sideways, away from the other rider, and it springs back. Unlike the trauma shake (shake.ts),
// which is noise, the jolt has a direction, so a hit reads as a push.
//
// Each axis is a critically damped spring at rest on zero that receives a velocity kick. From rest,
// x(t) = v0 * t * e^(-w t): it rises to v0 / (w e) at t = 1/w and returns without crossing zero,
// so a single jolt never overshoots. The size comes from the hit event's `data.hitImpulse` (combat-3),
// read as the target's knockback speed in m/s; until combat-3 publishes it, the kick flag picks a
// stand-in from M1's knockback numbers (kick 5 m/s, punch 2 m/s).
import type { SimEvent } from '../sim/api';
import { spring, stepSpring } from './spring';

/** Stand-in impulses (m/s) while a hit event carries no `hitImpulse`: M1's kick and punch knockback. */
export const FALLBACK_IMPULSE = { kick: 5, other: 2 } as const;
/** The rider who threw the hit feels a smaller recoil than the one who took it. */
const ATTACKER_SHARE = 0.5;
/** A little downward dip with every jolt, as a share of the sideways push. */
const DIP_SHARE = 0.35;

export interface JoltParams {
  /** Peak sideways offset of a full-strength jolt, metres. */
  joltM: number;
  /** The impulse (m/s) that gives a full-strength jolt. */
  joltFullImpulse: number;
  /** Spring rate, 1/s: the jolt peaks at 1/rate seconds. */
  joltRate: number;
}

/** Where the other rider is, sideways from the followed rider: + is to its right. */
export type LateralOf = (entityId: number) => number | undefined;

export interface Jolt {
  /** Kicks the camera for hits that involve the rider with this id. */
  add(events: readonly SimEvent[], followId: number, lateralOf: LateralOf, params: JoltParams): void;
  /** Advances the springs and returns the unscaled offset, metres (side: + right, up: + up). */
  step(dt: number, params: JoltParams): { side: number; up: number };
  reset(): void;
}

export function impulseOf(e: SimEvent): number {
  const v = e.data['hitImpulse'];
  if (typeof v === 'number' && Number.isFinite(v)) return Math.abs(v);
  return e.data['kick'] === true ? FALLBACK_IMPULSE.kick : FALLBACK_IMPULSE.other;
}

export function createJolt(): Jolt {
  const side = spring(0);
  const up = spring(0);
  return {
    add(events, followId, lateralOf, p) {
      if (!(p.joltRate > 0) || !(p.joltFullImpulse > 0)) return;
      for (const e of events) {
        if (e.type !== 'hit') continue;
        const took = e.target === followId;
        const threw = e.actor === followId;
        if (!took && !threw) continue;
        const other = took ? e.actor : e.target;
        const lateral = other === undefined ? undefined : lateralOf(other);
        // Away from the other rider; straight down when it is dead ahead or unknown.
        const away = lateral === undefined || lateral === 0 ? 0 : lateral > 0 ? -1 : 1;
        const strength = Math.min(1, impulseOf(e) / p.joltFullImpulse) * (took ? 1 : ATTACKER_SHARE);
        const peak = p.joltM * strength;
        // v0 = peak * w * e gives the peak offset `peak` at t = 1/w.
        const v0 = peak * p.joltRate * Math.E;
        side.v += away * v0;
        up.v -= v0 * DIP_SHARE;
      }
    },
    step(dt, p) {
      stepSpring(side, 0, p.joltRate, dt);
      stepSpring(up, 0, p.joltRate, dt);
      if (Math.abs(side.x) < 1e-6 && Math.abs(side.v) < 1e-6) side.x = side.v = 0;
      if (Math.abs(up.x) < 1e-6 && Math.abs(up.v) < 1e-6) up.x = up.v = 0;
      return { side: side.x, up: up.x };
    },
    reset() {
      side.x = side.v = up.x = up.v = 0;
    },
  };
}
