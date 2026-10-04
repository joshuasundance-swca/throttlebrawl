/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// Playtest 3, traffic manners (T4.1; docs/architecture.md, "Traffic"): over ten seeded San Francisco
// races, where the e-scooters and delivery e-bikes ride the kerb, the bot never crashes into a light
// kerb rider: every contact is a wobble with `data.kerb` and the cyclist topples. The same ten races
// with the two sliders at 0 (`traffic.kerbYield`, `traffic.kerbSoft`: the rules before this change)
// are the "before" column in the printed counts, so the test shows what the change did. The scenario
// cases (the dodge's timing and clearance, the topple, the golf cart) are in
// src/sim/traffic/kerb-yield.test.ts.
import { describe, expect, it } from 'vitest';
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
const OFF = { 'traffic.kerbYield': 0, 'traffic.kerbSoft': 0 };

const isLight = (e: SimEvent): boolean => {
  const vehicle = e.data['vehicle'];
  return typeof vehicle === 'string' && LIGHT_KERB.test(vehicle);
};

interface Tally {
  /** Rider crashes whose vehicle is a light kerb type. */
  crashes: number;
  /** Wobbles with a light kerb type: the soft contacts (`kerb` true) and any other. */
  softWobbles: number;
  otherWobbles: number;
  /** Distinct light kerb riders (by vehicle slot) that were alive at some tick of the race. */
  kerbSeen: number;
}

function ride(seed: number, tuning: Record<string, number>): Tally {
  const config = buildSimConfig(REG, STREAMS.forEvent(REG, EVENT), { seed, eventId: EVENT, tuning });
  const sim = createSim(config);
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  const bot = createBot();
  const tally: Tally = { crashes: 0, softWobbles: 0, otherWobbles: 0, kerbSeen: 0 };
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
      else if (e.type === 'wobble') {
        if (e.data['kerb'] === true) tally.softWobbles++;
        else tally.otherWobbles++;
      }
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
  it('no rider crashes into a light kerb rider (before: the old rules, counted)', () => {
    const before: Tally[] = SEEDS.map((seed) => ride(seed, OFF));
    const after: Tally[] = SEEDS.map((seed) => ride(seed, {}));
    const sum = (rows: Tally[], key: keyof Tally) => rows.reduce((n, r) => n + r[key], 0);
    process.stdout.write(
      `[kerb live] ${SEEDS.length} SF seeds, e-scooters and delivery e-bikes. ` +
        `before (sliders 0): ${sum(before, 'crashes')} crash, ${sum(before, 'otherWobbles')} wobble; ` +
        `after: ${sum(after, 'crashes')} crash, ${sum(after, 'softWobbles')} soft wobble ` +
        `(${sum(after, 'otherWobbles')} other); light kerb riders alive: ${sum(after, 'kerbSeen')}\n`,
    );
    // The races meet them (otherwise this proves nothing), and none crashes a rider.
    expect(sum(after, 'kerbSeen')).toBeGreaterThan(0);
    expect(sum(after, 'crashes')).toBe(0);
    expect(sum(after, 'otherWobbles')).toBe(0);
  }, 300_000);
});
