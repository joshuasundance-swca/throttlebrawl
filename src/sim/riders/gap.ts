// sim/riders/gap.ts: road with no surface, and the edge of the road a rider can fly over (playtest 3:
// the Old Seven Mile Bridge's missing span, "Jumps could let you get from one to the other"; round 3,
// "the real 80 m missing span is the big jump (a miss = splash, respawn on the highway)"; 2026-10-06:
// "it would also be cool if when airborne it was possible to go over and across barriers, possibly
// resulting in a crash like falling in the water or whatever"). docs/architecture.md, "Jumps, ramps
// and airtime" and "Over the barrier".
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
// - `overBarrier`, each airborne tick before the barrier rule (the maintainer, 2026-10-06: "consistent
//   physics and gameplay is important here so players know what to expect"): a barrier holds a rider
//   only below its top (road/beyond.ts `edgeTopAt`: every rail and wall by its `heightM`, a building
//   front never), and what lies past it decides (`pastAt`). Another road under the rider (the old
//   Seven Mile Bridge beside the new one; RoadNetwork.surfaceUnder) takes it over, and the landing
//   rules judge it there; ground comes down at the band's edge (the sim has no ground past it), and
//   the landing rules judge it there; water or a drop is `overFall`'s;
// - `overFall`, each airborne tick out past the edge over water or a drop: more than the kill depth
//   below the deck at the crossing, or down at the water level, it goes overboard (a `crash` with
//   `cause: 'over'`, `overboard: true`, `past`, `dropM` and `high`), which sim/tumble takes into the
//   water (or to the drop's floor), the splash penalty and the respawn on the road at the crossing.
// Gaps exist only where road data puts them, and the barrier rule is as before for a rider below a
// barrier's top, so a race where nobody leaves the road rides exactly as before: the per-rider state
// (`over`) is written only when a rider goes over, and no random draw is taken.
import { atan2, cos, sin, wrapAngle, type TuningParamDecl } from '../../core';
import {
  edgeTopAt,
  gapAt,
  gapParams,
  GAP_DEFAULTS,
  pastAt,
  waterLevelOf,
  type BakedFeature,
  type Past,
  type RoadNetwork,
  type RoadPos,
} from '../../road';
import type { RideLimits } from '../ground';
import type { SimConfig } from '../types';
import { emit, type Mover, type World } from '../world';
import type { RiderState } from './index';

/** The tuning key: a fall past the road's edge deeper than this is a high one. */
export const HIGH_DROP_KEY = 'riders.highDropM';

/** The over-the-barrier rule's tuning (a gap keeps its numbers in its own params, `gapParams`). */
export const GAP_TUNING: readonly TuningParamDecl[] = [
  {
    // The maintainer, 2026-10-06 [decided] "(a)": the same physics everywhere, a high drop shown as a
    // clean cut-away with no gag; a lower one into water is the splash. The sim's outcome (the penalty
    // and the respawn) is the same for both; this only says which one it is, for the presentation.
    // 25 m [default].
    id: HIGH_DROP_KEY,
    group: 'crashes',
    label: 'A fall past the road is high from',
    default: 25,
    min: 5,
    max: 100,
    step: 1,
    unit: 'm',
    affectsSim: true,
  },
];

/** Whether a fall of `dropM` (the deck at the crossing down to the water or the drop's floor) is high. */
export function highDrop(params: Readonly<Record<string, number>>, dropM: number): boolean {
  return dropM > (params[HIGH_DROP_KEY] ?? 25);
}

/** Where an airborne rider went out past its road's edge, and what lies there. Plain data. */
export interface OverMark {
  /** The crossing: the edge, s and the rider's limit at the band's outer edge it flew over. */
  edge: number;
  s: number;
  d: number;
  /** The side it went out on, in that edge's frame (+1 toward +d). */
  side: 1 | -1;
  past: Past;
  /** World y of the deck at the crossing, and of the water or the drop's floor past it. */
  deckY: number;
  floorY: number;
}

/**
 * The per-rider state: who is out past its road's edge in the air, by entity id. Absent until a rider
 * first goes over, so a race where nobody does hashes as before.
 */
export interface GapState {
  over?: Record<number, OverMark>;
  /**
   * The tick a rider was last handed over through the air onto another road past its edge, by entity
   * id: sim/race's shortcut stamp reads it (a road reached by air is not a shortcut ridden). Absent
   * until a rider first is.
   */
  hop?: Record<number, number>;
}

export function newGapState(): GapState {
  return {};
}

/** The rider's mark while it is out past its road's edge in the air, or null. */
export function overMarkOf(st: GapState, id: number): OverMark | null {
  return st.over?.[id] ?? null;
}

/** Forgets a rider's mark (it landed, crashed, or came back over its road). */
export function clearOver(st: GapState, id: number): void {
  if (st.over && Object.hasOwn(st.over, id)) delete st.over[id];
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

/**
 * How far above or below its own road's plane another road may lie and still be found under a rider
 * out past the edge, m: any road the network has (RoadNetwork.surfaceUnder's height window).
 */
const ROAD_UNDER_SEARCH_M = 400;
/**
 * A road under the rider takes it over while the rider is above that road's surface, or at most this
 * far below it (one tick's fall at a 20 m drop's speed): lower, it has fallen past that deck's edge.
 */
const ROAD_UNDER_TOL_M = 0.35;
/** The rider's limit counts as the band's outer edge (less half a bike) within this, m. */
const EDGE_EPS_M = 1e-6;

/**
 * Hands an airborne rider over onto another road under it (`to`, from RoadNetwork.surfaceUnder),
 * keeping its world position and its heading in the world, as the split handover does.
 */
function handTo(road: RoadNetwork, m: Mover, to: RoadPos): void {
  const a = road.frameAt(m.pos.edge, m.pos.s);
  const b = road.frameAt(to.edge, to.s);
  // A heading's world angle is the road's travel direction's, atan2(z, x), plus the yaw toward the
  // rider's right (sim/tumble's forward vector: (cos·tx − sin·tz, cos·tz + sin·tx)).
  const from = atan2(a.tz * m.pos.dir, a.tx * m.pos.dir);
  const onto = atan2(b.tz * to.dir, b.tx * to.dir);
  m.yaw = wrapAngle(m.yaw + from - onto);
  m.pos.edge = to.edge;
  m.pos.s = to.s;
  m.pos.d = to.d;
  m.pos.dir = to.dir;
}

/**
 * The over-the-barrier rule, each airborne tick before the barrier rule, with the rider's absolute
 * height `y` this tick and its riding limits (`riderLimits`; `halfWidthM` is the bike's half-width
 * they keep inside the band's edge). Returns:
 * - `barrier` when the barrier rule decides as ever: inside the limits; below the top of what stands
 *   at the edge; a ground edge; a split's guide, a fence's yard or a bridge taper. Also once a rider
 *   that went over is handed over onto another road the race allows (inside it, the rule does
 *   nothing), or comes down past the limit (it is put back at the limit, where the landing rules
 *   judge it: on its own deck's edge, or on ground past the edge, which the sim does not have);
 * - `deck` when it is above what stands at the edge and its centre is still over its own deck: no
 *   barrier holds it;
 * - `past` when its centre is out past the edge over water or a drop, or over ground it has not come
 *   down to yet: nothing of its road is under it, so it never lands on its road's plane out there.
 */
export function overBarrier(
  world: World,
  config: SimConfig,
  st: RiderState,
  m: Mover,
  y: number,
  limits: (edge: number, s: number, d: number) => RideLimits,
  halfWidthM: number,
): 'barrier' | 'deck' | 'past' {
  const road = config.road;
  const pos = m.pos;
  const lim = limits(pos.edge, pos.s, pos.d);
  if (pos.d >= lim.lo && pos.d <= lim.hi) {
    clearOver(st, m.id);
    return 'barrier';
  }
  const side: 1 | -1 = pos.d > lim.hi ? 1 : -1;
  const limit = side > 0 ? lim.hi : lim.lo;
  let mark = overMarkOf(st, m.id);
  if (!mark) {
    const vside = side > 0 ? 'right' : 'left';
    const v = road.vergeAt(pos.edge, pos.s, vside);
    const atBand = v.taper !== true && Math.abs(limit + side * halfWidthM - v.dOuter) <= EDGE_EPS_M;
    if (!atBand) return 'barrier';
    const top = edgeTopAt(road, pos.edge, pos.s, vside);
    const deckY = road.surfaceHeight(pos.edge, pos.s, v.dOuter);
    if (top === null || !(y - deckY > top)) return 'barrier';
    const past = pastAt(road, pos.edge, pos.s, vside);
    const floorY = past === 'ground' ? deckY : waterLevelOf(road);
    mark = { edge: pos.edge, s: pos.s, d: limit, side, past, deckY, floorY };
    (st.over ??= {})[m.id] = mark;
  }
  // Its centre still over its own deck (between the limit and the edge's line, where the barrier
  // stands): the deck is under it. Coming down there, it lands at the limit, beside the barrier it
  // cleared, and the landing rules judge it.
  const overDeck = side > 0 ? pos.d <= limit + halfWidthM : pos.d >= limit - halfWidthM;
  if (overDeck) {
    if (y > road.surfaceHeight(pos.edge, pos.s, pos.d)) return 'deck';
    pos.d = limit;
    clearOver(st, m.id);
    return 'barrier';
  }
  // Another road under it: taken once its centre is inside that road's own riding limits (a bike's
  // half-width in from the deck's edge, so it is not put down on the edge's line), and while it is
  // still above that deck.
  const under = road.surfaceUnder(pos, ROAD_UNDER_SEARCH_M, (e) => config.route.allows(e));
  const there = under ? limits(under.edge, under.s, under.d) : null;
  if (
    under &&
    there &&
    under.d >= there.lo &&
    under.d <= there.hi &&
    y >= road.surfaceHeight(under.edge, under.s, under.d) - ROAD_UNDER_TOL_M
  ) {
    handTo(road, m, under);
    clearOver(st, m.id);
    (st.hop ??= {})[m.id] = world.tick;
    return 'barrier';
  }
  if (mark.past === 'ground' && y <= road.surfaceHeight(pos.edge, pos.s, limit)) {
    // Down to the ground's height past the edge: the sim has no ground there, so it comes down at the
    // band's edge, and the landing rules judge it (its heading and speed as they are).
    pos.d = limit;
    clearOver(st, m.id);
    return 'barrier';
  }
  return 'past';
}

/**
 * A rider out past its road's edge over water or a drop, each airborne tick after it moved (y is its
 * absolute height): more than the kill depth (a gap's, 1.5 m) below the deck at the crossing, or down
 * at the water level, it goes overboard. The crash carries what lies past (`past`), the drop's height
 * (`dropM`: the deck at the crossing down to the water or the drop's floor), whether it is a high one
 * (`high`, over `riders.highDropM`), the floor's height (`floorY`) and the crossing (`crossEdge`,
 * `crossS`, `crossD`), where sim/tumble wakes it after the splash penalty.
 */
export function overFall(world: World, _config: SimConfig, st: RiderState, m: Mover, y: number): void {
  const mark = overMarkOf(st, m.id);
  if (!mark || mark.past === 'ground') return;
  const depth = mark.deckY - y;
  if (depth <= GAP_DEFAULTS.killDepthM && y > mark.floorY) return;
  const dropM = Math.max(0, mark.deckY - mark.floorY);
  clearOver(st, m.id);
  emit(world, 'crash', m.id, {
    cause: 'over',
    overboard: true,
    past: mark.past,
    dropM,
    high: highDrop(world.params, dropM),
    floorY: mark.floorY,
    side: mark.side,
    speed: m.speed,
    yaw: m.yaw,
    depthM: depth,
    crossEdge: mark.edge,
    crossS: mark.s,
    crossD: mark.d,
  });
}
