/// <reference types="vite/client" />
import { expect, it } from 'vitest';
import { buildSimConfig, streamForEvent } from '../../src/app/config';
import { lookup, registryFromGlob, type ContentRegistry } from '../../src/content';
import {
  capPerDirection,
  TRAFFIC,
  trafficAreaAt,
  trafficGhost,
  trafficState,
  trafficSystem,
} from '../../src/sim/traffic';
import { fromCorridor } from '../../src/sim/traffic/corridor';
import { buildTrafficGraph } from '../../src/sim/traffic/network';
import { junctionSpawnAllowed } from '../../src/sim/traffic/junctions';
import { addMover, createWorld, stepWorld } from '../../src/sim/world';
import { firstSeed, ISOLATED, seedRange } from './batch';
import type { Mover } from '../../src/sim/world';
import { createSimWithWorld } from '../../src/sim/create';
import { blankActions, botInput, createBot } from '../../src/dev/bot';
import { nearestOnEdges } from '../../src/road';
import { SIM_DT } from '../../src/sim/api';
import {
  configFromHeader,
  createInputRecorder,
  createReplayController,
  decodeReplay,
  encodeReplay,
  HASH_EVERY_TICKS,
} from '../../src/replay';

const registry = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const EVENT = 'region-clinton:clinton-ia136-race';
const REGION = 'region-clinton:clinton-iowa';
const AREA = 'iowa-farm-traffic';
const TRUCK = 'base:box-truck';
function config(seed = 1, content: ContentRegistry = registry, eventId = EVENT, route?: string) {
  return buildSimConfig(content, streamForEvent(content, eventId, undefined, route), {
    seed,
    eventId,
    ...(route ? { route } : {}),
    eventPatch: { riders: [] },
    tuning: { ...ISOLATED, 'traffic.density': 1 },
  });
}

it('finishes an input-driven highway ride that encounters a delivery truck and reloads its replay', () => {
  const search = firstSeed(
    'Iowa input-driven delivery encounter',
    seedRange(1, 8),
    (seed) => {
      const c = config(seed);
      const { sim, world } = createSimWithWorld(c);
      const player = world.movers.find((m) => c.riders[m.riderIndex]?.role === 'player')!;
      const bot = createBot();
      const recorder = createInputRecorder();
      recorder.beginRace(sim, 'iowa-delivery-test-code+content');
      const encounters = new Map<
        string,
        {
          ahead: boolean;
          passed: boolean;
          following: boolean;
          interrupted: boolean;
          followingTick: number;
          passTick: number;
        }
      >();
      let tamperTick = -1;
      let finish;
      const route = { ...c.route, shortcuts: [] };
      while (!sim.isOver() && sim.tick < 18000 && !finish) {
        const actions = blankActions();
        bot.drive(sim.snapshot(), player.id, route, actions);
        const tick = sim.tick;
        const inputs = [botInput(actions)];
        recorder.record(tick, inputs);
        sim.step(inputs);
        if (tick % HASH_EVERY_TICKS === 0) recorder.checkpoint(tick, sim.hash());
        if (tamperTick < 0 && player.speed > 5) tamperTick = tick;
        const clean = player.mode === 'Road' && !trafficGhost(world, player.id);
        if (!clean)
          for (const encounter of encounters.values())
            if (encounter.ahead && !encounter.passed) encounter.interrupted = true;
        const st = trafficState(world);
        for (const [slot, id] of st.id.entries()) {
          if (st.retired[slot] || c.trafficTypes[st.type[slot]!]!.contentId !== TRUCK) continue;
          const truck = world.movers[id]!;
          if (truck.pos.dir !== player.pos.dir || truck.pos.edge !== player.pos.edge) continue;
          const delta = (truck.pos.s - player.pos.s) * player.pos.dir;
          const key = `${id}:${st.generation[slot]}`;
          const encounter = encounters.get(key) ?? {
            ahead: false,
            passed: false,
            following: false,
            interrupted: false,
            followingTick: -1,
            passTick: -1,
          };
          if (clean && delta > 0 && delta < 100) {
            encounter.ahead = true;
            if (Math.abs(truck.pos.d - player.pos.d) < 1 && player.speed > 5) {
              encounter.following = true;
              if (encounter.followingTick < 0) encounter.followingTick = tick;
            }
          }
          if (clean && encounter.ahead && delta < -15) {
            encounter.passed = true;
            if (encounter.passTick < 0) encounter.passTick = tick;
          }
          encounters.set(key, encounter);
        }
        finish = sim.events().find((e) => e.actor === player.id && e.type === 'finish');
      }
      recorder.finish(sim.tick - 1, sim.hash());
      return { c, sim, recording: recorder.current()!, encounters, finish, tamperTick };
    },
    (r) => [...r.encounters.values()].some((e) => e.ahead && e.passed && e.following && !e.interrupted),
  );
  expect(search.result, search.summary).not.toBeNull();
  const r = search.result!;
  expect(r.finish, 'player crosses the real finish').toBeDefined();
  expect(r.finish!.data['classified']).toBe(false);
  const recording = decodeReplay(JSON.parse(JSON.stringify(encodeReplay(r.recording))));
  const fresh = () => createSimWithWorld(configFromHeader(recording.header, r.c.road, r.c.route)).sim;
  const replay = createReplayController(recording).run(fresh());
  expect(replay.desync).toBeNull();
  expect(replay.finalHash).toBe(r.sim.hash());
  expect(r.tamperTick).toBeGreaterThan(0);
  const tampered = structuredClone(recording);
  const command = tampered.inputs[r.tamperTick]![0]!;
  command.steer = command.steer === 127 ? -127 : 127;
  expect(createReplayController(tampered).run(fresh()).desync).not.toBeNull();
  process.stdout.write(
    `[examined] Iowa input-driven following/pass, seed ${search.seed}, bike ${r.c.riders.find((r) => r.role === 'player')!.bike.contentId}, encounters ${JSON.stringify([...r.encounters.entries()].filter(([, e]) => e.following && e.passed && !e.interrupted))}, finish tick ${r.sim.tick}, encoded/reloaded replay ${replay.checked} hashes, tamper tick ${r.tamperTick}\n`,
  );
});

function body(c: ReturnType<typeof config>, mover: Mover, lengthM: number, widthM: number, heightM: number) {
  const point = c.road.toWorld(mover.pos.edge, mover.pos.s, mover.pos.d, 0);
  const frame = c.road.frameAt(mover.pos.edge, mover.pos.s);
  const cy = Math.cos(mover.yaw),
    sn = Math.sin(mover.yaw);
  return {
    ...point,
    tx: cy * frame.tx - sn * frame.tz,
    tz: cy * frame.tz + sn * frame.tx,
    grade: frame.grade,
    bank: frame.bank,
    cy,
    sn,
    lengthM,
    widthM,
    heightM,
  };
}
function onPavement(
  c: ReturnType<typeof config>,
  mover: Mover,
  box: ReturnType<typeof body>,
  along: number,
  across: number,
) {
  const x = box.x + box.tx * along - box.tz * across;
  const z = box.z + box.tz * along + box.tx * across;
  // A nearest centerline alone can pick the narrower overlapping rejoin pavement. Test each
  // connected local surface, including world distance and height, with the public projector.
  const edges = [
    mover.pos.edge,
    ...c.road.neighbours(mover.pos.edge, mover.pos.s, box.lengthM).map((n) => n.edge),
  ];
  const expectedY =
    box.y + (along * box.cy - across * box.sn) * box.grade - (along * box.sn + across * box.cy) * box.bank;
  return edges.some((edge) => {
    const corner = nearestOnEdges(c.road, [edge], x, z)!;
    const point = c.road.toWorld(corner.edge, corner.s, corner.d, 0);
    return (
      Math.hypot(point.x - x, point.z - z) < 0.05 &&
      Math.abs(point.y - expectedY) < 0.25 &&
      c.road
        .lanesAt(corner.edge, corner.s)
        .some(
          (l) =>
            (l.kind === 'drive' || l.kind === 'shortcut') &&
            Math.abs(corner.d - l.dCenterM) <= l.widthM / 2 + 0.02,
        )
    );
  });
}
function overlaps(a: ReturnType<typeof body>, b: ReturnType<typeof body>) {
  if (a.y + a.heightM <= b.y || b.y + b.heightM <= a.y) return false;
  return [
    [a.tx, a.tz],
    [-a.tz, a.tx],
    [b.tx, b.tz],
    [-b.tz, b.tx],
  ].every(([x, z]) => {
    const radius = (p: typeof a) =>
      (p.lengthM / 2) * Math.abs(p.tx * x! + p.tz * z!) + (p.widthM / 2) * Math.abs(-p.tz * x! + p.tx * z!);
    return Math.abs((a.x - b.x) * x! + (a.z - b.z) * z!) < radius(a) + radius(b) - 0.02;
  });
}

/** Conservative world-metres per road-metre, including offset curvature and bank changes. */
function highwayMotionScale(c: ReturnType<typeof config>) {
  let scale = 1;
  for (const index of c.route.mainEdges) {
    const edge = c.road.edges[index]!;
    const d = Math.max(Math.abs(edge.dMin), Math.abs(edge.dMax));
    const minDenominator = Math.min(...edge.kappa.map((k) => 1 - Math.abs(k) * d));
    expect(minDenominator, 'authored highway offsets have a finite curvature metric').toBeGreaterThan(0);
    for (let i = 1; i < edge.count; i++) {
      const ds = Math.min(edge.spacing, edge.length - (i - 1) * edge.spacing);
      const base =
        Math.hypot(edge.x[i]! - edge.x[i - 1]!, edge.y[i]! - edge.y[i - 1]!, edge.z[i]! - edge.z[i - 1]!) /
        ds;
      const minTangentNorm = Math.hypot(edge.tx[i]! + edge.tx[i - 1]!, edge.tz[i]! + edge.tz[i - 1]!) / 2;
      const tangentRate =
        Math.hypot(edge.tx[i]! - edge.tx[i - 1]!, edge.tz[i]! - edge.tz[i - 1]!) /
        ds /
        (minTangentNorm * minTangentNorm);
      const bankRate = Math.abs(edge.bank[i]! - edge.bank[i - 1]!) / ds;
      scale = Math.max(scale, (base + d * (tangentRate + bankRate)) / minDenominator);
    }
  }
  return scale;
}

it('offers occasional delivery trucks only at the authored farm traffic spawn tags', () => {
  const c = config();
  const region = lookup(registry.regions, REGION);
  const area = region.traffic.areas?.find((a) => a.tag === AREA);
  expect(area, 'the farm traffic area is authored in the Iowa region').toBeDefined();
  const truck = c.trafficTypes.find((t) => t.contentId === TRUCK)!;
  expect(truck.weight).toBe(0);
  expect(truck.areaWeights?.[AREA]).toBeGreaterThan(0);
  for (const car of region.traffic.mix) {
    const weight = area!.mix.find((m) => m.kind === car.kind)?.weight;
    expect(weight).toBe(car.weight);
    expect(truck.areaWeights![AREA]).toBeLessThan(weight!);
  }
  const world = createWorld(c);
  addMover(
    world,
    'rider',
    c.route.start,
    c.riders.findIndex((r) => r.role === 'player'),
  );
  trafficSystem.init(world, c);
  const corridor = trafficState(world).corridor;
  const tagged = c.road.edges.filter((e) => e.tags?.some((t) => t.tag === AREA));
  expect(tagged.some((e) => e.isConnector)).toBe(true);
  expect(tagged.some((e) => !e.isConnector)).toBe(true);
  for (const edge of c.road.edges) {
    const index = corridor.edges.indexOf(edge.index);
    if (index < 0) continue;
    const u = corridor.off[index]! + edge.length / 2;
    expect(trafficAreaAt(c, corridor, u), edge.id).toBe(tagged.includes(edge) ? AREA : null);
  }
  const noArea: ContentRegistry = {
    ...registry,
    regions: {
      ...registry.regions,
      [REGION]: {
        ...region,
        traffic: { ...region.traffic, areas: region.traffic.areas!.filter((a) => a.tag !== AREA) },
      },
    },
  };
  const control = config(1, noArea);
  expect(control.trafficTypes.find((t) => t.contentId === TRUCK)?.areaWeights?.[AREA] ?? 0).toBe(0);
  expect(control.trafficTypes.map((t) => [t.contentId, t.weight])).toEqual(
    c.trafficTypes.map((t) => [t.contentId, t.weight]),
  );
  // Every authored Iowa route, including the separate park network, resolves the area's
  // selection at each physical road. The area is not a lifetime fence.
  for (const [routeId, route] of Object.entries(registry.routes)) {
    if (!region.networks.includes(route.network)) continue;
    const resolved = config(1, registry, EVENT, routeId);
    const truckType = resolved.trafficTypes.find((t) => t.contentId === TRUCK)!;
    expect(truckType.weight).toBe(0);
    for (const edge of resolved.road.edges) {
      const local = {
        edges: [edge.index],
        o: [1],
        off: [0],
        len: [edge.length],
        dOff: [0],
        length: edge.length,
        lo: 0,
        hi: edge.length,
        routeDir: 1 as const,
      };
      expect(trafficAreaAt(resolved, local, edge.length / 2), edge.id).toBe(
        edge.tags?.some((t) => t.tag === AREA) ? AREA : null,
      );
    }
  }
  expect(
    c.road.edges.some(
      (edge) =>
        edge.isConnector &&
        !junctionSpawnAllowed(
          c,
          { edge: edge.index, s: edge.length / 2, d: 0, dir: 1 },
          truck.lengthM,
          truck.widthM,
        ),
    ),
    'junction rejection remains active for the existing truck footprint',
  ).toBe(true);
});

const taggedRoads = config().road.edges.filter((e) => e.tags?.some((t) => t.tag === AREA));
for (const road of taggedRoads)
  for (const direction of [1, -1] as const) {
    it(`admits and recycles an ordinary delivery truck from ${road.id} direction ${direction}`, () => {
      const search = firstSeed(
        `Iowa delivery ${road.id}/${direction}`,
        seedRange(1, 64),
        (seed) => {
          const c = config(seed);
          const reference = buildTrafficGraph(c).reference;
          const index = reference.edges.indexOf(road.index);
          const anchor = { ...c.route.start };
          fromCorridor(reference, reference.off[index]! + road.length / 2 - 400, 8, 1, anchor);
          const world = createWorld(c);
          addMover(
            world,
            'rider',
            anchor,
            c.riders.findIndex((r) => r.role === 'player'),
          );
          trafficSystem.init(world, c);
          stepWorld(world, c, [trafficSystem], []);
          const st = trafficState(world);
          const slot = st.id.findIndex(
            (id, k) =>
              world.movers[id]!.pos.edge === road.index &&
              world.movers[id]!.pos.dir === direction &&
              c.trafficTypes[st.type[k]!]!.contentId === TRUCK,
          );
          return { c, world, st, slot };
        },
        (r) => r.slot >= 0,
      );
      expect(search.result, search.summary).not.toBeNull();
      const { c, world, st, slot } = search.result!;
      const truck = c.trafficTypes[st.type[slot]!]!;
      const vehicle = world.movers[st.id[slot]!]!;
      const generation = st.generation[slot];
      const start = { ...vehicle.pos };
      expect(junctionSpawnAllowed(c, start, truck.lengthM, truck.widthM)).toBe(true);
      // Keep each highway part inside a real population window until this generation reaches its
      // finite exit. These stationary shoulder anchors do not alter the truck or its chosen path.
      const player = c.riders.findIndex((r) => r.role === 'player');
      for (const edge of c.route.mainEdges)
        for (let s = 0; s < c.road.edges[edge]!.length; s += TRAFFIC.windowM)
          addMover(world, 'rider', { edge, s, d: 8, dir: 1 }, player);
      const originalBody = body(c, vehicle, truck.lengthM, truck.widthM, truck.heightM!);
      expect(
        overlaps(originalBody, { ...originalBody, y: originalBody.y + originalBody.heightM + 1 }),
        'same horizontal footprint at another height does not contact',
      ).toBe(false);
      expect(
        onPavement(c, vehicle, { ...originalBody, y: originalBody.y + truck.heightM! }, 0, 0),
        'an elevated body over the same road has no pavement at its height',
      ).toBe(false);
      expect(
        onPavement(
          c,
          vehicle,
          {
            ...originalBody,
            x: originalBody.x - originalBody.tz * 100,
            z: originalBody.z + originalBody.tx * 100,
          },
          0,
          0,
        ),
        'a lateral miss has no nearby pavement',
      ).toBe(false);
      expect(
        overlaps(originalBody, {
          ...originalBody,
          x: originalBody.x + (originalBody.tx * truck.lengthM) / 4,
          z: originalBody.z + (originalBody.tz * truck.lengthM) / 4,
        }),
      ).toBe(true);
      expect(
        overlaps(originalBody, {
          ...originalBody,
          x: originalBody.x - originalBody.tz * (truck.widthM + 1),
          z: originalBody.z + originalBody.tx * (truck.widthM + 1),
        }),
      ).toBe(false);
      const visited = new Set<number>([start.edge]);
      let previous = c.road.toWorld(start.edge, start.s, start.d, 0);
      let previousSpeed = vehicle.speed;
      const motionScale = highwayMotionScale(c);
      expect(truck.lengthM, 'a one-body-length teleport exceeds the content/velocity bound').toBeGreaterThan(
        st.v0[slot]! * SIM_DT * motionScale,
      );
      let travelled = 0;
      let maximumStep = 0;
      let opposingPasses = 0;
      let terminalExitCorners = 0;
      const deadline = Math.ceil(
        (c.route.mainEdges.reduce((sum, edge) => sum + c.road.edges[edge]!.length, 0) / 5) * 60,
      );
      while (world.tick < deadline && st.generation[slot] === generation) {
        stepWorld(world, c, [trafficSystem], []);
        if (st.generation[slot] !== generation) break;
        visited.add(vehicle.pos.edge);
        const point = c.road.toWorld(vehicle.pos.edge, vehicle.pos.s, vehicle.pos.d, 0);
        const step = Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z);
        expect(Number.isFinite(step)).toBe(true);
        // One tick's speed times the authored road metric, plus 1 mm for baked-coordinate
        // rounding at joined endpoints. No observed-rate or hand-picked world-step ceiling.
        expect(step, `velocity-qualified continuity at tick ${world.tick}`).toBeLessThanOrEqual(
          Math.max(previousSpeed, vehicle.speed) * SIM_DT * motionScale + 0.001,
        );
        maximumStep = Math.max(maximumStep, step);
        travelled += step;
        previous = point;
        previousSpeed = vehicle.speed;
        expect(c.route.mainEdges).toContain(vehicle.pos.edge);
        const lane = c.road
          .lanesAt(vehicle.pos.edge, vehicle.pos.s)
          .find((l) => l.direction === vehicle.pos.dir && l.kind === 'drive');
        expect(lane).toBeDefined();
        expect(Math.abs(vehicle.pos.d - lane!.dCenterM) + truck.widthM / 2).toBeLessThanOrEqual(
          lane!.widthM / 2 + 0.01,
        );
        const box = body(c, vehicle, truck.lengthM, truck.widthM, truck.heightM!);
        for (const along of [-truck.lengthM / 2, truck.lengthM / 2])
          for (const across of [-truck.widthM / 2, truck.widthM / 2]) {
            const edge = c.road.edges[vehicle.pos.edge]!;
            // The finite network ends at its exit; it has no pavement beyond that boundary.
            // Qualify every internal connector/rejoin corner, and count the off-map exit tips.
            if (
              (vehicle.pos.s + along < 0 && edge.prevLinks.length === 0) ||
              (vehicle.pos.s + along > edge.length && edge.nextLinks.length === 0)
            ) {
              terminalExitCorners++;
              continue;
            }
            expect(
              onPavement(c, vehicle, box, along, across),
              `whole body on connected pavement at its height ${JSON.stringify({ tick: world.tick, pos: vehicle.pos, along, across })}`,
            ).toBe(true);
          }
        for (const [otherSlot, id] of st.id.entries()) {
          if (id === vehicle.id || st.retired[otherSlot]) continue;
          const other = world.movers[id]!;
          const type = c.trafficTypes[st.type[otherSlot]!]!;
          const otherBody = body(c, other, type.lengthM, type.widthM, type.heightM!);
          expect(
            overlaps(box, otherBody),
            `physical truck contact at tick ${world.tick}: ${vehicle.id}/${id}`,
          ).toBe(false);
          if (
            other.pos.dir !== vehicle.pos.dir &&
            Math.hypot(box.x - otherBody.x, box.z - otherBody.z) < truck.lengthM + type.lengthM
          )
            opposingPasses++;
        }
        for (const dir of [1, -1])
          expect(st.id.filter((_id, k) => !st.retired[k] && st.dir[k] === dir).length).toBeLessThanOrEqual(
            capPerDirection(world),
          );
      }
      expect(travelled).toBeGreaterThan(truck.lengthM);
      expect(opposingPasses, 'actual opposing bodies pass the tracked truck').toBeGreaterThan(0);
      expect(st.generation[slot], 'the tracked identity eventually recycles normally').not.toBe(generation);
      process.stdout.write(
        `[examined] Iowa ordinary ${road.id}/${direction}: seed ${search.seed}, identity ${vehicle.id}/${generation}, ${travelled.toFixed(1)}m, ${visited.size} roads, maximum step ${maximumStep.toFixed(3)}m, authored motion scale ${motionScale.toFixed(3)}, opposing body observations ${opposingPasses}, off-map terminal corner samples ${terminalExitCorners}, recycled at ${world.tick}\n`,
      );
    });
  }
