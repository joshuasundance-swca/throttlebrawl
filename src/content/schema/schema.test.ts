import { describe, expect, it } from 'vitest';
import { ENTRY_SCHEMAS, RESERVED_TYPES, SIM_EXCLUDED_FIELDS, VETOABLE_ITEMS, type EntryType } from './index';

// Examples copied from docs/content-packs.md, trimmed to the fields the schema checks.
const EXAMPLES: Partial<Record<EntryType, unknown>> = {
  crew: {
    type: 'crew',
    id: 'swamp-kin',
    name: 'The Swamp Kin',
    kind: 'gang',
    region: 'florida-keys',
    stanceTowardPlayer: 'neutral',
    gangUp: { enabled: true, maxJoiners: 2, joinRadiusM: 25, chance: 0.35 },
    rivalCrews: [],
  },
  'event-modifier': {
    type: 'event-modifier',
    id: 'hurricane-gust',
    name: 'Hurricane Gust',
    kind: 'nature',
    rarityWeight: 3,
    eligibility: { regions: ['florida-keys'], eventKinds: ['classic-race'], timeOfDay: [] },
    trigger: { atProgress: [0.3, 0.8], chance: 0.12 },
    durationS: 20,
    effects: [{ kind: 'lateral-gust', peakMps2: 3.0, rampS: 2, side: 'random' }],
    announce: { barkTrigger: 'modifier-start', sign: null },
  },
  station: {
    type: 'station',
    id: 'keys-surf',
    name: 'Surf Radio 24',
    genre: 'surf',
    regions: ['florida-keys'],
    tracks: [{ id: 'reef-break', title: 'Reef Break', origin: 'agent', status: 'live' }],
    djBarkSet: null,
  },
  patch: { type: 'patch', id: 'heavier-pipe', target: 'base:lead-pipe', merge: { damage: 20 } },
};

describe('content schema: types and field lists', () => {
  it('claims the reserved type names with their documented shapes', () => {
    for (const type of ['event-modifier', 'station', 'patch'] as const) {
      expect(ENTRY_SCHEMAS[type].safeParse(EXAMPLES[type]).success).toBe(true);
    }
    expect(RESERVED_TYPES).toContain('patch');
  });

  it('validates the crew entry that holds a cop agency', () => {
    expect(ENTRY_SCHEMAS.crew.safeParse(EXAMPLES.crew).success).toBe(true);
    expect(ENTRY_SCHEMAS.crew.safeParse({ ...(EXAMPLES.crew as object), kind: 'mob' }).success).toBe(false);
  });

  it('rejects a modifier effect outside the closed list', () => {
    const bad = { ...(EXAMPLES['event-modifier'] as object), effects: [{ kind: 'meteor' }] };
    expect(ENTRY_SCHEMAS['event-modifier'].safeParse(bad).success).toBe(false);
  });

  it('checks vetoable item status values', () => {
    const region = {
      type: 'region',
      id: 'florida-keys',
      networks: ['keys-m1'],
      timeOfDayOptions: [{ id: 'noon', lighting: 'keys-noon' }],
      traffic: { mix: [] },
      signs: [{ id: 'next-regret', text: 'NEXT REGRET 2 MI.', status: 'vetoed', note: 'too mean' }],
    };
    expect(ENTRY_SCHEMAS.region.safeParse(region).success).toBe(true);
    const bad = { ...region, signs: [{ id: 'next-regret', text: 'x', status: 'gone' }] };
    expect(ENTRY_SCHEMAS.region.safeParse(bad).success).toBe(false);
  });

  it('lists sim-excluded fields for every type and keeps presentation types out of the sim hash', () => {
    expect(Object.keys(SIM_EXCLUDED_FIELDS).sort()).toEqual(Object.keys(ENTRY_SCHEMAS).sort());
    expect(SIM_EXCLUDED_FIELDS['bark-set']).toBeNull();
    expect(SIM_EXCLUDED_FIELDS['hud-layout']).toBeNull();
    expect(SIM_EXCLUDED_FIELDS.bike).toEqual(expect.arrayContaining(['look', 'engineSound', 'meta', 'tags']));
    expect(SIM_EXCLUDED_FIELDS.bike).not.toContain('handling');
    expect(VETOABLE_ITEMS['bark-set']).toEqual(['lines']);
  });
});

// M2 content-2: every new field has a passing fixture and a failing one.
describe('content schema: the M2 formats', () => {
  const road = (barriers?: unknown) => ({
    type: 'road',
    id: 'bridge-hump',
    network: 'keys-m1',
    from: 'j-a',
    to: 'j-b',
    lengthM: 1200,
    sampleSpacingM: 2,
    laneSections: [{ s0: 0, lanes: [{ id: 'R1', dCenterM: 1.7, widthM: 3.4, direction: 1, kind: 'drive' }] }],
    samples: { encoding: 'json-columns', columns: ['x'], data: { x: [0] } },
    ...(barriers === undefined ? {} : { barriers }),
  });
  const rail = { s0: 0, s1: 1200, side: 'both', kind: 'rail', heightM: 1 };
  const issues = (type: EntryType, value: unknown) => {
    const r = ENTRY_SCHEMAS[type].safeParse(value);
    return r.success ? [] : r.error.issues.map((i) => `${i.path.join('/')}: ${i.message}`);
  };

  it('accepts a road with no barriers, a rail and a wall', () => {
    expect(issues('road', road())).toEqual([]);
    expect(issues('road', road([rail, { ...rail, side: 'left', kind: 'wall', heightM: 0.8 }]))).toEqual([]);
  });

  it('rejects a barrier with an unknown kind or side, no height, or an empty span', () => {
    expect(issues('road', road([{ ...rail, kind: 'hedge' }]))).toHaveLength(1);
    expect(issues('road', road([{ ...rail, side: 'middle' }]))).toHaveLength(1);
    expect(issues('road', road([{ ...rail, heightM: 0 }]))).toHaveLength(1);
    expect(issues('road', road([{ ...rail, s0: 500, s1: 500 }]))).toEqual([
      'barriers/0/s1: s1 must be past s0',
    ]);
  });

  const event = (rewards: unknown) => ({
    type: 'event',
    id: 'keys-t1-sunburn-sprint',
    kind: 'classic-race',
    region: 'florida-keys',
    timeOfDay: 'golden-hour',
    lengths: [{ id: 'short', route: 'overseas-sprint-short', laps: 1 }],
    field: {},
    cops: { mode: 'every-race' },
    rules: {},
    objectives: [{ id: 'podium', kind: 'finish-place', required: true }],
    rewards,
  });
  // The rewards block from the doc's example event.
  const rewards = {
    byPlaceCash: [1500, 900, 600, 300, 150],
    perTakedownCash: 200,
    perNearMissCash: 25,
    perAirtimeCash: 40,
    perOncomingSecondCash: 10,
    takedownComboScale: 0.5,
    perStealCash: 60,
  };

  it('accepts the style cash fields, and leaves them optional', () => {
    expect(issues('event', event(rewards))).toEqual([]);
    expect(issues('event', event({ byPlaceCash: [100] }))).toEqual([]);
  });

  it('rejects negative or fractional style cash', () => {
    expect(issues('event', event({ ...rewards, perAirtimeCash: -40 }))).toHaveLength(1);
    expect(issues('event', event({ ...rewards, perOncomingSecondCash: 2.5 }))).toHaveLength(1);
    expect(issues('event', event({ ...rewards, takedownComboScale: -1 }))).toHaveLength(1);
  });

  const barks = (line: Record<string, unknown>, defaults: Record<string, unknown> = {}) => ({
    type: 'bark-set',
    id: 'kevin-core',
    defaults: { speaker: 'kevin-from-accounting', ...defaults },
    lines: [{ id: 'kevin-line', trigger: 'overtaken', target: 'player', text: 'Noted.', ...line }],
  });

  it("accepts the doc's line fields: when, chance, priority, oncePerCareer, audio and replies", () => {
    const line = {
      when: [
        { fact: 'grudge.speakerTowardTarget', op: 'gte', value: 4 },
        { fact: 'target.bikeClass', op: 'in', value: ['scooter', 'moped'] },
        { fact: 'history.lastRace.targetBeatSpeaker', op: 'eq', value: true },
      ],
      chance: 0.6,
      weight: 3,
      priority: 2,
      cooldownS: 90,
      oncePerCareer: true,
      audioAsset: null,
      replyTo: 'kevin-other-line',
    };
    expect(issues('bark-set', barks(line, { chance: 0.5, priority: 1 }))).toEqual([]);
  });

  it('rejects a bad op, a list outside "in", a single value for "in", and out-of-range numbers', () => {
    const when = (c: Record<string, unknown>) => barks({ when: [{ fact: 'race.progress', ...c }] });
    expect(issues('bark-set', when({ op: 'approx', value: 1 }))).toHaveLength(1);
    expect(issues('bark-set', when({ op: 'eq', value: [1, 2] }))).toEqual([
      'lines/0/when/0/value: "in" takes a list of values; every other op takes one value',
    ]);
    expect(issues('bark-set', when({ op: 'in', value: 0.5 }))).toHaveLength(1);
    expect(issues('bark-set', barks({ chance: 1.5 }))).toHaveLength(1);
    expect(issues('bark-set', barks({ priority: 4 }))).toHaveLength(1);
    expect(issues('bark-set', barks({}, { chance: -0.1 }))).toHaveLength(1);
  });
});
