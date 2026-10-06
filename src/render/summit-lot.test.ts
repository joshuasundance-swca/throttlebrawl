// The Twin Peaks summit lot (playtest 4, run C's live check: "the Twin Peaks summit ends on a bare hilltop";
// the identity sheets' T2: "a widened paved lot, a parked tour bus, coin binoculars at the rail, and a dense
// zone of tourists"). A code-made landmark, `sf-landmarks#summit_lot` (summit-lot.ts, composed in
// landmarks.ts like Fred the Tree), placed by the climb's bake beside the last stretch before the finish,
// with the tourists' zone standing on it. The rules held here, on the committed bake:
// - the climb places it, on the right, past the verge and inside the road's length, over the finish line;
// - the layer draws it in the landmark layer's one call, inside a small triangle budget;
// - all of it stands inside its box, follows the road's grade (a control with no grade does not), and holds
//   what makes it a lot: the paved slab, a tour bus, a rail with two coin binoculars;
// - the tourists' zone is on it.
import { Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { buildSoup, roadPointsOf } from './backdrop/builder';
import type { BackdropNetworkFile, BackdropRegionFile, MastPiece } from './backdrop/data';
import { LANDMARK_MID_M, LandmarkLayer, landmarkPlacements } from './landmarks';
import { createFlatLook } from './look';
import type { LandmarkKit } from './models';
import { SUMMIT_LOT, summitLotSoup } from './summit-lot';

const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`[examined] ${line}\n`);
const look = createFlatLook();

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/region-sf/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/region-sf/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const routeFiles = import.meta.glob<{ id: string; finish: { road: string; s: number } }>(
  '../../packs/region-sf/regions/*/routes/*.json',
  { eager: true, import: 'default' },
);

function track(): { road: RoadNetwork; roads: BakedRoad[] } {
  const network = Object.values(networkFiles).find((n) => n.id === 'osm-sf-twin-peaks');
  if (!network) throw new Error('no osm-sf-twin-peaks network');
  const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
  return { road: createRoadNetwork({ network, roads }), roads };
}

/** The kit the placement names, with no nodes: the lot is composed in code, so it needs none. */
const emptyKit: LandmarkKit = { id: 'sf-landmarks', nodes: new Map(), doubleSided: false };

const { road, roads } = track();
const placement = landmarkPlacements(road).find((p) => p.node === 'summit_lot');
const climb = roads.find((r) => r.id === 'osm-sf-twin-peaks-climb')!;
const finishS = Object.values(routeFiles).find((r) => r.id === 'osm-sf-twin-peaks-run')!.finish.s;

describe('the summit lot is placed on the climb', () => {
  it('stands on the right of the last stretch, past the verge, inside the road, over the finish line', () => {
    expect(placement, 'the bake places the lot').toBeDefined();
    if (!placement) return;
    const f = placement.feature;
    expect(placement.kit).toBe('sf-landmarks');
    expect(road.edges[placement.edge]?.id).toBe('osm-sf-twin-peaks-climb');
    expect(f.s0).toBeGreaterThan(0);
    expect(f.s1).toBeLessThanOrEqual(climb.lengthM);
    expect(Math.min(f.d0, f.d1), 'the right-hand side').toBeGreaterThan(0);
    // Seen before the line: its near end is well back from the finish, and the finish is inside it.
    expect(f.s0).toBeLessThan(finishS - 40);
    expect(f.s1).toBeGreaterThan(finishS);
    // Past the verge: the validator's own rule, read from the road (validate.ts landmarkClear).
    const verge = road.vergeAt(placement.edge, (f.s0 + f.s1) / 2, 'right');
    expect(Math.min(f.d0, f.d1)).toBeGreaterThan(Math.abs(verge.dOuter));
    print(
      `summit lot: s ${f.s0} to ${f.s1} (the finish at ${finishS.toFixed(0)}), d ${f.d0} to ${f.d1}, verge ends at ${Math.abs(verge.dOuter).toFixed(1)} m`,
    );
  });

  it('is drawn by the landmark layer in its one call, inside a small triangle budget, and not from too far', () => {
    const layer = new LandmarkLayer(new Map([['sf-landmarks', emptyKit]]), look, { road });
    expect(layer.counts().skipped).toBe(0);
    expect(layer.counts().placed).toBe(1);
    const at = placement!;
    layer.update(at.x - 120, at.z);
    expect(layer.counts().drawCalls).toBe(1);
    const tris = layer.counts().trianglesDrawn;
    print(`summit lot: ${tris} triangles drawn, one call`);
    expect(tris).toBeGreaterThan(200);
    expect(tris).toBeLessThanOrEqual(900);
    // It is not drawn past the layer's far limit.
    layer.update(at.x - LANDMARK_MID_M - 400, at.z);
    expect(layer.counts().trianglesDrawn).toBe(0);
    const mesh = layer.group.children[0] as Mesh;
    expect(mesh.name).toBe('landmarks');
  });
});

/**
 * The soup in the world as the layer places it: each vertex's (s, d) on the climb and its height over the road
 * there, with whether it is pavement (an up-facing vertex of the grade-free soup at the pavement's level).
 */
function inRoad(grade: number) {
  const at = placement!;
  const soup = summitLotSoup(grade);
  const flat = summitLotSoup(0);
  const out: { s: number; d: number; up: number; pavement: boolean }[] = [];
  for (let i = 0; i < soup.pos.length; i += 3) {
    const x = soup.pos[i]!;
    const y = soup.pos[i + 1]!;
    const z = soup.pos[i + 2]!;
    // The model turned by the landmark's yaw (the placement already holds the road's heading and `yawDeg`).
    const wx = at.x + Math.cos(at.yaw) * x + Math.sin(at.yaw) * z;
    const wz = at.z - Math.sin(at.yaw) * x + Math.cos(at.yaw) * z;
    const p = road.project(wx, wz, at.edge);
    const base = road.toWorld(at.edge, p.s, p.d, 0).y;
    out.push({
      s: p.s,
      d: p.d,
      up: at.y + y - base,
      pavement: flat.nrm[i + 1]! > 0.99 && Math.abs(flat.pos[i + 1]! - SUMMIT_LOT.pavementY) < 1e-6,
    });
  }
  return out;
}

/** The lot's grade the way the layer reads it: the road's rise per metre of the soup's +Z, end to end. */
function localGrade(): number {
  const at = placement!;
  const hz = SUMMIT_LOT.halfAlongM;
  const heightAt = (z: number) => {
    const p = road.project(at.x + Math.sin(at.yaw) * z, at.z + Math.cos(at.yaw) * z, at.edge);
    return road.toWorld(at.edge, p.s, p.d, 0).y;
  };
  return (heightAt(hz) - heightAt(-hz)) / (2 * hz);
}

describe('the lot as drawn', () => {
  const soup = summitLotSoup(0);
  const tris = soup.pos.length / 9;

  it('is a small code-made soup: unit normals, finite numbers, inside the footprint', () => {
    expect(soup.nrm).toHaveLength(soup.pos.length);
    expect(soup.col).toHaveLength(soup.pos.length);
    expect(soup.pos.every(Number.isFinite)).toBe(true);
    expect(tris).toBeGreaterThan(200);
    expect(tris).toBeLessThanOrEqual(900);
    for (let i = 0; i < soup.nrm.length; i += 3)
      expect(Math.hypot(soup.nrm[i]!, soup.nrm[i + 1]!, soup.nrm[i + 2]!)).toBeCloseTo(1, 3);
    const xs = soup.pos.filter((_, i) => i % 3 === 0);
    const zs = soup.pos.filter((_, i) => i % 3 === 2);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-SUMMIT_LOT.halfAcrossM - 0.01);
    expect(Math.max(...xs)).toBeLessThanOrEqual(SUMMIT_LOT.halfAcrossM + 0.01);
    expect(Math.min(...zs)).toBeGreaterThanOrEqual(-SUMMIT_LOT.halfAlongM - 0.01);
    expect(Math.max(...zs)).toBeLessThanOrEqual(SUMMIT_LOT.halfAlongM + 0.01);
  });

  it('stands inside its feature box on the road, within the road’s own bend', () => {
    const f = placement!.feature;
    let worstS = 0;
    let worstD = 0;
    for (const v of inRoad(0)) {
      worstS = Math.max(worstS, f.s0 - v.s, v.s - f.s1);
      worstD = Math.max(worstD, f.d0 - v.d, v.d - f.d1);
    }
    print(
      `summit lot: its farthest vertex is ${worstS.toFixed(2)} m outside its box along the road, ${worstD.toFixed(2)} m across (0 when inside)`,
    );
    // The road bends a little under the lot (its straightest 80 m is 1.4 m off a straight line), so the ends stand
    // within the road's own deviation of the box, and never nearer the lanes than the verge's end.
    expect(worstS).toBeLessThan(1);
    expect(worstD).toBeLessThan(2);
    const verge = road.vergeAt(placement!.edge, (f.s0 + f.s1) / 2, 'right');
    const nearest = Math.min(...inRoad(0).map((v) => v.d));
    expect(nearest).toBeGreaterThan(Math.abs(verge.dOuter));
  });

  it('has the slab, a tour bus, and a rail with two coin binoculars where the constants say', () => {
    // The slab: up-facing triangles at the lot's level covering most of its footprint.
    let slab = 0;
    for (let i = 0; i < soup.pos.length; i += 9) {
      const ny = soup.nrm[i + 1]!;
      const y = Math.max(soup.pos[i + 1]!, soup.pos[i + 4]!, soup.pos[i + 7]!);
      if (ny > 0.99 && y < SUMMIT_LOT.pavementY + 0.001) {
        const [ax, az, bx, bz, cx, cz] = [
          soup.pos[i]!,
          soup.pos[i + 2]!,
          soup.pos[i + 3]!,
          soup.pos[i + 5]!,
          soup.pos[i + 6]!,
          soup.pos[i + 8]!,
        ];
        slab += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
      }
    }
    const footprint = 2 * SUMMIT_LOT.halfAcrossM * 2 * SUMMIT_LOT.halfAlongM;
    print(
      `summit lot: ${slab.toFixed(0)} m2 of up-facing pavement of a ${footprint.toFixed(0)} m2 footprint`,
    );
    expect(slab).toBeGreaterThan(footprint * 0.8);
    // The bus: a body over 11 m long and 3 m high, standing where the constants put it.
    const B = SUMMIT_LOT.bus;
    const has = (lo: number, hi: number, axis: 0 | 1 | 2) =>
      soup.pos.some((v, i) => i % 3 === axis && v >= lo && v <= hi);
    expect(B.z1 - B.z0).toBeGreaterThanOrEqual(11);
    expect(B.heightM).toBeGreaterThanOrEqual(3);
    expect(has(B.heightM - 0.05, B.heightM + 0.05, 1), 'a roof at the bus height').toBe(true);
    expect(has(B.z0 - 0.05, B.z0 + 0.05, 2) && has(B.z1 - 0.05, B.z1 + 0.05, 2), 'both ends of the bus').toBe(
      true,
    );
    // The rail runs along the far edge, with a coin binocular post at each of its two places, 1.4 m or more tall.
    expect(SUMMIT_LOT.binoculars).toHaveLength(2);
    for (const b of SUMMIT_LOT.binoculars) {
      expect(b.x, 'at the rail').toBeGreaterThan(SUMMIT_LOT.railX - 2);
      let top = 0;
      for (let i = 0; i < soup.pos.length; i += 3)
        if (Math.abs(soup.pos[i]! - b.x) < 0.3 && Math.abs(soup.pos[i + 2]! - b.z) < 0.3)
          top = Math.max(top, soup.pos[i + 1]!);
      expect(top, `a binocular head at standing-eye height at z ${b.z}`).toBeGreaterThan(1.4);
    }
    expect(has(SUMMIT_LOT.railX - 0.05, SUMMIT_LOT.railX + 0.35, 0), 'the rail').toBe(true);
    // And it is on the far side of the lot from the road: the rail stands farther from the road than the bus.
    const at = placement!;
    const dAt = (x: number, z: number) =>
      road.project(
        at.x + Math.cos(at.yaw) * x + Math.sin(at.yaw) * z,
        at.z - Math.sin(at.yaw) * x + Math.cos(at.yaw) * z,
        at.edge,
      ).d;
    expect(dAt(SUMMIT_LOT.railX, 0), 'the rail is the lot’s far edge').toBeGreaterThan(dAt(B.x1, 0) + 5);
  });

  it('follows the road’s grade (a control with no grade does not)', () => {
    const at = placement!;
    const f = at.feature;
    const dMid = (f.d0 + f.d1) / 2;
    const rise = road.toWorld(at.edge, f.s1, dMid, 0).y - road.toWorld(at.edge, f.s0, dMid, 0).y;
    const grade = localGrade();
    print(
      `summit lot: the road climbs ${rise.toFixed(2)} m over the box (${((rise / (f.s1 - f.s0)) * 100).toFixed(1)} %)`,
    );
    const deviation = (g: number) => {
      let worst = 0;
      for (const v of inRoad(g))
        if (v.pavement) worst = Math.max(worst, Math.abs(v.up - SUMMIT_LOT.pavementY));
      return worst;
    };
    const flat = deviation(0);
    const shaped = deviation(grade);
    print(
      `summit lot: the pavement is ${shaped.toFixed(2)} m off the road's level with the grade, ${flat.toFixed(2)} m without`,
    );
    expect(Math.abs(rise), 'the control is meaningful: the road does climb').toBeGreaterThan(1);
    expect(flat, 'the control sees a flat lot float and sink').toBeGreaterThan(0.8);
    expect(shaped).toBeLessThan(0.4);
  });
});

describe('the tourists', () => {
  it('stand on the lot: a zone inside its box that names the phone photographers, a few of them', () => {
    const f = placement!.feature;
    const zones = climb.features?.filter((x) => x.kind === 'roadsideZone') ?? [];
    expect(zones, 'the climb keeps one zone, on the lot').toHaveLength(1);
    const z = zones[0]!;
    expect(z.s0).toBeGreaterThanOrEqual(f.s0);
    expect(z.s1).toBeLessThanOrEqual(f.s1);
    expect(Math.min(z.d0, z.d1)).toBeGreaterThanOrEqual(Math.min(f.d0, f.d1));
    expect(Math.max(z.d0, z.d1)).toBeLessThanOrEqual(Math.max(f.d0, f.d1));
    const p = z.params as { spawns?: string; kinds?: string[]; maxPeds?: number; everyM?: number };
    expect(p.spawns).toBe('pedestrians');
    expect(p.kinds).toEqual(['lombard-photographer']);
    expect(p.maxPeds ?? 0).toBeGreaterThanOrEqual(4);
    expect(p.maxPeds ?? 99).toBeLessThanOrEqual(8);
  });
});

// The radio mast (the sheets' "Recognisable by": "the three-legged TV mast looms overhead"; run C saw none). It was
// drawn, but at the region's 1.3 times (a far landmark must be more than a pixel tall), which on a road 440 to 550 m
// from it stands 36 degrees up: its top and half of it were out of the frame. The Twin Peaks route now draws its
// own near mast (`radio-mast-near`, 0.4 times since the run C fix check, in its network's backdrop file) and the region's piece names the
// other networks. It stands 500 m to the west, so it is ahead of the rider on the way up (about s 1650 to 1760)
// and in the last metres, and behind the rider at the finish. The checks: every San Francisco network draws one
// mast and never two, and the route draws its near one. (Where the camera sees it is tests/sim/twin-peaks-mast.test.ts.)
describe('the radio mast over the summit road', () => {
  const backdropRegion = Object.values(
    import.meta.glob<BackdropRegionFile>('../../packs/region-sf/assets/backdrop/san-francisco/region.json', {
      eager: true,
      import: 'default',
    }),
  )[0]!;
  const backdropNets = Object.entries(
    import.meta.glob<BackdropNetworkFile>(
      '../../packs/region-sf/assets/backdrop/san-francisco/networks/*.json',
      { eager: true, import: 'default' },
    ),
  );
  const backdropNet = backdropNets.find(([k]) => k.endsWith('/osm-sf-twin-peaks.json'))![1];
  const regionMast = backdropRegion.pieces.find((p) => p.id === 'radio-mast') as MastPiece;
  const nearMast = (backdropNet.pieces ?? []).find((p) => p.id === 'radio-mast-near') as
    MastPiece | undefined;

  it('is one mast on every San Francisco network: the region’s on the others, the route’s own near one here', () => {
    const networks = Object.values(networkFiles).map((n) => n.id);
    expect(networks).toContain('osm-sf-twin-peaks');
    for (const id of networks) {
      const own = backdropNets.find(([k]) => k.endsWith(`/${id}.json`))?.[1];
      const near = (own?.pieces ?? []).filter((p) => p.kind === 'mast').length;
      const far = !regionMast.networks || regionMast.networks.includes(id) ? 1 : 0;
      expect(near + far, `${id}: one mast`).toBe(1);
    }
    expect(nearMast, 'Twin Peaks has its near mast').toBeDefined();
    expect(regionMast.networks).not.toContain('osm-sf-twin-peaks');
  });

  it('is drawn on the route, and a keep-out past the climb’s distance takes it away (the control)', () => {
    const points = roadPointsOf(road.edges, 1);
    const built = (keepOutM: number) =>
      buildSoup(
        { ...backdropRegion, pieces: [] },
        { ...backdropNet, pieces: [{ ...nearMast!, keepOutM }] },
        points,
        7,
      ).stats;
    expect(built(250).kinds['mast']).toBe(1);
    expect(built(600).kinds['mast'], 'the control sees the mast go').toBeUndefined();
  });
});
