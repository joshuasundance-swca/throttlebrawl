// sim/riders/verge.ts: riding the ground beside the road (run W-R; interview, 2026-10-02: "Anywhere
// with ground"; off-road as "a ground band beside most roads (dirt, sand, grass, gravel, kerbs;
// water, ferns and kerbs are the real edges; some fences smash)", and "remove the invisible wall
// where ground is drawn"). The riding model (sim/riders/index.ts) asks here:
// - where a rider may go across the road (sim/ground's `rideLimits`, widened where a fence is
//   broken), and what each band's outer edge does to a rider who reaches it [default]:
//   - `soft`: the ground just runs on; the rider runs out of room and slows a little, no event;
//   - `brush`: ferns, salal or bushes; a soft stop that slows hard, and a wobble on a real hit;
//   - `water`: the sea or a swamp; a splash that slows hard, and a wobble when it splashes;
//   - `hard` and `rail`: the M1 barrier rule (a scrape, a wobble, a crash from the crash speed);
//   - `fence`: a hit at `riders.fenceSmashMps` or more smashes it (the rider bursts through into
//     the yard behind, losing FENCE_SMASH_LOSS of its speed, and wobbles); slower, a scrape and a
//     wobble that never crash;
// - the ground under the wheels and its grip and speed (`surfaceFeel`), only with the switch on,
//   so a race with it off rides exactly as before. On a road's own lanes (a graded gravel or dirt
//   road: the Logging Spur, a marked dirt shortcut) only the grip applies [default]: a graded road
//   is fast but loose, and the speed cost is the loose ground beside it, so a shortcut stays one;
// - `offRoadOf`, whether a rider is on loose ground: the cops' heat meter reads it (leaving the road
//   where no cop is watching cools the heat, interview round 4: "lose them by riding clean or going
//   off-road").
// Pure +-*/ and plain data, under the sim's determinism rules.
import type { GroundSurface, VergeEdge } from '../../core';
import { groundUnder, offRoadOn, rideLimits, surfaceFeel, type RideLimits } from '../ground';
import type { SimConfig } from '../types';
import { systemState, type Mover, type World } from '../world';

/** A stretch of fence a rider smashed, by edge, side (-1 the left, +1 the right) and s range. */
export interface BrokenFence {
  edge: number;
  side: 1 | -1;
  s0: number;
  s1: number;
}

/** The race's off-road state: the fences smashed so far, whose gaps stay open for every rider. */
export interface VergeState {
  brokenFences: BrokenFence[];
}

export function vergeState(world: World): VergeState {
  return systemState<VergeState>(world, 'riders.verge', () => ({ brokenFences: [] }));
}

/** How long a stretch of fence one smash breaks, m (half each way of the hit). [default] */
export const FENCE_GAP_M = 8;
/** How far the ground runs on past a broken fence before it stops the rider (softly), m. [default] */
export const FENCE_YARD_M = 6;
/** The share of its speed a rider loses bursting through a fence. [default] */
export const FENCE_SMASH_LOSS = 0.3;
/** Drag while ploughing along behind a fence line, breaking it as it goes, m/s². [default] */
export const FENCE_PLOUGH_DRAG = 6;
/**
 * A rider this far past a fence line has come at it from behind (the yard of a smash, carried over
 * a junction): the fence breaks where it is instead of walling it back across. [default]
 */
const BEHIND_FENCE_M = 1;
/**
 * The drag on a rider held against each kind of edge, m/s² [default]: the M1 scrape (4) for walls,
 * rails and fences; a little for soft ground running out; hard for ferns and for the water.
 */
export const EDGE_DRAG: Readonly<Record<VergeEdge, number>> = {
  soft: 2.5,
  brush: 14,
  water: 10,
  hard: 4,
  fence: 4,
  rail: 4,
};
/** The speed into the ferns or the water from which a new contact wobbles (and emits), m/s. [default] */
export const EDGE_WOBBLE_MPS: Readonly<Partial<Record<VergeEdge, number>>> = { brush: 2, water: 1 };

/** Loose ground: a rider on it has left the road (a verge band or a marked dirt shortcut). */
export const LOOSE_GROUND: ReadonlySet<GroundSurface> = new Set<GroundSurface>([
  'dirt',
  'gravel',
  'sand',
  'grass',
]);

/** The limits a rider's centre may reach at (edge, s), with the race's broken fences opened up. */
export function limitsAt(
  config: SimConfig,
  params: Readonly<Record<string, number>>,
  fences: readonly BrokenFence[],
  edge: number,
  s: number,
  halfWidthM: number,
): RideLimits {
  const lim = rideLimits(config.road, params, edge, s, halfWidthM);
  if (fences.length === 0 || (lim.loEdge !== 'fence' && lim.hiEdge !== 'fence')) return lim;
  for (const f of fences) {
    if (f.edge !== edge || s < f.s0 || s > f.s1) continue;
    if (f.side < 0 && lim.loEdge === 'fence') {
      lim.lo -= FENCE_YARD_M;
      lim.loEdge = 'soft';
      lim.loBandM += FENCE_YARD_M;
    } else if (f.side > 0 && lim.hiEdge === 'fence') {
      lim.hi += FENCE_YARD_M;
      lim.hiEdge = 'soft';
      lim.hiBandM += FENCE_YARD_M;
    }
  }
  return lim;
}

/** Breaks the fence at (edge, s) on a side: a new stretch, or one grown to cover s. */
export function breakFence(fences: BrokenFence[], edge: number, side: 1 | -1, s: number): BrokenFence {
  const half = FENCE_GAP_M / 2;
  for (const f of fences) {
    if (f.edge !== edge || f.side !== side || s < f.s0 - half || s > f.s1 + half) continue;
    if (s - half < f.s0) f.s0 = s - half;
    if (s + half > f.s1) f.s1 = s + half;
    return f;
  }
  const f = { edge, side, s0: s - half, s1: s + half };
  fences.push(f);
  return f;
}

/**
 * A rider out in a broken fence's yard keeps breaking it as it rides along (the gap follows it, so
 * the fence never walls it back across from behind) and ploughs, slower. Returns true when it is
 * in a yard. `fenceD` is where the fence line stands on that side (the band's outer edge).
 */
export function ploughYard(
  fences: BrokenFence[],
  edge: number,
  s: number,
  d: number,
  fenceLo: number | null,
  fenceHi: number | null,
): boolean {
  let side: 1 | -1 | 0 = 0;
  if (fenceHi !== null && d > fenceHi) side = 1;
  else if (fenceLo !== null && d < fenceLo) side = -1;
  if (side === 0) return false;
  for (const f of fences) {
    if (f.edge !== edge || f.side !== side || s < f.s0 || s > f.s1) continue;
    breakFence(fences, edge, side, s);
    return true;
  }
  return false;
}

/** Whether a rider at this distance past a fence line came at it from behind. */
export const behindFence = (pastM: number): boolean => pastM > BEHIND_FENCE_M;

/**
 * The ground under a rider's wheels for its grip and speed: what is under it, or, out in a broken
 * fence's yard (past the band), that band's surface.
 */
export function wheelGround(config: SimConfig, m: Mover): GroundSurface | null {
  const pos = m.pos;
  const g = groundUnder(config.road, pos.edge, pos.s, pos.d, 0);
  if (g !== null) return g;
  const v = config.road.vergeAt(pos.edge, pos.s, pos.d < 0 ? 'left' : 'right');
  return v.widthM > 0 ? v.surface : null;
}

/** No change: the grip and speed scales off the switch, and in the air. */
const NO_FEEL = { grip: 1, speed: 1 } as const;

/** Whether (edge, s, d) lies on one of the road's own lanes (shoulders included). */
function onLanes(config: SimConfig, edge: number, s: number, d: number): boolean {
  for (const lane of config.road.lanesAt(edge, s)) {
    const half = lane.widthM / 2;
    if (d >= lane.dCenterM - half && d <= lane.dCenterM + half) return true;
  }
  return false;
}

/**
 * The grip and speed scales for a grounded rider, with the switch on: its ground's, except that on
 * the road's own lanes only the grip applies (a graded road keeps its speed); else 1 and 1.
 */
export function groundFeel(
  config: SimConfig,
  params: Readonly<Record<string, number>>,
  m: Mover,
): { grip: number; speed: number } {
  if (!offRoadOn(params)) return NO_FEEL;
  const feel = surfaceFeel(params, wheelGround(config, m));
  return onLanes(config, m.pos.edge, m.pos.s, m.pos.d) ? { grip: feel.grip, speed: 1 } : feel;
}

/**
 * Whether a rider has left the road: grounded (or in the air) over loose ground, a verge band of
 * dirt, gravel, sand or grass, or a marked dirt shortcut. Not the paved shoulder, not a city kerb.
 * The cops' heat meter reads it (interview, 2026-10-02).
 */
export function offRoadOf(config: SimConfig, m: Mover): boolean {
  if (m.kind !== 'rider' || (m.mode !== 'Road' && m.mode !== 'Airborne')) return false;
  const g = wheelGround(config, m);
  return g !== null && LOOSE_GROUND.has(g);
}
