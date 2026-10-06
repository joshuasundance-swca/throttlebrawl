// Reduce motion (M5's a11y-1; playtest 4 run B, B13): the rest of the camera's motion. Reduce screen
// shake (camera-2) already cuts the trauma shake and the hit jolt, and the helmet view calms its roll
// and FOV kick under it. Reduce motion is the wider switch: the chase and far views' lean roll and
// speed FOV kick soften too (`camera.motionCalm` is the share left), and the drift and wheelie moves
// halve, as the moves spec says. Driven frame by frame at a fixed dt, like moves.test.ts.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork } from '../road';
import { CAMERA_TUNING, createFollowCamera, type CameraPose, type CameraTarget } from './index';

const DT = 1 / 60;
const road = createRoadNetwork(fixtureNetwork([{ id: 'a', lengthM: 4000, kappa: 0 }]));
const def = (key: string): number => {
  const d = CAMERA_TUNING.find((x) => x.id === `camera.${key}`);
  if (!d) throw new Error(`no camera.${key}`);
  return d.default;
};

function target(s: number, extra: Partial<CameraTarget> = {}): CameraTarget {
  const w = road.toWorld(0, s, 0, 0);
  const f = road.frameAt(0, s);
  return {
    id: 0,
    x: w.x,
    y: w.y,
    z: w.z,
    heading: Math.atan2(-f.tx, -f.tz),
    speed: 45,
    lean: 0.6,
    mode: 'Road',
    road: { edge: 0 },
    ...extra,
  };
}

/** Settles a camera on a leaning, fast rider for two seconds, with the two amounts as given. */
function settled(
  opts: { view?: number; motion?: number; shake?: number; extra?: Partial<CameraTarget> } = {},
): CameraPose {
  const cam = createFollowCamera({ road });
  if (opts.view !== undefined) cam.setParam('camera.mode', opts.view);
  if (opts.shake !== undefined) cam.setShakeAmount(opts.shake);
  if (opts.motion !== undefined) cam.setMotionAmount(opts.motion);
  let s = 100;
  cam.snap(target(s, opts.extra));
  let pose = cam.snap(target(s, opts.extra));
  for (let n = 0; n < 120; n++) {
    s += 45 * DT;
    pose = cam.update(target(s, opts.extra), DT);
  }
  return pose;
}

const CHASE = 0;
const FAR = 1;
const HELMET = 2;

describe('reduce motion softens the lean roll and the speed FOV kick', () => {
  for (const [name, view] of [
    ['the chase view', CHASE],
    ['the far chase view', FAR],
  ] as const) {
    it(`${name}: the roll and the FOV kick shrink to the motionCalm share`, () => {
      const full = settled({ view });
      const calm = settled({ view, motion: 0 });
      const share = def('motionCalm');
      expect(Math.abs(full.roll)).toBeGreaterThan(0.1);
      expect(calm.roll / full.roll).toBeCloseTo(share, 2);
      const base = def('fovBaseDeg');
      expect((calm.fov - base) / (full.fov - base)).toBeCloseTo(share, 2);
      // The fast rider really kicks the FOV at full motion, so the share above means something.
      expect(full.fov - base).toBeGreaterThan(1);
    });

    it(`${name}: Reduce screen shake alone leaves the roll and the FOV as they were`, () => {
      const full = settled({ view });
      const shakeOnly = settled({ view, shake: 0 });
      expect(shakeOnly.roll).toBeCloseTo(full.roll, 6);
      expect(shakeOnly.fov).toBeCloseTo(full.fov, 6);
    });
  }

  it('the helmet view calms under reduce motion as it does under reduce shake', () => {
    const viaShake = settled({ view: HELMET, shake: 0 });
    const viaMotion = settled({ view: HELMET, motion: 0 });
    expect(viaMotion.roll).toBeCloseTo(viaShake.roll, 6);
    expect(viaMotion.fov).toBeCloseTo(viaShake.fov, 6);
  });

  it('halves the drift and wheelie moves, as it did under reduce shake', () => {
    const moves = { drift: 0.6, wheelie: 0.7, lean: 0 } as const;
    const full = settled({ extra: moves });
    const calm = settled({ motion: 0, extra: moves });
    const viaShake = settled({ shake: 0, extra: moves });
    // The two switches agree on the moves' halving; reduce motion also takes the roll's share on top.
    const none = settled({ extra: { lean: 0 } });
    const side = (p: CameraPose) => Math.hypot(p.x - none.x, p.z - none.z);
    expect(side(viaShake)).toBeLessThan(side(full));
    expect(side(calm)).toBeCloseTo(side(viaShake), 3);
  });

  it('a value outside 0..1 is clamped, and NaN means full motion', () => {
    const full = settled({});
    expect(settled({ motion: Number.NaN }).roll).toBeCloseTo(full.roll, 6);
    expect(settled({ motion: 7 }).roll).toBeCloseTo(full.roll, 6);
    expect(settled({ motion: -3 }).roll).toBeCloseTo(settled({ motion: 0 }).roll, 6);
  });

  it('is a tuning slider: 1 turns the softening off, 0 holds the roll and the kick at nothing', () => {
    const cam = (calm: number) => {
      const c = createFollowCamera({ road });
      c.setParam('camera.motionCalm', calm);
      c.setMotionAmount(0);
      let s = 100;
      let pose = c.snap(target(s));
      for (let n = 0; n < 120; n++) {
        s += 45 * DT;
        pose = c.update(target(s), DT);
      }
      return pose;
    };
    expect(cam(1).roll).toBeCloseTo(settled({}).roll, 6);
    expect(cam(0).roll).toBeCloseTo(0, 6);
  });
});
