/// <reference types="vite/client" />
import { expect, it } from 'vitest';
import { createHeadlessRace } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { quantizeInput } from '../../src/sim/api';
import { createSimWithWorld } from '../../src/sim/create';
import { riderState } from '../../src/sim/riders';
import { roadBandHeight } from '../../src/road';
import { iowaCountyLayout } from '../../src/road/structures/iowa-county';
import type { SimInput } from '../../src/sim/types';
import { firstSeed, ISOLATED } from './batch';

const registry = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const makeConfig = (seed = 1, traffic = false) =>
  createHeadlessRace(
    {
      seed,
      eventId: 'region-clinton:clinton-ia136-race',
      playerBike: 'base:rustbucket-400',
      eventPatch: { riders: [] },
      tuning: {
        ...ISOLATED,
        'ground.offRoad': 1,
        'riders.courseEdges': 1,
        'riders.structures': 1,
        'riders.supports': 1,
        'traffic.density': traffic ? 1 : 0,
      },
    },
    { registry },
  ).config;

it('a stock starter bike leaves dirt, rides through the loading shed and returns with an exact replay', () => {
  const config = makeConfig();
  const f = iowaCountyLayout(config.road, config.seed).facilities.find(
    (f) => f.id === 'county-loading-shed',
  )!;
  expect(f).toBeDefined();
  const start = () => {
    const race = createSimWithWorld(config),
      me = race.world.movers[0]!;
    me.pos = { edge: f.edge, s: f.s - 70, d: 1.75, dir: 1 };
    me.speed = 8;
    me.yaw = 0;
    riderState(race.world).yAbs[me.id] = config.road.surfaceHeight(f.edge, me.pos.s, me.pos.d);
    return race;
  };
  const { sim, world } = start(),
    me = world.movers[0]!;
  const inputs: SimInput[] = [];
  const events = [];
  let underRoof = false,
    maxApronGap = 0;
  while (sim.tick < 3600 && me.pos.s < f.s + 110) {
    const ahead = me.pos.s + 6;
    const target = 1.75 + (f.d - 1.75) * Math.max(0, Math.min(1, (65 - Math.abs(ahead - f.s)) / 28));
    const desired = Math.atan((target - me.pos.d) / 6);
    const steer = Math.max(-1, Math.min(1, (desired - me.yaw) * 1.8));
    const input = quantizeInput({
      throttle: me.speed < 8 ? 1 : 0,
      brake: me.speed > 9 ? 0.4 : 0,
      steer,
      flags: 0,
    });
    inputs.push(input);
    sim.step([input]);
    events.push(...sim.events());
    if (Math.abs(me.pos.s - f.s) < 3 && Math.abs(me.pos.d - f.d) < 1) {
      underRoof = true;
      maxApronGap = Math.max(maxApronGap, Math.abs(riderState(world).yAbs[me.id]! - f.y));
    }
    if (sim.events().some((e) => e.type === 'crash')) break;
  }
  process.stdout.write(
    `[county shed] ${JSON.stringify({ s: me.pos.s, d: me.pos.d, mode: me.mode, ticks: sim.tick, underRoof, maxApronGap, events: events.filter((e) => ['crash', 'jump', 'land'].includes(e.type)) })}\n`,
  );
  expect(underRoof).toBe(true);
  expect(maxApronGap).toBeLessThan(0.02);
  expect(events.filter((e) => e.type === 'crash')).toEqual([]);
  expect(events.filter((e) => e.type === 'respawn')).toEqual([]);
  expect(me.pos.edge).toBe(f.edge);
  expect(me.pos.s).toBeGreaterThan(f.s + 60);
  expect(me.pos.d).toBeLessThan(3.5);
  expect(me.mode).toBe('Road');
  expect(roadBandHeight(config.road, f.edge, me.pos.s, me.pos.d)).not.toBeNull();
  const replay = start();
  for (const input of inputs) replay.sim.step([input]);
  expect(replay.sim.hash()).toBe(sim.hash());
});

it('a deliberate shed-post hit contacts the drawn post while the center gap stays clear', () => {
  const config = makeConfig();
  const f = iowaCountyLayout(config.road, 1).facilities.find((f) => f.id === 'county-loading-shed')!;
  const drive = (d: number) => {
    const { sim, world } = createSimWithWorld(config),
      me = world.movers[0]!;
    me.pos = { edge: f.edge, s: f.s - 12, d, dir: 1 };
    me.speed = 14;
    me.yaw = 0;
    riderState(world).yAbs[me.id] = roadBandHeight(config.road, f.edge, me.pos.s, d)!;
    const contacts = [];
    while (sim.tick < 300 && me.pos.s < f.s + 10) {
      sim.step([
        quantizeInput({
          throttle: 0.2,
          brake: 0,
          steer: Math.max(-1, Math.min(1, (d - me.pos.d) * 0.8 - me.yaw * 2)),
          flags: 0,
        }),
      ]);
      contacts.push(...sim.events().filter((e) => e.data['structure'] !== undefined));
      if (sim.events().some((e) => e.type === 'crash')) break;
    }
    return { contacts, s: me.pos.s };
  };
  const hit = drive(f.d - 2.8),
    gap = drive(f.d);
  process.stdout.write(`[county post] ${JSON.stringify({ hit, gap })}\n`);
  expect(hit.contacts.length).toBeGreaterThan(0);
  expect(gap.contacts).toEqual([]);
  expect(gap.s).toBeGreaterThan(f.s + 5);
});

it('preserves the direct and county checkpoint finishes, two-way traffic and deterministic route replay', () => {
  const run = (take: boolean, seed: number, traffic = false) => {
    const config = makeConfig(seed, traffic),
      { sim } = createSimWithWorld(config);
    const branch = config.route.branches.find((b) => b.kind === 'detour')!;
    const navigation = { ...config.route, shortcuts: take && branch.choice ? [branch.choice] : [] };
    const bot = createBot(),
      directions = new Set<number>(),
      edges = new Set<number>(),
      inputs: SimInput[] = [];
    const crashes = [];
    while (!sim.isOver() && sim.tick < 60 * 60 * 9) {
      const snap = sim.snapshot(),
        me = snap.entities[0]!,
        actions = emptyActions();
      bot.drive(snap, me.id, navigation, actions);
      let cap = Infinity;
      for (let distance = 0; distance <= 160; distance += 4) {
        let edge = me.road.edge,
          at = me.road.s + distance;
        while (at > config.route.edgeLength(edge)) {
          at -= config.route.edgeLength(edge);
          const next =
            take && branch.choice?.edge === edge ? branch.choice.toEdge : config.road.edges[edge]!.next?.edge;
          if (next === undefined) {
            at = config.route.edgeLength(edge);
            break;
          }
          edge = next;
        }
        const corner = Math.sqrt(10 / Math.max(Math.abs(config.route.kappaAt(edge, at)), 1 / 5000));
        cap = Math.min(cap, Math.sqrt(corner * corner + 8 * distance));
      }
      actions.throttle = me.speed < cap - 1 ? 1 : 0;
      actions.brake = me.speed > cap ? 1 : 0;
      const input = toSimInput(actions);
      inputs.push(input);
      sim.step([input]);
      edges.add(me.road.edge);
      crashes.push(...sim.events().filter((e) => e.type === 'crash' && e.actor === me.id));
      for (const e of sim.snapshot().entities)
        if (e.kind === 'vehicle' && branch.edges.includes(e.road.edge)) directions.add(e.road.dir);
    }
    const replay = createSimWithWorld(config).sim;
    for (const input of inputs) replay.step([input]);
    expect(replay.hash()).toBe(sim.hash());
    return {
      finished: sim.snapshot().entities[0]!.finished,
      crashes,
      directions: [...directions].sort(),
      tookCounty: edges.has(
        branch.edges.find((e) => config.road.edges[e]!.id === 'osm-clinton-county-180th')!,
      ),
      ticks: sim.tick,
    };
  };
  const direct = run(false, 1);
  expect(direct.finished).toBe(true);
  expect(direct.crashes).toEqual([]);
  expect(direct.tookCounty).toBe(false);
  const detour = run(true, 1);
  expect(detour.finished).toBe(true);
  expect(detour.tookCounty).toBe(true);
  expect(detour.crashes).toEqual([]);
  const found = firstSeed(
    'county farmstead two-way traffic',
    [1, 2, 3],
    (seed) => run(true, seed, true),
    (r) => r.finished && r.directions.includes(-1) && r.directions.includes(1),
  );
  expect(found.result, found.summary).not.toBeNull();
  expect(found.result!.tookCounty).toBe(true);
  expect(
    found.result!.crashes.every((e) => e.data['cause'] === 'traffic' || e.data['cause'] === 'tumble'),
  ).toBe(true);
  process.stdout.write(
    `[county route] ${JSON.stringify({ direct, detour, traffic: { ...found.result, crashes: found.result!.crashes.length }, seed: found.seed })}\n`,
  );
}, 120_000);
