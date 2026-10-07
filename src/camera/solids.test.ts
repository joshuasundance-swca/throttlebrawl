import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  fixtureNetwork,
  footContains,
  planStructures,
  topAt,
  type RoadNetwork,
  type StructurePlan,
  type StructureRoof,
  type StructureSpec,
} from '../road';
import {
  armClear,
  escapeSolids,
  eyeHeightShare,
  insideSolid,
  keepInView,
  outsideM,
  pushedClear,
  solidsNear,
  standingOn,
  topNearM,
} from './solids';

// The camera's own footprint arithmetic (src/camera imports only types) held to road/structures.ts's, on every
// kind of roof, and the queries the camera's rules are built from, each with a control.

const SEED = 3;
const road: RoadNetwork = createRoadNetwork(fixtureNetwork([{ id: 'a', lengthM: 600, kappa: 0 }]));

/** A box at (x, z) turned by `yaw`, `hu` by `hv` half sizes, its underside `baseY`, with a roof. */
function spec(
  rule: string,
  x: number,
  z: number,
  yaw: number,
  hu: number,
  hv: number,
  baseY: number,
  roof: StructureRoof,
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

const SPECS: StructureSpec[] = [
  spec('flat', 40, -100, 0, 10, 6, 0, { kind: 'flat', topM: 8 }),
  spec('turned', 70, -100, 0.6, 9, 5, 0, { kind: 'flat', topM: 12 }),
  spec('ridge-u', 110, -100, 0.3, 8, 6, 1, { kind: 'pitched', eaveM: 4, ridgeM: 7, ridge: 'u' }),
  spec('ridge-v', 150, -100, -0.4, 8, 6, 0, { kind: 'pitched', eaveM: 3, ridgeM: 6, ridge: 'v' }),
  spec('deck', 190, -100, 0, 12, 4, 4.5, { kind: 'flat', topM: 1 }),
];

function planOf(): StructurePlan {
  // The plan, made as the app's planners would make it (road/structures.ts `planStructures`, the test's own layer).
  const net = createRoadNetwork(
    (() => {
      const b = fixtureNetwork([{ id: 'a', lengthM: 600, kappa: 0 }]);
      const r0 = b.roads[0];
      if (!r0) throw new Error('no road');
      return {
        ...b,
        roads: [{ ...r0, tags: [{ s0: 0, s1: 600, side: 'right' as const, tag: 'shopfronts' }] }],
      };
    })(),
  );
  return planStructures(
    net,
    SEED,
    { fixture: { plan: (_r, _s, out) => SPECS.forEach((s) => out.add(s)) } },
    { fixture: { tags: ['shopfronts'], load: () => Promise.reject(new Error('planned here')) } },
  );
}

const plan = planOf();
void road;

describe("the camera's footprint arithmetic is the road's", () => {
  it('reads the same top over every roof as road/structures.ts topAt, and the same footprint', () => {
    let checked = 0;
    for (const st of plan.items) {
      const f = st.foot;
      for (let i = 0; i <= 12; i++)
        for (let j = 0; j <= 12; j++) {
          // A grid of points over the footprint's bounds (turned boxes included), on it and off it.
          const x = f.x + (i / 6 - 1) * (f.hu + f.hv);
          const z = f.z + (j / 6 - 1) * (f.hu + f.hv);
          const on = footContains(f, x, z);
          expect(outsideM(st, x, z) === 0, `${st.rule} at ${x},${z}`).toBe(on);
          if (on) {
            expect(topNearM(st, x, z), `${st.rule} top at ${x},${z}`).toBeCloseTo(topAt(st, x, z) ?? NaN, 9);
            checked++;
          }
        }
    }
    console.log(
      `[examined] ${checked} points over ${plan.items.length} roofs of 3 kinds: top and footprint equal`,
    );
    expect(checked).toBeGreaterThan(100);
  });

  it('finds the structures by the plan’s own grid, as the plan does', () => {
    const near = solidsNear(plan, 70, -100, 1).map((s) => s.rule);
    expect(near).toContain('turned');
    expect(solidsNear(plan, 5000, 5000, 5)).toEqual([]);
  });
});

describe('inside a solid, padded', () => {
  const flat = plan.items[0]!;
  it('is inside between the underside and the top, and no wider than the pad', () => {
    expect(insideSolid(flat, 40, 4, -100, 0.3)).toBe(true);
    // 0.2 m off its face is inside the 0.3 m pad; 0.4 m is not.
    expect(insideSolid(flat, 40 + 10 + 0.2, 4, -100, 0.3)).toBe(true);
    expect(insideSolid(flat, 40 + 10 + 0.4, 4, -100, 0.3)).toBe(false);
    // Control: over its roof by more than the pad it is clear.
    expect(insideSolid(flat, 40, 8.2, -100, 0.3)).toBe(true);
    expect(insideSolid(flat, 40, 8.4, -100, 0.3)).toBe(false);
  });
  it('passes under a deck: below its underside is clear', () => {
    const deck = plan.items[4]!;
    expect(insideSolid(deck, 190, 3.0, -100, 0.3)).toBe(false);
    expect(insideSolid(deck, 190, 5.0, -100, 0.3)).toBe(true);
  });
});

describe('the line of sight', () => {
  const tower = plan.items[0]!;
  it('is clear in the open and cut short at a wall', () => {
    const open = armClear(plan, { x: 300, y: 2, z: -100 }, { x: 310, y: 4, z: -100 });
    expect(open).toBe(1);
    // From beside the tower (x 52) back over it, 14 m: the eye would be inside, so the arm is cut short.
    const cut = armClear(plan, { x: 52, y: 1, z: -100 }, { x: 38, y: 3, z: -100 });
    expect(cut).toBeLessThan(0.2);
    // Control: the same arm, 9 m up, goes over the roof (8 m).
    expect(armClear(plan, { x: 52, y: 12, z: -100 }, { x: 38, y: 14, z: -100 })).toBe(1);
    expect(tower.rule).toBe('flat');
  });
  it('is not cut to nothing by the wall the pivot rubs, nor by the roof he rides', () => {
    // 0.4 m from the face (inside the 0.3 pad + 0.2 of body play): the wall is met unpadded.
    const rubbing = armClear(plan, { x: 50.2, y: 1, z: -100 }, { x: 50.2, y: 1, z: -86 });
    expect(rubbing).toBe(1);
    // On the roof: pivot a metre over, the eye 2.6 over, 7 m back along it.
    expect(armClear(plan, { x: 40, y: 9, z: -100 }, { x: 40, y: 10.6, z: -93 })).toBe(1);
  });
});

describe('standing on a top', () => {
  it('finds the roof under a body at rest, and nothing for one flung high over it', () => {
    expect(standingOn(plan, 40, 8.3, -100)).toBeCloseTo(8, 6);
    expect(standingOn(plan, 40, 14, -100)).toBeNull();
    expect(standingOn(plan, 40, 5, -100)).toBeNull();
    expect(standingOn(plan, 300, 0, 0)).toBeNull();
  });
});

describe('pushed clear of a face', () => {
  it('moves an eye 0.2 m off a wall out to 0.3 m, straight away from it, and leaves a clear one', () => {
    const p = pushedClear(plan, 40 + 10 + 0.2, 1.8, -100);
    expect(p?.x).toBeCloseTo(50.3, 6);
    expect(p?.z).toBeCloseTo(-100, 6);
    expect(pushedClear(plan, 40 + 10 + 0.4, 1.8, -100)).toBeNull();
    // Over the roof is clear.
    expect(pushedClear(plan, 50.2, 9, -100)).toBeNull();
  });
});

describe('out of a solid by the shortest way', () => {
  it('a point in the thin slab of a deck goes up or down, not out through its 24 m of length', () => {
    // The deck: 4.5 to 5.5 m, x 178..202. A point 0.2 m under its top comes out over it (0.5 m to go).
    const out = escapeSolids(plan, { x: 190, y: 5.3, z: -100 });
    expect(out.x).toBeCloseTo(190, 9);
    expect(out.y).toBeCloseTo(5.8, 9);
    // One near its underside comes out under it.
    expect(escapeSolids(plan, { x: 190, y: 4.6, z: -100 }).y).toBeCloseTo(4.2, 9);
    // The result is clear of the solid, padded by the near plane's distance less nothing.
    expect(insideSolid(plan.items[4]!, out.x, out.y, out.z, 0)).toBe(false);
  });

  it('a point just inside a wall of a tall building goes out through the wall', () => {
    const out = escapeSolids(plan, { x: 49.9, y: 3, z: -100 });
    expect(out.x).toBeCloseTo(50.3, 9);
    expect(out.y).toBeCloseTo(3, 9);
  });

  it('control: a point in no solid is returned as it is', () => {
    expect(escapeSolids(plan, { x: 300, y: 3, z: -100 })).toEqual({ x: 300, y: 3, z: -100 });
    expect(escapeSolids(plan, { x: 190, y: 3, z: -100 })).toEqual({ x: 190, y: 3, z: -100 });
  });
});

describe('the rider stays in the view', () => {
  const pose = { x: 0, y: 3, z: 0, lookX: 0, lookY: -5, lookZ: -20 };
  const angle = (p: typeof pose, to: { x: number; y: number; z: number }) => {
    const ax = p.lookX - p.x;
    const ay = p.lookY - p.y;
    const az = p.lookZ - p.z;
    const rx = to.x - p.x;
    const ry = to.y - p.y;
    const rz = to.z - p.z;
    return Math.acos((ax * rx + ay * ry + az * rz) / (Math.hypot(ax, ay, az) * Math.hypot(rx, ry, rz)));
  };

  it('turns a view that has him too far off its axis until he is at the limit, keeping the look’s distance', () => {
    // The eye is level with him (3 m), the aim 8 m below: he is 23 degrees above the axis.
    const him = { x: 0, y: 3, z: -8 };
    const before = angle(pose, him);
    const limit = (15 * Math.PI) / 180;
    expect(before).toBeGreaterThan(limit);
    const turned = keepInView(pose, him, limit);
    expect(angle(turned, him)).toBeCloseTo(limit, 2);
    expect(Math.hypot(turned.lookX - pose.x, turned.lookY - pose.y, turned.lookZ - pose.z)).toBeCloseTo(
      Math.hypot(pose.lookX - pose.x, pose.lookY - pose.y, pose.lookZ - pose.z),
      9,
    );
  });

  it('control: a rider within the limit leaves the pose as it is (the same object)', () => {
    const him = { x: 0, y: -2, z: -8 };
    expect(angle(pose, him)).toBeLessThan((15 * Math.PI) / 180);
    expect(keepInView(pose, him, (15 * Math.PI) / 180)).toBe(pose);
  });
});

describe('the eye under a ceiling', () => {
  it('keeps no more of its height than leaves the arm clear: the whole of it in the open, less under a slab', () => {
    // Pivot a metre under the deck's underside (4.5 m), the eye 2.6 m up and 7 m back over it: the arm's top end is
    // in the slab, so the eye comes down to the pivot's height.
    const pivot = { x: 190, y: 3.5, z: -100 };
    const eye = { x: 190, y: 6.1, z: -93 };
    const share = eyeHeightShare(plan, pivot, eye);
    expect(share).toBeLessThan(1);
    expect(armClear(plan, pivot, { ...eye, y: pivot.y + (eye.y - pivot.y) * share })).toBe(1);
    // Control: in the open, all of it.
    expect(eyeHeightShare(plan, { x: 300, y: 3.5, z: -100 }, { x: 300, y: 6.1, z: -93 })).toBe(1);
  });
});
