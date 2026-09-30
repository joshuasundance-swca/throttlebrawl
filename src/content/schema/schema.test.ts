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
