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
// Every number is a [default].
import type { RouteBranch, RouteShortcut } from '../../road';
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

/** Whether the law may follow a rider onto the branch behind `zone`. */
export function lawMayTake(config: SimConfig, zone: RouteShortcut): boolean {
  const branch = branchOfZone(config, zone);
  if (!branch) return true;
  if (branch.aiTake !== null) return branch.aiTake > 0;
  return !branchHoldsGap(config, branch);
}

/**
 * The split zone a rider on `edge` at `s`, heading `dir`, is approaching or inside, when the law may
 * not take the branch behind it; null otherwise.
 */
export function lawBarredZone(config: SimConfig, edge: number, s: number, dir: number): RouteShortcut | null {
  for (const z of config.route.shortcuts) {
    if (z.edge !== edge) continue;
    const near =
      dir > 0 ? s >= z.s0 - SHORTCUT_APPROACH_M && s <= z.s1 : s <= z.s1 + SHORTCUT_APPROACH_M && s >= z.s0;
    if (near && !lawMayTake(config, z)) return z;
  }
  return null;
}

/** `d` held outside the zone: no nearer its inner edge than SHORTCUT_CLEAR_M. */
export function lineOutsideZone(zone: RouteShortcut, d: number): number {
  const { d0, d1 } = zone;
  const inner = Math.abs(d0) <= Math.abs(d1) ? d0 : d1;
  const side = Math.sign((inner === d0 ? d1 : d0) - inner);
  const limit = inner - side * SHORTCUT_CLEAR_M;
  return (d - limit) * side > 0 ? limit : d;
}
