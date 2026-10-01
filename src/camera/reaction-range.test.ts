import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork, type RoadNetwork, type RoadPos } from '../road';
import { createFollowCamera, type CameraPose, type CameraTarget } from './index';

// Playtest 1 (2026-09-30), amendment item 1 [decided]: "Camera too low to see oncoming traffic".
// The chase cam must show an oncoming car at the reaction range, about 125 m (M1's starting
// numbers: closing speed x 2 s = (38.0 + 24.6) x 2). "Show" means two things, both checked with
// the same three.js calls render/index.ts makes (position, lookAt, rotateZ(roll)):
//   1. every corner of the car projects inside the view (x and y in -1..1, in front of the camera);
//   2. the rider's own silhouette does not cover it: the car's projected box does not overlap the
//      projected box around the player's rider and bike. M1's camera sat at 1.6 m, below the
//      rider's helmet, so the rider hid the horizon exactly where oncoming traffic appears.
// The rider envelope is a box around render/views.ts's riding parts, with a margin: the bars are
// 0.7 m wide, the helmet top is 1.1 + 0.66 + 0.15 = 1.91 m and the wheels reach about +-0.97 m.
// The car is render's default car: 4.4 m long, 1.8 m wide, 1.45 m tall.

const DT = 1 / 60;
const REACTION_RANGE_M = 125;
const ENVELOPE = { halfWidth: 0.4, height: 2.0, halfLength: 1.0 };
const CAR = { halfWidth: 0.9, height: 1.45, halfLength: 2.2 };
/** The maintainer's phone in landscape (debug report: 1248x576), and a plain 16:9 screen. */
const ASPECTS = [1248 / 576, 16 / 9];

function straightRoad(): RoadNetwork {
  return createRoadNetwork(fixtureNetwork([{ id: 'a', lengthM: 1000, kappa: 0 }]));
}

/** A long gentle bend: 125 m along it the road has turned about 29 degrees. */
function bend(): RoadNetwork {
  return createRoadNetwork(fixtureNetwork([{ id: 'a', lengthM: 1000, kappa: 0.004 }]));
}

function riderAt(road: RoadNetwork, pos: RoadPos, speed: number): CameraTarget {
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
    road: pos,
  };
}

/** The 8 corners of a box standing on the road at (s, d), aligned with the road there. */
function boxOnRoad(
  road: RoadNetwork,
  s: number,
  d: number,
  box: { halfWidth: number; height: number; halfLength: number },
): Vector3[] {
  const c = road.toWorld(0, s, d, 0);
  const f = road.frameAt(0, s);
  const rx = f.tz; // right of the road's tangent, horizontal
  const rz = -f.tx;
  const out: Vector3[] = [];
  for (const a of [-1, 1])
    for (const b of [-1, 1])
      for (const y of [0, box.height]) {
        out.push(
          new Vector3(
            c.x + f.tx * a * box.halfLength + rx * b * box.halfWidth,
            c.y + y,
            c.z + f.tz * a * box.halfLength + rz * b * box.halfWidth,
          ),
        );
      }
  return out;
}

/** The render camera for a pose, built exactly as render/index.ts builds it. */
function renderCamera(pose: CameraPose, aspect: number): PerspectiveCamera {
  const cam = new PerspectiveCamera(pose.fov, aspect, 0.3, 1500);
  cam.position.set(pose.x, pose.y, pose.z);
  cam.lookAt(pose.lookX, pose.lookY, pose.lookZ);
  if (pose.roll) cam.rotateZ(pose.roll);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function project(points: Vector3[], cam: PerspectiveCamera): { rect: Rect; inView: boolean } {
  let inView = true;
  const rect = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const p of points) {
    // In front of the camera (camera space z < 0) before projecting.
    const local = p.clone().applyMatrix4(cam.matrixWorldInverse);
    if (local.z >= -cam.near) inView = false;
    const n = p.clone().project(cam);
    if (Math.abs(n.x) > 1 || Math.abs(n.y) > 1 || n.z > 1) inView = false;
    rect.x0 = Math.min(rect.x0, n.x);
    rect.x1 = Math.max(rect.x1, n.x);
    rect.y0 = Math.min(rect.y0, n.y);
    rect.y1 = Math.max(rect.y1, n.y);
  }
  return { rect, inView };
}

const overlaps = (a: Rect, b: Rect): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

interface Sighting {
  inView: boolean;
  hiddenByRider: boolean;
  /** The car's projected height in CSS pixels on a 576 px tall screen. */
  heightPx: number;
  /** The mode the camera showed, and how far it sat from the rider, horizontally. */
  mode: string;
  back: number;
}

/**
 * Settles the camera behind a rider at (s, riderD) and looks for a car `REACTION_RANGE_M` further
 * along the road, in lane `carD`.
 */
function sight(
  road: RoadNetwork,
  riderD: number,
  carD: number,
  speed: number,
  aspect: number,
  params: Record<string, number> = {},
): Sighting {
  const cam = createFollowCamera({ road });
  for (const [id, v] of Object.entries(params)) cam.setParam(id, v);
  const s = 200;
  const t = riderAt(road, { edge: 0, s, d: riderD, dir: 1 }, speed);
  // The camera knows the view's shape, as the app tells it (playtest 1 item 11: phones sit higher).
  let pose = cam.snap(t, { aspect });
  for (let n = 0; n < 240; n++) pose = cam.update(t, DT, { aspect });
  const view = renderCamera(pose, aspect);
  const car = project(boxOnRoad(road, s + REACTION_RANGE_M, carD, CAR), view);
  const rider = project(boxOnRoad(road, s, riderD, ENVELOPE), view);
  return {
    inView: car.inView,
    hiddenByRider: overlaps(car.rect, rider.rect),
    heightPx: ((car.rect.y1 - car.rect.y0) / 2) * 576,
    mode: cam.mode,
    back: Math.hypot(pose.x - t.x, pose.z - t.z),
  };
}

// Lanes of the hand-made road: travel lanes centred 1.7 m either side of the centre line.
const MY_LANE = 1.7;
const ONCOMING_LANE = -1.7;

describe('playtest 1: an oncoming car at the reaction range is in view', () => {
  const cases = [
    { name: 'in the oncoming lane', riderD: MY_LANE, carD: ONCOMING_LANE },
    { name: 'head-on, while you ride the oncoming lane', riderD: ONCOMING_LANE, carD: ONCOMING_LANE },
    { name: 'head-on in your own lane', riderD: MY_LANE, carD: MY_LANE },
  ];
  let examined = 0;

  for (const c of cases) {
    it(`sees a car 125 m ahead ${c.name}, standing and at top speed, on both screen shapes`, () => {
      for (const speed of [0, 38, 45])
        for (const aspect of ASPECTS)
          for (const road of [straightRoad(), bend()]) {
            const seen = sight(road, c.riderD, c.carD, speed, aspect);
            const where = `speed ${speed}, aspect ${aspect.toFixed(2)}`;
            expect(seen.inView, `car out of view (${where})`).toBe(true);
            expect(seen.hiddenByRider, `car hidden behind the rider (${where})`).toBe(false);
            expect(seen.heightPx).toBeGreaterThan(3);
            examined++;
          }
    });
  }

  it('examined every case, and prints how big the car is', () => {
    const straight = sight(straightRoad(), MY_LANE, ONCOMING_LANE, 38, ASPECTS[0] ?? 2);
    console.log(
      `[examined] ${examined} sightings of a car at ${REACTION_RANGE_M} m; at top speed on the phone's ` +
        `screen it is ${straight.heightPx.toFixed(1)} CSS px tall`,
    );
    expect(examined).toBe(cases.length * 3 * ASPECTS.length * 2);
  });

  it("catches the complaint: M1's low camera (5.5 m back, 1.6 m up) hides the car behind the rider", () => {
    const m1 = {
      'camera.chaseDistanceM': 5.5,
      'camera.heightM': 1.6,
      'camera.wideHeightM': 0,
      'camera.wideDistanceM': 0,
    };
    for (const c of cases) {
      const seen = sight(straightRoad(), c.riderD, c.carD, 38, ASPECTS[0] ?? 2, m1);
      expect(seen.hiddenByRider, c.name).toBe(true);
    }
  });
});

// camera-3 (docs/milestones/M3.md): the same sight check for the far chase cam and the helmet cam.
// The far chase cam must pass it exactly as the low chase cam does. The helmet cam sits inside the
// rider's own helmet, so the rider's silhouette cannot be in front of it; instead the sight line
// from the camera to every corner of the car must pass above the bike's bars and tank (1.15 m,
// render/views.ts) at the bars' distance ahead of the rider.
describe('camera-3: the far chase and helmet cams see the car at 125 m too', () => {
  const cases = [
    { name: 'in the oncoming lane', riderD: MY_LANE, carD: ONCOMING_LANE },
    { name: 'head-on, while you ride the oncoming lane', riderD: ONCOMING_LANE, carD: ONCOMING_LANE },
    { name: 'head-on in your own lane', riderD: MY_LANE, carD: MY_LANE },
  ];
  const BARS = { aheadM: 0.7, heightM: 1.15 };

  it('far chase: in view and clear of the rider, standing and at top speed, on both screen shapes', () => {
    let examined = 0;
    for (const c of cases)
      for (const speed of [0, 38, 45])
        for (const aspect of ASPECTS)
          for (const road of [straightRoad(), bend()]) {
            const seen = sight(road, c.riderD, c.carD, speed, aspect, { 'camera.mode': 1 });
            const where = `${c.name}, speed ${speed}, aspect ${aspect.toFixed(2)}`;
            // It is the far view: further back than the low chase cam ever sits (7 m, or 8 on a phone).
            expect(seen.mode).toBe('farChase');
            expect(seen.back, where).toBeGreaterThan(9);
            expect(seen.inView, `car out of view (${where})`).toBe(true);
            expect(seen.hiddenByRider, `car hidden behind the rider (${where})`).toBe(false);
            expect(seen.heightPx).toBeGreaterThan(3);
            examined++;
          }
    console.log(`[examined] ${examined} far-chase sightings of a car at ${REACTION_RANGE_M} m`);
    expect(examined).toBe(cases.length * 3 * ASPECTS.length * 2);
  });

  it('helmet: in view, and every sight line to the car clears the bars', () => {
    let examined = 0;
    for (const c of cases)
      for (const speed of [0, 38, 45])
        for (const aspect of ASPECTS)
          for (const road of [straightRoad(), bend()]) {
            const cam = createFollowCamera({ road });
            cam.setParam('camera.mode', 2);
            const s = 200;
            const t = riderAt(road, { edge: 0, s, d: c.riderD, dir: 1 }, speed);
            let pose = cam.snap(t, { aspect });
            for (let n = 0; n < 240; n++) pose = cam.update(t, DT, { aspect });
            // It is the helmet view: the camera is at the rider's eyes, not behind the bike.
            expect(cam.mode).toBe('helmet');
            expect(Math.hypot(pose.x - t.x, pose.z - t.z)).toBeLessThan(0.5);
            const view = renderCamera(pose, aspect);
            const corners = boxOnRoad(road, s + REACTION_RANGE_M, c.carD, CAR);
            const car = project(corners, view);
            const where = `${c.name}, speed ${speed}, aspect ${aspect.toFixed(2)}`;
            expect(car.inView, `car out of view (${where})`).toBe(true);
            expect(((car.rect.y1 - car.rect.y0) / 2) * 576).toBeGreaterThan(3);
            // The bars' plane: BARS.aheadM in front of the rider, along the road.
            const f = road.frameAt(0, s);
            const camAhead = (pose.x - t.x) * f.tx + (pose.z - t.z) * f.tz;
            for (const p of corners) {
              const pAhead = (p.x - t.x) * f.tx + (p.z - t.z) * f.tz;
              const k = (BARS.aheadM - camAhead) / (pAhead - camAhead);
              const yAtBars = pose.y + (p.y - pose.y) * k;
              expect(yAtBars - t.y, `sight line through the bars (${where})`).toBeGreaterThan(BARS.heightM);
            }
            examined++;
          }
    console.log(`[examined] ${examined} helmet sightings of a car at ${REACTION_RANGE_M} m`);
    expect(examined).toBe(cases.length * 3 * ASPECTS.length * 2);
  });
});
