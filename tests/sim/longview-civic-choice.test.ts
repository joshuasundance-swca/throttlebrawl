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
import { riderState } from '../../src/sim/riders';
import { raceState } from '../../src/sim/race';
import { TRAFFIC } from '../../src/sim/traffic';
import { gapSimConfig } from '../../src/sim/tumble/gap-fixture';
import type { SimConfig, SimInput } from '../../src/sim/types';
import { firstSeed, ISOLATED } from './batch';

const ROOT = 'packs/region-pnw/regions/pacific-northwest';
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const baked = read<BakedNetwork>(`${ROOT}/networks/osm-pnw-longview-civic.json`);
const roads = baked.roads.map((id) => read<BakedRoad>(`${ROOT}/roads/${id}.json`));
const route = read<BakedRoute>(`${ROOT}/routes/osm-longview-civic-triangle.json`);
const road = createRoadNetwork({ network: baked, roads });
const progress = createRouteProgress(road, route);
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

describe('the civic triangle is rideable rather than decorative', () => {
  it.each(['diagonal', 'grid'] as const)(
    'finishes the %s with a rental moped and replays every input',
    (choice) => {
      const config = isolated();
      const { sim, world } = createSimWithWorld(config);
      const playerId = sim.snapshot().entities.find((m) => m.kind === 'rider')!.id;
      const bot = createBot();
      const navigation = choice === 'grid' ? config.route : { ...config.route, shortcuts: [] };
      const visited = new Set<number>();
      const inputs: SimInput[] = [];
      const hashes: number[] = [];
      let boosted = false;
      let crashes = 0;
      let snap = sim.snapshot();
      while (!sim.isOver() && sim.tick < 60 * 240) {
        const actions = blankActions();
        bot.drive(snap, playerId, navigation, actions);
        const input = botInput(actions);
        inputs.push(input);
        sim.step([input]);
        snap = sim.snapshot();
        visited.add(snap.entities[playerId]!.road.edge);
        boosted ||= snap.entities[playerId]!.boostS > 0;
        crashes += sim.events().filter((e) => e.type === 'crash' && e.actor === playerId).length;
        if (sim.tick % 120 === 0) hashes.push(sim.hash());
      }
      const branchRoads = route
        .branches!.flatMap((b) => b.roads)
        .map((id) => road.edgeIndex(id))
        .filter((e) => !road.edges[e]!.isConnector);
      expect(branchRoads.some((e) => visited.has(e))).toBe(choice === 'grid');
      expect(boosted).toBe(choice === 'grid');
      expect(snap.race.finishOrder).toContain(playerId);
      expect(snap.entities[playerId]!.road.edge).toBe(progress.finish.edge);
      expect(raceState(world).checkpoint[playerId]).toBe(config.route.checkpoints.length);
      const replay = createSimWithWorld(isolated()).sim;
      const replayHashes: number[] = [];
      for (const input of inputs) {
        replay.step([input]);
        if (replay.tick % 120 === 0) replayHashes.push(replay.hash());
      }
      expect(replayHashes).toEqual(hashes);
      expect(replay.hash()).toBe(sim.hash());
      process.stdout.write(
        `[examined] rental moped ${choice}: ${sim.tick} finish ticks, ${hashes.length} replay hashes, ${visited.size} traversed edges, ${crashes} crashes, boosted=${boosted}\n`,
      );
    },
  );

  it('lets the ordinary rival field choose either street path and reach the shared finish', () => {
    const reg = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
    const eventId = 'region-pnw:pnw-t1-bridge-city';
    const base = buildSimConfig(reg, streamForEvent(reg, eventId), { seed: 1, eventId });
    const branchStreets = new Set(
      route
        .branches!.flatMap((b) => b.roads)
        .map((id) => road.edgeIndex(id))
        .filter((e) => !road.edges[e]!.isConnector),
    );
    const diagonal = road.edgeIndex('osm-longview-civic-diagonal');
    const search = firstSeed(
      'Longview civic rival choice and finish',
      [1, 2, 3, 4],
      (seed) => {
        const c: SimConfig = {
          ...base,
          seed,
          road,
          route: progress,
          tuning: { ...base.tuning, ...ISOLATED },
        };
        const { sim } = createSimWithWorld(c);
        const choices = new Map<number, string>();
        let finishedChoices: string[] = [];
        for (let tick = 0; tick < 60 * 240 && new Set(finishedChoices).size < 2 && !sim.isOver(); tick++) {
          sim.step([botInput(blankActions())]);
          const snapshot = sim.snapshot();
          for (const m of snapshot.entities) {
            if (m.kind !== 'rider' || m.slot >= 0 || m.faction !== 'rider') continue;
            if (branchStreets.has(m.road.edge)) choices.set(m.id, 'grid');
            else if (m.road.edge === diagonal) choices.set(m.id, 'diagonal');
          }
          finishedChoices = snapshot.race.finishOrder
            .map((id) => choices.get(id))
            .filter((v): v is string => v !== undefined);
        }
        return { choices: [...new Set(finishedChoices)].sort(), ticks: sim.tick };
      },
      (r) => r.choices.length === 2,
    );
    expect(search.result, search.summary).not.toBeNull();
    expect(search.result?.choices).toEqual(['diagonal', 'grid']);
    process.stdout.write(
      `[examined] ${search.summary}; rivals finished both choices by tick ${search.result?.ticks}\n`,
    );
  });

  it('recovers from the authored soft grass margin without a grass-colour crash boundary', () => {
    const c = isolated();
    const { sim, world } = createSimWithWorld(c);
    const me = world.movers.find((m) => m.kind === 'rider')!;
    const edge = road.edgeIndex('osm-longview-civic-30th');
    const s = road.edges[edge]!.length / 2;
    const verge = road.vergeAt(edge, s, 'right');
    me.pos = { edge, s, d: verge.dInner + 2, dir: 1 };
    me.speed = 8;
    me.yaw = -0.3;
    riderState(world).yAbs[me.id] = road.surfaceHeight(edge, s, me.pos.d);
    const bot = createBot();
    let returned = false;
    let crashes = 0;
    for (let tick = 0; tick < 600; tick++) {
      const a = blankActions();
      bot.drive(sim.snapshot(), me.id, { ...c.route, shortcuts: [] }, a);
      sim.step([botInput(a)]);
      crashes += sim.events().filter((e) => e.type === 'crash' && e.actor === me.id).length;
      if (me.mode === 'Road' && me.pos.d < verge.dInner - 0.5) {
        returned = true;
        break;
      }
    }
    expect(crashes).toBe(0);
    expect(returned).toBe(true);
  });

  it('naturally populates both directed side-street lanes under the shared vehicle cap', () => {
    const reg = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
    const eventId = 'region-pnw:pnw-t1-bridge-city';
    const base = buildSimConfig(reg, streamForEvent(reg, eventId), { seed: 1, eventId });
    const streets = new Set(
      route
        .branches!.flatMap((b) => b.roads)
        .map((id) => road.edgeIndex(id))
        .filter((e) => !road.edges[e]!.isConnector),
    );
    const search = firstSeed(
      'Longview civic ordinary branch directions',
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
        const { sim } = createSimWithWorld(c);
        const directions = new Set<number>();
        let maximum = 0;
        for (let tick = 0; tick < 1200 && directions.size < 2; tick++) {
          sim.step([botInput(blankActions())]);
          const vehicles = sim.snapshot().entities.filter((m) => m.kind === 'vehicle');
          maximum = Math.max(maximum, vehicles.length);
          for (const m of vehicles) if (streets.has(m.road.edge)) directions.add(m.road.dir);
        }
        return { directions: [...directions].sort(), maximum, ticks: sim.tick };
      },
      (r) => r.directions.length === 2,
    );
    expect(search.result, search.summary).not.toBeNull();
    for (const attempt of search.tried)
      expect(attempt.result.maximum).toBeLessThanOrEqual(2 * TRAFFIC.maxPerDirectionHard);
    expect(search.result?.directions).toEqual([-1, 1]);
    process.stdout.write(
      `[examined] ${search.summary}; ${search.result?.ticks} ticks; maximum ${search.result?.maximum} ordinary vehicles\n`,
    );
  });
});
