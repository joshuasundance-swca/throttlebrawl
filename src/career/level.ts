// The field level per career race (playtest 3, the maintainer, 2026-10-03: "No struggle, no
// increasing difficulty"; round 1: "the field levels up every tier (tier 3 rivals ride bikes as
// good as your best)"; round 3: "Six bikes", a new one every second tier, and fights a "Gentle
// climb": about 10% easier to knock down at a region's first tier, about 20% harder by its last).
// The career works out how strong a race's field is from the node, its tier and the season, never
// from what the player owns, so not buying never makes the field easier. app/ applies the result
// (`FieldLevel`, src/core/career-race.ts) when it builds the race. DOM-free, pure.
//
// [default] numbers (docs/product-spec.md, "Rivals"; a tier's `field` block overrides each):
// - the global tier g counts the tiers of every earlier chapter (the Keys g1 to g4, then the PNW);
// - the ladder is the starting bike plus every shop bike faster than it, and the best open bike at
//   g is the fastest whose shop tier opens at or before g (from Season 2, the top of the ladder);
// - pace = share x the best open bike's top speed; the share by region tier is 0.74, 0.78, 0.82,
//   0.85, +0.02 for a tier boss and +0.04 for the region boss, +0.03 a season, at most 0.95;
// - rivals ride the best open bike from a region's third tier (every tier from Season 2), the rank
//   below it before; the cops ride the rivals' bike, capped at 0.98 of the best open top speed, so
//   a player on that bike can always outrun the law on a straight;
// - the fights climb gently ("about 10% easier ... about 20% harder"; T7.5 retuned the design's
//   0.85 to 1.25 and 1.3 to 0.7, which overshot it): aggression 0.9, 1.0, 1.1, 1.2, x1.05 for a
//   tier boss and x1.1 for the region boss, +0.1 a season, at most 1.6; the signature gap 1.1, 1.0,
//   0.9, 0.85 (so about 10% fewer moves to about 20% more), divided by the same boss factor, x0.9 a
//   season, at least 0.5; health 0.9, 1.0, 1.1, 1.2, +0.1 for the region boss, +0.05 a season, at
//   most 1.4; power 0.9, 1.0, 1.07, 1.12, +0.05 a season, at most 1.3;
// - the cops' fines x(1 + 0.08 (g - 1)).
import type { ContentRegistry } from '../content';
import type { FieldLevel } from '../core';
import type { CareerDef, CareerNode } from './defs';

/** A step-up bike: the ladder's rungs, slowest first. */
export interface LadderBike {
  /** Qualified bike id. */
  key: string;
  topSpeedMps: number;
  /** The global tier (1 = the first chapter's first) its shop first sells it at; 1 for a starting bike. */
  opensAt: number;
}

/** Per region tier (index 0 = the first; a region with more tiers keeps the last value). */
export const FIELD_DEFAULTS = {
  paceShare: [0.74, 0.78, 0.82, 0.85],
  aggression: [0.9, 1.0, 1.1, 1.2],
  signatureGap: [1.1, 1.0, 0.9, 0.85],
  health: [0.9, 1.0, 1.1, 1.2],
  power: [0.9, 1.0, 1.07, 1.12],
  /** The first region tier (index) whose rivals ride the best open bike. */
  bestBikeFromTier: 2,
  tierBoss: { paceShare: 0.02, aggression: 1.05 },
  regionBoss: { paceShare: 0.04, aggression: 1.1, health: 0.1 },
  perSeason: { paceShare: 0.03, aggression: 0.1, signatureGap: 0.9, health: 0.05, power: 0.05 },
  cap: { paceShare: 0.95, aggression: 1.6, signatureGapMin: 0.5, health: 1.4, power: 1.3 },
  copTopShare: 0.98,
  finePerTier: 0.08,
} as const;

/** The global tier of a career's tier (an index): the tiers of every earlier chapter, plus its own. */
export function globalTier(defs: readonly CareerDef[], def: CareerDef, tier: number): number {
  const i = defs.findIndex((d) => d.key === def.key);
  const before = defs.slice(0, Math.max(0, i)).reduce((sum, d) => sum + d.tiers.length, 0);
  return before + tier + 1;
}

const topOf = (reg: ContentRegistry, key: string): number | null => {
  const top = reg.bikes[key]?.handling.topSpeedMps;
  return typeof top === 'number' && Number.isFinite(top) && top > 0 ? top : null;
};

/**
 * The step-up bikes, slowest first: every career's starting bike, plus every shop bike faster than
 * the slowest of them (the novelty rides are slower, so they never count), each with the earliest
 * global tier a shop sells it at.
 */
export function bikeLadder(reg: ContentRegistry, defs: readonly CareerDef[]): LadderBike[] {
  const opens = new Map<string, number>();
  const note = (key: string, g: number) => opens.set(key, Math.min(opens.get(key) ?? g, g));
  const starters = defs.map((d) => d.startingBike).filter((k) => topOf(reg, k) !== null);
  for (const k of starters) note(k, 1);
  const floor = Math.min(...starters.map((k) => topOf(reg, k) ?? Infinity));
  for (const def of defs)
    for (const item of def.shop) {
      const top = topOf(reg, item.bike);
      if (top !== null && top > floor) note(item.bike, globalTier(defs, def, item.unlockTier));
    }
  return [...opens]
    .map(([key, opensAt]) => ({ key, opensAt, topSpeedMps: topOf(reg, key) ?? 0 }))
    .sort((a, b) => a.topSpeedMps - b.topSpeedMps || (a.key < b.key ? -1 : 1));
}

/** The index of the best ladder bike open at global tier g (from Season 2, the top), or -1. */
export function bestOpenRank(ladder: readonly LadderBike[], g: number, season = 1): number {
  if (season > 1) return ladder.length - 1;
  let best = -1;
  ladder.forEach((b, i) => {
    if (b.opensAt <= g) best = i;
  });
  return best;
}

const at = (values: readonly number[], t: number): number =>
  values[Math.min(Math.max(0, t), values.length - 1)] ?? 1;
/** Rounds away float noise (a scale to 0.001, a speed to 0.1 m/s), so equal inputs give equal numbers. */
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r1 = (x: number) => Math.round(x * 10) / 10;

/**
 * How strong the field of a career race is (`season` 1 is the first). Null when the ladder is empty
 * (no starting bike in the registry), so there is no speed to measure the pace by.
 */
export function fieldLevel(
  reg: ContentRegistry,
  defs: readonly CareerDef[],
  def: CareerDef,
  node: CareerNode,
  season = 1,
): FieldLevel | null {
  const ladder = bikeLadder(reg, defs.some((d) => d.key === def.key) ? defs : [def]);
  const g = globalTier(defs, def, node.tier);
  const rank = bestOpenRank(ladder, g, season);
  const best = ladder[rank];
  if (!best) return null;
  const D = FIELD_DEFAULTS;
  const field = def.tiers[node.tier]?.field ?? {};
  const t = node.tier;
  const s = Math.max(0, season - 1);
  const regionBoss = node.id === def.boss;
  const tierBoss = !regionBoss && def.tiers[t]?.boss === node.id;
  const share = Math.min(
    D.cap.paceShare,
    (field.paceShare ?? at(D.paceShare, t)) +
      (regionBoss ? D.regionBoss.paceShare : tierBoss ? D.tierBoss.paceShare : 0) +
      D.perSeason.paceShare * s,
  );
  const bossFactor = regionBoss ? D.regionBoss.aggression : tierBoss ? D.tierBoss.aggression : 1;
  // From Season 2 every tier's rivals ride the best bike, whatever the tier's Season 1 block says.
  const wantsBest = season > 1 || (field.rivalBike ? field.rivalBike === 'best' : t >= D.bestBikeFromTier);
  const rides = wantsBest ? best : (ladder[Math.max(0, rank - 1)] ?? best);
  return {
    paceMps: r1(share * best.topSpeedMps),
    rivalBike: rides.key,
    copBike: rides.key,
    copTopCapMps: r1(D.copTopShare * best.topSpeedMps),
    healthScale: r3(
      Math.min(
        D.cap.health,
        (field.health ?? at(D.health, t)) + (regionBoss ? D.regionBoss.health : 0) + D.perSeason.health * s,
      ),
    ),
    powerScale: r3(Math.min(D.cap.power, (field.power ?? at(D.power, t)) + D.perSeason.power * s)),
    aggressionScale: r3(
      Math.min(
        D.cap.aggression,
        (field.aggression ?? at(D.aggression, t)) * bossFactor + D.perSeason.aggression * s,
      ),
    ),
    signatureGapScale: r3(
      Math.max(
        D.cap.signatureGapMin,
        ((field.signatureGap ?? at(D.signatureGap, t)) / bossFactor) * D.perSeason.signatureGap ** s,
      ),
    ),
    fineScale: r3(1 + D.finePerTier * (g - 1)),
  };
}
