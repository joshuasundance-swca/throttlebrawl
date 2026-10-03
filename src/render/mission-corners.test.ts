// Mural Alleys' street corners stand on land (run W-U's live check, mustFix 2: "open bay water, with
// waves and gulls, inside the Satin St to Drop Cloth Alley corner under mascot wall 1", seeds 2, 3
// and 4). On the inside of a tight turn each street's land narrows to keep its strip from folding
// (road-mesh.ts LAND_FOLD) and its terrain skirt stops, so the block inside every corner of the
// route had no ground drawn and the sea plane showed through. These checks read the drawn ground
// straight down, on the real baked network: at the reported spot, inside every corner, and on a
// grid over the whole district near its streets.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { GroundTris } from './land-probe.test-util';
import { createFlatLook } from './look';
import { buildRoadScene, type RoadDressing } from './road-mesh';

/** The examined lines, printed even when the tests pass. */
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`${line}\n`);
const networkFiles = import.meta.glob<BakedNetwork>('../../packs/region-sf/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/region-sf/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

const network = Object.values(networkFiles).find((n) => n.id === 'sf-mission');
if (!network) throw new Error('no network sf-mission');
const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
const road: RoadNetwork = createRoadNetwork({ network, roads });
const scene = buildRoadScene(road, createFlatLook(), dressing, { seed: 1 });
const ground = new GroundTris(scene.group);

/** Drawn ground over the sea at (x, z): land, a road or a verge, standing above the water (y 0). */
function groundAt(x: number, z: number): boolean {
  const h = ground.heightAt(x, z);
  return !!h && h.y > 0.05;
}

const edgeOf = (id: string) => {
  const e = road.edges.find((x) => x.id === id);
  if (!e) throw new Error(`no edge ${id}`);
  return e;
};
/** Unit heading of an edge in the ground plane between two of its s. */
const heading = (edge: number, s0: number, s1: number) => {
  const a = road.toWorld(edge, s0, 0, 0);
  const b = road.toWorld(edge, s1, 0, 0);
  const l = Math.hypot(b.x - a.x, b.z - a.z);
  return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
};
/** Rows of the reported spot, out from the verge to this far, m. */
const SPOT_OUT_M = 40;
/** How far into each corner's block the walk goes, along both streets, m. */
const CORNER_M = 60;
const GRID_M = 2;

describe('Mural Alleys: the street corners stand on land', () => {
  it('the reported spot: right of Satin St, s 330 to 360, under mascot wall 1', () => {
    const e = edgeOf('sf-mi-satin-st');
    const wet: string[] = [];
    let rays = 0;
    for (let s = 330; s <= 360; s += GRID_M)
      for (let d = e.dMax + 0.6 + 0.5; d <= e.dMax + 0.6 + SPOT_OUT_M; d += GRID_M) {
        const p = road.toWorld(e.index, s, d, 0);
        rays++;
        if (!groundAt(p.x, p.z)) wet.push(`s ${s} d ${d.toFixed(1)}`);
      }
    print(
      `[examined] Satin St s 330 to 360, right side to ${SPOT_OUT_M} m past the verge: ${rays} rays down, ${wet.length} over open water`,
    );
    expect(rays).toBeGreaterThan(200);
    expect(wet, wet.slice(0, 5).join('; ')).toEqual([]);
  });

  it('inside every corner of the route, the block is ground out to 60 m along both streets', () => {
    let corners = 0;
    let rays = 0;
    const wet: string[] = [];
    for (const a of road.edges)
      for (const l of a.nextLinks) {
        if (l.entersAt !== 'from') continue;
        const b = road.edges[l.edge]!;
        // The legs' headings on their straight parts, clear of the corner's curve.
        const ha = heading(a.index, a.length - 60, a.length - 40);
        const hb = heading(b.index, 40, 60);
        const turn = ha.x * hb.z - ha.z * hb.x;
        if (Math.abs(turn) < 0.5) continue;
        corners++;
        // The corner: where the two streets' straight centrelines cross.
        const pa = road.toWorld(a.index, a.length - 40, 0, 0);
        const pb = road.toWorld(b.index, 40, 0, 0);
        const det = ha.x * -hb.z - ha.z * -hb.x;
        const t = ((pb.x - pa.x) * -hb.z - (pb.z - pa.z) * -hb.x) / det;
        const cx = pa.x + ha.x * t;
        const cz = pa.z + ha.z * t;
        let wetHere = 0;
        // Inside the turn: back along the street in, on along the street out.
        for (let u = GRID_M; u <= CORNER_M; u += GRID_M)
          for (let v = GRID_M; v <= CORNER_M; v += GRID_M) {
            const x = cx - ha.x * u + hb.x * v;
            const z = cz - ha.z * u + hb.z * v;
            rays++;
            if (!groundAt(x, z)) wetHere++;
          }
        if (wetHere) wet.push(`${a.id} into ${b.id}: ${wetHere} points over open water`);
      }
    print(
      `[examined] ${corners} corners, ${rays} rays down inside them, ${wet.length} with water${wet.length ? ` (${wet.join('; ')})` : ''}`,
    );
    expect(corners).toBe(5);
    expect(wet).toEqual([]);
  });

  it('the district is ground everywhere within 50 m of its streets (but past the two dead ends)', () => {
    const NEAR_M = 50;
    const pts: { x: number; z: number }[] = [];
    for (const e of road.edges)
      for (let s = 0; s <= e.length; s += GRID_M) pts.push(road.toWorld(e.index, s, 0, 0));
    const ends = road.edges
      .flatMap((e) => [
        e.prevLinks.length ? null : road.toWorld(e.index, 0, 0, 0),
        e.nextLinks.length ? null : road.toWorld(e.index, e.length, 0, 0),
      ])
      .filter((p) => p !== null);
    expect(ends.length).toBe(2);
    const cells = new Map<string, { x: number; z: number }[]>();
    const key = (x: number, z: number) => `${Math.floor(x / NEAR_M)},${Math.floor(z / NEAR_M)}`;
    for (const p of pts) {
      const k = key(p.x, p.z);
      (cells.get(k) ?? cells.set(k, []).get(k)!).push(p);
    }
    const near = (x: number, z: number) => {
      const cx = Math.floor(x / NEAR_M);
      const cz = Math.floor(z / NEAR_M);
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++)
          for (const p of cells.get(`${cx + i},${cz + j}`) ?? [])
            if (Math.hypot(p.x - x, p.z - z) <= NEAR_M) return true;
      return false;
    };
    const xs = pts.map((p) => p.x);
    const zs = pts.map((p) => p.z);
    let rays = 0;
    const wet: string[] = [];
    for (let x = Math.min(...xs) - NEAR_M; x <= Math.max(...xs) + NEAR_M; x += GRID_M)
      for (let z = Math.min(...zs) - NEAR_M; z <= Math.max(...zs) + NEAR_M; z += GRID_M) {
        const px = x + 0.13;
        const pz = z + 0.07;
        if (!near(px, pz) || ends.some((p) => Math.hypot(p.x - px, p.z - pz) <= NEAR_M + 10)) continue;
        rays++;
        if (!groundAt(px, pz)) wet.push(`(${px.toFixed(0)}, ${pz.toFixed(0)})`);
      }
    print(
      `[examined] ${rays} rays down within ${NEAR_M} m of the streets, ${wet.length} over open water${wet.length ? ` (first: ${wet.slice(0, 4).join(', ')})` : ''}`,
    );
    expect(rays).toBeGreaterThan(50_000);
    expect(wet.length).toBe(0);
  });
});
