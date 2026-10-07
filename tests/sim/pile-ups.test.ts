// Pile-ups in whole races (the maintainer, 2026-10-06: "Pile ups are fun lol"): with a dropped bike solid
// by closing speed (sim/riders `droppedBikeContact`; the rule's own cases, and the rival going round one,
// are src/sim/tumble/pile-up.test.ts), a bike left on the road after a crash sometimes brings down a rider
// behind it, and not after every crash: it stands only while its rider runs back to it (about 2 s), and
// the rival AI and the cops keep their lines clear of it as of the solid street furniture.
//
// The band: seeded races of the base event under the isolation profile (one behaviour: the optional world
// off) with two systems back on, traffic (it brings most of a race's crashes, so most of its dropped
// bikes) and the street furniture (a dropped bike's contact, old or new, is part of it), and the rule on;
// the dev bot rides the player. All 64 races contribute to the upper band. A rare natural crash is
// not a floor: controlled contacts on the same shipped road prove the rule can cause a pile-up.
// firstSeed finds an observed dropped-bike contact for the old-rule control (`riders.pileUps` 0).
//
// Measured when the rule landed (base event, this profile, seeds 1 to 48): 152 crashes, 141 bikes left
// standing for 297 bike-seconds in all, 39 riders passing within 2.5 m of one along the road and 8 of them
// within 0.8 m across, 1 pile-up (seed 34, a rival into another's bike at 34 m/s, square on).
import { describe, expect, it } from 'vitest';
import { createHeadlessRace } from '../../src/app';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { createSimWithWorld } from '../../src/sim/create';
import { tumbleRecord, tumbleSystem } from '../../src/sim/tumble';
import { riderState } from '../../src/sim/riders';
import { emit } from '../../src/sim/world';
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

/** Two scripted riders on the shipped base road; tumble itself parks the first rider's bike. */
function controlledContact(speed: number, pileUps: 0 | 1) {
  const base = createHeadlessRace(
    { seed: 1, tuning: { ...ISOLATED, 'riders.furniture': 1, 'riders.pileUps': pileUps } },
    { includeDrafts: true },
  ).config;
  const player = base.riders.find((r) => r.controller.kind === 'player')!;
  const rival = base.riders.find((r) => r.controller.kind === 'ai')!;
  const config = {
    ...base,
    playerSlots: 2,
    riders: [player, { ...rival, controller: { kind: 'player' as const, slot: 1 } }],
  };
  const { sim, world } = createSimWithWorld(config);
  const owner = world.movers[1]!;
  const me = world.movers[0]!;
  const lane = config.road.lanesAt(0, 100).find((l) => l.direction === 1 && l.kind !== 'shoulder')!;
  expect(lane, 'the real base road has a forward lane').toBeDefined();
  owner.pos = { edge: 0, s: 100, d: lane.dCenterM, dir: 1 };
  owner.speed = 0;
  owner.yaw = 0;
  emit(world, 'crash', owner.id, {});
  tumbleSystem.step(world, config);
  const coast = { steer: 0, throttle: 0, brake: 0, flags: 0 };
  for (let t = 0; t < 400 && owner.mode !== 'OnFoot'; t++) sim.step([coast, coast]);
  const parked = tumbleRecord(world, owner.id)?.parked;
  expect(parked, 'the actual crash and hand-back parked the bike').toBeDefined();
  if (!parked) throw new Error('no naturally parked bike');
  owner.pos = { ...parked, s: parked.s + 40 };
  me.pos = { ...parked, s: parked.s - 8 };
  me.speed = speed;
  me.yaw = 0;
  me.h = 0;
  me.mode = 'Road';
  riderState(world).lastTick[me.id] = -2;
  const contacts = [];
  for (let t = 0; t < 90; t++) {
    sim.step([coast, coast]);
    contacts.push(...sim.events().filter((e) => e.actor === me.id && e.data['object'] === 'parked-bike'));
    if (contacts.length) break;
  }
  print(`controlled ${speed} m/s, rule ${pileUps}: ${JSON.stringify({ contacts, mode: me.mode, parked })}`);
  return { contacts, mode: me.mode, parked };
}

describe('pile-ups on the shipped base road (the maintainer, 2026-10-06)', () => {
  it('a fast square-on contact causes a pile-up; the same slow or old-rule contact wobbles', () => {
    const fast = controlledContact(20, 1);
    expect(fast.contacts.map((e) => e.type)).toEqual(['crash']);
    expect(fast.contacts[0]?.data).toMatchObject({ object: 'parked-bike', hit: 'end', bikeOf: '1' });
    expect(fast.mode).toBe('Tumble');
    for (const result of [controlledContact(8, 1), controlledContact(20, 0)]) {
      expect(result.contacts.map((e) => e.type)).toEqual(['wobble']);
      expect(result.mode).toBe('Road');
    }
  });

  it('do not dominate natural crashes; the old rule has none at an observed dropped-bike contact', () => {
    const seeds = seedRange(1, FIRST_SEED_MAX);
    const all = seeds.map((seed) => race(seed, 1));
    const search = firstSeed(
      'a natural dropped-bike contact',
      seeds,
      (seed) => all[seed - 1]!,
      (c) => c.pileUps + c.brushes > 0,
    );
    const crashes = all.reduce((n, c) => n + c.crashes, 0);
    const pileUps = all.reduce((n, c) => n + c.pileUps, 0);
    const brushes = all.reduce((n, c) => n + c.brushes, 0);
    print(
      `[examined] ${all.length} base-event races (ISOLATED with traffic and the street furniture on, bot player): ` +
        `${crashes} crashes, ${pileUps} pile-ups, ${brushes} wobbles off a dropped bike; ${search.summary}`,
    );
    expect(search.seed, search.summary).not.toBeNull();
    expect(crashes).toBeGreaterThan(0);
    expect(pileUps / crashes).toBeLessThanOrEqual(MAX_SHARE);
    // The control: the same race under the old rule.
    const old = race(search.seed ?? 1, 0);
    print(`control (old rule), seed ${search.seed}: ${JSON.stringify(old)}`);
    expect(old.pileUps).toBe(0);
  }, 900_000);
});
