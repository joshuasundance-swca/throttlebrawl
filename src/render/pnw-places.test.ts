// The Pacific Northwest's places as drawn (run W-U, the pitch deck's #12), on the real baked track:
// every solid hazard a rider can hit is drawn at its own box and about its own size, the ferry's hull
// covers its stretch from the water up and its passenger deck clears the chase camera, nothing the
// clear-cut scatters stands on the ridable dirt, and the Stump Social lines both sidewalks with shops,
// leaving the side streets open behind their barricades. The layer merges into a few draw calls.
import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  loadPnwPlacesLayout,
  type BakedFeature,
  type BakedNetwork,
  type BakedRoad,
} from '../road';
import golden from './golden/pnw-places-before-the-port.json';
import { createFlatLook } from './look';
import {
  FERRY_DIM,
  hasPnwPlaces,
  placeItems,
  PnwPlacesLayer,
  PLACES_BLOCK_M,
  spotAt,
  type Item,
} from './pnw-places';
import { buildRoadScene, type RoadDressing } from './road-mesh';

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
// Where the ferry and the Stump Social stand is road/structures/pnw-places.ts's plan, a lazy chunk of its own.
const { pnwPlacesLayout } = await loadPnwPlacesLayout();
const layout = pnwPlacesLayout(road, 7);
const items = placeItems(road, 7, layout, () => 24);
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
    const layer = new PnwPlacesLayer(createFlatLook(), { road, seed: 7, layout, landReach: () => 24 });
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

describe('the places after the port (the physical world, 2026-10-06): placed by the road, drawn as before', () => {
  // `golden` is what origin/main (00d41c9f) drew on pnw-c1 at seed 7 (landReach 24, the default): each row is
  // [kind, edge, s, d, x, y, z, turn, then its geometry's bounding box min xyz, max xyz], rounded to a millimetre,
  // for every prop but the clear-cut's dressing (stumps, slash, snags, earth and seedlings, which stand where
  // they did: render's, past the ridable dirt).
  const POSITION_TOL_M = 0.01;
  const TURN_TOL = 0.001;
  const BOX_TOL_M = 0.01;
  const SCENERY = ['cut-stump', 'slash', 'snag', 'earth', 'seedlings'];
  type Row = readonly [string, number, number, number, number, number, number, number, ...number[]];
  const rowsOf = (list: readonly Item[]): Row[] =>
    list
      .filter((i) => !SCENERY.includes(i.kind))
      .map((it) => {
        it.geometry.computeBoundingBox();
        const b = it.geometry.boundingBox ?? new Box3();
        const spot = spotAt(road, it);
        return [
          it.kind,
          it.edge,
          it.s,
          it.d,
          spot.p.x,
          spot.p.y,
          spot.p.z,
          spot.turn,
          b.min.x,
          b.min.y,
          b.min.z,
          b.max.x,
          b.max.y,
          b.max.z,
        ];
      });
  const tolOf = (k: number) => (k === 7 ? TURN_TOL : k <= 6 ? POSITION_TOL_M : BOX_TOL_M);
  /** The worst gap between two lists of rows as a share of its tolerance (1 is the line), and where. */
  function compare(now: readonly Row[], was: readonly Row[]): { worst: number; why: string } {
    if (now.length !== was.length) return { worst: Infinity, why: `${now.length} rows, was ${was.length}` };
    const key = (r: Row) => `${r[0]}:${r[1]}:${r[2].toFixed(2)}:${r[3].toFixed(2)}:${r[4].toFixed(1)}`;
    const byKey = (rows: readonly Row[]) =>
      [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    const a = byKey(now);
    const b = byKey(was);
    let worst = 0;
    let why = '';
    for (let i = 0; i < a.length; i++) {
      const x = a[i]!;
      const y = b[i]!;
      if (x[0] !== y[0] || x[1] !== y[1]) return { worst: Infinity, why: `row ${i}: ${x[0]} vs ${y[0]}` };
      for (let k = 2; k < x.length; k++) {
        const ratio = Math.abs((x[k] as number) - (y[k] as number)) / tolOf(k);
        if (ratio > worst) {
          worst = ratio;
          why = `${key(x)} field ${k}`;
        }
      }
    }
    return { worst, why };
  }
  const parse = (s: string): Row => {
    const [kind = '', ...numbers] = s.split(',');
    return [kind, ...numbers.map(Number)] as unknown as Row;
  };
  const wasFile = golden.seed7;
  const was = { rows: wasFile.rows.map(parse), total: wasFile.total };

  it('draws every ferry part, shop, side street, bunting and banner where main drew it, and as big', () => {
    const now = rowsOf(items);
    const { worst, why } = compare(now, was.rows);
    const kinds = new Set(now.map((r) => r[0]));
    console.log(
      `[examined] ${now.length} props (${[...kinds].sort().join(', ')}) on pnw-c1 against main's drawing: position, geometry bounds within a centimetre, turn within a milliradian`,
    );
    expect(worst, why).toBeLessThanOrEqual(1);
    for (const k of [
      'ferry-hull',
      'ferry-end',
      'ferry-funnel',
      'ferry-wheelhouse',
      'shop',
      'side-street',
      'banner',
    ])
      expect(kinds.has(k), k).toBe(true);
    expect(items.length).toBe(was.total);
  });

  it('control: a shop moved a metre, or a hull section a metre taller, is found', () => {
    const now = rowsOf(items);
    const at = now.findIndex((r) => r[0] === 'shop');
    const moved = now.map((r, i): Row =>
      i === at ? ([...r.slice(0, 4), r[4] + 1, ...r.slice(5)] as unknown as Row) : r,
    );
    expect(compare(moved, was.rows).worst).toBeGreaterThan(1);
    const hull = now.findIndex((r) => r[0] === 'ferry-hull');
    const tall = now.map((r, i): Row =>
      i === hull ? ([...r.slice(0, 12), r[12]! + 1, r[13]!] as unknown as Row) : r,
    );
    expect(compare(tall, was.rows).worst).toBeGreaterThan(1);
  });

  it("the side streets run as far inland as the drawn land: the plan's fixed 24 m is the road scene's, at both seeds", () => {
    // The plan may not read the drawn land (render's `landReach`), so a side street's reach is the road scene's land
    // strip, 24 m. The scene draws exactly that at every gap of the track (the same props with either).
    const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
    for (const seed of [7, 8]) {
      const scene = buildRoadScene(road, createFlatLook(), dressing, { seed });
      const l = pnwPlacesLayout(road, seed);
      const fixed = rowsOf(placeItems(road, seed, l, () => 24));
      const drawn = rowsOf(placeItems(road, seed, l, (e, side, s) => scene.landReach(e, side, s)));
      scene.dispose();
      expect(compare(drawn, fixed).worst, `seed ${seed}`).toBeLessThanOrEqual(1);
      expect(fixed.filter((r) => r[0] === 'side-street').length).toBeGreaterThan(6);
    }
  });

  it("reads the road files' own tags and features: render's `dressing` was the network's, field for field", () => {
    let edges = 0;
    for (const e of road.edges) {
      const baked = roads.find((r) => r.id === e.id);
      if (!baked) throw new Error(`no road file for ${e.id}`);
      expect(baked.tags ?? [], e.id).toEqual(e.tags);
      // The network sorts an edge's features by s0; the plan only asks whether one lies somewhere, never in what order.
      const byId = (list: readonly { id: string }[]) => [...list].sort((a, b) => (a.id < b.id ? -1 : 1));
      expect(byId(baked.features ?? []), e.id).toEqual(byId(e.features));
      edges++;
    }
    console.log(`[examined] ${edges} pnw-c1 edges: the road files' tags and features equal the network's`);
    expect(edges).toBeGreaterThan(3);
  });
});
