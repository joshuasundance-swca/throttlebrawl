// High riders (the maintainer, playing on the phone, 2026-10-06: "it would be much more satisfying to land
// on it and ride on it with real physics"; "it was possible to go over and across barriers, possibly
// resulting in a crash like falling in the water"; "consistent physics and gameplay is important here so
// players know what to expect"; high falls "(a)": the same physics everywhere, with a high drop shown as
// a clean cut-away and no gag). The camera follows a rider on a roof or over a rail from the snapshot
// alone (src/camera imports only types):
// - riding a support (mode Road, `road.h` over the road under it), it aims along the support, not at
//   the road far below it, and the air tip does not fire (it is for a flight);
// - in the air over a roof the tip is measured over the roof (`floorY`), not the road under the truck;
//   with no floor (a hand-built snapshot) or a floor under the road (the sea) it is as it was;
// - the helmet eye rides above the roof as it rides above the road;
// - a HIGH fall (`railOver` with `high`) holds the camera on the rail while the rider goes over, and a
//   `respawn` cuts to the rider where he wakes; a low splash (no `high`), another rider's fall and the
//   hold's own cap are the controls. Driven frame by frame at a fixed dt.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork } from '../road';
import type { SimEvent } from '../sim/api';
import { createFollowCamera, type CameraPose, type CameraTarget } from './index';

const DT = 1 / 60;
const road = createRoadNetwork(fixtureNetwork([{ id: 'a', lengthM: 2000, kappa: 0 }]));
const ROOF = 3.4;

interface Opts {
  mode?: CameraTarget['mode'];
  floorY?: number;
  lean?: number;
  /** A lateral offset off the road's line, m (a rider out past the rail). */
  d?: number;
  /** World y, overriding the road's height plus `h`. */
  y?: number;
}

/** The rider at s on the straight, `h` m over the road (a support's top, or a flight), in `mode`. */
function target(s: number, h: number, opts: Opts = {}): CameraTarget {
  const w = road.toWorld(0, s, opts.d ?? 0, h);
  const f = road.frameAt(0, s);
  return {
    id: 0,
    x: w.x,
    y: opts.y ?? w.y,
    z: w.z,
    heading: Math.atan2(-f.tx, -f.tz),
    speed: 30,
    lean: opts.lean ?? 0,
    mode: opts.mode ?? 'Road',
    road: { edge: 0 },
    ...(opts.floorY !== undefined ? { floorY: opts.floorY } : {}),
  };
}

function ride(h: number, opts: Opts = {}, params: Record<string, number> = {}) {
  const cam = createFollowCamera({ road });
  for (const [k, v] of Object.entries(params)) cam.setParam(`camera.${k}`, v);
  let s = 100;
  let t = target(s, h, opts);
  let pose: CameraPose = cam.snap(target(s, 0));
  for (let n = 0; n < 120; n++) {
    s += 30 * DT;
    t = target(s, h, opts);
    pose = cam.update(t, DT);
  }
  return { cam, pose, t, s };
}

/** How far the view points down, radians (positive: looking down). */
const pitchDown = (p: CameraPose) => Math.atan2(p.y - p.lookY, Math.hypot(p.lookX - p.x, p.lookZ - p.z));

describe('riding a roof: the camera aims along the support and the air tip does not fire', () => {
  it('riding at 3.4 m, the view is the one it has on the road (aimed with the rider, not at the road below)', () => {
    const ground = ride(0);
    const roof = ride(ROOF);
    console.log(
      `[examined] pitch down: road ${pitchDown(ground.pose).toFixed(3)}, roof ${pitchDown(roof.pose).toFixed(3)}; aim over the rider: road ${(ground.pose.lookY - ground.t.y).toFixed(2)} m, roof ${(roof.pose.lookY - roof.t.y).toFixed(2)} m`,
    );
    expect(pitchDown(roof.pose)).toBeCloseTo(pitchDown(ground.pose), 2);
    expect(roof.pose.lookY - roof.t.y).toBeCloseTo(ground.pose.lookY - ground.t.y, 1);
    // The camera sits as high over the rider as ever: no air lift while he rides.
    expect(roof.pose.y - roof.t.y).toBeCloseTo(ground.pose.y - ground.t.y, 1);
  });

  it('control: the same height in a flight does tip it (so it is the mode and the support that decide)', () => {
    const ground = ride(0);
    const air = ride(ROOF, { mode: 'Airborne' });
    expect(pitchDown(air.pose)).toBeGreaterThan(pitchDown(ground.pose) + 0.05);
    expect(air.pose.y - air.t.y).toBeGreaterThan(ground.pose.y - ground.t.y + 0.5);
  });

  it('eases onto the roof: no jump in the aim on the first frame up there', () => {
    const cam = createFollowCamera({ road });
    cam.snap(target(100, 0));
    let pose = cam.update(target(100, 0), DT);
    for (let n = 0; n < 60; n++) pose = cam.update(target(100 + n * 0.5, 0), DT);
    const first = cam.update(target(130.5, ROOF), DT);
    expect(Math.abs(first.lookY - ROOF - (pose.lookY - 0))).toBeLessThan(0.6);
  });
});

describe('over a roof in the air: the tip is measured over what is below him', () => {
  const H = 4.4; // a metre over a 3.4 m roof
  it('a metre over the roof tips the view part way: less than the same flight over the bare road', () => {
    const ground = pitchDown(ride(0).pose);
    const bare = pitchDown(ride(H, { mode: 'Airborne' }).pose);
    const over = pitchDown(ride(H, { mode: 'Airborne', floorY: ROOF }).pose);
    console.log(
      `[examined] pitch down: road ${ground.toFixed(3)}, 4.4 m over the road ${bare.toFixed(3)}, 1 m over a roof ${over.toFixed(3)}`,
    );
    expect(over).toBeGreaterThan(ground);
    expect(over).toBeLessThan(bare - 0.02);
  });

  it('control: a floor under the road (the sea past a rail) leaves the tip as the road gave it', () => {
    const bare = ride(H, { mode: 'Airborne' });
    const sea = ride(H, { mode: 'Airborne', floorY: -25 });
    expect(pitchDown(sea.pose)).toBeCloseTo(pitchDown(bare.pose), 6);
    expect(sea.pose.y).toBeCloseTo(bare.pose.y, 6);
  });

  it('control: no floor in the snapshot (hand-built) is the road, as before', () => {
    const bare = ride(H, { mode: 'Airborne' });
    const zero = ride(H, { mode: 'Airborne', floorY: 0 });
    expect(pitchDown(zero.pose)).toBeCloseTo(pitchDown(bare.pose), 6);
  });
});

describe('the helmet eye clears the roof', () => {
  it('on a roof the eye sits a head above the roof, as above the road, however hard he leans', () => {
    for (const lean of [0, 0.5, -0.5]) {
      const road0 = ride(0, { lean }, { mode: 2 });
      const roof = ride(ROOF, { lean }, { mode: 2 });
      const eyeRoad = road0.pose.y - road0.t.y;
      const eyeRoof = roof.pose.y - roof.t.y;
      console.log(
        `[examined] helmet eye over the support, lean ${lean}: road ${eyeRoad.toFixed(2)} m, roof ${eyeRoof.toFixed(2)} m`,
      );
      expect(eyeRoof).toBeCloseTo(eyeRoad, 2);
      // Above the roof itself (the box he rides on), by at least a head and a half.
      expect(roof.pose.y).toBeGreaterThan(ROOF + 1.4);
    }
  });
});

describe('a high fall: the camera holds on the rail, then cuts to the respawn', () => {
  const ev = (type: SimEvent['type'], actor: number, data: SimEvent['data'] = {}, tick = 100): SimEvent => ({
    tick,
    type,
    actor,
    data,
  });
  const HIGH = { body: 'rider', over: true, past: 'water', dropM: 68, high: true };
  const LOW = { body: 'rider', over: true, past: 'water', dropM: 4, high: false };

  /** Rides to s 400, then goes over the rail: the target falls 70 m beside the road over 3.7 s. */
  function fall(railOver: SimEvent | null, params: Record<string, number> = {}) {
    const { cam, s } = ride(0.5, { mode: 'Airborne' }, params);
    const poses: CameraPose[] = [];
    const targets: CameraTarget[] = [];
    for (let n = 0; n < 60 * 4; n++) {
      if (n === 0 && railOver) cam.onEvents([railOver]);
      const sec = n * DT;
      const t = target(s + 25 * sec, 0.5, {
        mode: 'Tumble',
        d: 8 + sec,
        y: 0.5 - 0.5 * 9.81 * sec * sec,
      });
      targets.push(t);
      poses.push(cam.update(t, DT));
    }
    return { cam, poses, targets, s };
  }
  const eye = (p: CameraPose) => [p.x, p.y, p.z];

  it('holds the eye still on the rail while the rider falls away below it', () => {
    const f = fall(ev('railOver', 0, HIGH));
    const first = f.poses[0];
    const last = f.poses[f.poses.length - 1];
    console.log(
      `[examined] after a high railOver: eye ${eye(first as CameraPose)
        .map((v) => v.toFixed(1))
        .join(' ')} -> ${eye(last as CameraPose)
        .map((v) => v.toFixed(1))
        .join(' ')}; the rider fell to y ${f.targets[f.targets.length - 1]?.y.toFixed(1)}`,
    );
    for (const p of f.poses) expect(eye(p)).toEqual(eye(first as CameraPose));
    for (const p of f.poses) {
      expect(p.lookX).toBe((first as CameraPose).lookX);
      expect(p.lookY).toBe((first as CameraPose).lookY);
    }
    expect(f.targets[f.targets.length - 1]?.y ?? 0).toBeLessThan(-30);
  });

  it('control: a low splash is not a cut-away: the camera goes on following the rider down', () => {
    const f = fall(ev('railOver', 0, LOW));
    const first = f.poses[0] as CameraPose;
    const last = f.poses[f.poses.length - 1] as CameraPose;
    expect(Math.abs(last.z - first.z)).toBeGreaterThan(50);
  });

  it('control: no event, or another rider’s fall, leaves it following', () => {
    for (const e of [null, ev('railOver', 3, HIGH)]) {
      const f = fall(e);
      const first = f.poses[0] as CameraPose;
      const last = f.poses[f.poses.length - 1] as CameraPose;
      expect(Math.abs(last.z - first.z)).toBeGreaterThan(50);
    }
  });

  it('cuts to the rider where he wakes on the respawn: the chase framing, in one frame', () => {
    const f = fall(ev('railOver', 0, HIGH));
    const { cam } = f;
    cam.onEvents([ev('respawn', 0, { reason: 'splash', over: true, high: true }, 700)]);
    const woke = target(f.s + 100, 0, { mode: 'Road' });
    const pose = cam.update(woke, DT);
    // The chase framing behind him, as a snap would give it: not the frozen rail shot, not a blend.
    const snapped = createFollowCamera({ road }).snap(woke);
    expect(pose.x).toBeCloseTo(snapped.x, 1);
    expect(pose.y).toBeCloseTo(snapped.y, 1);
    expect(pose.z).toBeCloseTo(snapped.z, 1);
    // And it follows again after it.
    const next = cam.update(target(f.s + 100.5, 0, { mode: 'Road' }), DT);
    expect(Math.abs(next.z - pose.z)).toBeGreaterThan(0.1);
  });

  it('control: another rider’s respawn does not end the hold', () => {
    const f = fall(ev('railOver', 0, HIGH));
    f.cam.onEvents([ev('respawn', 5, {}, 700)]);
    const t = target(f.s + 100, 0, { mode: 'Tumble' });
    const pose = f.cam.update(t, DT);
    expect(eye(pose)).toEqual(eye(f.poses[0] as CameraPose));
  });

  it('never holds for good: back in Road mode with no respawn seen, or past the hold’s cap, it follows again', () => {
    const f = fall(ev('railOver', 0, HIGH));
    const roadAgain = f.cam.update(target(f.s + 100, 0, { mode: 'Road' }), DT);
    expect(eye(roadAgain)).not.toEqual(eye(f.poses[0] as CameraPose));
    const g = fall(ev('railOver', 0, HIGH));
    let pose = g.poses[0] as CameraPose;
    for (let n = 0; n < 60 * 20; n++)
      pose = g.cam.update(target(g.s + 200, 0, { mode: 'Tumble', d: 10 }), DT);
    expect(eye(pose)).not.toEqual(eye(g.poses[0] as CameraPose));
  });
});
