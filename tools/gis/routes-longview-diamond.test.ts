import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  createRouteProgress,
  lintRoadNetwork,
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
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const bundle = () => {
  const network = read<BakedNetwork & Provenanced>(`${ROOT}/networks/osm-pnw-longview-diamond.json`);
  const roads = network.roads.map((id) => read<BakedRoad & Provenanced>(`${ROOT}/roads/${id}.json`));
  const route = read<BakedRoute>(`${ROOT}/routes/osm-longview-street-diamond.json`);
  return { network, roads, route };
};

describe('Longview diamond streets offer a complete two-way route choice', () => {
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
      expect(r.features?.some((f) => f.kind === 'boostPad')).toBe(false);
      const heights = r.samples.data['y']!;
      expect(heights.every(Number.isFinite)).toBe(true);
      expect(Math.max(...heights)).toBeGreaterThan(0);
    }
    expect(route.branches).toHaveLength(1);
    expect(route.branches?.[0]?.sign).toMatch(/LONGER OUTER ROUTE/);
    expect(new Set(roads.flatMap((r) => r.samples.data['y']!)).size).toBeGreaterThan(1);
  });

  it('places a true fork and rejoin between a usable start grid and separate finish', () => {
    const { network, roads, route } = bundle();
    expect(lintRoadNetwork({ network, roads, routes: [route] })).toEqual([]);
    const road = createRoadNetwork({ network, roads });
    const progress = createRouteProgress(road, route);
    expect(route.closed).toBe(false);
    expect(progress.length).toBeGreaterThan(1500);
    expect(route.branches?.some((b) => b.traffic === 'road')).toBe(true);
    expect(progress.distanceToFinish(progress.finish.edge, progress.finish.s)).toBeCloseTo(0);
    expect(progress.branches.length).toBeGreaterThan(0);
    const branch = progress.branches.find((b) => b.declared)!;
    expect(branch.choice).not.toBeNull();
    expect(branch.kind).toBe('alternate');
    expect(branch.gainM).toBeLessThan(0);
    const choice = branch.choice!;
    expect(choice.edge).toBe(progress.start.edge);
    expect(choice.s0).toBeGreaterThan(progress.start.s + 20);
    const grid = progress.startGrid!;
    expect(progress.start.s - (grid.rows - 1) * grid.rowGapM).toBeGreaterThan(0);
    expect(progress.distanceToFinish(choice.edge, choice.s1)).toBeGreaterThan(1000);
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
