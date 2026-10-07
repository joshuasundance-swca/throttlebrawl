import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  fixtureNetwork,
  planStructures,
  type BakedTag,
  type RoadNetwork,
  type StructurePlan,
  type StructureRoof,
  type StructureSpec,
} from '../road';
import { EYE_CLEARANCE_M, insideSolid } from './solids';
import { createFollowCamera, type CameraPose, type CameraTarget } from './index';

// The camera on roofs (the maintainer, 2026-10-06, [decided]: a road race in a physical world with honest edges;
// "consistent physics and gameplay is important here so players know what to expect"). The structures plan is
// data the camera reads (`CameraContext.structures`): beside a planned front the eye is no longer held to the
// sidewalk by the street's tag, so a rider on a roof is not left off-centre in his own view; it is kept out of
// the solids themselves instead (a tower beside a low roof, a wall the helmet leans into); and a crash on a roof
// is framed on the roof, not on the road far below. Every rule has its control: the camera with no plan is the
// camera as it was. A fixture street, its plan made here (road/structures.ts `planStructures`, the test's own
// layer), frame by frame at a fixed dt. tests/sim/camera-roofs.test.ts holds the same on the real streets.

const DT = 1 / 60;
const SEED = 5;
/** The band's outer edge on the right: the fixture's 4.9 m of road and the shopfronts' 4 m sidewalk. */
const EDGE_D = 8.9;

interface Lot {
  rule: string;
  s0: number;
  s1: number;
  d0: number;
  d1: number;
  roof: StructureRoof;
  base?: number;
}
const flat = (topM: number): StructureRoof => ({ kind: 'flat', topM });

/** A one-storey roof (5 m), then a tower (30 m) beside it, then a 60 m gap and a 12 m roof. */
const LOTS: Lot[] = [
  { rule: 'low', s0: 300, s1: 360, d0: EDGE_D, d1: EDGE_D + 14, roof: flat(5) },
  { rule: 'tower', s0: 360, s1: 400, d0: EDGE_D, d1: EDGE_D + 30, roof: flat(30) },
  { rule: 'mid', s0: 460, s1: 520, d0: EDGE_D, d1: EDGE_D + 14, roof: flat(12) },
];

function specOf(road: RoadNetwork, lot: Lot): StructureSpec {
  const s = (lot.s0 + lot.s1) / 2;
  const d = (lot.d0 + lot.d1) / 2;
  const p = road.toWorld(0, s, d, 0);
  const f = road.frameAt(0, s);
  return {
    rule: lot.rule,
    cls: 'building',
    model: null,
    edge: 0,
    s,
    d: lot.d0,
    foot: { x: p.x, z: p.z, ux: f.tx, uz: f.tz, hu: (lot.s1 - lot.s0) / 2, hv: (lot.d1 - lot.d0) / 2 },
    baseY: p.y + (lot.base ?? 0),
    roof: lot.roof,
  };
}

/** The street: a straight road with shopfronts on its right, and its plan. `tag` is what the right side says. */
function street(tag: string, lots: readonly Lot[] = LOTS): { road: RoadNetwork; plan: StructurePlan } {
  const bundle = fixtureNetwork([{ id: 'a', lengthM: 800, kappa: 0 }]);
  const r0 = bundle.roads[0];
  if (!r0) throw new Error('no road');
  const tags: BakedTag[] = [{ s0: 0, s1: 800, side: 'right', tag }];
  const road = createRoadNetwork({ ...bundle, roads: [{ ...r0, tags }] });
  // The plan is asked for by the shopfronts' tag (a planned front); a street of another tag is planned with a
  // layer of its own, so the plan exists beside a front the plan does not hold.
  const plan = planStructures(
    road,
    SEED,
    { fixture: { plan: (r, _seed, out) => lots.forEach((lot) => out.add(specOf(r, lot))) } },
    { fixture: { tags: [tag], load: () => Promise.reject(new Error('planned here')) } },
  );
  return { road, plan };
}

interface Rider {
  s: number;
  d: number;
  /** Height over the road (a roof he rides, a roof he rests on). */
  h?: number;
  dir?: 1 | -1;
  mode?: CameraTarget['mode'];
  lean?: number;
  speed?: number;
}

function riderAt(road: RoadNetwork, r: Rider): CameraTarget {
  const w = road.toWorld(0, r.s, r.d, r.h ?? 0);
  const f = road.frameAt(0, r.s);
  const dir = r.dir ?? 1;
  return {
    id: 0,
    x: w.x,
    y: w.y,
    z: w.z,
    heading: Math.atan2(-f.tx * dir, -f.tz * dir),
    speed: r.speed ?? 12,
    lean: r.lean ?? 0,
    mode: r.mode ?? 'Road',
    road: { edge: 0 },
  };
}

/** Settles a camera on a rider, over 2 s of the same frame: its pose and what it was told. */
function settled(
  road: RoadNetwork,
  plan: StructurePlan | null,
  r: Rider,
  tuning: Record<string, number> = {},
): { pose: CameraPose; t: CameraTarget } {
  const cam = createFollowCamera({ road });
  for (const [k, v] of Object.entries(tuning)) cam.setParam(k, v);
  const t = riderAt(road, r);
  const ctx = plan ? { structures: plan } : undefined;
  let pose = cam.snap(t, ctx);
  for (let n = 0; n < 120; n++) pose = cam.update(t, DT, ctx);
  return { pose, t };
}

/** How far across the road the eye is from the rider, m (positive: toward the road's right). */
const across = (road: RoadNetwork, pose: CameraPose, t: CameraTarget): number =>
  road.project(pose.x, pose.z, 0).d - road.project(t.x, t.z, 0).d;

describe('a rider on a roof beside a planned front: the eye is not pushed off the roof', () => {
  const { road, plan } = street('shopfronts');
  const ride: Rider = { s: 330, d: EDGE_D + 5, h: 5 };

  it('stays beside him, as it does on the road (no sideways push toward the sidewalk)', () => {
    const { pose, t } = settled(road, plan, ride);
    console.log(
      `[examined] the eye is ${across(road, pose, t).toFixed(2)} m across from the rider on a 5 m roof, 5 m past the sidewalk`,
    );
    expect(Math.abs(across(road, pose, t))).toBeLessThan(0.3);
  });

  it('control: with no plan the street’s tag holds it at the sidewalk, 5 m off the rider', () => {
    const { pose, t } = settled(road, null, ride);
    expect(across(road, pose, t)).toBeLessThan(-4);
  });

  it('control: a front the plan does not hold (the row houses) is still kept clear by its tag', () => {
    const row = street('row-houses');
    // A plan exists (the fixture's own layer asks for the row houses' tag) and holds the roofs, but the row houses
    // are not among the fronts the plan's planners place: the street's tag is the rule still.
    const { pose, t } = settled(row.road, row.plan, ride);
    expect(across(row.road, pose, t)).toBeLessThan(-4);
  });

  it('on the sidewalk below the front, the eye stays inside the front line as before', () => {
    const { pose, t } = settled(road, plan, { s: 330, d: EDGE_D - 1 });
    expect(Math.abs(across(road, pose, t))).toBeLessThan(0.3);
    expect(road.project(pose.x, pose.z, 0).d).toBeLessThan(EDGE_D);
  });
});

describe('beside a tower: the eye is never inside it', () => {
  const { road, plan } = street('shopfronts');
  /** Heading back down the street along the low roof, with the tower behind him (the eye sits in front of it). */
  const ride: Rider = { s: 357, d: EDGE_D + 4, h: 5, dir: -1 };
  const inside = (pose: CameraPose): boolean =>
    plan.items.some((st) => insideSolid(st, pose.x, pose.y, pose.z, EYE_CLEARANCE_M));

  it('is pulled in along its arm until it is clear, and he is still in view', () => {
    const { pose, t } = settled(road, plan, ride);
    const gap = Math.hypot(pose.x - t.x, pose.z - t.z);
    console.log(
      `[examined] eye ${gap.toFixed(2)} m from the rider (7 m is the chase distance), inside a solid: ${inside(pose)}`,
    );
    expect(inside(pose)).toBe(false);
    expect(gap).toBeGreaterThan(0.4);
    expect(gap).toBeLessThan(7);
  });

  it('control: with the camera as it was (no plan, no front rule) the same eye is inside the tower', () => {
    const { pose } = settled(road, null, ride, { 'camera.keepClearOfFronts': 0 });
    expect(inside(pose)).toBe(true);
  });

  it('control: the same rider facing the other way (the tower behind the eye’s side is far) is not shortened', () => {
    const { pose, t } = settled(road, plan, { ...ride, s: 330, dir: 1 });
    expect(Math.hypot(pose.x - t.x, pose.z - t.z)).toBeGreaterThan(6.5);
  });

  it('eases out again once the tower is behind him: the eye never jumps more than half a metre a frame', () => {
    const cam = createFollowCamera({ road });
    const ctx = { structures: plan };
    const at = (n: number) => riderAt(road, { ...ride, s: 357 - n * (12 * DT) });
    cam.snap(at(0), ctx);
    for (let n = 0; n < 60; n++) cam.update(at(0), DT, ctx);
    let prev: { x: number; z: number } | null = null;
    let worst = 0;
    // He rides on down the roof away from the tower, 12 m/s toward the road's start.
    for (let n = 1; n <= 180; n++) {
      const t = at(n);
      const pose = cam.update(t, DT, ctx);
      const rel = { x: pose.x - t.x, z: pose.z - t.z };
      if (prev) worst = Math.max(worst, Math.hypot(rel.x - prev.x, rel.z - prev.z));
      prev = rel;
    }
    console.log(
      `[examined] the eye's own movement relative to the rider: at most ${worst.toFixed(3)} m a frame`,
    );
    expect(worst).toBeLessThan(0.5);
  });
});

describe('coming down a pitched roof: the eye is not left under its slope', () => {
  // A steep pitched roof, eave 0.5 m, ridge 14 m, 60 m along the street with its ridge across it at s 330: he rides
  // off the ridge down toward the eave, and the slope behind him, going up, is higher than the eye a chase camera
  // sits at. The roof's height at s is 14 - 13.5 |s - 330| / 30.
  const steep: Lot = {
    rule: 'steep',
    s0: 300,
    s1: 360,
    d0: EDGE_D,
    d1: EDGE_D + 14,
    roof: { kind: 'pitched', eaveM: 0.5, ridgeM: 14, ridge: 'v' },
  };
  const { road, plan } = street('shopfronts', [steep]);
  const topAtS = (s: number): number => 14 - (13.5 * Math.abs(s - 330)) / 30;
  const down: Rider = { s: 345, d: EDGE_D + 4, h: topAtS(345) };
  const under = (pose: CameraPose): boolean =>
    plan.items.some((st) => insideSolid(st, pose.x, pose.y, pose.z, 0));

  it('is lifted out of the slope along its arm: never inside the roof', () => {
    const { pose, t } = settled(road, plan, down);
    console.log(
      `[examined] eye ${Math.hypot(pose.x - t.x, pose.z - t.z).toFixed(2)} m back, inside the roof: ${under(pose)}`,
    );
    expect(under(pose)).toBe(false);
  });

  it('control: as it was (no front rule) the eye is inside the roof behind him', () => {
    const { pose } = settled(road, null, down, { 'camera.keepClearOfFronts': 0 });
    expect(under(pose)).toBe(true);
  });

  it('control: riding up it toward the ridge, the eye behind him is below and in the clear: nothing is cut', () => {
    const climb: Rider = { s: 315, d: EDGE_D + 4, h: topAtS(315), speed: 12 };
    const up = settled(road, plan, climb);
    const none = settled(road, null, climb, { 'camera.keepClearOfFronts': 0 });
    expect(under(none.pose)).toBe(false);
    expect(Math.hypot(up.pose.x - up.t.x, up.pose.z - up.t.z)).toBeCloseTo(
      Math.hypot(none.pose.x - none.t.x, none.pose.z - none.t.z),
      9,
    );
  });
});

describe('a rider thrown under a balcony: the eye comes down under its slab', () => {
  // A balcony's slab over the sidewalk (its underside 4.3 m up, 1.3 m thick, 40 m along), the sidewalk under it open.
  const slab: Lot = {
    rule: 'balcony',
    s0: 300,
    s1: 340,
    d0: EDGE_D - 2.1,
    d1: EDGE_D,
    base: 4.3,
    roof: flat(1.3),
  };
  const { road, plan } = street('shopfronts', [slab]);
  const thrown: Rider = { s: 330, d: EDGE_D - 1, h: 2.8, mode: 'Tumble', speed: 1 };
  const inSlab = (pose: CameraPose): boolean =>
    plan.items.some((st) => insideSolid(st, pose.x, pose.y, pose.z, 0));

  it('is below the slab, not inside it, and the rider is still framed', () => {
    const { pose, t } = settled(road, plan, thrown);
    console.log(`[examined] eye ${(pose.y - t.y).toFixed(2)} m over the rider under a slab 1.5 m over him`);
    expect(inSlab(pose)).toBe(false);
    expect(pose.y).toBeLessThan(4.3 - EYE_CLEARANCE_M + 1e-6);
    // Straight ahead of the view, within the frame.
    const view = Math.hypot(pose.lookX - pose.x, pose.lookY - pose.y, pose.lookZ - pose.z);
    const to = Math.hypot(t.x - pose.x, t.y + 1 - pose.y, t.z - pose.z);
    const dot =
      (pose.lookX - pose.x) * (t.x - pose.x) +
      (pose.lookY - pose.y) * (t.y + 1 - pose.y) +
      (pose.lookZ - pose.z) * (t.z - pose.z);
    expect((Math.acos(dot / (view * to)) * 180) / Math.PI).toBeLessThan(30);
  });

  it('control: as it was (no front rule) the eye sits inside the slab', () => {
    const { pose } = settled(road, null, thrown, { 'camera.keepClearOfFronts': 0 });
    expect(inSlab(pose)).toBe(true);
  });

  it('control: out from under it, in the open, the eye is as high as ever', () => {
    const open = settled(road, plan, { ...thrown, d: 0, h: 0 });
    const none = settled(road, null, { ...thrown, d: 0, h: 0 }, { 'camera.keepClearOfFronts': 0 });
    expect(open.pose.y).toBeCloseTo(none.pose.y, 9);
  });

  it('a body left inside the slab itself has its eye moved out by the shortest way', () => {
    const inside = settled(road, plan, { ...thrown, h: 4.6 });
    expect(inSlab(inside.pose)).toBe(false);
  });
});

describe('the helmet eye keeps the near plane’s distance from a wall', () => {
  const { road, plan } = street('shopfronts');
  // Against the tower's face (the band's edge), the rider's centre 0.4 m from it (his contact box), leaned into it.
  const wall: Rider = { s: 380, d: EDGE_D - 0.4, lean: 0.6, speed: 6 };
  const gapTo = (pose: CameraPose): number => EDGE_D - road.project(pose.x, pose.z, 0).d;

  it('leans out no further than leaves 0.3 m', () => {
    const { pose } = settled(road, plan, wall, { 'camera.mode': 2 });
    console.log(`[examined] helmet eye ${gapTo(pose).toFixed(3)} m from the face`);
    expect(gapTo(pose)).toBeGreaterThanOrEqual(EYE_CLEARANCE_M - 1e-3);
  });

  it('control: with no plan the lean puts it at 0.2 m, inside the near plane', () => {
    const { pose } = settled(road, null, wall, { 'camera.mode': 2 });
    expect(gapTo(pose)).toBeLessThan(EYE_CLEARANCE_M - 0.05);
  });

  it('control: leaned away from the wall, it is as it was', () => {
    const near = settled(road, plan, { ...wall, lean: -0.6 }, { 'camera.mode': 2 });
    const none = settled(road, null, { ...wall, lean: -0.6 }, { 'camera.mode': 2 });
    expect(near.pose.x).toBeCloseTo(none.pose.x, 9);
    expect(near.pose.z).toBeCloseTo(none.pose.z, 9);
  });

  it('on a roof, at its edge, over the drop to the sidewalk: the eye rides a head above the roof as ever', () => {
    const edge: Rider = { s: 330, d: EDGE_D + 0.2, h: 5, lean: 0.6, speed: 8 };
    const { pose, t } = settled(road, plan, edge, { 'camera.mode': 2 });
    expect(pose.y - t.y).toBeGreaterThan(1.4);
    expect(pose.y).toBeGreaterThan(5 + 1.4);
  });
});

describe('a crash on a roof is framed on the roof, not on the road far below', () => {
  const { road, plan } = street('shopfronts');
  // The body at rest on the 12 m roof, mode Tumble; on foot and walking back to the bike the same.
  const down = (mode: CameraTarget['mode'], h = 12.3): Rider => ({
    s: 490,
    d: EDGE_D + 4,
    h,
    mode,
    speed: 1,
  });
  const lookDy = (pose: CameraPose, t: CameraTarget): number => pose.lookY - t.y;

  for (const mode of ['Tumble', 'OnFoot'] as const) {
    it(`${mode}: the aim is level with him, as it is on the road`, () => {
      const ground = settled(road, plan, { s: 490, d: 0, mode, speed: 1 });
      const roof = settled(road, plan, down(mode));
      console.log(
        `[examined] ${mode}: aim ${lookDy(roof.pose, roof.t).toFixed(2)} m over him on a 12 m roof, ${lookDy(ground.pose, ground.t).toFixed(2)} m on the road`,
      );
      expect(lookDy(roof.pose, roof.t)).toBeCloseTo(lookDy(ground.pose, ground.t), 0);
    });
    it(`control: ${mode} with no plan aims at the road 12 m below`, () => {
      const roof = settled(road, null, down(mode));
      expect(lookDy(roof.pose, roof.t)).toBeLessThan(-8);
    });
  }

  it('control: a body flung through the air 8 m over the roof is not framed as if it rested on it', () => {
    const roof = settled(road, plan, down('Tumble', 20));
    expect(lookDy(roof.pose, roof.t)).toBeLessThan(-8);
  });

  it('control: a body at rest on the road is framed as ever, with the plan or without', () => {
    const a = settled(road, plan, { s: 490, d: 0, mode: 'Tumble', speed: 1 });
    const b = settled(road, null, { s: 490, d: 0, mode: 'Tumble', speed: 1 });
    expect(a.pose.lookY).toBeCloseTo(b.pose.lookY, 9);
    expect(a.pose.y).toBeCloseTo(b.pose.y, 9);
  });
});

describe('the plan is optional and the camera without one is the camera as it was', () => {
  const { road, plan } = street('shopfronts');
  it('a road with no structures near gives the same pose with the plan and without', () => {
    const r: Rider = { s: 600, d: 0 };
    const a = settled(road, plan, r);
    const b = settled(road, null, r);
    for (const k of ['x', 'y', 'z', 'lookX', 'lookY', 'lookZ', 'fov', 'roll'] as const)
      expect(a.pose[k], k).toBeCloseTo(b.pose[k], 9);
  });
  it('an empty plan (a network that needs no layer) changes nothing', () => {
    const r: Rider = { s: 330, d: EDGE_D - 1 };
    const empty: StructurePlan = { items: [], cellM: 32, cells: new Map() };
    const a = settled(road, empty, r);
    const b = settled(road, null, r);
    // An empty plan holds no front, so the street's tag is the rule still (nothing is planned beside it).
    expect(a.pose.x).toBeCloseTo(b.pose.x, 9);
  });
});
