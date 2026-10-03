// What an AI rider can see: other movers relative to itself, in its own travel frame. Pure
// functions of sim state, so the controller stays deterministic.
import type { RoadNetwork, RoadPos } from '../../road';
import type { SimConfig, SimWeaponDef } from '../types';
import type { Mover } from '../world';

/**
 * How far `b` is along the road from `a` (b.s − a.s in a's edge frame), across one edge end when
 * the two sit on neighbouring edges; null when they are further apart than `range`.
 */
export function relativeS(road: RoadNetwork, a: RoadPos, b: RoadPos, range: number): number | null {
  if (a.edge === b.edge) return b.s - a.s;
  for (const n of road.neighbours(a.edge, a.s, range)) {
    if (n.edge === b.edge) return b.s + n.sOffset - a.s;
  }
  return null;
}

/** Another mover seen from a rider: ahead (+ in its travel direction) and across (+ toward its right). */
export interface Seen {
  mover: Mover;
  /** Metres ahead along the road, in the viewer's travel direction. */
  ahead: number;
  /** Lateral offset in road d (not flipped): other.d − viewer.d. */
  dd: number;
  /** The other's speed along the viewer's travel direction (negative when coming the other way). */
  vAlong: number;
}

export function see(road: RoadNetwork, me: Mover, other: Mover, range: number): Seen | null {
  const rel = relativeS(road, me.pos, other.pos, range);
  if (rel === null) return null;
  const ahead = rel * me.pos.dir;
  if (ahead > range || ahead < -range) return null;
  return {
    mover: other,
    ahead,
    dd: other.pos.d - me.pos.d,
    vAlong: other.speed * (other.pos.dir === me.pos.dir ? 1 : -1),
  };
}

/** Half extents of the largest traffic body, for crude avoidance (M1: movers don't carry a type). */
export interface ObstacleSize {
  halfLength: number;
  halfWidth: number;
}

export function vehicleSize(config: SimConfig): ObstacleSize {
  let length = 0;
  let width = 0;
  for (const t of config.trafficTypes) {
    if (t.category === 'pedestrian' || t.category === 'animal') continue;
    if (t.lengthM > length) length = t.lengthM;
    if (t.widthM > width) width = t.widthM;
  }
  return { halfLength: (length || 4.6) / 2, halfWidth: (width || 1.9) / 2 };
}

export const PED_SIZE: ObstacleSize = { halfLength: 0.4, halfWidth: 0.4 };

/** Something seen in the road, with the half extents a rider keeps clear of. */
export interface Obstacle {
  s: Seen;
  size: ObstacleSize;
}

/**
 * Finds the nearest obstacle blocking the line `d` (closer side to side than its half width plus
 * `clear`) within `look` metres ahead, or further when it is closing fast (an oncoming car is seen
 * `aheadS` seconds out, whatever the distance). Shared by sim/ai and sim/cops (W-S).
 */
export function blockerAt<O extends Obstacle>(
  seen: readonly O[],
  v: number,
  d: number,
  look: number,
  clear: number,
  aheadS: number,
): O | null {
  let best: O | null = null;
  for (const o of seen) {
    const front = o.s.ahead - o.size.halfLength;
    const reach = Math.max(look, (v - o.s.vAlong) * aheadS);
    if (o.s.ahead + o.size.halfLength < 0 || front > reach) continue;
    if (Math.abs(o.s.mover.pos.d - d) >= o.size.halfWidth + clear) continue;
    if (!best || o.s.ahead < best.s.ahead) best = o;
  }
  return best;
}

/** Whether a line d is clear (by `clear` past each half width) within `reach` metres plus 2.5 s of closing. */
export function lineClear(
  seen: readonly Obstacle[],
  v: number,
  d: number,
  reach: number,
  clear: number,
): boolean {
  for (const o of seen) {
    if (Math.abs(o.s.mover.pos.d - d) >= o.size.halfWidth + clear) continue;
    const closing = Math.max(0, v - o.s.vAlong);
    const front = o.s.ahead - o.size.halfLength;
    if (o.s.ahead + o.size.halfLength < -2) continue;
    if (front < reach + closing * 2.5) return false;
  }
  return true;
}

/** Whether every line from `from` to `to` (every half metre) is clear: getting there is safe too. */
export function pathClear(
  seen: readonly Obstacle[],
  v: number,
  from: number,
  to: number,
  reach: number,
  clear: number,
): boolean {
  const steps = Math.max(1, Math.ceil(Math.abs(to - from) / 0.5));
  for (let i = 1; i <= steps; i++) {
    if (!lineClear(seen, v, from + ((to - from) * i) / steps, reach, clear)) return false;
  }
  return true;
}

/** Reach and timing of an attack, from the weapon data, with the M1 starting numbers as fallback. */
export interface Reach {
  sM: number;
  dM: number;
  windupTicks: number;
  /** Wind-up + active + recovery + cooldown: the earliest the next swing can start. */
  cycleTicks: number;
}

const FALLBACK: Record<'punch' | 'kick', Reach> = {
  punch: { sM: 1.2, dM: 1.4, windupTicks: 7, cycleTicks: 27 },
  kick: { sM: 1.0, dM: 1.7, windupTicks: 13, cycleTicks: 76 },
};

export function weaponReach(config: SimConfig, id: 'punch' | 'kick'): Reach {
  const w: SimWeaponDef | undefined = config.weapons.find((x) => x.contentId.endsWith(`:${id}`));
  if (!w) return FALLBACK[id];
  return {
    sM: w.reachSM,
    dM: w.reachDM,
    windupTicks: w.windupTicks,
    cycleTicks: w.windupTicks + w.activeTicks + w.recoveryTicks + w.cooldownTicks,
  };
}
