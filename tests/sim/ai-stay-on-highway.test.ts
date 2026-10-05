/// <reference types="vite/client" />
// Rivals and cops stay on the highway (playtest 3, round 3: "rivals and cops on the highway only";
// wave C, G3). T9.2 (#475) found the Seven Mile's field could still be PUSHED onto the old road
// (aiTake 0): a kick, or a pack passing a car, put a rider against the rail inside the turn-off's
// split zone and the split handed it over; once, a cop and Chad Speedwell rode the old road on. The
// rule (sim/ai/branches.ts): approaching that split, and just past it where the turn-off still
// overlaps the highway, an AI rider's or a cop's line, a dodge included, keeps off the side that
// would hand it over; shoved there anyway, it heads back to the main road at the first legal point
// (the overlap, where the road's own handover takes it back) and past that point it stops: it never
// rides the old road on.
//
// The band: seeded Seven Mile races (traffic on, every cop out of the lot at once and on the
// player's tail, the rest of the optional world off: the isolation profile), the dev bot riding the
// player down the old road so the cops and the hunters want to follow, and a shove forced on every
// AI rider and cop again and again as it passes the turn-off, toward the rail, in the zone's lead-in
// and the zone itself, each about a kick's push (3.6 m at most). After FIELD_PAST_TICKS, by when the
// whole field has passed the turn-off, a race runs on for as long as any of them is still moving
// along the old road, so one riding it would reach the far end. The check could see it: before the
// rule, the same races put riders down the old road (the PR's changes note has the counts).
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache, regionChoices } from '../../src/app';
import { createRng, nextFloat } from '../../src/core';
import { lookup, registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import type { SimConfig } from '../../src/sim/api';
import { createSimWithWorld } from '../../src/sim/create';
import { riderState } from '../../src/sim/riders';
import { ISOLATED, seedRange } from './batch';

const print = (line: string) => process.stdout.write(`[ai-stay-on-highway] ${line}\n`);

const ALL = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const ROUTE = 'base:osm-seven-mile-run';
const SEEDS = seedRange(1, 12);
/**
 * A shove forced on a rider passing the turn-off, toward the zone's side, m/s across (riders'
 * contact shove, which dies away at 6 m/s²): at random in this range, so at most 3.6 m, a kick's.
 */
const SHOVE_MPS: readonly [number, number] = [3, 6.6];
/** Chance per tick that a rider in the turn-off's lead-in or zone with no shove on it is shoved. */
const SHOVE_CHANCE = 1 / 20;
/** The lead-in before the zone where shoves are forced, m (riders' split guide reaches 90 m back). */
const SHOVE_LEAD_M = 120;
/** By now the whole field has passed the turn-off (the leaders reach it at about 28 s). */
const FIELD_PAST_TICKS = 90 * 60;
/** A rider at least this fast is still riding, m/s. */
const MOVING_MPS = 1;
/** The cap on one race, ticks: the old road at a crawl of 20 m/s from the turn-off. */
const CAP_TICKS = 6 * 60 * 60;

function seven(seed: number): SimConfig {
  const choice = regionChoices(ALL).find((c) => lookup(ALL.events, c.eventId).region === 'florida-keys');
  if (!choice) throw new Error('no Keys free-play event');
  return buildSimConfig(ALL, STREAMS.forEvent(ALL, choice.eventId, undefined, ROUTE), {
    seed,
    eventId: choice.eventId,
    route: ROUTE,
    tuning: {
      ...ISOLATED,
      'traffic.density': 1,
      'cops.spawnChance': 1,
      'cops.spawnDelayS': 0,
      'cops.sirenLeadS': 0,
    },
  });
}

interface OnBranch {
  who: string;
  /** Ticks on the old road, and the farthest of its roads reached (0 the turn-off connector). */
  ticks: number;
  farthest: number;
  /** Where it was when the race stopped: back on the main road, or stopped on the old road. */
  back: boolean;
}

interface Result {
  seed: number;
  /** Riders other than the player, and of them the cops. */
  field: number;
  cops: number;
  shoves: number;
  /** Every rider other than the player that was ever on the old road. */
  onBranch: OnBranch[];
  /** Riders other than the player that reached the old road's last road (its far end). */
  farEnd: string[];
  /** The player's ticks on the old road (the scene needs him on it). */
  playerOn: number;
  ticks: number;
  hash: number;
}

function race(seed: number): Result {
  const config = seven(seed);
  const { sim, world } = createSimWithWorld(config);
  const branch = config.route.branches.find((b) => b.aiTake === 0);
  if (!branch?.choice) throw new Error('no aiTake-0 branch with a split on the Seven Mile');
  const zone = branch.choice;
  const side = zone.d0 + zone.d1 >= 0 ? 1 : -1;
  const order = new Map(branch.edges.map((e, i) => [e, i]));
  const last = branch.edges.length - 1;
  const player = config.riders.findIndex((r) => r.controller.kind === 'player');
  const name = (i: number) =>
    `${config.riders[i]?.faction === 'law' ? 'cop ' : ''}${config.riders[i]?.name ?? '?'} (#${i})`;
  const bot = createBot();
  // The test's own stream: the shoves are the same every run, and draw nothing from the sim's.
  const shoveRng = createRng(seed * 7919 + 17);
  const rs = riderState(world);
  const seen = new Map<number, OnBranch>();
  const farEnd = new Set<string>();
  let shoves = 0;
  let playerOn = 0;
  let snap = sim.snapshot();
  for (;;) {
    const riding = snap.entities.some(
      (e) => e.id !== player && e.kind === 'rider' && order.has(e.road.edge) && e.speed >= MOVING_MPS,
    );
    if (sim.tick >= CAP_TICKS || (sim.tick >= FIELD_PAST_TICKS && !riding)) break;
    const a = emptyActions();
    bot.drive(snap, player, config.route, a);
    const me = snap.entities[player];
    // The bot keeps off the edges: through the zone's lead-in it holds full lock toward the rail, as
    // a person taking the old road does (tools/gis/routes-keys-pt3.test.ts rides it the same way).
    if (me && me.road.edge === zone.edge && me.road.s > zone.s0 - 90 && me.road.s <= zone.s1) a.steer = side;
    // The forced shoves: every other rider passing the turn-off is pushed toward the rail.
    for (const m of world.movers) {
      if (m.kind !== 'rider' || m.riderIndex === player || m.mode !== 'Road') continue;
      if (m.pos.edge !== zone.edge || m.pos.s < zone.s0 - SHOVE_LEAD_M || m.pos.s > zone.s1) continue;
      if ((rs.shove[m.id] ?? 0) !== 0 || nextFloat(shoveRng) >= SHOVE_CHANCE) continue;
      rs.shove[m.id] = side * (SHOVE_MPS[0] + (SHOVE_MPS[1] - SHOVE_MPS[0]) * nextFloat(shoveRng));
      shoves++;
    }
    sim.step([toSimInput(a)]);
    snap = sim.snapshot();
    for (const e of snap.entities) {
      if (e.kind !== 'rider' || e.id >= config.riders.length) continue;
      const k = order.get(e.road.edge);
      if (k === undefined) continue;
      if (e.id === player) {
        playerOn++;
        continue;
      }
      const row = seen.get(e.id) ?? { who: name(e.id), ticks: 0, farthest: 0, back: false };
      row.ticks++;
      row.farthest = Math.max(row.farthest, k);
      seen.set(e.id, row);
      if (k === last) farEnd.add(row.who);
    }
  }
  for (const [id, row] of seen) row.back = !order.has(snap.entities[id]?.road.edge ?? -1);
  return {
    seed,
    field: config.riders.length - 1,
    cops: config.riders.filter((r) => r.faction === 'law').length,
    shoves,
    onBranch: [...seen.values()],
    farEnd: [...farEnd],
    playerOn,
    ticks: sim.tick,
    hash: sim.hash(),
  };
}

describe('the Seven Mile: rivals and cops stay on the highway, shoved at the turn-off or not', () => {
  it(
    'no AI rider or cop reaches the old road far end over a band of seeded races with forced shoves',
    { timeout: 600_000 },
    () => {
      const results = SEEDS.map((seed) => race(seed));
      for (const r of results) {
        const went = r.onBranch.map(
          (b) =>
            `${b.who} ${b.ticks} ticks, to road ${b.farthest}, ${b.back ? 'back on the main road' : 'stopped'}`,
        );
        print(
          `seed ${r.seed}: ${r.ticks} ticks, ${r.field} others (${r.cops} cops), ${r.shoves} shoves; the player on the old road ${r.playerOn} ticks; others onto it: ${went.length ? went.join('; ') : 'none'}; at the far end: ${r.farEnd.length ? r.farEnd.join(', ') : 'none'}`,
        );
      }
      const shoves = results.reduce((n, r) => n + r.shoves, 0);
      const cops = results.reduce((n, r) => n + r.cops, 0);
      const went = results.flatMap((r) => r.onBranch);
      print(
        `${results.length} races, ${shoves} shoves, ${cops} cops fielded; onto the old road ${went.length} (${went.filter((b) => b.back).length} back on the main road, ${went.filter((b) => !b.back).length} stopped on it); at the far end ${results.flatMap((r) => r.farEnd).length}`,
      );
      // The scene is real: the player rode the old road (in most races: the bot can miss the hop), the
      // field was shoved, and cops were out.
      expect(results.filter((r) => r.playerOn > 60 * 30).length).toBeGreaterThan(results.length / 2);
      expect(shoves).toBeGreaterThan(results.length * 10);
      expect(cops).toBeGreaterThan(0);
      // The rule: nobody but the player rides the old road on, let alone to its far end. Anyone
      // shoved onto it is back on the main road or stopped short of the old bridge's first span.
      expect(results.flatMap((r) => r.farEnd)).toEqual([]);
      for (const b of went) expect(b.farthest, b.who).toBeLessThanOrEqual(1);
    },
  );

  it('is deterministic: the same seed, shoves and all, ends in the same state', { timeout: 120_000 }, () => {
    expect(race(4).hash).toBe(race(4).hash);
  });
});
