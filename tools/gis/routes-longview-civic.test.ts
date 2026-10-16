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
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const bundle = () => {
  const network = read<BakedNetwork>(`${ROOT}/networks/osm-pnw-longview-civic.json`);
  const roads = network.roads.map((id) => read<BakedRoad>(`${ROOT}/roads/${id}.json`));
  const route = read<BakedRoute>(`${ROOT}/routes/osm-longview-civic-triangle.json`);
  return { network, roads, route };
};

describe('Longview civic streets offer a complete two-way route choice', () => {
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
    expect(branch.kind).toBe('detour');
    expect(branch.gainM).toBeLessThan(0);
    const choice = branch.choice!;
    expect(choice.edge).toBe(progress.start.edge);
    expect(choice.s0).toBeGreaterThan(progress.start.s + 20);
    const grid = progress.startGrid!;
    expect(progress.start.s - (grid.rows - 1) * grid.rowGapM).toBeGreaterThan(0);
    expect(progress.distanceToFinish(choice.edge, choice.s1)).toBeGreaterThan(1000);
    for (const c of progress.checkpoints) expect(Number.isFinite(c.progress)).toBe(true);
    // Staying in the ordinary travel lane preserves the diagonal; the deliberate outside
    // choice window selects Hudson. A shortcut that swallows the whole lane is not a choice.
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
      process.stdout.write(`[examined] ${probes} rendered lane and recovery-margin points\n`);
    } finally {
      scene.dispose();
    }
  });
});
