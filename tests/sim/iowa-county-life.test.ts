/// <reference types="vite/client" />
import { expect, it } from 'vitest';
import { InstancedMesh, Mesh, Raycaster, Vector3, type Object3D } from 'three';
import { buildSimConfig, createStreamCache, realRoutes } from '../../src/app';
import { streamSeed } from '../../src/core';
import { lookup, registryFromGlob, type ContentRegistry } from '../../src/content';
import { createFlatLook } from '../../src/render';
import { buildRoadScene } from '../../src/render/road-mesh';
import { createSimWithWorld } from '../../src/sim/create';
import { sectionGroundOf } from '../../src/road';
import { PED_PHASE, pedsState } from '../../src/sim/peds';
import { pedsStep } from '../../src/sim/peds/step';
import type { World } from '../../src/sim/world';
import { riderState } from '../../src/sim/riders';
import { firstSeed, ISOLATED } from './batch';
import { quantizeInput, type SimInput, type SimConfig, type SimEvent } from '../../src/sim/api';

const sourceRegistry = registryFromGlob(
  import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const roadId = 'region-clinton:osm-clinton-county-180th';
const candidate: NonNullable<ContentRegistry['roads'][string]['features']>[number] = {
  kind: 'roadsideZone',
  id: 'county-loading-stroll',
  s0: 640,
  s1: 650,
  d0: 18,
  d1: 19,
  params: { kinds: ['base:dog-walker'], maxPeds: 1 },
};
// Start from source content minus only this zone; append one controlled fixture below.
const sourceRoad = sourceRegistry.roads[roadId]!;
const fixtureBase = {
  ...sourceRegistry,
  roads: {
    ...sourceRegistry.roads,
    [roadId]: { ...sourceRoad, features: (sourceRoad.features ?? []).filter((f) => f.id !== candidate.id) },
  },
};
const registry = {
  ...fixtureBase,
  roads: {
    ...fixtureBase.roads,
    [roadId]: { ...sourceRoad, features: [...fixtureBase.roads[roadId].features, candidate] },
  },
};
const quietRegistry = fixtureBase;
function makeConfig(seed = 1, quiet = false) {
  const reg = quiet ? quietRegistry : registry;
  const base = buildSimConfig(reg, createStreamCache().forEvent(reg, 'region-clinton:clinton-ia136-race'), {
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
    },
  });
  return { ...base, riders: base.riders.filter((r) => r.role === 'player') };
}

it('initializes every shipped event length and offered route with a content-derived seed cohort', () => {
  const streams = createStreamCache();
  const cases: { eventId: string; length?: string; route?: string }[] = Object.entries(sourceRegistry.events)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([eventId, event]) => [
      ...event.lengths.map((length) => ({
        eventId,
        length: length.id,
      })),
      ...realRoutes(sourceRegistry, eventId).map((route) => ({
        eventId,
        route,
      })),
    ]);
  const failures: { eventId: string; length?: string; route?: string; seed: number; error: string }[] = [];
  let examined = 0,
    populationEntities = 0;
  for (const choice of cases)
    for (let index = 0; index < 3; index++) {
      const seed = streamSeed(
        1,
        `pedestrian-init:${choice.eventId}:${choice.length ?? choice.route}:${index}`,
      );
      try {
        const config = buildSimConfig(
          sourceRegistry,
          streams.forEvent(sourceRegistry, choice.eventId, choice.length, choice.route),
          { ...choice, seed },
        );
        const { sim } = createSimWithWorld(config);
        const snap = sim.snapshot();
        expect(snap.tick).toBe(0);
        populationEntities += snap.entities.filter((e) => e.kind === 'ped').length;
      } catch (error) {
        failures.push({ ...choice, seed, error: error instanceof Error ? error.message : String(error) });
      }
      examined++;
    }
  process.stdout.write(
    `[shipped pedestrian initialization] ${JSON.stringify({ events: Object.keys(sourceRegistry.events).length, configurations: cases.length, seedsPerConfiguration: 3, examined, populationEntities, failures })}\n`,
  );
  expect(cases.length).toBeGreaterThan(0);
  expect(examined).toBe(cases.length * 3);
  expect(populationEntities).toBeGreaterThan(0);
  expect(failures).toEqual([]);
});

function localSlots(world: World, config: SimConfig): number[] {
  const st = pedsState(world);
  const edge = config.road.edgeIndex('osm-clinton-county-180th');
  return st.id.flatMap((id, k) => {
    const p = world.movers[id];
    return p?.pos.edge === edge &&
      config.trafficTypes[st.type[k] ?? -1]?.contentId === 'base:dog-walker' &&
      st.zoneS0[k] === candidate.s0 &&
      st.zoneS1[k] === candidate.s1 &&
      st.homeD[k]! >= candidate.d0 &&
      st.homeD[k]! <= candidate.d1
      ? [k]
      : [];
  });
}

function localPed(world: World, config: SimConfig) {
  const slots = localSlots(world, config);
  expect(slots).toHaveLength(1);
  const k = slots[0]!,
    st = pedsState(world),
    p = world.movers[st.id[k]!]!;
  let previousTouch = -1;
  const observed = {
    dives: 0,
    contacts: 0,
    read(events: readonly SimEvent[] = world.events) {
      observed.dives += events.filter((e) => e.type === 'pedDive' && e.actor === p.id).length;
      const touching = st.touching[k] ?? -1;
      if (touching >= 0 && touching !== previousTouch) observed.contacts++;
      previousTouch = touching;
    },
  };
  return { st, k, p, observed };
}

it('the county loading context has one local strolling person', () => {
  const config = makeConfig(),
    { world } = createSimWithWorld(config);
  const { st, k, p } = localPed(world, config);
  expect(config.trafficTypes[st.type[k]!]!.contentId).toBe('base:dog-walker');
  expect(p.pos.s).toBeGreaterThanOrEqual(candidate.s0);
  expect(p.pos.s).toBeLessThanOrEqual(candidate.s1);
  const zone = registry.roads[roadId].features?.find((f) => f.id === candidate.id);
  expect(zone?.params).toHaveProperty('maxPeds', 1);
  expect(zone?.params).toHaveProperty('kinds', ['base:dog-walker']);
});

it('removed-zone control is quiet, while normal strolling stays on dry drawn support', () => {
  const quiet = makeConfig(1, true),
    quietWorld = createSimWithWorld(quiet).world;
  expect(localSlots(quietWorld, quiet)).toEqual([]);
  const config = makeConfig();
  const { sim, world } = createSimWithWorld(config);
  const { st, k, p, observed } = localPed(world, config);
  expect(st.crosses[k]).toBe(0);
  const ground = sectionGroundOf(config.road);
  const seen = new Set<number>();
  for (let tick = 0; tick < 1200; tick++) {
    sim.step([{ steer: 0, throttle: 0, brake: 255, flags: 0 }]);
    observed.read(sim.events());
    seen.add(Math.round(p.pos.s * 4));
    const y = ground(p.pos.edge, p.pos.s, p.pos.d);
    expect(y).not.toBeNull();
    expect(Math.abs(y! - config.road.surfaceHeight(p.pos.edge, p.pos.s, p.pos.d))).toBeLessThan(0.25);
  }
  expect(seen.size).toBeGreaterThan(25);
  expect(observed.dives).toBe(0);
  expect(observed.contacts).toBe(0);
  process.stdout.write(
    `[county quiet/stroll control] ${JSON.stringify({ quietPeds: 0, quarterMetreStations: seen.size, crosses: st.crosses[k], dives: observed.dives, contacts: observed.contacts })}\n`,
  );
});

it('the entire repeated reaction envelope retains grounded support', () => {
  const config = makeConfig();
  const { sim, world } = createSimWithWorld(config);
  const { st, k, p, observed } = localPed(world, config);
  const me = world.movers[0]!;
  const ground = sectionGroundOf(config.road);
  const trace: unknown[] = [];
  const errors: unknown[] = [];
  // Each stimulus is another close approach to the same real zone-spawned person. The
  // pedestrian is never teleported or put into a forced phase. Peds' public state and step
  // expose the whole reaction envelope independently of a particular rider controller.
  for (let pass = 0; pass < 12; pass++) {
    me.pos = { edge: p.pos.edge, s: p.pos.s - 2, d: p.pos.d - 1.2, dir: 1 };
    me.speed = 4;
    me.h = 0;
    riderState(world).yAbs[me.id] = config.road.surfaceHeight(me.pos.edge, me.pos.s, me.pos.d);
    const riderGround = ground(me.pos.edge, me.pos.s, me.pos.d);
    trace.push({ pass, riderD: me.pos.d, riderGround, fromD: p.pos.d });
    expect(riderGround).not.toBeNull();
    expect(Math.abs(riderGround! - config.road.surfaceHeight(me.pos.edge, me.pos.s, me.pos.d))).toBeLessThan(
      0.25,
    );
    for (let tick = 0; tick < 32; tick++) {
      world.events = [];
      pedsStep(world, config);
      observed.read();
      world.tick++;
      if (st.phase[k] === PED_PHASE.dive) me.speed = 0;
      if (p.h > 0) continue; // An intended airborne arc is not a grounded-foot error.
      const y = ground(p.pos.edge, p.pos.s, p.pos.d);
      const foot = sim.snapshot().entities.find((e) => e.id === p.id)!.y;
      // Section samples and exact mesh vertices differ at Float32 precision.
      if (y === null || Math.abs(y - foot) > 1e-4)
        errors.push({ pass, tick, d: p.pos.d, phase: st.phase[k], h: p.h, foot, drawnY: y });
    }
  }
  const dressing = Object.fromEntries(
    config.road.edges.map((e) => [e.id, lookup(registry.roads, e.id, 'region-clinton')]),
  );
  const scene = buildRoadScene(config.road, createFlatLook(), dressing);
  const { group } = scene;
  group.updateMatrixWorld(true);
  const meshes: Object3D[] = [];
  group.traverse((o) => {
    if (o instanceof Mesh && !(o instanceof InstancedMesh)) meshes.push(o);
  });
  const spot = sim.snapshot().entities.find((e) => e.id === p.id)!;
  const ray = new Raycaster(new Vector3(spot.x, spot.y + 20, spot.z), new Vector3(0, -1, 0));
  const hit = ray.intersectObjects(meshes, false)[0];
  process.stdout.write(
    `[county rendered support] ${JSON.stringify({ footY: spot.y, h: spot.road.h, hitName: hit?.object.name, hitY: hit?.point.y, gap: hit ? spot.y - hit.point.y : null })}\n`,
  );
  process.stdout.write(
    `[county reaction envelope] ${JSON.stringify({ trace, errors, dives: observed.dives, snapshot: sim.snapshot().entities.filter((e) => e.id === p.id) })}\n`,
  );
  expect(observed.dives).toBeGreaterThan(1);
  expect(errors).toEqual([]);
  expect(hit?.object.name).toBe('road-land');
  expect(Math.abs(spot.y - hit!.point.y)).toBeLessThan(1e-6);
  scene.dispose();
  // With threats gone, recover at walking pace rather than snapping to homeD.
  me.speed = 0;
  let largestRecoveryStep = 0;
  for (let tick = 0; tick < 1200; tick++) {
    const previous = { s: p.pos.s, d: p.pos.d };
    pedsStep(world, config);
    world.tick++;
    largestRecoveryStep = Math.max(
      largestRecoveryStep,
      Math.hypot(p.pos.s - previous.s, p.pos.d - previous.d),
    );
  }
  expect(largestRecoveryStep).toBeLessThan(0.03);
  expect(p.pos.d).toBeCloseTo(st.homeD[k]!, 8);
});

it('ordinary main/shoulder riding stays clear; a deliberate county approach reacts and exactly replays', () => {
  function run(seed: number, take: boolean, shoulder = false, replay?: SimInput[]) {
    const config = makeConfig(seed),
      { sim, world } = createSimWithWorld(config);
    const edge = config.road.edgeIndex(take ? 'osm-clinton-county-180th' : 'osm-clinton-ia136-east-bends');
    const { st, k, p: ped, observed } = localPed(world, config);
    const me = world.movers[0]!;
    me.pos = {
      edge,
      s: take ? candidate.s0 - 40 : 40,
      d: take ? candidate.d0 - 1.2 : shoulder ? 4.25 : 1.75,
      dir: 1,
    };
    me.speed = 12;
    riderState(world).yAbs[me.id] = config.road.surfaceHeight(edge, me.pos.s, me.pos.d);
    const inputs: SimInput[] = [],
      events = [];
    let nearest:
      { ahead: number; dd: number; riderY: number; pedY: number; d: number; s: number } | undefined;
    while (sim.tick < 2400 && me.pos.edge === edge && me.pos.s < (take ? candidate.s1 + 65 : 160)) {
      const target = take && me.pos.s < candidate.s1 - 3 ? candidate.d0 - 1.2 : shoulder ? 4.25 : 1.75;
      const desired = Math.atan((target - me.pos.d) / 6);
      const command =
        replay?.[sim.tick] ??
        quantizeInput({
          throttle: me.speed < 12 ? 0.5 : 0,
          brake: me.speed > 13 ? 0.3 : 0,
          steer: Math.max(-1, Math.min(1, 1.8 * (desired - me.yaw))),
          flags: 0,
        });
      inputs.push(command);
      sim.step([command]);
      observed.read(sim.events());
      events.push(...sim.events());
      if (ped && (!nearest || Math.abs(ped.pos.s - me.pos.s) < Math.abs(nearest.ahead)))
        nearest = {
          ahead: ped.pos.s - me.pos.s,
          dd: ped.pos.d - me.pos.d,
          riderY: riderState(world).yAbs[me.id]!,
          pedY: st.groundY[k]!,
          d: me.pos.d,
          s: me.pos.s,
        };
    }
    if (take)
      process.stdout.write(
        `[county approach trace] ${JSON.stringify({ seed, s: me.pos.s, d: me.pos.d, mode: me.mode, ticks: sim.tick, peds: localSlots(world, config).length, nearest, dives: observed.dives, contacts: observed.contacts, events: events.filter((e) => ['crash', 'respawn', 'pedDive', 'pedReact'].includes(e.type)) })}\n`,
      );
    return {
      hash: sim.hash(),
      inputs,
      events,
      dives: observed.dives,
      contacts: observed.contacts,
      s: me.pos.s,
      mode: me.mode,
    };
  }
  for (const shoulder of [false, true]) {
    const ordinary = run(1, false, shoulder);
    expect(ordinary.s).toBeGreaterThanOrEqual(160);
    expect(ordinary.events.filter((e) => e.type === 'crash' || e.type === 'respawn')).toEqual([]);
    expect(ordinary.dives).toBe(0);
    expect(ordinary.contacts).toBe(0);
  }
  const found = firstSeed(
    'county ridden pedestrian reaction',
    [1, 2, 3],
    (seed) => run(seed, true),
    (r) => r.dives > 0 && r.contacts === 0 && r.mode === 'Road',
  );
  expect(found.result, found.summary).not.toBeNull();
  if (!found.result || found.seed === null) return;
  expect(found.result.events.filter((e) => e.type === 'crash' || e.type === 'respawn')).toEqual([]);
  expect(found.result.s).toBeGreaterThanOrEqual(candidate.s1 + 65);
  const replay = run(found.seed, true, false, found.result.inputs);
  expect(replay.hash).toBe(found.result.hash);
  expect(replay.events).toEqual(found.result.events);
  process.stdout.write(
    `[county ridden reaction] ${JSON.stringify({ seed: found.seed, dives: found.result.dives, contacts: found.result.contacts, s: found.result.s, hash: found.result.hash, replayHash: replay.hash })}\n`,
  );
});
