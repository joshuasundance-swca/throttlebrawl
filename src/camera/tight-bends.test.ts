import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork, type RoadNetwork, type RoadPos } from '../road';
import { CAMERA_TUNING, createFollowCamera, type CameraTarget } from './index';

// Playtest 4, P4-9 (audit F9b): "Lombard's hairpins feel impossible to control smoothly". The
// hairpins are about 21 m apart and the chase cam aimed 18 m ahead, so the aim swung from one
// hairpin's apex to the next. On a tight bend the look-ahead shortens to the bend's radius over
// `camera.tightBendRadiusM` (30 m), never under `camera.tightBendMinShare` of it, so the aim stays
// on the bend the rider is in. A straight and a long bend are exactly as before.

const DT = 1 / 60;
const DEFAULT = (id: string): number => {
  const d = CAMERA_TUNING.find((p) => p.id === id);
  if (!d) throw new Error(`no tuning declaration ${id}`);
  return d.default;
};

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

/** One long bend of this radius. */
function bendRoad(radiusM: number): RoadNetwork {
  return createRoadNetwork(fixtureNetwork([{ id: 'a', lengthM: 600, kappa: radiusM > 0 ? 1 / radiusM : 0 }]));
}

/**
 * How far ahead along the road (m of arc) the settled camera aims, for a rider standing mid-bend on
 * the road's middle: the aim's straight-line distance, turned back into the arc it spans.
 */
function aimAheadM(radiusM: number, tuning: Record<string, number> = {}): number {
  const road = bendRoad(radiusM);
  const cam = createFollowCamera({ road });
  for (const [k, v] of Object.entries(tuning)) cam.setParam(k, v);
  const pos: RoadPos = { edge: 0, s: 200, d: 0, dir: 1 };
  const t = riderAt(road, pos, 10);
  let pose = cam.snap(t);
  for (let n = 0; n < 300; n++) pose = cam.update(t, DT);
  const chord = Math.hypot(pose.lookX - t.x, pose.lookZ - t.z);
  return radiusM > 0 ? 2 * radiusM * Math.asin(Math.min(1, chord / (2 * radiusM))) : chord;
}

describe('the chase cam on tight bends (playtest 4, P4-9)', () => {
  it('declares the radius and the floor as camera tuning that never affects the sim', () => {
    for (const id of ['camera.tightBendRadiusM', 'camera.tightBendMinShare']) {
      const p = CAMERA_TUNING.find((d) => d.id === id);
      expect(p, id).toBeDefined();
      expect(p?.affectsSim).toBe(false);
    }
  });

  it('aims the full look-ahead on a straight and on a long bend, as before', () => {
    const full = DEFAULT('camera.lookAheadM');
    expect(aimAheadM(0)).toBeCloseTo(full, 0);
    expect(aimAheadM(150)).toBeCloseTo(full, 0);
    expect(aimAheadM(DEFAULT('camera.tightBendRadiusM'))).toBeCloseTo(full, 0);
  });

  it('shortens the look-ahead by the bend radius over the tight-bend radius, down to the floor', () => {
    const full = DEFAULT('camera.lookAheadM');
    const r0 = DEFAULT('camera.tightBendRadiusM');
    const floor = DEFAULT('camera.tightBendMinShare');
    expect(aimAheadM(20)).toBeCloseTo(full * (20 / r0), 0);
    expect(aimAheadM(5)).toBeCloseTo(full * floor, 0);
    // Tighter bends never aim closer than the floor.
    expect(aimAheadM(2.5)).toBeCloseTo(full * floor, 0);
  });

  it('turns off at a radius of 0', () => {
    expect(aimAheadM(8, { 'camera.tightBendRadiusM': 0 })).toBeCloseTo(DEFAULT('camera.lookAheadM'), 0);
  });

  it('a chain of hairpins swings the view less than it did', () => {
    // Hairpins about 21 m apart (R 5 m, 16 m of arc, a short straight between), alternating sides.
    const pieces = [];
    for (let i = 0; i < 8; i++) {
      pieces.push({ id: `h${i}`, lengthM: 16, kappa: (i % 2 === 0 ? 1 : -1) / 5 });
      pieces.push({ id: `s${i}`, lengthM: 5, kappa: 0 });
    }
    const road = createRoadNetwork(fixtureNetwork(pieces));
    const swing = (tuning: Record<string, number>): { swing: number; offCentre: number } => {
      const cam = createFollowCamera({ road });
      for (const [k, v] of Object.entries(tuning)) cam.setParam(k, v);
      const pos: RoadPos = { edge: 0, s: 1, d: 0, dir: 1 };
      cam.snap(riderAt(road, pos, 9));
      let prev: number | null = null;
      let worst = 0;
      let off = 0;
      for (let n = 0; n < 15 * 60; n++) {
        pos.s += 9 * DT;
        if (road.advance(pos) === 'deadEnd') break;
        const t = riderAt(road, pos, 9);
        const pose = cam.update(t, DT);
        // The view's bearing, from the camera to what it looks at.
        const bearing = Math.atan2(pose.lookX - pose.x, pose.lookZ - pose.z);
        if (prev !== null) {
          const d = Math.atan2(Math.sin(bearing - prev), Math.cos(bearing - prev));
          worst = Math.max(worst, Math.abs(d) / DT);
        }
        prev = bearing;
        // How far the rider sits from the middle of the view.
        const toRider = Math.atan2(t.x - pose.x, t.z - pose.z);
        off = Math.max(off, Math.abs(Math.atan2(Math.sin(toRider - bearing), Math.cos(toRider - bearing))));
      }
      return { swing: (worst * 180) / Math.PI, offCentre: (off * 180) / Math.PI };
    };
    const before = swing({ 'camera.tightBendRadiusM': 0 });
    const after = swing({});
    console.log(
      `[examined] hairpin chain (R 5 m every 21 m) at 9 m/s, peak view swing: ${before.swing.toFixed(0)} deg/s ` +
        `before, ${after.swing.toFixed(0)} deg/s now; the rider furthest from the view's centre: ` +
        `${before.offCentre.toFixed(0)} deg before, ${after.offCentre.toFixed(0)} deg now`,
    );
    expect(after.swing).toBeLessThan(before.swing * 0.85);
    // And the bike stays in frame, nearer the middle than it was (a 16:9 view is about 45 degrees to
    // each side of the middle).
    expect(after.offCentre).toBeLessThan(before.offCentre);
    expect(after.offCentre).toBeLessThan(45);
  });
});
