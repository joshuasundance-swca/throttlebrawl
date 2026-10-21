import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as roadApi from '../index';
import type { BakedNetwork, BakedRoad } from '../types';

const root = 'packs/region-clinton/regions/clinton-iowa';
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const network = read<BakedNetwork>(`${root}/networks/osm-clinton-eagle-point.json`);
const roads = network.roads.map((id) => read<BakedRoad>(`${root}/roads/${id}.json`));
const road = roadApi.createRoadNetwork({ network, roads });

describe('Eagle Point facilities through the public race structure path', () => {
  it('loads the physical layer for the real park and excludes an untagged control', () => {
    expect(roadApi.structureLayersFor(road)).toContain('iowa-park');
    const control = roadApi.createRoadNetwork({
      network,
      roads: roads.map((r) => ({ ...r, tags: r.tags?.filter((t) => t.tag !== 'iowa-park') ?? [] })),
    });
    expect(roadApi.structureLayersFor(control)).not.toContain('iowa-park');
  });

  it('prepares the same park solids for rendering and synchronous race creation', async () => {
    expect(roadApi.loadIowaParkLayout).toBeTypeOf('function');
    const module = await roadApi.loadIowaParkLayout();
    const layout = module.iowaParkLayout(road, 1);
    expect(layout.facilities.length).toBeGreaterThan(0);
    const prepared = await roadApi.ensureStructures(road, 1);
    const race = roadApi.raceStructures(road, 1);
    for (const facility of layout.facilities) {
      for (const spec of facility.specs) {
        expect(prepared.items.some((s) => s.layer === 'iowa-park' && s.rule === spec.rule)).toBe(true);
        expect(race.items.some((s) => s.layer === 'iowa-park' && s.rule === spec.rule)).toBe(true);
      }
      const pad = facility.specs.find((s) => s.rule.endsWith(':foundation'))!;
      expect(roadApi.structuresAt(race, pad.foot.x, pad.foot.z).some((s) => s.rule === pad.rule)).toBe(true);
    }
  });
});
