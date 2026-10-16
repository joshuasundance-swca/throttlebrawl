import { Mesh, Raycaster, Vector3, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import {
  courseAt,
  createRoadNetwork,
  deriveVerge,
  fixtureNetwork,
  planStreetFurniture,
  planStructures,
  type BakedTag,
} from '../road';
import { deciduousGeometry } from './deciduous';
import { createFlatLook } from './look';
import { buildRoadScene } from './road-mesh';
import { isTropical, themeAt } from './scenery';

const LENGTH = 1200;
const rural: readonly BakedTag[] = [{ s0: 0, s1: LENGTH, side: 'both', tag: 'rural' }];

function ruralRoad(tags = rural) {
  const bundle = fixtureNetwork([{ id: 'r', lengthM: LENGTH, kappa: 0.0004, grade: 0.015 }]);
  bundle.roads[0]!.tags = tags;
  return createRoadNetwork(bundle);
}

function scene(tags = rural, seed = 7) {
  return buildRoadScene(ruralRoad(tags), createFlatLook(), { r: { tags, barriers: [] } }, { seed });
}

describe('opt-in temperate rural roadside', () => {
  it('selects rural ground with a soft grass band, preserves water priority and the omitted-tag default', () => {
    const tags: readonly BakedTag[] = [...rural, { s0: 200, s1: 300, side: 'left', tag: 'water-open' }];
    expect(themeAt(tags, 'right', 250)).toBe('rural');
    expect(themeAt(tags, 'left', 250)).toBe('water');
    expect(deriveVerge({ tags }, 'right', 250)).toMatchObject({ surface: 'grass', edge: 'soft' });
    expect(isTropical([rural])).toBe(false);
    expect(themeAt(undefined, 'right', 250)).toBe('palms');
    expect(isTropical([undefined])).toBe(true);
    const overFallback: readonly BakedTag[] = [...rural, { s0: 0, s1: LENGTH, side: 'both', tag: 'palms' }];
    expect(themeAt(overFallback, 'right', 250)).toBe('rural');
    expect(deriveVerge({ tags: overFallback }, 'right', 250)).toMatchObject({
      surface: 'grass',
      edge: 'soft',
    });
  });

  it('has a visible trunk under a broad rounded crown, with its roots at the geometry origin', () => {
    const tree = deciduousGeometry();
    try {
      tree.computeBoundingBox();
      const box = tree.boundingBox!;
      expect(box.min.y).toBeCloseTo(0, 6);
      expect(box.max.x - box.min.x).toBeGreaterThan((box.max.y - box.min.y) * 0.6);
      const position = tree.getAttribute('position');
      let trunkWidth = 0;
      let crownWidth = 0;
      for (let i = 0; i < position.count; i++) {
        const width = Math.hypot(position.getX(i), position.getZ(i));
        if (position.getY(i) < 2) trunkWidth = Math.max(trunkWidth, width);
        if (position.getY(i) > 4) crownWidth = Math.max(crownWidth, width);
      }
      expect(trunkWidth).toBeGreaterThan(0);
      expect(crownWidth).toBeGreaterThan(trunkWidth * 5);
      expect(tree.getAttribute('color').count).toBe(position.count);
    } finally {
      tree.dispose();
    }
  });

  it('draws sparse deciduous copses, keeps open stretches and never substitutes tropical or coastal trees or firs', () => {
    const built = scene();
    const control = scene([]);
    try {
      const trees = built.spots.filter((s) => s.kind === 'deciduous');
      expect(trees.length).toBeGreaterThan(0);
      expect(built.spots.every((s) => s.kind === 'deciduous')).toBe(true);
      expect(control.spots.some((s) => s.kind === 'palm')).toBe(true);
      expect(control.spots.some((s) => s.kind === 'deciduous')).toBe(false);
      const along = trees
        .filter((s) => s.d > 0)
        .map((s) => s.s)
        .sort((a, b) => a - b);
      const gaps = along.slice(1).map((s, i) => s - along[i]!);
      console.log(`[examined] rural: ${trees.length} trees, ${gaps.filter((g) => g > 40).length} open gaps`);
      expect(
        gaps.some((g) => g < 10),
        'trees grouped into copses',
      ).toBe(true);
      expect(
        gaps.some((g) => g > 40),
        'open ground between copses',
      ).toBe(true);
      expect(built.stats.sceneryModels).not.toContain('deciduous');
    } finally {
      built.dispose();
      control.dispose();
    }
  });

  it('keeps a copse inside its rural span and off a water-tagged side', () => {
    const tags: readonly BakedTag[] = [
      { s0: 100, s1: 950, side: 'both', tag: 'rural' },
      { s0: 0, s1: LENGTH, side: 'left', tag: 'water-open' },
    ];
    const built = scene(tags);
    try {
      const trees = built.spots.filter((s) => s.kind === 'deciduous');
      expect(trees.length).toBeGreaterThan(0);
      for (const tree of trees) {
        expect(tree.d).toBeGreaterThan(0);
        expect(tree.s).toBeGreaterThanOrEqual(100);
        expect(tree.s).toBeLessThanOrEqual(950);
      }
    } finally {
      built.dispose();
    }
  });

  it('repeats the same scene for the same seed and roots the rendered trees in actual land on a graded bend', () => {
    const built = scene();
    const repeat = scene();
    const changed = scene(rural, 11);
    try {
      expect(built.spots).toEqual(repeat.spots);
      expect(built.spots).not.toEqual(changed.spots);
      const trees = built.spots.filter((s) => s.kind === 'deciduous');
      expect(trees.length).toBeGreaterThan(0);
      built.update(0, 0, 0, 1e9, 1e9, Infinity);
      const ground: Object3D[] = [];
      const scenery: Object3D[] = [];
      built.group.updateMatrixWorld(true);
      built.group.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        if (o.name === 'road-land') ground.push(o);
        if (o.name === 'road-scenery') scenery.push(o);
      });
      expect(ground.length).toBeGreaterThan(0);
      expect(scenery.length).toBeGreaterThan(0);
      for (const tree of trees) {
        const ray = new Raycaster(new Vector3(tree.p.x, tree.p.y + 25, tree.p.z), new Vector3(0, -1, 0));
        const land = ray.intersectObjects(ground, false)[0];
        expect(land, 'drawn land under each trunk').toBeDefined();
        expect(land!.point.y).toBeCloseTo(tree.p.y, 2);
        const crown = ray.intersectObjects(scenery, false)[0];
        expect(crown, 'a real tree mesh above each anchor').toBeDefined();
        expect(crown!.point.y - tree.p.y).toBeGreaterThan(4);
      }
    } finally {
      built.dispose();
      repeat.dispose();
      changed.dispose();
    }
  });

  it('places every trunk beyond the playable verge, with open course beside it and no invisible furniture', () => {
    const road = ruralRoad();
    const plan = planStructures(road, 7, {}, {});
    const built = scene();
    try {
      const trees = built.spots.filter((s) => s.kind === 'deciduous');
      expect(trees.length).toBeGreaterThan(0);
      expect(planStreetFurniture(road, 7).items).toEqual([]);
      for (const tree of trees) {
        const side = tree.d < 0 ? 'left' : 'right';
        const band = road.vergeAt(tree.edge, tree.s, side);
        const sign = Math.sign(tree.d);
        const nearestTrunk = tree.d - sign * 0.5 * tree.size;
        expect(Math.abs(nearestTrunk)).toBeGreaterThan(Math.abs(band.dOuter));
        const feet = road.surfaceHeight(tree.edge, tree.s, tree.d) + 1;
        expect(courseAt(road, plan, { edge: tree.edge, s: tree.s, d: nearestTrunk }, feet).kind).toBe('out');
        // Positive control: the same query recognises the grass band as playable road.
        const inside = band.dOuter - sign * 0.5;
        expect(courseAt(road, plan, { edge: tree.edge, s: tree.s, d: inside }, feet).kind).toBe('road');
      }
    } finally {
      built.dispose();
    }
  });
});
