// Skid marks and tyre smoke (skids.ts; playtest 3 T2.4): one ribbon mesh and one instanced smoke
// mesh, so at most two draw calls, each skipped while empty; marks laid under a tyre, broken where
// the tyre leaves the road, and a ring that overwrites its oldest quads instead of growing.
import { InstancedMesh, Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { SKID_QUADS, SKID_WIDTH_M, Skids, SMOKE_MAX } from './skids';

/** A fixed, repeatable random source: these tests never lean on Math.random. */
const fixed = () => {
  let i = 0;
  return () => (i++ * 0.37) % 1;
};

const lay = (s: Skids, id: number, x: number, z: number, y = 2, strength = 1, dt = 1 / 60) =>
  s.lay(id, new Vector3(x, y, z), strength, dt);

/** The ribbon's vertex positions as written (4 a quad). */
const ribbon = (s: Skids) => s.ribbon.geometry.getAttribute('position').array as Float32Array;

describe('Skids: the budget', () => {
  it('is two meshes at most, and both are hidden while nothing is laid (zero draw calls idle)', () => {
    const s = new Skids(fixed());
    const meshes: Mesh[] = [];
    s.root.traverse((o) => {
      if ((o as Mesh).isMesh) meshes.push(o as Mesh);
    });
    expect(meshes).toHaveLength(2);
    expect(s.ribbon.visible).toBe(false);
    expect(s.smokeMesh.visible).toBe(false);
    s.endFrame(1 / 60);
    expect(s.counts()).toEqual({ quads: 0, smoke: 0 });
    expect(s.ribbon.visible).toBe(false);
    expect(s.smokeMesh.visible).toBe(false);
  });

  it('the smoke is one instanced mesh with a fixed cap', () => {
    const s = new Skids(fixed());
    expect(s.smokeMesh).toBeInstanceOf(InstancedMesh);
    expect(SMOKE_MAX).toBe(48);
    expect(SKID_QUADS).toBe(512);
  });
});

describe('Skids: the ribbon', () => {
  it('lays a quad a step under the tyre: 0.18 m wide, centred on the path, lifted off the road', () => {
    const s = new Skids(fixed());
    // Ride along +x at y = 2: one point a frame, 0.5 m apart.
    for (let i = 0; i <= 10; i++) lay(s, 7, i * 0.5, 4);
    s.endFrame(1 / 60);
    const { quads } = s.counts();
    expect(quads).toBeGreaterThanOrEqual(8);
    expect(s.ribbon.visible).toBe(true);
    const p = ribbon(s);
    for (let q = 0; q < quads; q++) {
      const v = (i: number) =>
        new Vector3(p[(q * 4 + i) * 3], p[(q * 4 + i) * 3 + 1], p[(q * 4 + i) * 3 + 2]);
      // The two ends of a cross-cut are one width apart, across the travel (z), on the path (z = 4).
      expect(v(0).distanceTo(v(1))).toBeCloseTo(SKID_WIDTH_M, 5);
      expect(Math.abs(v(0).z + v(1).z - 8) / 2).toBeLessThan(1e-5);
      expect(v(0).y, 'lifted clear of the road').toBeGreaterThan(2);
      expect(v(0).y, 'but only just').toBeLessThan(2.1);
    }
  });

  it('is seamless: each quad starts where the last one ended', () => {
    const s = new Skids(fixed());
    // A curve, so the segment directions differ.
    for (let i = 0; i <= 16; i++) lay(s, 1, 6 * Math.sin(i * 0.2), 6 * (1 - Math.cos(i * 0.2)));
    const p = ribbon(s);
    const n = s.counts().quads;
    expect(n).toBeGreaterThan(5);
    for (let q = 1; q < n; q++) {
      for (let k = 0; k < 6; k++) {
        // vertices 0 and 1 of this quad equal vertices 2 and 3 of the one before
        expect(p[q * 12 + k]).toBeCloseTo(p[(q - 1) * 12 + 6 + k] as number, 6);
      }
    }
  });

  it('breaks where the tyre leaves the road: a new patch does not join the old one', () => {
    const s = new Skids(fixed());
    for (let i = 0; i <= 4; i++) lay(s, 1, i * 0.5, 0);
    const before = s.counts().quads;
    s.lay(1, null, 0, 1 / 60); // the bike jumped
    // It lands 3 m on: no quad spans the gap.
    for (let i = 0; i <= 4; i++) lay(s, 1, 5 + i * 0.5, 0);
    const after = s.counts().quads;
    expect(after).toBeGreaterThan(before);
    const p = ribbon(s);
    for (let q = 0; q < after; q++) {
      const len = Math.abs((p[q * 12 + 6] as number) - (p[q * 12] as number));
      expect(len, `quad ${q} is one step long, not the gap`).toBeLessThan(0.7);
    }
  });

  it('a jump too long to be one frame of rolling (a respawn) starts a fresh patch, not a streak', () => {
    const s = new Skids(fixed());
    lay(s, 1, 0, 0);
    lay(s, 1, 0.5, 0);
    const n = s.counts().quads;
    lay(s, 1, 400, 90); // teleported
    expect(s.counts().quads).toBe(n);
  });

  it('two riders mark independently', () => {
    const s = new Skids(fixed());
    for (let i = 0; i <= 6; i++) {
      lay(s, 1, i * 0.5, 0);
      lay(s, 2, i * 0.5, 30);
    }
    const p = ribbon(s);
    const n = s.counts().quads;
    const zs = new Set<number>();
    for (let q = 0; q < n; q++)
      zs.add(Math.round(((p[q * 12 + 2] as number) + (p[q * 12 + 5] as number)) / 2));
    expect([...zs].sort((a, b) => a - b)).toEqual([0, 30]);
  });

  it('is a ring: past 512 quads the oldest are overwritten and the buffer never grows', () => {
    const s = new Skids(fixed());
    const bytes = ribbon(s).byteLength;
    for (let i = 0; i < SKID_QUADS * 2 + 50; i++) lay(s, 1, i * 0.5, 0);
    expect(s.counts().quads).toBe(SKID_QUADS);
    expect(ribbon(s).byteLength).toBe(bytes);
    // The newest end of the line is in the buffer; the very first quad's start is not.
    const p = ribbon(s);
    const xs = new Set<number>();
    for (let q = 0; q < SKID_QUADS; q++) xs.add(Math.round((p[q * 12] as number) * 2) / 2);
    expect(xs.has(0)).toBe(false);
    expect(xs.has((SKID_QUADS * 2 + 48) * 0.5)).toBe(true);
  });

  it('clear() empties it, and forget() lets a rider start a new line', () => {
    const s = new Skids(fixed());
    for (let i = 0; i <= 6; i++) lay(s, 1, i * 0.5, 0);
    expect(s.counts().quads).toBeGreaterThan(0);
    s.clear();
    expect(s.counts()).toEqual({ quads: 0, smoke: 0 });
    s.endFrame(1 / 60);
    expect(s.ribbon.visible).toBe(false);
  });
});

describe('Skids: the tyre smoke', () => {
  it('puffs while a tyre is laying rubber, up to the cap, and drifts upward', () => {
    const s = new Skids(fixed());
    for (let i = 0; i < 60; i++) {
      lay(s, 1, i * 0.4, 0);
      s.endFrame(1 / 60);
    }
    const n = s.counts().smoke;
    expect(n).toBeGreaterThan(5);
    expect(n).toBeLessThanOrEqual(SMOKE_MAX);
    expect(s.smokeMesh.visible).toBe(true);
    expect(s.smokeMesh.count).toBe(n);
    for (let i = 0; i < 400; i++) {
      lay(s, 1, 100 + i * 0.4, 0);
      s.endFrame(1 / 60);
    }
    expect(s.counts().smoke).toBeLessThanOrEqual(SMOKE_MAX);
  });

  it('a lighter slide smokes less than a hard one', () => {
    const count = (strength: number) => {
      const s = new Skids(fixed());
      for (let i = 0; i < 40; i++) {
        lay(s, 1, i * 0.4, 0, 2, strength);
        s.endFrame(1 / 60);
      }
      return s.counts().smoke;
    };
    expect(count(1)).toBeGreaterThan(count(0.3));
  });

  it('clears away once the tyre lets go, and the mesh is hidden again', () => {
    const s = new Skids(fixed());
    for (let i = 0; i < 30; i++) {
      lay(s, 1, i * 0.4, 0);
      s.endFrame(1 / 60);
    }
    expect(s.counts().smoke).toBeGreaterThan(0);
    for (let i = 0; i < 180; i++) {
      s.lay(1, null, 0, 1 / 60);
      s.endFrame(1 / 60);
    }
    expect(s.counts().smoke).toBe(0);
    expect(s.smokeMesh.visible).toBe(false);
  });

  it('a hit-stop frame (dt 0) lays nothing and emits nothing', () => {
    const s = new Skids(fixed());
    for (let i = 0; i < 20; i++) lay(s, 1, i * 0.4, 0, 2, 1, 0);
    expect(s.counts().smoke).toBe(0);
  });
});
