/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { registryFromGlob, TIMES_OF_DAY, type ContentRegistry } from '../content';
import type { EventPatch } from '../core';
import { DEFAULT_PROFILE, MAX_CAREER_BACKUPS, type Profile } from '../save';
import {
  applyEventPatch,
  canStartSeason,
  careerDefs,
  careerView,
  eventPlan,
  newCareer,
  remixPatch,
  seasonLabel,
  seasonRace,
  settleRace,
  startCareer,
  startSeason,
  type CareerDef,
  type CareerNode,
  type RaceStatus,
  type RaceTally,
} from './index';

// Seasons (playtest 3, round 2: "Longer + seasons": "Season 2+ with a harder field and remixed
// events, the garage carried over"; round 3: "Season 2 on the finished save, plus a 'New career'
// button that keeps the old save as a backup code"). The oracle is the design's season rules
// (docs/product-spec.md, "Career"): what carries over, what resets, and the remix, on a hand-made
// map; then the real Keys map for determinism.

const rider = (id: string, region: string | null = null, role = 'rival') => ({ id, name: id, role, region });
const ev = (id: string, over: Record<string, unknown> = {}) => ({
  type: 'event',
  id,
  name: id,
  kind: 'classic-race',
  region: 'florida-keys',
  timeOfDay: 'golden-hour',
  lengths: [{ id: 'standard', route: 'run', laps: 1 }],
  field: { riders: ['deacon-vane', 'dial-up', 'chad-speedwell', 'tammy-two-stroke', 'the-mayor'] },
  rules: {},
  objectives: [{ id: 'top-3', kind: 'finish-place', params: { maxPlace: 3 }, required: true }],
  tier: 1,
  rewards: { byPlaceCash: [1500, 900, 600, 300, 150, 100] },
  modifiers: { pool: 'region-default', maxPerRace: 1, chanceScale: 1 },
  ...over,
});
const grudge = (id: string, rival: string, rule?: string) =>
  ev(id, {
    kind: 'grudge-match',
    field: { riders: [rival] },
    rules: { rival, winBy: 'knockdowns', knockdownsToWin: 2, grudgeStakes: 2, ...(rule ? { rule } : {}) },
    objectives: [{ id: 'beat-rival', kind: 'beat-rival', required: true, rewardCash: 800 }],
    rewards: { byPlaceCash: [2000, 300] },
  });

const REG = {
  bikes: {},
  riders: {
    'base:kevin-from-accounting': rider('kevin-from-accounting'),
    'base:dial-up': rider('dial-up'),
    'base:chad-speedwell': rider('chad-speedwell'),
    'base:deacon-vane': rider('deacon-vane'),
    'base:mother-rust': rider('mother-rust', 'florida-keys'),
    'base:tammy-two-stroke': rider('tammy-two-stroke', 'florida-keys'),
    'base:the-mayor': rider('the-mayor', 'florida-keys'),
    'base:sgt-pruitt': rider('sgt-pruitt', 'florida-keys', 'cop'),
    'base:player': rider('player', null, 'player-preset'),
    'region-pnw:juniper-moss': rider('juniper-moss', 'pacific-northwest'),
    'region-pnw:old-growth': rider('old-growth', 'pacific-northwest'),
  },
  events: {
    'base:ev-a': ev('ev-a'),
    'base:ev-b': ev('ev-b', {
      kind: 'takedown-hunt',
      rules: { targetCount: 2, targets: 'any', endOnCount: true },
      objectives: [
        { id: 'takedowns', kind: 'takedowns', params: { count: 2 }, required: true, rewardCash: 800 },
      ],
    }),
    'base:ev-g1': grudge('ev-g1', 'kevin-from-accounting', 'audit'),
    'base:ev-c': ev('ev-c', {
      kind: 'cop-escape',
      field: { riders: ['chad-speedwell', 'the-mayor'] },
      rules: { escapeBy: 'survive', surviveS: 45, copsFromStart: 2 },
      objectives: [{ id: 'escape', kind: 'escape', required: true, rewardCash: 1500 }],
    }),
    'base:ev-drift': ev('ev-drift', {
      objectives: [
        { id: 'finish', kind: 'finish-place', params: { maxPlace: 6 }, required: true },
        { id: 'drift', kind: 'style-cash', params: { cash: 1750, kinds: ['drift'] }, required: true },
      ],
    }),
    'base:ev-g2': grudge('ev-g2', 'chad-speedwell'),
    'base:ev-d': ev('ev-d', {
      lengths: [
        { id: 'standard', route: 'run', laps: 1 },
        { id: 'long', route: 'long-run', laps: 1 },
      ],
      objectives: [
        { id: 'top-3', kind: 'finish-place', params: { maxPlace: 3 }, required: true },
        { id: 'shortcut', kind: 'ride-branch', params: { branch: 'cut' }, required: false, rewardCash: 400 },
      ],
    }),
    'base:ev-e': ev('ev-e', {
      kind: 'takedown-hunt',
      rules: { targetCount: 3, targets: 'any', endOnCount: true },
      objectives: [
        { id: 'takedowns', kind: 'takedowns', params: { count: 3 }, required: true, rewardCash: 900 },
      ],
    }),
    'base:ev-g3': grudge('ev-g3', 'dial-up', 'bad-connection'),
    'base:ev-boss': ev('ev-boss', {
      kind: 'grudge-match',
      field: { riders: ['mother-rust', 'tammy-two-stroke', 'deacon-vane', 'dial-up'] },
      rules: { rival: 'mother-rust', winBy: 'finish-ahead', grudgeStakes: 3 },
      objectives: [{ id: 'beat-rival', kind: 'beat-rival', required: true, params: { orKnockdowns: 3 } }],
      rewards: { byPlaceCash: [8000, 3000, 1500, 600, 300] },
    }),
    'region-pnw:ev-pnw-boss': ev('ev-pnw-boss', {
      kind: 'grudge-match',
      region: 'pacific-northwest',
      field: { riders: ['old-growth'] },
      rules: { rival: 'old-growth', winBy: 'finish-ahead', grudgeStakes: 3, rule: 'timber' },
      objectives: [{ id: 'beat-rival', kind: 'beat-rival', required: true }],
    }),
  },
  routes: {},
  roads: {},
  networks: {},
  regions: {},
} as unknown as ContentRegistry;

const node = (id: string, tier: number, over: Partial<CareerNode> = {}): CareerNode => ({
  id,
  event: `base:ev-${id}`,
  length: 'standard',
  tier,
  road: `road-${id}`,
  s: 10,
  requires: [],
  opens: [],
  claims: [],
  ...over,
});

const KEYS: CareerDef = {
  key: 'base:test-circuit',
  pack: 'base',
  name: 'Test Circuit',
  regionKey: 'base:florida-keys',
  regionId: 'florida-keys',
  regionName: 'The Keys',
  chapter: 1,
  startingCash: 500,
  startingBike: 'base:rustbucket-400',
  tutorialNode: 'a',
  firstRun: 'race-first',
  tiers: [
    { id: 't1', name: 'Tourist Season', requiredWins: 2, boss: 'g1', bossName: 'Kevin' },
    { id: 't2', name: 'Hurricane Season', requiredWins: 2, boss: 'g2', bossName: 'Chad' },
    { id: 't3', name: 'Off Season', requiredWins: 2, boss: 'g3', bossName: 'Dial-Up' },
    { id: 't4', name: 'The Drawbridge', requiredWins: 0, boss: 'boss', bossName: 'Mother Rust' },
  ],
  nodes: [
    node('a', 0, { opens: ['road-b'], claims: ['road-a2'] }),
    node('b', 0, { requires: ['a'] }),
    node('g1', 0),
    node('c', 1),
    node('drift', 1),
    node('g2', 1),
    node('d', 2),
    node('e', 2),
    node('g3', 2),
    node('boss', 3),
  ],
  boss: 'boss',
  bossName: 'Mother Rust',
  secrets: [],
  shop: [],
  paints: [],
  unlocks: [],
  ending: { lines: ['NEXT: THE RAIN.'], next: 'region-pnw:pacific-northwest', freePlayAfter: true },
  startRoads: ['road-a', 'road-b'],
};
const PNW: CareerDef = {
  ...KEYS,
  key: 'region-pnw:pnw-circuit',
  pack: 'region-pnw',
  regionKey: 'region-pnw:pacific-northwest',
  regionId: 'pacific-northwest',
  regionName: 'The Pacific Northwest',
  chapter: 2,
  tiers: [{ id: 't1', name: 'Drizzle', requiredWins: 0, boss: 'pnw-boss', bossName: 'Old Growth' }],
  nodes: [node('pnw-boss', 0, { event: 'region-pnw:ev-pnw-boss' })],
  boss: 'pnw-boss',
  bossName: 'Old Growth',
  startRoads: ['road-pnw'],
};
const DEFS = [KEYS, PNW];
const nodeById = (id: string): CareerNode => {
  const n = KEYS.nodes.find((x) => x.id === id);
  if (!n) throw new Error(id);
  return n;
};
const NO_GRUDGES = {};
const patchOf = (id: string, season: number, seed: number, grudges: Profile['grudges'] = NO_GRUDGES) =>
  remixPatch(REG, DEFS, KEYS, nodeById(id), season, seed, grudges);
const SEEDS = Array.from({ length: 300 }, (_v, i) => i * 7919 + 13);

/** Season 1 with every region boss down: the maintainer's finished save, in miniature. */
function finished(): Profile {
  const p = startCareer(DEFS, { ...DEFAULT_PROFILE });
  return {
    ...p,
    cash: 81_000,
    bikes: {
      owned: ['base:rustbucket-400', 'base:superbike-1000'],
      current: 'base:superbike-1000',
      paint: {},
    },
    paintsOwned: ['flamingo-pink'],
    grudges: { 'base:dial-up': { 'base:player': 4 } },
    oncePerCareer: ['prompt:throttle', 'teaser:florida-keys', 'teaser:pacific-northwest'],
    receipts: [
      {
        kind: 'takedown',
        region: 'florida-keys',
        event: 'base:ev-a',
        road: 'road-a',
        s: 10,
        rival: 'base:dial-up',
        vehicle: null,
        n: 1,
      },
    ],
    history: [
      {
        event: 'base:ev-boss',
        node: 'boss',
        region: 'florida-keys',
        place: 1,
        outcome: 'won',
        cash: 8000,
        takedowns: 0,
        build: 'b',
        at: 't',
      },
    ],
    regions: {
      'florida-keys': {
        tier: 4,
        won: KEYS.nodes.map((n) => n.id).sort(),
        unlockedRoads: ['road-a', 'road-b', 'road-c'],
        claimedRoads: ['road-a', 'road-a2'],
        foundShortcuts: ['run#cut'],
        secrets: ['cooler'],
        finaleBeaten: true,
      },
      'pacific-northwest': {
        tier: 1,
        won: ['pnw-boss'],
        unlockedRoads: ['road-pnw'],
        claimedRoads: ['road-pnw'],
        foundShortcuts: [],
        secrets: [],
        finaleBeaten: true,
      },
    },
  };
}

describe('starting a season', () => {
  it('waits until every region boss of the season has fallen', () => {
    const done = finished();
    expect(canStartSeason(DEFS, done)).toBe(true);
    const pnwLeft = {
      ...done,
      regions: {
        ...done.regions,
        'pacific-northwest': { ...done.regions['pacific-northwest']!, finaleBeaten: false },
      },
    };
    expect(canStartSeason(DEFS, pnwLeft)).toBe(false);
    expect(canStartSeason(DEFS, startCareer(DEFS, { ...DEFAULT_PROFILE }))).toBe(false);
    expect(canStartSeason([], done)).toBe(false);
    // Not ready: nothing changes.
    expect(startSeason(DEFS, pnwLeft, 99)).toBe(pnwLeft);
  });

  it('Season 2 keeps the garage, cash, grudges, receipts, secrets and history, and resets the maps', () => {
    const before = finished();
    const after = startSeason(DEFS, before, 0xdeadbeef);
    expect(after.season).toBe(2);
    expect(after.seasonSeed).toBe(0xdeadbeef);
    // Carried over.
    expect(after.cash).toBe(before.cash);
    expect(after.bikes).toEqual(before.bikes);
    expect(after.paintsOwned).toEqual(before.paintsOwned);
    expect(after.grudges).toEqual(before.grudges);
    expect(after.receipts).toEqual(before.receipts);
    expect(after.history).toEqual(before.history);
    expect(after.failureMode).toBe(before.failureMode);
    // Reset to the start roads, keeping what was found.
    expect(after.regions['florida-keys']).toEqual({
      tier: 1,
      won: [],
      unlockedRoads: ['road-a', 'road-b'],
      claimedRoads: [],
      foundShortcuts: ['run#cut'],
      secrets: ['cooler'],
      finaleBeaten: false,
    });
    expect(after.regions['pacific-northwest']?.won).toEqual([]);
    // The prompts stay seen; each boss's teaser plays again in the new season.
    expect(after.oncePerCareer).toEqual(['prompt:throttle']);
    // And Season 3 follows the same way, with its own seed.
    const s2done = {
      ...after,
      regions: Object.fromEntries(
        Object.entries(after.regions).map(([k, r]) => [k, { ...r, finaleBeaten: true }]),
      ),
    };
    expect(startSeason(DEFS, s2done, 7)).toMatchObject({ season: 3, seasonSeed: 7 });
  });

  it('names the season', () => {
    expect(seasonLabel(1)).toBe('Season 1');
    expect(seasonLabel(2)).toBe('Season 2: Renewed');
    expect(seasonLabel(3)).toBe('Season 3: Syndication');
    expect(seasonLabel(4)).toBe('Season 4: The Streaming Era');
    expect(seasonLabel(5)).toBe('Season 5');
  });
});

describe('a new career', () => {
  it('starts fresh and keeps the old career as a backup code, never nested, at most three', () => {
    const old = { ...startSeason(DEFS, finished(), 5), careerBackups: [] };
    const fresh = newCareer(DEFS, old, { code: 'EC1.p.abc.00000000', at: '2026-10-04T00:00:00Z' });
    expect(fresh.season).toBe(1);
    expect(fresh.seasonSeed).toBe(0);
    expect(fresh.cash).toBe(500);
    expect(fresh.bikes.owned).toEqual(['base:rustbucket-400']);
    expect(fresh.grudges).toEqual({});
    expect(fresh.history).toEqual([]);
    expect(fresh.receipts).toEqual([]);
    expect(fresh.paintsOwned).toEqual([]);
    expect(fresh.regions['florida-keys']?.unlockedRoads).toEqual(['road-a', 'road-b']);
    // The controls were learnt once; the prompts are not shown again.
    expect(fresh.oncePerCareer).toEqual(['prompt:throttle']);
    expect(fresh.careerBackups).toEqual([
      { code: 'EC1.p.abc.00000000', at: '2026-10-04T00:00:00Z', season: 2 },
    ]);

    let p = fresh;
    for (let i = 0; i < MAX_CAREER_BACKUPS + 1; i++) {
      p = newCareer(DEFS, { ...p, history: finished().history }, { code: `EC1.p.n${i}.00000000`, at: '' });
    }
    expect(p.careerBackups).toHaveLength(MAX_CAREER_BACKUPS);
    expect(p.careerBackups.at(-1)?.code).toBe(`EC1.p.n${MAX_CAREER_BACKUPS}.00000000`);
  });

  it('a profile with no career yet keeps no backup', () => {
    const p = newCareer(DEFS, { ...DEFAULT_PROFILE }, { code: 'EC1.p.x.00000000', at: '' });
    expect(p.careerBackups).toEqual([]);
    expect(p.bikes.owned).toEqual(['base:rustbucket-400']);
  });
});

describe('the remix', () => {
  it('Season 1 is never remixed', () => {
    for (const n of KEYS.nodes) expect(remixPatch(REG, DEFS, KEYS, n, 1, 123, NO_GRUDGES)).toBeNull();
  });

  it('is deterministic, and a new seed or a new season remixes differently', () => {
    const all = (season: number, seed: number) => KEYS.nodes.map((n) => patchOf(n.id, season, seed));
    expect(all(2, 123)).toEqual(all(2, 123));
    expect(all(2, 123)).not.toEqual(all(2, 124));
    expect(all(2, 123)).not.toEqual(all(3, 123));
  });

  it('rolls a time of day from the five presets, never the Season 1 one', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS)
      for (const n of KEYS.nodes) {
        const tod = patchOf(n.id, 2, seed)?.timeOfDay ?? '';
        expect(TIMES_OF_DAY).toContain(tod);
        expect(tod).not.toBe('golden-hour');
        seen.add(tod);
      }
    expect(seen.size).toBe(4);
  });

  it('races the long length about half the time, only in region tiers 3 and 4', () => {
    const long = SEEDS.filter((seed) => patchOf('d', 2, seed)?.lengthId === 'long').length;
    expect(long / SEEDS.length).toBeGreaterThan(0.38);
    expect(long / SEEDS.length).toBeLessThan(0.62);
    // Node a's event has no long length; node d's tier-1 twin would never race it.
    const tierOne = { ...nodeById('d'), id: 'd1', tier: 0 };
    for (const seed of SEEDS)
      expect(remixPatch(REG, DEFS, KEYS, tierOne, 2, seed, NO_GRUDGES)?.lengthId).toBeUndefined();
  });

  it('redraws a regular field from the region roster, the same count; guests from Season 3', () => {
    const home = new Set([
      'base:kevin-from-accounting',
      'base:dial-up',
      'base:chad-speedwell',
      'base:deacon-vane',
      'base:tammy-two-stroke',
      'base:the-mayor',
    ]);
    const guests = new Set(['region-pnw:juniper-moss']);
    let sawGuest = false;
    for (const seed of SEEDS) {
      const p2 = patchOf('a', 2, seed) as EventPatch;
      const riders2 = p2.riders ?? [];
      expect(riders2.length).toBeGreaterThanOrEqual(5);
      expect(new Set(riders2).size).toBe(riders2.length);
      for (const r of riders2) expect(home.has(r)).toBe(true);
      const p3 = patchOf('a', 3, seed) as EventPatch;
      const riders3 = p3.riders ?? [];
      const g = riders3.filter((r) => guests.has(r));
      expect(g.length).toBeLessThanOrEqual(2);
      for (const r of riders3) expect(home.has(r) || guests.has(r)).toBe(true);
      sawGuest ||= g.length > 0;
    }
    expect(sawGuest).toBe(true);
  });

  it('swaps about one regular node in three between classic, hunt and escape; drift and grudges never', () => {
    let swapped = 0;
    let regular = 0;
    for (const seed of SEEDS) {
      for (const id of ['a', 'b', 'c', 'd', 'e']) {
        regular++;
        if (patchOf(id, 2, seed)?.kind) swapped++;
      }
      for (const id of ['drift', 'g1', 'g2', 'g3', 'boss'])
        expect(patchOf(id, 2, seed)?.kind).toBeUndefined();
    }
    expect(swapped / regular).toBeGreaterThan(0.25);
    expect(swapped / regular).toBeLessThan(0.42);
  });

  it('a swap uses the kind template scaled by tier and pays the new kind’s purse', () => {
    const find = (id: string, kind: string, season = 2) => {
      const seed = SEEDS.find((s) => patchOf(id, season, s)?.kind === kind);
      if (seed === undefined) throw new Error(`no ${kind} swap for ${id}`);
      return patchOf(id, season, seed) as EventPatch;
    };
    // A hunt at region tier 1 (global tier 1, W = $900): two takedowns end it, the bonus is W.
    const hunt = find('a', 'takedown-hunt');
    expect(hunt.rules).toEqual({ targetCount: 2, targets: 'any', endOnCount: true });
    expect(hunt.objectives).toEqual([
      { id: 'takedowns', kind: 'takedowns', params: { count: 2 }, required: true, rewardCash: 900 },
    ]);
    expect(hunt.byPlaceCash).toEqual([250, 200, 100, 50, 50, 0].slice(0, (hunt.riders?.length ?? 0) + 1));
    // From Season 3, one more takedown.
    expect(find('a', 'takedown-hunt', 3).rules).toMatchObject({ targetCount: 3 });
    // An escape at region tier 3: 2,500 + 250 x 3 m, two cops from the start (three from Season 3).
    const escape = find('d', 'cop-escape');
    expect(escape.rules).toEqual({ escapeBy: 'distance', escapeDistanceM: 3250, copsFromStart: 2 });
    expect(escape.objectives?.[0]).toEqual({
      id: 'escape',
      kind: 'escape',
      required: true,
      rewardCash: 1350,
    });
    // The shortcut bonus rides along with any kind.
    expect(escape.objectives?.[1]).toMatchObject({ id: 'shortcut', kind: 'ride-branch', required: false });
    expect(find('d', 'cop-escape', 3).rules).toMatchObject({ copsFromStart: 3 });
    // A classic race at region tier 2 (W = $1,100): top 3 required, at least 5 rivals.
    const classic = find('c', 'classic-race');
    expect(classic.rules).toEqual({});
    expect(classic.objectives).toEqual([
      { id: 'top-3', kind: 'finish-place', params: { maxPlace: 3 }, required: true },
    ]);
    expect(classic.riders?.length).toBeGreaterThanOrEqual(5);
    expect(classic.byPlaceCash?.slice(0, 3)).toEqual([1100, 600, 400]);
  });

  it('a tier boss becomes the rival with the highest grudge not yet a boss; region bosses stay', () => {
    const grudges = { 'base:dial-up': { 'base:player': 7 }, 'base:chad-speedwell': { 'base:player': 3 } };
    const g1 = patchOf('g1', 2, 123, grudges) as EventPatch;
    expect(g1.rules).toMatchObject({ rival: 'base:dial-up', winBy: 'knockdowns', knockdownsToWin: 2 });
    // Kevin's Audit is his own; Dial-Up's match has no rule.
    expect(g1.rules?.['rule']).toBeUndefined();
    expect(g1.riders).toEqual(['base:dial-up']);
    // Dial-Up is taken: tier 2 goes to the next grudge, Chad (already its rival: no change).
    expect(patchOf('g2', 2, 123, grudges)?.rules).toBeUndefined();
    // The region boss is the rematch, unchanged.
    const boss = patchOf('boss', 2, 123, grudges) as EventPatch;
    expect(boss.rules).toBeUndefined();
    expect(boss.riders).toBeUndefined();
    expect(boss.kind).toBeUndefined();
  });

  it('a rule stays only with its own rival, and ties go to the seeded draw', () => {
    const kevin = patchOf('g1', 2, 1, { 'base:kevin-from-accounting': { 'base:player': 9 } });
    // Kevin keeps his own match: nothing to patch.
    expect(kevin?.rules).toBeUndefined();
    // Kevin, Chad and Dial-Up in that order keep their own matches, Dial-Up his Bad Connection.
    const order = {
      'base:kevin-from-accounting': { 'base:player': 9 },
      'base:chad-speedwell': { 'base:player': 8 },
      'base:dial-up': { 'base:player': 7 },
    };
    for (const id of ['g1', 'g2', 'g3']) expect(patchOf(id, 2, 1, order)?.rules).toBeUndefined();
    // Dial-Up first: he takes tier 1, and Kevin's Audit does not go with the match.
    const toG1 = patchOf('g1', 2, 1, { 'base:dial-up': { 'base:player': 9 } });
    expect(toG1?.rules).toMatchObject({ rival: 'base:dial-up' });
    expect(toG1?.rules?.['rule']).toBeUndefined();
    // With no grudges at all, the draw spreads the tier-1 boss over the roster.
    const rivalOf = (s: number) => patchOf('g1', 2, s)?.rules?.['rival'];
    const picked = new Set(
      SEEDS.map((s) => (typeof rivalOf(s) === 'string' ? rivalOf(s) : 'base:kevin-from-accounting')),
    );
    expect(picked.size).toBeGreaterThan(2);
    expect(picked.has('base:mother-rust')).toBe(false);
  });

  it('weird events come more often and the drift target rises x1.25 a season', () => {
    expect(patchOf('a', 2, 5)).toMatchObject({ modifierChanceScale: 1.5, maxModifiers: 2 });
    expect(patchOf('a', 3, 5)).toMatchObject({ modifierChanceScale: 2, maxModifiers: 2 });
    expect(patchOf('a', 6, 5)).toMatchObject({ modifierChanceScale: 2.5, maxModifiers: 2 });
    const drift = patchOf('drift', 2, 5) as EventPatch;
    expect(drift.objectives?.[1]).toEqual({
      id: 'drift',
      kind: 'style-cash',
      params: { cash: 2200, kinds: ['drift'] },
      required: true,
    });
  });

  it('a patched event and plan read the remix', () => {
    const grudges = { 'base:dial-up': { 'base:player': 7 } };
    const patch = patchOf('g1', 2, 123, grudges) as EventPatch;
    const event = applyEventPatch(REG.events['base:ev-g1'], patch) as unknown as Record<string, unknown>;
    expect(event['timeOfDay']).toBe(patch.timeOfDay);
    expect((event['field'] as { riders: string[] }).riders).toEqual(['base:dial-up']);
    expect((event['modifiers'] as { chanceScale: number }).chanceScale).toBe(1.5);
    expect(applyEventPatch(REG.events['base:ev-g1'], null)).toBe(REG.events['base:ev-g1']);
    const profile = { ...startSeason(DEFS, finished(), 123), grudges };
    const race = seasonRace(REG, DEFS, profile, KEYS, nodeById('g1'));
    expect(race.patch).toEqual(patch);
    expect(race.plan.rules.rival).toBe('base:dial-up');
    expect(race.plan.rules.rule).toBeUndefined();
    expect(race.plan.timeOfDay).toBe(patch.timeOfDay);
    // Season 1: the file as it is.
    const s1 = seasonRace(REG, DEFS, finished(), KEYS, nodeById('g1'));
    expect(s1.patch).toBeNull();
    expect(s1.plan).toEqual(eventPlan(REG, 'base:ev-g1'));
  });
});

describe('the season in the view and the history', () => {
  it('labels the season, offers Season 2 when ready, pins tier bosses and says why a region is shut', () => {
    const s1 = startCareer(DEFS, { ...DEFAULT_PROFILE });
    const v1 = careerView(REG, DEFS, s1, 'florida-keys');
    expect(v1.season).toEqual({ n: 1, label: 'Season 1' });
    expect(v1.seasonCard).toBeNull();
    expect(v1.regions.map((r) => [r.id, r.open, r.lockReason])).toEqual([
      ['florida-keys', true, ''],
      ['pacific-northwest', false, 'Opens when Mother Rust falls.'],
    ]);
    const cards = v1.tiers.flatMap((t) => t.nodes);
    expect(cards.filter((c) => c.tierBoss).map((c) => c.id)).toEqual(['g1', 'g2', 'g3']);
    expect(cards.filter((c) => c.boss).map((c) => c.id)).toEqual(['boss']);

    const done = careerView(REG, DEFS, finished(), 'florida-keys');
    expect(done.seasonCard?.season).toBe(2);
    expect(done.seasonCard?.title).toBe('Season 2: Renewed');
    expect(done.seasonCard?.lines[0]).toMatch(/^SEASON 2\. /);
    expect(done.seasonCard?.lines).toHaveLength(3);
  });

  it('Season 2 cards show the remix, and a node’s best is this season’s', () => {
    const s2 = startSeason(DEFS, finished(), 123);
    const v = careerView(REG, DEFS, s2, 'florida-keys');
    expect(v.season).toEqual({ n: 2, label: 'Season 2: Renewed' });
    expect(v.seasonCard).toBeNull();
    const boss = v.tiers.flatMap((t) => t.nodes).find((c) => c.id === 'boss');
    // Won in Season 1, not yet this season.
    expect(boss?.best).toBeNull();
    expect(boss?.timeOfDay).not.toBe('Golden hour');
    // The PNW is shut again until Mother Rust falls this season.
    expect(v.regions[1]?.open).toBe(false);
  });

  it('a race settled in Season 2 is written with its season', () => {
    const s2 = startSeason(DEFS, finished(), 123);
    const n = nodeById('a');
    const status: RaceStatus = { state: 'won', endNow: false, objectives: [], headline: '' };
    const tally: RaceTally = {
      finished: true,
      place: 1,
      racers: 6,
      busted: false,
      fineCash: 0,
      takedowns: 0,
      style: {},
      styleCash: 0,
      toRivals: {},
      branches: [],
      secrets: [],
      field: [],
      player: 'base:player',
    };
    const input = {
      reg: REG,
      def: KEYS,
      node: n,
      plan: eventPlan(REG, n.event),
      status,
      tally,
      build: 'b',
      at: 't',
    };
    expect(settleRace(s2, input).profile.history.at(-1)?.season).toBe(2);
    expect(settleRace(finished(), input).profile.history.at(-1)).not.toHaveProperty('season');
  });
});

describe('the real Keys map', () => {
  const REAL = registryFromGlob(
    import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
  );
  const REAL_DEFS = careerDefs(REAL);
  const keys = REAL_DEFS[0] as CareerDef;

  it('seeds 123 and 124 remix at least one node differently; every rider and time is real', () => {
    const all = (seed: number) => keys.nodes.map((n) => remixPatch(REAL, REAL_DEFS, keys, n, 2, seed, {}));
    const a = all(123);
    const b = all(124);
    expect(a.filter((p, i) => JSON.stringify(p) !== JSON.stringify(b[i])).length).toBeGreaterThanOrEqual(1);
    for (const p of [...a, ...b]) {
      expect(p).not.toBeNull();
      expect(TIMES_OF_DAY).toContain(p?.timeOfDay);
      for (const r of p?.riders ?? []) expect(REAL.riders[r]?.role).toBe('rival');
    }
    expect(keys.nodes.map((n) => remixPatch(REAL, REAL_DEFS, keys, n, 1, 123, {}))).toEqual(
      keys.nodes.map(() => null),
    );
    console.info(
      `[examined] ${keys.nodes.length} Keys nodes, seeds 123/124: ${a.filter((p, i) => JSON.stringify(p) !== JSON.stringify(b[i])).length} differ; kinds swapped at 123: ${a.filter((p) => p?.kind).length}`,
    );
  });
});
