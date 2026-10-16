import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { eventSchema, regionSchema } from '../../src/content/schema/entries';
import { lintRoadNetwork } from '../../src/road/validate';
import type { BakedNetwork, BakedRoad, BakedRoute } from '../../src/road/types';

// First Clinton slice: a bounded, one-pass race on the actual IA 136 line, with existing
// competitors and traffic. No repeated-edge lap support, invented shortcuts or new objectives.
const ROOT = 'packs/region-clinton/regions/clinton-iowa';
const read = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;

describe('Clinton: IA 136 first course', () => {
  it('is its own region and an existing-kind race with competitors, traffic and one pass', () => {
    const region = regionSchema.parse(read<unknown>(`${ROOT}/region.json`));
    const event = eventSchema.parse(read<unknown>('packs/region-clinton/events/clinton-ia136-race.json'));
    const route = read<BakedRoute>(`${ROOT}/routes/osm-clinton-ia136-run.json`);
    expect(region.id).toBe('clinton-iowa');
    expect(region.networks).toContain(route.network);
    expect(event.region).toBe(region.id);
    expect(event.kind).toBe('classic-race');
    expect(event.field.riders?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(region.traffic.mix.length).toBeGreaterThan(0);
    const traffic = event['traffic'] as { densityScale?: number } | undefined;
    expect(traffic?.densityScale ?? 1).toBeGreaterThan(0);
    expect(event.lengths.some((l) => l.route === route.id && l.laps === 1)).toBe(true);
    expect(route.closed).toBe(false);
    expect(new Set(route.mainPath).size).toBe(route.mainPath.length);
  });

  it('has continuous rideable geometry, bends both ways and passing room between bends', () => {
    const network = read<BakedNetwork>(`${ROOT}/networks/osm-clinton-ia136.json`);
    const route = read<BakedRoute>(`${ROOT}/routes/osm-clinton-ia136-run.json`);
    const roads = network.roads.map((id) => read<BakedRoad>(`${ROOT}/roads/${id}.json`));
    expect(lintRoadNetwork({ network, roads, routes: [route] })).toEqual([]);
    const length = roads.reduce((sum, r) => sum + r.lengthM, 0);
    expect(length).toBeGreaterThan(3000);
    expect(length).toBeLessThan(9000);
    const curvature = roads.flatMap((r) => r.samples.data['kappa'] ?? []);
    // Broad highway bends, rather than the handoff's unverified technical-hairpin premise.
    expect(curvature.some((k) => k > 1 / 400)).toBe(true);
    expect(curvature.some((k) => k < -1 / 400)).toBe(true);
    let runM = 0;
    let passingM = 0;
    for (const road of roads) {
      const drive = road.laneSections[0]?.lanes.filter((lane) => lane.kind === 'drive') ?? [];
      expect(drive.some((lane) => lane.direction === 1)).toBe(true);
      expect(drive.some((lane) => lane.direction === -1)).toBe(true);
      for (const k of road.samples.data['kappa'] ?? []) {
        runM = Math.abs(k) < 1 / 600 ? runM + road.sampleSpacingM : 0;
        passingM = Math.max(passingM, runM);
      }
    }
    expect(passingM).toBeGreaterThanOrEqual(150);
  });
});
