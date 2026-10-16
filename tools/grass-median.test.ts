import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
  type MeshLambertMaterial,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  createRouteProgress,
  fixtureNetwork,
  highwayLanes,
  type BakedMedian,
  type BakedNetwork,
  type BakedRoad,
  type RoadNetwork,
} from '../src/road';
import { createSim, type SimEvent } from '../src/sim/api';
import { createInputRecorder, createReplayController, decodeReplay, HASH_EVERY_TICKS } from '../src/replay';
import { input, riderHarness, testConfig } from '../src/sim/riders/testing';
import { createFlatLook } from '../src/render/look';
import { buildRoadScene } from '../src/render/road-mesh';
import { GroundTris } from '../src/render/land-probe.test-util';
import { floorOf, GROUND_OVER_M } from '../src/render/road-clear.test-util';
import { DownIndex, SURFACES } from '../tests/sim/geometry-routes';

const roadFiles = import.meta.glob<BakedRoad>('../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const networkFiles = import.meta.glob<BakedNetwork>('../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const authored = Object.entries(networkFiles).flatMap(([path, network]) => {
  const folder = path.slice(0, path.lastIndexOf('/networks/'));
  const roads = network.roads.map((id) => roadFiles[`${folder}/roads/${id}.json`]);
  if (!roads.every((r): r is BakedRoad => !!r)) throw new Error(`missing road in ${network.id}`);
  return roads.some((r) => r.laneSections.some((s) => s.median?.kind === 'grass'))
    ? [{ road: createRoadNetwork({ network, roads }), roads }]
    : [];
});

// Independent contract oracle: the authored width sits centrally between opposing carriageways.
function gap(road: RoadNetwork, edge: number, s: number): [number, number] {
  const lanes = road.lanesAt(edge, s).filter((l) => l.kind === 'drive');
  const left = lanes.filter((l) => l.direction === -1);
  const right = lanes.filter((l) => l.direction === 1);
  const a = Math.max(...left.map((l) => l.dCenterM + l.widthM / 2));
  const b = Math.min(...right.map((l) => l.dCenterM - l.widthM / 2));
  const half = road.crossSectionAt(edge, s).median!.widthM / 2;
  return [(a + b) / 2 - half, (a + b) / 2 + half];
}

function fixture(kind?: BakedMedian['kind']) {
  const lanes = highwayLanes(2).map((l) => ({ ...l, dCenterM: l.dCenterM + 2 * l.direction }));
  const bundle = fixtureNetwork([
    { id: 'a', lengthM: 300, kappa: 0, lanes },
    { id: 'bend', lengthM: 150, kappa: 0.006, grade: 0.03, lanes },
  ]);
  // A land road, above the renderer's sea plane; the test is about joined ground, not a causeway.
  for (const r of bundle.roads)
    r.samples = { ...r.samples, data: { ...r.samples.data, y: r.samples.data['y']!.map((y) => y + 20) } };
  for (const j of bundle.network.junctions) j.y += 20;
  for (const r of bundle.roads) if (kind) r.laneSections[0]!.median = { kind, widthM: 4 };
  const road = createRoadNetwork(bundle);
  const route = createRouteProgress(road, {
    id: 'median',
    network: bundle.network.id,
    start: { road: 'a', s: 20, dir: 1 },
    finish: { road: 'bend', s: 140 },
    mainPath: ['a', 'bend'],
    allowedRoads: ['a', 'bend'],
    closed: false,
  });
  return { ...testConfig({ tuning: { 'ground.offRoad': 1 } }), road, route };
}

describe('authored grass medians are a distinct crossable surface', () => {
  it('includes turf in physical-floor and visible-ground probes, with the ground-height rule', () => {
    const group = new Group();
    const median = new Mesh(new BoxGeometry(4, 0.2, 10), new MeshBasicMaterial());
    median.name = 'road-median';
    group.add(median);
    const rays = new GroundTris(group);
    const indexed = new DownIndex(group, SURFACES);
    expect(rays.heightAt(0, 0)?.name).toBe('road-median');
    expect(indexed.at(0, 0, 1)?.name).toBe('road-median');
    expect(rays.heightAt(20, 0)).toBeNull();
    expect(indexed.at(20, 0, 1)).toBeNull();
    expect(floorOf('road-median')).toBe(GROUND_OVER_M);
  });
  it('queries grass inside every authored grass section, including connector pieces, and asphalt on its lanes', () => {
    expect(authored.length).toBeGreaterThan(0);
    let probes = 0;
    let connectorProbes = 0;
    for (const { road, roads } of authored)
      for (const r of roads) {
        const edge = road.edgeIndex(r.id);
        for (const [i, sec] of r.laneSections.entries()) {
          if (sec.median?.kind !== 'grass') continue;
          const end = r.laneSections[i + 1]?.s0 ?? r.lengthM;
          for (let s = sec.s0 + 0.25; s < end; s += 17) {
            const [a, b] = gap(road, edge, s);
            for (const d of [a + 0.05, (a + b) / 2, b - 0.05])
              expect(road.groundAt(edge, s, d), `${r.id} ${s} ${d}`).toBe('grass');
            for (const l of road.lanesAt(edge, s).filter((l) => l.kind === 'drive'))
              expect(road.groundAt(edge, s, l.dCenterM)).toBe(r.surface ?? 'asphalt');
            probes++;
            if (road.edges[edge]!.isConnector) connectorProbes++;
          }
        }
      }
    expect(probes).toBeGreaterThan(0);
    expect(connectorProbes).toBeGreaterThan(0);
    process.stdout.write(
      `[examined] grass median queries: ${probes} stations, ${connectorProbes} connector stations\n`,
    );
  });

  it.each(['paint', 'barrier', undefined] as const)(
    'preserves the existing paved gap for %s median',
    (kind) => {
      const { road } = fixture(kind);
      for (const edge of road.edges)
        for (const d of [-1.9, 0, 1.9, 4])
          expect(road.groundAt(edge.index, edge.length / 2, d)).toBe('asphalt');
    },
  );

  it('draws green turf without asphalt or centre dashes, supported through bends and real branch mouths', () => {
    let probes = 0;
    for (const { road, roads } of authored) {
      const scene = buildRoadScene(road, createFlatLook(), Object.fromEntries(roads.map((r) => [r.id, r])));
      scene.group.updateMatrixWorld(true);
      const meshes: Mesh[] = [];
      scene.group.traverse((o) => {
        if (o instanceof Mesh && /^road-(road|brick|marking|median)/.test(o.name)) meshes.push(o as Mesh);
      });
      const ray = new Raycaster();
      try {
        for (const r of roads)
          for (const [i, sec] of r.laneSections.entries()) {
            if (sec.median?.kind !== 'grass') continue;
            const edge = road.edgeIndex(r.id);
            const end = r.laneSections[i + 1]?.s0 ?? r.lengthM;
            // Close to both ends catches main-through connectors and the branch mouth's joins.
            const stations = [sec.s0 + 0.05, end - 0.05];
            for (let s = sec.s0 + 2.5; s < end - 0.05; s += 29) stations.push(s);
            for (const s of stations) {
              const [a, b] = gap(road, edge, s);
              for (const d of [a + 0.035, (a + b) / 2, b - 0.035]) {
                const p = road.toWorld(edge, s, d, 0);
                ray.set(new Vector3(p.x, p.y + 1, p.z), new Vector3(0, -1, 0));
                ray.far = 1.2;
                const hits = ray.intersectObjects(meshes, false);
                expect(hits.length, `${r.id} ${s} ${d}: supported turf`).toBeGreaterThan(0);
                expect(hits[0]!.object.name, `${r.id} ${s} ${d}: visible turf`).toMatch(/^road-median/);
                expect(
                  hits.some((h) => /^road-(road|brick|marking)/.test(h.object.name)),
                  'no paved overlays or overlap',
                ).toBe(false);
                const color = ((hits[0]!.object as Mesh).material as MeshLambertMaterial).color;
                expect(color.g, 'turf is visibly green').toBeGreaterThan(color.r);
                expect(color.g).toBeGreaterThan(color.b);
                expect(Math.abs(hits[0]!.point.y - p.y)).toBeLessThan(0.025);
                probes++;
              }
              for (const d of [a - 0.035, b + 0.035]) {
                const p = road.toWorld(edge, s, d, 0);
                ray.set(new Vector3(p.x, p.y + 1, p.z), new Vector3(0, -1, 0));
                expect(
                  ray.intersectObjects(meshes, false)[0]?.object.name,
                  'adjacent authored lane stays paved',
                ).toMatch(/^road-road/);
              }
              for (const d of [a - 0.175, b + 0.175]) {
                const p = road.toWorld(edge, s, d, 0);
                ray.set(new Vector3(p.x, p.y + 1, p.z), new Vector3(0, -1, 0));
                expect(
                  ray.intersectObjects(meshes, false)[0]?.object.name,
                  `${r.id} ${s}: inner edge line stays on its carriageway`,
                ).toMatch(/^road-markingCenter/);
              }
            }
          }
      } finally {
        scene.dispose();
      }
    }
    expect(probes).toBeGreaterThan(0);
    process.stdout.write(
      `[examined] ${probes} visible median raycasts; bends, connectors and both inner lane edges\n`,
    );
  });

  it('keeps turf and paved support across linked end rows, including a graded bend', () => {
    const configs = [...authored.map((a) => a.road), fixture('grass').road];
    let probes = 0;
    for (const road of configs) {
      const scene = buildRoadScene(road, createFlatLook());
      scene.group.updateMatrixWorld(true);
      const ray = new Raycaster();
      try {
        for (const e of road.edges) {
          if (road.crossSectionAt(e.index, e.length).median?.kind !== 'grass') continue;
          for (const link of e.nextLinks) {
            const other = road.edges[link.edge]!;
            const os = link.entersAt === 'from' ? 0 : other.length;
            if (road.crossSectionAt(other.index, os).median?.kind !== 'grass') continue;
            const [a, b] = gap(road, e.index, e.length);
            for (const d of [a + 0.05, (a + b) / 2, b - 0.05, a - 0.05, b + 0.05]) {
              const p = road.toWorld(e.index, e.length - 0.1, d, 0);
              const od = (link.entersAt === 'from' ? d : -d) + (link.dShift ?? 0);
              const q = road.toWorld(other.index, os + (link.entersAt === 'from' ? 0.1 : -0.1), od, 0);
              for (const u of [0.25, 0.5, 0.75]) {
                const at = new Vector3(p.x, p.y, p.z).lerp(new Vector3(q.x, q.y, q.z), u);
                ray.set(at.clone().add(new Vector3(0, 1, 0)), new Vector3(0, -1, 0));
                ray.far = 1.15;
                const hits = ray.intersectObject(scene.group, true);
                const h = hits[0];
                expect(h, `${e.id} to ${other.id} ${d} ${u}: no seam hole`).toBeDefined();
                expect(h!.object.name, `${e.id} to ${other.id} ${d} ${u}: visible joined surface`).toMatch(
                  d > a && d < b ? /^road-median/ : /^road-road/,
                );
                if (d > a && d < b)
                  expect(hits.some((hit) => /^road-(road|brick|marking)/.test(hit.object.name))).toBe(false);
                probes++;
              }
            }
          }
        }
      } finally {
        scene.dispose();
      }
    }
    expect(probes).toBeGreaterThan(0);
    process.stdout.write(`[examined] ${probes} rays across linked road/connector end rows\n`);
  });

  it.each(['paint', 'barrier', undefined] as const)(
    'keeps %s median rendering paved with its centre divider',
    (kind) => {
      const config = fixture(kind);
      const scene = buildRoadScene(config.road, createFlatLook());
      scene.group.updateMatrixWorld(true);
      const p = config.road.toWorld(0, 3, 0, 0);
      const ray = new Raycaster(new Vector3(p.x, p.y + 1, p.z), new Vector3(0, -1, 0), 0, 2);
      try {
        const hits = ray.intersectObject(scene.group, true);
        expect(hits[0]?.object.name).toMatch(/^road-markingCenter/);
        expect(hits.some((h) => /^road-road/.test(h.object.name))).toBe(true);
        expect(hits.some((h) => /^road-median/.test(h.object.name))).toBe(false);
      } finally {
        scene.dispose();
      }
    },
  );

  it('rides supported grass across both carriageways, with reduced grip and speed and deterministic inputs', () => {
    const config = fixture('grass');
    const run = (d: number) => {
      const h = riderHarness(config, { s: 40, d, speed: 20 });
      const events = [];
      for (let tick = 0; tick < 240; tick++) events.push(...h.step(input(1)));
      return { pos: { ...h.rider.pos }, speed: h.rider.speed, mode: h.rider.mode, events };
    };
    const median = run(0);
    const lane = run(4);
    expect(median.speed).toBeLessThan(lane.speed);
    expect(median.pos.s).toBeGreaterThan(40);
    expect(median.mode).toBe('Road');
    expect(run(0)).toEqual(median);
    const turn = (d: number) => {
      const h = riderHarness(config, { s: 40, d, speed: 20 });
      for (let tick = 0; tick < 12; tick++) h.step(input(0.6, 0, 0.6));
      return { yaw: h.rider.yaw, across: h.rider.pos.d - d };
    };
    const grassTurn = turn(0);
    const pavedTurn = turn(4);
    // Observe the riding model's response to the same steering command, not tuning metadata.
    expect(grassTurn.yaw).toBeGreaterThan(0);
    expect(grassTurn.yaw).toBeLessThan(pavedTurn.yaw);
    expect(grassTurn.across).toBeLessThan(pavedTurn.across);
    const h = riderHarness(config, { s: 40, d: 4, speed: 15 });
    const crossed = new Set<string>();
    for (let tick = 0; tick < 240 && h.rider.pos.d > -3; tick++) {
      h.step(input(0.7, 0, -1));
      crossed.add(config.road.groundAt(h.rider.pos.edge, h.rider.pos.s, h.rider.pos.d)!);
      expect(h.rider.mode).toBe('Road');
    }
    expect(h.rider.pos.d).toBeLessThan(-3);
    expect(crossed).toContain('grass');
    expect(crossed).toContain('asphalt');
  });

  it('records a grass crossing and replays the encoded file without a desync', () => {
    const config = fixture('grass');
    const sim = createSim(config);
    const recorder = createInputRecorder();
    recorder.beginRace(sim, 'median-surface-test');
    const surfaces = new Set<string>();
    const events: SimEvent[] = [];
    // Drive by sim ticks and the rider's observable position, then replay only recorded inputs.
    for (let tick = 0; tick < 600; tick++) {
      const me = sim.snapshot().entities.find((e) => e.kind === 'rider')!;
      const cmd = input(0.6, 0, me.road.d > -3 ? -1 : me.road.d < -4 ? 1 : 0);
      recorder.record(tick, [cmd]);
      sim.step([cmd]);
      events.push(...sim.events());
      const after = sim.snapshot().entities.find((e) => e.kind === 'rider')!;
      if (after.ground) surfaces.add(after.ground);
      if (tick % HASH_EVERY_TICKS === 0) recorder.checkpoint(tick, sim.hash());
    }
    recorder.finish(sim.tick - 1, sim.hash());
    expect(surfaces).toContain('grass');
    expect(surfaces).toContain('asphalt');
    const back = decodeReplay(JSON.parse(JSON.stringify(recorder.file())));
    const replay = createReplayController(back);
    const again = createSim(config);
    const replayed: SimEvent[] = [];
    while (replay.step(again) === 'stepped') replayed.push(...again.events());
    expect(replay.desync).toBeNull();
    expect(again.tick).toBe(sim.tick);
    expect(again.hash()).toBe(sim.hash());
    expect(replayed).toEqual(events);
    process.stdout.write(
      `[examined] ${sim.tick} encoded replay ticks crossing grass; final hash ${sim.hash()}\n`,
    );
  });
});
