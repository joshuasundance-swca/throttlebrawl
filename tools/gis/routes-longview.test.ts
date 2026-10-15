import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  createRouteProgress,
  lintRoadNetwork,
  type BakedNetwork,
  type BakedRoad,
  type BakedRoute,
} from '../../src/road';

const REGION = 'packs/region-pnw/regions/pacific-northwest';
const EVENT = 'packs/region-pnw/events/pnw-t1-port-shift.json';
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const route = () => read<BakedRoute>(`${REGION}/routes/osm-longview-port-shift.json`);
const bundle = () => {
  const network = read<BakedNetwork>(`${REGION}/networks/osm-pnw-longview.json`);
  return { network, roads: network.roads.map((id) => read<BakedRoad>(`${REGION}/roads/${id}.json`)) };
};

describe('Port Shift is a playable first Longview race', () => {
  it('offers an existing-kind race in the PNW on a real-road route', () => {
    expect(existsSync(EVENT), 'the new Longview race must be authored').toBe(true);
    const event = JSON.parse(readFileSync(EVENT, 'utf8')) as {
      kind: string;
      region: string;
      lengths: { route: string; laps: number }[];
      field: { riders: string[] };
    };
    expect(event.kind).toBe('classic-race');
    expect(event.region).toBe('pacific-northwest');
    expect(event.field.riders.length, 'combat needs a rival field').toBeGreaterThan(1);
    for (const length of event.lengths) {
      expect(length.laps, 'the current progress engine supports one traversal').toBe(1);
      expect(existsSync(`${REGION}/routes/${length.route}.json`)).toBe(true);
    }
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
});
