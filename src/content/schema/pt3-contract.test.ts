import { describe, expect, it } from 'vitest';
import { BIKE_CLASSES, ENTRY_SCHEMAS, type EntryType } from './index';

// Playtest 3's content contract (K0b). Every new field is optional, every list only gains a value,
// so no format version moves and every pack file in the repo still validates. Each field has a
// passing case and a failing one.

const issues = (type: EntryType, value: unknown) => {
  const r = ENTRY_SCHEMAS[type].safeParse(value);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('/')}: ${i.message}`);
};

const road = (extra: Record<string, unknown>) => ({
  type: 'road',
  id: 'osm-smb-old-bridge',
  network: 'osm-keys-seven-mile',
  from: 'j-a',
  to: 'j-b',
  lengthM: 1200,
  sampleSpacingM: 6,
  laneSections: [{ s0: 0, lanes: [{ id: 'R1', dCenterM: 1.7, widthM: 3.4, direction: 1, kind: 'drive' }] }],
  samples: { encoding: 'json-columns', columns: ['x'], data: { x: [0] } },
  ...extra,
});

describe('road files: gaps, landmarks, jumpable walls and the railing look', () => {
  // The maintainer, round 3: "the real 80 m missing span is the big jump (a miss = splash, respawn
  // on the highway)"; round 1: "real landmarks, real road layouts".
  const gap = {
    kind: 'gap',
    id: 'moser',
    s0: 400,
    s1: 464,
    d0: -4,
    d1: 4,
    params: { killDepthM: 1.5, respawn: 'main' },
  };
  const landmark = {
    kind: 'landmark',
    id: 'gg-south-tower',
    s0: 200,
    s1: 230,
    d0: -14,
    d1: 14,
    params: { model: 'models/landmarks/golden-gate#tower', yawDeg: 90, overRoad: true },
  };

  it('accepts a gap with its params and a landmark feature, and no misspelt kind', () => {
    expect(issues('road', road({ features: [gap, landmark] }))).toEqual([]);
    expect(issues('road', road({ features: [{ ...landmark, kind: 'landmarks' }] }))).toHaveLength(1);
  });

  it('a wall may be jumpable and any barrier may draw as a railing; a rail may not be jumpable', () => {
    const wall = { s0: 0, s1: 300, side: 'left', kind: 'wall', heightM: 1.2, jumpable: true };
    const railing = { s0: 0, s1: 1200, side: 'both', kind: 'wall', heightM: 1.3, look: 'railing' };
    expect(issues('road', road({ barriers: [wall, railing] }))).toEqual([]);
    expect(issues('road', road({ barriers: [{ ...wall, kind: 'rail' }] }))).toEqual([
      'barriers/0/jumpable: only a wall barrier can be jumpable',
    ]);
    expect(issues('road', road({ barriers: [{ ...railing, look: 'chrome' }] }))).toHaveLength(1);
    expect(issues('road', road({ barriers: [{ ...wall, jumpable: 'yes' }] }))).toHaveLength(1);
  });
});

describe('route branches: aiTake', () => {
  const route = (branch: Record<string, unknown>) => ({
    type: 'route',
    id: 'osm-seven-mile-run',
    network: 'osm-keys-seven-mile',
    start: { road: 'a', s: 0, dir: 1 },
    finish: { road: 'b', s: 10 },
    mainPath: ['a', 'b'],
    allowedRoads: ['a', 'b', 'old'],
    closed: false,
    branches: [{ id: 'old-bridge', roads: ['old'], kind: 'alternate', ...branch }],
  });

  it('takes the share of rivals that ride a branch, 0 to 1, and leaves it optional', () => {
    expect(issues('route', route({}))).toEqual([]);
    expect(issues('route', route({ aiTake: 0 }))).toEqual([]);
    expect(issues('route', route({ aiTake: 1 }))).toEqual([]);
    expect(issues('route', route({ aiTake: 1.5 }))).toHaveLength(1);
    expect(issues('route', route({ aiTake: -0.1 }))).toHaveLength(1);
  });
});

describe('events: the wheelie and drift style cash', () => {
  const event = (rewards: unknown) => ({
    type: 'event',
    id: 'keys-t3-long-haul',
    kind: 'classic-race',
    region: 'florida-keys',
    timeOfDay: 'dusk',
    lengths: [{ id: 'standard', route: 'm1-long-haul', laps: 1 }],
    field: {},
    cops: { mode: 'every-race' },
    rules: {},
    objectives: [{ id: 'podium', kind: 'finish-place', required: true }],
    rewards,
  });

  it('takes whole, non-negative cash per second for each, and leaves both optional', () => {
    expect(
      issues('event', event({ byPlaceCash: [100], perWheelieSecondCash: 20, perDriftSecondCash: 30 })),
    ).toEqual([]);
    expect(issues('event', event({ byPlaceCash: [100], perWheelieSecondCash: -5 }))).toHaveLength(1);
    expect(issues('event', event({ byPlaceCash: [100], perDriftSecondCash: 2.5 }))).toHaveLength(1);
  });
});

describe('careers: tier bosses, tier field levels and season paints', () => {
  const career = (tier: Record<string, unknown>, paint: Record<string, unknown> = {}) => ({
    type: 'career',
    id: 'keys-circuit',
    region: 'florida-keys',
    startingCash: 500,
    startingBike: 'rustbucket-400',
    tiers: [{ id: 't1', name: 'Tourist Season', advance: { requiredWins: 2 }, ...tier }],
    nodes: [{ id: 'kevin-grudge', event: 'keys-t1-kevin-grudge', tier: 't1', at: { road: 'r', s: 0 } }],
    boss: 'kevin-grudge',
    paints: [
      {
        id: 'hurricane-chrome',
        name: 'Hurricane Chrome',
        hex: '#c0c6cc',
        priceCash: 15000,
        unlockTier: 't1',
        ...paint,
      },
    ],
  });

  it('a tier may name its boss node and its field level', () => {
    const field = {
      paceShare: 0.74,
      aggression: 0.85,
      signatureGap: 1.3,
      health: 0.9,
      power: 0.9,
      rivalBike: 'step-down',
    };
    expect(issues('career', career({ boss: 'kevin-grudge', field }))).toEqual([]);
    expect(issues('career', career({}))).toEqual([]);
  });

  it('rejects a field level out of range or a rival bike outside best and step-down', () => {
    expect(issues('career', career({ field: { paceShare: 1.2 } }))).toHaveLength(1);
    expect(issues('career', career({ field: { aggression: 0 } }))).toHaveLength(1);
    expect(issues('career', career({ field: { rivalBike: 'superbike-1000' } }))).toHaveLength(1);
    expect(issues('career', career({ boss: 'Not An Id' }))).toHaveLength(1);
  });

  it('a paint may open only from a later season', () => {
    expect(issues('career', career({}, { unlockSeason: 2 }))).toEqual([]);
    expect(issues('career', career({}, { unlockSeason: 0 }))).toHaveLength(1);
    expect(issues('career', career({}, { unlockSeason: 1.5 }))).toHaveLength(1);
    expect(issues('career', career({}, { hex: 'chrome' }))).toHaveLength(1);
  });
});

describe('bikes: the tourer class', () => {
  it('BIKE_CLASSES gains tourer (the Grand Tourer 1100), and only gains', () => {
    expect(BIKE_CLASSES).toContain('tourer');
    for (const c of ['scooter', 'moped', 'dirt', 'rat', 'sport', 'super', 'chopper'])
      expect(BIKE_CLASSES).toContain(c);
  });
});
