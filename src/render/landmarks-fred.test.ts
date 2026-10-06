// Fred the Tree (playtest 4, P4-15; the maintainer: "Old seven mile bridge should have Fred the Tree"):
// the little Australian pine that grows out of the old Seven Mile Bridge's deck. A code-made landmark
// (`keys-landmarks#fred_the_tree`, composed in landmarks.ts from fred.ts's soup, no model file), placed
// by the bake on the old road. The rules checked here: the committed bake finds him and the layer
// draws him in its one call; he is tall enough to read from a rider's eye at a distance and from the
// new highway; and he keeps clear of the rider's reach, whatever the geometry: nothing of him stands
// over the drive lanes, and only crown, high up, hangs over the shoulder.
import { Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad } from '../road';
import { fredSoup } from './fred';
import { LANDMARK_MID_M, LandmarkLayer, landmarkKitsFor, landmarkPlacements } from './landmarks';
import { createFlatLook } from './look';
import type { LandmarkKit } from './models';

const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`[examined] ${line}\n`);
const look = createFlatLook();

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/base/regions/florida-keys/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/base/regions/florida-keys/roads/*.json', {
  eager: true,
  import: 'default',
});

function sevenMile() {
  const network = Object.values(networkFiles).find((n) => n.id === 'osm-keys-seven-mile');
  if (!network) throw new Error('no osm-keys-seven-mile network');
  const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
  return createRoadNetwork({ network, roads });
}

/** The kit the placement names, with no nodes: Fred is composed in code, so he needs none. */
const emptyKit: LandmarkKit = { id: 'keys-landmarks', nodes: new Map(), doubleSided: false };

describe('Fred the Tree, composed in code', () => {
  const soup = fredSoup();
  const xs = soup.pos.filter((_, i) => i % 3 === 0);
  const ys = soup.pos.filter((_, i) => i % 3 === 1);

  it('is a small tree: tall enough to read from far off, nowhere near a tower', () => {
    const top = Math.max(...ys);
    print(`Fred stands ${top.toFixed(1)} m tall, ${soup.pos.length / 9} triangles`);
    expect(top).toBeGreaterThanOrEqual(4);
    expect(top).toBeLessThanOrEqual(6.5);
    expect(soup.pos.length / 9).toBeLessThanOrEqual(400);
    expect(soup.nrm).toHaveLength(soup.pos.length);
    expect(soup.col).toHaveLength(soup.pos.length);
    expect(soup.pos.every(Number.isFinite)).toBe(true);
  });

  it('has unit normals, and faces that point away from the piece they close (not inside out)', () => {
    // A face of a convex solid points away from the solid's middle: the soup's faces, tested against
    // the nearest side of their own piece, would need the pieces; the whole-tree stand-in is that
    // every normal is a unit vector and no face of the crown looks down into it: for each triangle
    // the normal and the winding (b - a) x (c - a) agree.
    for (let i = 0; i < soup.pos.length; i += 9) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = soup.pos.slice(i, i + 9) as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      const ux = bx - ax;
      const uy = by - ay;
      const uz = bz - az;
      const vx = cx - ax;
      const vy = cy - ay;
      const vz = cz - az;
      const wx = uy * vz - uz * vy;
      const wy = uz * vx - ux * vz;
      const wz = ux * vy - uy * vx;
      const len = Math.hypot(wx, wy, wz);
      if (len < 1e-9) continue;
      const dot = ((soup.nrm[i] ?? 0) * wx + (soup.nrm[i + 1] ?? 0) * wy + (soup.nrm[i + 2] ?? 0) * wz) / len;
      expect(dot, `triangle ${i / 9}: the normal follows the winding`).toBeGreaterThan(0.99);
      expect(Math.hypot(soup.nrm[i] ?? 0, soup.nrm[i + 1] ?? 0, soup.nrm[i + 2] ?? 0)).toBeCloseTo(1, 4);
    }
  });

  it('keeps over the shoulder only what is high, and nothing over the drive lanes', () => {
    // The box's d is the road's own: read it from the bake, the tree's local +X pointing away from
    // the road for a left-hand landmark.
    const road = sevenMile();
    const placement = landmarkPlacements(road).find((p) => p.node === 'fred_the_tree');
    expect(placement, 'the bake places Fred').toBeDefined();
    if (!placement) return;
    const f = placement.feature;
    const dMid = Math.abs((f.d0 + f.d1) / 2);
    const lanes = road.lanesAt(placement.edge, (f.s0 + f.s1) / 2);
    const driveEdge = Math.max(
      ...lanes.filter((l) => l.kind === 'drive').map((l) => Math.abs(l.dCenterM) + l.widthM / 2),
    );
    const laneEdge = Math.max(...lanes.map((l) => Math.abs(l.dCenterM) + l.widthM / 2));
    expect(Math.sign((f.d0 + f.d1) / 2), 'a left-hand landmark: +X is away from the road').toBe(-1);
    // Distance of each vertex from the road's centre line: dMid + x (x is outward).
    let lowestOverShoulder = Infinity;
    for (let i = 0; i < xs.length; i++) {
      const fromCentre = dMid + (xs[i] ?? 0);
      const y = (ys[i] ?? 0) * placement.scale;
      expect(fromCentre, 'nothing of him over the drive lanes').toBeGreaterThan(driveEdge);
      if (fromCentre < laneEdge) lowestOverShoulder = Math.min(lowestOverShoulder, y);
    }
    print(
      `drive lanes end ${driveEdge.toFixed(1)} m and the shoulder ${laneEdge.toFixed(1)} m from the centre; Fred's box centre ${dMid.toFixed(1)} m; lowest branch over the shoulder ${lowestOverShoulder.toFixed(1)} m`,
    );
    expect(lowestOverShoulder).toBeGreaterThanOrEqual(2);
  });
});

describe('Fred the Tree on the old Seven Mile Bridge', () => {
  it('is drawn in the one landmark call, from far down the old road and from the new highway', () => {
    const road = sevenMile();
    expect(landmarkKitsFor(road)).toContain('keys-landmarks');
    const placement = landmarkPlacements(road).find((p) => p.node === 'fred_the_tree');
    expect(placement, 'the bake places Fred').toBeDefined();
    if (!placement) return;
    const layer = new LandmarkLayer(new Map([['keys-landmarks', emptyKit]]), look, { road });
    // Only his kit is loaded here: the island and the mile posts on the same network need theirs.
    expect(layer.counts().skipped).toBe(landmarkPlacements(road).length - 1);
    expect(layer.counts().placed).toBe(1);

    layer.update(placement.x - 200, placement.z);
    expect(layer.counts().drawCalls).toBe(1);
    const tris = layer.counts().trianglesDrawn;
    expect(tris).toBeGreaterThan(50);

    const mesh = layer.group.children[0] as Mesh;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    expect(box).not.toBeNull();
    if (!box) return;
    const top = box.max.y - placement.y;
    print(`the placed tree is ${top.toFixed(1)} m over the deck, ${tris} triangles drawn`);
    expect(top).toBeGreaterThanOrEqual(4);
    // Seen from where a rider on the new highway could see it, and gone past the camera's reach.
    layer.update(placement.x + 600, placement.z + 100);
    expect(layer.counts().drawCalls).toBe(1);
    layer.update(placement.x + LANDMARK_MID_M + 500, placement.z);
    expect(layer.counts().drawCalls).toBe(0);
  });
});
