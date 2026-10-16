/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { createHeadlessRace } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { quantizeInput, type SimConfig, type SimEvent } from '../../src/sim/api';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { groundUnder, SURFACE_FEEL, surfaceFeel } from '../../src/sim/ground';
import { createSimWithWorld } from '../../src/sim/create';
import { riderState } from '../../src/sim/riders';
import { ISOLATED } from './batch';
import { beyondAt, courseAt, pastAt, roadsideGroundHeight, terrainAt } from '../../src/road';
import { routeNetworks, track } from './geometry-routes';

const registry = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const { config } = createHeadlessRace(
  {
    seed: 1,
    eventId: 'region-clinton:clinton-ia136-race',
    route: 'region-clinton:osm-clinton-eagle-point-run',
    playerBike: 'base:moped',
    eventPatch: { riders: [] },
    tuning: { ...ISOLATED, 'ground.offRoad': 1, 'riders.courseEdges': 1 },
  },
  { registry },
);

function excursion(
  source: SimConfig,
  edge: number,
  s: number,
  side: -1 | 1,
  recover: boolean,
  outsideM = 0.8,
) {
  const { sim, world } = createSimWithWorld(source);
  const me = world.movers.find((m) => m.kind === 'rider')!;
  const lane = source.road.lanesAt(edge, s).find((l) => l.kind === 'drive' && l.direction === 1)!;
  const asphalt = lane.dCenterM + (side * lane.widthM) / 2;
  me.pos = { edge, s, d: asphalt + side * outsideM, dir: 1 };
  me.speed = 8;
  me.yaw = side * 0.25;
  riderState(world).yAbs[me.id] = source.road.surfaceHeight(edge, s, me.pos.d);
  const events: SimEvent[] = [];
  let furthest = 0;
  let recovered = false;
  for (let tick = 0; tick < 240; tick++) {
    // A brief steering mistake, then steer back onto the lane; the control keeps heading out.
    const steer = recover ? (me.pos.d * side > asphalt * side - 0.6 ? -side : 0) : side;
    sim.step([quantizeInput({ throttle: 0, brake: 0, steer, flags: 0 })]);
    events.push(...sim.events());
    furthest = Math.max(furthest, side * (me.pos.d - asphalt));
    if (events.some((e) => e.type === 'crash')) break;
    if (me.mode === 'Road' && side * (me.pos.d - asphalt) < -0.5) {
      recovered = true;
      break;
    }
  }
  return { events, furthest, recovered, mode: me.mode };
}

describe('Eagle Point recoverable roadside on a rental moped', () => {
  for (const side of [-1, 1] as const) {
    it(`can steer back from the ${side < 0 ? 'left' : 'right'} grass without an out-of-bounds reset`, () => {
      const trials = config.road.edges
        .filter((e) => !config.road.lanesAt(e.index, e.length / 2).some((l) => l.direction === -1))
        .map((edge) => excursion(config, edge.index, edge.length / 2, side, true));
      expect(trials.length).toBeGreaterThan(0);
      for (const r of trials) {
        expect(r.events.filter((e) => e.type === 'crash')).toEqual([]);
        expect(r.furthest).toBeGreaterThan(0.8);
        expect(r.recovered).toBe(true);
      }
      process.stdout.write(`[runoff] side ${side}: ${JSON.stringify(trials)}\n`);
    });
  }

  it('still resets beyond actual ground, even though the mathematical road plane continues', () => {
    const edge = config.road.edges.find(
      (e) => !config.road.lanesAt(e.index, e.length / 2).some((l) => l.direction === -1),
    )!;
    // The former fixed 100 m probe now lies on real authored land. Derive a point
    // beyond all source faces rather than treating a distance from asphalt as a hazard.
    const p = config.road.toWorld(edge.index, edge.length / 2, 0, 0);
    const outside =
      Math.max(
        ...config.road.terrain!.patches.flatMap((patch) =>
          patch.vertices.map(([x, , z]) => Math.hypot(x - p.x, z - p.z)),
        ),
      ) + 20;
    const r = excursion(config, edge.index, edge.length / 2, 1, false, outside);
    expect(r.events.find((e) => e.type === 'crash')?.data).toMatchObject({ cause: 'over', past: 'ground' });
    expect(r.recovered).toBe(false);
  });

  it('keeps grass grip and speed penalties across the shade seam', () => {
    for (const edge of config.road.edges) {
      const s = edge.length / 2;
      const d = config.road.vergeAt(edge.index, s, 'right').dOuter + 0.8;
      const p = config.road.toWorld(edge.index, s, d, 0);
      const ground = terrainAt(config.road.terrain, p.x, p.z);
      expect(ground?.surface).toBe('grass');
      const h = ground!.y - p.y;
      expect(groundUnder(config.road, edge.index, s, d, h)).toBe('grass');
      expect(surfaceFeel(config.tuning, groundUnder(config.road, edge.index, s, d, h))).toEqual(
        SURFACE_FEEL.grass,
      );
    }
  });

  it('retains real content water and cliff/drop negatives beyond their drawn ground', () => {
    const found = new Set<string>();
    const plan = { items: [], cellM: 32, cells: new Map() };
    for (const network of routeNetworks()) {
      if (found.size === 2) break;
      const { road } = track(network);
      for (const edge of road.edges)
        for (const tag of edge.tags) {
          if (!(tag.tag.startsWith('water') || tag.tag === 'bluff' || tag.tag === 'bridge')) continue;
          const s = (tag.s0 + tag.s1) / 2;
          for (const side of [-1, 1] as const) {
            const name = side < 0 ? 'left' : 'right';
            const kind = pastAt(road, edge.index, s, name);
            if (kind === 'ground' || found.has(kind)) continue;
            if (beyondAt(road, edge.index, s, name, 100).past !== kind) continue;
            const d = road.vergeAt(edge.index, s, name).dOuter + side * 100;
            const y = road.surfaceHeight(edge.index, s, d);
            expect(roadsideGroundHeight(road, edge.index, s, d)).toBeNull();
            expect(courseAt(road, plan, { edge: edge.index, s, d }, y + 0.3)).toEqual({ kind: 'out' });
            found.add(kind);
            process.stdout.write(
              `[hazard control] ${network.id}/${edge.id}: ${kind} remains outside course\n`,
            );
          }
        }
    }
    expect([...found].sort()).toEqual(['drop', 'water']);
  });

  it('finishes the unchanged technical route on a moped when braking for bends', () => {
    const { sim } = createSimWithWorld(config);
    const bot = createBot();
    let crashes = 0;
    while (!sim.isOver() && sim.tick < 60 * 60 * 6) {
      const snapshot = sim.snapshot();
      const me = snapshot.entities[0]!;
      const actions = emptyActions();
      bot.drive(snapshot, me.id, config.route, actions);
      let cap = Infinity;
      for (let distance = 0; distance <= 100; distance += 3) {
        let i = config.route.mainEdges.indexOf(me.road.edge);
        let edge = config.route.mainEdges[i]!;
        let at = me.road.s + distance;
        while (at > config.route.edgeLength(edge) && i + 1 < config.route.mainEdges.length) {
          at -= config.route.edgeLength(edge);
          edge = config.route.mainEdges[++i]!;
        }
        const turnCap = Math.sqrt(
          10 /
            Math.max(
              Math.abs(config.route.kappaAt(edge, Math.min(at, config.route.edgeLength(edge)))),
              1 / 5000,
            ),
        );
        cap = Math.min(cap, Math.sqrt(turnCap * turnCap + 8 * distance));
      }
      actions.throttle = me.speed < cap - 1 ? 1 : 0;
      actions.brake = me.speed > cap ? 1 : 0;
      sim.step([toSimInput(actions)]);
      crashes += sim.events().filter((e) => e.type === 'crash' && e.actor === me.id).length;
    }
    expect(sim.snapshot().entities[0]!.finished).toBe(true);
    expect(crashes).toBe(0);
    process.stdout.write(`[moped] clean isolated finish at tick ${sim.tick}\n`);
  });
});
