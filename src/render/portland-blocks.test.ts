// Downtown Portland's blocks (playtest 3, T12.6; wave B's punch list, item 3: Broadway should read as
// downtown, not as open fields with farmhouses). The checks build Bridge City the way the game does,
// with CX4's real kit and the Pacific Northwest atlas, and look at what stands where: the street fronts
// along the land, the pink towers stacked from their modules, the cart pod, the roof sign and the
// square placed by the baked road, and the control that the old `town` ground drew bait shacks and palms.
import { type Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import {
  DowntownLayer,
  hasPortland,
  MODULE_M,
  PDX,
  PDX_CART_BACK_M,
  PDX_OVERHANG_M,
  PDX_PODS,
  pdxFootprint,
  planPortland,
  rectOf,
  rectsOverlap,
  SIDEWALK_M,
  type DowntownItem,
  type Rect,
} from './downtown';
import { readGlb } from './glb';
import { ATLAS_WHITE_UV } from './scenery-merge';
import { landmarkPlacements, LandmarkLayer } from './landmarks';
import { createFlatLook } from './look';
import { bakeLandmarkKit, modelKindsFor, type LandmarkKit } from './models';
import { bakeRepoModel, readAsset } from './model-files.test-util';
import { buildRoadScene, networkTags, type RoadDressing, type RoadScene } from './road-mesh';
import { themeAt } from './scenery';

const look = createFlatLook();
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const networkFiles = import.meta.glob<BakedNetwork>('../../packs/region-pnw/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/region-pnw/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

const network = Object.values(networkFiles).find((n) => n.id === 'osm-pnw-portland');
if (!network) throw new Error('no network osm-pnw-portland');
const bakedRoads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
const road: RoadNetwork = createRoadNetwork({ network, roads: bakedRoads });
const dressing = Object.fromEntries(bakedRoads.map((r) => [r.id, r])) as unknown as RoadDressing;
const kit = await bakeRepoModel('pdxDowntown');
const scene: RoadScene = buildRoadScene(road, look, dressing, { seed: 1, models: {}, roadsideDensity: 1 });
const input = {
  road,
  dressing,
  seed: 1,
  portland: { landReach: (e: number, side: -1 | 1, s: number) => scene.landReach(e, side, s) },
};
const plan = planPortland(input, kit);
const isBuilding = (it: DowntownItem) => it.rule === 'pdx-front' || it.rule === 'pdx-tower';
const sideOf = (it: DowntownItem): -1 | 1 => (it.d < 0 ? -1 : 1);
const outerOf = (edge: number, side: -1 | 1) => {
  const e = road.edges[edge];
  if (!e) throw new Error(`no edge ${edge}`);
  return (side < 0 ? -e.dMin : e.dMax) + 0.6;
};
const idOf = (edge: number) => road.edges[edge]?.id ?? '';

/** The features of a road that the plan keeps clear, as [edge, s0, s1, d0, d1, kind, params]. */
function featuresOf(edge: number) {
  const e = road.edges[edge];
  return (dressing[e?.id ?? '']?.features ?? []) as unknown as {
    kind: string;
    id: string;
    s0: number;
    s1: number;
    d0: number;
    d1: number;
    params?: Record<string, unknown>;
  }[];
}

describe("Bridge City's blocks", () => {
  it('is Portland: the tag is on, the kit loads with the Pacific Northwest atlas, and the old ground is gone', () => {
    const { tags, tropical } = networkTags(road, dressing);
    expect(hasPortland(tags)).toBe(true);
    const kinds = modelKindsFor({ tropical, tags, palette: new Set(), traffic: [] });
    expect(kinds).toContain('pdxDowntown');
    // Another region's networks do not load it.
    expect(
      modelKindsFor({ tropical: true, tags: new Set(['key-oldtown']), palette: new Set(), traffic: [] }),
    ).not.toContain('pdxDowntown');
    expect(kit.map, 'the kit draws with its atlas').toBeDefined();
    // The tag `town` beside it used to scatter palms and bait shacks (the theme `commercial`); the theme is the blocks now.
    for (const e of road.edges) {
      const t = dressing[e.id]?.tags;
      if (!t?.some((x) => x.tag === 'pdx-blocks')) continue;
      for (const side of ['left', 'right'] as const)
        for (let s = 0; s <= e.length; s += 20) {
          const theme = themeAt(t, side, s);
          expect(['blocks', 'none'], `${e.id} ${side} ${s}`).toContain(theme);
        }
    }
    const stats = scene.stats.scenery;
    stdout.write(
      `[examined] Bridge City's ground draws ${stats.palm} palms, ${stats.shack} shacks, ${stats.pole} poles, ${stats.house} houses\n`,
    );
    expect(stats.palm + stats.shack + stats.pole + stats.house).toBe(0);
  });

  it('stands buildings along Broadway on both sides, a cross street every block', () => {
    for (const id of ['osm-pnw-pdx-broadway', 'osm-pnw-pdx-broadway-south']) {
      const edge = road.edgeIndex(id);
      const length = road.edges[edge]?.length ?? 0;
      for (const side of [-1, 1] as const) {
        const here = plan.items.filter((i) => i.edge === edge && sideOf(i) === side && isBuilding(i));
        expect(here.length, `${id} ${side}`).toBeGreaterThanOrEqual(6);
        // The frontage: how much of the side's length a building covers. (A pod, a landmark, a cross
        // street and a lot take the rest.)
        let covered = 0;
        for (const it of here)
          covered += pdxFootprint(kit, it.variant === PDX.towerBase ? PDX.towerBase : it.variant)[0];
        stdout.write(
          `[examined] ${id} ${side > 0 ? 'right' : 'left'}: ${here.length} buildings cover ${((covered / length) * 100).toFixed(0)} % of ${length.toFixed(0)} m\n`,
        );
        expect(covered / length, `${id} ${side}`).toBeGreaterThan(0.4);
      }
    }
  });

  it('stands every building on land the road scene drew, behind its sidewalk, facing the road', () => {
    const buildings = plan.items.filter(isBuilding);
    expect(buildings.length).toBeGreaterThan(100);
    let deepest = 0;
    for (const it of buildings) {
      const side = sideOf(it);
      const outer = outerOf(it.edge, side);
      const [width, depth] = pdxFootprint(kit, it.variant);
      const front = Math.abs(it.d) - outer;
      expect(front, `${idOf(it.edge)} s ${it.s.toFixed(0)}: behind the sidewalk`).toBeGreaterThanOrEqual(
        SIDEWALK_M - 1e-6,
      );
      // Land under the front, and all but PDX_OVERHANG_M of the depth.
      for (const u of [it.s - width / 2, it.s, it.s + width / 2]) {
        const reach = scene.landReach(it.edge, side, Math.max(0, u));
        expect(reach, `${idOf(it.edge)} s ${u.toFixed(0)}: land under the front`).toBeGreaterThanOrEqual(
          front + 4 - 1e-6,
        );
        expect(reach, `${idOf(it.edge)} s ${u.toFixed(0)}: land under the depth`).toBeGreaterThanOrEqual(
          front + depth - PDX_OVERHANG_M - 1e-6,
        );
        deepest = Math.max(deepest, front + depth - reach);
      }
      // Faces the road: the model's +Z (sin turn, cos turn) points at the centre line.
      const c = road.toWorld(it.edge, it.s, 0, 0);
      const toRoad = new Vector3(c.x - it.p.x, 0, c.z - it.p.z).normalize();
      expect(
        toRoad.x * Math.sin(it.turn) + toRoad.z * Math.cos(it.turn),
        `${idOf(it.edge)} s ${it.s.toFixed(0)}`,
      ).toBeGreaterThan(0.99);
    }
    stdout.write(
      `[examined] ${buildings.length} buildings: each stands on land, the deepest overhang past it ${deepest.toFixed(1)} m\n`,
    );
    // Whatever the constant says, a back corner hangs over a drop of 2 or 3 m at most (the skirt falls 1 in 2.2).
    expect(deepest).toBeLessThanOrEqual(6);
  });

  it('stands on the ground along its whole front: the floor at the highest, the base down to the lowest', () => {
    for (const it of plan.items.filter(isBuilding)) {
      const side = sideOf(it);
      const [width] = pdxFootprint(kit, it.variant);
      const e = road.edges[it.edge];
      let hi = -Infinity;
      let lo = Infinity;
      for (let u = it.s - width / 2; u <= it.s + width / 2 + 1e-6; u += 3) {
        const y = road.toWorld(it.edge, Math.max(0, Math.min(e?.length ?? 0, u)), side * Math.abs(it.d), 0).y;
        hi = Math.max(hi, y);
        lo = Math.min(lo, y);
      }
      // (The land top is a hand's breadth under the road: LAND_TOP_M.)
      expect(
        it.p.y,
        `${idOf(it.edge)} s ${it.s.toFixed(0)}: no floor under the ground`,
      ).toBeGreaterThanOrEqual(hi - 0.1 - 1e-6);
      expect(
        it.foot ?? Infinity,
        `${idOf(it.edge)} s ${it.s.toFixed(0)}: the base reaches the low end`,
      ).toBeLessThanOrEqual(lo - 0.09 + 1e-6);
      // And not far under it: the facade's picture stretches by the sink.
      expect(it.p.y - (it.foot ?? it.p.y), `${idOf(it.edge)} s ${it.s.toFixed(0)}`).toBeLessThanOrEqual(
        hi - lo + 0.5,
      );
    }
  });

  it('overlaps no other building, and no building or cart stands on a road or within a sidewalk of one', () => {
    const rects = plan.items
      .filter((i) => isBuilding(i) || i.rule === 'pdx-cart')
      .map((i) => {
        const [width, depth] = i.rule === 'pdx-cart' ? [8.1, 2.4] : pdxFootprint(kit, i.variant);
        const r = rectOf(i.p, i.turn, width, depth);
        return i.rule === 'pdx-cart' ? { ...r, cx: r.cx + r.ux * 1.55, cz: r.cz + r.uz * 1.55 } : r;
      });
    expect(rects.length).toBeGreaterThan(200);
    let pairs = 0;
    for (let a = 0; a < rects.length; a++)
      for (let b = a + 1; b < rects.length; b++) {
        pairs++;
        expect(rectsOverlap(rects[a] as Rect, rects[b] as Rect), `${a} and ${b}`).toBe(false);
      }
    // Every corner, edge middle and centre of a building is off the road beside it: projected onto the
    // road, it lies past the verge by more than a sidewalk less a corner's give.
    for (const [i, r] of rects.entries()) {
      for (const a of [-1, 0, 1])
        for (const b of [-1, 0, 1]) {
          const x = r.cx + r.ux * a * r.hw + r.vx * b * r.hd;
          const z = r.cz + r.uz * a * r.hw + r.vz * b * r.hd;
          const pos = road.project(
            x,
            z,
            plan.items.filter((q) => isBuilding(q) || q.rule === 'pdx-cart')[i]?.edge,
          );
          const e2 = road.edges[pos.edge];
          const lim = (pos.d < 0 ? -(e2?.dMin ?? 0) : (e2?.dMax ?? 0)) + 0.6;
          expect(Math.abs(pos.d), `item ${i} point ${a},${b} on ${e2?.id}`).toBeGreaterThanOrEqual(
            lim + SIDEWALK_M - 1.2 - 1e-6,
          );
        }
    }
    stdout.write(`[examined] ${rects.length} footprints, ${pairs} pairs: none overlap; every point is off the road
`);
  });

  it('keeps clear of every zone, sign, pad, lot and landmark the road names: no footprint overlaps one', () => {
    let checked = 0;
    for (const it of plan.items.filter(isBuilding)) {
      const side = sideOf(it);
      const [width, depth] = pdxFootprint(kit, it.variant);
      const lo = Math.abs(it.d);
      const hi = lo + depth;
      for (const f of featuresOf(it.edge)) {
        if (!['roadsideZone', 'billboard', 'boostPad', 'copSpawn', 'landmark', 'rampTruck'].includes(f.kind))
          continue;
        const fa = Math.min(f.d0 * side, f.d1 * side);
        const fb = Math.max(f.d0 * side, f.d1 * side);
        const along = Math.min(f.s0, f.s1) < it.s + width / 2 && Math.max(f.s0, f.s1) > it.s - width / 2;
        const overlaps = along && fa < hi && fb > lo;
        expect(overlaps, `${idOf(it.edge)} s ${it.s.toFixed(0)} over ${f.id}`).toBe(false);
        checked++;
      }
    }
    stdout.write(`[examined] ${checked} building-and-feature pairs, none overlapping
`);
    expect(checked).toBeGreaterThan(50);
  });

  it('stacks the pink towers from their modules, never stretched, within half a mid of the height asked', () => {
    const towers = plan.items.filter((i) => i.rule === 'pdx-tower');
    expect(towers.length).toBeGreaterThan(5);
    for (const t of towers) {
      expect(t.model).toBe('tower');
      expect(t.sy).toBe(1);
      const built = MODULE_M.base + (t.mids ?? 0) * MODULE_M.mid + MODULE_M.crown;
      expect(Math.abs(built - (t.targetM ?? 0)), `${idOf(t.edge)} s ${t.s.toFixed(0)}`).toBeLessThanOrEqual(
        MODULE_M.mid / 2 + MODULE_M.base,
      );
    }
    // The kit's modules are the sizes the stack uses.
    for (const [variant, height] of [
      [PDX.towerBase, 7],
      [PDX.towerMid, 14],
      [PDX.towerCrown, 8],
    ] as const) {
      const box = kit.variants[variant]?.boundingBox;
      expect(box?.max.y, `module ${variant}`).toBeCloseTo(height, 3);
    }
  });
});

describe("the cart pod on Broadway's right", () => {
  const pod = featuresOf(road.edgeIndex('osm-pnw-pdx-broadway')).find(
    (f) => f.params?.['dressing'] === PDX_PODS,
  );
  const carts = plan.items.filter((i) => i.rule === 'pdx-cart');

  it('is the zone that says `dressing: food-carts`, and every cart stands in its lot', () => {
    expect(pod?.id).toBe('cart-pod');
    expect(carts.length).toBeGreaterThanOrEqual(5);
    for (const c of carts) {
      expect(c.edge).toBe(road.edgeIndex('osm-pnw-pdx-broadway'));
      expect(c.s).toBeGreaterThanOrEqual(Math.min(pod?.s0 ?? 0, pod?.s1 ?? 0));
      expect(c.s).toBeLessThanOrEqual(Math.max(pod?.s0 ?? 0, pod?.s1 ?? 0));
      // Behind the zone the diners stand in, serving side to the road.
      expect(Math.abs(c.d)).toBeCloseTo(
        Math.max(Math.abs(pod?.d0 ?? 0), Math.abs(pod?.d1 ?? 0)) + PDX_CART_BACK_M,
        6,
      );
      expect(Math.sign(c.d)).toBe(Math.sign(pod?.d0 ?? 1));
    }
    // All three carts, so all three names show; and no building stands in the lot.
    expect(new Set(carts.map((c) => c.variant))).toEqual(new Set([PDX.cartA, PDX.cartB, PDX.cartC]));
    const lo = Math.min(pod?.s0 ?? 0, pod?.s1 ?? 0);
    const hi = Math.max(pod?.s0 ?? 0, pod?.s1 ?? 0);
    for (const b of plan.items.filter(isBuilding))
      if (b.edge === carts[0]?.edge && sideOf(b) === sideOf(carts[0]))
        expect(b.s < lo - 1 || b.s > hi + 1, `a building at s ${b.s.toFixed(0)} in the pod`).toBe(true);
  });

  it('has no cart anywhere else, and a control: with the zone not saying so, none stands', () => {
    expect(carts.every((c) => idOf(c.edge) === 'osm-pnw-pdx-broadway')).toBe(true);
    const plain = Object.fromEntries(
      bakedRoads.map((r) => [
        r.id,
        {
          ...r,
          features: (r.features ?? []).map((f) => ({ ...f, params: { ...f.params, dressing: undefined } })),
        },
      ]),
    ) as unknown as RoadDressing;
    const control = planPortland({ ...input, dressing: plain }, kit);
    expect(control.items.filter((i) => i.rule === 'pdx-cart')).toHaveLength(0);
  });

  it("gives each cart its name board, filled by the pack's signs `pdx-food-cart-a-name` to `-c-name`", () => {
    const layer = new DowntownLayer(kit, undefined, undefined, look, input);
    const surfaces = layer.surfaces();
    expect(surfaces).toHaveLength(carts.length);
    expect(new Set(surfaces.map((s) => s.id))).toEqual(
      new Set(['pdx-food-cart-a-name', 'pdx-food-cart-b-name', 'pdx-food-cart-c-name']),
    );
    // Each board faces the road, like its cart.
    for (const [i, s] of surfaces.entries()) {
      const cart = carts[i] as DowntownItem;
      const c = road.toWorld(cart.edge, cart.s, 0, 0);
      const toRoad = new Vector3(c.x - s.centre.x, 0, c.z - s.centre.z).normalize();
      expect(toRoad.dot(new Vector3(s.normal.x, 0, s.normal.z).normalize())).toBeGreaterThan(0.99);
    }
  });
});

describe('the layer, as the game draws it, on Bridge City', () => {
  it('draws each stretch as one mesh with the Pacific Northwest atlas as its map', () => {
    const layer = new DowntownLayer(kit, undefined, undefined, look, input);
    const e = road.edgeIndex('osm-pnw-pdx-broadway');
    const at = road.toWorld(e, 150, 0, 0);
    for (let i = 0; i < 12; i++) layer.update(at.x, at.z, 0, []);
    const meshes: Mesh[] = [];
    layer.group.traverse((o) => {
      if ((o as Mesh).isMesh && o.visible) meshes.push(o as Mesh);
    });
    expect(meshes.length).toBeGreaterThan(0);
    for (const m of meshes) {
      const mat = m.material as { map?: unknown };
      expect(mat.map, 'every stretch samples the atlas').toBe(kit.map);
    }
    // The facades are on the sheet: the meshes' vertices include ones that sample a tile that is not the white one.
    let facade = 0;
    let all = 0;
    for (const m of meshes) {
      const uv = m.geometry.getAttribute('uv');
      expect(uv, 'the stretch has atlas UVs').toBeDefined();
      for (let i = 0; i < uv.count; i++) {
        all++;
        if (
          Math.abs(uv.getX(i) - ATLAS_WHITE_UV[0]) > 1e-4 ||
          Math.abs(uv.getY(i) - ATLAS_WHITE_UV[1]) > 1e-4
        )
          facade++;
      }
    }
    expect(facade, 'vertices on a picture tile, of ' + all).toBeGreaterThan(0);
    expect(layer.counts().crossings).toBe(0);
    expect(layer.counts().vehicles).toBe(0);
    stdout.write(
      `[examined] Broadway's middle: ${meshes.length} stretch meshes in range, ${layer.counts().triangles} triangles\n`,
    );
    // A tower's top is the stack's height: base, mids, crown, at scale 1.
    const tower = plan.items.find((i) => i.rule === 'pdx-tower');
    expect(tower).toBeDefined();
  });
});

describe("the roof sign and the square on Bridge City's roads", () => {
  const kitFor = async (): Promise<Map<'pdx-landmarks', LandmarkKit>> =>
    new Map([
      [
        'pdx-landmarks',
        bakeLandmarkKit('pdx-landmarks', readGlb(await readAsset('models/landmarks/pdx-landmarks', 'glb'))),
      ],
    ]);

  it('places the Hawthorne lift towers, the roof sign and the square, each by a node the kit has', async () => {
    const kits = await kitFor();
    const placements = landmarkPlacements(road).filter((p) => p.kit === 'pdx-landmarks');
    const nodes = placements.map((p) => p.node).sort();
    expect(nodes).toEqual(['pdx_lift_tower', 'pdx_lift_tower', 'pdx_plaza', 'pdx_roof_sign']);
    for (const p of placements) {
      const kitNodes = kits.get('pdx-landmarks')?.nodes;
      expect(kitNodes?.has(p.node) || kitNodes?.has(`${p.node}_lod0`), `${p.feature.id}: ${p.node}`).toBe(
        true,
      );
    }
    const layer = new LandmarkLayer(kits, look, { road });
    expect(layer.counts().skipped).toBe(0);
    expect(layer.counts().placed).toBe(4);
    // The roof sign's board is a text surface to paint, and the lift towers have none.
    expect(layer.surfaces().map((s) => s.id)).toEqual(['pdx-roof-sign-words']);
  });

  it("stands the roof sign on its building's ground, its face toward the rider coming off the Burnside Bridge", () => {
    const sign = landmarkPlacements(road).find((p) => p.node === 'pdx_roof_sign');
    expect(sign?.feature.id).toBe('roof-sign');
    const rider = road.frameAt(sign?.edge ?? 0, (sign?.feature.s0 ?? 0) + 7);
    // The model's +Z (the board's face) points along the heading plus the yaw: against the road's own direction.
    const face = new Vector3(Math.sin(sign?.yaw ?? 0), 0, Math.cos(sign?.yaw ?? 0));
    expect(face.x * rider.tx + face.z * rider.tz).toBeLessThan(-0.95);
    // It stands on the right of West Burnside (the north side, as the real sign does), on drawn land: its
    // whole footprint inside what the road scene drew.
    const f = sign?.feature;
    expect(f?.d0).toBeGreaterThan(0);
    const e = sign?.edge ?? 0;
    const reach = Math.min(
      ...[f?.s0 ?? 0, ((f?.s0 ?? 0) + (f?.s1 ?? 0)) / 2, f?.s1 ?? 0].map((s) => scene.landReach(e, 1, s)),
    );
    expect(
      (f?.d1 ?? 0) - outerOf(e, 1),
      'the footprint reaches past the land only by what a base can sink',
    ).toBeLessThanOrEqual(reach + PDX_OVERHANG_M);
  });

  it('stands the square beside Broadway on its left, on the zone the pedestrians use, clear of the road', () => {
    const plaza = landmarkPlacements(road).find((p) => p.node === 'pdx_plaza');
    expect(plaza?.feature.id).toBe('square-plaza');
    expect(plaza?.feature.d1).toBeLessThanOrEqual(-13.5);
    const zone = featuresOf(plaza?.edge ?? 0).find((f) => f.id === 'courthouse-square');
    expect(zone, 'the courthouse-square zone is on the same road').toBeDefined();
    // The zone's people stand on the square: the footprint covers the zone along the road.
    expect(Math.min(plaza?.feature.s0 ?? 0, plaza?.feature.s1 ?? 0)).toBeGreaterThanOrEqual(
      Math.min(zone?.s0 ?? 0, zone?.s1 ?? 0),
    );
    expect(Math.max(plaza?.feature.s0 ?? 0, plaza?.feature.s1 ?? 0)).toBeLessThanOrEqual(
      Math.max(zone?.s0 ?? 0, zone?.s1 ?? 0),
    );
    // Its far side may overhang the land only by what its base can sink.
    const e = plaza?.edge ?? 0;
    const reach = scene.landReach(e, -1, ((plaza?.feature.s0 ?? 0) + (plaza?.feature.s1 ?? 0)) / 2);
    expect(Math.abs(plaza?.feature.d0 ?? 0) - outerOf(e, -1)).toBeLessThanOrEqual(reach + PDX_OVERHANG_M);
    // And no building is placed over it.
    for (const b of plan.items.filter((i) => isBuilding(i) && i.edge === e && sideOf(i) === -1))
      expect(
        b.s < (plaza?.feature.s0 ?? 0) - 1 || b.s > (plaza?.feature.s1 ?? 0) + 1,
        `a building at s ${b.s.toFixed(0)} over the square`,
      ).toBe(true);
  });
});
