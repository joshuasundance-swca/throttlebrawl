/// <reference types="vite/client" />
// No invisible walls (the maintainer, 2026-10-06, [decided]: a road race in a physical world with honest edges;
// "consistent physics and gameplay is important here so players know what to expect and how to interact with the
// world"; the course has edges, crossing one is a quick reset, "never an invisible wall"). Every network a route
// races on, every band edge every STEP_M, both sides: what the sim does to a rider who rides out to it from the
// road (sim/riders `edgeHoldAt`, the barrier rule's own decision) must stand on something drawn, read from what
// render draws, not from the sim's own data:
// - a barrier: the road's band of it (a rail only on a bridge or a drop) or its look's panels
//   (render/road-mesh.ts `drawnBarrierSpans`);
// - a building front: a building of the structures plan just past the edge (render draws the plan); the fronts
//   render's scatter still draws (the row and painted houses: the plan's step 2c) are counted and listed by tag,
//   and no other tag may join them;
// - the ferns, a hedge, a fence: render's own kit along the edge (render/verge.ts `edgeKitPoints`), within a
//   panel's or a clump's spacing;
// - the interstate's guard rail: its look's panels; the car ferry's bulwark: a structure of the plan; the bluff's
//   parapet (render/shore-fixes.ts, drawn along every `bluff` side) and the water's edge by their tags;
// - a deck's bare edge over a drop.
// Guides (a split's guide span, a staging road, a bridge's taper) turn a rider along with no event and no speed
// lost: they are counted, not walls. In the air every edge is cleared above its drawn top (its barrier's height,
// the parapet's, the kit's: road/beyond.ts GROUND_EDGE_TOP_M, held here to the kit render builds), 0 where nothing
// stands, and at any height only at the scatter's fronts.
// Negative controls: the old rules (`riders.courseEdges` 0) hold riders at soft edges, so the same check must
// find those holds undrawn; and one hold planted where nothing is drawn is found, alone.
import { describe, expect, it } from 'vitest';
import {
  drawnEdgeAt,
  lanesNear,
  EDGE_TOP_BY_TAG,
  GROUND_EDGE_TOP_M,
  pastAt,
  structuresAt,
  vergeTagAt,
  type BakedNetwork,
  type BakedRoute,
  type RoadNetwork,
  type StructurePlan,
  type VergeSide,
} from '../../src/road';
import { BARRIER_LOOK_BY_TAG } from '../../src/render/barrier-looks';
import { EdgeLocator } from '../../src/render/overlap';
import { drawnBarrierSpans, networkTags } from '../../src/render/road-mesh';
import { LOOK_RAMP_CLEAR_M, VergeLayer } from '../../src/render/verge';
import { EDGE_LOOK_TAGS, RAMP_CLEAR_M } from '../../src/sim/riders/course';
import { edgeHoldAt } from '../../src/sim/riders';
import { plannedFrontAt, racePlanOf } from '../../src/sim/riders/structures';
import { gapSimConfig } from '../../src/sim/tumble/gap-fixture';
import type { SimConfig } from '../../src/sim/types';
import { createWorld, type World } from '../../src/sim/world';
import { look, print, routeNetworks, track, type RouteNetwork } from './geometry-routes';

const networkFiles = import.meta.glob<BakedNetwork>('/packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const routeFiles = import.meta.glob<BakedRoute>('/packs/*/regions/*/routes/*.json', {
  eager: true,
  import: 'default',
});

/** Each band edge every this many metres along each road. */
const STEP_M = 3;
/** The fronts render's scatter draws, not yet in the structures plan (its step 2c): walls at any height. */
const SCATTER_FRONTS: ReadonlySet<string> = new Set(['row-houses', 'painted-houses']);
/**
 * A kit piece stands within this of the band edge's point where it is drawn there, m (a fern clump every 3.5 m of
 * s, up to 0.6 m off its spot and 0.75 m out; a fence panel every 2 m; a hedge panel up to 2 m), and the more on the
 * outside of a bend, where a metre of s is more than a metre on the ground.
 */
const KIT_NEAR_M = 3;
/** A look's panel (2 m to 4 m long) within this of the point, m. */
const LOOK_NEAR_M = 4;
/** A building of the plan stands within this past the edge's line, m (Old Town's fronts stand 0.3 m back). */
const FRONT_NEAR_M = 1;

const packOf = (path: string) => /\/packs\/([^/]+)\//.exec(path)?.[1] ?? '';

/**
 * A listed barrier render leaves out where another road's lanes run under it (road-mesh.ts `clearOfOtherLanes`),
 * while the sim still holds a rider there (sim/riders/course.ts `roadPastLine` never opens a listed barrier): the
 * known places, by network and road. The two static-truck cuts' low walls (the yard road overlaps the avenue's
 * outer half metre by design, tools/road/tracks: render keeps the wall out of the yard road's lane, the sim keeps
 * the cut shut to the ground) and the rails where a bridge's road joins another (the riders' handover takes a
 * rider across onto the sibling there before the rail holds him). Render's to draw, or the track's to move; a new
 * place fails here so it is looked at.
 */
const LEFT_OUT = 'listed barrier left out over another road';
const KNOWN_LEFT_OUT: ReadonlySet<string> = new Set([
  'pnw-c1/pnw-sawmill-flats',
  'pnw-c1/c-pnw-mill-split',
  'pnw-c1/pnw-sawmill-yard',
  'sf-downtown/c-dt-plaza-split',
  'sf-downtown/sf-dt-campus-yard',
  'osm-keys-seven-mile/osm-sm-bridge',
  'osm-keys-seven-mile/osm-sm-bridge-east',
  'osm-keys-seven-mile/osm-sm-bridge-west',
  'osm-keys-seven-mile/osm-sm-old-west',
  'osm-keys-seven-mile/osm-sm-old-moser',
  'osm-keys-seven-mile/osm-keys-seven-mile-old-road-join',
  'osm-keys-seven-mile/osm-keys-seven-mile-old-road-leave',
  'osm-pnw-portland/osm-pnw-pdx-west-burnside',
  'osm-pnw-portland/osm-pnw-pdx-burnside-bridge',
  'osm-keys-bahia-honda/osm-spanish-harbor-bridge',
  'osm-keys-bahia-honda/osm-bahia-honda-bridge',
  'keys-m1/m1-pelican-bridge',
  'keys-m1/m1-long-bridge',
]);

/** The network's sim config: its first route, every tuning at its default (the course's edges on). */
function configOf(net: RouteNetwork, tuning: Readonly<Record<string, number>> = {}): SimConfig {
  const t = track(net);
  const network = Object.entries(networkFiles).find(
    ([p, n]) => n.id === net.id && packOf(p) === net.pack,
  )?.[1];
  const route = Object.entries(routeFiles).find(
    ([p, r]) => r.network === net.id && packOf(p) === net.pack,
  )?.[1];
  if (!network || !route) throw new Error(`no network or route ${net.pack}:${net.id}`);
  return gapSimConfig({ network, roads: t.roads }, { route, tuning });
}

/** World points on a grid, for "is one within r of here". */
class Points {
  private readonly cells = new Map<string, { x: number; z: number }[]>();
  constructor(
    points: readonly { x: number; z: number }[],
    private readonly cell = 8,
  ) {
    for (const p of points) {
      const k = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
      const list = this.cells.get(k);
      if (list) list.push(p);
      else this.cells.set(k, [p]);
    }
  }
  near(x: number, z: number, r: number): boolean {
    const i = Math.floor(x / this.cell);
    const j = Math.floor(z / this.cell);
    for (let a = i - 1; a <= i + 1; a++)
      for (let b = j - 1; b <= j + 1; b++)
        for (const p of this.cells.get(`${a},${b}`) ?? [])
          if ((p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) <= r * r) return true;
    return false;
  }
}

/** What render draws along one network's edges, read once. */
interface Drawn {
  fences: Points;
  ferns: Points;
  looks: Points;
  /** Barrier spans by edge and side (`${edge}:${side}`). */
  barriers: Map<string, { s0: number; s1: number }[]>;
  kitTops: { fence: number; fern: number; hedge: number };
}

function drawnOf(road: RoadNetwork, net: RouteNetwork): Drawn {
  const t = track(net);
  const verge = new VergeLayer(road, look, { tags: networkTags(road, t.dressing).tags });
  const kit = verge.edgeKitPoints();
  const barriers = new Map<string, { s0: number; s1: number }[]>();
  for (const e of road.edges)
    for (const side of ['left', 'right'] as const)
      barriers.set(`${e.index}:${side}`, drawnBarrierSpans(road, t.dressing, e.index, side));
  const drawn: Drawn = {
    fences: new Points(kit.fences),
    ferns: new Points([...kit.ferns, ...kit.hedges]),
    looks: new Points(
      (['railing', 'concrete', 'guardrail'] as const).flatMap((l) => [...verge.lookPanelPoints(l)]),
    ),
    barriers,
    kitTops: verge.edgeKitTops(),
  };
  verge.dispose();
  return drawn;
}

/** A structure of the plan stands just past the edge's line (within FRONT_NEAR_M). */
function buildingAt(
  road: RoadNetwork,
  plan: StructurePlan | null,
  edge: number,
  s: number,
  side: 1 | -1,
  line: number,
) {
  if (!plan) return false;
  for (let k = 0.05; k <= FRONT_NEAR_M + 1e-9; k += 0.05) {
    const p = road.toWorld(edge, s, line + side * k, 0);
    if (structuresAt(plan, p.x, p.z).length > 0) return true;
  }
  return false;
}

/**
 * What is drawn where the sim holds a rider at one side's band edge at (edge, s), or null for nothing: the
 * witness, from render's drawing and the plan.
 */
function witnessAt(
  road: RoadNetwork,
  plan: StructurePlan | null,
  drawn: Drawn,
  edge: number,
  s: number,
  side: 1 | -1,
): string | null {
  const vside: VergeSide = side > 0 ? 'right' : 'left';
  const v = road.vergeAt(edge, s, vside);
  const p = road.toWorld(edge, s, v.dOuter, 0);
  const what = drawnEdgeAt(road, edge, s, vside);
  const e = road.edges[edge];
  if (what === 'barrier' || what === 'rail') {
    const spans = drawn.barriers.get(`${edge}:${vside}`) ?? [];
    if (spans.some((b) => s >= b.s0 - 1e-6 && s <= b.s1 + 1e-6)) {
      // Render stops a barrier's band where another road's lanes run under it (road-mesh.ts
      // `clearOfOtherLanes`: its line, 5 cm past the lanes, 0.3 m clear); the sim still holds a rider at a
      // listed barrier there (sim/riders/course.ts `roadPastLine`). Counted apart: render's to draw.
      const e2 = road.edges[edge];
      const lane = road.toWorld(edge, s, (side > 0 ? (e2?.dMax ?? 0) : (e2?.dMin ?? 0)) + side * 0.05, 0);
      return lanesNear(road, lane.x, lane.z, edge, 0.3) ? LEFT_OUT : 'barrier drawn';
    }
    return drawn.looks.near(p.x, p.z, LOOK_NEAR_M) ? 'barrier look drawn' : null;
  }
  if (what === 'front') {
    const tag = e ? vergeTagAt(e, vside, s) : null;
    if (plannedFrontAt(road, edge, s, vside))
      return buildingAt(road, plan, edge, s, side, v.dOuter) ? 'building' : null;
    return tag !== null && SCATTER_FRONTS.has(tag) ? `scatter front (${tag})` : null;
  }
  // The kit stands every so many metres of s: on the outside of a bend, further apart on the ground.
  const spread = Math.max(1, Math.abs(1 - road.kappaAt(edge, s) * v.dOuter));
  if (what === 'brush') return drawn.ferns.near(p.x, p.z, KIT_NEAR_M * spread) ? 'ferns' : null;
  if (what === 'fence') return drawn.fences.near(p.x, p.z, KIT_NEAR_M * spread) ? 'fence' : null;
  if (what === 'wall') {
    const tag = e ? vergeTagAt(e, vside, s) : null;
    if (tag === 'interstate') return drawn.looks.near(p.x, p.z, LOOK_NEAR_M) ? 'guard rail' : null;
    if (tag === 'ferry') return buildingAt(road, plan, edge, s, side, v.dOuter) ? 'bulwark' : null;
    return tag === 'bluff' ? 'parapet' : null;
  }
  if (what === 'water') return pastAt(road, edge, s, vside) === 'water' ? 'water' : null;
  if (what === 'drop') return pastAt(road, edge, s, vside) === 'drop' ? 'drop' : null;
  return null;
}

interface Sweep {
  sides: number;
  /** Holds by witness. */
  held: Map<string, number>;
  guides: Map<string, number>;
  open: number;
  /** Holds with nothing drawn: `net edge s side (kind)`. */
  undrawn: string[];
  /** Air tops that are no drawn top: `net edge s side top`. */
  wrongTops: string[];
  /** Roads (`net/road`) with a listed barrier render leaves out over another road's lanes. */
  leftOut: Set<string>;
}

/** One network's sweep with `hold` (the sim's own, or a planted one). */
function sweep(
  net: RouteNetwork,
  config: SimConfig,
  drawn: Drawn,
  out: Sweep,
  hold: (world: World, edge: number, s: number, side: 1 | -1) => ReturnType<typeof edgeHoldAt> = (
    w,
    e,
    s,
    side,
  ) => edgeHoldAt(w, config, e, s, side),
): void {
  const road = config.road;
  const world = createWorld(config);
  const plan = racePlanOf(world, config);
  for (const e of road.edges) {
    for (let s = 0; s <= e.length; s += STEP_M) {
      for (const side of [1, -1] as const) {
        out.sides++;
        const vside: VergeSide = side > 0 ? 'right' : 'left';
        const h = hold(world, e.index, s, side);
        const where = `${net.id} ${e.id} s ${s} ${vside}`;
        if (h.hold === 'guide' || h.hold === 'taper') {
          out.guides.set(h.hold, (out.guides.get(h.hold) ?? 0) + 1);
          continue;
        }
        if (h.hold === 'open') {
          out.open++;
          if (h.airTop !== 0) out.wrongTops.push(`${where} open but air top ${h.airTop}`);
          continue;
        }
        const w = witnessAt(road, plan, drawn, e.index, s, side);
        if (w === null) {
          out.undrawn.push(`${where} (${h.kind}, ${drawnEdgeAt(road, e.index, s, vside) ?? 'nothing'})`);
          continue;
        }
        out.held.set(w, (out.held.get(w) ?? 0) + 1);
        if (w === LEFT_OUT) out.leftOut.add(`${net.id}/${e.id}`);
        // In the air: cleared above the drawn top, never held at any height but by the scatter's fronts.
        const top = h.airTop;
        const tag = vergeTagAt(e, vside, s);
        const barrier = road.barrierAt(e.index, s, vside);
        const want =
          w === 'water' || w === 'drop'
            ? [0, 1]
            : barrier !== null
              ? [barrier.heightM]
              : w.startsWith('scatter front')
                ? [Infinity]
                : w === 'building'
                  ? [0, Infinity]
                  : w === 'ferns' || w === 'fence'
                    ? [GROUND_EDGE_TOP_M[h.kind === 'fence' ? 'fence' : 'brush']]
                    : w === 'water' || w === 'drop'
                      ? [0, 1]
                      : tag !== null && Object.hasOwn(EDGE_TOP_BY_TAG, tag)
                        ? [EDGE_TOP_BY_TAG[tag] ?? NaN]
                        : [];
        if (top === null || !want.includes(top))
          out.wrongTops.push(`${where} ${w}: air top ${top}, want ${want.join('|')}`);
      }
    }
  }
}

const newSweep = (): Sweep => ({
  sides: 0,
  held: new Map(),
  guides: new Map(),
  open: 0,
  undrawn: [],
  wrongTops: [],
  leftOut: new Set(),
});
const fmt = (m: Map<string, number>) =>
  [...m]
    .sort()
    .map(([k, n]) => `${k} x${n}`)
    .join(', ');

describe('no invisible walls: every edge that holds a rider stands on something drawn', () => {
  const nets = routeNetworks();
  const cache = new Map<string, { config: SimConfig; drawn: Drawn }>();
  const of = (net: RouteNetwork) => {
    const key = `${net.pack}:${net.id}`;
    let c = cache.get(key);
    if (!c) {
      const config = configOf(net);
      c = { config, drawn: drawnOf(config.road, net) };
      cache.set(key, c);
    }
    return c;
  };

  it('on every route network, on the ground and in the air', () => {
    const all = newSweep();
    for (const net of nets) {
      const { config, drawn } = of(net);
      const one = newSweep();
      sweep(net, config, drawn, one);
      print(
        `[no-invisible-walls] ${net.id}: ${one.sides} sides; held by ${fmt(one.held)}; guides ${fmt(one.guides)}; open ${one.open}; undrawn ${one.undrawn.length}; wrong air tops ${one.wrongTops.length}`,
      );
      all.sides += one.sides;
      all.open += one.open;
      for (const [k, n] of one.held) all.held.set(k, (all.held.get(k) ?? 0) + n);
      for (const [k, n] of one.guides) all.guides.set(k, (all.guides.get(k) ?? 0) + n);
      all.undrawn.push(...one.undrawn);
      all.wrongTops.push(...one.wrongTops);
      for (const r of one.leftOut) all.leftOut.add(r);
    }
    print(
      `[no-invisible-walls] ${nets.length} networks, ${all.sides} sides every ${STEP_M} m: held by ${fmt(all.held)}; guides ${fmt(all.guides)}; open ${all.open}; undrawn ${all.undrawn.length}; wrong air tops ${all.wrongTops.length}`,
    );
    if (all.undrawn.length > 0) {
      const groups = new Map<string, number[]>();
      for (const u of all.undrawn) {
        const m = /^(\S+) (\S+) s (\S+) (\S+) \((.*)\)$/.exec(u);
        const key = m ? `${m[1]} ${m[2]} ${m[4]} (${m[5]})` : u;
        const list = groups.get(key) ?? [];
        list.push(Number(m?.[3] ?? NaN));
        groups.set(key, list);
      }
      print(
        `[no-invisible-walls] undrawn, by road and side: ${[...groups].map(([k, ss]) => `${k} x${ss.length} s ${Math.min(...ss)}..${Math.max(...ss)}`).join('; ')}`,
      );
    }
    if (all.wrongTops.length > 0)
      print(`[no-invisible-walls] wrong air tops, first 20: ${all.wrongTops.slice(0, 20).join('; ')}`);
    // The check sees what it looks for: thousands of held sides of every witness kind, and open ones.
    expect(all.sides).toBeGreaterThan(50_000);
    expect(all.open).toBeGreaterThan(1000);
    for (const w of ['barrier drawn', 'building', 'ferns', 'fence', 'water', 'parapet', 'guard rail'])
      expect(all.held.get(w) ?? 0, w).toBeGreaterThan(0);
    expect(all.undrawn.slice(0, 40)).toEqual([]);
    print(
      `[no-invisible-walls] listed barriers left out over another road: ${[...all.leftOut].sort().join(', ')}`,
    );
    expect([...all.leftOut].filter((r) => !KNOWN_LEFT_OUT.has(r))).toEqual([]);
    expect(all.wrongTops.slice(0, 20)).toEqual([]);
  }, 600_000);

  it("the sim clears each edge kit above render's tallest", () => {
    let fence = 0;
    let fern = 0;
    let hedge = 0;
    for (const net of nets) {
      const t = of(net).drawn.kitTops;
      fence = Math.max(fence, t.fence);
      fern = Math.max(fern, t.fern);
      hedge = Math.max(hedge, t.hedge);
    }
    print(
      `[no-invisible-walls] tallest drawn: fence ${fence.toFixed(3)} m, fern ${fern.toFixed(3)} m, hedge ${hedge.toFixed(3)} m`,
    );
    // Each kind is built somewhere, and the sim's top is no lower than the tallest drawn, and close to it.
    expect(Math.min(fence, fern, hedge)).toBeGreaterThan(0.5);
    expect(GROUND_EDGE_TOP_M.fence).toBeGreaterThanOrEqual(fence);
    expect(GROUND_EDGE_TOP_M.fence - fence).toBeLessThan(0.1);
    expect(GROUND_EDGE_TOP_M.brush).toBeGreaterThanOrEqual(Math.max(fern, hedge));
    expect(GROUND_EDGE_TOP_M.brush - Math.max(fern, hedge)).toBeLessThan(0.1);
    expect(GROUND_EDGE_TOP_M.soft).toBe(0);
  }, 600_000);

  it("the sim opens an edge by render's own rules for its kit: other roads' lanes, a ramp's line", () => {
    // The tags whose hard edge render draws as a look, and how far that look keeps off a ramp.
    const looked = Object.keys(BARRIER_LOOK_BY_TAG).filter((t) => BARRIER_LOOK_BY_TAG[t]?.edge !== undefined);
    expect([...EDGE_LOOK_TAGS].sort()).toEqual(looked.sort());
    expect(RAMP_CLEAR_M).toBe(LOOK_RAMP_CLEAR_M);
    // road/course.ts `lanesNear` is render/overlap.ts `EdgeLocator.onLanes`: the same answer at every band edge
    // point (and a metre and two past it) of every route network, at each margin the kit uses.
    let asked = 0;
    let on = 0;
    for (const net of nets) {
      const road = of(net).config.road;
      const locator = new EdgeLocator(road);
      for (const e of road.edges)
        for (let s = 0; s <= e.length; s += 6)
          for (const side of [1, -1] as const)
            for (const past of [0, 1, 2]) {
              const v = road.vergeAt(e.index, s, side > 0 ? 'right' : 'left');
              const p = road.toWorld(e.index, s, v.dOuter + side * past, 0);
              for (const margin of [0, 0.2, 0.3, 1.22]) {
                const a = lanesNear(road, p.x, p.z, e.index, margin);
                expect(a, `${net.id} ${e.id} s ${s} ${side} +${past} m ${margin}`).toBe(
                  locator.onLanes(p.x, p.z, e.index, margin),
                );
                asked++;
                if (a) on++;
              }
            }
    }
    print(
      `[no-invisible-walls] lanesNear against EdgeLocator.onLanes: ${asked} points and margins agree, ${on} on another road's lanes`,
    );
    expect(on).toBeGreaterThan(100);
    expect(on).toBeLessThan(asked);
  }, 600_000);

  it('negative control: the old rules hold riders at soft edges, and the check finds them undrawn', () => {
    // Two networks with soft edges (the Keys' sand and kerbs, the Mission's shopfront gaps).
    const picked = nets.filter((n) => n.id === 'keys-m1' || n.id === 'osm-keys-duval');
    expect(picked).toHaveLength(2);
    const old = newSweep();
    for (const net of picked) {
      const config = configOf(net, { 'riders.courseEdges': 0 });
      sweep(net, config, of(net).drawn, old);
    }
    print(
      `[no-invisible-walls] the old rules on ${picked.map((n) => n.id).join(', ')}: undrawn ${old.undrawn.length}, first ${old.undrawn.slice(0, 3).join('; ')}`,
    );
    expect(old.undrawn.length).toBeGreaterThan(1000);
  }, 600_000);

  it('negative control: one hold planted where nothing is drawn is found, and only it', () => {
    const net = nets.find((n) => n.id === 'keys-m1');
    if (!net) throw new Error('no keys-m1');
    const { config, drawn } = of(net);
    // The first open side of the network: plant a wall there.
    const world = createWorld(config);
    let planted: { edge: number; s: number; side: 1 | -1 } | null = null;
    for (const e of config.road.edges) {
      for (let s = 0; s <= e.length && !planted; s += STEP_M)
        if (edgeHoldAt(world, config, e.index, s, 1).hold === 'open') planted = { edge: e.index, s, side: 1 };
      if (planted) break;
    }
    if (!planted) throw new Error('no open side');
    const p = planted;
    const one = newSweep();
    sweep(net, config, drawn, one, (w, edge, s, side) => {
      const h = edgeHoldAt(w, config, edge, s, side);
      return edge === p.edge && s === p.s && side === p.side ? { ...h, hold: 'held' } : h;
    });
    print(
      `[no-invisible-walls] planted at ${config.road.edges[p.edge]?.id} s ${p.s} right: found ${one.undrawn.join('; ')}`,
    );
    expect(one.undrawn).toHaveLength(1);
    expect(one.undrawn[0]).toContain(`${config.road.edges[p.edge]?.id} s ${p.s} right`);
  }, 600_000);
});
