// career: progression, events across races, the shop and cash ledger, fines and the failure-mode
// policy, grudge memory (docs/architecture.md, "Ownership table"; docs/milestones/M4.md, career-1).
// Built in run W-R on the W-Q contract (#315; interview, 2026-10-02: "Network map, tiered", "The
// map"). DOM-free: app/ wires it to the race, the save and ui/.
//
// The career in one paragraph: every region has a career map (its career file): ten or so events on
// its roads across all its routes and the four event types, in tiers, ending in a boss. You start
// in the Keys, race-first, on the tutorial event, with prompts as each control becomes relevant.
// A win claims its roads (the map shows them glowing) and opens nearby ones; enough wins open the
// next tier; the boss's fall plays the next region's teaser, and free play continues. Every race
// pays (place, takedowns, near misses, style, bonuses; fines capped at the cash you have), rivals
// keep their grudges across sessions, and the garage sells three step-up bikes, regional novelty
// rides and paint, with the joke rides for the bosses.
import type { Profile } from '../save';
import type { CareerDef, CareerNode } from './defs';
import { progressOf } from './map';

export * from './defs';
export * from './map';
export * from './level';
export * from './race-log';
export * from './settle';
export * from './garage';
export * from './onboarding';
export * from './view';
export * from './show';
export * from './receipts';

/** Whether a career exists (it does from run W-R). */
export const CAREER_ENABLED = true;

/** A career has started once it owns a bike or has played a race. */
export function careerStarted(profile: Profile): boolean {
  return profile.bikes.owned.length > 0 || profile.history.length > 0;
}

/**
 * The profile at the start of a career: the first career's starting cash, every career's starting
 * bike (ridden), and each region's map with its start roads open. A started profile comes back as
 * it is.
 */
export function startCareer(defs: readonly CareerDef[], profile: Profile): Profile {
  if (careerStarted(profile) || defs.length === 0) return profile;
  const first = defs[0];
  const owned = [...new Set(defs.map((d) => d.startingBike))].sort();
  const regions = { ...profile.regions };
  for (const d of defs) regions[d.regionId] = progressOf(d, profile.regions);
  return {
    ...profile,
    cash: Math.max(profile.cash, first?.startingCash ?? 0),
    bikes: { owned, current: first?.startingBike ?? owned[0] ?? null, paint: {} },
    regions,
  };
}

/** The race-first start (docs/content-packs.md, "Career": `firstRun`): the node a new career rides first. */
export function firstRace(defs: readonly CareerDef[]): { def: CareerDef; node: CareerNode } | null {
  const def = defs[0];
  if (!def || def.firstRun !== 'race-first') return null;
  const node = def.nodes.find((n) => n.id === def.tutorialNode) ?? def.nodes[0];
  return node ? { def, node } : null;
}
