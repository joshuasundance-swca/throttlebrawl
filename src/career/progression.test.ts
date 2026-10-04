import { describe, expect, it } from 'vitest';
import type { ContentRegistry } from '../content';
import { DEFAULT_PROFILE, type EventResult, type Profile, type RegionProgress } from '../save';
import {
  applyWin,
  bikeLadder,
  buyBike,
  fieldLevel,
  garageBikes,
  garagePaints,
  globalTier,
  lockReason,
  nodeState,
  progressOf,
  regionLockReason,
  regionOpen,
  rideRefusal,
  startCareer,
  suggestedNode,
  tierOpen,
  type CareerDef,
  type CareerNode,
  type CareerTier,
} from './index';

// Playtest 3's progression (the maintainer, 2026-10-03: "I won a few easy races and then bought the
// fastest bike. No struggle, no increasing difficulty"; round 1: "each tier unlocks the next bike
// class, and the boss of each tier must be beaten first", "the field levels up every tier (tier 3
// rivals ride bikes as good as your best)"; round 3: "Six bikes", regions "In order", fights a
// "Gentle climb"). The rules on hand-made maps, with the design's numbers as the oracle
// (docs/product-spec.md, "Rivals" and "Career"). The real packs are checked in
// tests/sim/career-content.test.ts.

const bike = (id: string, top: number, tags: string[] = []) => ({
  type: 'bike',
  id,
  name: id,
  class: 'sport',
  tags,
  handling: { topSpeedMps: top, accelMps2: 5, brakeMps2: 9, steerRateMps: 5, massKg: 180 },
  engineSound: { preset: 'single-thump' },
});
const REG = {
  bikes: {
    'base:rustbucket-400': bike('rustbucket-400', 44.7),
    'base:sport-600': bike('sport-600', 50.1),
    'base:streetfighter-750': bike('streetfighter-750', 55.9),
    'base:grand-tourer-1100': bike('grand-tourer-1100', 61.0),
    'base:supersport-900': bike('supersport-900', 66.0),
    'base:superbike-1000': bike('superbike-1000', 71.5),
    'base:moped': bike('moped', 22.4, ['novelty']),
    'base:dirt-bike': bike('dirt-bike', 31.3, ['novelty']),
    'base:chopper': bike('chopper', 44.7, ['novelty']),
  },
  riders: {},
  events: {},
} as unknown as ContentRegistry;

const node = (id: string, tier: number, over: Partial<CareerNode> = {}): CareerNode => ({
  id,
  event: `base:ev-${id}`,
  length: null,
  tier,
  road: `road-${id}`,
  s: 10,
  requires: [],
  opens: [],
  claims: [],
  ...over,
});

interface RegionSpec {
  id: string;
  name: string;
  chapter: number;
  tiers: readonly string[];
  bosses: readonly string[];
  shop: readonly { bike: string; priceCash: number; unlockTier: number }[];
  paints?: CareerDef['paints'];
}

/** A region of 4 tiers, each 3 regular events (a, b, c) and a tier boss; the last tier's is the region's. */
function region(r: RegionSpec, tierOver: Partial<CareerTier>[] = []): CareerDef {
  const tiers: CareerTier[] = r.tiers.map((name, i) => ({
    id: `t${i + 1}`,
    name,
    requiredWins: 2,
    boss: `${r.id}-t${i + 1}-boss`,
    bossName: r.bosses[i] ?? '',
    ...tierOver[i],
  }));
  const nodes = tiers.flatMap((_, i) => [
    node(`${r.id}-t${i + 1}-a`, i),
    node(`${r.id}-t${i + 1}-b`, i),
    node(`${r.id}-t${i + 1}-c`, i),
    node(`${r.id}-t${i + 1}-boss`, i),
  ]);
  const last = tiers.at(-1);
  return {
    key: `base:${r.id}-circuit`,
    pack: 'base',
    name: r.name,
    regionKey: `base:${r.id}`,
    regionId: r.id,
    regionName: r.name,
    chapter: r.chapter,
    startingCash: 500,
    startingBike: 'base:rustbucket-400',
    tutorialNode: null,
    firstRun: 'race-first',
    tiers,
    nodes,
    boss: last?.boss ?? '',
    bossName: last?.bossName ?? '',
    secrets: [],
    shop: r.shop,
    paints: r.paints ?? [],
    unlocks: [],
    ending: { lines: [], next: null, freePlayAfter: true },
    startRoads: nodes.filter((n) => n.tier === 0).map((n) => n.road),
  };
}

const KEYS_SPEC: RegionSpec = {
  id: 'keys',
  name: 'The Keys',
  chapter: 1,
  tiers: ['Tourist Season', 'Hurricane Season', 'Off Season', 'The Drawbridge'],
  bosses: ['Kevin from Accounting', 'Chad Speedwell', 'Dial-Up', 'Mother Rust'],
  shop: [
    { bike: 'base:rustbucket-400', priceCash: 0, unlockTier: 0 },
    { bike: 'base:moped', priceCash: 1500, unlockTier: 0 },
    { bike: 'base:sport-600', priceCash: 9750, unlockTier: 1 },
    { bike: 'base:streetfighter-750', priceCash: 16750, unlockTier: 3 },
  ],
  paints: [
    { id: 'flamingo-pink', name: 'Flamingo Pink', hex: '#f28fb1', priceCash: 300, unlockTier: 0 },
    {
      id: 'hurricane-chrome',
      name: 'Hurricane Chrome',
      hex: '#c0c4c8',
      priceCash: 15000,
      unlockTier: 0,
      unlockSeason: 2,
    },
  ],
};
const PNW_SPEC: RegionSpec = {
  id: 'pnw',
  name: 'The Pacific Northwest',
  chapter: 2,
  tiers: ['Light Drizzle', 'Steady Rain', 'Atmospheric River', 'The Big Cut'],
  bosses: ['Juniper', 'Kevin from Accounting', 'Deacon Vane', 'Old Growth'],
  shop: [
    { bike: 'base:dirt-bike', priceCash: 6000, unlockTier: 0 },
    { bike: 'base:grand-tourer-1100', priceCash: 25500, unlockTier: 1 },
    { bike: 'base:supersport-900', priceCash: 31000, unlockTier: 3 },
  ],
};
const SF_SPEC: RegionSpec = {
  id: 'sf',
  name: 'San Francisco',
  chapter: 3,
  tiers: ['Seed Round', 'Series A', 'Series B', 'The Down Round'],
  bosses: ['Chad Speedwell', 'Dial-Up', 'Gus', 'Pivot'],
  shop: [
    { bike: 'base:chopper', priceCash: 15000, unlockTier: 0 },
    { bike: 'base:superbike-1000', priceCash: 48750, unlockTier: 1 },
  ],
};
const KEYS = region(KEYS_SPEC);
const PNW = region(PNW_SPEC);
const SF = region(SF_SPEC);
const DEFS = [KEYS, PNW, SF];

const nodeById = (def: CareerDef, id: string): CareerNode => {
  const n = def.nodes.find((x) => x.id === id);
  if (!n) throw new Error(id);
  return n;
};
const fresh = (): Profile => startCareer(DEFS, { ...DEFAULT_PROFILE });
const winAll = (def: CareerDef, p: RegionProgress, ids: string[]): RegionProgress =>
  ids.reduce((acc, id) => applyWin(def, acc, nodeById(def, id)).progress, p);

describe('tier bosses: the boss of each tier must be beaten first', () => {
  it("a tier's boss opens after its tier's wins, and only the boss opens the next tier", () => {
    let p = progressOf(KEYS, fresh().regions);
    const boss = nodeById(KEYS, 'keys-t1-boss');
    const t2 = nodeById(KEYS, 'keys-t2-a');
    expect(nodeState(KEYS, p, boss)).toBe('locked');
    expect(lockReason(KEYS, p, boss)).toBe('Win 2 more in Tourist Season.');
    p = winAll(KEYS, p, ['keys-t1-a']);
    expect(lockReason(KEYS, p, boss)).toBe('Win 1 more in Tourist Season.');
    expect(lockReason(KEYS, p, t2)).toBe('Win 1 more in Tourist Season, then beat Kevin from Accounting.');
    p = winAll(KEYS, p, ['keys-t1-b']);
    expect(nodeState(KEYS, p, boss)).toBe('open');
    // Every regular event of the tier won is still not enough: the boss holds the gate.
    p = winAll(KEYS, p, ['keys-t1-c']);
    expect(tierOpen(KEYS, p, 1)).toBe(false);
    expect(nodeState(KEYS, p, t2)).toBe('locked');
    expect(lockReason(KEYS, p, t2)).toBe('Beat Kevin from Accounting in Tourist Season.');
    const w = applyWin(KEYS, p, boss);
    expect(w.tiersOpened).toEqual(['Hurricane Season']);
    expect(w.progress.tier).toBe(2);
    expect(nodeState(KEYS, w.progress, t2)).toBe('open');
  });

  it('the suggested race is the lowest tier first, its regular events before its boss', () => {
    let p = progressOf(KEYS, fresh().regions);
    p = winAll(KEYS, p, ['keys-t1-a', 'keys-t1-b']);
    expect(suggestedNode(KEYS, p)?.id).toBe('keys-t1-c');
    p = winAll(KEYS, p, ['keys-t1-c']);
    expect(suggestedNode(KEYS, p)?.id).toBe('keys-t1-boss');
  });

  it("the region boss is the last tier's boss, and its fall opens the whole map", () => {
    let p = progressOf(KEYS, fresh().regions);
    for (let t = 1; t <= 4; t++) p = winAll(KEYS, p, [`keys-t${t}-a`, `keys-t${t}-b`, `keys-t${t}-boss`]);
    expect(p.finaleBeaten).toBe(true);
    expect(KEYS.nodes.every((n) => nodeState(KEYS, p, n) !== 'locked')).toBe(true);
  });
});

describe('the high-water tier: no save ever loses an open tier', () => {
  it('a save that reached tier 3 keeps tiers 1 to 3 open without a boss win', () => {
    const old: RegionProgress = { ...progressOf(KEYS, fresh().regions), tier: 3 };
    expect([0, 1, 2, 3].map((t) => tierOpen(KEYS, old, t))).toEqual([true, true, true, false]);
    expect(nodeState(KEYS, old, nodeById(KEYS, 'keys-t3-a'))).toBe('open');
    // A win never lowers it.
    expect(applyWin(KEYS, old, nodeById(KEYS, 'keys-t1-a')).progress.tier).toBe(3);
  });
});

describe('regions in order: the Keys, then the PNW when its boss falls, then SF', () => {
  it('a fresh career opens only the first chapter, and says which boss opens the next', () => {
    const p = fresh();
    expect(DEFS.map((d) => regionOpen(DEFS, p, d))).toEqual([true, false, false]);
    expect(regionLockReason(DEFS, p, KEYS)).toBeNull();
    expect(regionLockReason(DEFS, p, PNW)).toBe('Opens when Mother Rust falls.');
    expect(regionLockReason(DEFS, p, SF)).toBe('Opens when Old Growth falls.');
  });

  it("a region opens when the previous chapter's boss falls", () => {
    const p = fresh();
    const keys = { ...progressOf(KEYS, p.regions), finaleBeaten: true };
    const after: Profile = { ...p, regions: { ...p.regions, keys } };
    expect(DEFS.map((d) => regionOpen(DEFS, after, d))).toEqual([true, true, false]);
  });

  it('places already raced this season stay open', () => {
    const p = fresh();
    const won: Profile = {
      ...p,
      regions: { ...p.regions, pnw: { ...progressOf(PNW, p.regions), won: ['pnw-t1-a'] } },
    };
    expect(regionOpen(DEFS, won, PNW)).toBe(true);
    const race = (season?: number): EventResult => ({
      event: 'base:ev-sf-t1-a',
      node: 'sf-t1-a',
      region: 'sf',
      place: 5,
      outcome: 'lost',
      cash: 0,
      takedowns: 0,
      build: 'test',
      at: 'now',
      ...(season ? { season } : {}),
    });
    expect(regionOpen(DEFS, { ...p, history: [race()] }, SF)).toBe(true);
    // A free-play race is not a career race there; a past season's race is not this season's.
    expect(regionOpen(DEFS, { ...p, history: [{ ...race(), node: null }] }, SF)).toBe(false);
    expect(regionOpen(DEFS, { ...p, season: 2, history: [race()] }, SF)).toBe(false);
    expect(regionOpen(DEFS, { ...p, season: 2, history: [race(2)] }, SF)).toBe(true);
  });

  // The wave A live check rode the PNW's and SF's first events on a fresh career with the Keys boss
  // standing, and one race there opened that region. The gate is in the ride path, so no button can
  // start a race in a shut region (nodeState alone is per region).
  describe('the ride gate: no button starts a race in a shut region', () => {
    const first = (def: CareerDef) => nodeById(def, `${def.regionId}-t1-a`);

    it("a fresh career refuses the PNW's and SF's first events and says whose fall opens them", () => {
      const p = fresh();
      expect(nodeState(PNW, progressOf(PNW, p.regions), first(PNW))).toBe('open');
      expect(rideRefusal(DEFS, p, PNW, first(PNW))).toBe('Opens when Mother Rust falls.');
      expect(rideRefusal(DEFS, p, SF, first(SF))).toBe('Opens when Old Growth falls.');
      expect(rideRefusal(DEFS, p, KEYS, first(KEYS))).toBeNull();
    });

    it('refusing leaves the region shut: the gate does not depend on a race having been played', () => {
      const p = fresh();
      expect(rideRefusal(DEFS, p, PNW, first(PNW))).not.toBeNull();
      expect(regionOpen(DEFS, p, PNW)).toBe(false);
    });

    it("the Keys boss's fall opens the PNW, not SF; the PNW boss's fall opens SF", () => {
      const p = fresh();
      const keys = { ...progressOf(KEYS, p.regions), finaleBeaten: true };
      const afterKeys: Profile = { ...p, regions: { ...p.regions, keys } };
      expect(rideRefusal(DEFS, afterKeys, PNW, first(PNW))).toBeNull();
      expect(rideRefusal(DEFS, afterKeys, SF, first(SF))).toBe('Opens when Old Growth falls.');
      const pnw = { ...progressOf(PNW, p.regions), finaleBeaten: true };
      const afterPnw: Profile = { ...afterKeys, regions: { ...afterKeys.regions, pnw } };
      expect(rideRefusal(DEFS, afterPnw, SF, first(SF))).toBeNull();
    });

    it('an open region still refuses its locked nodes, and a won node replays', () => {
      const p = fresh();
      const boss = nodeById(KEYS, 'keys-t1-boss');
      expect(rideRefusal(DEFS, p, KEYS, boss)).toBe('Win 2 more in Tourist Season.');
      expect(rideRefusal(DEFS, p, KEYS, nodeById(KEYS, 'keys-t2-a'))).toMatch(/Tourist Season/);
      const keys = winAll(KEYS, progressOf(KEYS, p.regions), ['keys-t1-a', 'keys-t1-b']);
      const won: Profile = { ...p, regions: { ...p.regions, keys } };
      expect(rideRefusal(DEFS, won, KEYS, boss)).toBeNull();
      expect(rideRefusal(DEFS, won, KEYS, nodeById(KEYS, 'keys-t1-a'))).toBeNull();
    });

    it('places already raced this season stay rideable, in a shut region too', () => {
      const p = fresh();
      const pnw = { ...progressOf(PNW, p.regions), won: ['pnw-t1-a'] };
      const raced: Profile = { ...p, regions: { ...p.regions, pnw } };
      expect(rideRefusal(DEFS, raced, PNW, first(PNW))).toBeNull();
      expect(rideRefusal(DEFS, raced, PNW, nodeById(PNW, 'pnw-t1-b'))).toBeNull();
    });
  });
});

describe('the garage: a new bike class every second tier, sold once the gate is passed', () => {
  it("a step-up bike is locked until its tier opens, saying whose fall opens it, then it's for sale", () => {
    let p = { ...fresh(), cash: 10000 };
    const sport = () => garageBikes(REG, DEFS, p).find((b) => b.key === 'base:sport-600');
    expect(sport()).toMatchObject({
      state: 'locked',
      priceCash: 9750,
      reason: 'Opens when you beat Kevin from Accounting in Tourist Season (The Keys).',
    });
    expect(buyBike(REG, DEFS, p, 'base:sport-600')).toEqual({
      ok: false,
      reason: 'Opens when you beat Kevin from Accounting in Tourist Season (The Keys).',
    });
    const keys = winAll(KEYS, progressOf(KEYS, p.regions), ['keys-t1-a', 'keys-t1-b', 'keys-t1-boss']);
    p = { ...p, regions: { ...p.regions, keys } };
    expect(sport()).toMatchObject({ state: 'for-sale', reason: '' });
    const bought = buyBike(REG, DEFS, p, 'base:sport-600');
    expect(bought.ok && bought.profile.bikes.current).toBe('base:sport-600');
  });

  it("a later chapter's shop stays shut until its region opens", () => {
    const p = { ...fresh(), cash: 100000 };
    const shown = Object.fromEntries(garageBikes(REG, DEFS, p).map((b) => [b.key, b]));
    expect(shown['base:moped']?.state).toBe('for-sale');
    expect(shown['base:dirt-bike']).toMatchObject({
      state: 'locked',
      reason: 'Opens when Mother Rust falls.',
    });
    expect(shown['base:chopper']).toMatchObject({ state: 'locked', reason: 'Opens when Old Growth falls.' });
    const keys = { ...progressOf(KEYS, p.regions), finaleBeaten: true };
    const after = { ...p, regions: { ...p.regions, keys } };
    expect(garageBikes(REG, DEFS, after).find((b) => b.key === 'base:dirt-bike')?.state).toBe('for-sale');
  });

  it("a season's paint opens with that season", () => {
    const p = fresh();
    const chrome = (q: Profile) => garagePaints(DEFS, q).find((x) => x.id === 'hurricane-chrome');
    expect(chrome(p)).toMatchObject({ state: 'locked', reason: 'Opens in Season 2.' });
    expect(chrome({ ...p, season: 2 })?.state).toBe('for-sale');
  });
});

describe('the six-bike ladder', () => {
  it('the starting bike and every shop bike faster than it, slowest first, each with the global tier it opens at', () => {
    expect(bikeLadder(REG, DEFS).map((b) => [b.key, b.opensAt])).toEqual([
      ['base:rustbucket-400', 1],
      ['base:sport-600', 2],
      ['base:streetfighter-750', 4],
      ['base:grand-tourer-1100', 6],
      ['base:supersport-900', 8],
      ['base:superbike-1000', 10],
    ]);
  });

  it('the global tier counts the tiers of every earlier chapter', () => {
    expect([globalTier(DEFS, KEYS, 0), globalTier(DEFS, PNW, 0), globalTier(DEFS, SF, 3)]).toEqual([
      1, 5, 12,
    ]);
  });
});

describe('the field levels up every tier', () => {
  // The design's Season 1 table, per global tier (docs/product-spec.md, "Rivals"; T7.5 retuned the
  // fights to the maintainer's gentle climb, about -10% to +20% over a region): the pace of a
  // regular event and of the tier's boss (m/s), the bike the rivals ride, then aggression, the
  // signature gap, health and power for a regular event and for the boss.
  type Row = [number, number, string, number, number, number, number, number, number, number];
  const ROWS: Row[] = [
    [33.1, 34.0, 'rustbucket-400', 0.9, 0.945, 1.1, 1.048, 0.9, 0.9, 0.9],
    [39.1, 40.1, 'rustbucket-400', 1.0, 1.05, 1.0, 0.952, 1.0, 1.0, 1.0],
    [41.1, 42.1, 'sport-600', 1.1, 1.155, 0.9, 0.857, 1.1, 1.1, 1.07],
    [47.5, 49.8, 'streetfighter-750', 1.2, 1.32, 0.85, 0.773, 1.2, 1.3, 1.12],
    [41.4, 42.5, 'sport-600', 0.9, 0.945, 1.1, 1.048, 0.9, 0.9, 0.9],
    [47.6, 48.8, 'streetfighter-750', 1.0, 1.05, 1.0, 0.952, 1.0, 1.0, 1.0],
    [50.0, 51.2, 'grand-tourer-1100', 1.1, 1.155, 0.9, 0.857, 1.1, 1.1, 1.07],
    [56.1, 58.7, 'supersport-900', 1.2, 1.32, 0.85, 0.773, 1.2, 1.3, 1.12],
    [48.8, 50.2, 'grand-tourer-1100', 0.9, 0.945, 1.1, 1.048, 0.9, 0.9, 0.9],
    [55.8, 57.2, 'supersport-900', 1.0, 1.05, 1.0, 0.952, 1.0, 1.0, 1.0],
    [58.6, 60.1, 'superbike-1000', 1.1, 1.155, 0.9, 0.857, 1.1, 1.1, 1.07],
    [60.8, 63.6, 'superbike-1000', 1.2, 1.32, 0.85, 0.773, 1.2, 1.3, 1.12],
  ];
  const BEST_TOP = [44.7, 50.1, 50.1, 55.9, 55.9, 61.0, 61.0, 66.0, 66.0, 71.5, 71.5, 71.5];

  it("Season 1: each global tier's regular events and boss match the design's table", () => {
    ROWS.forEach((row, i) => {
      const [pace, bossPace, rides, aggr, bossAggr, sig, bossSig, health, bossHealth, power] = row;
      const def = DEFS[Math.floor(i / 4)] as CareerDef;
      const t = (i % 4) + 1;
      const g = i + 1;
      const regular = fieldLevel(REG, DEFS, def, nodeById(def, `${def.regionId}-t${t}-a`));
      const boss = fieldLevel(REG, DEFS, def, nodeById(def, `${def.regionId}-t${t}-boss`));
      const at = `g${g}`;
      expect(regular?.paceMps, at).toBe(pace);
      expect(boss?.paceMps, at).toBe(bossPace);
      expect(regular?.rivalBike, at).toBe(`base:${rides}`);
      expect(regular?.copBike, at).toBe(`base:${rides}`);
      expect(regular?.copTopCapMps, at).toBe(Math.round(0.98 * (BEST_TOP[i] ?? 0) * 10) / 10);
      expect(regular?.aggressionScale, at).toBeCloseTo(aggr, 3);
      expect(boss?.aggressionScale, at).toBeCloseTo(bossAggr, 2);
      expect(regular?.signatureGapScale, at).toBeCloseTo(sig, 3);
      expect(boss?.signatureGapScale, at).toBeCloseTo(bossSig, 2);
      expect(regular?.healthScale, at).toBeCloseTo(health, 3);
      expect(boss?.healthScale, at).toBeCloseTo(bossHealth, 3);
      expect(regular?.powerScale, at).toBeCloseTo(power, 3);
      expect(regular?.fineScale, at).toBeCloseTo(1 + 0.08 * (g - 1), 3);
    });
  });

  it("fights climb gently: about 10% easier to knock down at a region's first tier, about 20% harder by its last", () => {
    for (const def of DEFS) {
      const first = fieldLevel(REG, DEFS, def, nodeById(def, `${def.regionId}-t1-a`));
      const last = fieldLevel(REG, DEFS, def, nodeById(def, `${def.regionId}-t4-a`));
      expect(first?.healthScale).toBeCloseTo(0.9, 3);
      expect(last?.healthScale).toBeCloseTo(1.2, 3);
    }
  });

  it('a tier boss outside a region boss is not the region boss: only the last tier adds health', () => {
    const tierBoss = fieldLevel(REG, DEFS, KEYS, nodeById(KEYS, 'keys-t1-boss'));
    expect(tierBoss?.healthScale).toBeCloseTo(0.9, 3);
  });

  it('Season 2 on: everyone rides the best bike, and the field is harder again', () => {
    const s2 = fieldLevel(REG, DEFS, KEYS, nodeById(KEYS, 'keys-t1-a'), 2);
    expect(s2).toMatchObject({ paceMps: 55.1, rivalBike: 'base:superbike-1000', copTopCapMps: 70.1 });
    expect(s2?.aggressionScale).toBeCloseTo(1.0, 3);
    expect(s2?.signatureGapScale).toBeCloseTo(0.99, 3);
    expect(s2?.healthScale).toBeCloseTo(0.95, 3);
    expect(s2?.powerScale).toBeCloseTo(0.95, 3);
    // The caps hold however long the career runs.
    const late = fieldLevel(REG, DEFS, KEYS, nodeById(KEYS, 'keys-t4-boss'), 40);
    expect(late?.paceMps).toBe(Math.round(0.95 * 71.5 * 10) / 10);
    expect(late?.aggressionScale).toBe(1.6);
    expect(late?.signatureGapScale).toBe(0.5);
    expect(late?.healthScale).toBe(1.4);
    expect(late?.powerScale).toBe(1.3);
  });

  it("a tier's field block in its career file overrides the defaults", () => {
    const tuned = region(KEYS_SPEC, [
      { field: { paceShare: 0.7 } },
      { field: { rivalBike: 'best', aggression: 1.4 } },
    ]);
    const defs = [tuned, PNW, SF];
    expect(fieldLevel(REG, defs, tuned, nodeById(tuned, 'keys-t1-a'))?.paceMps).toBe(31.3);
    const t2 = fieldLevel(REG, defs, tuned, nodeById(tuned, 'keys-t2-a'));
    expect(t2?.rivalBike).toBe('base:sport-600');
    expect(t2?.aggressionScale).toBeCloseTo(1.4, 3);
  });

  it("a tier's step-down block is Season 1's: from Season 2 its rivals ride the best bike", () => {
    // The product spec's Rivals: "from a region's third tier, and in every tier from Season 2,
    // rivals ride that bike". The real career files name `step-down` for their first two tiers.
    const tuned = region(KEYS_SPEC, [{ field: { rivalBike: 'step-down' } }]);
    const defs = [tuned, PNW, SF];
    expect(fieldLevel(REG, defs, tuned, nodeById(tuned, 'keys-t1-a'), 1)?.rivalBike).toBe(
      'base:rustbucket-400',
    );
    expect(fieldLevel(REG, defs, tuned, nodeById(tuned, 'keys-t1-a'), 2)?.rivalBike).toBe(
      'base:superbike-1000',
    );
  });

  it('a map without tier bosses still levels up, its one boss the region boss', () => {
    const plain: CareerDef = {
      ...KEYS,
      tiers: KEYS.tiers.map((t, i) => (i < 3 ? { id: t.id, name: t.name, requiredWins: t.requiredWins } : t)),
    };
    const regular = fieldLevel(REG, [plain], plain, nodeById(plain, 'keys-t1-boss'));
    expect(regular?.paceMps).toBe(33.1);
    expect(fieldLevel(REG, [plain], plain, nodeById(plain, 'keys-t4-boss'))?.paceMps).toBe(49.8);
  });

  it('no field level without a bike to measure it by', () => {
    const empty = { ...REG, bikes: {} } as unknown as ContentRegistry;
    expect(fieldLevel(empty, DEFS, KEYS, nodeById(KEYS, 'keys-t1-a'))).toBeNull();
  });
});
