// The Pacific Northwest's places as drawn (run W-U, the pitch deck's #12), on the real baked track:
// every solid hazard a rider can hit is drawn at its own box and about its own size, the ferry's hull
// covers its stretch from the water up and its passenger deck clears the chase camera, nothing the
// clear-cut scatters stands on the ridable dirt, and the Stump Social lines both sidewalks with shops,
// leaving the side streets open behind their barricades. The layer merges into a few draw calls.
import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedFeature, type BakedNetwork, type BakedRoad } from '../road';
import { createFlatLook } from './look';
import { FERRY_DIM, hasPnwPlaces, placeItems, PnwPlacesLayer, PLACES_BLOCK_M } from './pnw-places';

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/region-pnw/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/region-pnw/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

const network = Object.values(networkFiles).find((n) => n.id === 'pnw-c1');
if (!network) throw new Error('no pnw-c1');
const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
const road = createRoadNetwork({ network, roads });
const items = placeItems(road, 7, () => 24);
const solid = road.edges.flatMap((e) =>
  e.features.filter((f) => f.kind === 'hazard' && f.params?.['solid'] === true).map((f) => ({ e, f })),
);

const boxOf = (it: (typeof items)[number]) => {
  it.geometry.computeBoundingBox();
  return it.geometry.boundingBox ?? new Box3();
};

describe('the Pacific Northwest places (run W-U)', () => {
  it('loads only for a network with a place tag', () => {
    expect(hasPnwPlaces(new Set(['forest', 'ferry']))).toBe(true);
    expect(hasPnwPlaces(new Set(['forest', 'town', 'bridge']))).toBe(false);
  });

  it('draws every solid hazard at its own box, about its own size', () => {
    const threats = items.filter((i) => i.threat);
    console.log(`[examined] ${solid.length} solid hazards on pnw-c1, ${threats.length} drawn`);
    expect(solid.length).toBeGreaterThan(120);
    expect(threats).toHaveLength(solid.length);
    const bad: string[] = [];
    for (const { e, f } of solid) {
      const s = (f.s0 + f.s1) / 2;
      const d = (f.d0 + f.d1) / 2;
      const it = threats.find(
        (t) => t.edge === e.index && Math.abs(t.s - s) < 1e-6 && Math.abs(t.d - d) < 1e-6,
      );
      if (!it) {
        bad.push(`${f.id}: not drawn`);
        continue;
      }
      const b = boxOf(it);
      const size = b.getSize(new Vector3());
      const top = b.max.y;
      const want = typeof f.params?.['heightM'] === 'number' ? f.params['heightM'] : 1.5;
      // Its footprint (either way round: a bear turns to face the road) and its height.
      const across = Math.abs(f.d1 - f.d0);
      const along = Math.abs(f.s1 - f.s0);
      const fits = (a: number, b2: number) => Math.abs(a - across) < 0.8 && Math.abs(b2 - along) < 0.8;
      if (!fits(size.x, size.z) && !fits(size.z, size.x))
        bad.push(`${f.id}: ${size.x}x${size.z} for ${across}x${along}`);
      if (Math.abs(top - want) > 0.6) bad.push(`${f.id}: top ${top.toFixed(2)} for ${want}`);
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('builds the ferry over its whole stretch, from below the water to a passenger deck the camera rides under', () => {
    const landing = road.edgeIndex('pnw-ferry-landing');
    const tag = road.edges[landing]?.tags.find((t) => t.tag === 'ferry');
    const hull = items.filter((i) => i.kind === 'ferry-hull');
    expect(tag).toBeDefined();
    expect(hull.length).toBeGreaterThanOrEqual(8);
    let covered = 0;
    for (const h of hull) {
      const b = boxOf(h);
      covered += b.max.z - b.min.z;
      const deckY = road.toWorld(landing, h.s, 0, 0).y;
      expect(deckY + b.min.y, `hull at ${h.s}`).toBeLessThan(0);
      expect(b.max.x - b.min.x).toBeGreaterThanOrEqual(FERRY_DIM.hullHalfW * 2);
    }
    expect(covered).toBeCloseTo((tag?.s1 ?? 0) - (tag?.s0 ?? 0), 1);
    // The car deck's ceiling: above the chase camera at its highest default (far chase 4.2 m, plus the
    // phone's 0.6 and a crest hop) on every hull section that carries the passenger deck.
    expect(FERRY_DIM.ceilingY).toBeGreaterThan(6);
    expect(hull.filter((h) => boxOf(h).max.y > FERRY_DIM.ceilingY).length).toBeGreaterThan(3);
    expect(items.filter((i) => i.kind === 'ferry-funnel')).toHaveLength(1);
    expect(items.filter((i) => i.kind === 'ferry-name')).toHaveLength(1);
  });

  it("keeps the clear-cut's scatter off the ridable dirt", () => {
    const scatter = items.filter((i) => ['cut-stump', 'slash', 'snag'].includes(i.kind));
    console.log(`[examined] clear-cut scatter: ${scatter.length} props past the dirt`);
    expect(scatter.length).toBeGreaterThan(40);
    for (const it of scatter) {
      const v = road.vergeAt(it.edge, it.s, it.d < 0 ? 'left' : 'right');
      expect(Math.abs(it.d), `${it.kind} at ${road.edges[it.edge]?.id} ${it.s.toFixed(0)}`).toBeGreaterThan(
        Math.abs(v.dOuter),
      );
    }
  });

  it('lines the Stump Social with shops at the sidewalk, side streets in the gaps, bunting and two banners', () => {
    const row = road.edgeIndex('pnw-espresso-row');
    const bears = (road.edges[row]?.features ?? []).filter(
      (f: BakedFeature) => f.kind === 'hazard' && f.params?.['object'] === 'bear',
    );
    const shops = items.filter((i) => i.kind === 'shop' && i.edge === row);
    const streets = items.filter((i) => i.kind === 'side-street' && i.edge === row);
    expect(streets).toHaveLength(bears.length / 2);
    expect(shops.length).toBeGreaterThan(40);
    for (const sh of shops) {
      const v = road.vergeAt(row, sh.s, sh.d < 0 ? 'left' : 'right');
      expect(Math.abs(sh.d)).toBeCloseTo(Math.abs(v.dOuter), 6);
      const b = boxOf(sh);
      const half = (b.max.z - b.min.z) / 2;
      for (const st of streets.filter((x) => Math.sign(x.d) === Math.sign(sh.d))) {
        const sb = boxOf(st);
        const gap = (sb.max.z - sb.min.z) / 2;
        expect(Math.abs(sh.s - st.s), `shop at ${sh.s.toFixed(1)} over a side street`).toBeGreaterThanOrEqual(
          half + gap - 0.6,
        );
      }
    }
    expect(items.filter((i) => i.kind === 'bunting').length).toBeGreaterThanOrEqual(10);
    expect(items.filter((i) => i.kind === 'banner')).toHaveLength(2);
  });

  it('merges into a few draw calls: one mesh per 320 m square near the camera', () => {
    const layer = new PnwPlacesLayer(createFlatLook(), { road, seed: 7, landReach: () => 24 });
    const landing = road.edgeIndex('pnw-ferry-landing');
    const at = road.toWorld(landing, 240, 0, 0);
    const shown = layer.update(at.x, at.z, 360, 200, Infinity);
    const c = layer.counts();
    console.log(
      `[examined] places layer: ${c.blocks} blocks of ${PLACES_BLOCK_M} m; on the ferry ${c.meshes} meshes, ${Math.round(c.triangles)} triangles, ${shown} props`,
    );
    expect(c.hazardsDrawn).toBe(c.hazards);
    expect(c.meshes).toBeGreaterThan(0);
    expect(c.meshes).toBeLessThanOrEqual(4);
    expect(c.triangles).toBeLessThan(30_000);
    layer.dispose();
  });
});
