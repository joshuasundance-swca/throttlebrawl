// The parked-bike wire (EntitySnapshot.parkedBike, tumble-1's follow-up): a rider who crashed and
// is running back on foot sees its bike in the snapshot, where tumble-1 parked it; otherwise null.
import { describe, expect, it } from 'vitest';
import { atan2 } from '../core';
import { quantizeInput } from './api';
import { createSim } from './create';
import { testConfig } from './riders/testing';

describe('sim snapshot: the parked bike', () => {
  it('is where tumble-1 parked it while the rider is on foot, and null before and after', () => {
    // A barrier crash: full throttle and full lock into the right barrier, with a low crash speed.
    const config = testConfig({ tuning: { 'riders.crashImpactMps': 3 } });
    const sim = createSim(config);
    const modes = new Set<string>();
    let onFootTicks = 0;
    let remounted = false;
    for (let t = 0; t < 60 * 30 && !remounted; t++) {
      const me = sim.snapshot().entities[0];
      if (!me) throw new Error('no rider');
      modes.add(me.mode);
      if (me.mode === 'OnFoot') {
        onFootTicks++;
        const bike = me.parkedBike;
        expect(bike, `tick ${t}`).toBeTruthy();
        if (!bike) break;
        // Parked on the road surface, somewhere near the rider, facing along the road.
        expect([bike.x, bike.y, bike.z, bike.heading].every(Number.isFinite)).toBe(true);
        expect(Math.hypot(bike.x - me.x, bike.z - me.z)).toBeLessThan(80);
        const f = config.road.frameAt(0, 100);
        const along = atan2(-f.tx, -f.tz);
        const turn = Math.abs(((bike.heading - along + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        expect(Math.min(turn, Math.PI - turn)).toBeLessThan(0.3);
      } else {
        expect(me.parkedBike ?? null, `${me.mode} at tick ${t}`).toBeNull();
        if (onFootTicks > 0 && me.mode === 'Road') remounted = true;
      }
      const crashedYet = modes.has('Tumble') || modes.has('OnFoot');
      sim.step([quantizeInput({ throttle: 1, brake: 0, steer: crashedYet ? 0 : 1, flags: 0 })]);
    }
    expect(modes.has('Tumble'), `modes seen: ${[...modes].join(', ')}`).toBe(true);
    expect(onFootTicks).toBeGreaterThan(0);
    expect(remounted).toBe(true);
  });
});
