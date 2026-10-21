/// <reference types="vite/client" />
// Rural Rush's authored farm encounter: real pack resolution, positive road eligibility,
// warning order, physical passing/contact and same-engine replay. No unrelated world systems.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { clamp } from '../../src/core';
import { partsFor } from '../../src/render/event-props';
import { mergeBoxes } from '../../src/render/geometry';
import {
  TRAFFIC_FIGURE_HEIGHT_M,
  TRAFFIC_FIGURE_PARTS,
  trafficFigureFor,
} from '../../src/render/traffic-figures';
import type { SimConfig, SimEvent } from '../../src/sim/api';
import { vehicleSize } from '../../src/sim/ai/sense';
import { createSimWithWorld } from '../../src/sim/create';
import { setPieceState } from '../../src/sim/modifiers';
import { riderState } from '../../src/sim/riders';
import { toCorridor, trafficState } from '../../src/sim/traffic';
import { fromCorridor, lanesAt } from '../../src/sim/traffic/corridor';
import { firstSeed, ISOLATED, seedRange } from './batch';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const EVENT = 'region-clinton:clinton-ia136-race';
const MOD = 'region-clinton:iowa-hay-truck';
const TRUCK = 'region-clinton:iowa-hay-truck';
const ROAD_EVENTS = { ...ISOLATED, 'modifiers.setPieceChance': 1, 'modifiers.propContact': 1 };

function config(seed: number, route?: string, force = false): SimConfig {
  const base = buildSimConfig(REG, STREAMS.forEvent(REG, EVENT, 'standard', route), {
    seed,
    eventId: EVENT,
    length: 'standard',
    tuning: ROAD_EVENTS,
    ...(route ? { route } : {}),
  });
  return {
    ...base,
    riders: base.riders.filter((r) => r.controller.kind === 'player'),
    modifiers: base.modifiers.map((m) => ({ ...m, ...(force ? { chance: 1 } : {}) })),
  };
}

function scene(cfg: SimConfig) {
  const { sim, world } = createSimWithWorld(cfg);
  const player = world.movers.find((m) => m.kind === 'rider');
  if (!player) throw new Error('no player');
  return { cfg, sim, world, player, c: trafficState(world).corridor, events: [] as SimEvent[] };
}
type Scene = ReturnType<typeof scene>;
function piece(s: Scene) {
  const p = setPieceState(s.world).pieces.find((p) => s.cfg.modifiers[p.mod]?.contentId === MOD);
  if (!p) throw new Error('authored Iowa encounter was not placed');
  return p;
}
function encounter() {
  const found = firstSeed(
    'authored Iowa farm encounter',
    seedRange(1, 64),
    (seed) => scene(config(seed)),
    (s) => setPieceState(s.world).pieces.some((p) => s.cfg.modifiers[p.mod]?.contentId === MOD),
  );
  expect(found.result, found.summary).not.toBeNull();
  if (!found.result) throw new Error(found.summary);
  return found.result;
}
function put(s: Scene, u: number, cd: number, speed = 25) {
  fromCorridor(s.c, u, cd, s.c.routeDir, s.player.pos);
  s.player.speed = speed;
  s.player.yaw = 0;
  s.player.h = 0;
  s.player.mode = 'Road';
  riderState(s.world).lastTick[s.player.id] = -2;
}
function tick(s: Scene, cd = -2) {
  const { pos, speed, yaw } = s.player;
  const bend = s.cfg.road.kappaAt(pos.edge, pos.s) * pos.dir;
  const steer = clamp(0.35 * (cd - pos.d) * pos.dir - 2.5 * yaw + (bend * speed * speed) / 22, -1, 1);
  const input = { steer: Math.round(steer * 127), throttle: 255, brake: 0, flags: 0 };
  s.sim.step([input]);
  s.events.push(...s.sim.events());
  return input;
}
function activate(s: Scene) {
  const p = piece(s);
  put(s, p.u - s.c.routeDir * 300, -2);
  tick(s);
  expect(p.phase).toBe(1);
  return p;
}

describe('Iowa farm encounter as shipped', () => {
  it('opts Rural Rush into a local, rare encounter with an event-only truck and contextual reaction', () => {
    const cfg = config(1);
    const mod = cfg.modifiers.find((m) => m.contentId === MOD);
    expect(mod, 'Rural Rush resolves the authored farm encounter').toBeDefined();
    expect(mod?.chance).toBeGreaterThan(0);
    expect(mod?.chance).toBeLessThan(0.5);
    expect(mod?.effects).toContainEqual(expect.objectContaining({ piece: 'hay-spill', vehicle: TRUCK }));
    const truck = cfg.trafficTypes.find((t) => t.contentId === TRUCK);
    expect(truck?.weight, 'only the encounter spawns this truck').toBe(0);
    expect(truck?.category).toBe('truck');
    expect(truck?.cruiseMps).toBeGreaterThan(0);
    expect(vehicleSize(cfg)).toEqual(
      vehicleSize({ ...cfg, trafficTypes: cfg.trafficTypes.filter((t) => t.contentId !== TRUCK) }),
    );
    const reaction = Object.values(REG.barkSets)
      .flatMap((b) => b.lines)
      .find(
        (l) =>
          l.trigger === 'modifier-start' && l.when?.some((c) => c.fact === 'modifier.id' && c.value === MOD),
      );
    expect(reaction, 'local bark names the qualified modifier').toBeDefined();
    const control = buildSimConfig(REG, STREAMS.forEvent(REG, 'base:m1-skeleton-sprint', 'standard'), {
      seed: 1,
      eventId: 'base:m1-skeleton-sprint',
      length: 'standard',
      tuning: ROAD_EVENTS,
    });
    expect(control.modifiers.some((m) => m.contentId === MOD)).toBe(false);
  });

  it('places on positively tagged highway, while Quick Play route override excludes Eagle Point', () => {
    const s = encounter();
    const p = piece(s);
    const effect = s.cfg.modifiers[p.mod]?.effects[p.eff];
    const tag = String(effect?.['needsTag'] ?? '');
    expect(tag).not.toBe('');
    expect(tag).not.toBe('rural');
    const source = JSON.parse(readFileSync('tools/gis/networks/osm-clinton-ia136.json', 'utf8')) as {
      lines: { roads: { id: string; tags?: string[] }[] }[];
    };
    const authored = source.lines.flatMap((l) => l.roads).filter((r) => r.tags?.includes(tag));
    expect(authored.length).toBeGreaterThan(0);
    const checkStretch = (placed: Scene) => {
      const p = piece(placed);
      const pos = { edge: 0, s: 0, d: 0, dir: 1 as 1 | -1 };
      for (let a = 0; a <= p.len; a += 5) {
        fromCorridor(placed.c, p.u + placed.c.routeDir * a, 0, placed.c.routeDir, pos);
        const edge = placed.cfg.road.edges[pos.edge]!;
        expect(authored.some((r) => edge.id.endsWith(`:${r.id}`) || edge.id === r.id)).toBe(true);
        expect(edge.tags.some((t) => t.tag === tag && pos.s >= t.s0 && pos.s <= t.s1)).toBe(true);
      }
    };
    checkStretch(s);
    for (const seed of seedRange(1, 12)) {
      const forced = scene(config(seed, undefined, true));
      expect(
        setPieceState(forced.world).pieces.some((p) => forced.cfg.modifiers[p.mod]?.contentId === MOD),
      ).toBe(true);
      // The bake also tags its short county-join connector. Placement must still use the
      // authored highway road, clear of the split/merge area, over the entire hazard stretch.
      checkStretch(forced);
      const park = scene(config(seed, 'region-clinton:osm-clinton-eagle-point-run', true));
      expect(park.cfg.modifiers.some((m) => m.contentId === MOD && m.chance === 1)).toBe(true);
      expect(setPieceState(park.world).pieces.some((p) => park.cfg.modifiers[p.mod]?.contentId === MOD)).toBe(
        false,
      );
    }
  });

  it('warns before the physical hazard, carries hay, moves slowly and drops bales near the rider', () => {
    const s = encounter();
    const p = activate(s);
    const props = setPieceState(s.world).props;
    const sign = props.find((q) => q.kind === 'sign');
    const bales = props.filter((q) => q.kind === 'hayBale');
    const load = props.find((q) => q.kind === 'hayLoad');
    expect(sign?.label).toBe(s.cfg.modifiers[p.mod]?.effects[p.eff]?.['signText']);
    expect(bales.length).toBeGreaterThan(0);
    for (const bale of bales) expect(s.c.routeDir * (bale.u - (sign?.u ?? Infinity))).toBeGreaterThan(100);
    const truck = s.world.movers[p.vehicles[0] ?? -1];
    expect(truck?.kind).toBe('vehicle');
    expect(load?.attach).toBe(truck?.id);
    expect(s.events.filter((e) => e.type === 'modifierStart' && e.data['id'] === MOD)).toHaveLength(1);
    if (!truck) throw new Error('no farm truck');
    const before = toCorridor(s.c, truck.pos)!.u;
    expect(truck.speed).toBeGreaterThan(0);
    expect(truck.speed).toBeLessThan(20);
    put(s, before - s.c.routeDir * 100, -2);
    for (let t = 0; t < 120; t++) tick(s);
    expect(s.c.routeDir * (toCorridor(s.c, truck.pos)!.u - before)).toBeGreaterThan(0);
    expect(p.dropped).toBeGreaterThan(0);
    expect(setPieceState(s.world).props.some((q) => q.kind === 'hayBale' && q.moving)).toBe(true);
    expect(s.events.filter((e) => e.type === 'modifierStart' && e.data['id'] === MOD)).toHaveLength(1);
  });

  it('supports the actual attached hay on an open bed, clear of the cab and inside its physical box', () => {
    const s = encounter();
    activate(s);
    const mount = setPieceState(s.world).props.find((q) => q.kind === 'hayLoad')!;
    const type = s.cfg.trafficTypes.find((t) => t.contentId === TRUCK)!;
    const figure = trafficFigureFor(type.contentId);
    expect(figure).not.toBeNull();
    if (!figure) throw new Error('no farm truck figure');
    const g = mergeBoxes(TRAFFIC_FIGURE_PARTS[figure]).clone();
    g.scale(type.widthM, TRAFFIC_FIGURE_HEIGHT_M[figure], type.lengthM);
    g.computeBoundingBox();
    const body = g.boundingBox!;
    const load = mergeBoxes(partsFor('hayLoad'));
    load.translate(0, mount.up, -mount.along);
    load.computeBoundingBox();
    const hay = load.boundingBox!;
    for (const box of [body, hay]) {
      expect(box.min.x).toBeGreaterThanOrEqual(-type.widthM / 2 - 1e-6);
      expect(box.max.x).toBeLessThanOrEqual(type.widthM / 2 + 1e-6);
      expect(box.min.z).toBeGreaterThanOrEqual(-type.lengthM / 2 - 1e-6);
      expect(box.max.z).toBeLessThanOrEqual(type.lengthM / 2 + 1e-6);
      expect(box.max.y).toBeLessThanOrEqual((type.heightM ?? 0) + 1e-6);
    }
    const mesh = new Mesh(g, new MeshBasicMaterial({ side: DoubleSide }));
    mesh.updateMatrixWorld(true);
    const ray = new Raycaster();
    // Sample the whole actual footprint, including its corners: the bed supports the hay,
    // rather than a closed cargo box or cab hiding inside it.
    for (const x of [hay.min.x, 0, hay.max.x])
      for (const z of [hay.min.z, (hay.min.z + hay.max.z) / 2, hay.max.z]) {
        ray.set(new Vector3(x, 10, z), new Vector3(0, -1, 0));
        expect(ray.intersectObject(mesh)[0]?.point.y).toBeCloseTo(hay.min.y, 1);
      }
    process.stdout.write(
      `[examined] Iowa body bounds ${JSON.stringify(body)}; attached hay bounds ${JSON.stringify(hay)}; AI envelope ${JSON.stringify(vehicleSize(s.cfg))}\n`,
    );
  });

  it('the crawling truck is a physical traffic contact when ridden into, with the ordinary speed rule', () => {
    for (const [closing, outcome] of [
      [4, 'wobble'],
      [20, 'crash'],
    ] as const) {
      const s = encounter();
      const p = activate(s);
      const truck = s.world.movers[p.vehicles[0]!]!;
      const at = toCorridor(s.c, truck.pos)!;
      const type = s.cfg.trafficTypes.find((t) => t.contentId === TRUCK)!;
      // Just inside contact at the rear; no loose bale lies here before the next drop.
      put(s, at.u - s.c.routeDir * (type.lengthM / 2 + 0.8), at.cd, truck.speed + closing);
      s.events = [];
      for (let t = 0; t < 30 && !s.events.some((e) => e.type === outcome); t++) tick(s, at.cd);
      expect(
        s.events.some((e) => e.type === outcome && e.data['cause'] === 'traffic' && e.target === truck.id),
      ).toBe(true);
    }
  });

  it('has an open passing lane that a rider can use to overtake without hitting truck or hay', () => {
    const s = encounter();
    const p = activate(s);
    const truck = s.world.movers[p.vehicles[0]!]!;
    const type = s.cfg.trafficTypes.find((t) => t.contentId === TRUCK)!;
    const start = toCorridor(s.c, truck.pos)!;
    const lane = lanesAt(s.cfg.road, s.c, start.u, -s.c.routeDir).find((l) => l.cd * start.cd < 0);
    expect(lane, 'opposing passing lane exists').toBeDefined();
    if (!lane) throw new Error('no passing lane');
    expect(Math.abs(lane.cd - start.cd)).toBeGreaterThan(type.widthM / 2 + 0.4);
    put(s, start.u - s.c.routeDir * 35, lane.cd, 30);
    let passed = false;
    for (let t = 0; t < 900 && !passed; t++) {
      tick(s, lane.cd);
      passed =
        s.c.routeDir * (toCorridor(s.c, s.player.pos)!.u - toCorridor(s.c, truck.pos)!.u) > type.lengthM;
    }
    expect(passed).toBe(true);
    expect(
      s.events.filter((e) => e.actor === s.player.id && (e.type === 'crash' || e.type === 'wobble')),
    ).toEqual([]);
  });

  it('a bale contact scrubs speed and wobbles; the clear lane control does neither', () => {
    const contact = (hit: boolean) => {
      const s = encounter();
      activate(s);
      const bale = setPieceState(s.world).props.find((q) => q.kind === 'hayBale')!;
      put(s, bale.u, hit ? bale.cd : -2, 20);
      s.events = [];
      tick(s, hit ? bale.cd : -2);
      return s;
    };
    const hit = contact(true);
    const clear = contact(false);
    expect(hit.events.some((e) => e.type === 'wobble' && e.data['prop'] === 'hayBale')).toBe(true);
    expect(hit.player.speed).toBeLessThan(clear.player.speed * 0.9);
    expect(clear.events.filter((e) => e.type === 'wobble' || e.type === 'crash')).toEqual([]);
  });

  it('keeps quiet seeds and finishes a same-seed bot race with identical replay hashes and one announcement', () => {
    const active = encounter();
    const quiet = firstSeed(
      'quiet Iowa highway',
      seedRange(1, 64),
      (seed) => scene(config(seed)),
      (s) => !setPieceState(s.world).pieces.some((p) => s.cfg.modifiers[p.mod]?.contentId === MOD),
    );
    expect(quiet.result, quiet.summary).not.toBeNull();
    const run = scene(active.cfg);
    const bot = createBot();
    const replay = scene(active.cfg);
    // Keep the test rider on the highway. The ordinary bot chooses the longer county detour,
    // which correctly misses this encounter; the sim still has the complete authored route.
    const highwayGuidance = { ...run.cfg.route, shortcuts: [] };
    for (let t = 0; t < 60 * 360 && !run.sim.isOver(); t++) {
      const actions = emptyActions();
      bot.drive(run.sim.snapshot(), run.player.id, highwayGuidance, actions);
      const input = toSimInput(actions);
      run.sim.step([input]);
      replay.sim.step([input]);
      run.events.push(...run.sim.events());
      expect(replay.sim.hash()).toBe(run.sim.hash());
    }
    expect(run.sim.isOver(), 'ordinary race still finishes').toBe(true);
    process.stdout.write(
      `[examined] Iowa main-highway finish/replay: ${run.sim.tick} ticks, every tick hash equal\n`,
    );
    const starts = run.events.filter((e) => e.type === 'modifierStart' && e.data['id'] === MOD);
    expect(starts).toHaveLength(1);
    expect(run.events.filter((e) => e.type === 'modifierEnd' && e.data['id'] === MOD)).toHaveLength(1);
  });
});
