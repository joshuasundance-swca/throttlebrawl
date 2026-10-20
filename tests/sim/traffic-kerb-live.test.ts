/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// Playtest 3, traffic manners (T4.1; docs/architecture.md, "Traffic"): over ten seeded San Francisco
// races, where the e-scooters and delivery e-bikes ride the kerb, the bot never crashes into a light
// kerb rider: every contact is a wobble with `data.kerb` and the cyclist topples. The ten enabled
// seeds run as serial cases with per-seed safety assertions and an aggregate exposure check. The
// controlled negative cases (including disabled soft contact and absent tuning keys) are in
// src/sim/traffic/kerb-yield.test.ts.
import { afterAll, describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { createSim, type SimEvent } from '../../src/sim/api';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const EVENT = 'region-sf:sf-hill-sprint';
const MAX_TICKS = 60 * 60 * 8;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
/** The light kerb types the lane names for this race: the e-scooters and the delivery e-bike. */
const LIGHT_KERB = /(e-scooter-rider|delivery-e-bike)$/;
const isLight = (e: SimEvent): boolean => {
  const vehicle = e.data['vehicle'];
  return typeof vehicle === 'string' && LIGHT_KERB.test(vehicle);
};

interface Tally {
  /** Rider crashes whose vehicle is a light kerb type. */
  crashes: number;
  otherWobbles: number;
  /** Distinct light kerb riders (by vehicle slot) that were alive at some tick of the race. */
  kerbSeen: number;
}

function ride(seed: number, tuning: Record<string, number>): Tally {
  const config = buildSimConfig(REG, STREAMS.forEvent(REG, EVENT), { seed, eventId: EVENT, tuning });
  const sim = createSim(config);
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  const bot = createBot();
  const tally: Tally = { crashes: 0, otherWobbles: 0, kerbSeen: 0 };
  let snap = sim.snapshot();
  const seen = new Set<number>();
  while (!sim.isOver() && sim.tick < MAX_TICKS) {
    const actions = emptyActions();
    bot.drive(snap, playerId, config.route, actions);
    sim.step([toSimInput(actions)]);
    snap = sim.snapshot();
    for (const e of sim.events()) {
      if (!isLight(e) || e.data['cause'] !== 'traffic') continue;
      if (e.type === 'crash') tally.crashes++;
      else if (e.type === 'wobble' && e.data['kerb'] !== true) tally.otherWobbles++;
    }
    for (const e of snap.entities) {
      if (e.kind !== 'vehicle' || !LIGHT_KERB.test(e.contentId ?? '') || seen.has(e.id)) continue;
      seen.add(e.id);
    }
  }
  tally.kerbSeen = seen.size;
  return tally;
}

describe('kerb riders over ten San Francisco races', () => {
  const results = new Map<number, Tally>();
  const durationsMs = new Map<number, number>();
  const caseTimeoutMs = 300_000 / SEEDS.length;

  it.each(SEEDS)(
    'seed %s has no crash or non-kerb wobble',
    (seed) => {
      const started = performance.now();
      const result = ride(seed, {});
      durationsMs.set(seed, performance.now() - started);
      results.set(seed, result);
      expect(result.crashes).toBe(0);
      expect(result.otherWobbles).toBe(0);
    },
    caseTimeoutMs,
  );

  afterAll(() => {
    const expectedSeeds = new Set(SEEDS);
    const actualSeeds = new Set(results.keys());
    expect([...actualSeeds].sort((a, b) => a - b)).toEqual([...expectedSeeds].sort((a, b) => a - b));
    const kerbSeen = [...results.values()].reduce((total, result) => total + result.kerbSeen, 0);
    expect(kerbSeen).toBeGreaterThan(0);
    const timings = SEEDS.map((seed) => `${seed}=${(durationsMs.get(seed) ?? 0).toFixed(0)}ms`).join(' ');
    const overruns = SEEDS.filter((seed) => (durationsMs.get(seed) ?? 0) > caseTimeoutMs);
    process.stdout.write(
      `[kerb live] ${SEEDS.length} enabled SF seeds; kerb riders alive: ${kerbSeen}; ` +
        `case timings: ${timings}; overruns: ${overruns.length > 0 ? overruns.join(',') : 'none'}\n`,
    );
  });
});
