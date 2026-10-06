// Pile-ups in whole races (the maintainer, 2026-10-06: "Pile ups are fun lol"): with a dropped bike solid
// by closing speed (sim/riders `droppedBikeContact`; the rule's own cases are src/sim/tumble/pile-up.test.ts),
// a bike left on the road after a crash sometimes brings down a rider behind it, and not after every
// crash: the rival AI, the cops and the dev bot see a dropped bike as a solid thing in their lines.
//
// The band: seeded races of the base event under the isolation profile (one behaviour: the optional
// world off), with the street furniture on (a dropped bike's contact, old or new, is part of it) and the
// rule on, the dev bot riding the player. Counted: every crash, and the pile-ups among them (a crash whose
// `object` is `parked-bike`). The control is the same races with the old rule (`riders.pileUps` 0):
// riders still meet dropped bikes there (the wobbles named `parked-bike` show the count can see them),
// and none of those meetings is a crash.
import { describe, expect, it } from 'vitest';
import { createHeadlessRace } from '../../src/app';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { ISOLATED, seedRange } from './batch';

const print = (line: string) => process.stdout.write(`[pile-ups] ${line}\n`);

const SEEDS = seedRange(1, Number(process.env['PILE_UP_SEEDS'] ?? 12));
/** A race stops here if it has not ended, ticks (the sim's own hard stop is 15 minutes). */
const CAP_TICKS = 15 * 60 * 60;

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
      tuning: {
        ...ISOLATED,
        'traffic.density': Number(process.env['PILE_UP_TRAFFIC'] ?? 0),
        'riders.furniture': 1,
        'riders.pileUps': pileUps,
      },
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

function total(counts: readonly Count[]): Count {
  return counts.reduce(
    (a, c) => ({
      crashes: a.crashes + c.crashes,
      pileUps: a.pileUps + c.pileUps,
      brushes: a.brushes + c.brushes,
    }),
    { crashes: 0, pileUps: 0, brushes: 0 },
  );
}

describe('pile-ups in seeded races (the maintainer, 2026-10-06)', () => {
  it('happen sometimes and not on every crash; the old rule (the control) never had one', () => {
    const now = SEEDS.map((seed) => race(seed, 1));
    const old = SEEDS.map((seed) => race(seed, 0));
    const a = total(now);
    const b = total(old);
    const racesWith = now.filter((c) => c.pileUps > 0).length;
    print(
      `[examined] ${SEEDS.length} base-event races (ISOLATED, furniture on, bot player), seeds ${SEEDS[0]} to ${SEEDS[SEEDS.length - 1]}`,
    );
    print(
      `rule on: ${a.crashes} crashes, ${a.pileUps} pile-ups in ${racesWith} races, ${a.brushes} wobbles off a dropped bike`,
    );
    print(`old rule: ${b.crashes} crashes, ${b.pileUps} pile-ups, ${b.brushes} wobbles off a dropped bike`);
    for (const [i, c] of now.entries())
      print(`  seed ${SEEDS[i]}: ${JSON.stringify(c)} | old ${JSON.stringify(old[i])}`);
    // The control: dropped bikes were met, and never brought anyone down.
    expect(b.brushes).toBeGreaterThan(0);
    expect(b.pileUps).toBe(0);
    // The band.
    expect(a.pileUps).toBeGreaterThan(0);
    expect(a.pileUps).toBeLessThan(a.crashes);
  }, 600_000);
});
