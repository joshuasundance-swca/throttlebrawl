// combat-1 acceptance items 8 and 9, through the real sim (createSim with every system): the
// hit-stop freezes positions while inputs keep being sampled, and a scripted fight replays exactly.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureNetwork } from '../../road';
import { createSim, quantizeInput, SIM_TUNING, tuningDefaults, type SimConfig, type SimInput } from '../api';
import { F, KICK, PUNCH } from './harness.test-util';

const BIKE = {
  contentId: 'base:bike',
  topSpeedMps: 38,
  accelMps2: 4.2,
  brakeMps2: 9,
  steerRateMps: 5.5,
  massKg: 180,
};

/** Two player-driven riders side by side on the grid's first row (1.5 m apart), a straight road. */
function duelConfig(): SimConfig {
  const road = createRoadNetwork(fixtureNetwork([{ id: 'a', lengthM: 1500, kappa: 0 }]));
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 40, dir: 1 },
    finish: { road: 'a', s: 1480 },
    mainPath: ['a'],
    allowedRoads: ['a'],
    closed: false,
  });
  const rider = (i: number, slot: number) => ({
    contentId: `base:r${i}`,
    name: `R${i}`,
    role: slot === 0 ? ('player' as const) : ('rival' as const),
    faction: 'rider' as const,
    controller: { kind: 'player' as const, slot },
    bike: BIKE,
    massKg: 80,
    healthMax: 100,
  });
  return {
    seed: 99,
    event: {
      contentId: 'base:e',
      kind: 'classic-race',
      paceMps: 30,
      byPlaceCash: [],
      raceEndTimeoutTicks: 1800,
    },
    riders: [rider(0, 1), rider(1, 0)],
    weapons: [PUNCH, KICK],
    trafficTypes: [],
    road,
    route,
    modifiers: [],
    grudges: {},
    tuning: tuningDefaults(SIM_TUNING.filter((d) => d.affectsSim)),
    difficulty: { presetId: 'normal', riderAggression: 1, copFrequency: 1, rubberBand: 1 },
    assists: 'off',
    slowMo: false,
    playerSlots: 2,
  };
}

const ride = (flags = 0, steer = 0): SimInput => quantizeInput({ throttle: 1, brake: 0, steer, flags });

describe('combat-1 through the real sim', () => {
  it('8. after a player-involved hit, positions hold for 4 ticks while inputs are still recorded', () => {
    const KICK_AT = 90;
    const run = (steerDuringFreeze: number) => {
      const sim = createSim(duelConfig());
      const frames: { tick: number; xs: number[]; ts: number; hash: number; hit: boolean }[] = [];
      for (let t = 0; t < 130; t++) {
        const freeze = t >= KICK_AT + 14 && t <= KICK_AT + 16;
        const player = ride(t === KICK_AT ? F.attack | F.kick : 0, freeze ? steerDuringFreeze : 0);
        sim.step([player, ride()]);
        const snap = sim.snapshot();
        frames.push({
          tick: t,
          xs: snap.entities.flatMap((e) => [e.x, e.z, e.road.s, e.road.d]),
          ts: snap.timeScale,
          hash: sim.hash(),
          hit: sim.events().some((e) => e.type === 'hit'),
        });
      }
      return frames;
    };
    const a = run(0);
    const hitAt = a.findIndex((f) => f.hit);
    expect(hitAt).toBe(KICK_AT + 13);
    const at = (i: number) => a[hitAt + i];
    for (let i = 1; i <= 4; i++) expect(at(i)?.xs).toEqual(at(0)?.xs);
    expect(at(5)?.xs).not.toEqual(at(0)?.xs);
    expect(a.slice(hitAt, hitAt + 4).map((f) => f.ts)).toEqual([0, 0, 0, 0]);
    expect(at(4)?.ts).toBe(1);

    // Inputs are still sampled during the freeze: a different steer changes the recorded state
    // (the hash covers the inputs) without moving anyone.
    const b = run(0.8);
    expect(b[hitAt + 2]?.xs).toEqual(a[hitAt + 2]?.xs);
    expect(b[hitAt + 2]?.hash).not.toBe(a[hitAt + 2]?.hash);
  });

  it('9. a scripted fight gives the same hash every run', () => {
    const fight = () => {
      const sim = createSim(duelConfig());
      const hashes: number[] = [];
      let hits = 0;
      for (let t = 0; t < 600; t++) {
        const p = t % 70 === 30 ? F.attack | F.kick : t % 70 === 55 ? F.attack : 0;
        const r = t % 90 === 45 ? F.attack : t % 90 === 50 ? F.kick : 0;
        sim.step([ride(p, 0.2 * Math.sin(t / 40)), ride(r)]);
        hits += sim.events().filter((e) => e.type === 'hit').length;
        if (t % 30 === 29) hashes.push(sim.hash());
      }
      return { hashes, hits };
    };
    const first = fight();
    const second = fight();
    expect(first.hits).toBeGreaterThan(0);
    expect(second.hashes).toEqual(first.hashes);
  });
});
