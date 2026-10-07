/// <reference types="vite/client" />
import { expect, it } from 'vitest';
import { InstancedMesh, Mesh, Raycaster, Vector3 } from 'three';
import { courseAt, lanesNear, type BakedNetwork, type BakedRoute } from '../../src/road';
import { buildRoadScene, drawnBarrierSpans, networkTags } from '../../src/render/road-mesh';
import { VergeLayer } from '../../src/render/verge';
import { edgeHoldAt } from '../../src/sim/riders';
import { riderHarness, input } from '../../src/sim/riders/testing';
import { gapSimConfig } from '../../src/sim/tumble/gap-fixture';
import { createWorld } from '../../src/sim/world';
import { DownIndex, look, print, routeNetworks, track } from './geometry-routes';

const networks = import.meta.glob<BakedNetwork>('/packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const routes = import.meta.glob<BakedRoute>('/packs/*/regions/*/routes/*.json', {
  eager: true,
  import: 'default',
});
const packOf = (path: string) => /\/packs\/([^/]+)\//.exec(path)?.[1] ?? '';

it('listed contact meets actual panels, protects truck cuts and hands grounded riders through rendered road openings', () => {
  const cases: { kind: string; firstHand: boolean; drawn: boolean }[] = [];
  const failures: string[] = [];
  for (const net of routeNetworks()) {
    const t = track(net);
    const network = Object.entries(networks).find(([p, n]) => n.id === net.id && packOf(p) === net.pack)?.[1];
    const route = Object.entries(routes).find(
      ([p, r]) => r.network === net.id && packOf(p) === net.pack,
    )?.[1];
    if (!network || !route) throw new Error(`missing ${net.id}`);
    const config = gapSimConfig({ network, roads: t.roads }, { route });
    const road = config.road;
    const world = createWorld(config);
    const samples: {
      edge: number;
      s: number;
      side: 1 | -1;
      limit: number;
      height: number;
      kind: string;
      barrierLook: boolean;
      control?: boolean;
    }[] = [];
    let control: (typeof samples)[number] | null = null;
    for (const e of road.edges)
      for (let s = 0; s <= e.length; s += 3)
        for (const side of [1, -1] as const) {
          const vside = side > 0 ? 'right' : 'left';
          const hold = edgeHoldAt(world, config, e.index, s, side);
          const barrier = road.barrierAt(e.index, s, vside);
          if (!barrier) continue;
          const span = drawnBarrierSpans(road, t.dressing, e.index, vside).find(
            (b) => s >= b.s0 && s <= b.s1,
          );
          if (!span) continue;
          const p = road.toWorld(e.index, s, (side > 0 ? e.dMax : e.dMin) + side * 0.05, 0);
          if (barrier.kind !== 'wall' && !lanesNear(road, p.x, p.z, e.index, 0.3)) {
            if (s > span.s0 + 0.5 && s < span.s1 - 0.5)
              control ??= {
                edge: e.index,
                s,
                side,
                limit: hold.limit,
                height: barrier.heightM,
                kind: barrier.kind,
                barrierLook: span.look,
                control: true,
              };
            continue;
          }
          samples.push({
            edge: e.index,
            s,
            side,
            limit: hold.limit,
            height: barrier.heightM,
            kind: barrier.kind,
            barrierLook: span.look,
          });
        }
    if (!samples.length) continue;
    if (control) samples.unshift(control);
    const scene = buildRoadScene(road, look, t.dressing, { seed: 1 });
    const verge = new VergeLayer(road, look, { tags: networkTags(road, t.dressing).tags });
    const staticMeshes: Mesh[] = [];
    const shortcutMeshes: Mesh[] = [];
    scene.group.traverse((m) => {
      if (m instanceof Mesh && /^road-(rail|deck)$/.test(m.name)) staticMeshes.push(m as Mesh);
    });
    scene.group.traverse((m) => {
      if (m instanceof Mesh && m.name === 'road-shortcut') shortcutMeshes.push(m as Mesh);
    });
    scene.group.updateMatrixWorld(true);
    for (const sample of samples) {
      const { edge, s, side, limit, height } = sample;
      const vside = side > 0 ? 'right' : 'left';
      // Listed panels stand at the edge's widest lane line, including at a join where
      // the live verge band widens beyond that line.
      const line = (side > 0 ? road.edges[edge]!.dMax : road.edges[edge]!.dMin) + side * 0.05;
      const p = road.toWorld(edge, s, line, 0);
      const f = road.frameAt(edge, s);
      const normal = new Vector3(-f.tz * side, 0, f.tx * side).normalize();
      verge.update(p.x, p.z, null, 0);
      const meshes = [...staticMeshes];
      verge.group.updateMatrixWorld(true);
      verge.group.traverse((m) => {
        if (
          m instanceof InstancedMesh &&
          /^verge-(railing|concrete|guardrail)$/.test(m.name) &&
          m.count > 0
        ) {
          m.computeBoundingSphere();
          meshes.push(m);
        }
      });
      const drawnHeights: number[] = [];
      const hitNames = new Set<string>();
      for (const h of [0.2, 0.5, 0.8, 0.95]) {
        const start = new Vector3(p.x, p.y + height * h, p.z).addScaledVector(normal, -0.35);
        const ray = new Raycaster(start, normal, 0, 0.7);
        let hits = ray.intersectObjects(meshes, false);
        // A panel endpoint stored as float32 can sit a few millimetres along from the
        // double-precision query. A five-centimetre longitudinal footprint straddles it.
        if (!hits.length)
          for (const u of [-0.05, 0.05]) {
            const q = road.toWorld(edge, Math.max(0, Math.min(road.edges[edge]!.length, s + u)), line, 0);
            hits = new Raycaster(
              new Vector3(q.x, q.y + height * h, q.z).addScaledVector(normal, -0.35),
              normal,
              0,
              0.7,
            ).intersectObjects(meshes, false);
            if (hits.length) break;
          }
        if (hits.length) {
          drawnHeights.push(h);
          for (const hit of hits) hitNames.add(hit.object.name);
        }
      }
      if (sample.control) {
        print(
          `[listed-barriers] visible control ${net.id}/${road.edges[edge]?.id} s${s} ${vside}: ${[...hitNames].join(', ')}`,
        );
        expect(drawnHeights.length, `visible control ${net.id}`).toBeGreaterThan(0);
        continue;
      }
      const trajectories = [];
      for (const yaw of [0.2, 0.6, 1]) {
        const h = riderHarness(config, { edge, s, d: limit - side * 0.01, speed: 18, yaw: side * yaw });
        let handed = false;
        let firstAirborne = false;
        let firstHeld = false;
        let firstEdge = edge;
        const events: string[] = [];
        const firstEvents: string[] = [];
        for (let tick = 0; tick < 60; tick++) {
          const ev = h.step(input(1, 0, 0));
          events.push(...ev.map((e) => `${e.type}:${String(e.data['cause'] ?? '')}`));
          if (tick === 0) {
            firstEvents.push(...events);
            firstEdge = h.rider.pos.edge;
            firstAirborne = h.rider.mode === 'Airborne';
            firstHeld = firstEdge === edge && (h.rider.pos.d - limit) * side <= 1e-5;
          }
          if (h.rider.pos.edge !== edge) {
            handed = true;
            break;
          }
        }
        trajectories.push({
          yaw,
          firstEdge: road.edges[firstEdge]?.id,
          firstAirborne,
          firstHeld,
          handed,
          endEdge: road.edges[h.rider.pos.edge]?.id,
          endS: h.rider.pos.s,
          endD: h.rider.pos.d,
          mode: h.rider.mode,
          events,
          firstEvents,
        });
      }
      const firstHand = trajectories.every((x) => x.firstEdge !== road.edges[edge]?.id);
      const why = `${net.id}/${road.edges[edge]?.id} s${s} ${vside}`;
      const hold = edgeHoldAt(world, config, edge, s, side);
      if (!drawnHeights.length && hold.hold === 'held') failures.push(`${why}: held without a panel`);
      if (drawnHeights.length && hold.hold === 'open') failures.push(`${why}: drawn panel has open contact`);
      // At a junction a neighbouring road may replace the wall. Such a point is
      // open contact, and its crossing trajectory must not receive a barrier event.
      if (!drawnHeights.length)
        for (const trajectory of trajectories) {
          if (trajectory.firstEvents.some((e) => e === 'crash:barrier' || e === 'wobble:barrier'))
            failures.push(`${why}: undrawn panel caused a barrier event at yaw ${trajectory.yaw}`);
          if (hold.hold === 'open' && trajectory.firstHeld)
            failures.push(`${why}: open crossing clamped at yaw ${trajectory.yaw}`);
        }
      const panel = road.toWorld(
        edge,
        s,
        (side > 0 ? road.edges[edge]!.dMax : road.edges[edge]!.dMin) + side * 0.05,
        0,
      );
      const down = new Raycaster(
        new Vector3(panel.x, panel.y + 5, panel.z),
        new Vector3(0, -1, 0),
        0,
        10,
      ).intersectObjects(shortcutMeshes, false);
      if (sample.kind === 'wall' && down.length) failures.push(`${why}: wall penetrates rendered shortcut`);
      cases.push({ kind: sample.kind, firstHand, drawn: drawnHeights.length > 0 });
    }
    scene.dispose();
    verge.dispose();
  }
  print(
    `[listed-barriers] ${cases.length} wall/opening samples; ${cases.filter((c) => c['kind'] === 'wall').length} listed wall samples; ${cases.filter((c) => c['firstHand']).length} immediate handovers; ${failures.length} geometry/contact mismatches`,
  );
  expect(cases.length).toBeGreaterThan(0);
  expect(cases.some((c) => c.firstHand)).toBe(true);
  expect(cases.some((c) => c.drawn)).toBe(true);
  expect(failures).toEqual([]);
}, 600_000);

it('the narrowed Mill Yard exit has continuous drawn and rideable ground across its lane and soft edge', () => {
  const net = routeNetworks().find((n) => n.id === 'pnw-c1');
  if (!net) throw new Error('missing pnw-c1');
  const t = track(net);
  const road = t.road;
  const edge = road.edgeIndex('c-pnw-mill-out');
  const e = road.edges[edge]!;
  const scene = buildRoadScene(road, look, t.dressing, { seed: 1 });
  const verge = new VergeLayer(road, look, { tags: networkTags(road, t.dressing).tags });
  const ground = new DownIndex(
    [scene.group, verge.group],
    /^(road-(road|shoulder|shortcut|land|splitZone)|verge-band)/,
  );
  const failures: string[] = [];
  let points = 0;
  for (let s = 0.05; s < e.length; s += 0.5) {
    const lane = road.lanesAt(edge, s)[0]!;
    expect(lane.widthM).toBe(3.5);
    const right = road.vergeAt(edge, s, 'right');
    expect(right.edge).toBe('soft');
    expect(right.widthM).toBe(2);
    const lo = lane.dCenterM - lane.widthM / 2;
    for (let d = lo + 0.05; d < right.dOuter; d += 0.1) {
      const p = road.toWorld(edge, s, d, 0);
      const drawn = ground.at(p.x, p.z, p.y + 0.15);
      const spot = courseAt(road, { items: [], cellM: 32, cells: new Map() }, { edge, s, d }, p.y);
      if (
        !drawn ||
        Math.abs(drawn.y - p.y) > 0.15 ||
        spot.kind !== 'road' ||
        Math.abs(spot.y - drawn.y) > 0.15
      )
        failures.push(`s${s.toFixed(2)} d${d.toFixed(2)}: drawn ${drawn?.y}, course ${spot.kind}`);
      points++;
    }
  }
  print(
    `[listed-barriers] exit ${e.length.toFixed(4)} m, lane 3.5 m, soft edge 2 m: ${points} ground points, ${failures.length} mismatches`,
  );
  scene.dispose();
  verge.dispose();
  expect(points).toBeGreaterThan(1000);
  expect(failures).toEqual([]);
});
