import { describe, expect, it } from 'vitest';
import { InputFlag, MOVING_DECKS_KEY, type SimEvent } from '../types';
import { createSim } from '../api';
import { riderState } from './index';
import { input, riderHarness, testConfig } from './testing';

function ride(wheelie: boolean, grade = 0.25, multiplier = 1) {
  const config = testConfig({
    edges: [
      { id: 'runup', lengthM: 200, kappa: 0 },
      { id: 'ramp', lengthM: 16, kappa: 0, grade },
      { id: 'landing', lengthM: 600, kappa: 0 },
    ],
  });
  config.speedMultiplier = multiplier;
  const h = riderHarness(config, { s: 190, d: 0, speed: 34 * multiplier });
  const st = riderState(h.world);
  const events: SimEvent[] = [];
  let maxPitch = 0;
  for (let tick = 0; tick < 360 && !events.some((e) => e.type === 'land'); tick++) {
    const gas = input(h.rider.speed < 34 * multiplier ? 1 : 0.6);
    events.push(...h.step({ ...gas, flags: wheelie ? InputFlag.wheelie : 0 }));
    maxPitch = Math.max(maxPitch, st.pitch[h.rider.id] ?? 0);
  }
  return { events, maxPitch, land: events.find((e) => e.type === 'land') };
}

describe('wheelie into a ramp', () => {
  it('automatically completes a backflip and lands without claiming a car launch', () => {
    const r = ride(true);
    expect(r.events.some((e) => e.type === 'jump')).toBe(true);
    expect(r.maxPitch).toBeGreaterThan(Math.PI);
    expect(r.land?.data).toMatchObject({ trick: 'backflip', flips: 1, quality: 'clean' });
    expect(r.land?.data['hood']).not.toBe(true);
    expect(r.events.filter((e) => e.type === 'wheelieEnd')).toHaveLength(1);
    expect(r.events.some((e) => e.type === 'hoodLaunch' || e.type === 'crash')).toBe(false);
  });

  it('keeps an ordinary ramp jump level and leaves its launch speed unchanged', () => {
    const ordinary = ride(false);
    const wheelie = ride(true);
    expect(ordinary.land?.data).toMatchObject({ trick: '', flips: 0, quality: 'clean' });
    expect(wheelie.events.find((e) => e.type === 'jump')?.data['vyMps']).toBe(
      ordinary.events.find((e) => e.type === 'jump')?.data['vyMps'],
    );
  });

  it('does not force a flip into a short hop that cannot fit one', () => {
    const r = ride(true, 0.08);
    expect(r.land).toBeDefined();
    expect(r.land?.data['flips']).toBe(0);
    expect(r.events.some((e) => e.type === 'crash')).toBe(false);
  });

  it('still flips with the lower overall speed setting', () => {
    const r = ride(true, 0.25, 0.5);
    expect(r.land?.data['trick']).toBe('backflip');
    expect(r.land?.data['quality']).toBe('clean');
  });

  it('works from a moving carrier ramp at the actual relative takeoff speed', () => {
    const h = riderHarness(testConfig(), { s: 574, d: 3.4, speed: 34 });
    const events: SimEvent[] = [];
    for (let tick = 0; tick < 420 && !events.some((e) => e.type === 'land'); tick++) {
      h.world.systems[MOVING_DECKS_KEY] = {
        live: [
          {
            vehicle: 99,
            edge: 0,
            s0: 600 + (8 * tick) / 60,
            dir: 1,
            d0: 2.2,
            d1: 4.6,
            speedMps: 8,
            rampLengthM: 5,
            lipHeightM: 2.4,
            bodyM: 2.5,
          },
        ],
      };
      const theta = riderState(h.world).wheelie[h.rider.id] ?? 0;
      events.push(...h.step({ ...input(1), flags: theta < 0.7 ? InputFlag.wheelie : 0 }));
    }
    const land = events.find((e) => e.type === 'land');
    expect(land?.data['trick']).toBe('backflip');
    expect(land?.data['quality']).not.toBe('crash');
    // This steep carrier can land hard; flipping does not soften its real vertical impact.
    expect(Number(land?.data['verticalMps'])).toBeGreaterThan(14);
    expect(events.some((e) => e.type === 'hoodLaunch' || e.type === 'crash')).toBe(false);
  });

  it('scores one ordinary ramp trick and replays to identical hashes', () => {
    const run = () => {
      const c = testConfig({
        edges: [
          { id: 'runup', lengthM: 200, kappa: 0 },
          { id: 'ramp', lengthM: 16, kappa: 0, grade: 0.25 },
          { id: 'landing', lengthM: 600, kappa: 0 },
        ],
        start: { road: 'runup', s: 150, dir: 1 },
      });
      c.event = {
        ...c.event,
        style: {
          perNearMissCash: 0,
          perAirtimeCash: 50,
          perOncomingSecondCash: 0,
          perTakedownCash: 0,
          takedownComboScale: 0,
          perStealCash: 0,
        },
      };
      const sim = createSim(c);
      const hashes: number[] = [];
      const events: SimEvent[] = [];
      for (let tick = 0; tick < 600 && !events.some((e) => e.type === 'land'); tick++) {
        const me = sim.snapshot().entities.find((e) => e.slot === 0);
        const flags = me?.mode === 'Road' && me.road.edge === 1 ? InputFlag.wheelie : 0;
        sim.step([{ ...input(1), flags }]);
        hashes.push(sim.hash());
        events.push(...sim.events());
      }
      return { hashes, events };
    };
    const a = run();
    expect(run().hashes).toEqual(a.hashes);
    const tricks = a.events.filter((e) => e.type === 'style' && e.data['kind'] === 'trick');
    expect(tricks).toHaveLength(1);
    expect(tricks[0]?.data).toMatchObject({ trick: 'backflip', points: 100 });
  });
});
