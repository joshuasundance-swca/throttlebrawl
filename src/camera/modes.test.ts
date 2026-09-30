import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork, type RoadNetwork } from '../road';
import type { SimEvent } from '../sim/api';
import { createJolt, type JoltParams } from './jolt';
import {
  CAMERA_TUNING,
  createFollowCamera,
  type CameraContext,
  type CameraPose,
  type CameraTarget,
  type FollowCamera,
} from './index';

// camera-2 acceptance (docs/milestones/M2.md): each mode settles without overshoot, the takedown
// framing ends by `slowmoEnd` plus its blend time, and reduce-shake at zero produces no shake
// offset. Plus: look-back is a quick cut on the held action, the takedown framing keeps the victim
// in view, the hit jolt pushes away from the other rider and springs back, and every camera tuning
// value changes what the camera does.

const DT = 1 / 60;
const DEFAULT = (id: string): number => {
  const d = CAMERA_TUNING.find((p) => p.id === id);
  if (!d) throw new Error(`no tuning declaration ${id}`);
  return d.default;
};
const ME = 4;
const VICTIM = 7;
const CAUSE = 99;

function straightRoad(): RoadNetwork {
  return createRoadNetwork(fixtureNetwork([{ id: 'a', lengthM: 1000, kappa: 0 }]));
}

/** A rider on the straight fixture road at arc length s, lane offset d, heading along +s. */
function riderOn(road: RoadNetwork, s: number, d: number, speed = 30): CameraTarget {
  const w = road.toWorld(0, s, d, 0);
  const f = road.frameAt(0, s);
  return {
    id: ME,
    x: w.x,
    y: w.y,
    z: w.z,
    heading: Math.atan2(-f.tx, -f.tz),
    speed,
    lean: 0,
    road: { edge: 0 },
  };
}

function forwardOf(t: CameraTarget): { x: number; z: number } {
  return { x: -Math.sin(t.heading), z: -Math.cos(t.heading) };
}

/** Horizontal distance from the camera back to the rider along its forward axis (negative: ahead). */
function behind(pose: CameraPose, t: CameraTarget): number {
  const f = forwardOf(t);
  return -((pose.x - t.x) * f.x + (pose.z - t.z) * f.z);
}

function offset(a: CameraPose, b: CameraPose): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z, a.lookX - b.lookX, a.lookY - b.lookY, a.lookZ - b.lookZ);
}

/** Whether a world point projects into a render camera built from this pose (as render does). */
function inView(pose: CameraPose, p: { x: number; y: number; z: number }, aspect = 16 / 9): boolean {
  const cam = new PerspectiveCamera(pose.fov, aspect, 0.3, 1500);
  cam.position.set(pose.x, pose.y, pose.z);
  cam.lookAt(pose.lookX, pose.lookY, pose.lookZ);
  if (pose.roll) cam.rotateZ(pose.roll);
  cam.updateMatrixWorld(true);
  const local = new Vector3(p.x, p.y, p.z).applyMatrix4(cam.matrixWorldInverse);
  if (local.z >= -cam.near) return false;
  const n = new Vector3(p.x, p.y, p.z).project(cam);
  return Math.abs(n.x) <= 1 && Math.abs(n.y) <= 1;
}

const takedownAt = (tick: number, target = VICTIM, actor = ME): SimEvent => ({
  tick,
  type: 'takedown',
  actor,
  target,
  causeId: CAUSE,
  data: { kind: 'traffic' },
});
const slowmo = (type: 'slowmoStart' | 'slowmoEnd', tick: number, actor = ME): SimEvent => ({
  tick,
  type,
  actor,
  target: VICTIM,
  causeId: CAUSE,
  data: { ticks: 48, timeScale: 0.3 },
});

/** Two cameras on the same rider, one of which sees the events: the control shows plain chase. */
function pair(road: RoadNetwork | null = straightRoad()) {
  const cam = createFollowCamera({ road });
  const control = createFollowCamera({ road });
  // Shake-free, so the framing difference is the mode alone.
  cam.setShakeAmount(0);
  control.setShakeAmount(0);
  return { cam, control };
}

describe('camera-2: look-back on the held action', () => {
  it('cuts straight to a view ahead of the rider looking back, and straight back on release', () => {
    const road = straightRoad();
    const { cam, control } = pair(road);
    const t = riderOn(road, 300, 1.7);
    cam.snap(t);
    control.snap(t);
    for (let n = 0; n < 60; n++) {
      cam.update(t, DT);
      control.update(t, DT);
    }
    expect(cam.mode).toBe('lowChase');

    // The first held frame is already the full look-back view: quick to use.
    const back = cam.update(t, DT, { lookBack: true });
    control.update(t, DT);
    expect(cam.mode).toBe('lookBack');
    expect(behind(back, t)).toBeCloseTo(-DEFAULT('camera.lookBackDistanceM'), 6);
    expect(back.y - t.y).toBeCloseTo(DEFAULT('camera.lookBackHeightM'), 6);
    const f = forwardOf(t);
    // It looks back down the road: the aim point is behind the rider.
    expect((back.lookX - t.x) * f.x + (back.lookZ - t.z) * f.z).toBeCloseTo(
      -DEFAULT('camera.lookBackAimM'),
      6,
    );
    // A rival 20 m behind in the next lane is in view; the road ahead is not.
    const chaser = road.toWorld(0, 280, -1.7, 1);
    expect(inView(back, chaser)).toBe(true);
    expect(inView(back, road.toWorld(0, 330, 1.7, 1))).toBe(false);

    for (let n = 0; n < 30; n++) {
      cam.update(t, DT, { lookBack: true });
      control.update(t, DT);
    }
    // Released: exactly the chase framing the control shows, on the first frame.
    const released = cam.update(t, DT, { lookBack: false });
    expect(cam.mode).toBe('lowChase');
    expect(released).toEqual(control.update(t, DT));
  });

  it('settles without overshoot when the rider turns while looking back', () => {
    const cam = createFollowCamera();
    const t0: CameraTarget = { id: ME, x: 0, y: 0, z: 0, heading: 0, speed: 20 };
    cam.snap(t0, { lookBack: true });
    const t1 = { ...t0, heading: 0.6 };
    let prev = 0;
    let bearing = 0;
    for (let n = 0; n < 240; n++) {
      const pose = cam.update(t1, DT, { lookBack: true });
      // Looking back, the camera is ahead of the rider: its bearing from the rider is the heading.
      bearing = Math.atan2(-(pose.x - t1.x), -(pose.z - t1.z));
      expect(bearing).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(bearing).toBeLessThanOrEqual(0.6 + 1e-9);
      prev = bearing;
    }
    expect(bearing).toBeCloseTo(0.6, 3);
  });

  it('snap honours a held look-back (a respawn while the button is down)', () => {
    const road = straightRoad();
    const cam = createFollowCamera({ road });
    const t = riderOn(road, 100, 1.7);
    expect(behind(cam.snap(t, { lookBack: true }), t)).toBeLessThan(0);
    expect(cam.mode).toBe('lookBack');
  });
});

describe('camera-2: the takedown framing', () => {
  const road = straightRoad();
  const S = 300;

  /** The victim: starts alongside 6 m ahead in the other lane, then is flung sideways at 9 m/s. */
  function victimAt(seconds: number): { id: number; x: number; y: number; z: number } {
    const w = road.toWorld(0, S + 6, -1.7 - 9 * seconds, 0);
    return { id: VICTIM, x: w.x, y: w.y + 0.5, z: w.z };
  }

  interface Run {
    poses: CameraPose[];
    control: CameraPose[];
    modes: string[];
    t: CameraTarget;
    releaseFrame: number;
  }

  /**
   * Holds the rider still, delivers the takedown at frame 10 and (optionally) its slow motion, and
   * records every frame of the camera and a control that never saw the events.
   */
  function run(opts: {
    slowmoFrames?: number | null;
    frames?: number;
    params?: Record<string, number>;
  }): Run {
    const { cam, control } = pair(road);
    for (const [id, v] of Object.entries(opts.params ?? {})) {
      cam.setParam(id, v);
      control.setParam(id, v);
    }
    const t = riderOn(road, S, 1.7);
    cam.snap(t);
    control.snap(t);
    const out: Run = { poses: [], control: [], modes: [], t, releaseFrame: -1 };
    const slowFrames = opts.slowmoFrames === undefined ? 48 : opts.slowmoFrames;
    for (let n = 0; n < (opts.frames ?? 150); n++) {
      if (n === 10)
        cam.onEvents(slowFrames === null ? [takedownAt(n)] : [takedownAt(n), slowmo('slowmoStart', n)]);
      if (slowFrames !== null && n === 10 + slowFrames) {
        cam.onEvents([slowmo('slowmoEnd', n)]);
        out.releaseFrame = n;
      }
      const since = Math.max(0, (n - 10) * DT);
      const ctx: CameraContext = { entities: [{ id: ME, x: t.x, y: t.y, z: t.z }, victimAt(since)] };
      out.poses.push(cam.update(t, DT, ctx));
      out.control.push(control.update(t, DT, ctx));
      out.modes.push(cam.mode);
    }
    return out;
  }

  it('switches on at the player’s takedown and keeps the victim in view through the slow motion', () => {
    const r = run({});
    expect(r.modes.slice(0, 10).every((m) => m === 'lowChase')).toBe(true);
    expect(r.modes[10]).toBe('takedown');
    let checked = 0;
    for (let n = 10; n < r.releaseFrame; n++) {
      const pose = r.poses[n];
      if (!pose) throw new Error('missing frame');
      expect(inView(pose, victimAt((n - 10) * DT)), `frame ${n}`).toBe(true);
      expect(inView(pose, r.t), `rider, frame ${n}`).toBe(true);
      checked++;
    }
    expect(checked).toBe(48);
    // By the middle of the slow motion it has moved well away from the chase framing.
    const mid = r.poses[40];
    const midControl = r.control[40];
    if (!mid || !midControl) throw new Error('missing frame');
    expect(offset(mid, midControl)).toBeGreaterThan(2);
  });

  // The frame that delivers slowmoEnd is the first frame of the blend out, so after `blendFrames`
  // frames (ending on frame releaseFrame + blendFrames - 1) the framing is fully off.
  it('ends by slowmoEnd plus its blend time, landing exactly on the chase framing', () => {
    const blendFrames = Math.round(DEFAULT('camera.takedownBlendS') / DT);
    const r = run({});
    const end = r.releaseFrame + blendFrames - 1;
    // Still easing out the frame before the blend time is up...
    expect(r.modes[end - 1]).toBe('takedown');
    // ...and done by slowmoEnd + blend: plain chase, identical to the control from then on.
    for (let n = end; n < r.poses.length; n++) {
      expect(r.modes[n], `frame ${n}`).toBe('lowChase');
      expect(r.poses[n]).toEqual(r.control[n]);
    }
  });

  it('honours a non-default blend time (the slider does something)', () => {
    const r = run({ params: { 'camera.takedownBlendS': 0.6 } });
    const end = r.releaseFrame + Math.round(0.6 / DT) - 1;
    expect(r.modes[end - 1]).toBe('takedown');
    expect(r.modes[end]).toBe('lowChase');
  });

  it('blends in and out without overshoot: the height rises and falls monotonically', () => {
    const r = run({});
    const chaseH = DEFAULT('camera.heightM');
    const tdH = DEFAULT('camera.takedownHeightM');
    const h = r.poses.map((p) => p.y - r.t.y);
    for (let n = 11; n < r.releaseFrame; n++) {
      expect(h[n] ?? 0).toBeGreaterThanOrEqual((h[n - 1] ?? 0) - 1e-9);
      expect(h[n] ?? 0).toBeLessThanOrEqual(tdH + 1e-9);
    }
    // Full framing reached during the hold.
    expect(h[r.releaseFrame - 1] ?? 0).toBeCloseTo(tdH, 6);
    for (let n = r.releaseFrame; n < h.length; n++) {
      expect(h[n] ?? 0).toBeLessThanOrEqual((h[n - 1] ?? 0) + 1e-9);
      expect(h[n] ?? 0).toBeGreaterThanOrEqual(chaseH - 1e-9);
    }
  });

  it('with no slow motion (toggle off or cooling down) holds for takedownHoldS, then blends back', () => {
    const r = run({ slowmoFrames: null, frames: 160 });
    const hold = Math.round(DEFAULT('camera.takedownHoldS') / DT);
    const blend = Math.round(DEFAULT('camera.takedownBlendS') / DT);
    expect(r.modes[10 + hold - 1]).toBe('takedown');
    // The hold runs out on frame 10 + hold - 1, which is also the first frame of the blend out.
    const end = 10 + hold - 1 + blend - 1;
    expect(r.modes[end - 1]).toBe('takedown');
    for (let n = end; n < r.poses.length; n++) expect(r.poses[n]).toEqual(r.control[n]);
  });

  it('ignores takedowns the followed rider was not credited with', () => {
    const { cam, control } = pair(road);
    const t = riderOn(road, S, 1.7);
    cam.snap(t);
    control.snap(t);
    cam.onEvents([takedownAt(1, VICTIM, 2), slowmo('slowmoStart', 1, 2), takedownAt(1, ME, 2)]);
    for (let n = 0; n < 60; n++) {
      expect(cam.update(t, DT, { entities: [victimAt(0)] })).toEqual(control.update(t, DT));
      expect(cam.mode).toBe('lowChase');
    }
  });

  it('gives way to a held look-back, and comes back to the takedown framing on release', () => {
    const { cam } = pair(road);
    const t = riderOn(road, S, 1.7);
    cam.snap(t);
    cam.onEvents([takedownAt(1), slowmo('slowmoStart', 1)]);
    const ctx = { entities: [victimAt(0)] };
    for (let n = 0; n < 20; n++) cam.update(t, DT, ctx);
    expect(cam.mode).toBe('takedown');
    expect(behind(cam.update(t, DT, { ...ctx, lookBack: true }), t)).toBeLessThan(0);
    expect(cam.mode).toBe('lookBack');
    cam.update(t, DT, ctx);
    expect(cam.mode).toBe('takedown');
  });

  it('keeps a victim that leaves the snapshot where it was last seen, and stays finite', () => {
    const { cam } = pair(road);
    const t = riderOn(road, S, 1.7);
    cam.snap(t);
    cam.onEvents([takedownAt(1), slowmo('slowmoStart', 1)]);
    for (let n = 0; n < 10; n++) cam.update(t, DT, { entities: [victimAt(0)] });
    for (let n = 0; n < 30; n++) {
      const pose = cam.update(t, DT, { entities: [] });
      for (const v of Object.values(pose)) expect(Number.isFinite(v)).toBe(true);
      expect(inView(pose, victimAt(0))).toBe(true);
    }
  });

  it('a snap (race start, respawn) clears a running takedown framing', () => {
    const { cam, control } = pair(road);
    const t = riderOn(road, S, 1.7);
    cam.snap(t);
    cam.onEvents([takedownAt(1), slowmo('slowmoStart', 1)]);
    for (let n = 0; n < 20; n++) cam.update(t, DT, { entities: [victimAt(0)] });
    expect(cam.snap(t)).toEqual(control.snap(t));
    expect(cam.mode).toBe('lowChase');
    expect(cam.update(t, DT)).toEqual(control.update(t, DT));
  });
});

describe('camera-2: the hit jolt', () => {
  const P: JoltParams = {
    joltM: DEFAULT('camera.joltM'),
    joltFullImpulse: DEFAULT('camera.joltFullImpulse'),
    joltRate: DEFAULT('camera.joltRate'),
  };
  const hit = (actor: number, target: number, data: SimEvent['data']): SimEvent => ({
    tick: 1,
    type: 'hit',
    actor,
    target,
    data,
  });

  function trace(events: SimEvent[], lateral: number | undefined, params = P, frames = 90) {
    const j = createJolt();
    j.add(events, ME, () => lateral, params);
    const out: { side: number; up: number }[] = [];
    for (let n = 0; n < frames; n++) out.push(j.step(DT, params));
    return out;
  }

  it('pushes away from the attacker, peaks at the full jolt, and springs back without crossing zero', () => {
    // Attacker on the left (lateral < 0): the camera goes right (+side) and dips.
    const t = trace([hit(1, ME, { hitImpulse: P.joltFullImpulse })], -2);
    const peak = Math.max(...t.map((o) => o.side));
    expect(peak).toBeGreaterThan(P.joltM * 0.97);
    expect(peak).toBeLessThanOrEqual(P.joltM + 1e-9);
    const peakAt = t.findIndex((o) => o.side === peak);
    expect(peakAt * DT).toBeCloseTo(1 / P.joltRate, 1);
    for (const o of t) {
      expect(o.side).toBeGreaterThanOrEqual(0);
      expect(o.up).toBeLessThanOrEqual(0);
    }
    expect(t[t.length - 1]?.side).toBe(0);
    // An attacker on the right pushes the other way.
    const r = trace([hit(1, ME, { hitImpulse: P.joltFullImpulse })], 2);
    expect(Math.min(...r.map((o) => o.side))).toBeCloseTo(-peak, 9);
  });

  it('scales with hitImpulse, caps at a full jolt, and the thrower feels half', () => {
    const peakOf = (events: SimEvent[]) => Math.max(...trace(events, -2).map((o) => Math.abs(o.side)));
    const full = peakOf([hit(1, ME, { hitImpulse: P.joltFullImpulse })]);
    expect(peakOf([hit(1, ME, { hitImpulse: P.joltFullImpulse / 2 })])).toBeCloseTo(full / 2, 6);
    expect(peakOf([hit(1, ME, { hitImpulse: P.joltFullImpulse * 3 })])).toBeCloseTo(full, 6);
    expect(peakOf([hit(ME, 1, { hitImpulse: P.joltFullImpulse })])).toBeCloseTo(full / 2, 6);
    // Before combat-3 publishes hitImpulse: a kick stands in at 5 m/s, anything else at 2 m/s.
    expect(peakOf([hit(1, ME, { kick: true })])).toBeCloseTo((full * 5) / P.joltFullImpulse, 6);
    expect(peakOf([hit(1, ME, { kick: false })])).toBeCloseTo((full * 2) / P.joltFullImpulse, 6);
  });

  it('ignores hits between other riders, and events that are not hits', () => {
    const t = trace(
      [
        hit(1, 2, { hitImpulse: 6 }),
        { tick: 1, type: 'kick', actor: 1, target: ME, data: { hitImpulse: 6 } },
      ],
      -2,
    );
    expect(t.every((o) => o.side === 0 && o.up === 0)).toBe(true);
  });

  it('reaches the camera: a hit on the followed rider moves it sideways, away from the attacker', () => {
    const road = straightRoad();
    const t = riderOn(road, 300, 1.7);
    const attacker = road.toWorld(0, 300, 0.5, 0); // to the rider's left
    const ctx = { entities: [{ id: 1, ...attacker }] };
    const cam = createFollowCamera({ road });
    const calm = createFollowCamera({ road });
    cam.setParam('camera.shakeScale', 1);
    cam.snap(t);
    calm.snap(t);
    cam.onEvents([hit(1, ME, { hitImpulse: 6 })]);
    let most = 0;
    for (let n = 0; n < 30; n++) {
      const a = cam.update(t, DT, ctx);
      const b = calm.update(t, DT, ctx);
      // Sideways along the road's right (+x on this road, which runs toward -z).
      const f = forwardOf(t);
      const side = (a.x - b.x) * -f.z + (a.z - b.z) * f.x;
      most = Math.max(most, side);
    }
    expect(most).toBeGreaterThan(DEFAULT('camera.joltM') * 0.5);
  });
});

describe('camera-2: reduce-shake scales every shake', () => {
  const crash: SimEvent = { tick: 1, type: 'crash', actor: ME, data: {} };
  const bigHit: SimEvent = { tick: 1, type: 'hit', actor: 1, target: ME, data: { hitImpulse: 12 } };

  function shaken(amount: number | null): number[] {
    const cam = createFollowCamera();
    const calm = createFollowCamera();
    if (amount !== null) cam.setShakeAmount(amount);
    const t: CameraTarget = { id: ME, x: 0, y: 0, z: 0, heading: 0, speed: 20 };
    const ctx = { entities: [{ id: 1, x: -2, y: 0, z: 0 }] };
    cam.snap(t);
    calm.snap(t);
    cam.onEvents([crash, bigHit]);
    const out: number[] = [];
    for (let n = 0; n < 120; n++) {
      const a = cam.update(t, DT, ctx);
      const b = calm.update(t, DT, ctx);
      out.push(offset(a, b) + Math.abs(a.roll - b.roll));
    }
    return out;
  }
  const total = (xs: number[]) => xs.reduce((s, v) => s + v, 0);

  it('at zero produces no shake or jolt offset at all', () => {
    expect(Math.max(...shaken(0))).toBe(0);
  });

  it('at half gives less than full, and full is the default', () => {
    const full = total(shaken(null));
    expect(full).toBeGreaterThan(0);
    expect(total(shaken(1))).toBe(full);
    const half = total(shaken(0.5));
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(full * 0.75);
  });

  it('clamps out-of-range values and treats NaN as full', () => {
    expect(total(shaken(-3))).toBe(0);
    expect(total(shaken(5))).toBe(total(shaken(1)));
    expect(total(shaken(Number.NaN))).toBe(total(shaken(1)));
  });
});

describe('camera-2: every camera tuning value changes what the camera does', () => {
  /** A scripted minute of camera work that exercises every mode, as one flat trace of numbers. */
  function script(cam: FollowCamera): number[] {
    const road = createRoadNetwork(fixtureNetwork([{ id: 'a', lengthM: 1000, kappa: 0.004 }]));
    const out: number[] = [];
    let s = 100;
    const rival = (at: number) => {
      const w = road.toWorld(0, at + 3, -1.7, 0);
      return { id: VICTIM, x: w.x, y: w.y, z: w.z };
    };
    const t0 = { ...riderOn(road, s, 1.7, 30), targetId: VICTIM, lean: 0.3 };
    cam.snap(t0, { entities: [rival(s)] });
    for (let n = 0; n < 300; n++) {
      s += 30 * DT;
      const t = { ...riderOn(road, s, 1.7, 30), targetId: VICTIM, lean: 0.3 * Math.sin(n / 20) };
      if (n === 20)
        cam.onEvents([{ tick: n, type: 'hit', actor: VICTIM, target: ME, data: { hitImpulse: 4 } }]);
      if (n === 60) cam.onEvents([{ tick: n, type: 'crash', actor: ME, data: {} }]);
      if (n === 120) cam.onEvents([takedownAt(n), slowmo('slowmoStart', n)]);
      if (n === 150) cam.onEvents([slowmo('slowmoEnd', n)]);
      if (n === 200) cam.onEvents([takedownAt(n)]); // no slow motion: the hold time applies
      const pose = cam.update(t, DT, { entities: [rival(s)], lookBack: n >= 260 && n < 280 });
      out.push(pose.x, pose.y, pose.z, pose.lookX, pose.lookY, pose.lookZ, pose.fov, pose.roll);
    }
    return out;
  }

  it('moves the scripted trace for a non-default value of each declaration', () => {
    const base = script(createFollowCamera({}));
    const dead: string[] = [];
    for (const d of CAMERA_TUNING) {
      const cam = createFollowCamera({});
      const other = d.default === d.min ? d.max : d.min;
      cam.setParam(d.id, other);
      const trace = script(cam);
      if (trace.every((v, i) => v === base[i])) dead.push(d.id);
    }
    console.log(`[examined] ${CAMERA_TUNING.length} camera tuning declarations against a scripted run`);
    expect(dead).toEqual([]);
  });
});
