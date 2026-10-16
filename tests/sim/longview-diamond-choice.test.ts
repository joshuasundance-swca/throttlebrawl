/// <reference types="vite/client" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import moped from '../../packs/base/bikes/moped.json';
import { buildSimConfig, streamForEvent } from '../../src/app/config';
import { registryFromGlob } from '../../src/content';
import { blankActions, botInput, createBot } from '../../src/dev/bot';
import {
  createRoadNetwork,
  createRouteProgress,
  type BakedNetwork,
  type BakedRoad,
  type BakedRoute,
} from '../../src/road';
import { createSimWithWorld } from '../../src/sim/create';
import { raceState } from '../../src/sim/race';
import { TRAFFIC, trafficState } from '../../src/sim/traffic';
import { gapSimConfig } from '../../src/sim/tumble/gap-fixture';
import type { SimConfig, SimInput } from '../../src/sim/types';
import { firstSeed, ISOLATED } from './batch';

const ROOT = 'packs/region-pnw/regions/pacific-northwest';
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const baked = read<BakedNetwork>(`${ROOT}/networks/osm-pnw-longview-diamond.json`);
const roads = baked.roads.map((id) => read<BakedRoad>(`${ROOT}/roads/${id}.json`));
const route = read<BakedRoute>(`${ROOT}/routes/osm-longview-street-diamond.json`);
const road = createRoadNetwork({ network: baked, roads });
const progress = createRouteProgress(road, route);
const outerStreets = new Set(
  route
    .branches!.flatMap((b) => b.roads)
    .map((id) => road.edgeIndex(id))
    .filter((e) => !road.edges[e]!.isConnector),
);
const isolated = () => {
  const c = gapSimConfig(
    { network: baked, roads },
    { route, tuning: { ...ISOLATED, 'ground.offRoad': 1, 'riders.courseEdges': 1 } },
  );
  return {
    ...c,
    riders: c.riders.map((r) => ({ ...r, bike: { contentId: `base:${moped.id}`, ...moped.handling } })),
  };
};

describe('the Longview street diamond is a playable one-pass choice', () => {
  it.each(['inner', 'outer'] as const)(
    'rides the complete %s with a rental moped and deterministically replays the inputs',
    (choice) => {
      const config = isolated();
      const { sim, world } = createSimWithWorld(config);
      const player = sim.snapshot().entities.find((m) => m.kind === 'rider')!.id;
      const bot = createBot();
      const navigation = choice === 'outer' ? config.route : { ...config.route, shortcuts: [] };
      const visited = new Set<number>();
      const inputs: SimInput[] = [];
      const hashes: number[] = [];
      let crashes = 0;
      let snap = sim.snapshot();
      while (!sim.isOver() && sim.tick < 60 * 360) {
        const actions = blankActions();
        bot.drive(snap, player, navigation, actions);
        const input = botInput(actions);
        inputs.push(input);
        sim.step([input]);
        snap = sim.snapshot();
        const me = snap.entities[player]!;
        visited.add(me.road.edge);
        expect(Number.isFinite(config.route.distanceToFinish(me.road.edge, me.road.s))).toBe(true);
        crashes += sim.events().filter((e) => e.type === 'crash' && e.actor === player).length;
        if (sim.tick % 120 === 0) hashes.push(sim.hash());
      }
      expect([...outerStreets].some((e) => visited.has(e))).toBe(choice === 'outer');
      if (choice === 'outer')
        for (const edge of outerStreets) expect(visited.has(edge), road.edges[edge]!.id).toBe(true);
      expect(crashes).toBe(0);
      expect(snap.race.finishOrder).toContain(player);
      expect(snap.entities[player]!.road.edge).toBe(progress.finish.edge);
      expect(raceState(world).checkpoint[player]).toBe(config.route.checkpoints.length);
      const replay = createSimWithWorld(isolated()).sim;
      const replayHashes: number[] = [];
      for (const input of inputs) {
        replay.step([input]);
        if (replay.tick % 120 === 0) replayHashes.push(replay.hash());
      }
      expect(replayHashes).toEqual(hashes);
      expect(replay.hash()).toBe(sim.hash());
      process.stdout.write(
        `[examined] moped ${choice}: ${sim.tick} finish ticks, ${hashes.length} replay hashes, ${visited.size} visited edges, ${crashes} crashes\n`,
      );
    },
  );

  it('rides from the real grid onto soft grass and back without moving sim state', () => {
    const c = isolated();
    const navigation = { ...c.route, shortcuts: [] };
    const { sim } = createSimWithWorld(c);
    const player = sim.snapshot().entities.find((m) => m.kind === 'rider')!.id;
    const bot = createBot();
    let entered = false;
    let returned = false;
    let crashes = 0;
    for (let tick = 0; tick < 1200 && !returned; tick++) {
      const snapshot = sim.snapshot();
      const me = snapshot.entities[player]!;
      const verge = road.vergeAt(me.road.edge, me.road.s, 'right');
      if (me.road.d > verge.dInner + 1.5 && me.road.d < verge.dOuter - 0.5) entered = true;
      if (entered && me.mode === 'Road' && me.road.d < verge.dInner - 0.5) returned = true;
      const actions = blankActions();
      if (!entered) {
        actions.throttle = 0.35;
        actions.steer = 0.35;
      } else bot.drive(snapshot, player, navigation, actions);
      sim.step([botInput(actions)]);
      crashes += sim.events().filter((e) => e.type === 'crash' && e.actor === player).length;
    }
    expect(entered, 'input-driven excursion reaches supported grass').toBe(true);
    expect(returned, 'input-driven riding returns to the travel lane').toBe(true);
    expect(crashes).toBe(0);
  });

  it('naturally moves ordinary traffic on both two-way arms within the existing shared cap', () => {
    const reg = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
    const eventId = 'region-pnw:pnw-t1-bridge-city';
    const base = buildSimConfig(reg, streamForEvent(reg, eventId), { seed: 1, eventId });
    const innerStreets = new Set(progress.mainEdges.filter((e) => !road.edges[e]!.isConnector));
    const search = firstSeed(
      'Longview diamond ordinary arm directions',
      [1, 2, 3, 4],
      (seed) => {
        const c: SimConfig = {
          ...base,
          seed,
          road,
          route: progress,
          riders: base.riders.filter((r) => r.role === 'player'),
          tuning: { ...base.tuning, ...ISOLATED, 'traffic.density': 1 },
        };
        const { sim, world } = createSimWithWorld(c);
        const player = sim.snapshot().entities.find((m) => m.kind === 'rider')!.id;
        const bot = createBot();
        const observed = new Set<string>();
        const previous = new Map<string, { edge: number; s: number }>();
        let maximum = 0;
        for (let tick = 0; tick < 60 * 300 && observed.size < 4 && !sim.isOver(); tick++) {
          const a = blankActions();
          bot.drive(sim.snapshot(), player, c.route, a);
          sim.step([botInput(a)]);
          const vehicles = sim.snapshot().entities.filter((m) => m.kind === 'vehicle');
          maximum = Math.max(maximum, vehicles.length);
          expect(vehicles.length).toBeLessThanOrEqual(2 * TRAFFIC.maxPerDirectionHard);
          const traffic = trafficState(world);
          for (const m of vehicles) {
            const slot = traffic.id.indexOf(m.id);
            const key = `${m.id}:${traffic.generation[slot]}`;
            const last = previous.get(key);
            const cohort = outerStreets.has(m.road.edge)
              ? 'outer'
              : innerStreets.has(m.road.edge)
                ? 'inner'
                : null;
            if (cohort && last?.edge === m.road.edge && (m.road.s - last.s) * m.road.dir > 0.01)
              observed.add(`${cohort}:${m.road.dir}`);
            previous.set(key, { edge: m.road.edge, s: m.road.s });
          }
        }
        return { observed: [...observed].sort(), maximum, ticks: sim.tick };
      },
      (r) => r.observed.length === 4,
    );
    expect(search.result, search.summary).not.toBeNull();
    expect(search.result?.observed).toEqual(['inner:-1', 'inner:1', 'outer:-1', 'outer:1']);
    process.stdout.write(`[examined] ${search.summary}; ${JSON.stringify(search.result)}\n`);
  });
});
