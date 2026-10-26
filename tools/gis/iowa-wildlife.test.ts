import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import recipe from './networks/osm-clinton-ia136.json';
import type { BakedRoad } from '../../src/road';
import whitetail from '../../packs/region-clinton/traffic/whitetail.json';
import turkey from '../../packs/region-clinton/traffic/wild-turkey.json';
import region from '../../packs/region-clinton/regions/clinton-iowa/region.json';

const roadFile = (id: string) =>
  JSON.parse(readFileSync(`packs/region-clinton/regions/clinton-iowa/roads/${id}.json`, 'utf8')) as BakedRoad;
const wildlife = [whitetail, turkey].map((t) => `region-clinton:${t.id}`);

describe('IA 136 wildlife authoring', () => {
  it('keeps canonical and baked feature lists identical on every highway and county road', () => {
    let zones = 0;
    for (const source of recipe.lines.flatMap((l) => l.roads)) {
      const features = roadFile(source.id).features ?? [];
      expect(features, source.id).toEqual('features' in source ? source.features : []);
      zones += features.filter(
        (f) =>
          f.kind === 'roadsideZone' &&
          (f.params?.['kinds'] as string[] | undefined)?.every((k) => wildlife.includes(k)),
      ).length;
    }
    expect(zones).toBeGreaterThan(0);
  });

  it('warns of each kind with a live site sign shortly before its first zone on that road', () => {
    const signs = new Map(region.signs.map((s) => [s.id, s]));
    const warned = { 'deer-crossing': whitetail, 'turkey-crossing': turkey };
    for (const [item, type] of Object.entries(warned)) {
      expect(signs.get(item)?.status).toBe('live');
      expect(signs.get(item)?.tags).toContain('site');
      const road = recipe.lines
        .flatMap((l) => l.roads)
        .map((r) => roadFile(r.id))
        .find((r) => (r.features ?? []).some((f) => f.kind === 'billboard' && f.item === item))!;
      expect(road, item).toBeDefined();
      const sign = road.features!.find((f) => f.item === item)!;
      const zone = road.features!.find(
        (f) =>
          f.kind === 'roadsideZone' &&
          (f.params?.['kinds'] as string[]).includes(`region-clinton:${type.id}`),
      )!;
      expect(zone, item).toBeDefined();
      // The race rides these roads in +s: the sign comes 100 to 250 m before the animals.
      expect(zone.s0 - sign.s1).toBeGreaterThanOrEqual(100);
      expect(zone.s0 - sign.s1).toBeLessThanOrEqual(250);
    }
  });

  it('keeps the regional pools empty: the animals come only from their own zones', () => {
    expect(region.traffic.animals).toEqual([]);
    expect(region.traffic.pedestrians).toEqual([]);
    expect(whitetail).toMatchObject({ category: 'animal', hazard: 'big', behaviour: { roadside: 'yields' } });
    expect(turkey).toMatchObject({ category: 'animal', hazard: 'normal', behaviour: { roadside: 'dodges' } });
  });
});
