import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork, type RoadNetwork, type RoadPos } from '../road';
import type { SimEvent } from '../sim/api';
import {
  CAMERA_TUNING,
  createFollowCamera,
  type CameraPose,
  type CameraTarget,
  type FollowCamera,
} from './index';

// camera-1 acceptance (docs/milestones/M1.md): a step change settles without overshoot; no NaN at
// zero speed or across the junction. Plus the rig's parts: roll at 20-40 % of lean, the FOV kick,
// the framing bias toward the auto-target and the event shake scaled by camera.shakeScale.

const DT = 1 / 60;
const DEFAULT = (id: string): number => {
  const d = CAMERA_TUNING.find((p) => p.id === id);
  if (!d) throw new Error(`no tuning declaration ${id}`);
  return d.default;
};

function straightRoad(): RoadNetwork {
  return createRoadNetwork(fixtureNetwork([{ id: 'a', lengthM: 1000, kappa: 0 }]));
}

/** Three arcs joined by two pass-through junctions, with a hump on the middle one. */
function curvyRoad(): RoadNetwork {
  return createRoadNetwork(
    fixtureNetwork([
      { id: 'a', lengthM: 200, kappa: 0.004 },
      { id: 'b', lengthM: 200, kappa: -0.006, grade: 0.04 },
      { id: 'c', lengthM: 200, kappa: 0.003 },
    ]),
  );
}

/** Two roads joined to-to: the second is stored backwards, so d and dir flip at the junction. */
function flippedJoin(): RoadNetwork {
  const bundle = fixtureNetwork([
    { id: 'a', lengthM: 150, kappa: 0.003 },
    { id: 'b', lengthM: 150, kappa: -0.004 },
  ]);
  const b = bundle.roads[1];
  if (!b) throw new Error('fixture has no second road');
  const data: Record<string, number[]> = {};
  for (const [k, col] of Object.entries(b.samples.data)) {
    const rev = [...col].reverse();
    data[k] = k === 'kappa' ? rev.map((v) => -v) : k === 'grade' ? rev.map((v) => -v) : rev;
  }
  const flipped = { ...b, from: b.to, to: b.from, samples: { ...b.samples, data } };
  const junctions = bundle.network.junctions.map((j) => ({
    ...j,
    ends: j.ends.map((e) =>
      e.road === 'b' ? { ...e, end: e.end === 'from' ? ('to' as const) : ('from' as const) } : e,
    ),
  }));
  return createRoadNetwork({
    ...bundle,
    roads: [bundle.roads[0] ?? b, flipped],
    network: { ...bundle.network, junctions },
  });
}

/** Where a rider at this road position is and which way it faces. */
function riderAt(
  road: RoadNetwork,
  pos: RoadPos,
  speed: number,
  extra: Partial<CameraTarget> = {},
): CameraTarget {
  const w = road.toWorld(pos.edge, pos.s, pos.d, 0);
  const f = road.frameAt(pos.edge, pos.s);
  const fx = f.tx * pos.dir;
  const fz = f.tz * pos.dir;
  return {
    id: 0,
    x: w.x,
    y: w.y,
    z: w.z,
    heading: Math.atan2(-fx, -fz),
    speed,
    lean: 0,
    road: pos,
    ...extra,
  };
}

function forwardOf(t: CameraTarget): { x: number; z: number } {
  return { x: -Math.sin(t.heading), z: -Math.cos(t.heading) };
}

function expectFinite(pose: CameraPose): void {
  for (const [k, v] of Object.entries(pose)) expect(Number.isFinite(v), `${k} = ${String(v)}`).toBe(true);
}

/** Horizontal distance from the camera back to the rider, along the rider's forward axis. */
function behind(pose: CameraPose, t: CameraTarget): number {
  const f = forwardOf(t);
  return -((pose.x - t.x) * f.x + (pose.z - t.z) * f.z);
}

function ride(cam: FollowCamera, road: RoadNetwork, pos: RoadPos, speed: number, seconds: number, dt = DT) {
  let t = riderAt(road, pos, speed);
  let pose = cam.update(t, dt);
  for (let n = 0; n < Math.round(seconds / dt); n++) {
    pos.s += pos.dir * speed * dt;
    road.advance(pos);
    t = riderAt(road, pos, speed);
    pose = cam.update(t, dt);
  }
  return { pose, target: t };
}

describe('the low chase cam: tuning declarations', () => {
  it('declares every constant as a camera tuning parameter that never affects the sim', () => {
    const ids = CAMERA_TUNING.map((p) => p.id);
    for (const id of [
      'camera.chaseDistanceM',
      'camera.heightM',
      'camera.lookAheadM',
      'camera.springRate',
      'camera.rollFraction',
      'camera.fovBaseDeg',
      'camera.fovKickDeg',
      'camera.targetBias',
      'camera.shakeScale',
    ]) {
      expect(ids).toContain(id);
    }
    for (const p of CAMERA_TUNING) {
      expect(p.group).toBe('camera');
      expect(p.affectsSim).toBe(false);
      expect(p.min).toBeLessThanOrEqual(p.default);
      expect(p.default).toBeLessThanOrEqual(p.max);
    }
    // The architecture doc's band: roll at 20-40 % of the bike's lean.
    expect(DEFAULT('camera.rollFraction')).toBeGreaterThanOrEqual(0.2);
    expect(DEFAULT('camera.rollFraction')).toBeLessThanOrEqual(0.4);
    expect(DEFAULT('camera.shakeScale')).toBe(1);
  });
});

describe('the low chase cam: a step change settles without overshoot', () => {
  it('eases out to a longer chase distance monotonically and stops there', () => {
    const road = straightRoad();
    const cam = createFollowCamera({ road });
    const pos: RoadPos = { edge: 0, s: 50, d: 1.7, dir: 1 };
    ride(cam, road, pos, 30, 3);
    cam.setParam('camera.chaseDistanceM', 10);
    let prev = -Infinity;
    let last = 0;
    let halfwayAt = -1;
    for (let n = 0; n < 180; n++) {
      pos.s += 30 * DT;
      const t = riderAt(road, pos, 30);
      const pose = cam.update(t, DT);
      last = behind(pose, t);
      expect(last).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(last).toBeLessThanOrEqual(10 + 1e-9);
      if (halfwayAt < 0 && last >= 7.75) halfwayAt = n + 1;
      prev = last;
    }
    // It eases (no jump cut): half the 4.5 m change takes several frames at the default stiffness.
    expect(halfwayAt).toBeGreaterThan(10);
    expect(last).toBeCloseTo(10, 2);
  });

  it('swings round to a new heading without overshoot (no road: heading fallback)', () => {
    const cam = createFollowCamera();
    const t0: CameraTarget = { id: 0, x: 0, y: 0, z: 0, heading: 0, speed: 20 };
    cam.snap(t0);
    const t1 = { ...t0, heading: 0.6 };
    let prevYaw = 0;
    let yaw = 0;
    for (let n = 0; n < 240; n++) {
      const pose = cam.update(t1, DT);
      // The camera's bearing from behind the rider, in the heading convention.
      yaw = Math.atan2(pose.x - t1.x, pose.z - t1.z);
      expect(yaw).toBeGreaterThanOrEqual(prevYaw - 1e-9);
      expect(yaw).toBeLessThanOrEqual(0.6 + 1e-9);
      prevYaw = yaw;
    }
    expect(yaw).toBeCloseTo(0.6, 3);
  });

  it('kicks the FOV up with speed, monotonically, and settles at the kick', () => {
    const cam = createFollowCamera();
    const slow: CameraTarget = { id: 0, x: 0, y: 0, z: 0, heading: 0, speed: 0 };
    const base = cam.snap(slow).fov;
    expect(base).toBeCloseTo(DEFAULT('camera.fovBaseDeg'), 6);
    const fast = { ...slow, speed: 38 };
    let prev = base;
    let fov = base;
    for (let n = 0; n < 180; n++) {
      fov = cam.update(fast, DT).fov;
      expect(fov).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(fov).toBeLessThanOrEqual(base + DEFAULT('camera.fovKickDeg') + 1e-9);
      prev = fov;
    }
    expect(fov).toBeCloseTo(base + DEFAULT('camera.fovKickDeg'), 2);
  });

  it('rolls with the lean at the roll fraction, monotonically, in the bike view’s sense', () => {
    const cam = createFollowCamera();
    const upright: CameraTarget = { id: 0, x: 0, y: 0, z: 0, heading: 0, speed: 25, lean: 0 };
    cam.snap(upright);
    const leaning = { ...upright, lean: 0.5 };
    const goal = -0.5 * DEFAULT('camera.rollFraction'); // render turns a bike by rotation.z = -lean
    let prev = 0;
    let pose = cam.update(leaning, DT);
    for (let n = 0; n < 180; n++) {
      pose = cam.update(leaning, DT);
      expect(pose.roll).toBeLessThanOrEqual(prev + 1e-12);
      expect(pose.roll).toBeGreaterThanOrEqual(goal - 1e-12);
      prev = pose.roll;
    }
    expect(pose.roll).toBeCloseTo(goal, 3);
    // The up vector carries the roll: unit length, square to the view, tipped sideways.
    const up = [pose.upX, pose.upY, pose.upZ];
    const view = [pose.lookX - pose.x, pose.lookY - pose.y, pose.lookZ - pose.z];
    expect(Math.hypot(...up)).toBeCloseTo(1, 9);
    expect(up.reduce((s, u, i) => s + u * (view[i] ?? 0), 0)).toBeCloseTo(0, 9);
    // Facing north (-z), a negative rotation.z tips the camera's up toward +x (east).
    expect(pose.upX).toBeGreaterThan(0);
  });

  it('comes out the same at 30 and 60 fps once settled', () => {
    const road = curvyRoad();
    const a = ride(createFollowCamera({ road }), road, { edge: 0, s: 10, d: 1.7, dir: 1 }, 25, 4, 1 / 60);
    const b = ride(createFollowCamera({ road }), road, { edge: 0, s: 10, d: 1.7, dir: 1 }, 25, 4, 1 / 30);
    expect(Math.hypot(a.pose.x - b.pose.x, a.pose.y - b.pose.y, a.pose.z - b.pose.z)).toBeLessThan(0.05);
    expect(Math.abs(a.pose.fov - b.pose.fov)).toBeLessThan(0.05);
  });
});

describe('the low chase cam: no NaN at zero speed or across the junction', () => {
  it('sits low and behind a rider standing still on the grid, frame after frame', () => {
    const road = straightRoad();
    const cam = createFollowCamera({ road });
    const t = riderAt(road, { edge: 0, s: 40, d: 1.7, dir: 1 }, 0);
    for (const dt of [DT, 0, DT, 0.25, DT, Number.NaN, DT]) {
      for (let n = 0; n < 60; n++) {
        const pose = cam.update(t, dt);
        expectFinite(pose);
      }
    }
    const pose = cam.update(t, DT);
    expect(behind(pose, t)).toBeCloseTo(DEFAULT('camera.chaseDistanceM'), 3);
    expect(pose.y - t.y).toBeCloseTo(DEFAULT('camera.heightM'), 3);
    expect(pose.y - t.y).toBeLessThan(2); // low
  });

  it('stays finite standing still with no road, and at every road end', () => {
    const still = createFollowCamera();
    for (let n = 0; n < 120; n++) expectFinite(still.update({ x: 1, y: 2, z: 3, heading: 2, speed: 0 }, DT));

    const road = curvyRoad();
    const ends: RoadPos[] = [
      { edge: 0, s: 0, d: 0, dir: -1 }, // facing the dead end behind the start
      { edge: 0, s: road.edges[0]?.length ?? 0, d: 1.7, dir: 1 }, // exactly on the junction
      { edge: 2, s: road.edges[2]?.length ?? 0, d: 1.7, dir: 1 }, // facing the dead end at the finish
      { edge: 2, s: road.edges[2]?.length ?? 0, d: 0, dir: -1 },
    ];
    for (const pos of ends) {
      const cam = createFollowCamera({ road });
      const t = riderAt(road, pos, 0);
      for (let n = 0; n < 120; n++) expectFinite(cam.update(t, DT));
      expect(behind(cam.update(t, DT), t)).toBeGreaterThan(1);
    }
  });

  it('stays finite for a tumbling rider spinning on the spot', () => {
    const road = straightRoad();
    const cam = createFollowCamera({ road });
    const base = riderAt(road, { edge: 0, s: 300, d: 5, dir: 1 }, 0, { mode: 'Tumble' });
    for (let n = 0; n < 300; n++) {
      expectFinite(cam.update({ ...base, heading: n * 0.9, lean: Math.sin(n) * 1.2, speed: 8 }, DT));
    }
  });

  it('rides through both junctions of a curvy, humped road at top speed, steady and behind', () => {
    const road = curvyRoad();
    const cam = createFollowCamera({ road });
    const pos: RoadPos = { edge: 0, s: 120, d: 1.7, dir: 1 };
    let t = riderAt(road, pos, 38);
    let prev = cam.snap(t);
    const edges = new Set<number>([pos.edge]);
    let frames = 0;
    while (!(pos.edge === 2 && pos.s > 150)) {
      pos.s += 38 * DT;
      expect(road.advance(pos)).toBe('ok');
      edges.add(pos.edge);
      t = riderAt(road, pos, 38);
      const pose = cam.update(t, DT);
      expectFinite(pose);
      const back = behind(pose, t);
      expect(back).toBeGreaterThan(3);
      expect(back).toBeLessThan(8);
      expect(pose.y - t.y).toBeGreaterThan(0.5);
      expect(pose.y - t.y).toBeLessThan(3);
      const f = forwardOf(t);
      expect((pose.lookX - t.x) * f.x + (pose.lookZ - t.z) * f.z).toBeGreaterThan(5); // looks ahead
      // Steady: the camera moves about as far as the bike does each frame (0.63 m), no jumps.
      expect(Math.hypot(pose.x - prev.x, pose.y - prev.y, pose.z - prev.z)).toBeLessThan(1);
      expect(Math.abs(pose.fov - prev.fov)).toBeLessThan(0.5);
      prev = pose;
      frames++;
    }
    expect([...edges]).toEqual([0, 1, 2]);
    expect(frames).toBeGreaterThan(400);
  });

  it('keeps looking the way the rider goes across a to-to junction where d and dir flip', () => {
    const road = flippedJoin();
    const cam = createFollowCamera({ road });
    const pos: RoadPos = { edge: 0, s: 100, d: 1.7, dir: 1 };
    let t = riderAt(road, pos, 30);
    cam.snap(t);
    let flipped = false;
    for (let n = 0; n < 240; n++) {
      pos.s += pos.dir * 30 * DT;
      expect(road.advance(pos)).toBe('ok');
      if (pos.edge === 1) flipped = flipped || pos.dir === -1;
      t = riderAt(road, pos, 30);
      const pose = cam.update(t, DT);
      expectFinite(pose);
      const f = forwardOf(t);
      expect(behind(pose, t)).toBeGreaterThan(3);
      expect((pose.lookX - t.x) * f.x + (pose.lookZ - t.z) * f.z).toBeGreaterThan(5);
    }
    expect(flipped).toBe(true);
  });

  it('stays behind a rider going the wrong way round a tight bend', () => {
    // After 150 m of a 0.01 /m bend the road runs east-west, so a sign slip on either axis shows.
    const road = createRoadNetwork(fixtureNetwork([{ id: 'a', lengthM: 300, kappa: 0.01 }]));
    const cam = createFollowCamera({ road });
    const pos: RoadPos = { edge: 0, s: 180, d: -1.7, dir: -1 };
    let t = riderAt(road, pos, 25);
    cam.snap(t);
    for (let n = 0; n < 120; n++) {
      pos.s -= 25 * DT;
      t = riderAt(road, pos, 25);
      const pose = cam.update(t, DT);
      expectFinite(pose);
      expect(behind(pose, t)).toBeGreaterThan(4);
      const f = forwardOf(t);
      expect((pose.lookX - t.x) * f.x + (pose.lookZ - t.z) * f.z).toBeGreaterThan(10);
    }
  });
});

describe('the low chase cam: the road look-ahead, the target bias and the shake', () => {
  it('aims at a point on the road ahead, so it follows the bend, not the handlebars', () => {
    const road = curvyRoad();
    const cam = createFollowCamera({ road });
    const pos: RoadPos = { edge: 0, s: 100, d: 1.7, dir: 1 };
    const t = riderAt(road, pos, 25);
    // The rider weaves (yaw 0.3 rad off the road); the aim stays on the road ahead.
    const weaving = { ...t, heading: t.heading + 0.3 };
    let pose = cam.snap(weaving);
    for (let n = 0; n < 120; n++) pose = cam.update(weaving, DT);
    const ahead = road.toWorld(0, 100 + DEFAULT('camera.lookAheadM'), 1.7, 0);
    expect(Math.hypot(pose.lookX - ahead.x, pose.lookZ - ahead.z)).toBeLessThan(0.5);
  });

  it('biases the framing toward the auto-target alongside, and lets go when it is gone', () => {
    const road = straightRoad();
    const cam = createFollowCamera({ road });
    const pos: RoadPos = { edge: 0, s: 200, d: 1.7, dir: 1 };
    const me = riderAt(road, pos, 30, { targetId: 1 });
    const rivalAt = road.toWorld(0, 200, -1.7, 0); // alongside, 3.4 m to the left
    const entities = [
      { id: 0, x: me.x, y: me.y, z: me.z },
      { id: 1, x: rivalAt.x, y: rivalAt.y, z: rivalAt.z },
    ];
    const plain = createFollowCamera({ road });
    let biased = cam.snap(me, { entities });
    let neutral = plain.snap({ ...me, targetId: -1 });
    for (let n = 0; n < 120; n++) {
      biased = cam.update(me, DT, { entities });
      neutral = plain.update({ ...me, targetId: -1 }, DT, { entities });
    }
    // Facing north, the left is -x: the aim moves toward the rival and the camera away from it.
    expect(biased.lookX).toBeLessThan(neutral.lookX - 0.3);
    expect(biased.x).toBeGreaterThan(neutral.x + 0.1);
    // Target lost: the framing settles back to neutral.
    for (let n = 0; n < 240; n++) biased = cam.update({ ...me, targetId: -1 }, DT, { entities });
    expect(Math.abs(biased.lookX - neutral.lookX)).toBeLessThan(0.01);
    expect(Math.abs(biased.x - neutral.x)).toBeLessThan(0.01);
  });

  // The followed rider is id 4 (not 0), so a rig that ignored the id would be caught.
  const ME = 4;
  const crash: SimEvent = { tick: 10, type: 'crash', actor: ME, data: {} };
  const othersCrash: SimEvent = { tick: 10, type: 'crash', actor: 0, data: {} };
  const hitOnOther: SimEvent = { tick: 10, type: 'hit', actor: 2, target: 3, data: {} };

  function shakeRun(scale: number | null, events: SimEvent[]): number[] {
    const cam = createFollowCamera();
    if (scale !== null) cam.setParam('camera.shakeScale', scale);
    const t: CameraTarget = { id: ME, x: 0, y: 0, z: 0, heading: 0, speed: 20 };
    const calm = createFollowCamera();
    cam.snap(t);
    calm.snap(t);
    cam.onEvents(events);
    const out: number[] = [];
    for (let n = 0; n < 180; n++) {
      const a = cam.update(t, DT);
      const b = calm.update(t, DT);
      out.push(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) + Math.abs(a.roll - b.roll));
    }
    return out;
  }

  it('shakes on a crash of the followed rider, then settles within about a second', () => {
    const d = shakeRun(null, [crash]);
    expect(Math.max(...d.slice(0, 20))).toBeGreaterThan(0.02);
    expect(Math.max(...d.slice(60))).toBe(0);
  });

  it('scales the shake by camera.shakeScale: none at 0, more at 2', () => {
    expect(Math.max(...shakeRun(0, [crash]))).toBe(0);
    const one = shakeRun(1, [crash]).reduce((s, v) => s + v, 0);
    const two = shakeRun(2, [crash]).reduce((s, v) => s + v, 0);
    expect(two).toBeGreaterThan(one * 1.5);
  });

  it('ignores events that do not involve the followed rider', () => {
    expect(Math.max(...shakeRun(1, [hitOnOther, othersCrash]))).toBe(0);
    // ...and the followed rider taking a hit does shake it.
    const hitOnMe: SimEvent = { tick: 10, type: 'hit', actor: 1, target: ME, data: {} };
    expect(Math.max(...shakeRun(1, [hitOnMe]))).toBeGreaterThan(0);
  });

  it('snaps straight to the ideal pose and clears the shake', () => {
    const cam = createFollowCamera();
    const calm = createFollowCamera();
    const t: CameraTarget = { id: ME, x: 5, y: 1, z: -3, heading: 1, speed: 0 };
    cam.snap(t);
    cam.onEvents([crash]);
    const shaken = cam.update(t, DT);
    expect(shaken).not.toEqual(calm.snap(t));
    cam.onEvents([crash]); // arrives, but the snap comes first
    expect(cam.snap(t)).toEqual(calm.snap(t));
    for (let n = 0; n < 10; n++) expect(cam.update(t, DT)).toEqual(calm.update(t, DT));
  });
});
