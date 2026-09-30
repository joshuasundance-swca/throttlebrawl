// Playtest 1 item 11 [decided]: "on laptop camera height isn't as big a deal as the phone. I think
// phone may just be 'harder'." The chase cam adapts to the view's shape: higher and further back on
// a wide, short phone-landscape view, unchanged on a laptop-shaped one.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork, type RoadNetwork } from '../road';
import { CAMERA_TUNING, createFollowCamera, wideAmount, type CameraPose, type CameraTarget } from './index';

const DT = 1 / 60;
const road: RoadNetwork = createRoadNetwork(fixtureNetwork([{ id: 'a', lengthM: 1000, kappa: 0 }]));
const def = (id: string) => CAMERA_TUNING.find((d) => d.id === `camera.${id}`)?.default ?? NaN;

function rider(): CameraTarget {
  const s = 300;
  const w = road.toWorld(0, s, 1.7, 0);
  const f = road.frameAt(0, s);
  return {
    id: 0,
    x: w.x,
    y: w.y,
    z: w.z,
    heading: Math.atan2(-f.tx, -f.tz),
    speed: 30,
    lean: 0,
    road: { edge: 0 },
  };
}

/** The settled pose for a view shape: its height above the rider and distance behind it. */
function settled(aspect: number | undefined, params: Record<string, number> = {}) {
  const cam = createFollowCamera({ road });
  for (const [id, v] of Object.entries(params)) cam.setParam(`camera.${id}`, v);
  const t = rider();
  const ctx = aspect === undefined ? {} : { aspect };
  let pose: CameraPose = cam.snap(t, ctx);
  for (let i = 0; i < 300; i++) pose = cam.update(t, DT, ctx);
  return { pose, height: pose.y - t.y, back: Math.hypot(pose.x - t.x, pose.z - t.z) };
}

const PHONES = { 'the maintainer’s phone (1248x576)': 1248 / 576, '20:9': 20 / 9, 'CI (915x412)': 915 / 412 };
const LAPTOPS = { '16:9': 16 / 9, '16:10': 16 / 10, '3:2': 3 / 2, '4:3': 4 / 3 };

describe('the aspect-adaptive chase cam (playtest 1, item 11)', () => {
  it('is unchanged on laptop-shaped views, and when no aspect is given', () => {
    const none = settled(undefined);
    for (const [name, aspect] of Object.entries(LAPTOPS)) {
      const p = settled(aspect).pose;
      expect(p.x, name).toBeCloseTo(none.pose.x, 6);
      expect(p.y, name).toBeCloseTo(none.pose.y, 6);
      expect(p.z, name).toBeCloseTo(none.pose.z, 6);
    }
    expect(none.height).toBeCloseTo(def('heightM'), 1);
  });

  it('sits higher and further back on phone-landscape views, by the slider amounts', () => {
    const laptop = settled(16 / 9);
    for (const [name, aspect] of Object.entries(PHONES)) {
      const phone = settled(aspect);
      console.log(
        `[examined] ${name}: ${phone.height.toFixed(2)} m up, ${phone.back.toFixed(2)} m back ` +
          `(laptop ${laptop.height.toFixed(2)}, ${laptop.back.toFixed(2)})`,
      );
      expect(phone.height - laptop.height, name).toBeCloseTo(def('wideHeightM'), 2);
      expect(phone.back - laptop.back, name).toBeGreaterThan(def('wideDistanceM') * 0.9);
    }
  });

  it('blends between the two shapes', () => {
    const from = def('wideAspectFrom');
    const full = def('wideAspectFull');
    const p = { wideAspectFrom: from, wideAspectFull: full };
    expect(wideAmount(from, p)).toBe(0);
    expect(wideAmount(full, p)).toBe(1);
    expect(wideAmount((from + full) / 2, p)).toBeCloseTo(0.5);
    expect(wideAmount(Number.NaN, p)).toBe(0);
    const mid = settled((from + full) / 2).height;
    expect(mid).toBeGreaterThan(settled(16 / 9).height + 0.1);
    expect(mid).toBeLessThan(settled(20 / 9).height - 0.1);
  });

  it('follows its sliders (non-default values change the result; zero turns it off)', () => {
    const phone = 20 / 9;
    const base = settled(phone);
    expect(settled(phone, { wideHeightM: 1.5 }).height - base.height).toBeCloseTo(
      1.5 - def('wideHeightM'),
      2,
    );
    expect(settled(phone, { wideDistanceM: 3 }).back).toBeGreaterThan(base.back + 1.5);
    // Moving the "phone from" point past this view's shape turns the adaptation off.
    expect(settled(phone, { wideAspectFrom: 2.4, wideAspectFull: 2.6 }).height).toBeCloseTo(
      settled(16 / 9).height,
      4,
    );
    const off = settled(phone, { wideHeightM: 0, wideDistanceM: 0 });
    expect(off.height).toBeCloseTo(settled(16 / 9).height, 4);
    expect(off.back).toBeCloseTo(settled(16 / 9).back, 4);
  });
});
