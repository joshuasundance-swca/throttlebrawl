/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// Run W-U's live check, mustFix 1: the Mangrove Boardwalk (#405) rejoined the Mangrove Reach in the
// ONCOMING lane (d -3), so a rider came off the planks at race speed into the Keys' shuttles and
// RVs head-on: on the live game 4 traffic crashes in 8 player exits and 4 in 6 rival exits, against
// 1 in 53 on the main road through the same junction. The rejoin now lands in the travel lane.
//
// The race here is the long haul's Mangrove stretch on the base pack, with the full field (no cop:
// the dev bot never evades the law), traffic both ways and pedestrians. It starts on the Mangrove
// Cut, 180 m before the boardwalk's split, so each race reaches the junction in seconds. The player
// is the dev bot: shown the boardwalk (it goes for the first split it meets) or kept on the Mangrove
// Bend (its route shows it no split). The boardwalk leaves across the oncoming lanes, and the bot
// does not cross them while a car coming the other way is in the split's line (#658), so on this busy
// road it takes the planks in some races only (6 of 32 when that landed); the rivals give the rest of
// the exits. Every rider that comes onto the Reach is an exit, by the road it came off, and a traffic
// crash within 2 s of that is a crash at the merge.
//
// The fault was head-on: off the boardwalk, riders now land on the Reach's travel side and meet
// oncoming traffic no more often than riders off the main road. Rear-ending a same-way car just
// after a rejoin is another matter: the dev bot sees traffic only on its own road (src/dev/bot,
// `relative`), so it is blind to the car ahead until it is on the Reach. The same bot rear-ends cars
// off the boat ramp's rejoin, the Keys' oldest (d 3, the shape the boardwalk now has), about as
// often (5 of its 16 exits there, measured the same way while making this fix), so that rate gets a
// looser bound: a rejoin no worse than that one.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, DEFAULT_EVENT } from '../../src/app';
import { loadBasePack, lookup } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import type { BakedRoute } from '../../src/road/types';
import { createSim, type RouteProgress, type SimConfig } from '../../src/sim/api';
import { activateRegion } from '../../src/stream';

/** The boardwalk races' seeds; the main-road races use the first 8 (rivals give many more exits). */
const SEEDS = Array.from({ length: 32 }, (_, i) => i + 1);
const MAIN_SEEDS = SEEDS.slice(0, 8);
/** 2 s at 60 ticks a second: the live check's window after the merge. */
const WINDOW_TICKS = 120;
/** Every rider is past the merge well before this (the junction is about 1 km from the grid). */
const MAX_TICKS = 60 * 75;

interface Tally {
  exits: number;
  /** Traffic crashes within the window, and those into an oncoming vehicle (head-on). */
  crashes: number;
  headOn: number;
  lines: string[];
}

function mangroveRace(seed: number, playerTakesBoardwalk: boolean) {
  const reg = loadBasePack();
  const long = lookup(reg.routes, 'm1-long-haul');
  const network = lookup(reg.networks, long.network);
  const stream = activateRegion({ network, roads: network.roads.map((id) => lookup(reg.roads, id)) });
  // The long haul from the Mangrove Cut on: every road from there, the boardwalk and the sandbar
  // branches with them, to the end of Conch Row.
  const from = long.mainPath.indexOf('m1-mangrove-cut');
  const to = long.mainPath.indexOf('m1-conch-row');
  const mainPath = long.mainPath.slice(from, to + 1);
  const behind = new Set(long.mainPath.slice(0, from));
  const routeFile: BakedRoute = {
    ...long,
    id: 'm1-mangrove-stretch',
    start: { road: 'm1-mangrove-cut', s: 20, dir: 1 },
    finish: { road: 'm1-conch-row', s: 600 },
    mainPath,
    allowedRoads: long.allowedRoads.filter(
      (id) => !behind.has(id) && !id.startsWith('c-boat-ramp') && id !== 'm1-boat-ramp-cut',
    ),
    checkpoints: [{ road: 'm1-mangrove-reach', s: 200 }],
  };
  const built = buildSimConfig(reg, stream, { seed, eventId: DEFAULT_EVENT });
  const config: SimConfig = {
    ...built,
    riders: built.riders.filter((r) => r.faction !== 'law'),
    event: { ...built.event, routeId: 'base:m1-mangrove-stretch' },
    route: stream.routeFor(routeFile),
  };
  const sim = createSim(config);
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  const bot = createBot();
  // Kept on the bend: the same bot, shown a route with no split to take.
  const botRoute: RouteProgress = playerTakesBoardwalk ? config.route : { ...config.route, shortcuts: [] };
  const E = (id: string) => config.road.edgeIndex(id);
  const reach = E('m1-mangrove-reach');
  const offBoardwalk = E('c-boardwalk-out');
  const offBend = E('c-boardwalk-merge-main');
  const lastEdge = new Map<number, number>();
  /** Each exit onto the Reach: the rider, the road it came off and the tick. */
  const exits: { id: number; via: 'boardwalk' | 'main'; tick: number; d: number; speed: number }[] = [];
  const crashes: { id: number; tick: number; headOn: boolean; data: Record<string, unknown> }[] = [];
  let snap = sim.snapshot();
  let doneAt = -1;
  while (!sim.isOver() && sim.tick < MAX_TICKS) {
    const actions = emptyActions();
    bot.drive(snap, playerId, botRoute, actions);
    sim.step([toSimInput(actions)]);
    const events = sim.events();
    snap = sim.snapshot();
    for (const ev of events) {
      if (ev.type !== 'crash' || ev.data['cause'] !== 'traffic') continue;
      // Where the two were: the rider's lane, and the vehicle's lane and way (with or against it).
      const me = snap.entities[ev.actor];
      const car = ev.target === undefined ? undefined : snap.entities[ev.target];
      const headOn = !!car && !!me && car.road.edge === me.road.edge && car.road.dir !== me.road.dir;
      const way = headOn ? 'oncoming' : 'same way';
      const where = me && car ? `rider d ${me.road.d.toFixed(1)}, ${way} car d ${car.road.d.toFixed(1)}` : '';
      crashes.push({ id: ev.actor, tick: sim.tick, headOn, data: { ...ev.data, where } });
    }
    for (const e of snap.entities) {
      if (e.kind !== 'rider' || e.faction === 'law') continue;
      const before = lastEdge.get(e.id);
      lastEdge.set(e.id, e.road.edge);
      if (e.road.edge !== reach || before === reach) continue;
      if (before === offBoardwalk || before === offBend) {
        const via = before === offBoardwalk ? 'boardwalk' : 'main';
        // The first time each rider comes on (a crashed rider set back on the road is not an exit).
        if (!exits.some((x) => x.id === e.id)) {
          exits.push({ id: e.id, via, tick: sim.tick, d: e.road.d, speed: e.speed });
        }
      }
    }
    // Stop once every rider has had its exit and its window.
    const riders = snap.entities.filter((e) => e.kind === 'rider' && e.faction !== 'law').length;
    if (doneAt < 0 && exits.length === riders) doneAt = sim.tick + WINDOW_TICKS;
    if (doneAt >= 0 && sim.tick >= doneAt) break;
  }
  return { exits, crashes, playerId };
}

describe('W-U live check mustFix 1: the Mangrove Boardwalk rejoins in the travel lane', () => {
  it('riders off the boardwalk land in the travel lane and meet oncoming traffic no more than the main road', () => {
    const tally: Record<'boardwalk' | 'main', Tally> = {
      boardwalk: { exits: 0, crashes: 0, headOn: 0, lines: [] },
      main: { exits: 0, crashes: 0, headOn: 0, lines: [] },
    };
    let playerBoardwalk = 0;
    const landed: number[] = [];
    const races = [
      ...SEEDS.map((seed) => ({ seed, takes: true })),
      ...MAIN_SEEDS.map((seed) => ({ seed, takes: false })),
    ];
    for (const { seed, takes } of races) {
      const run = mangroveRace(seed, takes);
      for (const x of run.exits) {
        const t = tally[x.via];
        t.exits++;
        if (x.via === 'boardwalk') landed.push(x.d);
        if (takes && x.id === run.playerId && x.via === 'boardwalk') playerBoardwalk++;
        const hit = run.crashes.find(
          (c) => c.id === x.id && c.tick >= x.tick && c.tick <= x.tick + WINDOW_TICKS,
        );
        if (!hit) continue;
        t.crashes++;
        if (hit.headOn) t.headOn++;
        t.lines.push(
          `${x.via} seed ${seed} ${x.id === run.playerId ? 'player' : `rider ${x.id}`} on at d ${x.d.toFixed(1)}, ` +
            `${x.speed.toFixed(0)} m/s; ${String(hit.data['hit'])} into ${String(hit.data['vehicle'])} ` +
            `${hit.tick - x.tick} ticks later (${String(hit.data['where'])})`,
        );
      }
    }
    const rate = (t: Tally, n = t.crashes) => (t.exits > 0 ? n / t.exits : 0);
    console.log(
      `[examined] ${races.length} races (${SEEDS.length} with the player over the boardwalk): ` +
        `boardwalk ${tally.boardwalk.crashes} traffic crashes (${tally.boardwalk.headOn} head-on) in ${tally.boardwalk.exits} exits ` +
        `(${playerBoardwalk} by the player), landing at d ${Math.min(...landed).toFixed(1)} to ` +
        `${Math.max(...landed).toFixed(1)}; main road ${tally.main.crashes} (${tally.main.headOn} head-on) in ${tally.main.exits}\n  ` +
        [...tally.boardwalk.lines, ...tally.main.lines].join('\n  '),
    );
    // Enough exits each way to mean something: 16 off the planks (21 when measured), the player's
    // among them, and three main-road exits a race (about 4.5 when measured).
    expect(playerBoardwalk).toBeGreaterThan(0);
    expect(tally.boardwalk.exits).toBeGreaterThanOrEqual(16);
    expect(tally.main.exits).toBeGreaterThanOrEqual(3 * races.length);
    // Off the planks onto the travel side of the Reach (d > 0), never the oncoming lane (d -4 to 0).
    expect(Math.min(...landed)).toBeGreaterThan(0);
    // Head-on, in line with the main road: at most one exit in sixteen more than the main road's
    // rate (the old rejoin: about one in four here, one in two on the live game).
    expect(rate(tally.boardwalk, tally.boardwalk.headOn)).toBeLessThanOrEqual(
      rate(tally.main, tally.main.headOn) + 1 / 16,
    );
    // Every traffic crash: no worse than the boat ramp's rejoin with the same bot (see the top).
    expect(rate(tally.boardwalk)).toBeLessThanOrEqual(rate(tally.main) + 1 / 4);
  }, 300_000);
});
