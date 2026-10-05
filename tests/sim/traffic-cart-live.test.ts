/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// Playtest 4 (P4-3, "golf carts and similar things should swerve out of the way"; the maintainer's
// answer for the cart you still clip: "Keep it a crash"): over ten seeded Key West races, where the
// golf carts ride the shoulder, every rider (the bot, the rivals, the cops) meets them and crashes
// into them next to never. The same ten races with the dodge off (`traffic.kerbYield` 0) are the
// "before" column in the printed counts: the cart's dodge used to move it 5 cm, which was no better
// than none. A solid rear-end is still a crash (src/sim/traffic/kerb-yield.test.ts pins it), so the
// band is "near 0", not "0 by construction": a rider on the cart's line at speed on a road with no
// verge to give it room still meets it.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { createSim } from '../../src/sim/api';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const EVENT = 'base:keys-t2-spring-break';
const MAX_TICKS = 60 * 60 * 8;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const CART = /golf-cart$/;
const OFF = { 'traffic.kerbYield': 0 };

interface Tally {
  /** Rider crashes whose vehicle is a golf cart, every rider counted. */
  crashes: number;
  /** Wobbles with a golf cart (a graze or a side brush). */
  wobbles: number;
  /** Distinct golf carts alive at some tick of the race. */
  seen: number;
}

function ride(seed: number, tuning: Record<string, number>): Tally {
  const config = buildSimConfig(REG, STREAMS.forEvent(REG, EVENT), { seed, eventId: EVENT, tuning });
  const sim = createSim(config);
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  const bot = createBot();
  const tally: Tally = { crashes: 0, wobbles: 0, seen: 0 };
  let snap = sim.snapshot();
  const seen = new Set<number>();
  while (!sim.isOver() && sim.tick < MAX_TICKS) {
    const actions = emptyActions();
    bot.drive(snap, playerId, config.route, actions);
    sim.step([toSimInput(actions)]);
    snap = sim.snapshot();
    for (const e of sim.events()) {
      const vehicle = e.data['vehicle'];
      if (e.data['cause'] !== 'traffic' || typeof vehicle !== 'string' || !CART.test(vehicle)) continue;
      if (e.type === 'crash') tally.crashes++;
      else if (e.type === 'wobble') tally.wobbles++;
    }
    for (const e of snap.entities) {
      if (e.kind === 'vehicle' && CART.test(e.contentId ?? '')) seen.add(e.id);
    }
  }
  tally.seen = seen.size;
  return tally;
}

describe('golf carts over ten Key West races', () => {
  it('riders crash into a golf cart next to never (before: the dodge off, counted)', () => {
    const before = SEEDS.map((seed) => ride(seed, OFF));
    const after = SEEDS.map((seed) => ride(seed, {}));
    const sum = (rows: Tally[], key: keyof Tally) => rows.reduce((n, r) => n + r[key], 0);
    process.stdout.write(
      `[cart live] ${SEEDS.length} Key West seeds (${EVENT}), golf carts, every rider counted. ` +
        `before (dodge off): ${sum(before, 'crashes')} crash, ${sum(before, 'wobbles')} wobble; ` +
        `after: ${sum(after, 'crashes')} crash, ${sum(after, 'wobbles')} wobble; ` +
        `carts alive: ${sum(after, 'seen')}\n`,
    );
    // The races meet them (otherwise this proves nothing).
    expect(sum(after, 'seen')).toBeGreaterThan(0);
    // Near 0 over ten races, and never above what no dodge at all gave.
    expect(sum(after, 'crashes')).toBeLessThanOrEqual(2);
    expect(sum(after, 'crashes')).toBeLessThanOrEqual(sum(before, 'crashes'));
  }, 600_000);
});
