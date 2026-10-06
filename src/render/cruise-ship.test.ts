// The docked cruise ship behind Mallory pier (playtest 4, P4-19; the identity study's D6: "At the Gulf end
// a docked cruise ship is a white wall behind the square, and the sunset happens there"). Codex CX6 built
// the model (`keys-landmarks#cruise_ship`: 290 m long, 36 m across, 60 m high, its root at the waterline
// and its hull 8 m below it) and placed it nowhere; the finish road of Duval Street places it now. The
// rules this file asks, whatever the numbers are, all in the baked road's own metres (the bake compresses
// straights, so no raw lat/lon): it is a landmark of the finish road, on the Gulf side the pier is on and
// beyond the pier's seaward end; its root stands at the waterline, not at the street's height; its whole
// hull lies over open water, past the land the road scene drew and clear of every road; the drawn model
// fits the box the feature gave it; and a rider far down the street gets the light hull, not the full one.
// Each rule has a control: the same check on a ship that breaks it fails.
import type { BufferAttribute, Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  type BakedFeature,
  type BakedNetwork,
  type BakedRoad,
  type RoadNetwork,
} from '../road';
import { readGlb } from './glb';
import { LANDMARK_MID_M, LandmarkLayer, landmarkPlacements, type LandmarkPlacement } from './landmarks';
import { createFlatLook } from './look';
import { bakeLandmarkKit, landmarkKitAsset, type LandmarkKit } from './models';
import { buildRoadScene, type RoadDressing } from './road-mesh';
import { readAsset } from './model-files.test-util';

const look = createFlatLook();
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`[examined] ${line}\n`);

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/base/regions/florida-keys/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/base/regions/florida-keys/roads/*.json', {
  eager: true,
  import: 'default',
});

function duval(edit?: (road: BakedRoad) => BakedRoad): { road: RoadNetwork; dressing: RoadDressing } {
  const network = Object.values(networkFiles).find((n) => n.id === 'osm-keys-duval');
  if (!network) throw new Error('no osm-keys-duval network');
  const roads = Object.values(roadFiles)
    .filter((r) => network.roads.includes(r.id))
    .map((r) => (edit ? edit(r) : r));
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), dressing };
}

async function keysKit(): Promise<LandmarkKit> {
  return bakeLandmarkKit(
    'keys-landmarks',
    readGlb(await readAsset(landmarkKitAsset('keys-landmarks'), 'glb')),
  );
}

/** The ship's and the pier's features, as the baked road holds them. */
function features(road: RoadNetwork): {
  ship: LandmarkPlacement | undefined;
  pier: LandmarkPlacement | undefined;
} {
  const all = landmarkPlacements(road);
  return {
    ship: all.find((p) => p.node === 'cruise_ship'),
    pier: all.find((p) => p.node === 'mallory_pier'),
  };
}

const { road, dressing } = duval();
const { ship, pier } = features(road);
const built = buildRoadScene(road, look, dressing, { seed: 1, roadsideDensity: 1 });

/**
 * Where a box (a feature's `s0..s1`, `d0..d1`) first meets drawn land: the first sample along it whose near
 * edge is not past the verge and the drawn land beyond it (RoadScene.landReach), or null when all of it lies
 * over open water. `margin` is the clear water wanted past the land's edge, m.
 */
function landUnder(
  r: RoadNetwork,
  scene: Pick<typeof built, 'landReach'>,
  edge: number,
  f: Pick<BakedFeature, 's0' | 's1' | 'd0' | 'd1'>,
  margin: number,
): number | null {
  const side = f.d0 + f.d1 >= 0 ? 1 : -1;
  const near = Math.min(Math.abs(f.d0), Math.abs(f.d1));
  const e = r.edges[edge];
  if (!e) throw new Error('no edge');
  for (let s = Math.max(0, f.s0); s <= Math.min(e.length, f.s1); s += 5) {
    const v = r.vergeAt(edge, s, side < 0 ? 'left' : 'right');
    const landEnd = Math.abs(v.dOuter) + scene.landReach(edge, side, s);
    if (near < landEnd + margin) return s;
  }
  return null;
}

describe('the cruise ship is a landmark of the finish road, behind Mallory pier', () => {
  it('is placed from the keys-landmarks kit, on the same road as the pier', () => {
    expect(ship, 'the finish road names the cruise ship').toBeDefined();
    expect(pier, 'the pier').toBeDefined();
    if (!ship || !pier) return;
    expect(ship.kit).toBe('keys-landmarks');
    expect(ship.edge, 'the ship and the pier are on the finish road').toBe(pier.edge);
  });

  it('stands on the Gulf side the pier is on, beyond its seaward end, abreast of it along the road', () => {
    if (!ship || !pier) throw new Error('no ship or pier');
    type Box = Pick<BakedFeature, 's0' | 's1' | 'd0' | 'd1'>;
    /** Whether a box is on the pier's side, past its seaward tip with water between, and abreast of it. */
    const behind = (b: Box, p: Box): boolean => {
      const pierOut = Math.max(Math.abs(p.d0), Math.abs(p.d1));
      const near = Math.min(Math.abs(b.d0), Math.abs(b.d1));
      const mid = (p.s0 + p.s1) / 2;
      return (
        Math.sign(b.d0 + b.d1) === Math.sign(p.d0 + p.d1) && near > pierOut + 2 && b.s0 <= mid && b.s1 >= mid
      );
    };
    const s = ship.feature;
    const p = pier.feature;
    print(
      `the pier's seaward end ${Math.max(Math.abs(p.d0), Math.abs(p.d1)).toFixed(1)} m out, the ship's near side ${Math.min(Math.abs(s.d0), Math.abs(s.d1)).toFixed(1)} m out`,
    );
    expect(
      behind(s, p),
      'the ship lies along the shore beyond the pier tip, the pier pointing at its side',
    ).toBe(true);
    // Controls: the same box on the road's other side, nearer than the tip, or off along the shore.
    expect(behind({ ...s, d0: -s.d1, d1: -s.d0 }, p), 'the other side').toBe(false);
    expect(behind({ ...s, d0: p.d0, d1: p.d1 }, p), 'inside the pier`s reach').toBe(false);
    expect(behind({ ...s, s0: p.s1 + 10, s1: p.s1 + 300 }, p), 'off along the shore').toBe(false);
  });

  it('has its root at the waterline, not at the street`s height (the control keeps the street height)', () => {
    if (!ship) throw new Error('no ship');
    expect(ship.y, 'world y 0 is sea level').toBe(0);
    // The control: without `baseY` the model stands at the road's own height there, a metre of air.
    const { road: plain } = duval((r) => ({
      ...r,
      features: (r.features ?? []).map((f) => {
        if (f.id !== ship.feature.id) return f;
        const { baseY: _baseY, ...rest } = (f.params ?? {}) as Record<string, unknown>;
        return { ...f, params: rest };
      }),
    }));
    const unplaced = features(plain).ship;
    print(`control without baseY: root at y ${unplaced?.y.toFixed(2)}`);
    expect(unplaced?.y ?? 0).toBeGreaterThan(0.5);
  });
});

describe('the whole hull lies over open water', () => {
  it('is past the land the road scene drew, over every metre of its length (control: a box on the land is not)', () => {
    if (!ship) throw new Error('no ship');
    const f = ship.feature;
    const hit = landUnder(road, built, ship.edge, f, 3);
    print(
      `ship box s ${f.s0}..${f.s1}, d ${f.d0}..${f.d1}: first land under it ${hit === null ? 'none' : hit}`,
    );
    expect(hit, 'no land under the hull').toBeNull();
    const onShore = { ...f, d0: f.d0 + 40, d1: f.d1 + 40 };
    expect(
      landUnder(road, built, ship.edge, onShore, 3),
      'the same box 40 m in is on the shore',
    ).not.toBeNull();
  });

  it('keeps every vertex clear of every road of the network, and inside the box the feature gave it', async () => {
    if (!ship) throw new Error('no ship');
    const kit = await keysKit();
    // The ship alone: the pier, the buoy and the Mile 0 marker are other landmarks of the same mesh.
    const alone = duval((r) => ({
      ...r,
      features: (r.features ?? []).filter((x) => x.kind !== 'landmark' || x.id === ship.feature.id),
    })).road;
    const layer = new LandmarkLayer(new Map([['keys-landmarks', kit]]), look, { road: alone });
    expect(layer.counts().placed).toBe(1);
    const f = ship.feature;
    const c = road.toWorld(ship.edge, (f.s0 + f.s1) / 2, (f.d0 + f.d1) / 2, 0);
    layer.update(c.x, c.z);
    const mesh = layer.group.children[0] as Mesh;
    const pos = mesh.geometry.getAttribute('position') as BufferAttribute;
    const t = road.frameAt(ship.edge, (f.s0 + f.s1) / 2);
    const o = road.toWorld(ship.edge, (f.s0 + f.s1) / 2, (f.d0 + f.d1) / 2 + 1, 0);
    const nx = o.x - c.x;
    const nz = o.z - c.z;
    const mine: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < pos.count; i++) {
      const v = { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) };
      if (Math.hypot(v.x - c.x, v.z - c.z) < 220) mine.push(v);
    }
    expect(mine.length, 'the hull is in the mesh').toBeGreaterThan(300);
    // Inside its box (the roadside, scenery and scenes keep off that box).
    let outside = 0;
    for (const v of mine) {
      const a = (v.x - c.x) * t.tx + (v.z - c.z) * t.tz;
      const d = (v.x - c.x) * nx + (v.z - c.z) * nz;
      if (Math.abs(a) > (f.s1 - f.s0) / 2 + 0.5 || Math.abs(d) > Math.abs(f.d1 - f.d0) / 2 + 0.5) outside++;
    }
    expect(outside, 'vertices outside the feature`s box').toBe(0);
    // Clear of every road: past its outer edge by a wide berth.
    let nearest = Infinity;
    for (const e of road.edges) {
      const reach = Math.max(-e.dMin, e.dMax);
      for (let i = 0; i < e.count; i++) {
        const ex = e.x[i] ?? 0;
        const ez = e.z[i] ?? 0;
        if (Math.hypot(ex - c.x, ez - c.z) > 500) continue;
        for (const v of mine) nearest = Math.min(nearest, Math.hypot(ex - v.x, ez - v.z) - reach);
      }
    }
    print(`ship: ${mine.length} vertices, nearest road edge ${nearest.toFixed(1)} m from any of them`);
    expect(nearest).toBeGreaterThan(20);
    // The waterline: the hull reaches 8 m under it, the top stands 60 m over it.
    const low = Math.min(...mine.map((v) => v.y));
    const high = Math.max(...mine.map((v) => v.y));
    print(`ship hull from y ${low.toFixed(2)} to ${high.toFixed(2)}`);
    expect(low).toBeCloseTo(-8, 0);
    expect(high).toBeCloseTo(60, 0);
    layer.dispose();
  });
});

describe('a rider far down the street gets the light hull', () => {
  it('draws the full model near, a far stand-in past farM, and nothing past the layer`s reach, in one call', async () => {
    if (!ship) throw new Error('no ship');
    const kit = await keysKit();
    const layer = new LandmarkLayer(new Map([['keys-landmarks', kit]]), look, { road });
    const index = landmarkPlacements(road).findIndex((p) => p.node === 'cruise_ship');
    const tiers = layer.levels()[index];
    expect(tiers, 'the ship is a piece of the layer').toBeDefined();
    if (!tiers) return;
    expect(tiers).toHaveLength(2);
    const [near, far] = tiers as [[number, number], [number, number]];
    print(`ship levels: full to ${near[0]} m (${near[1]} triangles), light to ${far[0]} m (${far[1]})`);
    expect(far[1], 'the far hull is much lighter').toBeLessThanOrEqual(0.3 * near[1]);
    expect(near[0], 'the light hull takes over before the end of the layer`s reach').toBeLessThan(
      LANDMARK_MID_M,
    );
    expect(ship.params.farM).toBeLessThan(LANDMARK_MID_M);
    layer.update(ship.x, ship.z);
    expect(layer.counts().drawCalls).toBe(1);
    layer.update(ship.x + LANDMARK_MID_M + 500, ship.z);
    expect(layer.counts().drawCalls).toBe(0);
    layer.dispose();
  });
});
