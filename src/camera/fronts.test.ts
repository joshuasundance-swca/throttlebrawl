import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  fixtureNetwork,
  LAND_TAGS,
  type BakedTag,
  type RoadNetwork,
  type RoadPos,
} from '../road';
import { CAMERA_TUNING, createFollowCamera, type CameraTarget, type FollowCamera } from './index';
import { createFrontKeeper, FRONT_TAGS, frontLimitM, OLDTOWN_FACADE_M, type FrontParams } from './fronts';

// The camera keeps clear of the building fronts (the solid-world check, punch item 2: "the camera ends up
// inside buildings after a Duval sidewalk crash"). The rule is on the road's own data: a side whose land
// theme is a street and which has a sidewalk (a verge band) holds the camera `frontMarginM` inside the
// sidewalk's outer edge, and on Old Town's Duval Street further in by the reach of its balconies and bars.
// The unit tests here are the rule on a fixture road; tests/sim/camera-fronts.test.ts holds it to the
// fronts the render layers draw, on the real streets.

const DT = 1 / 60;
const DEFAULT = (id: string): number => {
  const d = CAMERA_TUNING.find((p) => p.id === id);
  if (!d) throw new Error(`no tuning declaration ${id}`);
  return d.default;
};
const PARAMS: FrontParams = {
  keepClearOfFronts: DEFAULT('camera.keepClearOfFronts'),
  frontMarginM: DEFAULT('camera.frontMarginM'),
  frontReachM: DEFAULT('camera.frontReachM'),
};

/** A straight road, 600 m, both sides tagged as given (a theme's tag, or none). */
function street(tag: string | null): RoadNetwork {
  const bundle = fixtureNetwork([{ id: 'a', lengthM: 600, kappa: 0 }]);
  for (const road of bundle.roads) {
    const tags: BakedTag[] = tag ? [{ s0: 0, s1: road.lengthM, side: 'both', tag }] : [];
    road.tags = tags;
  }
  return createRoadNetwork(bundle);
}

function riderAt(road: RoadNetwork, pos: RoadPos, speed: number, mode?: CameraTarget['mode']): CameraTarget {
  const w = road.toWorld(pos.edge, pos.s, pos.d, 0);
  const f = road.frameAt(pos.edge, pos.s);
  return {
    id: 0,
    x: w.x,
    y: w.y,
    z: w.z,
    heading: Math.atan2(-f.tx * pos.dir, -f.tz * pos.dir),
    speed,
    lean: 0,
    mode,
    road: pos,
  };
}

/** The camera's distance from the centre line (the road is straight and runs along z, so |x| is it). */
const across = (road: RoadNetwork, p: { x: number; z: number }): number => Math.abs(road.project(p.x, p.z).d);

function settled(
  road: RoadNetwork,
  d: number,
  tuning: Record<string, number> = {},
  view?: 'helmet',
): { cam: FollowCamera; t: CameraTarget; pose: ReturnType<FollowCamera['snap']> } {
  const cam = createFollowCamera({ road });
  if (view) cam.setView(view);
  for (const [k, v] of Object.entries(tuning)) cam.setParam(k, v);
  const t = riderAt(road, { edge: 0, s: 300, d, dir: 1 }, 6);
  let pose = cam.snap(t);
  for (let n = 0; n < 120; n++) pose = cam.update(t, DT);
  return { cam, t, pose };
}

/** The land themes whose side of a road is a street front (road/themes.ts), the camera's list kept to. */
const STREET_THEMES = [
  'oldtown',
  'downtown',
  'plaza',
  'blocks',
  'mission',
  'lanterns',
  'cafes',
  'urban',
  'crossing',
];

describe('the front rule on the road data', () => {
  it("names the tags of the street themes and no others, as the land themes name them (road/themes.ts's LAND_TAGS)", () => {
    const streetTags = Object.entries(LAND_TAGS)
      .filter(([, theme]) => STREET_THEMES.includes(theme))
      .map(([tag]) => tag)
      .sort();
    expect(Object.keys(FRONT_TAGS).sort()).toEqual(streetTags);
    for (const [tag, theme] of Object.entries(FRONT_TAGS)) expect(LAND_TAGS[tag], tag).toBe(theme);
    // The control: the check can fail. A tag of a non-street theme is not in the list.
    expect(Object.keys(FRONT_TAGS)).not.toContain('palms');
    expect(streetTags.length).toBeGreaterThan(10);
  });

  it('declares the switch, the margin and the reach as camera tuning that never affects the sim', () => {
    for (const id of ['camera.keepClearOfFronts', 'camera.frontMarginM', 'camera.frontReachM']) {
      const p = CAMERA_TUNING.find((d) => d.id === id);
      expect(p, id).toBeDefined();
      expect(p?.affectsSim).toBe(false);
    }
  });

  it("holds the eye a margin inside a sidewalk's outer edge on a street, and further in by the reach on Old Town's", () => {
    const old = street('key-oldtown');
    const down = street('towers');
    for (const side of ['left', 'right'] as const) {
      const vo = old.vergeAt(0, 300, side);
      const vd = down.vergeAt(0, 300, side);
      expect(vo.widthM, 'Old Town has a sidewalk').toBeGreaterThan(0);
      expect(vd.widthM, 'downtown has a sidewalk').toBeGreaterThan(0);
      const lo = frontLimitM(old, 0, 300, side, PARAMS);
      const ld = frontLimitM(down, 0, 300, side, PARAMS);
      expect(ld).toBeCloseTo(Math.abs(vd.dOuter) - PARAMS.frontMarginM, 9);
      expect(lo).toBeCloseTo(
        Math.abs(vo.dOuter) - (PARAMS.frontReachM - OLDTOWN_FACADE_M) - PARAMS.frontMarginM,
        9,
      );
      // Never inside the road: the limit is at least the lanes' outer edge.
      expect(lo).toBeGreaterThanOrEqual(Math.abs(vo.dInner));
    }
  });

  it('has no front on a road that is not a street, or where there is no sidewalk', () => {
    // Controls: the same fixture with a palm road's tag, and with no tags at all.
    expect(frontLimitM(street('palms'), 0, 300, 'right', PARAMS)).toBeNull();
    expect(frontLimitM(street(null), 0, 300, 'right', PARAMS)).toBeNull();
    // A street whose side is a bridge (no band) has none either.
    const bridge = fixtureNetwork([{ id: 'a', lengthM: 600, kappa: 0 }]);
    for (const road of bridge.roads) {
      road.tags = [{ s0: 0, s1: road.lengthM, side: 'both', tag: 'towers' }];
      road.barriers = [{ s0: 0, s1: road.lengthM, side: 'both', kind: 'rail', heightM: 1 }];
    }
    const net = createRoadNetwork(bridge);
    expect(net.vergeAt(0, 300, 'right').widthM).toBe(0);
    expect(frontLimitM(net, 0, 300, 'right', PARAMS)).toBeNull();
  });
});

describe('the chase camera on a street', () => {
  it("swings to the open side: a rider at the back of Old Town's sidewalk, the eye never past the limit", () => {
    const road = street('key-oldtown');
    const limit = frontLimitM(road, 0, 300, 'right', PARAMS) as number;
    const back = Math.abs(road.vergeAt(0, 300, 'right').dOuter) - 0.5;
    const on = settled(road, back);
    const off = settled(road, back, { 'camera.keepClearOfFronts': 0 });
    // The control: the rig alone sits over the balcony, past the limit; with the rule it is at it.
    expect(across(road, off.pose)).toBeGreaterThan(limit + 1);
    expect(across(road, on.pose)).toBeLessThanOrEqual(limit + 1e-6);
    // The aim stays where it was: the rider's lane, down the road.
    expect(on.pose.lookX).toBeCloseTo(off.pose.lookX, 9);
    expect(on.pose.lookZ).toBeCloseTo(off.pose.lookZ, 9);
    expect(on.pose.y).toBeCloseTo(off.pose.y, 9);
  });

  it('leaves a rider on the road alone, and a palm road alone', () => {
    const oldtown = street('key-oldtown');
    const onRoad = settled(oldtown, 1);
    const offRoad = settled(oldtown, 1, { 'camera.keepClearOfFronts': 0 });
    expect(onRoad.pose.x).toBeCloseTo(offRoad.pose.x, 9);
    expect(onRoad.pose.z).toBeCloseTo(offRoad.pose.z, 9);
    const palms = street('palms');
    const a = settled(palms, 7);
    const b = settled(palms, 7, { 'camera.keepClearOfFronts': 0 });
    expect(a.pose.x).toBeCloseTo(b.pose.x, 9);
  });

  it('keeps the eye clear in every frame of a rider thrown to the back of the sidewalk, and eases back out', () => {
    const road = street('towers');
    const outer = Math.abs(road.vergeAt(0, 300, 'right').dOuter);
    const limit = frontLimitM(road, 0, 300, 'right', PARAMS) as number;
    const cam = createFollowCamera({ road });
    let t = riderAt(road, { edge: 0, s: 300, d: 2, dir: 1 }, 18);
    let pose = cam.snap(t);
    let worst = 0;
    let prevAcross = across(road, pose);
    let biggestStep = 0;
    // Thrown across the sidewalk to its outer edge in 40 frames (tumbling), lying there, then walked back.
    for (let n = 0; n < 400; n++) {
      const d =
        n < 40
          ? 2 + ((outer - 0.1 - 2) * n) / 40
          : n < 200
            ? outer - 0.1
            : Math.max(2, outer - 0.1 - (n - 200) * 0.1);
      t = riderAt(
        road,
        { edge: 0, s: 300 + Math.min(n, 40) * 0.1, d, dir: 1 },
        1,
        n < 200 ? 'Tumble' : 'Road',
      );
      pose = cam.update(t, DT);
      const a = across(road, pose);
      worst = Math.max(worst, a - limit);
      biggestStep = Math.max(biggestStep, Math.abs(a - prevAcross));
      prevAcross = a;
    }
    expect(worst, 'how far past the limit the eye got').toBeLessThanOrEqual(1e-6);
    // No frame jumps the camera more than the rider's own move plus the ease: a snap back would be metres.
    expect(biggestStep).toBeLessThan(0.5);
  });

  it('the push is a cut on a snap and never more than the distance to the centre line', () => {
    const road = street('key-oldtown');
    const cam = createFollowCamera({ road });
    const t = riderAt(road, { edge: 0, s: 300, d: 8.5, dir: 1 }, 5);
    const pose = cam.snap(t);
    expect(across(road, pose)).toBeLessThanOrEqual(
      (frontLimitM(road, 0, 300, 'right', PARAMS) as number) + 1e-6,
    );
  });

  it("does not move the helmet eye (it rides in the rider's head), but moves the view off the bike", () => {
    const road = street('key-oldtown');
    const back = Math.abs(road.vergeAt(0, 300, 'right').dOuter) - 0.5;
    const on = settled(road, back, {}, 'helmet');
    const off = settled(road, back, { 'camera.keepClearOfFronts': 0 }, 'helmet');
    expect(on.pose.x).toBeCloseTo(off.pose.x, 9);
    expect(on.pose.z).toBeCloseTo(off.pose.z, 9);
  });
});

describe('the keeper', () => {
  it('does nothing without a road, and with the switch off', () => {
    const pose = {
      x: 9,
      y: 3,
      z: -5,
      lookX: 0,
      lookY: 0,
      lookZ: -20,
      fov: 60,
      roll: 0,
      upX: 0,
      upY: 1,
      upZ: 0,
    };
    expect(createFrontKeeper(() => null, PARAMS).apply(pose, DT, undefined)).toBe(pose);
    const road = street('key-oldtown');
    const off = createFrontKeeper(() => road, { ...PARAMS, keepClearOfFronts: 0 });
    expect(off.apply(pose, DT, undefined)).toBe(pose);
  });
});
