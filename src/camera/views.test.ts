// camera-3 (docs/milestones/M3.md, "Far-chase and helmet cameras"): the far chase cam and the
// helmet (first-person) cam next to the low chase cam, switchable by the `camera.mode` tuning
// slider and a key (bindViewKey; app/ wires it to the window). Acceptance: each mode settles
// without overshoot and never reads anything but snapshot and road data (boundaries.test.ts pins
// the second for every file in this folder). The helmet cam softens roll and the FOV kick under
// the reduce-shake setting. The 125 m oncoming-car sight check for the new views is in
// reaction-range.test.ts.
import { Euler, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork, type RoadNetwork } from '../road';
import type { SimEvent } from '../sim/api';
import {
  bindViewKey,
  CAMERA_TUNING,
  CAMERA_VIEW_KEY,
  createFollowCamera,
  VIEW_MODES,
  type CameraPose,
  type CameraTarget,
  type FollowCamera,
} from './index';

const DT = 1 / 60;
const ME = 4;
const VICTIM = 7;
const def = (key: string): number => {
  const d = CAMERA_TUNING.find((p) => p.id === `camera.${key}`);
  if (!d) throw new Error(`no tuning declaration camera.${key}`);
  return d.default;
};

function straightRoad(): RoadNetwork {
  return createRoadNetwork(fixtureNetwork([{ id: 'a', lengthM: 1000, kappa: 0 }]));
}

function riderOn(road: RoadNetwork, s: number, d: number, extra: Partial<CameraTarget> = {}): CameraTarget {
  const w = road.toWorld(0, s, d, 0);
  const f = road.frameAt(0, s);
  return {
    id: ME,
    x: w.x,
    y: w.y,
    z: w.z,
    heading: Math.atan2(-f.tx, -f.tz),
    speed: 30,
    lean: 0,
    road: { edge: 0 },
    mode: 'Road',
    ...extra,
  };
}

/** Horizontal distance from the camera back to the rider along the rider's heading (negative: ahead). */
function behind(pose: CameraPose, t: CameraTarget): number {
  const fx = -Math.sin(t.heading);
  const fz = -Math.cos(t.heading);
  return -((pose.x - t.x) * fx + (pose.z - t.z) * fz);
}

function camOn(view: number | null, road: RoadNetwork = straightRoad()): FollowCamera {
  const cam = createFollowCamera({ road });
  cam.setShakeAmount(0);
  if (view !== null) cam.setParam('camera.mode', view);
  return cam;
}

/**
 * The 8 corners of the player's own helmet, placed exactly as render/views.ts and render/index.ts
 * place it: the box 0.3 x 0.3 x 0.32 m at (0, 1.1 + 0.66, -0.08) in the model, and the visor
 * 0.26 x 0.1 x 0.03 m at (0, 1.1 + 0.68, -0.24), turned by Euler(0, heading, -lean).
 */
function ownHelmet(t: CameraTarget): Vector3[] {
  const m = new Matrix4().makeRotationFromEuler(new Euler(0, t.heading, -(t.lean ?? 0)));
  const out: Vector3[] = [];
  const boxes = [
    { size: [0.3, 0.3, 0.32], at: [0, 1.76, -0.08] },
    { size: [0.26, 0.1, 0.03], at: [0, 1.78, -0.24] },
  ];
  for (const b of boxes)
    for (const a of [-0.5, 0.5])
      for (const c of [-0.5, 0.5])
        for (const e of [-0.5, 0.5]) {
          const p = new Vector3(
            (b.at[0] ?? 0) + a * (b.size[0] ?? 0),
            (b.at[1] ?? 0) + c * (b.size[1] ?? 0),
            (b.at[2] ?? 0) + e * (b.size[2] ?? 0),
          ).applyMatrix4(m);
          out.push(p.add(new Vector3(t.x, t.y, t.z)));
        }
  return out;
}

/** The depth of a point along the view direction (render's near plane is 0.3 m). */
function depth(pose: CameraPose, p: Vector3): number {
  const v = new Vector3(pose.lookX - pose.x, pose.lookY - pose.y, pose.lookZ - pose.z).normalize();
  return new Vector3(p.x - pose.x, p.y - pose.y, p.z - pose.z).dot(v);
}
const NEAR = 0.3;

describe('camera-3: choosing the view', () => {
  it('starts on the low chase cam; the slider and cycleView pick far chase and helmet', () => {
    const decl = CAMERA_TUNING.find((d) => d.id === 'camera.mode');
    expect(decl).toMatchObject({ default: 0, min: 0, max: 2, step: 1, group: 'camera', affectsSim: false });
    expect(VIEW_MODES).toEqual(['lowChase', 'farChase', 'helmet']);

    const cam = createFollowCamera({ road: straightRoad() });
    expect(cam.view).toBe('lowChase');
    cam.setParam('camera.mode', 1);
    expect(cam.view).toBe('farChase');
    cam.setParam('camera.mode', 2);
    expect(cam.view).toBe('helmet');
    expect(cam.cycleView()).toBe('lowChase');
    expect(cam.cycleView()).toBe('farChase');
    expect(cam.cycleView()).toBe('helmet');
    cam.setView('farChase');
    expect(cam.view).toBe('farChase');
    // A slider value between steps rounds; out-of-range values clamp.
    cam.setParam('camera.mode', 1.4);
    expect(cam.view).toBe('farChase');
    cam.setParam('camera.mode', 9);
    expect(cam.view).toBe('helmet');
    cam.setParam('camera.mode', -3);
    expect(cam.view).toBe('lowChase');
  });

  it('reports the shown view as its mode once a frame has run', () => {
    const road = straightRoad();
    const t = riderOn(road, 300, 1.7);
    for (const [i, view] of VIEW_MODES.entries()) {
      const cam = camOn(i, road);
      cam.snap(t);
      cam.update(t, DT);
      expect(cam.mode).toBe(view);
    }
  });
});

describe('camera-3: the far chase cam', () => {
  it('sits further back and higher than the low chase cam, by its own sliders', () => {
    const road = straightRoad();
    const t = riderOn(road, 300, 1.7);
    const low = camOn(0, road);
    const far = camOn(1, road);
    let a = low.snap(t);
    let b = far.snap(t);
    for (let n = 0; n < 240; n++) {
      a = low.update(t, DT);
      b = far.update(t, DT);
    }
    expect(behind(a, t)).toBeCloseTo(def('chaseDistanceM'), 2);
    expect(behind(b, t)).toBeCloseTo(def('farDistanceM'), 2);
    expect(b.y - t.y).toBeCloseTo(def('farHeightM'), 2);
    expect(def('farDistanceM')).toBeGreaterThan(def('chaseDistanceM'));
    expect(def('farHeightM')).toBeGreaterThan(def('heightM'));

    far.setParam('camera.farDistanceM', 15);
    far.setParam('camera.farHeightM', 6);
    for (let n = 0; n < 240; n++) b = far.update(t, DT);
    expect(behind(b, t)).toBeCloseTo(15, 2);
    expect(b.y - t.y).toBeCloseTo(6, 2);
  });

  it('blends from the low chase cam to far chase and back without overshoot', () => {
    const road = straightRoad();
    const t = riderOn(road, 300, 1.7);
    const cam = camOn(0, road);
    cam.snap(t);
    for (let n = 0; n < 60; n++) cam.update(t, DT);
    cam.setParam('camera.mode', 1);
    const far = def('farDistanceM');
    const farUp = def('farHeightM');
    let prevBack = behind(cam.update(t, DT), t);
    let prevUp = -Infinity;
    for (let n = 0; n < 300; n++) {
      const p = cam.update(t, DT);
      const back = behind(p, t);
      expect(back).toBeGreaterThanOrEqual(prevBack - 1e-9);
      expect(back).toBeLessThanOrEqual(far + 1e-6);
      expect(p.y - t.y).toBeGreaterThanOrEqual(prevUp - 1e-9);
      expect(p.y - t.y).toBeLessThanOrEqual(farUp + 1e-6);
      prevBack = back;
      prevUp = p.y - t.y;
    }
    expect(prevBack).toBeCloseTo(far, 3);

    cam.setParam('camera.mode', 0);
    for (let n = 0; n < 300; n++) {
      const back = behind(cam.update(t, DT), t);
      expect(back).toBeLessThanOrEqual(prevBack + 1e-9);
      expect(back).toBeGreaterThanOrEqual(def('chaseDistanceM') - 1e-6);
      prevBack = back;
    }
    expect(prevBack).toBeCloseTo(def('chaseDistanceM'), 3);
  });

  it('sits higher and further back again on a phone-shaped view', () => {
    const road = straightRoad();
    const t = riderOn(road, 300, 1.7);
    const cam = camOn(1, road);
    let p = cam.snap(t, { aspect: 2.2 });
    for (let n = 0; n < 240; n++) p = cam.update(t, DT, { aspect: 2.2 });
    expect(behind(p, t)).toBeCloseTo(def('farDistanceM') + def('wideDistanceM'), 2);
    expect(p.y - t.y).toBeCloseTo(def('farHeightM') + def('wideHeightM'), 2);
  });
});

describe('camera-3: the helmet cam', () => {
  it("sits inside the rider's own helmet (render's near plane hides it), leaning and weaving", () => {
    const road = straightRoad();
    let examined = 0;
    for (const lean of [0, 0.5, -0.5, 0.3])
      for (const weave of [0, 0.2, -0.2]) {
        const base = riderOn(road, 300, 1.7, { lean });
        const t = { ...base, heading: base.heading + weave };
        const cam = camOn(2, road);
        let p = cam.snap(t);
        for (let n = 0; n < 120; n++) p = cam.update(t, DT);
        for (const c of ownHelmet(t)) {
          expect(depth(p, c), `lean ${lean}, weave ${weave}`).toBeLessThan(NEAR);
          examined++;
        }
        // And it is the head it rides in, not a point beside it: within a few cm of the helmet's
        // centre, which render places at (0, 1.76, -0.08) in the leaning, turning model.
        const centre = new Vector3(0, 1.76, -0.08)
          .applyMatrix4(new Matrix4().makeRotationFromEuler(new Euler(0, t.heading, -(t.lean ?? 0))))
          .add(new Vector3(t.x, t.y, t.z));
        expect(centre.distanceTo(new Vector3(p.x, p.y, p.z)), `lean ${lean}, weave ${weave}`).toBeLessThan(
          0.05,
        );
        // Looking forward along the road, not at the rider.
        expect(behind(p, base)).toBeLessThan(0.5);
      }
    console.log(`[examined] ${examined} helmet corners against the near plane`);
    expect(examined).toBe(4 * 3 * 16);
  });

  it('cuts straight in and straight out: nothing flies through the rider', () => {
    const road = straightRoad();
    const t = riderOn(road, 300, 1.7);
    const cam = camOn(0, road);
    cam.snap(t);
    for (let n = 0; n < 60; n++) cam.update(t, DT);
    cam.setParam('camera.mode', 2);
    const inHelmet = cam.update(t, DT);
    expect(cam.mode).toBe('helmet');
    expect(inHelmet.y - t.y).toBeCloseTo(def('helmetHeightM'), 3);
    expect(Math.abs(behind(inHelmet, t) + def('helmetForwardM'))).toBeLessThan(1e-6);

    cam.setParam('camera.mode', 0);
    const out = cam.update(t, DT);
    expect(behind(out, t)).toBeCloseTo(def('chaseDistanceM'), 3);
    expect(out.y - t.y).toBeCloseTo(def('heightM'), 3);
  });

  it('rolls less than the bike, settles on a lean without overshoot, and never overshoots its FOV', () => {
    const road = straightRoad();
    const cam = camOn(2, road);
    cam.setShakeAmount(1);
    const upright = riderOn(road, 300, 1.7, { speed: 0 });
    cam.snap(upright);
    const leaning = riderOn(road, 300, 1.7, { lean: 0.5, speed: 45 });
    const rollGoal = -0.5 * def('helmetRollFraction');
    const fovGoal = def('helmetFovDeg') + def('fovKickDeg');
    let prevRoll = 0;
    let prevFov = def('helmetFovDeg');
    for (let n = 0; n < 400; n++) {
      const p = cam.update(leaning, DT);
      expect(p.roll).toBeLessThanOrEqual(prevRoll + 1e-12);
      expect(p.roll).toBeGreaterThanOrEqual(rollGoal - 1e-9);
      expect(p.fov).toBeGreaterThanOrEqual(prevFov - 1e-12);
      expect(p.fov).toBeLessThanOrEqual(fovGoal + 1e-9);
      prevRoll = p.roll;
      prevFov = p.fov;
    }
    expect(prevRoll).toBeCloseTo(rollGoal, 4);
    expect(Math.abs(prevRoll)).toBeLessThan(0.5);
    expect(prevFov).toBeCloseTo(fovGoal, 3);
  });

  it('softens roll and the FOV kick to the calm share under reduce-shake', () => {
    const road = straightRoad();
    const t = riderOn(road, 300, 1.7, { lean: 0.4, speed: 45 });
    const settle = (amount: number) => {
      const cam = camOn(2, road);
      cam.setShakeAmount(amount);
      let p = cam.snap(t);
      for (let n = 0; n < 400; n++) p = cam.update(t, DT);
      return p;
    };
    const full = settle(1);
    const calm = settle(0);
    const k = def('helmetCalm');
    expect(k).toBeGreaterThan(0);
    expect(k).toBeLessThan(1);
    expect(calm.roll).toBeCloseTo(full.roll * k, 4);
    expect(calm.fov - def('helmetFovDeg')).toBeCloseTo((full.fov - def('helmetFovDeg')) * k, 3);
    expect(Math.abs(calm.roll)).toBeLessThan(Math.abs(full.roll));
  });

  it('shows the chase framing while the rider is off the bike, and cuts back when riding again', () => {
    const road = straightRoad();
    const riding = riderOn(road, 300, 1.7);
    const cam = camOn(2, road);
    cam.snap(riding);
    cam.update(riding, DT);
    for (const off of ['Tumble', 'OnFoot', 'Free'] as const) {
      const p = cam.update({ ...riding, mode: off }, DT);
      expect(cam.mode, off).toBe('lowChase');
      expect(behind(p, riding)).toBeCloseTo(def('chaseDistanceM'), 3);
      const back = cam.update(riding, DT);
      expect(cam.mode).toBe('helmet');
      expect(back.y - riding.y).toBeCloseTo(def('helmetHeightM'), 3);
    }
    expect(cam.view).toBe('helmet');
  });

  it('keeps look-back and the takedown framing, cutting to the takedown framing', () => {
    const road = straightRoad();
    const t = riderOn(road, 300, 1.7);
    const cam = camOn(2, road);
    cam.snap(t);
    cam.update(t, DT);
    cam.update(t, DT, { lookBack: true });
    expect(cam.mode).toBe('lookBack');
    cam.update(t, DT);
    expect(cam.mode).toBe('helmet');

    const w = road.toWorld(0, 306, -1.7, 0);
    const entities = [{ id: VICTIM, x: w.x, y: w.y, z: w.z }];
    const takedown: SimEvent = { tick: 1, type: 'takedown', actor: ME, target: VICTIM, causeId: 3, data: {} };
    cam.onEvents([takedown]);
    const p = cam.update(t, DT, { entities });
    expect(cam.mode).toBe('takedown');
    // A cut, not a blend out of the helmet: the camera is already well back from the rider's head.
    expect(behind(p, t)).toBeGreaterThan(def('takedownDistanceM') * 0.5);
    expect(p.y - t.y).toBeCloseTo(def('takedownHeightM'), 3);
  });
});

describe('camera-3: the view key', () => {
  type FakeKey = Event & { code?: string; repeat?: boolean; ctrlKey?: boolean };
  const key = (code: string, extra: Record<string, unknown> = {}): FakeKey =>
    Object.assign(new Event('keydown'), { code, ...extra });

  it(`cycles the view on ${CAMERA_VIEW_KEY}, ignoring repeats, chords and typing, until unbound`, () => {
    const keys = new EventTarget();
    const cam = createFollowCamera({ road: straightRoad() });
    const unbind = bindViewKey(keys, cam);
    keys.dispatchEvent(key(CAMERA_VIEW_KEY));
    expect(cam.view).toBe('farChase');
    keys.dispatchEvent(key(CAMERA_VIEW_KEY, { repeat: true }));
    keys.dispatchEvent(key(CAMERA_VIEW_KEY, { ctrlKey: true }));
    keys.dispatchEvent(key('KeyK'));
    expect(cam.view).toBe('farChase');
    // A key typed into a text field is not a camera change.
    const typing = key(CAMERA_VIEW_KEY);
    Object.defineProperty(typing, 'target', { value: { tagName: 'INPUT' } });
    keys.dispatchEvent(typing);
    expect(cam.view).toBe('farChase');
    keys.dispatchEvent(key(CAMERA_VIEW_KEY));
    expect(cam.view).toBe('helmet');
    keys.dispatchEvent(key(CAMERA_VIEW_KEY));
    expect(cam.view).toBe('lowChase');
    unbind();
    keys.dispatchEvent(key(CAMERA_VIEW_KEY));
    expect(cam.view).toBe('lowChase');
  });

  it('takes another key code', () => {
    const keys = new EventTarget();
    const cam = createFollowCamera({ road: straightRoad() });
    bindViewKey(keys, cam, 'KeyV');
    keys.dispatchEvent(key(CAMERA_VIEW_KEY));
    expect(cam.view).toBe('lowChase');
    keys.dispatchEvent(key('KeyV'));
    expect(cam.view).toBe('farChase');
  });
});
