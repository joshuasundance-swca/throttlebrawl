// sim/ai/branches: who may take a branch off the route's main path (playtest 3, round 3: "rivals and
// cops stay on the highway"; docs/content-packs.md, route `branches[].aiTake`). One rule, read by
// the rivals' shortcut roll (sim/ai index.ts) and by the cops' line (sim/cops), so they agree:
//   - a route file's `aiTake` is the share of rivals that take the branch (0 never, 1 always), and
//     it holds for every rider, whatever their nerve;
//   - with none, a branch holding a `gap` (a stretch with no road under it: the Old Seven Mile
//     Bridge's missing span) defaults to 0 for everyone but the bold (`riskTaking` at or above
//     BOLD_RISK), who follow `ai.shortcutChance` like any other branch (Pivot flies into the water);
//   - with none and no gap, `ai.shortcutChance` decides, as before this rule.
// Cops never take a branch whose `aiTake` is 0, nor one holding a gap with no `aiTake`: they stay on
// the main path (their own line keeps out of its split zone) and meet the rider where it rejoins.
// Wave C, G3 (T9.2 found the Seven Mile's field could still be pushed onto the old road): the rule
// holds when a rider is put there anyway. Approaching a split it would never take, and just past it
// where the branch still overlaps the main road, a rider's line, a dodge included, keeps off the
// side that would hand it over (`keepOff`). One that finds itself on such a branch anyway (a kick, a
// shove against the rail, a crash) heads back to the main road at the first legal point: where the
// branch still overlaps the main road, so the road's own handover (riders' crossToBranch) takes it
// back across (`wayBack`). Past that point it stops where it is and never rides the branch on: AI
// riders and cops never turn round (sim/riders/uturn.ts). sim/ai's driveRider and sim/cops' drive
// apply it last, over everything else.
// Every number is a [default].
import type { RoadPos, RouteBranch, RouteShortcut } from '../../road';
import { BIKE_HALF_WIDTH_M } from '../riders';
import type { SimConfig } from '../types';

/** How far before a shortcut's split zone a rider that takes it starts moving into it, m. */
export const SHORTCUT_APPROACH_M = 150;

/** A rider whose `riskTaking` is at least this may take a gap branch the file leaves open [default]. */
export const BOLD_RISK = 0.8;

/** A line kept this far outside a zone's inner edge by a rider that does not take it, m. */
export const SHORTCUT_CLEAR_M = 0.9;

const holds = new WeakMap<RouteBranch, boolean>();

/** Whether any road of the branch holds a `gap` feature. */
export function branchHoldsGap(config: SimConfig, branch: RouteBranch): boolean {
  let held = holds.get(branch);
  if (held === undefined) {
    held = branch.edges.some((e) => config.road.featuresOf(e, 'gap').length > 0);
    holds.set(branch, held);
  }
  return held;
}

/** The branch a split zone leads into, or null (a zone no branch claims). */
export function branchOfZone(config: SimConfig, zone: RouteShortcut): RouteBranch | null {
  return config.route.branchAt(zone.toEdge);
}

/**
 * The chance a rival with this `riskTaking` takes the branch behind `zone`, given the AI's own
 * `base` (`ai.shortcutChance`).
 */
export function rivalTakeChance(config: SimConfig, zone: RouteShortcut, risk: number, base: number): number {
  const branch = branchOfZone(config, zone);
  if (!branch) return base;
  if (branch.aiTake !== null) return branch.aiTake;
  if (branchHoldsGap(config, branch) && risk < BOLD_RISK) return 0;
  return base;
}

/**
 * Whether a rival with this `riskTaking` would never take `branch`: the route says `aiTake` 0, or
 * the branch holds a gap the route says nothing about and the rider is not bold. rivalTakeChance's
 * 0, without the AI's own `ai.shortcutChance` (a tuning, not a "never").
 */
export function rivalNeverTakes(config: SimConfig, branch: RouteBranch, risk: number): boolean {
  if (branch.aiTake !== null) return branch.aiTake <= 0;
  return branchHoldsGap(config, branch) && risk < BOLD_RISK;
}

/** Whether the law would never take `branch`: `aiTake` 0, or a gap with no `aiTake`. */
export function lawNeverTakes(config: SimConfig, branch: RouteBranch): boolean {
  if (branch.aiTake !== null) return branch.aiTake <= 0;
  return branchHoldsGap(config, branch);
}

/** Whether the law may follow a rider onto the branch behind `zone`. */
export function lawMayTake(config: SimConfig, zone: RouteShortcut): boolean {
  const branch = branchOfZone(config, zone);
  return !branch || !lawNeverTakes(config, branch);
}

/**
 * The split zone a rider on `edge` at `s`, heading `dir`, is approaching or inside, when the law may
 * not take the branch behind it; null otherwise.
 */
export function lawBarredZone(config: SimConfig, edge: number, s: number, dir: number): RouteShortcut | null {
  return neverZoneAhead(config, edge, s, dir, (b) => lawNeverTakes(config, b));
}

/**
 * The split zone a rider on `edge` at `s`, heading `dir`, is approaching (within
 * SHORTCUT_APPROACH_M) or inside, when `never` says the rider would never take the branch behind
 * it; null otherwise.
 */
export function neverZoneAhead(
  config: SimConfig,
  edge: number,
  s: number,
  dir: number,
  never: (branch: RouteBranch) => boolean,
): RouteShortcut | null {
  for (const z of config.route.shortcuts) {
    if (z.edge !== edge) continue;
    const near =
      dir > 0 ? s >= z.s0 - SHORTCUT_APPROACH_M && s <= z.s1 : s <= z.s1 + SHORTCUT_APPROACH_M && s >= z.s0;
    if (!near) continue;
    const branch = branchOfZone(config, z);
    if (branch && never(branch)) return z;
  }
  return null;
}

/** `d` held outside the zone: no nearer its inner edge than SHORTCUT_CLEAR_M. */
export function lineOutsideZone(zone: RouteShortcut, d: number): number {
  const { side, limit } = zoneEdge(zone);
  return (d - limit) * side > 0 ? limit : d;
}

/** The zone's side of the road (1 toward +d) and the limit a line keeps to outside it. */
function zoneEdge(zone: RouteShortcut): { side: number; limit: number } {
  const { d0, d1 } = zone;
  const inner = Math.abs(d0) <= Math.abs(d1) ? d0 : d1;
  const side = Math.sign((inner === d0 ? d1 : d0) - inner);
  return { side, limit: inner - side * SHORTCUT_CLEAR_M };
}

/**
 * A line's d range [lo, hi] narrowed to stay out of `zone` (lineOutsideZone's limit on the zone's
 * side), so every line picked inside it, a dodge included, keeps out. Never empty: when the limit
 * lies past the other bound, the range shrinks to that bound.
 */
export function boundsOutsideZone(zone: RouteShortcut, lo: number, hi: number): { lo: number; hi: number } {
  const { side, limit } = zoneEdge(zone);
  return side > 0
    ? { lo, hi: Math.max(lo, Math.min(hi, limit)) }
    : { lo: Math.min(hi, Math.max(lo, limit)), hi };
}

/** Whether road d lies in the zone's band, where a rider at the split is taken onto the branch. */
export function insideZone(zone: RouteShortcut, d: number): boolean {
  return d >= Math.min(zone.d0, zone.d1) && d <= Math.max(zone.d0, zone.d1);
}

/** How far past its barrier limit a rider steering hard for the edge gets in a tick, m (5 m/s across). */
const HANDOVER_REACH_M = 0.05;

/**
 * A rider (rival or cop) on a branch it would never take aims this far past the edge where the road
 * hands it back to the main road, m [default], with the steering's lateral speed cap and gain raised
 * to these [default]s, so it turns for the edge at once: the Seven Mile's turn-off overlaps the main
 * road for its first 26 m or so. The same cap and gain take a rider shoved toward such a split back
 * out of it.
 */
export const STRAY_PAST_EDGE_M = 2;
export const STRAY_LATERAL_MPS = 16;
export const STRAY_GAIN = 6;
/**
 * On the way back it brakes to this crawl and holds it, m/s [default]: a bike turns only as it rolls,
 * so one braked to a stop (or remounted at rest after a crash) would never get across.
 */
export const STRAY_RETURN_MPS = 8;

/**
 * The way back to the main road for a rider at `pos` on a branch it may not ride: the side (1 its
 * road's +d, -1 its -d) where the road would hand a rider pressed to that edge back onto the route's
 * main path here (riders' crossToBranch: the branch still overlaps the main road, just past the
 * split), or 0 where neither side can (past the first legal point). A query on a copy of the
 * position: nothing moves.
 */
export function wayBack(config: SimConfig, pos: RoadPos): -1 | 0 | 1 {
  const { route } = config;
  return handoverSide(config, pos, (e) => route.allows(e) && route.branchAt(e) === null);
}

/** The outermost lane edges of the road at `pos` (riders' barrier band before the bike's width). */
function laneBand(config: SimConfig, pos: RoadPos): { lo: number; hi: number } {
  let lo = 0;
  let hi = 0;
  for (const lane of config.road.lanesAt(pos.edge, pos.s)) {
    lo = Math.min(lo, lane.dCenterM - lane.widthM / 2);
    hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
  }
  return { lo, hi };
}

/**
 * The side of the road at `pos` (1 its +d, -1 its -d) where the road would hand a rider pressed to
 * that edge onto an edge `onto` accepts (riders' crossToBranch), or 0. A query on a copy of the
 * position: nothing moves.
 */
function handoverSide(config: SimConfig, pos: RoadPos, onto: (edge: number) => boolean): -1 | 0 | 1 {
  const { road } = config;
  if (road.branchSideAt(pos.edge, pos.s) === 0) return 0;
  const { lo, hi } = laneBand(config, pos);
  for (const side of [-1, 1] as const) {
    // Just past where a rider pressed to that edge is held (riders' barrier limit), as it gets there.
    const d =
      side > 0 ? hi - BIKE_HALF_WIDTH_M + HANDOVER_REACH_M : lo + BIKE_HALF_WIDTH_M - HANDOVER_REACH_M;
    if (road.handover({ ...pos, d }, BIKE_HALF_WIDTH_M, onto) !== null) return side;
  }
  return 0;
}

/**
 * Where a rider's line may go at `pos` so that nothing hands it onto a branch `never` says it would
 * never take: [lo, hi] narrowed, approaching such a branch's split zone, to stay out of the zone
 * (boundsOutsideZone), and, just past the split where the branch still overlaps this road, to stay
 * SHORTCUT_CLEAR_M inside the barrier limit on the branch's side (pressed there, the road would hand
 * it across). `pushed` says a shove has put the rider outside the narrowed range, so it steers back
 * in hard; `guarded` that either applies here.
 */
export function keepOff(
  config: SimConfig,
  pos: RoadPos,
  lo: number,
  hi: number,
  never: (branch: RouteBranch) => boolean,
): { lo: number; hi: number; guarded: boolean; pushed: boolean } {
  const { route } = config;
  let a = lo;
  let b = hi;
  const zone = neverZoneAhead(config, pos.edge, pos.s, pos.dir, never);
  if (zone) ({ lo: a, hi: b } = boundsOutsideZone(zone, a, b));
  const side = handoverSide(config, pos, (e) => {
    const branch = route.allows(e) ? route.branchAt(e) : null;
    return branch !== null && never(branch);
  });
  if (side !== 0) {
    const band = laneBand(config, pos);
    if (side > 0) b = Math.max(a, Math.min(b, band.hi - BIKE_HALF_WIDTH_M - SHORTCUT_CLEAR_M));
    else a = Math.min(b, Math.max(a, band.lo + BIKE_HALF_WIDTH_M + SHORTCUT_CLEAR_M));
  }
  const guarded = zone !== null || side !== 0;
  const pushed = guarded && (pos.d < a || pos.d > b || (zone !== null && insideZone(zone, pos.d)));
  return { lo: a, hi: b, guarded, pushed };
}
