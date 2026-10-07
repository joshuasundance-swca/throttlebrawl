// Air that pays (the pitch deck's #13, run W-T): "Over a crest the camera tips forward". In the air
// the chase camera aims lower and rises a little, eased on its springs, so the landing shows; on the
// ground nothing changes, and the sliders at 0 turn it off. Driven frame by frame at a fixed dt.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork } from '../road';
import { createFollowCamera, type CameraPose, type CameraTarget } from './index';

const DT = 1 / 60;
const road = createRoadNetwork(fixtureNetwork([{ id: 'a', lengthM: 1000, kappa: 0 }]));

/** The rider at s on the straight, `h` m over the road, riding or in the air. */
function target(s: number, h: number, mode: 'Road' | 'Airborne'): CameraTarget {
  const w = road.toWorld(0, s, 0, h);
  const f = road.frameAt(0, s);
  return {
    id: 0,
    x: w.x,
    y: w.y,
    z: w.z,
    heading: Math.atan2(-f.tx, -f.tz),
    speed: 30,
    lean: 0,
    mode,
    road: { edge: 0 },
  };
}

/** Settles the camera on a rider held `h` m up for two seconds; returns the last pose and target. */
function settled(h: number, mode: 'Road' | 'Airborne', params: Record<string, number> = {}) {
  const cam = createFollowCamera({ road });
  for (const [k, v] of Object.entries(params)) cam.setParam(`camera.${k}`, v);
  let s = 100;
  let t = target(s, h, mode);
  let pose: CameraPose = cam.snap(target(s, 0, 'Road'));
  for (let n = 0; n < 120; n++) {
    s += 30 * DT;
    t = target(s, h, mode);
    pose = cam.update(t, DT);
  }
  return { pose, t };
}

/** How far the view points down, radians (positive: looking down). */
const pitchDown = (p: CameraPose) => Math.atan2(p.y - p.lookY, Math.hypot(p.lookX - p.x, p.lookZ - p.z));

describe('air that pays: the camera tips forward in the air', () => {
  it('in the air it looks further down and sits a little higher over the bike', () => {
    const ground = settled(0, 'Road');
    const air = settled(3, 'Airborne');
    expect(pitchDown(air.pose)).toBeGreaterThan(pitchDown(ground.pose) + 0.05);
    expect(air.pose.y - air.t.y).toBeGreaterThan(ground.pose.y - ground.t.y + 0.5);
  });

  it('a low hop tips it only part way', () => {
    const ground = pitchDown(settled(0, 'Road').pose);
    const low = pitchDown(settled(0.5, 'Airborne').pose);
    const high = pitchDown(settled(3, 'Airborne').pose);
    expect(low).toBeGreaterThan(ground);
    expect(low).toBeLessThan(high);
  });

  it('eases in on the springs: no jump in the aim on the first frame in the air', () => {
    const cam = createFollowCamera({ road });
    let pose = cam.snap(target(100, 0, 'Road'));
    for (let n = 0; n < 60; n++) pose = cam.update(target(100 + n * 0.5, 0, 'Road'), DT);
    const first = cam.update(target(130.5, 0.05, 'Airborne'), DT);
    expect(Math.abs(first.lookY - pose.lookY)).toBeLessThan(0.2);
  });

  it('is off with its sliders at 0', () => {
    const off = { airTipM: 0, airLiftM: 0 };
    // The aim stays on the road ahead (a flat road: the same absolute height as riding it) and the camera
    // sits as high over the bike as ever. (A rider riding a roof 3 m up is not this: the aim rides up
    // with him, tests high-riders.)
    const ground = settled(0, 'Road', off);
    const air = settled(3, 'Airborne', off);
    expect(air.pose.lookY).toBeCloseTo(ground.pose.lookY, 3);
    expect(air.pose.y - air.t.y).toBeCloseTo(ground.pose.y - ground.t.y, 6);
    // And the sliders do something: on, the same flight tips (above).
    const on = settled(3, 'Airborne');
    expect(pitchDown(on.pose)).toBeGreaterThan(pitchDown(air.pose) + 0.05);
  });
});
