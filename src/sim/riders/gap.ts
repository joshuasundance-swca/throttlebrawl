// sim/riders/gap.ts: road with no surface, and walls a rider can fly over (playtest 3: the Old Seven
// Mile Bridge's missing span, "Jumps could let you get from one to the other"; round 3, "the real
// 80 m missing span is the big jump (a miss = splash, respawn on the highway)"; the static ramp
// trucks that reach shortcuts over a `jumpable` wall, "the static one could be used to get to
// shortcuts"). docs/architecture.md, "Jumps, ramps and airtime".
//
// The hooks sim/riders calls (the contract, K0a), with their bodies (T3.1):
// - `gapUnder`: whether there is no road surface under the rider (inside a `gap` feature's box,
//   road/gap.ts). A grounded rider over one leaves the ground (the surface fell away), and an
//   airborne one never lands there;
// - `gapFall`, each airborne tick over a gap, with how far the rider is above (+) or below (-) the
//   deck plane: more than the gap's kill depth below, it goes overboard (a `crash` with `cause:
//   'gap'` and `overboard: true`), which sim/tumble takes into the water and the respawn. One more
//   than GAP_CLIP_M below that is about to leave the gap hits the far deck's broken end the same way
//   (`face: true`); less, it comes down on the far deck and the landing rules judge it;
// - `airWallSkip`, each airborne tick before the barrier rule, with the rider's absolute height
//   this tick: true when it is out at a `jumpable` wall and higher above the deck than the wall, so
//   it flies over and the barrier rule is skipped for this tick.
// Gaps and jumpable walls exist only where road data puts them, so a race without them rides exactly
// as before (no state, no tuning, no random draws).
import { cos, sin, type TuningParamDecl } from '../../core';
import { gapAt, gapParams, jumpableWallAt, type BakedFeature } from '../../road';
import type { SimConfig } from '../types';
import { emit, type Mover, type World } from '../world';
import type { RiderState } from './index';

/** The gaps' tuning: none (the numbers are each gap's own params, `gapParams`). */
export const GAP_TUNING: readonly TuningParamDecl[] = [];

/**
 * The gaps' per-rider state: none. A rider over a gap is known from its road position and height
 * alone, and the crash ends the fall (sim/tumble takes the rider the same tick).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the contract's seam, kept for later state
export interface GapState {}

export function newGapState(): GapState {
  return {};
}

/**
 * How far below the deck plane a rider reaching a gap's far edge is said to hit the deck's broken
 * end rather than come down on it, m [default] (moves spec §6.3: "0 to 0.4 m below the plane lands
 * ... deeper than that it is a crash").
 */
export const GAP_CLIP_M = 0.4;

/** Whether the rider is over a gap: no road surface under it. */
export function gapUnder(_world: World, config: SimConfig, m: Mover): boolean {
  return gapAt(config.road, m.pos.edge, m.pos.s, m.pos.d) !== null;
}

/**
 * Whether the rider's next tick, at its speed and heading, takes it out of gap `f`'s box (its s is
 * past the box or its d is out of it): the far edge is under the front wheel now.
 */
function leavesGap(world: World, config: SimConfig, m: Mover, f: BakedFeature): boolean {
  const dt = world.timeScale / 60;
  const pos = m.pos;
  const s = pos.s + pos.dir * m.speed * cos(m.yaw) * dt;
  const d = pos.d + pos.dir * m.speed * sin(m.yaw) * dt;
  const len = config.road.edges[pos.edge]?.length ?? 0;
  if (s < 0 || s > len) return false; // off this road's end: the next road's own gap rules hold
  return s < f.s0 || s > f.s1 || d < f.d0 || d > f.d1;
}

/** An airborne rider over a gap, `aboveDeckM` above (+) or below (-) the deck plane. */
export function gapFall(
  world: World,
  config: SimConfig,
  _st: RiderState,
  m: Mover,
  aboveDeckM: number,
): void {
  if (aboveDeckM >= 0) return;
  const f = gapAt(config.road, m.pos.edge, m.pos.s, m.pos.d);
  if (!f) return;
  const depth = -aboveDeckM;
  const missed = depth > gapParams(f).killDepthM;
  const face = !missed && depth > GAP_CLIP_M && leavesGap(world, config, m, f);
  if (!missed && !face) return;
  emit(world, 'crash', m.id, {
    cause: 'gap',
    overboard: true,
    feature: f.id,
    speed: m.speed,
    depthM: depth,
    yaw: m.yaw,
    ...(face ? { face: true } : {}),
  });
}

/** How far inside the outer drivable edge a rider counts as out at the wall, m: a bike's width. */
const WALL_REACH_M = 1;

/**
 * Whether an airborne rider at absolute height `y` flies over a `jumpable` wall this tick: it is out
 * at one side's outer drivable edge (within WALL_REACH_M of it, or past it), a jumpable wall stands
 * on that side at its s, and it is higher above the deck at the wall than the wall's `heightM`, or
 * already past the wall's line (it went over it on an earlier tick: the wall never pulls it back
 * through). A rider in the middle of the road, or low on the road's side of the wall, keeps the
 * barrier rule.
 */
export function airWallSkip(_world: World, config: SimConfig, _st: RiderState, m: Mover, y: number): boolean {
  const road = config.road;
  const pos = m.pos;
  const e = road.edges[pos.edge];
  if (!e) return false;
  const side = pos.d > e.dMax - WALL_REACH_M ? 'right' : pos.d < e.dMin + WALL_REACH_M ? 'left' : null;
  if (!side) return false;
  const wall = jumpableWallAt(road, pos.edge, pos.s, side);
  if (!wall) return false;
  const edgeD = side === 'right' ? e.dMax : e.dMin;
  if (side === 'right' ? pos.d > edgeD : pos.d < edgeD) return true;
  return y - road.surfaceHeight(pos.edge, pos.s, edgeD) > wall.heightM;
}
