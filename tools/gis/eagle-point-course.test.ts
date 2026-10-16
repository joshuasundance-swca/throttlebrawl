/// <reference types="vite/client" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createHeadlessRace, routeChoices } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { hitboxOf } from '../../src/core';
import {
  createRoadNetwork,
  courseAt,
  lintRoadNetwork,
  type BakedNetwork,
  type BakedRoad,
  type BakedRoute,
} from '../../src/road';
import { GroundTris } from '../../src/render/land-probe.test-util';
import { createFlatLook } from '../../src/render/look';
import { buildRoadScene, type RoadDressing } from '../../src/render/road-mesh';

const ROOT = 'packs/region-clinton/regions/clinton-iowa';
const read = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;
function course() {
  const network = read<BakedNetwork>(`${ROOT}/networks/osm-clinton-eagle-point.json`);
  const roads = network.roads.map((id) => read<BakedRoad>(`${ROOT}/roads/${id}.json`));
  const route = read<BakedRoute>(`${ROOT}/routes/osm-clinton-eagle-point-run.json`);
  return { network, roads, route };
}

describe('Eagle Point: one pass through the South and Central loops', () => {
  it('is offered in the Clinton route picker, while a network in another region is excluded', () => {
    const registry = registryFromGlob(
      import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }),
    );
    const event = 'region-clinton:clinton-ia136-race';
    const network = 'region-clinton:osm-clinton-eagle-point';
    const route = 'region-clinton:osm-clinton-eagle-point-run';
    expect(routeChoices(registry, event).some((choice) => choice.id === route)).toBe(true);
    expect(registry.regions['region-clinton:clinton-iowa']!.networks).toContain('osm-clinton-eagle-point');
    const otherRegion = {
      ...registry,
      networks: {
        ...registry.networks,
        [network]: { ...registry.networks[network]!, region: 'another-region' },
      },
    };
    expect(routeChoices(otherRegion, event).some((choice) => choice.id === route)).toBe(false);
  });

  it('supports a two-way entry followed by centered forward-only loop lanes, with no repeated-edge lap', () => {
    const { network, roads, route } = course();
    expect(lintRoadNetwork({ network, roads, routes: [route] })).toEqual([]);
    const directions = roads.map((r) =>
      r.laneSections[0]!.lanes.filter((l) => l.kind === 'drive').map((l) => l.direction),
    );
    expect(directions[0]).toEqual([-1, 1]);
    for (const lanes of directions.slice(1)) expect(lanes).toEqual([1]);
    expect(route.closed).toBe(false);
    expect(new Set(route.mainPath).size).toBe(route.mainPath.length);
    expect(route.startGrid?.perRow).toBe(1);
    expect(route.start.s).toBeGreaterThanOrEqual(
      ((route.startGrid?.rows ?? 0) - 1) * (route.startGrid?.rowGapM ?? 0),
    );
    const length = roads.reduce((s, r) => s + r.lengthM, 0);
    expect(length).toBeGreaterThan(1500);
    expect(length).toBeLessThan(2200);
  });

  it('carries actual OSM/USGS provenance covered by the existing ODbL pack rule', () => {
    const { network, roads, route } = course();
    const manifest = read<{ licenseRules: { paths: string[]; spdx: string; licenseFile: string }[] }>(
      'packs/region-clinton/pack.json',
    );
    const rule = manifest.licenseRules.find((r) => r.spdx === 'ODbL-1.0');
    expect(rule?.paths).toContain('regions/*/roads/osm-*.json');
    expect(readFileSync(`packs/region-clinton/${rule?.licenseFile}`, 'utf8')).toContain('Open Database');
    for (const doc of [network, ...roads, route]) {
      const raw = doc as {
        provenance?: { sources: { name: string; sha256: string }[] };
        meta?: { provenance?: { sources: { name: string; sha256: string }[] } };
      };
      const sources = raw.provenance?.sources ?? raw.meta?.provenance?.sources ?? [];
      expect(sources.some((s) => s.name === 'OpenStreetMap' && /^[a-f0-9]{64}$/.test(s.sha256))).toBe(true);
      expect(sources.some((s) => s.name === 'USGS 3DEP elevation' && /^[a-f0-9]{64}$/.test(s.sha256))).toBe(
        true,
      );
    }
  });

  it('draws continuous supported pavement across tight bends and both joins', () => {
    const { network, roads } = course();
    const road = createRoadNetwork({ network, roads });
    const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
    const built = buildRoadScene(road, createFlatLook(), dressing, { seed: 1 });
    const ground = new GroundTris(built.group);
    let probes = 0;
    const missing: string[] = [];
    for (const edge of road.edges) {
      for (let s = 0.1; s <= edge.length; s += 1) {
        const drives = road.lanesAt(edge.index, s).filter((l) => l.kind === 'drive');
        for (const lane of drives)
          for (const d of [
            lane.dCenterM,
            lane.dCenterM - lane.widthM / 2 + 0.15,
            lane.dCenterM + lane.widthM / 2 - 0.15,
          ]) {
            const p = road.toWorld(edge.index, s, d, 0);
            const supported = ground.allAt(p.x, p.z, p.y + 0.4).some((hit) => Math.abs(hit.y - p.y) < 0.35);
            if (!supported) missing.push(`${edge.id} s=${s.toFixed(1)} d=${d}`);
            probes++;
          }
      }
    }
    built.dispose();
    process.stdout.write(
      `[examined] Eagle Point: ${probes} pavement rays across lane centers/edges and joins; ${missing.length} missing\n`,
    );
    expect(probes).toBeGreaterThan(1000);
    expect(missing.slice(0, 10)).toEqual([]);
  }, 90_000);

  it('the rideable grass past the shade seam has drawn ground under the whole bike', () => {
    const { network, roads } = course();
    const road = createRoadNetwork({ network, roads });
    const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
    const built = buildRoadScene(road, createFlatLook(), dressing, { seed: 1 });
    const ground = new GroundTris(built.group);
    const plan = { items: [], cellM: 32, cells: new Map() };
    let supported = 0;
    let unavailable = 0;
    try {
      for (const edge of road.edges)
        for (let s = 5; s < edge.length - 5; s += 10)
          for (const side of [-1, 1] as const) {
            const d = road.vergeAt(edge.index, s, side < 0 ? 'left' : 'right').dOuter + side * 1;
            const p = road.toWorld(edge.index, s, d, 0);
            const spot = courseAt(road, plan, { edge: edge.index, s, d }, p.y + 0.3);
            if (spot.kind !== 'road') {
              unavailable++;
              continue;
            }
            for (const along of [-0.8, 0.8])
              for (const across of [-0.45, 0.45]) {
                const q = road.toWorld(edge.index, s + along, d + across, 0);
                expect(
                  ground.allAt(q.x, q.z, q.y + 0.4).some((hit) => Math.abs(hit.y - q.y) < 0.35),
                  `${edge.id} s=${s} d=${d}`,
                ).toBe(true);
              }
            supported++;
          }
      expect(supported).toBeGreaterThan(0);
      process.stdout.write(
        `[runoff mesh] ${supported} accepted grass positions, four body-corner rays each; ${unavailable} positions outside supported course\n`,
      );
    } finally {
      built.dispose();
    }
  }, 90_000);

  it('fits the largest available racing crew and every reserve cop on supported nonoverlapping pavement', () => {
    const registry = registryFromGlob(
      import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }),
    );
    const { sim, config } = createHeadlessRace(
      {
        seed: 1,
        eventId: 'region-clinton:clinton-ia136-race',
        route: 'region-clinton:osm-clinton-eagle-point-run',
        freePlay: true,
        rivals: Object.keys(registry.riders).length,
      },
      { registry },
    );
    const { roads } = course();
    const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
    const built = buildRoadScene(config.road, createFlatLook(), dressing, { seed: 1 });
    const ground = new GroundTris(built.group);
    const riders = sim.snapshot().entities.filter((m) => m.kind === 'rider');
    process.stdout.write(
      `[grid] ${JSON.stringify(riders.map((m) => ({ id: m.id, faction: m.faction, road: m.road })))}\n`,
    );
    expect(riders.some((m) => m.faction === 'law')).toBe(true);
    expect(riders.some((m) => m.faction !== 'law')).toBe(true);
    for (const edge of config.road.edges)
      for (const marker of config.road.featuresOf(edge.index, 'copSpawn')) {
        const lanes = config.road.lanesAt(edge.index, (marker.s0 + marker.s1) / 2);
        expect(
          lanes.some(
            (l) =>
              l.kind === 'shoulder' &&
              marker.d0 >= l.dCenterM - l.widthM / 2 &&
              marker.d1 <= l.dCenterM + l.widthM / 2,
          ),
          'patrol marker on paved shoulder',
        ).toBe(true);
      }
    for (const rider of riders) {
      const box = hitboxOf(config.riders[rider.id]?.hitbox);
      const lanes = config.road.lanesAt(rider.road.edge, rider.road.s);
      expect(
        lanes.some(
          (l) =>
            (rider.faction === 'law' ? l.kind === 'shoulder' : l.kind === 'drive' && l.direction === 1) &&
            Math.abs(rider.road.d - l.dCenterM) + box.widthM / 2 <= l.widthM / 2,
        ),
        `paved body space ${rider.id}`,
      ).toBe(true);
      for (const along of [-box.lengthM / 2, box.lengthM / 2])
        for (const across of [-box.widthM / 2, box.widthM / 2]) {
          const s = rider.road.s + along;
          expect(s, `longitudinal space ${rider.id}`).toBeGreaterThanOrEqual(0);
          const p = config.road.toWorld(rider.road.edge, s, rider.road.d + across, 0);
          expect(
            ground.allAt(p.x, p.z, p.y + 0.4).some((hit) => Math.abs(hit.y - p.y) < 0.35),
            `supported body corner ${rider.id}`,
          ).toBe(true);
        }
      for (const other of riders) {
        if (other.id <= rider.id || other.road.edge !== rider.road.edge) continue;
        const otherBox = hitboxOf(config.riders[other.id]?.hitbox);
        expect(
          Math.abs(other.road.s - rider.road.s) >= (box.lengthM + otherBox.lengthM) / 2 ||
            Math.abs(other.road.d - rider.road.d) >= (box.widthM + otherBox.widthM) / 2,
          `separate grid/parked bodies ${rider.id}, ${other.id}`,
        ).toBe(true);
      }
    }
    built.dispose();
    process.stdout.write(
      `[examined] largest available crew: ${riders.filter((m) => m.faction !== 'law').length} racers and ${riders.filter((m) => m.faction === 'law').length} law; supported body corners and nonoverlap\n`,
    );
  }, 90_000);
});
