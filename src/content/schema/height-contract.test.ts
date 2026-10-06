import { describe, expect, it } from 'vitest';
import { DEFAULT_HITBOX, hitboxOf, MAX_HEIGHT_M, SMASHABLE_KINDS, trafficHeightM } from '../../core';
import { ENTRY_SCHEMAS, SIM_EXCLUDED_FIELDS, type EntryType } from './index';

// The height contract (docs/content-packs.md, "Heights and hitboxes"): a height on traffic types and
// region smashables, and a contact box on bikes and riders. Every field is optional, so no format
// version moves and every pack file still validates; each has a passing case and failing ones. The
// objects are loose, so a field the schema does not name would pass any value: the failing cases
// are what show the schema reads the new fields.

const issues = (type: EntryType, value: unknown) => {
  const r = ENTRY_SCHEMAS[type].safeParse(value);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('/')}: ${i.message}`);
};

const truck = {
  type: 'traffic-type',
  id: 'box-truck',
  category: 'truck',
  lengthM: 7.5,
  widthM: 2.4,
  cruiseMps: 22,
  hazard: 'big',
};
const bike = {
  type: 'bike',
  id: 'lawnmower',
  class: 'lawnmower',
  handling: { topSpeedMps: 8, accelMps2: 1.8, brakeMps2: 5, steerRateMps: 4, massKg: 220 },
  engineSound: { preset: 'mower-putt' },
};
const rider = { type: 'rider', id: 'officer-meter', role: 'cop', bike: 'base:rustbucket-400' };
const region = {
  type: 'region',
  id: 'florida-keys',
  networks: ['osm-keys-seven-mile'],
  timeOfDayOptions: [{ id: 'day', lighting: 'noon' }],
  traffic: { mix: [{ kind: 'box-truck', weight: 1 }] },
  smashables: [{ id: 'traps', kind: 'lobster-traps', text: 'CATCH OF THE DAY' }],
};

describe('traffic type heightM', () => {
  it('is optional, and takes a height above zero up to the bound', () => {
    expect(issues('traffic-type', truck)).toEqual([]);
    expect(issues('traffic-type', { ...truck, heightM: 3.4 })).toEqual([]);
    expect(issues('traffic-type', { ...truck, heightM: MAX_HEIGHT_M })).toEqual([]);
  });

  it('rejects zero, a negative, a typo past the bound and a string', () => {
    for (const heightM of [0, -3.4, MAX_HEIGHT_M + 0.5, '3.4', null])
      expect(issues('traffic-type', { ...truck, heightM }), `heightM ${String(heightM)}`).toEqual([
        expect.stringMatching(/^heightM: /),
      ]);
  });

  it('is sim-facing: not on the list of fields left out of the sim hash', () => {
    expect(SIM_EXCLUDED_FIELDS['traffic-type']).not.toContain('heightM');
    expect(SIM_EXCLUDED_FIELDS['bike']).not.toContain('hitbox');
    expect(SIM_EXCLUDED_FIELDS['rider']).not.toContain('hitbox');
    expect(SIM_EXCLUDED_FIELDS['region']).not.toContain('smashables');
  });

  it('falls back to its category when the file gives none', () => {
    expect(trafficHeightM({ category: 'truck', heightM: 3.4 })).toBe(3.4);
    expect(trafficHeightM({ category: 'truck' })).toBeGreaterThan(3);
    expect(trafficHeightM({ category: 'pedestrian' })).toBeLessThan(2);
  });
});

describe('bike and rider hitbox', () => {
  it('is optional, and takes a length and a width', () => {
    expect(issues('bike', bike)).toEqual([]);
    expect(issues('bike', { ...bike, hitbox: { lengthM: 1.65, widthM: 1.15 } })).toEqual([]);
    expect(issues('rider', rider)).toEqual([]);
    expect(issues('rider', { ...rider, hitbox: { lengthM: 1.7, widthM: 1.1 } })).toEqual([]);
  });

  it('rejects a box with a missing, zero, negative or oversized side', () => {
    for (const type of ['bike', 'rider'] as const) {
      const base = type === 'bike' ? bike : rider;
      for (const hitbox of [
        { lengthM: 1.65 },
        { widthM: 1.15 },
        { lengthM: 0, widthM: 1 },
        { lengthM: 2, widthM: -1 },
        { lengthM: 20, widthM: 1 },
        { lengthM: 2, widthM: 9 },
        '2 x 0.8',
      ])
        expect(issues(type, { ...base, hitbox }).length, `${type} ${JSON.stringify(hitbox)}`).toBeGreaterThan(
          0,
        );
    }
  });

  it("resolves a rider's own box over its bike's, and the default when neither gives one", () => {
    const a = { lengthM: 1.65, widthM: 1.15 };
    const b = { lengthM: 1.7, widthM: 1.1 };
    expect(hitboxOf(b, a)).toBe(b);
    expect(hitboxOf(undefined, a)).toBe(a);
    expect(hitboxOf()).toBe(DEFAULT_HITBOX);
    expect(DEFAULT_HITBOX).toEqual({ lengthM: 2, widthM: 0.8 });
  });
});

describe('region smashable heightM', () => {
  const withItem = (extra: Record<string, unknown>) => ({
    ...region,
    smashables: [{ id: 'traps', kind: SMASHABLE_KINDS[0], text: 'CATCH OF THE DAY', ...extra }],
  });

  it('is optional, and takes a height above zero up to the bound', () => {
    expect(issues('region', region)).toEqual([]);
    expect(issues('region', withItem({ heightM: 1.7 }))).toEqual([]);
  });

  it('rejects zero, a negative and a typo past the bound', () => {
    for (const heightM of [0, -1.7, MAX_HEIGHT_M + 1, '1.7'])
      expect(issues('region', withItem({ heightM })), `heightM ${String(heightM)}`).toEqual([
        expect.stringMatching(/^smashables\/0\/heightM: /),
      ]);
  });
});
