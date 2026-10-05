// The verge follows a tight hairpin (playtest 3, wave B's live check, item 6: "on Lombard's crooked
// block the gardens' verge stands up as big green X-shaped frames on the hairpins, and green cubes fly
// when traffic clips them"). The rules, on the real Lombard bake (eight hairpins, radius about 5 m):
// - a garden verge ends in a low hedge that runs along the curve edge to edge on both sides, panel by
//   panel in step with the road, never in fern clumps that pile up inside a bend and stand up as frames;
// - the ground band's edges turn gently from one sample to the next, so the band follows the bend;
// - what flies off a clipped hedge is a few small flat leaves, not cubes.
import { Matrix4, Vector3, type InstancedMesh, type Mesh, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import type { EntitySnapshot, SimEvent, SimSnapshot } from '../sim/api';
import { createFlatLook } from './look';
import { networkTags, type RoadDressing } from './road-mesh';
import { HEDGE_OFF_M, HEDGE_SEG_M, VergeLayer } from './verge';

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

const network = Object.values(networkFiles).find((n) => n.id === 'osm-sf-lombard');
if (!network) throw new Error('no osm-sf-lombard');
const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
const road: RoadNetwork = createRoadNetwork({ network, roads });
const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
const crooked = road.edges.find((e) => e.id === 'osm-sf-lombard-crooked');
if (!crooked) throw new Error('no crooked block');

const named = (root: Object3D, name: string): Mesh[] => {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (o.name === name) out.push(o as Mesh);
  });
  return out;
};

const snap = (entities: EntitySnapshot[]): SimSnapshot => ({
  tick: 0,
  timeScale: 1,
  entities,
  race: { over: false, routeLength: 1, finishOrder: [] },
});

/** A layer with the camera walked down the crooked block, and every hedge panel it drew on the way. */
function walked() {
  const verge = new VergeLayer(road, createFlatLook(), { tags: networkTags(road, dressing).tags });
  const seen = new Map<string, { m: Matrix4; mesh: InstancedMesh }>();
  const ferns: Vector3[] = [];
  for (let s = 0; s <= crooked!.length; s += 30) {
    const p = road.toWorld(crooked!.index, s, 0, 0);
    verge.update(p.x, p.z, snap([]), 1 / 60);
    for (const name of ['verge-hedge', 'verge-hedge-far']) {
      for (const mesh of named(verge.group, name) as unknown as InstancedMesh[]) {
        for (let i = 0; i < mesh.count; i++) {
          const m = new Matrix4();
          mesh.getMatrixAt(i, m);
          seen.set(
            m.elements
              .slice(12, 15)
              .map((v) => v.toFixed(3))
              .join(','),
            { m, mesh },
          );
        }
      }
    }
    for (const name of ['verge-brush', 'verge-brush-far']) {
      for (const mesh of named(verge.group, name) as unknown as InstancedMesh[]) {
        for (let i = 0; i < mesh.count; i++) {
          const m = new Matrix4();
          mesh.getMatrixAt(i, m);
          ferns.push(new Vector3().setFromMatrixPosition(m));
        }
      }
    }
  }
  return { verge, panels: [...seen.values()], ferns };
}

const run = walked();

/** Distance from (x, z) to the segment a..b, m. */
function toSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
}

describe("Lombard's crooked block: the gardens' verge is a hedge that follows the bends", () => {
  it('builds hedge panels, and no fern clumps at all along the block', () => {
    expect(run.panels.length).toBeGreaterThan(80);
    const near = run.ferns.filter((p) => {
      const at = road.project(p.x, p.z, crooked.index);
      return at.edge === crooked.index && Math.abs(at.d) < 8;
    });
    expect(near, 'fern clumps beside the crooked block').toEqual([]);
  });

  it('runs along the verge edge, edge to edge on both sides, round every hairpin', () => {
    const gaps: string[] = [];
    let checked = 0;
    for (let s = 4; s < crooked.length - 4; s += 2) {
      for (const side of [-1, 1] as const) {
        const v = road.vergeAt(crooked.index, s, side < 0 ? 'left' : 'right');
        const p = road.toWorld(crooked.index, s, v.dOuter + side * HEDGE_OFF_M, 0);
        let best = Infinity;
        for (const { m } of run.panels) {
          const e = m.elements;
          const half = (Math.hypot(e[0], e[2]) * HEDGE_SEG_M) / 2;
          const ux = (e[0] / Math.hypot(e[0], e[2])) * half;
          const uz = (e[2] / Math.hypot(e[0], e[2])) * half;
          best = Math.min(best, toSegment(p.x, p.z, e[12] - ux, e[14] - uz, e[12] + ux, e[14] + uz));
        }
        checked++;
        if (best > 0.3) gaps.push(`s ${s} side ${side}: ${best.toFixed(2)} m from the nearest hedge`);
      }
    }
    expect(checked).toBeGreaterThan(150);
    expect(gaps).toEqual([]);
  });

  it('stands low and in step with the road: nothing taller than a hedge, no panel across the curve', () => {
    const crooked0 = crooked;
    const worst: string[] = [];
    for (const { m, mesh } of run.panels) {
      const e = m.elements;
      mesh.geometry.computeBoundingBox();
      const top = (mesh.geometry.boundingBox?.max.y ?? 0) * (e[5] ?? 1);
      if (top > 1) worst.push(`a panel ${top.toFixed(2)} m tall`);
      const at = road.project(e[12], e[14], crooked0.index);
      const f = road.frameAt(at.edge, at.s);
      // The panel's long axis against the road's heading there (either way round).
      const along = Math.abs((e[0] * f.tx + e[2] * f.tz) / (Math.hypot(e[0], e[2]) || 1));
      if (along < Math.cos(0.4))
        worst.push(
          `a panel ${((Math.acos(Math.min(1, along)) * 180) / Math.PI).toFixed(0)} degrees off the road at s ${at.s.toFixed(0)}`,
        );
    }
    expect(worst).toEqual([]);
  });
});

describe('the ground band follows a bend', () => {
  it("turns by no more than about 17 degrees from one sample's edge to the next", () => {
    const verge = run.verge;
    const turns: number[] = [];
    for (const mesh of named(verge.group, 'verge-band')) {
      const pos = mesh.geometry.getAttribute('position');
      // A strip's vertices come in pairs across the band: each side of the pair is one polyline.
      for (const lane of [0, 1]) {
        for (let i = lane + 4; i < pos.count; i += 2) {
          const a = new Vector3().fromBufferAttribute(pos, i - 4);
          const b = new Vector3().fromBufferAttribute(pos, i - 2);
          const c = new Vector3().fromBufferAttribute(pos, i);
          const u = b.clone().sub(a).setY(0);
          const w = c.clone().sub(b).setY(0);
          if (u.length() < 0.05 || w.length() < 0.05 || u.length() > 4 || w.length() > 4) continue;
          // Only the crooked block itself (its junctions are corners the road's own geometry makes).
          const at = road.project(b.x, b.z, crooked.index);
          if (at.edge !== crooked.index || at.s < 2 || at.s > crooked.length - 2) continue;
          turns.push(Math.acos(Math.max(-1, Math.min(1, u.normalize().dot(w.normalize())))));
        }
      }
    }
    expect(turns.length).toBeGreaterThan(300);
    expect(Math.max(...turns)).toBeLessThan(0.3);
  });
});

describe('what flies off clipped ferns and hedges', () => {
  it('is a few small flat leaves, not cubes', () => {
    const verge = new VergeLayer(road, createFlatLook(), { tags: networkTags(road, dressing).tags });
    const ev = { type: 'wobble', tick: 0, actor: 0, data: { cause: 'brush' } } as unknown as SimEvent;
    verge.pushEvents([ev]);
    const rider = {
      id: 0,
      kind: 'rider',
      mode: 'Road',
      x: 0,
      y: 0,
      z: 0,
      heading: 0,
      speed: 3,
      grounded: true,
      ground: 'asphalt',
      road: { edge: 0, s: 5, d: 0, h: 0, dir: 1, yaw: 0 },
    } as unknown as EntitySnapshot;
    verge.update(0, 0, snap([rider]), 1 / 60);
    const leaves = named(verge.group, 'verge-leaves')[0] as unknown as InstancedMesh | undefined;
    expect(leaves, 'a leaf pool in the scene').toBeDefined();
    expect(leaves!.count).toBeGreaterThan(3);
    expect(leaves!.count).toBeLessThanOrEqual(24);
    leaves!.geometry.computeBoundingBox();
    const size = leaves!.geometry.boundingBox!.getSize(new Vector3());
    const dims = [size.x, size.y, size.z].sort((a, b) => a - b);
    expect(dims[0], 'thickness').toBeLessThan(0.06);
    expect(dims[2]!, 'length').toBeLessThan(0.3);
  });
});
