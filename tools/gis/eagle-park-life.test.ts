import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import recipe from './networks/osm-clinton-eagle-point.json';
import type { BakedRoad } from '../../src/road';
import hiker from '../../packs/region-clinton/traffic/park-hiker.json';
import runner from '../../packs/region-clinton/traffic/park-runner.json';
import region from '../../packs/region-clinton/regions/clinton-iowa/region.json';
import { peopleFigureFor } from '../../src/render/traffic-figures';

describe('Eagle Point visitor authoring', () => {
  it('keeps canonical and baked feature lists identical on every park road', () => {
    let zones = 0;
    for (const source of recipe.lines.flatMap((l) => l.roads)) {
      const road = JSON.parse(
        readFileSync(`packs/region-clinton/regions/clinton-iowa/roads/${source.id}.json`, 'utf8'),
      ) as BakedRoad;
      expect(road.features).toEqual('features' in source ? source.features : []);
      for (const f of road.features.filter((f) => f.kind === 'roadsideZone')) {
        zones++;
        expect(source.tags).toContain('iowa-park');
        expect(f.d1).toBeLessThan(0);
        expect(f.params?.['kinds']).toEqual([hiker, runner].map((t) => `region-clinton:${t.id}`));
      }
    }
    expect(zones).toBeGreaterThan(0);
  });
  it('uses existing strolling/dodging silhouettes only by local opt-in', () => {
    expect(region.traffic.pedestrians).toEqual([]);
    for (const type of [hiker, runner]) {
      expect(type.category).toBe('pedestrian');
      expect(type.behaviour).toMatchObject({ roadside: 'dodges', strolls: true, dives: true });
      const id = `region-clinton:${type.id}`;
      expect(peopleFigureFor(undefined, id, null)).toBe(type === hiker ? 'hiker' : 'jogger');
      expect(peopleFigureFor(undefined, id, 'film')).toBe('personPhone');
      expect(peopleFigureFor(undefined, id, 'fist')).toBe('personFist');
    }
  });
});
