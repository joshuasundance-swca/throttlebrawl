import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createHeadlessRace, routeChoices } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { hitboxOf } from '../../src/core';
import { createSimWithWorld } from '../../src/sim/create';
import { COP_PARKED, copsState } from '../../src/sim/cops';
import { terrainPatrolSpot } from '../../src/sim/cops/terrain-patrol';
import {
  createRoadNetwork,
  courseAt,
  terrainAt,
  lintRoadNetwork,
  type BakedNetwork,
  type BakedRoad,
  type BakedRoute,
} from '../../src/road';
import { GroundTris } from '../../src/render/land-probe.test-util';
import { createFlatLook } from '../../src/render/look';
import { buildRoadScene, type RoadDressing } from '../../src/render/road-mesh';
import { buildTerrainChunks } from '../../src/render/terrain-mesh';
import { iowaParkLayout, IOWA_PARK_RECOVERY_M } from '../../src/road/structures/iowa-park';
import { planTerrainTrees } from '../../src/road/structures/terrain-trees';
import { buildSoup, roadPointsOf } from '../../src/render/backdrop/builder';
import type { BackdropNetworkFile, BackdropRegionFile } from '../../src/render/backdrop/data';
import sourceRecipe from './networks/osm-clinton-eagle-point.json';
import { packInputs } from '../../scripts/pack-inputs.mjs';

const inputs = packInputs(process.cwd());
const read = <T>(file: string): T => JSON.parse(inputs.materialize(file, readFileSync(file, 'utf8'))) as T;
const RECIPE = 'tools/gis/networks/osm-clinton-eagle-point.json';
const ROOT = 'packs/region-clinton/regions/clinton-iowa';

describe('Eagle Point North Run', () => {
  it('preserves every prior DEM grid observation while extending its northern rows', () => {
    const grid = read<{ x: number[]; z: number[]; heightRows: number[][] }>(
      'tools/gis/terrain/eagle-point/grid.json',
    );
    const manifest = read<{
      provenance: {
        dem_sources: { gridRowsInclusive: number[] }[];
        dem_derivation: {
          preserved_rows_numeric_sha256: string;
          preserved_observations: number;
          added_observations: number;
        };
      };
    }>('tools/gis/terrain/eagle-point/manifest.json');
    const [start, end] = manifest.provenance.dem_sources[0]!.gridRowsInclusive;
    const retained = grid.heightRows.slice(start, end! + 1);
    const heights = retained.flat();
    const bytes = Buffer.alloc(heights.length * 8);
    heights.forEach((height, i) => bytes.writeDoubleLE(height, i * 8));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      manifest.provenance.dem_derivation.preserved_rows_numeric_sha256,
    );
    expect(retained.flat().length).toBe(manifest.provenance.dem_derivation.preserved_observations);
    expect(grid.heightRows.length).toBe(grid.z.length);
    expect(grid.heightRows.every((row) => row.length === grid.x.length && row.every(Number.isFinite))).toBe(
      true,
    );
    expect(grid.heightRows.flat().length - retained.flat().length).toBe(
      manifest.provenance.dem_derivation.added_observations,
    );
  });
  it('authors the long forward northern arc without either short bypass', () => {
    const recipe = read<typeof sourceRecipe>(RECIPE);
    const line = recipe.lines.find((candidate) => candidate.id === 'park')!;
    const endpoint = { lat: 41.8968377, lon: -90.1771758 };
    const retainedJoin = { lat: 41.8977594, lon: -90.1769029 };
    expect(line.pathTo).toEqual(endpoint);
    expect(line.end).toEqual(endpoint);
    expect(line.via).toContainEqual(retainedJoin);
    expect(line.splitAt).toContainEqual(retainedJoin);
    const selectedWayFilter = line.wayFilter[0];
    expect(selectedWayFilter, 'the explicit source-way filter is present').toBeDefined();
    if (!selectedWayFilter) throw new Error('Missing explicit source-way filter');
    const filter = new RegExp(selectedWayFilter['@id']);
    expect(filter.test('75935936')).toBe(true);
    expect(filter.test('15862296')).toBe(false);
    expect(filter.test('15862397')).toBe(false);
    const route = recipe.routes.find(
      (candidate: { id: string }) => candidate.id === 'osm-clinton-eagle-north-run',
    );
    expect(route).toMatchObject({
      startRoad: 'osm-clinton-eagle-central-loop',
      startS: 48,
      finishRoad: 'osm-clinton-eagle-north-loop',
      finishS: -30,
      startGrid: { rows: 6, perRow: 1, rowGapM: 8 },
    });
  });

  it('bakes an open forward-only northern route and retains the southern course', () => {
    const route = read<BakedRoute>(`${ROOT}/routes/osm-clinton-eagle-north-run.json`);
    const path = ['osm-clinton-eagle-central-loop', 'osm-clinton-eagle-north-loop'];
    expect(route.closed).toBe(false);
    expect(route.mainPath).toEqual(path);
    expect(route.allowedRoads).toEqual(path);
    const south = read<BakedRoute>(`${ROOT}/routes/osm-clinton-eagle-point-run.json`);
    expect(south.mainPath).toEqual([
      'osm-clinton-eagle-entry',
      'osm-clinton-eagle-south-loop',
      'osm-clinton-eagle-central-loop',
    ]);
    for (const id of path) {
      const road = read<BakedRoad>(`${ROOT}/roads/${id}.json`);
      for (const section of road.laneSections) {
        expect(
          section.lanes
            .filter((lane: { kind: string }) => lane.kind === 'drive')
            .map((lane: { direction: number }) => lane.direction),
        ).toEqual([1]);
      }
    }
  });

  it('offers the northern course and supports its full grid, finish and northern riding surfaces', () => {
    const registry = registryFromGlob(
      import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }),
    );
    const eventId = 'region-clinton:clinton-ia136-race';
    const routeId = 'region-clinton:osm-clinton-eagle-north-run';
    expect(routeChoices(registry, eventId).some((choice) => choice.id === routeId)).toBe(true);
    const { sim, config } = createHeadlessRace(
      { seed: 1, eventId, route: routeId, freePlay: true, rivals: Object.keys(registry.riders).length },
      { registry },
    );
    const observed = createSimWithWorld(config);
    expect(observed.sim.hash(), 'the observed cops state belongs to the same initial race').toBe(sim.hash());
    const cops = copsState(observed.world);
    const network = read<BakedNetwork>(`${ROOT}/networks/osm-clinton-eagle-point.json`);
    const roads = network.roads.map((id) => read<BakedRoad>(`${ROOT}/roads/${id}.json`));
    const route = read<BakedRoute>(`${ROOT}/routes/osm-clinton-eagle-north-run.json`);
    expect(lintRoadNetwork({ network, roads, routes: [route] })).toEqual([]);
    const road = createRoadNetwork({ network, roads });
    const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
    const built = buildRoadScene(road, createFlatLook(), dressing, {
      seed: 1,
      terrainChunks: buildTerrainChunks,
    });
    const ground = new GroundTris(built.group);
    const plan = { items: [], cellM: 32, cells: new Map() };
    let pavement = 0;
    let grass = 0;
    let bodyCorners = 0;
    let racingGrid = 0;
    let grassWaiters = 0;
    let pavedLaw = 0;
    try {
      const riders = sim.snapshot().entities.filter((entity) => entity.kind === 'rider');
      for (const rider of riders) {
        const box = hitboxOf(config.riders[rider.id]?.hitbox);
        const e = road.edges[rider.road.edge]!;
        const patrolAt = cops.patrolAt[rider.id] ?? -1;
        const grassWaiter = rider.road.d < e.dMin || rider.road.d > e.dMax;
        if (grassWaiter) {
          expect(config.riders[rider.id]?.controller.kind).toBe('cop');
          expect(cops.phase[rider.id]).toBe(COP_PARKED);
          expect(rider.mode).toBe('Road');
          expect(rider.speed).toBe(0);
          if (patrolAt >= 0)
            expect(config.route.progressAt(rider.road.edge, rider.road.s)).toBeCloseTo(patrolAt, 6);
          const pos = { edge: rider.road.edge, s: rider.road.s, d: rider.road.d, dir: rider.road.dir };
          expect(terrainPatrolSpot(config, pos), `validated grass waiter ${rider.id}`).toEqual(pos);
          const ground = terrainAt(road.terrain, rider.x, rider.z);
          expect(ground?.surface).toBe('grass');
          expect(rider.y).toBeCloseTo(ground!.y, 6);
          grassWaiters++;
        } else {
          expect(
            road
              .lanesAt(rider.road.edge, rider.road.s)
              .some(
                (lane) =>
                  ((lane.kind === 'drive' && lane.direction === 1) ||
                    (rider.faction === 'law' && lane.kind === 'shoulder')) &&
                  Math.abs(rider.road.d - lane.dCenterM) + box.widthM / 2 <= lane.widthM / 2,
              ),
            `whole paved grid width ${rider.id}`,
          ).toBe(true);
          if (rider.faction === 'law') pavedLaw++;
          else racingGrid++;
        }
        for (const other of riders) {
          if (other.id <= rider.id) continue;
          const otherBox = hitboxOf(config.riders[other.id]?.hitbox);
          if (other.road.edge === rider.road.edge)
            expect(
              Math.abs(other.road.s - rider.road.s) >= (box.lengthM + otherBox.lengthM) / 2 ||
                Math.abs(other.road.d - rider.road.d) >= (box.widthM + otherBox.widthM) / 2,
              `nonoverlapping northern grid ${rider.id}/${other.id}`,
            ).toBe(true);
          if (Math.abs(other.y - rider.y) < 1.6)
            expect(
              Math.hypot(other.x - rider.x, other.z - rider.z),
              `physical rider body separation ${rider.id}/${other.id}`,
            ).toBeGreaterThanOrEqual(
              (Math.hypot(box.lengthM, box.widthM) + Math.hypot(otherBox.lengthM, otherBox.widthM)) / 2,
            );
        }
        for (const along of [-box.lengthM / 2, box.lengthM / 2])
          for (const across of [-box.widthM / 2, box.widthM / 2]) {
            const s = rider.road.s + along;
            expect(s).toBeGreaterThanOrEqual(0);
            const frame = road.frameAt(rider.road.edge, rider.road.s);
            const p = grassWaiter
              ? {
                  x: rider.x + frame.tx * along - frame.tz * across,
                  y: rider.y + frame.grade * along + Math.tan(frame.bank) * across,
                  z: rider.z + frame.tz * along + frame.tx * across,
                }
              : road.toWorld(rider.road.edge, s, rider.road.d + across, rider.road.h);
            expect(ground.allAt(p.x, p.z, p.y + 0.4).some((hit) => Math.abs(hit.y - p.y) < 0.35)).toBe(true);
            bodyCorners++;
          }
      }
      const edge = road.edgeIndex('osm-clinton-eagle-north-loop');
      for (let s = 1; s < road.edges[edge]!.length; s += 3) {
        for (const d of [-1.35, 0, 1.35]) {
          const p = road.toWorld(edge, s, d, 0);
          expect(
            ground
              .allAt(p.x, p.z, p.y + 0.4)
              .some((hit) => hit.name === 'road-road' && Math.abs(hit.y - p.y) < 0.35),
            `north pavement ${s}/${d}`,
          ).toBe(true);
          expect(courseAt(road, plan, { edge, s, d }, p.y + 0.3).kind).toBe('road');
          pavement++;
        }
        for (const d of [-3, 3]) {
          const p = road.toWorld(edge, s, d, 0);
          const terrain = terrainAt(road.terrain, p.x, p.z);
          expect(terrain?.surface, `north runoff ${s}/${d}`).toBe('grass');
          expect(
            ground.allAt(p.x, p.z, terrain!.y + 0.4).some((hit) => Math.abs(hit.y - terrain!.y) < 0.35),
          ).toBe(true);
          grass++;
        }
      }
      for (const finishRoute of [route, read<BakedRoute>(`${ROOT}/routes/osm-clinton-eagle-point-run.json`)])
        for (const along of [-1, 1])
          for (const across of [-0.5, 0.5]) {
            const p = road.toWorld(
              road.edgeIndex(finishRoute.finish.road),
              finishRoute.finish.s + along,
              across,
              0,
            );
            expect(ground.allAt(p.x, p.z, p.y + 0.4).some((hit) => Math.abs(hit.y - p.y) < 0.35)).toBe(true);
            bodyCorners++;
          }
      // A short connector cannot satisfy the long source arc. Compare against the report's
      // baked span and the selected start/finish offsets rather than a whole-network count.
      const report = read<{ routes: Record<string, number> }>(
        'tools/gis/reports/osm-clinton-eagle-point.network.json',
      );
      expect(report.routes['osm-clinton-eagle-north-run']).toBeCloseTo(config.route.length, 0);
      const manifest = read<{ provenance: { northern_source_arc: { projected_length_m: number } } }>(
        'tools/gis/terrain/eagle-point/manifest.json',
      );
      const sourceLength = manifest.provenance.northern_source_arc.projected_length_m;
      expect(road.edges[edge]!.length).toBeGreaterThan(sourceLength * 0.98);
      expect(road.edges[edge]!.length).toBeLessThan(sourceLength * 1.02);
      expect(pavement).toBeGreaterThan(0);
      expect(grass).toBeGreaterThan(0);
      expect(racingGrid, 'racing grid still exercises the whole paved-width rule').toBeGreaterThan(0);
      expect(grassWaiters, 'actual parked law exercises physical grass support').toBeGreaterThan(0);
      process.stdout.write(
        `[north support] ${pavement} drawn pavement rays, ${grass} terrain/runoff rays, ${bodyCorners} grid/waiter/finish body corners; ${racingGrid} paved racers, ${pavedLaw} paved law, ${grassWaiters} validated grass waiters\n`,
      );
    } finally {
      built.dispose();
    }
  }, 90_000);

  it('keeps expanded-network facilities, tree crowns and standing backdrop off every road', () => {
    const network = read<BakedNetwork>(`${ROOT}/networks/osm-clinton-eagle-point.json`);
    const roads = network.roads.map((id) => read<BakedRoad>(`${ROOT}/roads/${id}.json`));
    const road = createRoadNetwork({ network, roads });
    const points = road.edges.flatMap((edge) => {
      const points = [];
      for (let s = 0; s <= edge.length; s += 1)
        points.push({ ...road.toWorld(edge.index, s, 0, 0), width: Math.max(-edge.dMin, edge.dMax) });
      return points;
    });
    const clearance = (x: number, z: number, radius: number) =>
      Math.min(...points.map((p) => Math.hypot(x - p.x, z - p.z) - p.width - radius));
    const onRoad = points[0]!;
    expect(clearance(onRoad.x, onRoad.z, 1), 'deliberately planted road obstruction control').toBeLessThan(0);
    let facilities = 0;
    let trees = 0;
    for (const seed of [1, 2, 3]) {
      const layout = iowaParkLayout(road, seed);
      expect(layout.facilities.length).toBeGreaterThan(0);
      for (const facility of layout.facilities) {
        expect(clearance(facility.x, facility.z, facility.radiusM)).toBeGreaterThanOrEqual(
          0.6 + IOWA_PARK_RECOVERY_M - 0.01,
        );
        const pad = facility.specs.find((spec) => spec.rule.endsWith(':foundation'))!;
        for (const x of [-pad.foot.hu, 0, pad.foot.hu])
          for (const z of [-pad.foot.hv, 0, pad.foot.hv]) {
            const px = pad.foot.x + pad.foot.ux * x - pad.foot.uz * z;
            const pz = pad.foot.z + pad.foot.uz * x + pad.foot.ux * z;
            expect(terrainAt(road.terrain, px, pz)?.surface).toBe('grass');
          }
        facilities++;
      }
      const plan = planTerrainTrees(road, seed);
      expect(plan.items.length).toBeGreaterThan(0);
      for (const tree of plan.items) {
        expect(terrainAt(road.terrain, tree.x, tree.z)?.surface).toBe('grass');
        expect(clearance(tree.x, tree.z, 4.8 * tree.scale)).toBeGreaterThanOrEqual(8);
        trees++;
      }
    }
    const base = 'packs/region-clinton/assets/backdrop/clinton-iowa';
    const { soup: backdrop } = buildSoup(
      read<BackdropRegionFile>(`${base}/region.json`),
      read<BackdropNetworkFile>(`${base}/networks/osm-clinton-eagle-point.json`),
      roadPointsOf(road.edges, 1),
      1,
    );
    let standing = 0;
    for (let i = 0; i < backdrop.pos.length / 3; i++) {
      if (backdrop.info[i * 4 + 1] !== 0) continue;
      const x = backdrop.pos[i * 3]!,
        z = backdrop.pos[i * 3 + 2]!;
      expect(clearance(x, z, 0)).toBeGreaterThan(150);
      standing++;
    }
    expect(standing).toBeGreaterThan(0);
    process.stdout.write(
      `[north clearance] ${facilities} facility placements with dry pad corners, ${trees} whole crowns across 3 seeds, ${standing} standing backdrop vertices against every road at 1 m stations\n`,
    );
  }, 90_000);
});
