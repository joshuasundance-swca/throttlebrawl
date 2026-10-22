import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  fixtureNetwork,
  planStructures,
  type RoadNetwork,
  type StructurePlan,
  type StructureSpec,
} from '../road';
import {
  createFollowCamera,
  loadReplayCamera,
  type CameraPose,
  type CameraTarget,
  type ReplayCameraMode,
} from './index';
import { armClear, EYE_CLEARANCE_M, insideSolid } from './solids';

const road = createRoadNetwork(fixtureNetwork([{ id: 'a', lengthM: 800, kappa: 0 }]));
const modes: ReplayCameraMode[] = ['trackside', 'orbit'];

function rider(r: RoadNetwork = road, s = 300, d = 0, h = 0): CameraTarget {
  const p = r.toWorld(0, s, d, h);
  const f = r.frameAt(0, s);
  return { ...p, heading: Math.atan2(-f.tx, -f.tz), speed: 18, mode: 'Road', road: { edge: 0 } };
}

function box(x: number, z: number, hu: number, hv: number, baseY = 0, topM = 12): StructureSpec {
  return {
    rule: 'fixture',
    cls: 'building',
    model: null,
    edge: 0,
    s: 300,
    d: 0,
    foot: { x, z, ux: 1, uz: 0, hu, hv },
    baseY,
    roof: { kind: 'flat', topM },
  };
}

// A fixture tag asks for our explicit physical plan; no production scenery inventories are copied.
function physicalPlan(items: StructureSpec[] = []): StructurePlan {
  const bundle = fixtureNetwork([{ id: 'a', lengthM: 800, kappa: 0 }]);
  const first = bundle.roads[0];
  if (!first) throw new Error('fixture road missing');
  const tagged = createRoadNetwork({
    ...bundle,
    roads: [{ ...first, tags: [{ tag: 'replay-fixture', side: 'both', s0: 0, s1: 800 }] }],
  });
  return planStructures(
    tagged,
    3,
    { fixture: { plan: (_r, _seed, out) => items.forEach((s) => out.add(s)) } },
    { fixture: { tags: ['replay-fixture'], load: () => Promise.reject(new Error('planned here')) } },
  );
}

function eyeDistance(p: CameraPose, t: CameraTarget): number {
  return Math.hypot(p.x - t.x, p.y - t.y - 1, p.z - t.z);
}

function framed(p: CameraPose, t: CameraTarget, aspect = 16 / 9): void {
  expect(Object.values(p).every(Number.isFinite)).toBe(true);
  const v = [p.lookX - p.x, p.lookY - p.y, p.lookZ - p.z];
  const length = Math.hypot(...v);
  const f = v.map((n) => n / length);
  const right = [f[1]! * p.upZ - f[2]! * p.upY, f[2]! * p.upX - f[0]! * p.upZ, f[0]! * p.upY - f[1]! * p.upX];
  const dot = (a: number[], b: number[]) => a.reduce((sum, n, i) => sum + n * b[i]!, 0);
  for (const h of [0.2, 2.2])
    for (const dx of [-0.7, 0.7])
      for (const dz of [-0.7, 0.7]) {
        const q = [t.x + dx - p.x, t.y + h - p.y, t.z + dz - p.z];
        const depth = dot(q, f);
        const halfHeight = Math.tan((p.fov * Math.PI) / 360) * depth;
        expect(depth).toBeGreaterThan(0.3);
        expect(Math.abs(dot(q, [p.upX, p.upY, p.upZ]))).toBeLessThan(halfHeight);
        expect(Math.abs(dot(q, right))).toBeLessThan(halfHeight * aspect);
      }
  expect(eyeDistance(p, t)).toBeLessThan(25);
}

function clear(p: CameraPose, t: CameraTarget, structures: StructurePlan): void {
  expect(structures.items.some((s) => insideSolid(s, p.x, p.y, p.z, EYE_CLEARANCE_M))).toBe(false);
  expect(armClear(structures, { x: t.x, y: t.y + 1, z: t.z }, p)).toBe(1);
  framed(p, t);
}

describe('replay-only public camera rigs', () => {
  it('loads through the public entry without changing live view modes or live framing', async () => {
    const live = createFollowCamera({ road });
    const before = live.snap(rider());
    const { createReplayCamera } = await loadReplayCamera();
    createReplayCamera({ road }).pose(rider(), 4, 'orbit', { structures: physicalPlan() });
    expect(live.view).toBe('lowChase');
    expect(live.snap(rider())).toEqual(before);
  });

  it('shows distinct framed trackside and orbit views; a trackside eye holds as the rider passes', async () => {
    const { createReplayCamera } = await loadReplayCamera();
    const cam = createReplayCamera({ road });
    const t = rider();
    const ctx = { structures: physicalPlan() };
    const fixed = cam.pose(t, 1, 'trackside', ctx);
    const next = cam.pose(rider(road, 301), 1.1, 'trackside', ctx);
    expect([next.x, next.y, next.z]).toEqual([fixed.x, fixed.y, fixed.z]);
    const beforeCut = cam.pose(rider(road, 311), 2, 'trackside', ctx);
    const afterCut = cam.pose(rider(road, 313), 2.1, 'trackside', ctx);
    expect([beforeCut.x, beforeCut.y, beforeCut.z]).toEqual([fixed.x, fixed.y, fixed.z]);
    expect(Math.hypot(afterCut.x - beforeCut.x, afterCut.z - beforeCut.z)).toBeGreaterThan(10);
    framed(afterCut, rider(road, 313));
    const orbit = cam.pose(t, 1, 'orbit', ctx);
    expect(Math.hypot(orbit.x - fixed.x, orbit.z - fixed.z)).toBeGreaterThan(2);
    const later = cam.pose(t, 5, 'orbit', ctx);
    expect(Math.hypot(orbit.x - later.x, orbit.z - later.z)).toBeGreaterThan(2);
    for (const p of [fixed, next, orbit, later]) framed(p, t);
  });

  it('uses absolute playback time, holds a paused pose, and reproduces shots after reset', async () => {
    const { createReplayCamera } = await loadReplayCamera();
    for (const mode of modes) {
      const cam = createReplayCamera({ road });
      const ctx = { structures: physicalPlan() };
      const first = cam.pose(rider(), 3.25, mode, ctx);
      expect(cam.pose(rider(), 3.25, mode, ctx)).toEqual(first);
      cam.pose(rider(road, 370), 19, mode, ctx);
      cam.reset();
      expect(cam.pose(rider(), 3.25, mode, ctx)).toEqual(first);
      expect(createReplayCamera({ road }).pose(rider(), 3.25, mode, ctx)).toEqual(first);
    }
  });

  it('falls back to the ordinary bounded follow shot without a structure plan', async () => {
    const { createReplayCamera } = await loadReplayCamera();
    const t = rider();
    const expected = createFollowCamera({ road }).snap(t, { aspect: 2.2 });
    for (const structures of [undefined, null])
      for (const mode of modes) {
        const cam = createReplayCamera({ road });
        expect(cam.pose(t, 3, mode, { aspect: 2.2, structures, lookBack: true })).toEqual(expected);
      }
  });

  it('keeps finite framed outputs on bends and phone/portrait aspects, including invalid clocks', async () => {
    const { createReplayCamera } = await loadReplayCamera();
    const bend = createRoadNetwork(fixtureNetwork([{ id: 'bend', lengthM: 800, kappa: 0.025 }]));
    for (const r of [road, bend])
      for (const mode of modes)
        for (const aspect of [0.5, 16 / 9, 2.4]) {
          const cam = createReplayCamera({ road: r });
          for (const time of [0, 1, 40, -3, NaN, Infinity]) {
            framed(cam.pose(rider(r), time, mode, { structures: physicalPlan(), aspect }), rider(r), aspect);
          }
        }
  });

  it('uses the calm follow shot for reduced motion, unaffected by replay clock or mode', async () => {
    const { createReplayCamera } = await loadReplayCamera();
    const cam = createReplayCamera({ road });
    cam.setMotionAmount(0);
    const ctx = { structures: physicalPlan() };
    const first = cam.pose(rider(), 0, 'orbit', ctx);
    for (const mode of modes) expect(cam.pose(rider(), 50, mode, ctx)).toEqual(first);
    cam.setMotionAmount(NaN);
    expect(cam.pose(rider(), 50, 'orbit', ctx)).not.toEqual(first);
  });

  it('accepts invalid aspects and absent roads without producing invalid camera numbers', async () => {
    const { createReplayCamera } = await loadReplayCamera();
    for (const mode of modes)
      for (const aspect of [NaN, Infinity, 0, -2, 0.0001]) {
        const cam = createReplayCamera();
        const p = cam.pose(rider(), NaN, mode, { aspect, structures: physicalPlan() });
        expect(Object.values(p).every(Number.isFinite)).toBe(true);
        expect(eyeDistance(p, rider())).toBeLessThan(25);
      }
  });

  it('checks the produced eye against dense fronts on both sides over a range of bearings', async () => {
    const { createReplayCamera } = await loadReplayCamera();
    const t = rider();
    const buildings = [-1, 1].flatMap((side) =>
      [-14, -7, 0, 7, 14].map((z) => box(t.x + side * 6, t.z + z, 2, 3, 0, 15)),
    );
    const structures = physicalPlan(buildings);
    for (const mode of modes) {
      const cam = createReplayCamera({ road });
      for (const time of [0, 2, 5, 8, 12]) clear(cam.pose(t, time, mode, { structures }), t, structures);
    }
  });

  it('rejects a wall through the candidate arm and dense frontage around its eye', async () => {
    const { createReplayCamera } = await loadReplayCamera();
    const t = rider();
    for (const mode of modes) {
      const cam = createReplayCamera({ road });
      const open = cam.pose(t, 2, mode, { structures: physicalPlan() });
      const wall = box((t.x + open.x) / 2, (t.z + open.z) / 2, 0.5, 0.5);
      const frontage = box(open.x, open.z, 1, 1);
      const structures = physicalPlan([wall, frontage]);
      expect(structures.items.length).toBeGreaterThan(0);
      expect(insideSolid(structures.items[1]!, open.x, open.y, open.z, 0)).toBe(true);
      expect(armClear(structures, { x: t.x, y: t.y + 1, z: t.z }, open)).toBeLessThan(1);
      const solved = cam.pose(t, 2, mode, { structures });
      expect(solved).not.toEqual(open);
      clear(solved, t, structures);
    }
  });

  it('preserves spaces below a deck and above a roof instead of treating the footprint as a wall', async () => {
    const { createReplayCamera } = await loadReplayCamera();
    const t = rider();
    const roof = physicalPlan([box(t.x, t.z, 30, 30, 0, 6)]);
    const deck = physicalPlan([box(t.x, t.z, 30, 30, 3.8, 0.8)]);
    for (const mode of modes) {
      const cam = createReplayCamera({ road });
      const above = { ...t, y: 6 };
      const high = cam.pose(above, 3, mode, { structures: roof });
      clear(high, above, roof);
      expect(high.y).toBeGreaterThan(6.3);
      const below = cam.pose(t, 3, mode, { structures: deck });
      clear(below, t, deck);
      expect(below.y).toBeLessThan(3.5);
    }
  });

  it('rejects known underground eyes and terrain through an otherwise clear arm', async () => {
    const { createReplayCamera } = await loadReplayCamera();
    const t = rider();
    for (const mode of modes) {
      const cam = createReplayCamera({ road });
      const structures = physicalPlan();
      const open = cam.pose(t, 2, mode, { structures });
      for (const fraction of [0.5, 1]) {
        const x = t.x + (open.x - t.x) * fraction;
        const z = t.z + (open.z - t.z) * fraction;
        const groundHeightAt = (px: number, pz: number) => (Math.hypot(px - x, pz - z) < 0.8 ? 20 : 0);
        const solved = cam.pose(t, 2, mode, { structures, groundHeightAt });
        expect(solved).not.toEqual(open);
        const length = eyeDistance(solved, t);
        for (let i = 1; i <= Math.ceil(length / 0.2); i++) {
          const k = i / Math.ceil(length / 0.2);
          expect(t.y + 1 + (solved.y - t.y - 1) * k).toBeGreaterThan(
            groundHeightAt(t.x + (solved.x - t.x) * k, t.z + (solved.z - t.z) * k) + 0.3,
          );
        }
        framed(solved, t);
      }
    }
  });
});
