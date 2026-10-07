/// <reference types="vite/client" />
// Rivals and cops see the solid street furniture (the live check of #610, #618 and #619, mustFix 2).
// With the furniture solid, rivals crashed into Russian Hill's street trees and lamps, and Duval's
// planters, which nothing in their lines knew of: in that check's seeded bot races, 20 rival crashes
// with the furniture on against 10 with it off, and 23 live rival crashes on furniture (14 on street
// trees). The rival AI and the cops now see each solid piece as an obstacle that stands still
// (sim/ai/sense `furnitureSeen`), slow for a bend on a furniture-lined street (`bendSpeed`, or they are
// carried wide onto the sidewalk), and ride back off a sidewalk at a crawl (`offRoadAmongFixed`).
//
// Seeded bot races (the dev bot rides the player) on Russian Hill and Duval Street, each seed with the
// furniture on and with it off (`riders.furniture`), in the full world with the road events off (they
// reshuffle every race): traffic, and the patrol and the heat that send the cops. Not the isolation
// profile: with no traffic to go round and no cops, the rivals never leave the road, so they never met
// the furniture (measured: 0 contacts in 8 races); nor tests/sim/batch.ts NO_ROAD_EVENTS, which sends
// no cop here.
// - A rival's crashes on a piece of furniture that no rider's hit sent it into (a takedown is the game:
//   a rider knocked into a tree is a fair kill) are near none, and so are a cop's;
// - the rivals' crashes overall are near the furniture-off level, a band over every race.
// Negative controls: the rivals still meet the furniture (a wobble off a piece, or a takedown into
// one), so "no crash" is not "never near it"; and with the furniture off nothing of it is met.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { createSim } from '../../src/sim/api';
import { seedRange } from './batch';

const print = (line: string) => process.stdout.write(`[ai-furniture] ${line}\n`);

const ALL = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const EVENTS = ['region-sf:sf-t2-russian-hill', 'base:keys-t1-last-light-duval'];
const SEEDS = seedRange(1, 3);
/** The world: everything on (traffic, the cops' patrol and heat), road events off (they reshuffle every race). */
const WORLD: Readonly<Record<string, number>> = { 'modifiers.setPieceChance': 0 };
const MAX_TICKS = 60 * 60 * 6;

interface Tally {
  races: number;
  rivalCrashes: number;
  /** Rival crashes on a piece of street furniture, and those a rider's hit sent it into (a takedown). */
  rivalFurniture: number;
  rivalTakedowns: number;
  /** Rival wobbles off a solid piece (it met one and rode on). */
  rivalWobbles: number;
  copCrashes: number;
  copFurniture: number;
}

const empty = (): Tally => ({
  races: 0,
  rivalCrashes: 0,
  rivalFurniture: 0,
  rivalTakedowns: 0,
  rivalWobbles: 0,
  copCrashes: 0,
  copFurniture: 0,
});

function race(into: Tally, eventId: string, seed: number, tuning: Record<string, number>): void {
  const config = buildSimConfig(ALL, STREAMS.forEvent(ALL, eventId), { seed, eventId, tuning });
  const sim = createSim(config);
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  const bot = createBot();
  // A rival's furniture crash waiting for combat's takedown credit (it comes a tick or two later).
  const pending = new Set<number>();
  let snap = sim.snapshot();
  while (!sim.isOver() && sim.tick < MAX_TICKS) {
    const a = emptyActions();
    bot.drive(snap, playerId, config.route, a);
    sim.step([toSimInput(a)]);
    snap = sim.snapshot();
    for (const e of sim.events()) {
      if (e.type === 'takedown' && e.target !== undefined && pending.delete(e.target)) into.rivalTakedowns++;
      if (e.actor === playerId) continue;
      const rider = config.riders[e.actor];
      if (!rider || rider.controller.kind === 'player') continue;
      const law = rider.faction === 'law';
      const onFurniture = e.data['furniture'] !== undefined;
      if (e.type === 'crash') {
        if (law) {
          into.copCrashes++;
          if (onFurniture) into.copFurniture++;
        } else {
          into.rivalCrashes++;
          if (onFurniture) {
            into.rivalFurniture++;
            pending.add(e.actor);
          }
        }
      } else if (e.type === 'wobble' && onFurniture && !law && e.data['cause'] !== 'smash')
        into.rivalWobbles++;
    }
  }
  into.races++;
}

const line = (name: string, t: Tally) =>
  `${name}: ${t.races} races; rival crashes ${t.rivalCrashes}, on furniture ${t.rivalFurniture} (takedowns ${t.rivalTakedowns}), rival wobbles off a solid piece ${t.rivalWobbles}; cop crashes ${t.copCrashes}, on furniture ${t.copFurniture}`;

describe('rivals and cops see the solid street furniture (the live check of #619, mustFix 2)', () => {
  it('almost no rival or cop crash on furniture but a takedown; rival crashes near the furniture-off level', () => {
    const on = empty();
    const off = empty();
    for (const eventId of EVENTS)
      for (const seed of SEEDS) {
        race(on, eventId, seed, { ...WORLD, 'riders.furniture': 1 });
        race(off, eventId, seed, { ...WORLD, 'riders.furniture': 0 });
      }
    print(line('furniture on', on));
    print(line('furniture off', off));
    // The controls: with it off nothing of it is met; with it on, the rivals do meet it (a wobble off a
    // piece, or a takedown into one), and cops are sent (the count can see them).
    expect(off.rivalFurniture + off.rivalWobbles + off.copFurniture).toBe(0);
    expect(on.rivalWobbles + on.rivalTakedowns).toBeGreaterThan(0);
    expect(on.copCrashes + off.copCrashes).toBeGreaterThan(0);
    // Their own crashes on furniture (not a takedown) are near none, a rival's or a cop's.
    expect(on.rivalFurniture - on.rivalTakedowns).toBeLessThanOrEqual(2);
    expect(on.copFurniture).toBeLessThanOrEqual(1);
    // And the rivals' crashes overall are near the furniture-off level.
    expect(on.rivalCrashes).toBeLessThanOrEqual(Math.ceil(off.rivalCrashes * 1.25) + 2);
  }, 900_000);
});
