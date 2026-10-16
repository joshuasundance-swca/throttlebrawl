import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork, terrainAt, type BakedTerrainPatch } from '../../road';
import { centre, makeCluster, stepCluster } from './rig';

function patch(y: number, slope = 0, surface: BakedTerrainPatch['surface'] = 'grass'): BakedTerrainPatch {
  return {
    surface,
    vertices: [
      [-100, y - 100 * slope, -200],
      [-100, y - 100 * slope, 0],
      [100, y + 100 * slope, -200],
      [100, y + 100 * slope, 0],
    ],
    triangles: [
      [0, 1, 2],
      [2, 1, 3],
    ],
  };
}

function fixture(patches?: BakedTerrainPatch[], barrier = false) {
  const bundle = fixtureNetwork([{ id: 'straight', lengthM: 200, kappa: 0 }]);
  return createRoadNetwork({
    ...bundle,
    network: { ...bundle.network, ...(patches ? { terrain: { patches } } : {}) },
    roads: bundle.roads.map((r) => ({
      ...r,
      barriers: barrier
        ? [{ s0: 0, s1: 200, side: 'right' as const, kind: 'rail' as const, heightM: 2 }]
        : [],
    })),
  });
}

function cluster(road: ReturnType<typeof fixture>, x: number, y: number, kind: 'rider' | 'bike' = 'bike') {
  return makeCluster(
    kind,
    { x, y, z: -100 },
    { fx: 0, fz: -1, rx: 1, rz: 0 },
    { x: 0, y: -1, z: 0 },
    { x: 0, y: 0, z: 0 },
    0,
  );
}

describe('crash particles on authored source terrain', () => {
  it.each([
    { sign: -1, kind: 'bike' as const },
    { sign: 1, kind: 'bike' as const },
    { sign: -1, kind: 'rider' as const },
    { sign: 1, kind: 'rider' as const },
  ])('contacts each F32 face on a $sign slope with $kind without clamping to road', ({ sign, kind }) => {
    const road = fixture([patch(sign * 4.1, sign * 0.12)]);
    const c = cluster(road, 30, sign * 4.1 + sign * 0.12 * 30 + 0.2, kind);
    let contact = stepCluster(road, c, 1 / 60, 1, true, undefined, true);
    for (let tick = 1; tick < 180; tick++) contact = stepCluster(road, c, 1 / 60, 1, true, undefined, true);
    expect(c.overboard).toBe(false);
    expect(c.splashed).toBe(false);
    expect(centre(c.p).x).toBeGreaterThan(20);
    for (const q of c.p) expect(q.y).toBeGreaterThanOrEqual(terrainAt(road.terrain, q.x, q.z)!.y - 1e-6);
    expect(Math.min(...c.p.map((q) => q.y - terrainAt(road.terrain, q.x, q.z)!.y))).toBeLessThan(0.06);
    expect(contact.ground).toBeCloseTo(terrainAt(road.terrain, centre(c.p).x, centre(c.p).z)!.y, 4);
  });

  it('reflects incoming velocity along the actual face normal', () => {
    const road = fixture([patch(2.1, 0.3)]);
    const c = cluster(road, 30, 11);
    c.p = [{ x: 30, y: 11.11, z: -100, vx: 0, vy: -5, vz: 0, edge: 0 }];
    const normal = terrainAt(road.terrain, 30, -100)!.normal;
    stepCluster(road, c, 1 / 60, 0, true, undefined, true);
    const q = c.p[0]!;
    expect(q.vx).toBeLessThan(0);
    expect(q.vx * normal.x + q.vy * normal.y + q.vz * normal.z).toBeGreaterThan(1);
  });

  it('does not lift a body onto a face above its previous height', () => {
    const road = fixture([patch(-4), patch(15)]);
    const c = cluster(road, 30, -3.8);
    for (let tick = 0; tick < 120; tick++) stepCluster(road, c, 1 / 60, 1, true, undefined, true);
    expect(c.overboard).toBe(false);
    expect(Math.min(...c.p.map((q) => q.y))).toBeCloseTo(-4, 4);
    expect(Math.max(...c.p.map((q) => q.y))).toBeLessThan(0);
  });

  it.each([{ patches: [] }, { patches: [patch(-4, 0, 'water')] }])(
    'does not invent a solid road outside terrain coverage',
    ({ patches }) => {
      const road = fixture(patches);
      const c = cluster(road, 30, -1);
      for (let tick = 0; tick < 30; tick++) {
        const contact = stepCluster(road, c, 1 / 60, 1, true, undefined, true);
        expect(Number.isFinite(contact.ground)).toBe(true);
        expect(Number.isFinite(Math.max(0, centre(c.p).y - contact.ground))).toBe(true);
      }
      expect(centre(c.p).x).toBeCloseTo(30);
      expect(centre(c.p).y).toBeLessThan(-1);
      expect(c.overboard).toBe(true);
      for (let tick = 0; tick < 90; tick++) stepCluster(road, c, 1 / 60, 1, true, undefined, true);
      expect(c.splashed).toBe(patches.length > 0);
      if (c.splashed) expect(centre(c.p).y).toBeCloseTo(-4);
    },
  );

  it('splashes at source water above land rather than resting dry underneath it', () => {
    const road = fixture([patch(-4), patch(2, 0, 'water')]);
    const c = cluster(road, 30, 2.2);
    for (let tick = 0; tick < 120; tick++) stepCluster(road, c, 1 / 60, 1, true, undefined, true);
    expect(c.splashed).toBe(true);
    expect(centre(c.p).y).toBeCloseTo(2);
  });

  it('crosses a soft road band continuously and does not feel a distant barrier', () => {
    const road = fixture([patch(0)]);
    const outer = road.vergeAt(0, 100, 'right').dOuter;
    const c = cluster(road, outer - 0.1, 0.1);
    for (const q of c.p) q.vx = 4;
    for (let tick = 0; tick < 60; tick++) {
      const result = stepCluster(road, c, 1 / 60, 0, true, undefined, true);
      expect(result.railOver).toBe(false);
    }
    expect(centre(c.p).x).toBeGreaterThan(outer + 2);
    const railed = fixture([patch(0)], true);
    const far = cluster(railed, 30, 0.1);
    stepCluster(railed, far, 1 / 60, 1, true, undefined, true);
    expect(centre(far.p).x).toBeCloseTo(30);
    const line = railed.vergeAt(0, 100, 'right').dOuter;
    const near = cluster(railed, line - 0.4, 0.1);
    for (const q of near.p) q.vx = 6;
    stepCluster(railed, near, 1 / 60, 1, true, undefined, true);
    expect(centre(near.p).x).toBeLessThanOrEqual(line);
    expect(centre(near.p).vx).toBeLessThan(0);
    const outside = cluster(railed, line + 0.4, 0.1);
    for (const q of outside.p) q.vx = -6;
    stepCluster(railed, outside, 1 / 60, 1, true, undefined, true);
    expect(centre(outside.p).x).toBeGreaterThan(line);
    expect(Math.min(...outside.p.map((q) => q.x))).toBeGreaterThanOrEqual(line - 1e-6);
    expect(centre(outside.p).vx).toBeGreaterThan(0);
  });

  it('preserves already-overboard flight above road until actual water contact without another crossing event', () => {
    const road = fixture([patch(-4, 0, 'water')]);
    const c = cluster(road, 30, 5);
    c.overboard = true;
    for (let tick = 0; tick < 180 && !c.splashed; tick++) {
      const contact = stepCluster(road, c, 1 / 60, 0, true, undefined, true);
      expect(c.overboard).toBe(true);
      expect(contact.railOver).toBe(false);
    }
    expect(c.splashed).toBe(true);
    expect(centre(c.p).y).toBeCloseTo(-4);
  });

  it('ends existing overboard flight only when supporting land actually catches a particle', () => {
    const road = fixture([patch(-4)]);
    const c = cluster(road, 30, 5);
    c.overboard = true;
    stepCluster(road, c, 1 / 60, 0, true, undefined, true);
    expect(c.overboard).toBe(true);
    for (let tick = 0; tick < 180 && c.overboard; tick++) {
      const contact = stepCluster(road, c, 1 / 60, 1, true, undefined, true);
      expect(contact.railOver).toBe(false);
    }
    expect(c.overboard).toBe(false);
    expect(Math.min(...c.p.map((q) => q.y))).toBeCloseTo(-4, 4);
  });

  it('keeps actual road and roof support and the omitted-terrain barrier rule', () => {
    for (const patches of [undefined, []]) {
      const road = fixture(patches);
      const c = cluster(road, 0, 0.1);
      for (let tick = 0; tick < 120; tick++) stepCluster(road, c, 1 / 60, 1, true, undefined, true);
      expect(Math.min(...c.p.map((q) => q.y))).toBeCloseTo(0, 4);
    }
    const road = fixture([]);
    const roof = cluster(road, 30, 4.1);
    for (let tick = 0; tick < 120; tick++) stepCluster(road, roof, 1 / 60, 1, true, () => 4, true);
    expect(Math.min(...roof.p.map((q) => q.y))).toBeCloseTo(4, 4);
    const legacy = fixture();
    const c = cluster(legacy, 30, 0);
    stepCluster(legacy, c, 1 / 60, 1, true);
    expect(centre(c.p).x).toBeLessThan(30);
  });
});
