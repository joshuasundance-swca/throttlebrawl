// The Pacific Northwest's places as solid structures (road/structures/pnw-places.ts; the maintainer, 2026-10-06:
// "consistent physics and gameplay is important here so players know what to expect and how to interact with the
// world"). The checks plan the real baked track: the layer asks for the planner and loads it lazily, the ferry's
// walls, posts and passenger deck stand where they are drawn (the deck over the road, 6.6 m up, riders ride under it),
// the Stump Social's shops front the sidewalk and leave its side streets open, the plan is the layout's and the same
// for the same seed. (The drawing's agreement with the plan is scripts/hitboxes.test.ts's; render's with main's,
// render/pnw-places.test.ts.)
import { describe, expect, it } from 'vitest';
import { FERRY_DIM, FERRY_ROOF, ferrySections } from '../ferry';
import { createRoadNetwork, type RoadNetwork } from '../network';
import {
  ensureStructures,
  footContains,
  requireStructures,
  STRUCTURE_LAYERS,
  structureLayersFor,
  structuresOf,
  type StructureSpec,
} from '../structures';
import type { BakedNetwork, BakedRoad } from '../types';
import { LAND_REACH_M, PNW_PLACES_LAYER, pnwPlacesLayout } from './pnw-places';

const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`${line}\n`);

const networkFiles = import.meta.glob<BakedNetwork>('../../../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
function network(id: string): RoadNetwork {
  const [path, n] = Object.entries(networkFiles).find(([, x]) => x.id === id) ?? [];
  if (!n || !path) throw new Error(`no network ${id}`);
  const pack = /packs\/([^/]+)\//.exec(path)?.[1] ?? '';
  const roads = Object.entries(roadFiles)
    .filter(([p, r]) => p.includes(`/packs/${pack}/`) && n.roads.includes(r.id))
    .map(([, r]) => r);
  return createRoadNetwork({ network: n, roads });
}

const road = network('pnw-c1');
const layout = pnwPlacesLayout(road, 7);
const allSpecs = (): StructureSpec[] => [
  ...layout.ferry.flatMap((f) => f.specs),
  ...layout.shops.flatMap((f) => f.specs),
  ...layout.streets.flatMap((f) => f.specs),
  ...layout.banners.flatMap((f) => f.specs),
];
const topOf = (s: StructureSpec) =>
  s.roof.kind === 'flat' ? s.baseY + s.roof.topM : s.baseY + s.roof.ridgeM;

describe('the places layer (road/structures/pnw-places.ts)', () => {
  it('is asked for by the ferry and the festival and no other network, and loads as a lazy chunk', async () => {
    expect(STRUCTURE_LAYERS[PNW_PLACES_LAYER]).toBeDefined();
    expect(structureLayersFor(road)).toContain(PNW_PLACES_LAYER);
    for (const id of ['osm-pnw-chuckanut', 'osm-pnw-gorge', 'osm-pnw-portland', 'osm-sf-russian-hill'])
      expect(structureLayersFor(network(id)), id).not.toContain(PNW_PLACES_LAYER);
    const fresh = network('pnw-c1'); // a fresh network: plans are kept per network
    const plan = await ensureStructures(fresh, 7);
    expect(plan.items.filter((s) => s.layer === PNW_PLACES_LAYER).length).toBe(allSpecs().length);
    expect(structuresOf(fresh, 7)).toBe(plan);
    expect(requireStructures(fresh, 7)).toBe(plan);
  });

  it('plans the same for the same seed, and another seed moves the shops (not the ferry)', () => {
    expect(pnwPlacesLayout(road, 7)).toBe(layout); // kept: worked out once
    const key = (l: typeof layout) =>
      l.shops.map((s) => `${s.edge}:${s.s.toFixed(3)}:${s.width}:${s.height}`).join(',');
    expect(key(pnwPlacesLayout(network('pnw-c1'), 7))).toBe(key(layout));
    expect(key(pnwPlacesLayout(road, 8))).not.toBe(key(layout));
    expect(pnwPlacesLayout(road, 8).ferry.map((f) => f.s)).toEqual(layout.ferry.map((f) => f.s));
    expect(pnwPlacesLayout(road, 8).streets.map((f) => f.s)).toEqual(layout.streets.map((f) => f.s));
  });

  it('stands the ferry as drawn: bulwarks at the car deck, posts up to a passenger deck 6.6 m over the road, a funnel and two wheelhouses', () => {
    const landing = road.edgeIndex('pnw-ferry-landing');
    const tag = road.edges[landing]?.tags.find((t) => t.tag === 'ferry');
    if (!tag) throw new Error('no ferry tag');
    const { n, cabin } = ferrySections(tag.s0, tag.s1);
    const hull = layout.ferry.filter((f) => f.kind === 'ferry-hull');
    expect(hull).toHaveLength(n);
    const decks = hull.filter((f) => f.cabin);
    expect(decks.length).toBe(Array.from({ length: n }, (_, i) => cabin(i)).filter(Boolean).length);
    expect(decks.length).toBeGreaterThan(3);
    for (const f of hull) {
      const surface = road.toWorld(landing, f.s, 0, 0).y;
      const by = (name: string) => f.specs.filter((s) => s.rule === `ferry-hull:${name}`);
      // A bulwark either side of the car deck, 2.6 m high, at d = +-(10 + 0.3) from the centre line.
      expect(by('bulwark')).toHaveLength(2);
      for (const b of by('bulwark')) {
        expect(b.baseY).toBeCloseTo(surface, 6);
        expect(topOf(b) - surface).toBeCloseTo(FERRY_DIM.bulwarkH, 6);
        const at = road.project(b.foot.x, b.foot.z, landing);
        expect(Math.abs(at.d)).toBeCloseTo(FERRY_DIM.wallD + FERRY_DIM.wallW / 2, 1);
      }
      if (!f.cabin) {
        expect(by('deck')).toHaveLength(0);
        continue;
      }
      // The passenger deck's underside stands 6.6 m over the car deck: a rider rides under it, lands on its roof.
      const [deck] = by('deck');
      const [cab] = by('cabin');
      const [roof] = by('roof');
      if (!deck || !cab || !roof) throw new Error('no deck, cabin or roof');
      expect(deck.baseY - surface).toBeCloseTo(FERRY_ROOF.heightM, 6);
      expect(cab.baseY - surface).toBeCloseTo(FERRY_ROOF.heightM + 0.4, 6);
      expect(topOf(roof) - surface).toBeCloseTo(FERRY_DIM.cabinTopY + 0.3, 6);
      // Four posts a section hold it up, from the bulwark's top to its underside.
      expect(by('post')).toHaveLength(4);
      for (const p of by('post')) {
        expect(p.baseY - surface).toBeCloseTo(FERRY_DIM.bulwarkH, 6);
        expect(topOf(p) - surface).toBeCloseTo(FERRY_DIM.ceilingY, 6);
      }
    }
    expect(layout.ferry.filter((f) => f.kind === 'ferry-funnel')).toHaveLength(1);
    expect(layout.ferry.filter((f) => f.kind === 'ferry-wheelhouse')).toHaveLength(2);
    const funnel = layout.ferry.find((f) => f.kind === 'ferry-funnel');
    const cap = funnel?.specs.find((s) => s.rule === 'ferry-funnel:cap');
    if (!funnel || !cap) throw new Error('no funnel');
    expect(topOf(cap) - road.toWorld(landing, funnel.s, 0, 0).y).toBeCloseTo(
      FERRY_DIM.cabinTopY + 0.3 + 5.8,
      6,
    );
    print(
      `[examined] the ferry: ${hull.length} hull sections (${decks.length} with the passenger deck), ${layout.ferry.length} parts, ${layout.ferry.reduce((n2, f) => n2 + f.specs.length, 0)} solids`,
    );
  });

  it('fronts the Stump Social with shops on the sidewalk, tents and a barricade down each side street, a banner at each end', () => {
    const row = road.edgeIndex('pnw-espresso-row');
    const shops = layout.shops.filter((s) => s.edge === row);
    const streets = layout.streets.filter((s) => s.edge === row);
    expect(shops.length).toBeGreaterThan(40);
    expect(streets.length).toBeGreaterThan(3);
    expect(layout.banners.filter((b) => b.edge === row)).toHaveLength(2);
    for (const sh of shops) {
      const [body, front] = sh.specs;
      if (!body || !front) throw new Error('no shop body or front');
      // The false front is its full height, 6.5 to 9.5 m, on the band's outer edge; the body is 0.8 of it.
      expect(sh.height).toBeGreaterThanOrEqual(6.5);
      expect(sh.height).toBeLessThanOrEqual(9.6);
      expect(topOf(front) - front.baseY).toBeCloseTo(sh.height, 6);
      expect(topOf(body) - body.baseY).toBeCloseTo(sh.height * 0.8, 6);
      const v = road.vergeAt(row, sh.s, sh.side < 0 ? 'left' : 'right');
      expect(Math.abs(sh.d)).toBeCloseTo(Math.abs(v.dOuter), 6);
    }
    // No tent stands in a shop, and a barricade is across each side street's mouth.
    const tents = streets.flatMap((s) => s.specs).filter((s) => s.rule === 'side-street:tent');
    expect(tents.length).toBeGreaterThan(3);
    for (const t of tents)
      for (const sh of shops) expect(footContains(sh.specs[0]!.foot, t.foot.x, t.foot.z)).toBe(false);
    for (const st of streets) {
      expect(st.specs.filter((s) => s.rule === 'side-street:barricade')).toHaveLength(1);
      expect(st.specs.filter((s) => s.rule === 'side-street:barricade-post')).toHaveLength(2);
      // A side street runs as far inland as the road scene's land strip allows (the plan's fixed reach).
      expect(st.run).toBeLessThanOrEqual(40);
      expect(st.run).toBeGreaterThanOrEqual(6);
    }
    expect(LAND_REACH_M).toBe(24);
    // The banner board stands 5.2 to 6.8 m over the road, with a post a side: a lintel over the street.
    for (const b of layout.banners) {
      const [board, ...posts] = b.specs;
      if (!board) throw new Error('no banner board');
      const surface = road.toWorld(b.edge, b.s, 0, 0).y;
      expect(board.baseY - surface).toBeCloseTo(5.2, 6);
      expect(topOf(board) - surface).toBeCloseTo(6.8, 6);
      expect(posts).toHaveLength(2);
    }
    print(
      `[examined] the Stump Social: ${shops.length} shops, ${streets.length} side streets (${tents.length} tents), ${layout.banners.length} banners on ${road.edges[row]?.id}`,
    );
  });

  it('stands no ground-level solid on the road, except the ferry that is the road', () => {
    const feetOn = (s: StructureSpec): boolean => {
      const f = s.foot;
      for (const [a, b] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ] as const) {
        const x = f.x + a * f.hu * f.ux - b * f.hv * f.uz;
        const z = f.z + a * f.hu * f.uz + b * f.hv * f.ux;
        const at = road.project(x, z, s.edge);
        const e = road.edges[at.edge];
        if (e && at.d > e.dMin - 0.5 && at.d < e.dMax + 0.5) return true;
      }
      return false;
    };
    const ground = allSpecs().filter((s) => {
      const surface = road.toWorld(s.edge, s.s, 0, 0).y;
      return s.baseY - surface < 2 && !s.rule.startsWith('ferry-');
    });
    const bad = ground.filter(feetOn).map((s) => `${s.rule} at ${road.edges[s.edge]?.id} ${s.s.toFixed(0)}`);
    print(
      `[examined] ${ground.length} ground-level solids (shops, tents, barricades, posts): ${bad.length} on a road's lanes`,
    );
    expect(bad.slice(0, 8)).toEqual([]);
    expect(ground.length).toBeGreaterThan(150);
    // Control: a shop planted on the lanes is found.
    const planted = {
      ...ground[0]!,
      foot: { x: road.toWorld(0, 30, 0, 0).x, z: road.toWorld(0, 30, 0, 0).z, ux: 1, uz: 0, hu: 2, hv: 2 },
      edge: 0,
    };
    expect(feetOn(planted)).toBe(true);
  });
});
