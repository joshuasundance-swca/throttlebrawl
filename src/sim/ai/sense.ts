// What an AI rider can see: other movers relative to itself, in its own travel frame. Pure
// functions of sim state, so the controller stays deterministic.
import { planStreetFurniture, type RoadNetwork, type RoadPos, type StreetFurniture } from '../../road';
import { holdSpeedMps } from '../riders';
import { furnitureOn } from '../riders/furniture';
import type { SimConfig, SimWeaponDef } from '../types';
import type { Mover, World } from '../world';

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

/**
 * The solid street furniture a rider sees (the live check of #619: rivals rode into Russian Hill's
 * street trees, which nothing in their lines knew of): each solid piece (road/furniture.ts: a trunk, a
 * pole, a hydrant, a bench, a planter, a parked car) on the rider's edge or one joined to it, from
 * `behind` metres back to `ahead` metres on, as an obstacle that stands still: its footprint's reach
 * along and across the road are its half extents, and it moves at 0. The rival AI and the cops add
 * these to the traffic they keep their lines clear of (blockerAt, lineClear, pathClear, and never
 * steering into one alongside), so they steer round it as they steer round a stopped car. Light pieces
 * (a meter, a bin, a board, a scooter) are ridden through for a wobble, so they are not obstacles.
 * None while `riders.furniture` is off (nothing is met then). The piece's stand-in mover never moves
 * and is in no world: only its `pos.d` is read (its id is -1).
 */
export function furnitureSeen(
  world: World,
  config: SimConfig,
  me: Mover,
  ahead: number,
  behind: number,
): Obstacle[] {
  if (!furnitureOn(world.params)) return [];
  const road = config.road;
  const plan = planStreetFurniture(road, config.seed);
  if (plan.items.length === 0) return [];
  const pos = me.pos;
  const out: Obstacle[] = [];
  // Our s range, and each joined edge's (ours = sOffset + sSign * theirs; ours d = sSign * theirs + dOffset).
  const lo = pos.dir > 0 ? pos.s - behind : pos.s - ahead;
  const hi = pos.dir > 0 ? pos.s + ahead : pos.s + behind;
  const scan = (edge: number, sOffset: number, sSign: 1 | -1, dOffset: number) => {
    const list = plan.byEdge[edge];
    if (!list || list.length === 0) return;
    const a = sSign > 0 ? lo - sOffset : sOffset - hi;
    const b = sSign > 0 ? hi - sOffset : sOffset - lo;
    for (let i = firstFrom(list, a - 2 * plan.reachS); i < list.length; i++) {
      const it = list[i];
      if (!it) continue;
      if (it.shape.s - it.shape.reachS > b) break;
      if (it.cls !== 'solid' || it.shape.s + it.shape.reachS < a) continue;
      const s = sOffset + sSign * it.shape.s;
      const d = sSign * it.shape.d + dOffset;
      const stand: Mover = {
        id: -1,
        kind: 'pickup',
        mode: 'Road',
        pos: { edge: pos.edge, s, d, dir: pos.dir },
        h: 0,
        yaw: 0,
        speed: 0,
        riderIndex: -1,
      };
      out.push({
        s: { mover: stand, ahead: (s - pos.s) * pos.dir, dd: d - pos.d, vAlong: 0 },
        size: { halfLength: it.shape.reachS, halfWidth: it.shape.reachD },
      });
    }
  };
  scan(pos.edge, 0, 1, 0);
  const range = Math.max(ahead, behind);
  for (const n of road.neighbours(pos.edge, pos.s, range)) scan(n.edge, n.sOffset, n.sSign, n.dOffset);
  return out;
}

/**
 * The most a rival or a cop rides off the road among solid street furniture, m/s: under the 10 m/s
 * crash line (`traffic.solidHitMps`), so meeting a piece there is a wobble, and slow enough to turn
 * back across the kerb line between the pieces. [default]
 */
export const FIXED_OFF_ROAD_MPS = 8;
/** How far ahead a solid piece on its side of the road keeps an off-road rider at that crawl, m. */
const FIXED_OFF_ROAD_LOOK_M = 40;
/** How far a rider looks along the road for a bend it must slow for (beyond its braking distance), m. */
const BEND_LOOK_EXTRA_M = 10;
/** The most it looks along the road for a bend, m. */
const BEND_LOOK_MAX_M = 250;
/** The braking it plans with for a bend, m/s² (gentler than any bike's brakes). */
const BEND_BRAKE_MPS2 = 6;
/** The share of the hold speed (sim/riders `holdSpeedMps`) it takes a bend at: room for its own line. */
const BEND_HOLD_SHARE = 0.9;
/** Its look-ahead step, m. */
const BEND_STEP_M = 4;

/**
 * The fastest a rider can go now and still slow, braking at BEND_BRAKE_MPS2, to the speed that holds
 * each bend ahead (within its braking distance plus BEND_LOOK_EXTRA_M) on its line, m/s; Infinity with
 * no bend ahead. The rival AI and the cops keep under it on a street lined with solid furniture (the
 * live check of #619: on Russian Hill's and Duval's corners they were carried wide onto the sidewalk
 * into a trunk, a pole or a planter).
 */
export function bendSpeed(world: World, config: SimConfig, m: Mover, steerRateMps: number): number {
  const road = config.road;
  const steerScale = world.params['riders.steerScale'] ?? 1;
  const v = m.speed;
  const look = Math.min(BEND_LOOK_MAX_M, (v * v) / (2 * BEND_BRAKE_MPS2) + BEND_LOOK_EXTRA_M);
  const at = { edge: m.pos.edge, s: m.pos.s, d: 0, dir: m.pos.dir };
  let best = Infinity;
  for (let a = 0; a <= look; a += BEND_STEP_M) {
    if (a > 0) {
      at.s += at.dir * BEND_STEP_M;
      if (road.advance(at) === 'deadEnd') break;
    }
    const hold = BEND_HOLD_SHARE * holdSpeedMps(steerRateMps, road.kappaAt(at.edge, at.s), steerScale);
    if (hold === Infinity) continue;
    best = Math.min(best, Math.sqrt(hold * hold + 2 * BEND_BRAKE_MPS2 * a));
  }
  return best;
}

/**
 * Whether a rider at `d` is off the road (past the edge's lanes and shoulder, `dMin`..`dMax`) with a
 * solid piece of street furniture (`furnitureSeen`) on that side of the road ahead within
 * FIXED_OFF_ROAD_LOOK_M.
 */
export function offRoadAmongFixed(
  d: number,
  dMin: number,
  dMax: number,
  fixed: readonly Obstacle[],
): boolean {
  if (d <= dMax && d >= dMin) return false;
  const side = d > dMax ? 1 : -1;
  return fixed.some(
    (o) => o.s.ahead > -o.size.halfLength && o.s.ahead < FIXED_OFF_ROAD_LOOK_M && o.s.mover.pos.d * side > 0,
  );
}

/** The first index of a plan edge's list (sorted by its footprints' low s) whose low s is at least `s`. */
function firstFrom(list: readonly StreetFurniture[], s: number): number {
  let a = 0;
  let b = list.length;
  while (a < b) {
    const mid = (a + b) >> 1;
    const it = list[mid];
    if (it && it.shape.s - it.shape.reachS < s) a = mid + 1;
    else b = mid;
  }
  return a;
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
