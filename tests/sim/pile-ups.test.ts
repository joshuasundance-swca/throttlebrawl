// Pile-ups in whole races (the maintainer, 2026-10-06: "Pile ups are fun lol"): with a dropped bike solid
// by closing speed (sim/riders `droppedBikeContact`; the rule's own cases, and the rival going round one,
// are src/sim/tumble/pile-up.test.ts), a bike left on the road after a crash sometimes brings down a rider
// behind it, and not after every crash: it stands only while its rider runs back to it (about 2 s), and
// the rival AI and the cops keep their lines clear of it as of the solid street furniture.
//
// The band: seeded races of the base event under the isolation profile (one behaviour: the optional world
// off) with two systems back on, traffic (it brings most of a race's crashes, so most of its dropped
// bikes) and the street furniture (a dropped bike's contact, old or new, is part of it), and the rule on;
// the dev bot rides the player. The search (firstSeed) stops at the first race with a pile-up (a crash
// whose `object` is `parked-bike`), and across the races it tried, pile-ups are a small share of the
// crashes. The control is that race with the old rule (`riders.pileUps` 0): no pile-up.
//
// Measured when the rule landed (base event, this profile, seeds 1 to 48): 152 crashes, 141 bikes left
// standing for 297 bike-seconds in all, 39 riders passing within 2.5 m of one along the road and 8 of them
// within 0.8 m across, 1 pile-up (seed 34, a rival into another's bike at 34 m/s, square on).
import { describe, expect, it } from 'vitest';
import { createHeadlessRace } from '../../src/app';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { firstSeed, FIRST_SEED_MAX, ISOLATED, seedRange } from './batch';

const print = (line: string) => process.stdout.write(`[pile-ups] ${line}\n`);

/** A race stops here if it has not ended, ticks (the sim's own hard stop is 15 minutes). */
const CAP_TICKS = 15 * 60 * 60;
/** The most of a race's crashes pile-ups may be, across the races searched: "not on every crash". */
const MAX_SHARE = 0.1;

interface Count {
  crashes: number;
  pileUps: number;
  /** Meetings with a dropped bike that were not a crash (wobbles naming `parked-bike`). */
  brushes: number;
}

function race(seed: number, pileUps: 0 | 1): Count {
  const { sim, route, playerId } = createHeadlessRace(
    {
      seed,
      tuning: { ...ISOLATED, 'traffic.density': 1, 'riders.furniture': 1, 'riders.pileUps': pileUps },
    },
    { includeDrafts: true },
  );
  const bot = createBot();
  const count: Count = { crashes: 0, pileUps: 0, brushes: 0 };
  let snap = sim.snapshot();
  while (!sim.isOver() && sim.tick < CAP_TICKS) {
    const actions = emptyActions();
    bot.drive(snap, playerId, route, actions);
    sim.step([toSimInput(actions)]);
    snap = sim.snapshot();
    for (const e of sim.events()) {
      const bike = e.data['object'] === 'parked-bike';
      if (e.type === 'crash') {
        count.crashes++;
        if (bike) count.pileUps++;
      } else if (e.type === 'wobble' && bike) count.brushes++;
    }
  }
  return count;
}

describe('pile-ups in seeded races (the maintainer, 2026-10-06)', () => {
  it('happen sometimes and not on every crash; the old rule (the control) has none', () => {
    const search = firstSeed(
      'a pile-up',
      seedRange(1, FIRST_SEED_MAX),
      (seed) => race(seed, 1),
      (c) => c.pileUps > 0,
    );
    const all = search.tried.map((t) => t.result);
    const crashes = all.reduce((n, c) => n + c.crashes, 0);
    const pileUps = all.reduce((n, c) => n + c.pileUps, 0);
    const brushes = all.reduce((n, c) => n + c.brushes, 0);
    print(
      `[examined] ${all.length} base-event races (ISOLATED with traffic and the street furniture on, bot player): ` +
        `${crashes} crashes, ${pileUps} pile-ups, ${brushes} wobbles off a dropped bike; ${search.summary}`,
    );
    expect(search.seed, search.summary).not.toBeNull();
    expect(pileUps / crashes).toBeLessThanOrEqual(MAX_SHARE);
    // The control: the same race under the old rule.
    const old = race(search.seed ?? 1, 0);
    print(`control (old rule), seed ${search.seed}: ${JSON.stringify(old)}`);
    expect(old.pileUps).toBe(0);
  }, 900_000);
});
