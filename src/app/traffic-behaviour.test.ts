// W-P contract (2026-10-01): a traffic type's behaviour flags reach SimConfig, and only the flags
// the content sets (an absent flag keeps the category default). The schema side is in
// src/content/schema/traffic-behaviour.test.ts.
import { describe, expect, it } from 'vitest';
import { trafficBehaviour } from './config';

describe('traffic behaviour flags reach the sim (W-P)', () => {
  it('copies only the flags the sim acts on, and only those set', () => {
    expect(trafficBehaviour(undefined)).toEqual({});
    // The M1 flags the sim does not read (car-following, dives) do not reach it.
    expect(trafficBehaviour({ carFollowing: true, dives: false })).toEqual({});
    expect(trafficBehaviour({ carFollowing: true, laneChanges: false, kerb: true, weaveM: 0.4 })).toEqual({
      behaviour: { laneChanges: false, kerb: true, weaveM: 0.4 },
    });
    expect(trafficBehaviour({ convoy: 3, strolls: true, chases: false })).toEqual({
      behaviour: { convoy: 3, strolls: true, chases: false },
    });
  });
});
