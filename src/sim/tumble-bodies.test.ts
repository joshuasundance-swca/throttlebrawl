// The tumble-bodies wire (EntitySnapshot.tumble, for M2 render-2's cartwheeling bike): while a
// rider tumbles, the snapshot carries the tumble system's rider and bike bodies; otherwise null.
// Presentation only: reading it never changes the state hash.
import { describe, expect, it } from 'vitest';
import { quantizeInput } from './api';
import { createSim } from './create';
import { testConfig } from './riders/testing';

describe('sim snapshot: the tumble bodies', () => {
  it('carries both crash bodies while the rider tumbles, and null otherwise', () => {
    // A barrier crash: full throttle and full lock into the right barrier, with a low crash speed.
    const sim = createSim(testConfig({ tuning: { 'riders.crashImpactMps': 3 } }));
    let tumbleTicks = 0;
    let apart = 0;
    let movingBike = 0;
    let after = 0;
    for (let t = 0; t < 60 * 30 && after < 60; t++) {
      const me = sim.snapshot().entities[0];
      if (!me) throw new Error('no rider');
      if (me.mode === 'Tumble') {
        tumbleTicks++;
        const bodies = me.tumble;
        expect(bodies, `tick ${t}`).toBeTruthy();
        if (!bodies) break;
        const all = [bodies.rider, bodies.bike].flatMap((b) => [b.x, b.y, b.z, b.vx, b.vy, b.vz]);
        expect(all.every(Number.isFinite), `tick ${t}`).toBe(true);
        // The rider body is where the entity is drawn (its projection keeps x and z).
        expect(Math.hypot(bodies.rider.x - me.x, bodies.rider.z - me.z)).toBeLessThan(1.5);
        if (Math.hypot(bodies.bike.x - bodies.rider.x, bodies.bike.z - bodies.rider.z) > 0.5) apart++;
        if (Math.hypot(bodies.bike.vx, bodies.bike.vy, bodies.bike.vz) > 1) movingBike++;
      } else {
        expect(me.tumble ?? null, `${me.mode} at tick ${t}`).toBeNull();
        if (tumbleTicks > 0) after++;
      }
      const crashedYet = tumbleTicks > 0 || me.mode !== 'Road';
      sim.step([quantizeInput({ throttle: 1, brake: 0, steer: crashedYet ? 0 : 1, flags: 0 })]);
    }
    console.log(
      `[examined] ${tumbleTicks} tumble ticks: bodies apart on ${apart}, bike moving on ${movingBike}`,
    );
    expect(tumbleTicks).toBeGreaterThan(0);
    // The two bodies fly separately: the bike ends up away from the rider and moves on its own.
    expect(apart).toBeGreaterThan(0);
    expect(movingBike).toBeGreaterThan(0);
    expect(after).toBeGreaterThan(0);
  });

  it('never changes the state hash', () => {
    const sim = createSim(testConfig({ tuning: { 'riders.crashImpactMps': 3 } }));
    for (let t = 0; t < 600; t++) {
      const before = sim.hash();
      sim.snapshot();
      expect(sim.hash()).toBe(before);
      sim.step([quantizeInput({ throttle: 1, brake: 0, steer: 1, flags: 0 })]);
    }
  });
});
