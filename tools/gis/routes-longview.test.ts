/// <reference types="vite/client" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache, regionChoices, routeChoices } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { GroundTris } from '../../src/render/land-probe.test-util';
import { createFlatLook } from '../../src/render/look';
import { buildRoadScene, type RoadDressing } from '../../src/render/road-mesh';
import {
  createRoadNetwork,
  createRouteProgress,
  lintRoadNetwork,
  type BakedNetwork,
  type BakedRoad,
  type BakedRoute,
} from '../../src/road';

const REGION = 'packs/region-pnw/regions/pacific-northwest';
const ROUTE = 'region-pnw:osm-longview-port-shift';
const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const route = () => read<BakedRoute>(`${REGION}/routes/osm-longview-port-shift.json`);
const bundle = () => {
  const network = read<BakedNetwork>(`${REGION}/networks/osm-pnw-longview.json`);
  return { network, roads: network.roads.map((id) => read<BakedRoad>(`${REGION}/roads/${id}.json`)) };
};

describe('Port Shift is a playable first Longview race', () => {
  it('offers the course through the existing PNW Quick Play race and uses that race configuration', () => {
    const choice = regionChoices(REG).find((c) => c.id === 'region-pnw:pacific-northwest');
    if (!choice) throw new Error('the Pacific Northwest must be available in Quick Play');
    const event = REG.events[choice.eventId];
    expect(event?.kind).toBe('classic-race');
    const option = routeChoices(REG, choice.eventId).find((c) => c.id === ROUTE);
    expect(option, 'the public route picker offers Longview').toBeDefined();
    const streams = createStreamCache();
    const setup = { seed: 1, eventId: choice.eventId };
    const original = buildSimConfig(REG, streams.forEvent(REG, choice.eventId), setup);
    const selected = buildSimConfig(REG, streams.forEvent(REG, choice.eventId, undefined, ROUTE), {
      ...setup,
      route: ROUTE,
    });
    expect(selected.event.routeId).toBe(ROUTE);
    expect(selected.route.routeId).toBe(route().id);
    expect(option?.lengthM).toBeCloseTo(selected.route.length, 0);
    expect(selected.riders).toEqual(original.riders);
    expect(selected.event).toEqual({ ...original.event, routeId: ROUTE });
    expect(selected.event.kind).toBe('classic-race');
  });

  it('reaches a separate finish once, with ordered checkpoints and no repeated road visits', () => {
    const data = bundle();
    const race = route();
    expect(lintRoadNetwork({ ...data, routes: [race] })).toEqual([]);
    expect(race.closed).toBe(false);
    expect(new Set(race.mainPath).size).toBe(race.mainPath.length);
    const road = createRoadNetwork(data);
    const progress = createRouteProgress(road, race);
    expect(progress.length, 'a full road race rather than a junction demonstration').toBeGreaterThan(1000);
    const start = road.toWorld(progress.start.edge, progress.start.s, 0, 0);
    const finish = road.toWorld(progress.finish.edge, progress.finish.s, 0, 0);
    expect(Math.hypot(finish.x - start.x, finish.z - start.z), 'no lap-engine shortcut').toBeGreaterThan(200);
    let previous = 0;
    for (const point of progress.checkpoints) {
      const at = progress.progressAt(point.edge, point.s);
      expect(at).toBeGreaterThan(previous);
      expect(at).toBeLessThan(progress.length);
      previous = at;
    }
    expect(progress.checkpoints.length).toBeGreaterThan(0);
    expect(progress.distanceToFinish(progress.finish.edge, progress.finish.s)).toBeCloseTo(0);
  });

  it('carries ordinary traffic continuously in both directions through every course join', () => {
    const road = createRoadNetwork(bundle());
    const progress = createRouteProgress(road, route());
    for (const index of progress.mainEdges) {
      const edge = road.edges[index];
      if (!edge) throw new Error(`missing edge ${index}`);
      for (const dir of [1, -1] as const) {
        const lanes = road
          .lanesAt(index, edge.length / 2)
          .filter((l) => l.kind === 'drive' && l.direction === dir);
        expect(lanes.length, `${edge.id}: drive lanes for direction ${dir}`).toBeGreaterThan(0);
        const end = dir === 1 ? 'to' : 'from';
        const neighbour = dir === 1 ? edge.next : edge.prev;
        if (!neighbour) continue; // Open boundaries, where ambient vehicles enter and leave.
        const rows = road.laneTransitions(index, end);
        expect(
          rows.some((row) => row.edge === neighbour.edge),
          `${edge.id}: directed traffic movement ${dir}`,
        ).toBe(true);
      }
    }
  });

  it('changes from a freight corridor to town traffic, using live regional vehicle mixes', () => {
    const data = bundle();
    const road = createRoadNetwork(data);
    const progress = createRouteProgress(road, route());
    const main = progress.mainEdges.map((index) => road.edges[index]);
    const first = main[0];
    const last = main.at(-1);
    expect(
      first?.tags.some((tag) => tag.tag === 'logging'),
      'freight traffic at the industrial start',
    ).toBe(true);
    expect(
      last?.tags.some((tag) => tag.tag === 'logging'),
      'town return uses ordinary traffic',
    ).toBe(false);
    const region = read<{ traffic: { areas: { tag: string; mix: { kind: string; weight: number }[] }[] } }>(
      `${REGION}/region.json`,
    );
    const freight = region.traffic.areas.find((area) => area.tag === 'logging');
    expect(freight?.mix.some((entry) => entry.kind === 'log-truck' && entry.weight > 0)).toBe(true);
    const laneCounts = main.map((edge) =>
      edge ? road.lanesAt(edge.index, edge.length / 2).filter((l) => l.kind === 'drive').length : 0,
    );
    expect(Math.max(...laneCounts), 'the boulevard opens passing room').toBeGreaterThan(
      Math.min(...laneCounts),
    );
  });

  it('retains changing steering demand without adding artificial jumps or gaps', () => {
    const { roads } = bundle();
    const kappa = roads.flatMap((r) => r.samples.data['kappa'] ?? []);
    expect(
      kappa.some((value) => value > 1 / 150),
      'a right turn needs deliberate braking',
    ).toBe(true);
    expect(
      kappa.some((value) => value < -1 / 150),
      'a left turn needs deliberate braking',
    ).toBe(true);
    expect(
      kappa.some((value) => Math.abs(value) < 1 / 1000),
      'passing room between corners',
    ).toBe(true);
    expect(roads.flatMap((r) => r.features ?? []).some((f) => f.kind === 'gap' || f.kind === 'ramp')).toBe(
      false,
    );
  });

  it('gives the town stretches pedestrian space on drawn land clear of the travel lanes', () => {
    const data = bundle();
    const zones = data.roads.flatMap((r) =>
      (r.features ?? [])
        .filter((f) => f.kind === 'roadsideZone' && f.params?.['spawns'] === 'pedestrians')
        .map((zone) => ({ road: r, zone })),
    );
    expect(zones.length, 'a town race must have places for its regional pedestrians').toBeGreaterThan(0);
    const road = createRoadNetwork(data);
    const dressing = Object.fromEntries(data.roads.map((r) => [r.id, r])) as RoadDressing;
    const scene = buildRoadScene(road, createFlatLook(), dressing, { seed: 1 });
    try {
      // Town pavement is a shoulder mesh; ground past it is a land mesh. Neither query accepts
      // the travel road, sea, buildings or a bridge deck as support for these town walkers.
      const ground = new GroundTris(scene.group, /^road-(land|shoulder)/);
      let probes = 0;
      const surfaces = new Set<string>();
      for (const { road: r, zone } of zones) {
        const index = road.edgeIndex(r.id);
        const side = zone.d0 + zone.d1 < 0 ? 'left' : 'right';
        expect(
          r.tags?.some((t) => t.tag === 'town' && t.s0 <= zone.s0 && t.s1 >= zone.s1),
          r.id,
        ).toBe(true);
        for (const s of [zone.s0, (zone.s0 + zone.s1) / 2, zone.s1]) {
          const verge = road.vergeAt(index, s, side);
          expect(verge.surface, `${r.id}: town pavement`).toBe('kerb');
          expect(Math.min(Math.abs(zone.d0), Math.abs(zone.d1))).toBeGreaterThan(Math.abs(verge.dInner));
          expect(Math.max(Math.abs(zone.d0), Math.abs(zone.d1))).toBeLessThan(Math.abs(verge.dOuter));
          for (const d of [zone.d0, (zone.d0 + zone.d1) / 2, zone.d1]) {
            const p = road.toWorld(index, s, d, 0);
            const hit = ground.heightAt(p.x, p.z, p.y + 1);
            expect(hit, `${r.id}: drawn land at ${s}, ${d}`).not.toBeNull();
            expect(Math.abs((hit?.y ?? Infinity) - p.y)).toBeLessThan(0.3);
            expect(hit?.up ?? 0, `${r.id}: people stand on ground, not a wall`).toBeGreaterThan(0.9);
            if (hit) surfaces.add(hit.name);
            probes++;
          }
        }
      }
      console.log(
        `[examined] ${zones.length} town pedestrian zones, ${probes} ground probes: ${[...surfaces].join(', ')}`,
      );
    } finally {
      scene.dispose();
    }
  });
});
