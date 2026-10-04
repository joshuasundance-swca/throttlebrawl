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
import { wrapRecord } from '../core';
import {
  DEFAULT_PROFILE,
  encodeExportCode,
  MAX_CAREER_BACKUPS,
  PROFILE_FORMAT,
  PROFILE_VERSION,
  type Profile,
} from '../save';
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
export * from './season';

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

/**
 * A fresh career, keeping the old one as a backup code (playtest 3, round 3: "a 'New career'
 * button that keeps the old save as a backup code"): `backup.code` is the old profile's export
 * code (`backupCode`). Kept from the old profile: its earlier backups (the newest
 * MAX_CAREER_BACKUPS), the failure mode and the control prompts already seen [default]; the rest
 * starts as a new career does. A profile with no career yet keeps no backup.
 */
export function newCareer(
  defs: readonly CareerDef[],
  profile: Profile,
  backup: { code: string; at: string },
): Profile {
  const kept = careerStarted(profile)
    ? [...profile.careerBackups, { code: backup.code, at: backup.at, season: profile.season }]
    : profile.careerBackups;
  return startCareer(defs, {
    ...DEFAULT_PROFILE,
    bikes: { owned: [], current: null, paint: {} },
    regions: {},
    grudges: {},
    history: [],
    paintsOwned: [],
    receipts: [],
    failureMode: profile.failureMode,
    oncePerCareer: profile.oncePerCareer.filter((f) => f.startsWith('prompt:')),
    careerBackups: kept.slice(-MAX_CAREER_BACKUPS),
  });
}

/**
 * The export code a career is kept as when a new one starts: the profile as a record of this
 * build, without its own backups, so backups never nest. Importing it restores that career.
 */
export function backupCode(profile: Profile, build: string, at: string): Promise<string> {
  const data: Profile = { ...profile, careerBackups: [] };
  return encodeExportCode({ profile: wrapRecord(PROFILE_FORMAT, PROFILE_VERSION, build, data, at) });
}
