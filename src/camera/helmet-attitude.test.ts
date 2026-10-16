import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork } from '../road';
import { CAMERA_TUNING, createFollowCamera, type CameraPose, type CameraTarget } from './index';

const target: CameraTarget = { id: 0, x: 0, y: 4, z: 0, heading: 0, speed: 20, lean: 0, mode: 'Airborne' };
const forward = (p: CameraPose) => new Vector3(p.lookX - p.x, p.lookY - p.y, p.lookZ - p.z).normalize();
const up = (p: CameraPose) => new Vector3(p.upX, p.upY, p.upZ);
function helmet() {
  const cam = createFollowCamera();
  cam.setView('helmet');
  cam.setShakeAmount(0);
  return cam;
}
const def = (key: string) => CAMERA_TUNING.find((d) => d.id === `camera.${key}`)?.default ?? NaN;
const neutral = Math.atan2(
  def('helmetAimHeightM') - def('helmetHeightM'),
  def('helmetLookAheadM') - def('helmetForwardM'),
);

describe('helmet attitude from the simulation', () => {
  it('follows forward and backward multi-turn pitch continuously through vertical and inverted attitudes', () => {
    const cam = helmet();
    for (const sign of [-1, 1]) {
      let last: CameraPose | undefined;
      for (let i = 0; i <= 512; i++) {
        const pitch = (sign * i * Math.PI) / 32 - neutral;
        const p = cam.snap({ ...target, pitch });
        const f = forward(p);
        const u = up(p);
        expect(Object.values(p).every(Number.isFinite)).toBe(true);
        expect(f.y).toBeCloseTo(Math.sin(pitch + neutral), 8);
        expect(f.z).toBeCloseTo(-Math.cos(pitch + neutral), 8);
        expect(u.y).toBeCloseTo(Math.cos(pitch + neutral), 8);
        expect(u.length()).toBeCloseTo(1, 8);
        expect(u.dot(f)).toBeCloseTo(0, 8);
        if (last) {
          expect(f.dot(forward(last))).toBeGreaterThan(0.99);
          expect(u.dot(up(last))).toBeGreaterThan(0.99);
        }
        last = p;
      }
    }
  });

  it('keeps the collision-safe eye and does not add the wheelie angle twice', () => {
    const cam = helmet();
    const base = cam.snap({ ...target, lean: 0.6 });
    for (const pitch of [0, 0.7, Math.PI / 2, Math.PI, 6 * Math.PI]) {
      const p = cam.snap({ ...target, lean: 0.6, pitch, wheelie: 0.7 });
      const noWheelie = cam.snap({ ...target, lean: 0.6, pitch, wheelie: 0 });
      expect([p.x, p.y, p.z]).toEqual([base.x, base.y, base.z]);
      expect(Math.abs(p.x - target.x)).toBeLessThanOrEqual(def('helmetReachM'));
      expect(forward(p).distanceTo(forward(noWheelie))).toBeLessThan(1e-10);
    }
  });

  it('retains finite orthogonal view bases with heading, lean, shake and live attitude updates', () => {
    const cam = helmet();
    cam.setShakeAmount(1);
    cam.snap(target);
    cam.onEvents([{ tick: 1, type: 'land', actor: 0, data: {} }]);
    for (const heading of [0.4, Math.PI, -1.2]) {
      for (const lean of [-0.5, 0.5]) {
        for (const pitch of [0, Math.PI / 2 - neutral, Math.PI, -Math.PI / 2 - neutral, 10 * Math.PI]) {
          const p = cam.update({ ...target, heading, lean, pitch }, 1 / 60);
          expect(Object.values(p).every(Number.isFinite)).toBe(true);
          expect(up(p).length()).toBeCloseTo(1, 6);
          // Shake moves the eye and aim by different shares; renderer orthogonalizes this seed.
          expect(Math.abs(up(p).dot(forward(p)))).toBeLessThan(0.05);
        }
      }
    }
  });

  it('uses absolute slope pitch once and retains the sprung horizontal road bearing', () => {
    const road = createRoadNetwork(fixtureNetwork([{ id: 'hill', lengthM: 1000, kappa: 0, grade: 0.2 }]));
    const cam = createFollowCamera({ road });
    cam.setView('helmet');
    cam.setShakeAmount(0);
    const w = road.toWorld(0, 300, 0, 0);
    const frame = road.frameAt(0, 300);
    const slope = Math.atan(frame.grade);
    expect(slope).toBeGreaterThan(0.1);
    const t = {
      ...target,
      ...w,
      heading: Math.atan2(-frame.tx, -frame.tz),
      mode: 'Road' as const,
      pitch: slope,
    };
    const p = cam.snap(t);
    expect(Math.asin(forward(p).y)).toBeCloseTo(slope + neutral, 5);
  });

  it('stabilizes all turns under reduced motion but keeps attitude with reduced shake alone', () => {
    const cam = helmet();
    const full = cam.snap({ ...target, pitch: Math.PI });
    expect(up(full).y).toBeLessThan(-0.9);
    for (const amount of [0, 0.3, 0.99]) {
      cam.setMotionAmount(amount);
      const baseline = cam.snap(target);
      for (const pitch of [-10 * Math.PI, Math.PI / 2, Math.PI, 10 * Math.PI]) {
        const p = cam.snap({ ...target, pitch });
        expect(forward(p).distanceTo(forward(baseline))).toBeLessThan(1e-10);
        expect(up(p).distanceTo(up(baseline))).toBeLessThan(1e-10);
      }
    }
  });

  it('leaves pitch-absent views, off-bike, look-back and takedown framing unchanged', () => {
    for (const view of ['lowChase', 'farChase', 'helmet'] as const) {
      const a = helmet();
      const b = helmet();
      a.setView(view);
      b.setView(view);
      for (const mode of ['Road', 'Tumble', 'OnFoot'] as const) {
        const t = { ...target, mode };
        if (view !== 'helmet' || mode !== 'Road') expect(a.snap(t)).toEqual(b.snap({ ...t, pitch: Math.PI }));
        expect(a.snap(t, { lookBack: true })).toEqual(b.snap({ ...t, pitch: Math.PI }, { lookBack: true }));
      }
      a.snap(target);
      b.snap({ ...target, pitch: Math.PI });
      const events = [{ tick: 1, type: 'takedown' as const, actor: 0, target: 1, causeId: 1, data: {} }];
      a.onEvents(events);
      b.onEvents(events);
      const p = a.update(target, 1 / 60);
      const q = b.update({ ...target, pitch: Math.PI }, 1 / 60);
      expect(p).toEqual(q);
      expect(Object.values(q).every(Number.isFinite)).toBe(true);
    }
  });

  it('emits the same neutral view basis as the previous world-up and roll path', () => {
    for (const view of ['lowChase', 'farChase', 'helmet'] as const) {
      const cam = helmet();
      cam.setView(view);
      for (const heading of [0, 0.7, Math.PI]) {
        const p = cam.snap({ ...target, heading, lean: 0.5 });
        const previous = new PerspectiveCamera();
        previous.position.set(p.x, p.y, p.z);
        previous.lookAt(p.lookX, p.lookY, p.lookZ);
        previous.rotateZ(p.roll);
        const supplied = new PerspectiveCamera();
        supplied.position.copy(previous.position);
        supplied.up.set(p.upX, p.upY, p.upZ);
        supplied.lookAt(p.lookX, p.lookY, p.lookZ);
        expect(supplied.quaternion.angleTo(previous.quaternion)).toBeLessThan(1e-7);
      }
    }
  });
});
