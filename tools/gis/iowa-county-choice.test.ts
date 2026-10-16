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
import { buildRoadScene, type RoadDressing } from '../../src/render/road-mesh';

const root = 'packs/region-clinton/regions/clinton-iowa';
const read = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;

describe('Rural Rush county-road choice', () => {
  it('offers a named longer detour with two-way ordinary traffic and the same finish', () => {
    const network = read<BakedNetwork>(`${root}/networks/osm-clinton-ia136.json`);
    const route = read<BakedRoute>(`${root}/routes/osm-clinton-ia136-run.json`);
    const roads = network.roads.map((id) => read<BakedRoad>(`${root}/roads/${id}.json`));
    const road = createRoadNetwork({ network, roads });
    const progress = createRouteProgress(road, route);
    const detour = route.branches?.find((b) => b.kind === 'detour');
    expect(detour).toBeDefined();
    if (!detour) throw new Error('Missing county-road detour');
    expect(detour.marked).toBe(true);
    expect(detour.sign?.toLowerCase()).toContain('longer');
    expect(detour.traffic).toBe('road');
    expect(lintRoadNetwork({ network, roads, routes: [route] })).toEqual([]);
    expect(progress.branches.some((b) => b.id === detour.id)).toBe(true);
    expect(progress.branches.find((b) => b.id === detour.id)!.gainM).toBeLessThan(0);
    for (const id of detour.roads) {
      const edge = road.edgeIndex(id);
      if (road.edges[edge]!.isConnector) continue;
      const lanes = road.lanesAt(edge, road.edges[edge]!.length / 2).filter((l) => l.kind === 'drive');
      expect(
        lanes.some((l) => l.direction === 1),
        id,
      ).toBe(true);
      expect(
        lanes.some((l) => l.direction === -1),
        id,
      ).toBe(true);
    }
  });

  it('supports moped body corners through both directions of every authored junction', () => {
    const network = read<BakedNetwork>(`${root}/networks/osm-clinton-ia136.json`);
    const roads = network.roads.map((id) => read<BakedRoad>(`${root}/roads/${id}.json`));
    const road = createRoadNetwork({ network, roads });
    const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
    const built = buildRoadScene(road, createFlatLook(), dressing, { seed: 1 });
    const ground = new GroundTris(built.group);
    let rays = 0;
    let terminalVoidRays = 0;
    const missing: string[] = [];
    try {
      for (const edge of road.edges) {
        const samples = edge.isConnector
          ? Array.from({ length: Math.ceil(edge.length / 4) }, (_, i) =>
              Math.min(edge.length - 0.1, i * 4 + 0.1),
            )
          : [0.1, edge.length - 0.1];
        for (const s of samples)
          for (const lane of road
            .lanesAt(edge.index, s)
            .filter((l) => l.kind === 'drive' || l.kind === 'shortcut')) {
            const f = road.frameAt(edge.index, s);
            const center = road.toWorld(edge.index, s, lane.dCenterM, 0);
            for (const along of [-0.8, 0.8])
              for (const across of [-0.45, 0.45]) {
                const p = {
                  x: center.x + f.tx * along - f.tz * across,
                  z: center.z + f.tz * along + f.tx * across,
                  y: center.y + f.grade * along,
                };
                if (!ground.allAt(p.x, p.z, p.y + 0.4).some((hit) => Math.abs(hit.y - p.y) < 0.35)) {
                  const junction = network.junctions.find(
                    (j) => j.id === (s < 1 ? edge.fromJunction : edge.toJunction),
                  );
                  // A single-ended source boundary is deliberately open, not an internal junction.
                  if (junction?.ends.length === 1 && (s < 1 || s > edge.length - 1)) terminalVoidRays++;
                  else missing.push(`${edge.id} s=${s} lane=${lane.id}`);
                }
                rays++;
              }
          }
      }
      process.stdout.write(
        `[county junction mesh] ${rays} body-corner rays; ${missing.length} missing internally; ${terminalVoidRays} negative controls beyond terminal source boundaries\n`,
      );
      expect(missing).toEqual([]);
      expect(terminalVoidRays).toBeGreaterThan(0);
    } finally {
      built.dispose();
    }
  }, 90_000);

  it('keeps original highway feature identities near their pre-conversion source anchors', () => {
    const baseline = read<{ anchors: { id: string; kind: string; x: number; z: number }[] }>(
      'tools/gis/fixtures/iowa-original-feature-anchors.json',
    );
    const network = read<BakedNetwork>(`${root}/networks/osm-clinton-ia136.json`);
    const roads = network.roads.map((id) => read<BakedRoad>(`${root}/roads/${id}.json`));
    const road = createRoadNetwork({ network, roads });
    const distances = [];
    for (const anchor of baseline.anchors) {
      const matches = roads.flatMap((r) =>
        r.features.filter((f) => f.id === anchor.id).map((feature) => ({ road: r, feature })),
      );
      expect(matches, anchor.id).toHaveLength(1);
      const found = matches[0]!;
      expect(found.feature.kind).toBe(anchor.kind);
      const edge = road.edgeIndex(found.road.id);
      const s = (found.feature.s0 + found.feature.s1) / 2;
      const p = road.toWorld(edge, s, 0, 0);
      const distance = Math.hypot(p.x - anchor.x, p.z - anchor.z);
      expect(distance, anchor.id).toBeLessThan(5);
      distances.push({ id: anchor.id, distanceM: distance });
      if (found.feature.kind === 'copSpawn') {
        expect(
          road
            .lanesAt(edge, s)
            .some(
              (l) =>
                l.kind === 'shoulder' &&
                found.feature.d0 >= l.dCenterM - l.widthM / 2 &&
                found.feature.d1 <= l.dCenterM + l.widthM / 2,
            ),
        ).toBe(true);
      }
    }
    process.stdout.write(`[county preserved anchors] ${JSON.stringify(distances)}\n`);
  });
});
