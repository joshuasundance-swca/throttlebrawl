// Where the staged roadside scenes stand (run W-T, pitch 6): seeded spots along every road, at most
// one per `everyM` of road, each scene at most once a race, on the side theme it names (the sunk car
// in the Keys' flats, the view lot in a PNW forest, the pop-up office on an SF street). A scene
// stands past the ridable ground band (off-road riders never meet it), on the land the road scene
// drew all across its footprint (or on open water past it), clear of other roads, of the road's
// features and of the scenery already standing. Presentation only: the sim never sees a scene.
import type { RoadNetwork } from '../../road';
import {
  LAND_TOP_M,
  ridableBandPast,
  scatterHash,
  themeAt,
  type ScenerySpot,
  type SideTag,
} from '../scenery';
import { SCENES_PER_RACE, type SceneDef, type ScenesFile } from './data';

/** The verge past the drivable edge, m (as the roadside layer measures from it). */
const VERGE_M = 0.6;
/** Features no scene stands on, with room round them, m (the roadside layer's list). */
const KEEP_CLEAR = new Set(['billboard', 'boostPad', 'rampTruck', 'roadsideZone', 'copSpawn']);
const FEATURE_CLEAR_M = 3;
/** A scene turns its front to the road this far back toward the rider coming up it, m. */
export const SCENE_AIM_M = 45;
/** Two scenes never stand closer than this share of `everyM` (junctions, hairpins). */
const MIN_GAP_SHARE = 0.5;
/** The scenery's footprints as discs back from each anchor (the roadside layer's SPOT_REACH, plus boats). */
const SPOT_REACH: Partial<Record<ScenerySpot['kind'], readonly { r: number; back: number }[]>> = {
  house: [
    { r: 3.3, back: 2.8 },
    { r: 3.3, back: 8.4 },
  ],
  sawmill: [{ r: 16, back: 8.5 }],
  shack: [{ r: 3.8, back: 0 }],
  conifer: [{ r: 1.2, back: 0 }],
  palm: [{ r: 1, back: 0 }],
  mangrove: [{ r: 2.5, back: 0 }],
  pole: [{ r: 0.8, back: 0 }],
  skiff: [{ r: 4, back: 0 }],
  boat: [{ r: 5, back: 0 }],
  islet: [{ r: 16, back: 0 }],
};
/** A tree may stand inside the outer edge of a scene's footprint, never in its middle share. */
const TREE_CORE_SHARE = 0.7;
const TREES = new Set<ScenerySpot['kind']>(['conifer', 'palm', 'mangrove', 'pole']);

export interface SceneInput {
  road: RoadNetwork;
  seed: number;
  file: ScenesFile;
  /** Metres of drawn land past the verge at s on a side (RoadScene.landReach). */
  landReach(edge: number, side: -1 | 1, s: number): number;
  /** The scenery already standing (houses, trees, boats): scenes keep clear of it. */
  spots: readonly ScenerySpot[];
}

export interface PlacedScene {
  def: SceneDef;
  edge: number;
  s: number;
  /** Offset from the centre line, m (signed by side). */
  d: number;
  side: -1 | 1;
  /** The scene's middle on the ground (or the waterline), world m. */
  x: number;
  y: number;
  z: number;
  /** Turn about the vertical: the scene's +z goes to (sin, cos) in x, z. */
  turn: number;
}

interface RoadPoint {
  edge: number;
  s: number;
  x: number;
  z: number;
  half: number;
}

/** Every road's centre line on a grid, for "does another road pass here". */
function roadGrid(road: RoadNetwork) {
  const CELL = 24;
  const cells = new Map<string, RoadPoint[]>();
  for (const e of road.edges) {
    const half = Math.max(-e.dMin, e.dMax) + VERGE_M;
    for (let i = 0; i < e.count; i++) {
      const p = { edge: e.index, s: i * e.spacing, x: e.x[i] ?? 0, z: e.z[i] ?? 0, half };
      const k = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`;
      const list = cells.get(k);
      if (list) list.push(p);
      else cells.set(k, [p]);
    }
  }
  /** Whether any road other than (edge, near s) comes within r of (x, z), its own width included. */
  return (edge: number, s: number, x: number, z: number, r: number): boolean => {
    const reach = Math.ceil((r + 20) / CELL);
    const ci = Math.floor(x / CELL);
    const cj = Math.floor(z / CELL);
    for (let i = ci - reach; i <= ci + reach; i++)
      for (let j = cj - reach; j <= cj + reach; j++)
        for (const p of cells.get(`${i},${j}`) ?? []) {
          if (p.edge === edge && Math.abs(p.s - s) < 40 + r) continue;
          if (Math.hypot(p.x - x, p.z - z) < p.half + r + 1) return true;
        }
    return false;
  };
}

/** Places the region's live scenes along every road of the network. Same seed, same scenes. */
export function placeScenes(input: SceneInput): PlacedScene[] {
  const { road, seed, file } = input;
  const live = file.scenes.filter((sc) => sc.status === 'live');
  const out: PlacedScene[] = [];
  if (!live.length) return out;
  const used = new Set<string>();
  const otherRoad = roadGrid(road);
  // The scenery's discs, by a coarse grid.
  const discs = new Map<string, { x: number; z: number; r: number; tree: boolean }[]>();
  const DCELL = 32;
  for (const sp of input.spots) {
    const e = road.edges[sp.edge];
    if (!e) continue;
    for (const disc of SPOT_REACH[sp.kind] ?? []) {
      const c = disc.back > 0 ? road.toWorld(e.index, sp.s, sp.d + Math.sign(sp.d) * disc.back, 0) : sp.p;
      const k = `${Math.floor(c.x / DCELL)},${Math.floor(c.z / DCELL)}`;
      const d = { x: c.x, z: c.z, r: disc.r * sp.size, tree: TREES.has(sp.kind) };
      const list = discs.get(k);
      if (list) list.push(d);
      else discs.set(k, [d]);
    }
  }
  const hitsScenery = (x: number, z: number, r: number) => {
    const ci = Math.floor(x / DCELL);
    const cj = Math.floor(z / DCELL);
    for (let i = ci - 1; i <= ci + 1; i++)
      for (let j = cj - 1; j <= cj + 1; j++)
        for (const d of discs.get(`${i},${j}`) ?? [])
          if (Math.hypot(d.x - x, d.z - z) < d.r + r * (d.tree ? TREE_CORE_SHARE : 1)) return true;
    return false;
  };

  const fit = (sc: SceneDef, edge: number, side: -1 | 1, s: number, salt: number): PlacedScene | null => {
    const e = road.edges[edge]!;
    const r = sc.radiusM;
    if (s - r < 0 || s + r > e.length) return null;
    const tags = e.tags as readonly SideTag[];
    const sideName = side < 0 ? 'left' : 'right';
    const water = sc.on.includes('water');
    const outer = side < 0 ? -e.dMin + VERGE_M : e.dMax + VERGE_M;
    const band = water ? 0 : ridableBandPast(road, edge, side, s, outer);
    const want = sc.acrossM[0] + (sc.acrossM[1] - sc.acrossM[0]) * scatterHash(seed, 4111 + edge, s, salt);
    let across = Math.max(want, band + r);
    for (const u of [-r, 0, r]) {
      if (!sc.on.includes(themeAt(tags, sideName, s + u))) return null;
      const land = input.landReach(edge, side, s + u);
      if (water) across = Math.max(across, land + r + 2);
      else if (land < across + r) return null;
    }
    // A water scene stands on open water near the road, not out at sea.
    if (water && across > sc.acrossM[1] + 12) return null;
    const d = side * (outer + across);
    // Clear of the road's features: no overlap of the footprint's box with a feature's, plus room.
    const m = FEATURE_CLEAR_M;
    const onFeature = e.features.some(
      (f) =>
        KEEP_CLEAR.has(f.kind) &&
        s + r + m >= Math.min(f.s0, f.s1) &&
        s - r - m <= Math.max(f.s0, f.s1) &&
        d + r + m >= Math.min(f.d0, f.d1) &&
        d - r - m <= Math.max(f.d0, f.d1),
    );
    if (onFeature) return null;
    const p = road.toWorld(edge, s, d, water ? 0 : LAND_TOP_M);
    const y = water ? 0 : p.y;
    if (otherRoad(edge, s, p.x, p.z, r)) return null;
    if (hitsScenery(p.x, p.z, r)) return null;
    if (out.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < file.everyM * MIN_GAP_SHARE)) return null;
    const aim = road.toWorld(edge, Math.max(0, s - SCENE_AIM_M), 0, 0);
    return { def: sc, edge, s, d, side, x: p.x, y, z: p.z, turn: Math.atan2(aim.x - p.x, aim.z - p.z) };
  };

  for (const e of road.edges) {
    const h = (k: number, salt: number) => scatterHash(seed, 6007 + e.index * 131, k, salt);
    for (let k = 0; ; k++) {
      const s = (k + 0.25 + 0.5 * h(k, 0)) * file.everyM;
      if (s > e.length) break;
      const sides: (-1 | 1)[] = h(k, 1) < 0.5 ? [-1, 1] : [1, -1];
      let done = false;
      for (const side of sides) {
        const theme = themeAt(e.tags, side < 0 ? 'left' : 'right', s);
        const pool = live.filter((sc) => !used.has(sc.id) && sc.on.includes(theme));
        const start = Math.floor(h(k, 2 + side) * pool.length);
        for (let i = 0; i < pool.length && !done; i++) {
          const sc = pool[(start + i) % pool.length]!;
          // A little slide along the road finds room the first spot did not have.
          for (const nudge of [0, 18, -18, 36]) {
            const placed = fit(sc, e.index, side, s + nudge, k * 4 + i);
            if (placed) {
              out.push(placed);
              used.add(sc.id);
              done = true;
              break;
            }
          }
        }
        if (done) break;
      }
    }
  }
  // A long road could show every scene every race: keep a seeded few, in road order.
  const max = file.maxPerRace ?? SCENES_PER_RACE;
  if (out.length <= max) return out;
  const keep = new Set(
    out
      .map((p, i) => ({ i, k: scatterHash(seed, 9001, i, p.def.id.length) }))
      .sort((a, b) => a.k - b.k)
      .slice(0, max)
      .map((q) => q.i),
  );
  return out.filter((_, i) => keep.has(i));
}
