// Playtest 3's moves, felt through the chase cam (docs/architecture.md, "Camera"; moves spec §4.4).
// The maintainer: braking into a hairpin should be "a first class experience". In a drift the
// camera slides to the outside of the corner to show the bike's flank, aims a little into the
// corner so the bike stays near the middle of the frame, and rolls on with the slip; on a wheelie
// it pulls back and looks up with the nose. Reduce-motion halves all of it, and every number is a
// slider at 0 to turn it off. Driven frame by frame at a fixed dt, like air-tip.test.ts.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork } from '../road';
import { createFollowCamera, type CameraPose, type CameraTarget } from './index';

const DT = 1 / 60;
const road = createRoadNetwork(fixtureNetwork([{ id: 'a', lengthM: 2000, kappa: 0 }]));

/** The rider at s on the straight, with a slip and a wheelie angle. */
function target(s: number, moves: { drift?: number; wheelie?: number; lean?: number } = {}): CameraTarget {
  const w = road.toWorld(0, s, 0, 0);
  const f = road.frameAt(0, s);
  return {
    id: 0,
    x: w.x,
    y: w.y,
    z: w.z,
    heading: Math.atan2(-f.tx, -f.tz),
    speed: 30,
    lean: moves.lean ?? 0,
    mode: 'Road',
    road: { edge: 0 },
    ...(moves.drift === undefined ? {} : { drift: moves.drift }),
    ...(moves.wheelie === undefined ? {} : { wheelie: moves.wheelie }),
  };
}

interface Settled {
  pose: CameraPose;
  t: CameraTarget;
  /** Metres to the rider's right of the camera's position (positive: camera is left of the rider). */
  camLeftOfRider: number;
  /** Metres the camera sits behind the rider along the road. */
  behind: number;
  /** The horizontal angle from the view axis to the rider, degrees (positive: rider to the right). */
  riderBearingDeg: number;
}

/** Settles a camera on a rider held in one state for two seconds. */
function settled(
  moves: { drift?: number; wheelie?: number; lean?: number },
  opts: { params?: Record<string, number>; shake?: number; view?: number } = {},
): Settled {
  const cam = createFollowCamera({ road });
  for (const [k, v] of Object.entries(opts.params ?? {})) cam.setParam(`camera.${k}`, v);
  if (opts.view !== undefined) cam.setParam('camera.mode', opts.view);
  if (opts.shake !== undefined) cam.setShakeAmount(opts.shake);
  let s = 100;
  let pose: CameraPose = cam.snap(target(s));
  let t = target(s, moves);
  for (let n = 0; n < 120; n++) {
    s += 30 * DT;
    t = target(s, moves);
    pose = cam.update(t, DT);
  }
  const f = road.frameAt(0, s);
  const rx = -f.tz;
  const rz = f.tx;
  const dx = pose.x - t.x;
  const dz = pose.z - t.z;
  const vx = pose.lookX - pose.x;
  const vz = pose.lookZ - pose.z;
  const cross = vx * (t.z - pose.z) - vz * (t.x - pose.x); // view x toward-rider, y-up sign
  const dot = vx * (t.x - pose.x) + vz * (t.z - pose.z);
  return {
    pose,
    t,
    camLeftOfRider: -(dx * rx + dz * rz),
    behind: -(dx * f.tx + dz * f.tz),
    riderBearingDeg: (Math.atan2(cross, dot) * 180) / Math.PI,
  };
}

const SLIP = 0.6; // the drift's full slip (sim/riders/drift.ts, 34 degrees)
const aimUp = (p: CameraPose, t: CameraTarget) => p.lookY - t.y;

describe('a drift: the camera slides outside, aims into the corner and rolls on', () => {
  it('a right drift puts the camera outside (left) of the rider, a left drift the mirror image', () => {
    const none = settled({});
    const right = settled({ drift: SLIP });
    const left = settled({ drift: -SLIP });
    expect(right.camLeftOfRider - none.camLeftOfRider).toBeGreaterThan(0.8);
    expect(left.camLeftOfRider - none.camLeftOfRider).toBeLessThan(-0.8);
    expect(right.camLeftOfRider - none.camLeftOfRider).toBeCloseTo(
      none.camLeftOfRider - left.camLeftOfRider,
      2,
    );
  });

  it('rolls on in the way of the lean, on top of the lean roll', () => {
    const lean = settled({ lean: 0.8 });
    const drift = settled({ drift: SLIP, lean: 0.8 });
    // three.js sense: leaning right is a negative roll.
    expect(drift.pose.roll).toBeLessThan(lean.pose.roll - 0.08);
    const mirror = settled({ drift: -SLIP, lean: -0.8 });
    expect(mirror.pose.roll).toBeCloseTo(-drift.pose.roll, 3);
  });

  it('keeps the bike near the middle of the frame, so the slide reads and the road stays in view', () => {
    const none = settled({});
    for (const side of [1, -1]) {
      const d = settled({ drift: side * SLIP, lean: side * 0.8 });
      console.log(
        `[examined] drift ${side > 0 ? 'right' : 'left'}: the bike sits ${d.riderBearingDeg.toFixed(2)} deg off the view axis (straight: ${none.riderBearingDeg.toFixed(2)})`,
      );
      expect(Math.abs(d.riderBearingDeg)).toBeLessThan(4);
    }
  });

  it('is proportional to the slip: a light drift moves it less, a hard one no further than the cap', () => {
    const none = settled({}).camLeftOfRider;
    const light = settled({ drift: 0.2 }).camLeftOfRider - none;
    const full = settled({ drift: SLIP }).camLeftOfRider - none;
    const over = settled({ drift: 1.2 }).camLeftOfRider - none;
    expect(light).toBeGreaterThan(0.1);
    expect(light).toBeLessThan(full * 0.6);
    expect(over).toBeCloseTo(full, 3);
  });

  it('eases in on the springs: no jump on the first frame of a drift', () => {
    const cam = createFollowCamera({ road });
    let pose = cam.snap(target(100));
    let s = 100;
    for (let n = 0; n < 60; n++) {
      s += 30 * DT;
      pose = cam.update(target(s), DT);
    }
    s += 30 * DT;
    const first = cam.update(target(s, { drift: SLIP, lean: 0.8 }), DT);
    const jump = Math.abs(first.roll - pose.roll);
    expect(jump).toBeLessThan(0.03);
  });

  it('reduce-motion halves the slide and the roll', () => {
    const none = settled({ lean: 0.8 }, { shake: 0 });
    const full = settled({ drift: SLIP, lean: 0.8 }, { shake: 1 });
    const calm = settled({ drift: SLIP, lean: 0.8 }, { shake: 0 });
    const base = settled({ lean: 0.8 }, { shake: 1 });
    const slideFull = full.camLeftOfRider - base.camLeftOfRider;
    const slideCalm = calm.camLeftOfRider - none.camLeftOfRider;
    expect(slideCalm).toBeCloseTo(slideFull / 2, 2);
    const rollFull = full.pose.roll - base.pose.roll;
    const rollCalm = calm.pose.roll - none.pose.roll;
    expect(rollCalm).toBeCloseTo(rollFull / 2, 3);
  });

  it('is off with its sliders at 0, and a rider with no drift field frames exactly as before', () => {
    const off = { driftRoll: 0, driftSideM: 0, driftAimM: 0 };
    const none = settled({ lean: 0.8 });
    const dead = settled({ drift: SLIP, lean: 0.8 }, { params: off });
    expect(dead.pose.x).toBeCloseTo(none.pose.x, 6);
    expect(dead.pose.roll).toBeCloseTo(none.pose.roll, 6);
    expect(dead.pose.lookX).toBeCloseTo(none.pose.lookX, 6);
    const zero = settled({ drift: 0, lean: 0.8 });
    expect(zero.pose.x).toBeCloseTo(none.pose.x, 9);
    expect(zero.pose.z).toBeCloseTo(none.pose.z, 9);
    expect(zero.pose.roll).toBeCloseTo(none.pose.roll, 9);
  });

  it('never hands render a NaN, and the helmet and far views take the roll too', () => {
    for (const view of [0, 1, 2]) {
      const d = settled({ drift: SLIP, lean: 0.8 }, { view });
      for (const v of Object.values(d.pose)) expect(Number.isFinite(v)).toBe(true);
      const l = settled({ lean: 0.8 }, { view });
      expect(d.pose.roll, `view ${view}`).toBeLessThan(l.pose.roll - 0.02);
    }
    const bad = settled({ drift: Number.NaN, wheelie: Number.POSITIVE_INFINITY });
    for (const v of Object.values(bad.pose)) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('a wheelie: the camera pulls back and looks up with the nose', () => {
  it('pulls back, aims higher and widens the view a little', () => {
    const none = settled({});
    const up = settled({ wheelie: 0.7 });
    expect(up.behind - none.behind).toBeGreaterThan(0.7);
    expect(aimUp(up.pose, up.t) - aimUp(none.pose, none.t)).toBeGreaterThan(0.6);
    expect(up.pose.fov - none.pose.fov).toBeGreaterThan(2);
  });

  it('grows with the angle and stops at the sweet centre, so a loop-out does not run the camera away', () => {
    const none = settled({});
    const low = settled({ wheelie: 0.35 });
    const mid = settled({ wheelie: 0.7 });
    const loop = settled({ wheelie: 1.3 });
    expect(low.behind - none.behind).toBeGreaterThan(0.2);
    expect(low.behind).toBeLessThan(mid.behind);
    expect(loop.behind).toBeCloseTo(mid.behind, 3);
    expect(aimUp(loop.pose, loop.t)).toBeCloseTo(aimUp(mid.pose, mid.t), 3);
  });

  it('eases in on the springs and eases back when the front comes down', () => {
    const cam = createFollowCamera({ road });
    let s = 100;
    let pose = cam.snap(target(s));
    for (let n = 0; n < 30; n++) {
      s += 30 * DT;
      pose = cam.update(target(s), DT);
    }
    const start = aimUp(pose, target(s));
    s += 30 * DT;
    const first = cam.update(target(s, { wheelie: 0.7 }), DT);
    expect(aimUp(first, target(s)) - start).toBeLessThan(0.15);
    for (let n = 0; n < 120; n++) {
      s += 30 * DT;
      pose = cam.update(target(s, { wheelie: 0.7 }), DT);
    }
    const high = aimUp(pose, target(s));
    for (let n = 0; n < 150; n++) {
      s += 30 * DT;
      pose = cam.update(target(s), DT);
    }
    expect(high - start).toBeGreaterThan(0.6);
    expect(aimUp(pose, target(s))).toBeCloseTo(start, 1);
  });

  it('reduce-motion halves it, and the sliders at 0 turn it off', () => {
    const none = settled({}, { shake: 0 });
    const full = settled({ wheelie: 0.7 }, { shake: 1 });
    const calm = settled({ wheelie: 0.7 }, { shake: 0 });
    const base = settled({}, { shake: 1 });
    expect(calm.behind - none.behind).toBeCloseTo((full.behind - base.behind) / 2, 2);
    expect(calm.pose.fov - none.pose.fov).toBeCloseTo((full.pose.fov - base.pose.fov) / 2, 2);
    const off = settled({ wheelie: 0.7 }, { params: { wheelieBackM: 0, wheelieAimM: 0, wheelieFovDeg: 0 } });
    expect(off.behind).toBeCloseTo(base.behind, 6);
    expect(aimUp(off.pose, off.t)).toBeCloseTo(aimUp(base.pose, base.t), 6);
    expect(off.pose.fov).toBeCloseTo(base.pose.fov, 6);
  });
});
