// W-P contract (2026-10-01): a traffic type's behaviour flags pass the pack schema, and
// out-of-range ones fail it.
import { describe, expect, it } from 'vitest';
import { trafficTypeSchema } from './entries';

const base = {
  type: 'traffic-type',
  id: 'e-bike',
  category: 'car',
  lengthM: 1.8,
  widthM: 0.7,
  cruiseMps: 8,
  hazard: 'normal',
};

describe('traffic behaviour flags in the schema (W-P)', () => {
  it('takes the new flags and rejects out-of-range ones', () => {
    const ok = trafficTypeSchema.safeParse({
      ...base,
      behaviour: { carFollowing: true, laneChanges: false, dives: false, kerb: true, weaveM: 0.4, convoy: 3 },
    });
    expect(ok.success).toBe(true);
    expect(trafficTypeSchema.safeParse({ ...base, behaviour: { strolls: true, chases: true } }).success).toBe(
      true,
    );
    expect(trafficTypeSchema.safeParse({ ...base, behaviour: { convoy: 9 } }).success).toBe(false);
    expect(trafficTypeSchema.safeParse({ ...base, behaviour: { weaveM: -1 } }).success).toBe(false);
    expect(trafficTypeSchema.safeParse({ ...base, behaviour: { kerb: 'yes' } }).success).toBe(false);
    expect(trafficTypeSchema.safeParse(base).success).toBe(true);
  });
});
