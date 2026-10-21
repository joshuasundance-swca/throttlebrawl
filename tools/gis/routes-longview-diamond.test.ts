import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Mesh, Raycaster, Vector3, type Object3D } from 'three';
import {
  createRoadNetwork,
  createRouteProgress,
  lintRoadNetwork,
  groundUnderOf,
  landEdgeOf,
  skirtOf,
  type BakedNetwork,
  type BakedRoad,
  type BakedRoute,
} from '../../src/road';
import { GroundTris } from '../../src/render/land-probe.test-util';
import { createFlatLook } from '../../src/render/look';
import { buildRoadScene } from '../../src/render/road-mesh';
import { buildTrafficGraph } from '../../src/sim/traffic/network';

const ROOT = 'packs/region-pnw/regions/pacific-northwest';
interface Provenanced {
  provenance: {
    tool: { configRef: string };
    sources: { name: string; spdx: string; sha256: string }[];
  };
}
interface SourceRoad {
  id: string;
  features?: BakedRoad['features'];
  sideRuns?: { tag: string; side: string; s0: number; s1: number }[];
}
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const bundle = () => {
  const network = read<BakedNetwork & Provenanced>(`${ROOT}/networks/osm-pnw-longview-diamond.json`);
  const roads = network.roads.map((id) => read<BakedRoad & Provenanced>(`${ROOT}/roads/${id}.json`));
  const route = read<BakedRoute>(`${ROOT}/routes/osm-longview-street-diamond.json`);
  return { network, roads, route };
};

describe('Longview diamond streets offer a complete two-way route choice', () => {
  it('meets the drawn mixed-flat junction slopes with order-independent cached physical ground', () => {
    const data = bundle();
    const road = createRoadNetwork(data);
    const skirts = skirtOf(road);
    const reach = landEdgeOf(road);
    const points: { x: number; z: number; label: string }[] = [];
    for (const e of road.edges) {
      for (const [end, links] of [
        ['from', e.prevLinks],
        ['to', e.nextLinks],
      ] as const) {
        const s = end === 'from' ? 0 : e.length;
        for (const link of links) {
          const other = road.edges[link.edge]!;
          const os = link.entersAt === 'from' ? 0 : other.length;
          const flip = end === link.entersAt ? -1 : 1;
          for (const side of [-1, 1] as const) {
            const otherSide = (side * flip) as -1 | 1;
            const a = skirts(e.index, side, s);
            const b = skirts(other.index, otherSide, os);
            if (!a || !b || (a.flat === 0) === (b.flat === 0) || Math.abs(a.top - b.top) > 0.5) continue;
            const across = reach(e.index, side, s) + 0.8 * Math.min(a.run, b.run);
            const d = side * ((side < 0 ? -e.dMin : e.dMax) + 0.6 + across);
            const od = flip * d + (link.dShift ?? 0);
            const p = road.toWorld(e.index, end === 'from' ? 0.25 : e.length - 0.25, d, 0);
            const q = road.toWorld(other.index, link.entersAt === 'from' ? 0.25 : other.length - 0.25, od, 0);
            points.push({ x: (p.x + q.x) / 2, z: (p.z + q.z) / 2, label: `${e.id}/${other.id}/${side}` });
          }
        }
      }
    }
    expect(
      points.length,
      'authored linked endpoints include mixed zero/positive flat terrain',
    ).toBeGreaterThan(0);
    const under = groundUnderOf(road);
    const first = points.map((p) => {
      const hit = under(p.x, p.z, 100);
      expect(hit, `${p.label}: physical endpoint slope`).not.toBeNull();
      return hit;
    });
    const reverseRoad = createRoadNetwork(data);
    const reverse = groundUnderOf(reverseRoad);
    const calls = vi.spyOn(reverseRoad, 'toWorld');
    const backwards = [...points]
      .reverse()
      .map((p) => reverse(p.x, p.z, 100))
      .reverse();
    expect(backwards).toEqual(first);
    const coldCalls = calls.mock.calls.length;
    expect(coldCalls, 'cold query actually builds cached geometry').toBeGreaterThan(0);
    calls.mockClear();
    expect(points.map((p) => reverse(p.x, p.z, 100))).toEqual(first);
    expect(calls.mock.calls, 'warm queries do not rebuild or scan road geometry').toHaveLength(0);
    calls.mockRestore();
    const scene = buildRoadScene(
      road,
      createFlatLook(),
      Object.fromEntries(data.roads.map((r) => [r.id, r])),
      { seed: 1 },
    );
    try {
      const ground = new GroundTris(scene.group);
      scene.group.updateMatrixWorld(true);
      const meshes: Object3D[] = [];
      scene.group.traverse((o) => {
        if (
          o instanceof Mesh &&
          /^road-(land|road|shoulder|shortcut|median|deck)/.test(o.name) &&
          !(o as { isInstancedMesh?: boolean }).isInstancedMesh
        )
          meshes.push(o);
      });
      for (const [i, p] of points.entries()) {
        const direct = new Raycaster(new Vector3(p.x, 100, p.z), new Vector3(0, -1, 0)).intersectObjects(
          meshes,
          false,
        )[0];
        expect(direct, `${p.label}: independent actual mesh ray`).toBeDefined();
        expect(ground.heightAt(p.x, p.z)?.y).toBeCloseTo(direct!.point.y, 7);
        expect(first[i], `${p.label}: physical and rendered endpoint triangles`).toBeCloseTo(
          direct!.point.y,
          5,
        );
      }
      expect(under(1e6, 1e6, 100)).toBeNull();
      expect(ground.heightAt(1e6, 1e6)).toBeNull();
      process.stdout.write(
        `[examined] ${points.length} content-derived mixed-flat junction points, direct/indexed/physical parity, reversed cold cache ${coldCalls} world transforms, warm cache 0 world transforms\n`,
      );
    } finally {
      scene.dispose();
    }
  });

  it('keeps source provenance, independent road ids and real varying elevations', () => {
    const { network, roads, route } = bundle();
    expect(network.provenance?.tool?.configRef).toBe('tools/gis/networks/osm-pnw-longview-diamond.json');
    const sources = network.provenance?.sources ?? [];
    expect(sources.some((s) => s.name === 'OpenStreetMap' && s.spdx === 'ODbL-1.0')).toBe(true);
    expect(sources.some((s) => s.name === 'USGS 3DEP elevation')).toBe(true);
    for (const id of ['osm-pnw-longview', 'osm-pnw-longview-civic']) {
      const previous = read<BakedNetwork>(`${ROOT}/networks/${id}.json`);
      expect(
        network.roads.some((r) => previous.roads.includes(r)),
        id,
      ).toBe(false);
    }
    for (const r of roads) {
      expect(r.provenance).toEqual(network.provenance);
      const heights = r.samples.data['y']!;
      expect(heights.every(Number.isFinite)).toBe(true);
      expect(Math.max(...heights)).toBeGreaterThan(0);
    }
    expect(route.branches).toHaveLength(1);
    expect(route.branches?.[0]?.sign).toMatch(/LONGER OUTER ROUTE/);
    expect(new Set(roads.flatMap((r) => r.samples.data['y']!)).size).toBeGreaterThan(1);
  });

  it('bakes only canonical local sites and a signposted optional grass boost clear of the walkers', () => {
    const { roads } = bundle();
    const recipe = read<{ lines: { roads: SourceRoad[] }[] }>(
      'tools/gis/networks/osm-pnw-longview-diamond.json',
    );
    const source = new Map(recipe.lines.flatMap((l) => l.roads).map((r) => [r.id, r]));
    const road = createRoadNetwork(bundle());
    let sites = 0,
      pads = 0;
    for (const baked of roads) {
      const authored = source.get(baked.id);
      const features = baked.features ?? [];
      expect(
        features.filter((f) => f.kind === 'boostPad'),
        baked.id,
      ).toEqual(authored?.features?.filter((f) => f.kind === 'boostPad') ?? []);
      for (const site of features.filter((f) => f.params?.['place'])) {
        expect(authored?.features).toContainEqual(site);
        expect(
          authored?.sideRuns?.some(
            (r) => r.tag === 'longview-street-life' && r.s0 <= site.s0 && r.s1 >= site.s1,
          ),
        ).toBe(true);
        sites++;
      }
      for (const pad of features.filter((f) => f.kind === 'boostPad')) {
        const edge = road.edgeIndex(baked.id);
        for (const s of [pad.s0, pad.s1]) {
          const verge = road.vergeAt(edge, s, 'right');
          expect(verge.surface).toBe('grass');
          expect(pad.d0).toBeGreaterThan(verge.dInner);
          expect(pad.d1).toBeLessThan(verge.dOuter);
        }
        expect(
          features.some((f) => f.kind === 'billboard' && f.s1 < pad.s0 && f.item === 'longview-market-boost'),
        ).toBe(true);
        for (const walkers of features.filter((f) => f.params?.['spawns'] === 'pedestrians'))
          expect(walkers.d0 > pad.d1 || walkers.d1 < pad.d0).toBe(true);
        expect(features.some((f) => f.kind === 'ramp' || f.kind === 'rampTruck')).toBe(false);
        pads++;
      }
    }
    expect(sites).toBeGreaterThan(0);
    expect(pads).toBeGreaterThan(0);
  });

  it('places a true fork and rejoin between a usable start grid and separate finish', () => {
    const { network, roads, route } = bundle();
    expect(lintRoadNetwork({ network, roads, routes: [route] })).toEqual([]);
    const road = createRoadNetwork({ network, roads });
    const progress = createRouteProgress(road, route);
    expect(route.closed).toBe(false);
    expect(progress.length).toBeGreaterThan(0);
    expect(route.branches?.some((b) => b.traffic === 'road')).toBe(true);
    expect(progress.distanceToFinish(progress.finish.edge, progress.finish.s)).toBeCloseTo(0);
    expect(progress.branches.length).toBeGreaterThan(0);
    const branch = progress.branches.find((b) => b.declared)!;
    expect(branch.choice).not.toBeNull();
    expect(branch.kind).toBe('alternate');
    expect(branch.gainM).toBeLessThan(0);
    const choice = branch.choice!;
    expect(choice.edge).toBe(progress.start.edge);
    expect(choice.s0).toBeGreaterThan(progress.start.s);
    const grid = progress.startGrid!;
    expect(progress.start.s - (grid.rows - 1) * grid.rowGapM).toBeGreaterThan(0);
    const forkProgress = progress.progressAt(choice.edge, choice.s1);
    const rejoins = branch.edges
      .flatMap((edge) => road.nextEdges(edge, progress.orientation(edge) === 1 ? 'to' : 'from'))
      .filter((link) => progress.mainEdges.includes(link.edge))
      .map((link) =>
        progress.progressAt(link.edge, link.entersAt === 'from' ? 0 : road.edges[link.edge]!.length),
      )
      .filter((p) => p > forkProgress);
    expect(rejoins.length, 'the outer path returns to the main route beyond its fork').toBeGreaterThan(0);
    const rejoinProgress = Math.min(...rejoins);
    expect(forkProgress).toBeGreaterThan(0);
    expect(rejoinProgress).toBeGreaterThan(forkProgress);
    expect(rejoinProgress).toBeLessThan(progress.length);
    for (const c of progress.checkpoints) expect(Number.isFinite(c.progress)).toBe(true);
    // Staying in the ordinary travel lane preserves the inner route; the deliberate outside
    // choice window selects Olympia/Kessler. A shortcut that swallows the whole lane is not a choice.
    const lane = road.lanesAt(choice.edge, choice.s0).find((l) => l.kind === 'drive' && l.direction === 1)!;
    expect(lane.dCenterM < choice.d0 || lane.dCenterM > choice.d1).toBe(true);
  });

  it('keeps ordinary cars reachable with finite exits in both directions on the actual branch streets', () => {
    const { network, roads, route } = bundle();
    const road = createRoadNetwork({ network, roads });
    const progress = createRouteProgress(road, route);
    const graph = buildTrafficGraph({ road, route: progress });
    expect(graph.enabled).toBe(true);
    let directions = 0;
    for (const authored of route.branches ?? []) {
      expect(authored.traffic).toBe('road');
      for (const id of authored.roads) {
        const edge = road.edges[road.edgeIndex(id)]!;
        const lanes = road.lanesAt(edge.index, edge.length / 2).filter((l) => l.kind === 'drive');
        for (const lane of lanes) {
          const dir = lane.direction === 1 ? 'plus' : 'minus';
          expect(graph.allowed, id).toContain(edge.index);
          expect(graph.viable[edge.index]?.[dir], `${id}: ${dir} finite exit`).toBe(true);
          expect(graph.rows[edge.index]?.[dir].length, `${id}: ${dir} legal continuation`).toBeGreaterThan(0);
          directions++;
        }
        if (!edge.isConnector) expect(new Set(lanes.map((l) => l.direction))).toEqual(new Set([-1, 1]));
      }
    }
    expect(directions).toBeGreaterThan(0);
    process.stdout.write(
      `[examined] ${directions} directed branch drive lanes, reachability and finite exits\n`,
    );
  });

  it('draws continuous road beneath junction lanes and soft ground beside the city streets', () => {
    const data = bundle();
    const road = createRoadNetwork(data);
    const scene = buildRoadScene(
      road,
      createFlatLook(),
      Object.fromEntries(data.roads.map((r) => [r.id, r])),
      { seed: 1 },
    );
    try {
      const ground = new GroundTris(scene.group);
      expect(ground.count).toBeGreaterThan(0);
      expect(ground.heightAt(1e6, 1e6)).toBeNull();
      let probes = 0;
      for (const e of road.edges) {
        if (!e.isConnector) continue;
        for (let s = 0.25; s < e.length; s += 2) {
          for (const l of road.lanesAt(e.index, s)) {
            for (const d of [l.dCenterM - l.widthM / 2 + 0.2, l.dCenterM, l.dCenterM + l.widthM / 2 - 0.2]) {
              const p = road.toWorld(e.index, s, d, 0);
              const hit = ground.heightAt(p.x, p.z, p.y + 0.5);
              expect(hit, `${e.id} s=${s} d=${d}`).not.toBeNull();
              expect(Math.abs((hit?.y ?? Infinity) - p.y), `${e.id} road footprint`).toBeLessThan(0.3);
              probes++;
            }
          }
        }
      }
      const streets = data.roads.filter((r) => !road.edges[road.edgeIndex(r.id)]!.isConnector);
      for (const r of streets) {
        const edge = road.edgeIndex(r.id);
        const s = r.lengthM / 2;
        const bridge = r.tags?.some((t) => t.tag === 'bridge' && t.s0 <= s && t.s1 >= s);
        for (const side of ['left', 'right'] as const) {
          const verge = road.vergeAt(edge, s, side);
          if (bridge) {
            expect(verge.edge).toBe('hard');
            expect(r.barriers?.some((b) => b.kind === 'wall' && b.look === 'guardrail')).toBe(true);
          } else {
            expect(verge.edge).toBe('soft');
            expect(verge.surface).toBe('grass');
            const p = road.toWorld(edge, s, (verge.dInner + verge.dOuter) / 2, 0);
            const hit = ground.heightAt(p.x, p.z, p.y + 0.5);
            expect(hit, `${r.id} ${side} drawn recovery margin`).not.toBeNull();
            expect(Math.abs((hit?.y ?? Infinity) - p.y)).toBeLessThan(0.3);
            probes++;
          }
        }
      }
      let pedestrianPoints = 0;
      for (const r of data.roads) {
        const edge = road.edgeIndex(r.id);
        for (const zone of r.features?.filter((f) => f.kind === 'roadsideZone') ?? []) {
          for (let s = zone.s0; s <= zone.s1; s += 2) {
            for (const d of [zone.d0, (zone.d0 + zone.d1) / 2, zone.d1]) {
              const p = road.toWorld(edge, s, d, 0);
              const hit = ground.heightAt(p.x, p.z, p.y + 0.5);
              expect(hit, `${r.id} ${zone.id} drawn walking area`).not.toBeNull();
              expect(Math.abs((hit?.y ?? Infinity) - p.y)).toBeLessThan(0.3);
              expect(
                road
                  .lanesAt(edge, s)
                  .every((l) => l.kind !== 'drive' || Math.abs(d - l.dCenterM) > l.widthM / 2),
                `${r.id} ${zone.id} walkers start outside traffic lanes`,
              ).toBe(true);
              pedestrianPoints++;
            }
          }
        }
      }
      expect(pedestrianPoints, 'the city course authors a grounded roadside walking area').toBeGreaterThan(0);
      process.stdout.write(
        `[examined] ${probes} rendered lane and recovery-margin points; ${pedestrianPoints} walking-area points\n`,
      );
      process.stdout.write(
        `[examined] complete road geometry, no camera culling: ${JSON.stringify(scene.stats)}\n`,
      );
    } finally {
      scene.dispose();
    }
  });
});
