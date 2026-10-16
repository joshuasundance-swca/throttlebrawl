import { Mesh, Raycaster, Vector3, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { courseAt, COURSE_STEP_M, createRoadNetwork, fixtureNetwork, planStructures } from '../../road';
import { createFlatLook } from '../look';
import { buildRoadScene } from '../road-mesh';
import { ridableBandPast } from '../scenery';
import type { ScenesFile } from './data';
import { placeScenes } from './place';

function fixture(tag: string, kappa = 0.0004, tropical = false) {
  const bundle = fixtureNetwork([{ id: 'r', lengthM: 1200, kappa, grade: 0.015 }]);
  const tags = [{ s0: 0, s1: 1200, side: 'both' as const, tag }];
  if (tropical) tags.push({ s0: 0, s1: 1200, side: 'both', tag: 'palms' });
  bundle.roads[0]!.tags = tags;
  const road = createRoadNetwork(bundle);
  const built = buildRoadScene(road, createFlatLook(), { r: { tags, barriers: [] } }, { seed: 7 });
  const file: ScenesFile = {
    formatVersion: 1,
    region: 'fixture',
    everyM: 250,
    scenes: [
      {
        id: 'stand',
        status: 'live',
        on: [tag],
        acrossM: [12, 18],
        radiusM: 5,
        sign: { text: 'OPEN', at: [0, 2, 0], size: [2, 1], bg: '#ffffff', fg: '#000000' },
        parts: [{ box: [4, 2, 3], at: [0, 1, 0], colour: '#aabbcc' }],
      },
    ],
  };
  const input = {
    road,
    seed: 7,
    file,
    spots: built.spots,
    landReach: (edge: number, side: -1 | 1, s: number) => built.landReach(edge, side, s),
  };
  return { road, built, input };
}

describe('rural render-only scenes beyond recoverable grass', () => {
  it('retains a real vignette on existing flat ground, with its full footprint outside the course', () => {
    const { road, built, input } = fixture('rural');
    try {
      const placed = placeScenes(input);
      expect(placed.length).toBeGreaterThan(0);
      expect(placeScenes(input)).toEqual(placed);
      built.update(0, 0, 0, 1e9, 1e9, Infinity);
      built.group.updateMatrixWorld(true);
      const ground: Object3D[] = [];
      built.group.traverse((o) => {
        if (o instanceof Mesh && o.name === 'road-land') ground.push(o);
      });
      expect(ground.length).toBeGreaterThan(0);
      const plan = planStructures(road, 7, {}, {});
      for (const p of placed) {
        const edge = road.edges[p.edge]!;
        const outer = (p.side < 0 ? -edge.dMin : edge.dMax) + 0.6;
        expect(Math.abs(p.d) - outer - p.def.radiusM).toBeGreaterThanOrEqual(
          ridableBandPast(road, p.edge, p.side, p.s, outer),
        );
        for (const ds of [-p.def.radiusM, 0, p.def.radiusM])
          for (const dd of [-p.def.radiusM, 0, p.def.radiusM])
            expect(
              courseAt(road, plan, { edge: p.edge, s: p.s + ds, d: p.d + dd }, p.y + COURSE_STEP_M).kind,
            ).toBe('out');
        // World-space circle contains the authored boxes at every scene rotation.
        for (let i = -1; i < 16; i++) {
          const r = i < 0 ? 0 : p.def.radiusM;
          const x = p.x + Math.cos((i * Math.PI) / 8) * r;
          const z = p.z + Math.sin((i * Math.PI) / 8) * r;
          const hit = new Raycaster(new Vector3(x, p.y + 50, z), new Vector3(0, -1, 0)).intersectObjects(
            ground,
            false,
          )[0];
          expect(hit, 'rendered ground across the full scene footprint').toBeDefined();
          expect(hit!.point.y).toBeCloseTo(p.y, 2);
        }
      }
    } finally {
      built.dispose();
    }
  });

  it('retains near-strip placement for other cohorts and never gives them a far-ground fallback', () => {
    for (const tag of ['forest', 'palms']) {
      const { built, input } = fixture(tag);
      try {
        expect(placeScenes(input).length, `${tag}: unchanged near placement`).toBeGreaterThan(0);
        const distant = {
          ...input.file,
          scenes: input.file.scenes.map((s) => ({ ...s, acrossM: [100, 100] as const })),
        };
        expect(placeScenes({ ...input, file: distant }), `${tag}: no fallback`).toEqual([]);
      } finally {
        built.dispose();
      }
    }
  });

  it('omits a rural vignette when a mixed tropical network has no far-flat terrain', () => {
    const { built, input } = fixture('rural', 0.0004, true);
    try {
      expect(placeScenes(input)).toEqual([]);
    } finally {
      built.dispose();
    }
  });
});
