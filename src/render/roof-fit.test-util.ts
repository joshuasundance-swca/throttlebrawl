// A structures plan for render's tests: a few boxes at world positions, made the way the app's planners make
// one (road/structures.ts `planStructures`, with the test's own layer). Test support only.
import {
  createRoadNetwork,
  fixtureNetwork,
  planStructures,
  type StructurePlan,
  type StructureRoof,
  type StructureSpec,
} from '../road';

let seed = 100;

/** A box on the ground at (x, z), axis u turned `yaw` from +x, `hu` by `hv` half sizes, under `base`, with a roof. */
export function boxAt(
  rule: string,
  x: number,
  z: number,
  yaw: number,
  hu: number,
  hv: number,
  roof: StructureRoof,
  baseY = 0,
): StructureSpec {
  return {
    rule,
    cls: 'building',
    model: null,
    edge: 0,
    s: 0,
    d: 0,
    foot: { x, z, ux: Math.cos(yaw), uz: Math.sin(yaw), hu, hv },
    baseY,
    roof,
  };
}

/** The plan of these boxes (a fresh network and seed each time, so plans never leak between tests). */
export function planOfBoxes(boxes: readonly StructureSpec[]): StructurePlan {
  const bundle = fixtureNetwork([{ id: 'a', lengthM: 400, kappa: 0 }]);
  const r0 = bundle.roads[0];
  if (!r0) throw new Error('no road');
  const road = createRoadNetwork({
    ...bundle,
    roads: [{ ...r0, tags: [{ s0: 0, s1: 400, side: 'right' as const, tag: 'shopfronts' }] }],
  });
  return planStructures(
    road,
    seed++,
    { fixture: { plan: (_r, _s, out) => boxes.forEach((b) => out.add(b)) } },
    { fixture: { tags: ['shopfronts'], load: () => Promise.reject(new Error('planned here')) } },
  );
}
