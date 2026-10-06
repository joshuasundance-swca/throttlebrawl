// Chuckanut Drive's drop to the bay and Lake Samish's shore (playtest 4, P4-19, C4; the identity sheets'
// H1, H2 and I3, and their shared seam "a bluff/lake land theme with a drop and no skirt"; Codex CX6's
// wiring list, items 7 and 8). The maintainer: "The real roads do not have the characteristics of the roads
// in question in terms of scenery and feel etc".
//
// The rules:
// - the seam: a `bluff` or `lake` side's land is a strip that ends in a sheer drop, with no terrain skirt,
//   where the same road as plain forest has its skirt; its verge is a hard edge (the parapet) or a soft one;
// - Chuckanut: bluff only where the road's drop side says so (its `bluff` span tags), the parapet on that
//   side at the verge band's edge and the bluff at the drop's edge; the sandstone cuts and the boulders only
//   where its `rock-cut` spans say the slope rises, the firs behind the cut; nothing on a lane;
// - Lake Samish: the dock's root at the shore (the lake land's edge, at the lake's level, running out over
//   the water), the cabins wholly on the lake land; the lake's water past every lake side and never under
//   a lane.
// The checks build the real baked networks with the real CX6 models, the way the renderer does.
import { InstancedMesh, Mesh, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  deriveVerge,
  nearestOnEdges,
  type BakedNetwork,
  type BakedRoad,
  type BakedTag,
  type RoadNetwork,
} from '../road';
import type { BackdropNetworkFile } from './backdrop/data';
import { waterAtOf, waterFloors } from './backdrop/water';
import { createFlatLook } from './look';
import { bakeRepoModel } from './model-files.test-util';
import { modelKindsFor, type SceneryModels } from './models';
import { buildRoadScene, networkTags, type RoadDressing, type RoadScene } from './road-mesh';
import { PNW_KIT, scatterRoadside, type RoadsideItem } from './roadside';
import { BLUFF_LAND_M, LAKE_LAND_M, THEME_NEAR_M, themeAt } from './scenery';

const look = createFlatLook();
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`${line}\n`);
const networkFiles = import.meta.glob<BakedNetwork>('../../packs/region-pnw/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/region-pnw/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const backdropFiles = import.meta.glob<BackdropNetworkFile>(
  '../../packs/region-pnw/assets/backdrop/*/networks/*.json',
  { eager: true, import: 'default' },
);

const VERGE_M = 0.6;
const SEED = 3;

function bakedRoads(id: string): { network: BakedNetwork; roads: BakedRoad[] } {
  const network = Object.values(networkFiles).find((n) => n.id === id);
  if (!network) throw new Error(`no network ${id}`);
  const roads = network.roads.map((r) => {
    const road = Object.values(roadFiles).find((f) => f.id === r);
    if (!road) throw new Error(`no road ${r}`);
    return road;
  });
  return { network, roads };
}

function track(network: BakedNetwork, roads: BakedRoad[]): { road: RoadNetwork; dressing: RoadDressing } {
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), dressing };
}

const tagsOf = (r: BakedRoad): BakedTag[] => (r as unknown as { tags?: BakedTag[] }).tags ?? [];
const withTags = (r: BakedRoad, tags: BakedTag[]): BakedRoad => ({ ...r, tags });
const sideName = (side: -1 | 1) => (side < 0 ? 'left' : 'right');
/** A one-sided tag's side as a sign. */
const sideOf = (t: BakedTag): -1 | 1 => (t.side === 'left' ? -1 : 1);
const outerOf = (road: RoadNetwork, edge: number, side: -1 | 1) => {
  const e = road.edges[edge]!;
  return (side < 0 ? -e.dMin : e.dMax) + VERGE_M;
};

async function modelsFor(road: RoadNetwork, dressing: RoadDressing): Promise<SceneryModels> {
  const { tropical, tags } = networkTags(road, dressing);
  const out: SceneryModels = {};
  for (const k of modelKindsFor({ tropical, tags, palette: new Set(), traffic: [] }))
    out[k] = await bakeRepoModel(k);
  return out;
}

/** The world triangles of the scene's drawn land. */
function landTris(scene: RoadScene): number[][] {
  const out: number[][] = [];
  scene.group.traverse((o) => {
    if (!(o instanceof Mesh) || o instanceof InstancedMesh || o.name !== 'road-land') return;
    const g = o.geometry as BufferGeometry;
    const pos = g.getAttribute('position');
    const idx = g.getIndex();
    const count = idx ? idx.count : pos.count;
    for (let k = 0; k + 2 < count; k += 3) {
      const v = [0, 1, 2].map((i) => (idx ? idx.getX(k + i) : k + i));
      out.push(v.flatMap((i) => [pos.getX(i), pos.getY(i), pos.getZ(i)]));
    }
  });
  return out;
}

/** The heights of the drawn land over (x, z): every triangle that covers it, from above. */
function landAt(tris: readonly number[][], x: number, z: number): number[] {
  const out: number[] = [];
  for (const [ax, ay, az, bx, by, bz, cx, cy, cz] of tris as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ][]) {
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-9) continue;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
    const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
    out.push(l1 * ay + l2 * by + l3 * cy);
  }
  return out;
}

/**
 * One road of a real network retagged two ways (the control: its own tags without the span; the case:
 * with one span on one side), each built as the renderer builds it.
 */
function retagged(networkId: string, roadId: string, span: BakedTag) {
  const { network, roads } = bakedRoads(networkId);
  const plain = roads.map((r) =>
    r.id === roadId
      ? withTags(
          r,
          tagsOf(r).filter((t) => !['bluff', 'lake', 'rock-cut'].includes(t.tag)),
        )
      : r,
  );
  const spanned = plain.map((r) => (r.id === roadId ? withTags(r, [...tagsOf(r), span]) : r));
  return [plain, spanned].map((rs) => {
    const t = track(network, rs);
    const scene = buildRoadScene(t.road, look, t.dressing, { seed: SEED, roadsideDensity: 0 });
    return { ...t, scene, tris: landTris(scene), edge: t.road.edgeIndex(roadId) };
  });
}

/** Stations well inside a span, and the side's offsets past the verge to probe for skirt ground there. */
function probeSkirt(
  built: ReturnType<typeof retagged>[number],
  span: BakedTag,
  side: -1 | 1,
  stripM: number,
): { stations: number; skirted: number; reach: number[]; deep: number } {
  const { road, scene, tris, edge } = built;
  let stations = 0;
  let skirted = 0;
  let deep = 0;
  const reach: number[] = [];
  for (let s = span.s0 + 20; s <= span.s1 - 20; s += 20) {
    stations++;
    const outer = outerOf(road, edge, side);
    reach.push(scene.landReach(edge, side, s));
    const top = road.toWorld(edge, s, 0, 0).y;
    // Ground past the strip at the road's height or down a slope from it: the skirt. (The sea's shelf lies at
    // -0.4 m, under the sea; another road's skirt far below, under a lake's water, is not this side's.)
    const ground = [4, 12, 30].some((past) => {
      const p = road.toWorld(edge, s, side * (outer + stripM + past), 0);
      return landAt(tris, p.x, p.z).some((y) => y > top - 15 && y < top + 1);
    });
    if (ground) skirted++;
    // The drop: land drawn down to under the sea at the strip's edge.
    const edgeP = road.toWorld(edge, s, side * (outer + stripM), 0);
    const foot = tris.some((t) =>
      [0, 3, 6].some((k) => Math.hypot(t[k]! - edgeP.x, t[k + 2]! - edgeP.z) < 0.3 && (t[k + 1] ?? 0) < -0.3),
    );
    if (foot) deep++;
  }
  return { stations, skirted, reach, deep };
}

describe('the drop seam: a bluff or a lake side ends in a drop, with no skirt (H1, I3)', () => {
  it("a bluff side's land is a 4.2 m shelf that drops sheer; the same road all forest has its skirt", () => {
    const span: BakedTag = { s0: 400, s1: 1400, side: 'right', tag: 'bluff' };
    const [plain, bluff] = retagged('osm-pnw-chuckanut', 'osm-chuckanut-cliffs', span);
    const control = probeSkirt(plain!, span, 1, BLUFF_LAND_M);
    const drop = probeSkirt(bluff!, span, 1, BLUFF_LAND_M);
    print(
      `[examined] cliffs s ${span.s0}..${span.s1} right, ${drop.stations} stations: forest skirt ground found at ${control.skirted}, bluff at ${drop.skirted}; bluff land reach ${Math.min(...drop.reach)}..${Math.max(...drop.reach)} m, drop to under the sea at ${drop.deep}`,
    );
    // The probe can see a skirt: the control has one nearly everywhere.
    expect(control.skirted).toBeGreaterThan(control.stations * 0.8);
    expect(Math.min(...control.reach)).toBeGreaterThan(BLUFF_LAND_M);
    expect(drop.skirted).toBe(0);
    for (const r of drop.reach) expect(r).toBeCloseTo(BLUFF_LAND_M, 5);
    expect(drop.deep).toBe(drop.stations);
    // The other side is untouched.
    for (let s = span.s0; s <= span.s1; s += 50)
      expect(bluff!.scene.landReach(bluff!.edge, -1, s)).toBe(plain!.scene.landReach(plain!.edge, -1, s));
    for (const b of [plain!, bluff!]) b.scene.dispose();
  });

  it("a lake side's land is the lake strip and drops at its edge; the same road all forest has its skirt", () => {
    const span: BakedTag = { s0: 900, s1: 1500, side: 'right', tag: 'lake' };
    const [plain, lake] = retagged('osm-pnw-samish', 'osm-samish-east-shore', span);
    const control = probeSkirt(plain!, span, 1, LAKE_LAND_M);
    const drop = probeSkirt(lake!, span, 1, LAKE_LAND_M);
    print(
      `[examined] east shore s ${span.s0}..${span.s1} right, ${drop.stations} stations: forest skirt ground found at ${control.skirted}, lake at ${drop.skirted}; lake land reach ${Math.min(...drop.reach)}..${Math.max(...drop.reach)} m, drop at ${drop.deep}`,
    );
    expect(control.skirted).toBeGreaterThan(control.stations * 0.8);
    expect(drop.skirted).toBe(0);
    for (const r of drop.reach) expect(r).toBeGreaterThan(0);
    // Full width wherever the road does not bend hard toward the lake.
    expect(drop.reach.filter((r) => Math.abs(r - LAKE_LAND_M) < 1e-6).length).toBeGreaterThan(
      drop.stations * 0.8,
    );
    expect(drop.deep).toBeGreaterThan(drop.stations * 0.8);
    for (const b of [plain!, lake!]) b.scene.dispose();
  });

  it("the verge: a bluff's is 4 m of dirt to a hard edge (the parapet's face), a lake's 4 m of grass to a soft one, a rock cut's the forest's", () => {
    const side = (tag: string) =>
      deriveVerge(
        {
          tags: [
            { s0: 0, s1: 100, side: 'both', tag: 'forest' },
            { s0: 0, s1: 100, side: 'right', tag },
          ],
        },
        'right',
        50,
      );
    expect(side('bluff')).toEqual({ widthM: 4, surface: 'dirt', edge: 'hard' });
    expect(side('lake')).toEqual({ widthM: 4, surface: 'grass', edge: 'soft' });
    expect(side('rock-cut')).toEqual(side('forest'));
  });
});

// ---- The real roads ---------------------------------------------------------------------------------

interface Built {
  road: RoadNetwork;
  dressing: RoadDressing;
  scene: RoadScene;
  items: RoadsideItem[];
  models: SceneryModels;
}

async function build(id: string, waterAt?: (x: number, z: number) => number | null): Promise<Built> {
  const { network, roads } = bakedRoads(id);
  const { road, dressing } = track(network, roads);
  const models = await modelsFor(road, dressing);
  const scene = buildRoadScene(road, look, dressing, { seed: SEED, models, roadsideDensity: 1 });
  const items = scatterRoadside({
    road,
    dressing,
    seed: SEED,
    density: 1,
    kit: PNW_KIT,
    landReach: (e, side, s) => scene.landReach(e, side, s),
    spots: scene.spots,
    models,
    ...(waterAt ? { waterAt } : {}),
  });
  return { road, dressing, scene, items, models };
}

const SHORE_RULES = ['parapet', 'bluff', 'rock-cut', 'boulder', 'lake-cabin', 'lake-dock'];

/** Points over an item's model box (its corners and mid-edges), in the world. */
function boxPoints(b: Built, it: RoadsideItem): { x: number; y: number; z: number }[] {
  const g = b.models.pnwShore?.variants[it.variant];
  if (!g) throw new Error(`no pnw-shore variant ${it.variant}`);
  g.computeBoundingBox();
  const box = g.boundingBox!;
  const cos = Math.cos(it.turn);
  const sin = Math.sin(it.turn);
  const out: { x: number; y: number; z: number }[] = [];
  for (const x of [box.min.x, (box.min.x + box.max.x) / 2, box.max.x])
    for (const z of [box.min.z, (box.min.z + box.max.z) / 2, box.max.z])
      for (const y of [box.min.y, box.max.y])
        out.push({
          x: it.p.x + it.size * (x * cos + z * sin),
          y: it.p.y + it.size * y,
          z: it.p.z + it.size * (z * cos - x * sin),
        });
  return out;
}

/** The shore props standing on (or poking up through) a lane of any road: a lane's span, from 3 m under it to 6 m over it. */
function onLanes(b: Built): string[] {
  const bad: string[] = [];
  for (const it of b.items.filter((i) => SHORE_RULES.includes(i.rule))) {
    for (const q of boxPoints(b, it)) {
      for (const e of b.road.edges) {
        const pos = nearestOnEdges(b.road, [e.index], q.x, q.z);
        if (!pos || pos.s <= 0.5 || pos.s >= e.length - 0.5) continue;
        if (pos.d < e.dMin - 0.05 || pos.d > e.dMax + 0.05) continue;
        const lane = b.road.toWorld(e.index, pos.s, pos.d, 0);
        if (Math.hypot(lane.x - q.x, lane.z - q.z) > 0.5) continue;
        if (q.y > lane.y - 3 && q.y < lane.y + 6)
          bad.push(
            `${it.rule}@${b.road.edges[it.edge]!.id}:${it.s.toFixed(0)} over ${e.id}:${pos.s.toFixed(0)}`,
          );
      }
    }
  }
  return [...new Set(bad)];
}

describe('Chuckanut Drive: the bay side drops, the uphill side is cut sandstone (H1, H2; CX6 item 7)', async () => {
  const b = await build('osm-pnw-chuckanut');
  const byRule = (rule: string) => b.items.filter((i) => i.rule === rule);
  const sideOf = (it: RoadsideItem): -1 | 1 => (it.d < 0 ? -1 : 1);
  const themeOf = (it: RoadsideItem, s = it.s) =>
    themeAt(b.road.edges[it.edge]!.tags, sideName(sideOf(it)), s);

  it("loads CX6's shore kit for the network that has these tags, and not for the Gorge", () => {
    expect(b.models.pnwShore).toBeDefined();
    const gorge = bakedRoads('osm-pnw-gorge');
    const g = track(gorge.network, gorge.roads);
    const { tropical, tags } = networkTags(g.road, g.dressing);
    expect(modelKindsFor({ tropical, tags, palette: new Set(), traffic: [] })).not.toContain('pnwShore');
  });

  it("bluff only where the road's drop side says so: the parapet at the band's hard edge, the bluff at the drop's edge", () => {
    let spanM = 0;
    for (const e of b.road.edges)
      for (const t of e.tags.filter((x) => x.tag === 'bluff')) {
        // The drop side is the side the span says: never both.
        expect(t.side === 'left' || t.side === 'right', `${e.id} ${t.s0}`).toBe(true);
        spanM += t.s1 - t.s0;
      }
    const parapets = byRule('parapet');
    const bluffs = byRule('bluff');
    for (const it of [...parapets, ...bluffs]) {
      const along = it.rule === 'bluff' ? 10 : 3;
      for (const u of [it.s - along, it.s, it.s + along])
        expect(themeOf(it, u), `${it.rule}@${it.s}`).toBe('bluff');
      // Never on the other side.
      expect(themeAt(b.road.edges[it.edge]!.tags, sideName(-sideOf(it) as -1 | 1), it.s)).not.toBe('bluff');
      const outer = outerOf(b.road, it.edge, sideOf(it));
      if (it.rule === 'bluff') expect(Math.abs(it.d) - outer).toBeCloseTo(BLUFF_LAND_M, 5);
      else {
        // Its face on the sim's hard edge (4 m of dirt past the lanes), not in the band.
        const v = b.road.vergeAt(it.edge, it.s, sideName(sideOf(it)));
        expect(v.edge).toBe('hard');
        expect(Math.abs(it.d) - Math.abs(v.dOuter)).toBeGreaterThanOrEqual(0);
        expect(Math.abs(it.d) - Math.abs(v.dOuter)).toBeLessThan(0.3);
      }
    }
    const parapetM = parapets.length * 6;
    print(
      `[examined] ${(spanM / 1000).toFixed(2)} km of bluff spans: ${parapets.length} parapet sections (${parapetM} m, ${((100 * parapetM) / spanM).toFixed(0)} %), ${bluffs.length} bluff sections`,
    );
    expect(spanM).toBeGreaterThan(1000);
    // The parapet runs along nearly all of it (it keeps off the signs, the pads and the zones).
    expect(parapetM).toBeGreaterThan(spanM * 0.7);
    expect(bluffs.length * 20).toBeGreaterThan(spanM * 0.5);
  });

  it("the bluff side's land is the shelf: never wider, nowhere skirted", () => {
    let stations = 0;
    for (const e of b.road.edges)
      for (const t of e.tags.filter((x) => x.tag === 'bluff')) {
        const side: -1 | 1 = t.side === 'left' ? -1 : 1;
        for (let s = t.s0 + 6; s <= t.s1 - 6; s += 10) {
          stations++;
          expect(b.scene.landReach(e.index, side, s)).toBeLessThanOrEqual(BLUFF_LAND_M + 1e-6);
        }
      }
    expect(stations).toBeGreaterThan(100);
  });

  it('rock cuts and boulders only on a rock-cut side: the face at the band edge, the boulders past it, the firs behind the cut', () => {
    const cuts = byRule('rock-cut');
    const boulders = byRule('boulder');
    for (const it of [...cuts, ...boulders]) {
      expect(themeOf(it), `${it.rule}@${it.s}`).toBe('cut');
      const v = b.road.vergeAt(it.edge, it.s, sideName(sideOf(it)));
      // Clear of the ridable band: a rider never rides through rock.
      expect(Math.abs(it.d)).toBeGreaterThan(Math.abs(v.dOuter));
    }
    for (const it of cuts) {
      const v = b.road.vergeAt(it.edge, it.s, sideName(sideOf(it)));
      expect(Math.abs(it.d) - Math.abs(v.dOuter)).toBeLessThan(0.5);
    }
    const firs = b.scene.spots.filter(
      (sp) =>
        sp.kind === 'conifer' &&
        themeAt(b.road.edges[sp.edge]!.tags, sideName(sp.d < 0 ? -1 : 1), sp.s) === 'cut',
    );
    for (const sp of firs)
      expect(Math.abs(sp.d) - outerOf(b.road, sp.edge, sp.d < 0 ? -1 : 1)).toBeGreaterThanOrEqual(
        (THEME_NEAR_M.cut ?? 0) - 1e-6,
      );
    print(
      `[examined] ${cuts.length} cut sections, ${boulders.length} boulders, ${firs.length} firs on the cut sides`,
    );
    expect(cuts.length * 6).toBeGreaterThan(1000);
    expect(boulders.length).toBeGreaterThan(10);
    expect(firs.length).toBeGreaterThan(20);
  });

  it('nothing stands on a lane', () => {
    const shore = b.items.filter((i) => SHORE_RULES.includes(i.rule));
    expect(shore.length).toBeGreaterThan(300);
    expect(onLanes(b)).toEqual([]);
  });
});

describe('Lake Samish: the cabins and docks on the shore drive (I3; CX6 item 8)', async () => {
  const file = Object.values(backdropFiles).find((f) => f.network === 'osm-pnw-samish');
  if (!file) throw new Error('no Lake Samish backdrop');
  const floors = waterFloors(file);
  const waterAt = waterAtOf(floors);
  const b = await build('osm-pnw-samish', waterAt);
  const byRule = (rule: string) => b.items.filter((i) => i.rule === rule);
  const lakeSides = b.road.edges.flatMap((e) =>
    e.tags.filter((t) => t.tag === 'lake').map((t) => ({ e, t, side: sideOf(t) })),
  );

  it('the lake is one water floor above the sea, at the level 3DEP gives its surface', () => {
    expect(floors.length).toBe(1);
    expect(floors[0]!.level).toBeCloseTo(82.85, 2);
    expect(lakeSides.length).toBeGreaterThan(0);
  });

  it("the lake's water lies past every lake side and never under a lane; its land stands above it", () => {
    let past = 0;
    let stations = 0;
    for (const { e, t, side } of lakeSides) {
      for (let s = t.s0 + 6; s <= t.s1 - 6; s += 10) {
        stations++;
        const reach = b.scene.landReach(e.index, side, s);
        const p = b.road.toWorld(e.index, s, side * (outerOf(b.road, e.index, side) + reach + 1), 0);
        if (waterAt(p.x, p.z) !== null) past++;
        expect(b.road.toWorld(e.index, s, 0, 0).y).toBeGreaterThan(floors[0]!.level + 1);
      }
    }
    let lanes = 0;
    const under: string[] = [];
    for (const e of b.road.edges)
      for (let s = 0; s <= e.length; s += 4)
        for (const d of [e.dMin, 0, e.dMax]) {
          lanes++;
          const p = b.road.toWorld(e.index, s, d, 0);
          if (waterAt(p.x, p.z) !== null) under.push(`${e.id}:${s}/${d}`);
        }
    print(
      `[examined] ${stations} lake-side stations, water past the land at ${past}; ${lanes} lane points, ${under.length} over water`,
    );
    expect(stations).toBeGreaterThan(50);
    expect(past).toBe(stations);
    expect(under).toEqual([]);
  });

  it("the dock's root at the shore: the lake land's edge, at the water's level, the dock out over the water", () => {
    const docks = byRule('lake-dock');
    expect(docks.length).toBeGreaterThan(3);
    for (const it of docks) {
      const side: -1 | 1 = it.d < 0 ? -1 : 1;
      expect(themeAt(b.road.edges[it.edge]!.tags, sideName(side), it.s)).toBe('lake');
      const outer = outerOf(b.road, it.edge, side);
      expect(Math.abs(it.d) - outer).toBeCloseTo(LAKE_LAND_M, 5);
      expect(b.scene.landReach(it.edge, side, it.s)).toBeCloseTo(LAKE_LAND_M, 5);
      // At the water as drawn (a hair under its level, shapes.ts buildFloor).
      expect(it.p.y).toBeCloseTo(floors[0]!.surfaceY, 5);
      // It runs out along its -Z, away from the road, over the water all the way.
      const out = { x: Math.sin(it.turn + Math.PI), z: Math.cos(it.turn + Math.PI) };
      const toRoad = b.road.toWorld(it.edge, it.s, 0, 0);
      expect(out.x * (toRoad.x - it.p.x) + out.z * (toRoad.z - it.p.z)).toBeLessThan(0);
      for (const m of [2, 7, 14]) expect(waterAt(it.p.x + out.x * m, it.p.z + out.z * m)).not.toBeNull();
    }
  });

  it('the cabins stand wholly on the lake land, facing the road, clear of the ridable band', () => {
    const cabins = byRule('lake-cabin');
    expect(cabins.length).toBeGreaterThan(3);
    for (const it of cabins) {
      const side: -1 | 1 = it.d < 0 ? -1 : 1;
      expect(themeAt(b.road.edges[it.edge]!.tags, sideName(side), it.s)).toBe('lake');
      const outer = outerOf(b.road, it.edge, side);
      const v = b.road.vergeAt(it.edge, it.s, sideName(side));
      // The porch (1.5 m before the anchor) past the band; the back deck (11 m behind) on the land.
      expect(Math.abs(it.d) - 1.5).toBeGreaterThan(Math.abs(v.dOuter));
      expect(Math.abs(it.d) - outer + 11).toBeLessThanOrEqual(b.scene.landReach(it.edge, side, it.s) + 1e-6);
    }
    print(
      `[examined] ${cabins.length} cabins, ${byRule('lake-dock').length} docks on ${lakeSides.length} lake spans`,
    );
  });

  it('nothing stands on a lane', () => {
    expect(onLanes(b)).toEqual([]);
  });

  it('without the water floor (the backdrop not in yet), no dock is placed, and nothing else moves', async () => {
    const dry = await build('osm-pnw-samish');
    expect(dry.items.filter((i) => i.rule === 'lake-dock')).toEqual([]);
    const key = (items: readonly RoadsideItem[]) =>
      items
        .filter((i) => i.rule !== 'lake-dock')
        .map((i) => `${i.rule}@${i.edge}:${i.s.toFixed(2)}/${i.d.toFixed(2)}`)
        .join(',');
    expect(key(dry.items)).toBe(key(b.items));
  });
});
