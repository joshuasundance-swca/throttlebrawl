// The M2 SimConfig contract (docs/milestones/M2.md, app-3 item 2): per-slot assists, the
// lower-overall-speed multiplier and the slow-motion toggle. Sim lanes read the first two through
// the sim/world resolvers, so a config without them (every M1 fixture) means "no assists, full
// speed", and a bad value can never reach the physics.
import { describe, expect, it } from 'vitest';
import { createSim, neutralInput, type SimConfig } from './api';
import { testConfig } from './riders/testing';
import { slotAssists, speedMultiplierOf, NO_ASSISTS } from './world';

describe('the M2 SimConfig contract', () => {
  it('defaults to no assists and full speed when a config leaves them out', () => {
    const config = testConfig();
    expect(config.slots).toBeUndefined();
    expect(config.speedMultiplier).toBeUndefined();
    expect(slotAssists(config, 0)).toEqual({ steer: 'off', autoThrottle: false });
    expect(slotAssists(config, 0)).toEqual(NO_ASSISTS);
    expect(speedMultiplierOf(config)).toBe(1);
  });

  it('reads each human slot its own assists, so a second human can differ', () => {
    const config: SimConfig = {
      ...testConfig(),
      playerSlots: 2,
      slots: [
        { assists: { steer: 'strong', autoThrottle: true } },
        { assists: { steer: 'light', autoThrottle: false } },
      ],
    };
    expect(slotAssists(config, 0)).toEqual({ steer: 'strong', autoThrottle: true });
    expect(slotAssists(config, 1)).toEqual({ steer: 'light', autoThrottle: false });
    expect(slotAssists(config, 2)).toEqual(NO_ASSISTS);
    expect(slotAssists(config, -1)).toEqual(NO_ASSISTS); // an AI rider has no slot
  });

  it('keeps the speed multiplier inside (0, 1]', () => {
    const at = (speedMultiplier: number) => speedMultiplierOf({ ...testConfig(), speedMultiplier });
    expect(at(0.8)).toBe(0.8);
    expect(at(1)).toBe(1);
    expect(at(1.5)).toBe(1);
    expect(at(0)).toBe(1);
    expect(at(-0.5)).toBe(1);
    expect(at(Number.NaN)).toBe(1);
  });

  it('carries the new fields through a sim unchanged', () => {
    const config: SimConfig = {
      ...testConfig(),
      slots: [{ assists: { steer: 'strong', autoThrottle: false } }],
      speedMultiplier: 0.8,
      slowMo: true,
    };
    const sim = createSim(config);
    sim.step([neutralInput()]);
    expect(sim.config.slots?.[0]?.assists.steer).toBe('strong');
    expect(sim.config.speedMultiplier).toBe(0.8);
    expect(sim.config.slowMo).toBe(true);
  });
});
