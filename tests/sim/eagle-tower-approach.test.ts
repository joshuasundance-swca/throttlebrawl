/// <reference types="vite/client" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createHeadlessRace } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import {
  createRoadNetwork,
  planStructures,
  raceStructures,
  terrainAt,
  type BakedNetwork,
  type BakedRoad,
  type StructurePlanner,
} from '../../src/road';
import { landmarkPlaces } from '../../src/road/structures/landmark-places';
import { quantizeInput, type EntitySnapshot, type SimConfig, type SimEvent } from '../../src/sim/api';
import { createSimWithWorld } from '../../src/sim/create';
import { riderState } from '../../src/sim/riders';
import { supportKeyOf } from '../../src/sim/riders/supports';
import { ISOLATED } from './batch';

const registry = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const { config } = createHeadlessRace(
  {
    seed: 1,
    eventId: 'region-clinton:clinton-ia136-race',
    route: 'region-clinton:osm-clinton-eagle-point-run',
    playerBike: 'base:rustbucket-400',
    eventPatch: { riders: [] },
    tuning: {
      ...ISOLATED,
      'ground.offRoad': 1,
      'riders.courseEdges': 1,
      'riders.supports': 1,
      'riders.structures': 1,
    },
    assists: [{ steer: 'off', autoThrottle: false, steerStyle: 'free' }],
  },
  { registry },
);
const tower = landmarkPlaces(config.road).find((p) => p.kit === 'eagle-stone-tower')!;
const pad = tower.foundation!;
const plan = raceStructures(config.road, config.seed);
const foundation = plan.items.find(
  (s) => s.model === `${tower.kit}#${tower.node}` && s.rule.endsWith(':foundation'),
)!;
const coast = quantizeInput({ throttle: 0, brake: 0, steer: 0, flags: 0 });

// Initialization only: invert the actual interpolated frame near the authored feature.
// Every position after this comes from sim.step, never from this independent solver.
function initialPosition(x: number, z: number) {
  const road = config.road;
  let s = (tower.feature.s0 + tower.feature.s1) / 2;
  let d = (tower.feature.d0 + tower.feature.d1) / 2;
  for (let i = 0; i < 20; i++) {
    const p = road.toWorld(tower.edge, s, d, 0);
    if (Math.hypot(x - p.x, z - p.z) < 1e-8) break;
    const a = road.toWorld(tower.edge, s + 0.001, d, 0);
    const b = road.toWorld(tower.edge, s, d + 0.001, 0);
    const ax = (a.x - p.x) / 0.001,
      az = (a.z - p.z) / 0.001;
    const bx = (b.x - p.x) / 0.001,
      bz = (b.z - p.z) / 0.001;
    const det = ax * bz - az * bx;
    s += ((x - p.x) * bz - (z - p.z) * bx) / det;
    d += (ax * (z - p.z) - az * (x - p.x)) / det;
  }
  const p = road.toWorld(tower.edge, s, d, 0);
  expect(p.x).toBeCloseTo(x, 6);
  expect(p.z).toBeCloseTo(z, 6);
  return { edge: tower.edge, s, d, dir: 1 as const };
}

function approach(source: SimConfig, outside: boolean, airborne: boolean) {
  const { sim, world } = createSimWithWorld(source);
  const me = world.movers.find((m) => m.kind === 'rider')!;
  const x = tower.x + pad.halfM + (outside ? 0.8 : -0.6);
  const z = tower.z + pad.halfM + 0.3;
  me.pos = initialPosition(x, z);
  // Travel towards -Z along the clear outer corner, away from the tower's walls.
  const frame = source.road.frameAt(me.pos.edge, me.pos.s);
  me.pos.dir = -frame.tz >= 0 ? 1 : -1;
  me.yaw = Math.atan2(-frame.tx * me.pos.dir, -frame.tz * me.pos.dir);
  me.speed = 3;
  me.mode = airborne ? 'Airborne' : 'Road';
  const ground = terrainAt(source.road.terrain, x, z)!;
  expect(ground.surface).toBe('grass');
  const y = airborne ? pad.topY + 0.5 : ground.y;
  me.h = y - source.road.surfaceHeight(me.pos.edge, me.pos.s, me.pos.d);
  const st = riderState(world);
  st.yAbs[me.id] = y;
  st.vy[me.id] = airborne ? -1 : 0;
  const snapshot = () => sim.snapshot().entities.find((e) => e.id === me.id)!;
  const start = snapshot();
  const events: SimEvent[] = [];
  const trace: EntitySnapshot[] = [];
  let before = start;
  // Tick cap is a failure bound; completion is an observed landing or 2 m of travel.
  while (sim.tick < 180) {
    sim.step([airborne ? coast : quantizeInput({ throttle: 0.3, brake: 0, steer: 0, flags: 0 })]);
    const after = snapshot();
    events.push(...sim.events());
    trace.push(after);
    expect(events.filter((e) => e.type === 'crash' || e.type === 'finish')).toEqual([]);
    expect(after.road.edge).toBe(start.road.edge);
    expect(Math.abs(after.road.s - before.road.s)).toBeLessThan(5);
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.2);
    // Check the observable world step against its heading and speed, independently of support queries.
    // Landing can alter speed/yaw; its preceding airborne ticks retain the travel oracle.
    if (!sim.events().some((e) => e.type === 'land')) {
      expect(after.x - before.x).toBeCloseTo((-Math.sin(before.heading) * after.speed) / 60, 3);
      expect(after.z - before.z).toBeCloseTo((-Math.cos(before.heading) * after.speed) / 60, 3);
      expect(after.heading).toBeCloseTo(start.heading, 4);
    }
    before = after;
    if (airborne ? events.some((e) => e.type === 'land') : start.z - after.z >= 2) break;
  }
  return { sim, world, me, start, trace, events, snapshot };
}

function withoutFoundation(): SimConfig {
  const root = 'packs/region-clinton/regions/clinton-iowa';
  const network = JSON.parse(
    readFileSync(`${root}/networks/osm-clinton-eagle-point.json`, 'utf8'),
  ) as BakedNetwork;
  const roads = network.roads.map(
    (id) => JSON.parse(readFileSync(`${root}/roads/${id}.json`, 'utf8')) as BakedRoad,
  );
  const road = createRoadNetwork({ network, roads });
  // Replay the normal complete physical plan, omitting only this pad, keeping tower walls intact.
  const control: StructurePlanner = {
    plan(_road, _seed, sink) {
      for (const spec of plan.items) if (spec !== foundation) sink.add(spec);
    },
  };
  const controlPlan = planStructures(
    road,
    config.seed,
    { control },
    { control: { features: ['landmark'], load: () => Promise.resolve(control) } },
  );
  expect(controlPlan.items.some((s) => s.rule === foundation.rule)).toBe(false);
  expect(controlPlan.items.some((s) => s.model === foundation.model)).toBe(true);
  return { ...config, road };
}

describe('input-driven approaches at the authored Eagle tower pad', () => {
  it('moves in world metres on source grass beside the pad corner without changing road pass', () => {
    const run = approach(config, true, false);
    expect(run.start.z - run.snapshot().z).toBeGreaterThanOrEqual(2);
    for (const after of run.trace) {
      expect(after.mode).toBe('Road');
      expect(after.grounded).toBe(true);
      expect(after.y).toBeCloseTo(terrainAt(config.road.terrain, after.x, after.z)!.y, 4);
      expect(after.x).toBeGreaterThan(tower.x + pad.halfM);
    }
  });

  it('descends across the rim, lands on the physical pad and continues riding on its top', () => {
    const run = approach(config, false, true);
    expect(run.start.z).toBeGreaterThan(tower.z + pad.halfM);
    const landed = run.snapshot();
    expect(run.events.find((e) => e.type === 'land')?.data.on).toBe('structure');
    expect(landed.mode).toBe('Road');
    expect(Math.abs(landed.x - tower.x)).toBeLessThan(pad.halfM);
    expect(Math.abs(landed.z - tower.z)).toBeLessThan(pad.halfM);
    expect(landed.y).toBeCloseTo(pad.topY, 4);
    expect(supportKeyOf(run.world, run.me.id)).toBe(`s:${foundation.id}`);
    run.sim.step([coast]);
    const continued = run.snapshot();
    expect(continued.grounded).toBe(true);
    expect(continued.y).toBeCloseTo(pad.topY, 4);
    expect(continued.z).toBeLessThan(landed.z);
    expect(supportKeyOf(run.world, run.me.id)).toBe(`s:${foundation.id}`);
    expect(run.sim.events().filter((e) => e.type === 'crash' || e.type === 'jump')).toEqual([]);
  });

  it('lands on source terrain outside the pad and on the same approach with only the pad removed', () => {
    const withPad = approach(config, false, true);
    for (const [source, outside] of [
      [config, true],
      [withoutFoundation(), false],
    ] as const) {
      const run = approach(source, outside, true);
      expect(run.events.some((e) => e.type === 'land')).toBe(true);
      expect(run.events.find((e) => e.type === 'land')?.data.on).toBeUndefined();
      const landed = run.snapshot();
      expect(landed.grounded).toBe(true);
      expect(landed.y).toBeCloseTo(terrainAt(source.road.terrain, landed.x, landed.z)!.y, 4);
      expect(landed.y).toBeLessThan(pad.topY - 0.05);
      expect(supportKeyOf(run.world, run.me.id)).toBe('');
      if (outside) expect(landed.x).toBeGreaterThan(tower.x + pad.halfM);
      else {
        // Removing the pad changes the landing height, not the input-driven flight leading to it.
        expect(run.trace.length).toBeGreaterThanOrEqual(withPad.trace.length);
        for (const [i, positive] of withPad.trace.entries()) {
          expect(run.trace[i]!.x).toBeCloseTo(positive.x, 6);
          expect(run.trace[i]!.z).toBeCloseTo(positive.z, 6);
        }
        expect(Math.abs(landed.x - tower.x)).toBeLessThan(pad.halfM);
        expect(Math.abs(landed.z - tower.z)).toBeLessThan(pad.halfM);
      }
    }
  });
});
