import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad } from '../../road';
import { createFlatLook } from '../look';
import { buildRoadScene } from '../road-mesh';
import { buildTerrainChunks } from '../terrain-mesh';
import { iowaParkLayout } from '../../road/structures/iowa-park';
import { scenesProblems, type ScenesFile } from './data';
import { placeScenes } from './place';

const ROOT = 'packs/region-clinton/regions/clinton-iowa';
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const file = read<ScenesFile>('packs/region-clinton/assets/scenes/clinton-iowa.json');
function world(id: string) {
  const network = read<BakedNetwork>(`${ROOT}/networks/${id}.json`);
  const roads = network.roads.map((road) => read<BakedRoad>(`${ROOT}/roads/${road}.json`));
  const road = createRoadNetwork({ network, roads });
  const built = buildRoadScene(road, createFlatLook(), Object.fromEntries(roads.map((r) => [r.id, r])), {
    seed: 1,
    terrainChunks: buildTerrainChunks,
  });
  return {
    road,
    built,
    place: (seed: number, scenes = file) =>
      placeScenes({
        road,
        seed,
        file: scenes,
        spots: built.spots,
        landReach: (edge, side, s) => built.landReach(edge, side, s),
      }),
  };
}
const park = world('osm-clinton-eagle-point');
const highway = world('osm-clinton-ia136');
afterAll(() => {
  park.built.dispose();
  highway.built.dispose();
});

describe('Iowa roadside scenes distinguish the park from the farm highway', () => {
  it('places original park facilities on Eagle Point and farmland scenes on the rural highway', () => {
    const farms = file.scenes.filter((s) => s.excludesTag === 'iowa-park');
    expect(farms.length, 'positive farm-scene cohort').toBeGreaterThan(0);
    const farmIds = new Set(farms.map((s) => s.id));
    const seenPark = new Set<string>();
    const seenFarms = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const p = iowaParkLayout(park.road, seed).facilities;
      const h = highway.place(seed);
      expect(iowaParkLayout(park.road, seed).facilities).toEqual(p);
      expect(park.place(seed), 'farm scenes excluded from park').toEqual([]);
      expect(
        iowaParkLayout(highway.road, seed).facilities,
        'physical park palette excluded from highway',
      ).toEqual([]);
      for (const scene of p) {
        expect(scene.specs.length, 'physical facilities carry collision and roof supports').toBeGreaterThan(
          0,
        );
        expect(farmIds.has(scene.id), scene.id).toBe(false);
        seenPark.add(scene.id);
      }
      for (const scene of h) {
        expect(farmIds.has(scene.def.id), scene.def.id).toBe(true);
        seenFarms.add(scene.def.id);
      }
    }
    expect(seenPark.size, 'legal park sites on the real authored terrain').toBeGreaterThan(0);
    expect(seenFarms.size, 'control finds the existing rural palette').toBeGreaterThan(0);
  });

  it('rejects malformed optional road-tag selectors and accepts their omission', () => {
    const base = file.scenes[0]!;
    expect(scenesProblems({ ...file, scenes: [base] })).toEqual([]);
    for (const key of ['needsTag', 'excludesTag']) {
      for (const invalid of ['', 'NOT A TAG', 4, ['rural'], null]) {
        expect(scenesProblems({ ...file, scenes: [{ ...base, [key]: invalid }] })).not.toEqual([]);
      }
      expect(scenesProblems({ ...file, scenes: [{ ...base, [key]: 'iowa-park' }] })).toEqual([]);
    }
  });

  it('retains unfiltered rural scenes while keeping decorative ghosts off playable park terrain', () => {
    const original = {
      ...file,
      scenes: file.scenes.map((scene) => {
        const copy = { ...scene };
        delete copy.needsTag;
        delete copy.excludesTag;
        return copy;
      }),
    };
    expect(highway.place(1, original).length, 'same renderer places the highway control').toBeGreaterThan(0);
    const positions = (f: ScenesFile) =>
      highway.place(1, f).map((p) => ({ id: p.def.id, edge: p.edge, s: p.s, d: p.d }));
    expect(positions(file), 'omitted filters retain the previous highway placements').toEqual(
      positions(original),
    );
    expect(park.place(1, original), 'physical facilities own the playable park terrain').toEqual([]);
  });

  it('applies required/excluded road tags to the complete footprint, with working positive controls', () => {
    const plain = {
      ...file,
      scenes: file.scenes.map((s) => {
        const copy = { ...s };
        delete copy.excludesTag;
        return copy;
      }),
    };
    const required = { ...plain, scenes: plain.scenes.map((s) => ({ ...s, needsTag: 'rural' })) };
    const missing = { ...plain, scenes: plain.scenes.map((s) => ({ ...s, needsTag: 'iowa-park' })) };
    const excluded = { ...plain, scenes: plain.scenes.map((s) => ({ ...s, excludesTag: 'rural' })) };
    expect(highway.place(1, required).length).toBeGreaterThan(0);
    expect(highway.place(1, missing)).toEqual([]);
    expect(highway.place(1, excluded)).toEqual([]);
  });

  it('provides physical park facilities on real terrain', () => {
    expect(iowaParkLayout(park.road, 1).facilities.length).toBeGreaterThan(0);
  });
});
