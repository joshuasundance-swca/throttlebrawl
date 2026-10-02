// Barriers that read as real places (interview, 2026-10-02: "rails only on bridges and drops; posts
// only on highways"): a drawn rail stands only where a bridge or a drop is, and delineator posts
// line only a highway (four or more drive lanes), not every two-lane road.
import { InstancedMesh } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork } from '../road';
import { createFlatLook } from './look';
import { buildRoadScene, isHighway, type RoadDressing } from './road-mesh';

const look = createFlatLook();

/** How many delineator posts the scene stands. */
function postCount(group: ReturnType<typeof buildRoadScene>['group']): number {
  let n = 0;
  group.traverse((o) => {
    if (o instanceof InstancedMesh && o.name === 'road-posts') n += o.count;
  });
  return n;
}

/** A 400 m road (flat, or climbing), optionally widened to four drive lanes. */
function build(opts: { grade?: number; lanes?: 2 | 4 }) {
  const bundle = fixtureNetwork([
    { id: 'r', lengthM: 400, kappa: 0, ...(opts.grade ? { grade: opts.grade } : {}) },
  ]);
  if (opts.lanes === 4) {
    const road = bundle.roads[0];
    if (!road) throw new Error('no road');
    road.laneSections = [
      {
        s0: 0,
        lanes: [
          { id: 'L0', dCenterM: -8.55, widthM: 1.5, direction: -1, kind: 'shoulder' },
          { id: 'L2', dCenterM: -5.1, widthM: 3.4, direction: -1, kind: 'drive' },
          { id: 'L1', dCenterM: -1.7, widthM: 3.4, direction: -1, kind: 'drive' },
          { id: 'R1', dCenterM: 1.7, widthM: 3.4, direction: 1, kind: 'drive' },
          { id: 'R2', dCenterM: 5.1, widthM: 3.4, direction: 1, kind: 'drive' },
          { id: 'R0', dCenterM: 8.55, widthM: 1.5, direction: 1, kind: 'shoulder' },
        ],
      },
    ];
  }
  return createRoadNetwork(bundle);
}

const rail = { s0: 50, s1: 350, side: 'both', kind: 'rail', heightM: 1 } as const;

describe('drawn rails (interview, 2026-10-02)', () => {
  it('draws no rail on level ground, even where the data asks for one', () => {
    const road = build({});
    const dressing: RoadDressing = { r: { barriers: [rail] } };
    expect(buildRoadScene(road, look, dressing, { roadsideDensity: 0 }).stats.railM).toBe(0);
  });

  it('draws the rail on a bridge, and only along the bridge', () => {
    const road = build({});
    const dressing: RoadDressing = {
      r: { barriers: [rail], tags: [{ s0: 100, s1: 200, side: 'both', tag: 'bridge' }] },
    };
    const railM = buildRoadScene(road, look, dressing, { roadsideDensity: 0 }).stats.railM;
    // 100 m of bridge, a rail on each side (the sampling trims each end by up to 2 m).
    expect(railM).toBeGreaterThan(190);
    expect(railM).toBeLessThanOrEqual(204);
  });

  it('draws the rail where the road stands clear of the ground (a drop)', () => {
    const road = build({ grade: 0.04 }); // 4%: clear of the ground (2.5 m) from s = 62.5 m on
    const dressing: RoadDressing = { r: { barriers: [rail] } };
    const railM = buildRoadScene(road, look, dressing, { roadsideDensity: 0 }).stats.railM;
    // From s about 62.5 to 350 on each side.
    expect(railM).toBeGreaterThan(2 * 280);
    expect(railM).toBeLessThan(2 * 300);
  });
});

describe('delineator posts (interview, 2026-10-02)', () => {
  it('stand along a highway and not along a two-lane road', () => {
    const plain = build({});
    const highway = build({ lanes: 4 });
    expect(plain.edges.some(isHighway)).toBe(false);
    expect(highway.edges.every(isHighway)).toBe(true);
    const opts = { roadsideDensity: 0 };
    expect(postCount(buildRoadScene(plain, look, undefined, opts).group)).toBe(0);
    // Every 25 m, both sides: 16 spots from 0 to 375 per side.
    expect(postCount(buildRoadScene(highway, look, undefined, opts).group)).toBe(32);
  });

  it('can be asked for on every road', () => {
    const plain = build({});
    const n = postCount(
      buildRoadScene(plain, look, undefined, { roadsideDensity: 0, postRoads: () => true }).group,
    );
    expect(n).toBe(32);
  });
});
