/// <reference types="vite/client" />
// What lies past an edge is what is drawn there (the maintainer, 2026-10-06, [decided]: "consistent physics and
// gameplay is important here so players know what to expect and how to interact with the world"; a road race in a
// physical world with honest edges: what is drawn is what is met, nothing is a ghost). The one live check of
// 2026-10-07 found the sim dropping a high fall 70 m to the sea past Chuckanut's parapet (seed 1, tick 7410, a
// crossing at s 403 of the cliffs road, `dropM` 70.22) while the scene draws the bluff's grassy shelf there, at the
// road's height: the bodies sank into the grass and were never seen again.
//
// This holds the sim's floor out past an edge to the drawn scene, on every network a route races on. Along every
// edge a rider can fly over (each barrier, rail and wall, the bluff's parapet, the water's edge, the ferns, a fence,
// a bare edge; not a building front), every few metres and at several distances past it, a rider just above the
// deck is put through the sim's own over-the-barrier rule (sim/riders/gap.ts `overStep`, the course's honest edges
// on: the game's default), and what it says lies under him (ground, water or a drop, and its height) is compared
// with the highest surface the road scene draws straight below (built as the race builds it, with the network's own
// lake water):
// - a ghost drop: the sim's floor lies under drawn ground that would hold a bike (about level under a bike's whole
//   width): he would fall through it, as at Chuckanut;
// - a ghost floor: the sim's ground lies over what is drawn there (the sea, a valley, a cliff's face): he would come
//   down on nothing;
// - a floor off: the sim's water lies at another height than the water drawn there.
// Where another road the sim hands him onto lies under the point, it is met; those points are counted and left out.
// The negative controls run the same check on two wrong rules: the tags alone (the old rule: a drop at once past
// every bluff and bridge tag) is caught at Chuckanut, and "ground at the deck everywhere" over the Golden Gate's and
// Seven Mile's water.
import { describe, expect, it } from 'vitest';
import type { BackdropNetworkFile } from '../../src/render/backdrop/data';
import { waterAtOf, waterFloors } from '../../src/render/backdrop/water';
import { buildRoadScene } from '../../src/render/road-mesh';
import {
  courseEdgeTopAt,
  edgeTopAt,
  pastAt,
  waterLevelOf,
  type BakedNetwork,
  type BakedRoute,
  type Past,
  type RoadNetwork,
} from '../../src/road';
import { BIKE_HALF_WIDTH_M } from '../../src/sim/riders';
import { overStep } from '../../src/sim/riders/gap';
import { gapSimConfig } from '../../src/sim/tumble/gap-fixture';
import type { SimConfig } from '../../src/sim/types';
import { DownIndex, look, print, routeNetworks, SURFACES, track, type RouteNetwork } from './geometry-routes';

const networkFiles = import.meta.glob<BakedNetwork>('/packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const backdropFiles = import.meta.glob<BackdropNetworkFile>('/packs/*/assets/backdrop/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const packOf = (path: string) => /\/packs\/([^/]+)\//.exec(path)?.[1] ?? '';

/** Along each road, a side is looked at this often, m. */
const STEP_M = 4;
/** How far past the band's outer edge the rider is put, m: just past it, across the bluff's shelf, and beyond. */
const ACROSS_M = [0.5, 2, 4, 6, 6.5, 7.5, 9, 12] as const;
/** A bike's width, m: drawn ground holds a bike where it is about level under all of it ([decided], 2026-10-06). */
const BIKE_M = 2 * BIKE_HALF_WIDTH_M;
/** About level: the drawn face's normal points up at least this much (a slope under 25 degrees). */
const LEVEL_UP = 0.9;
/** The sim's floor and the drawn surface agree within this, m. */
const FLOOR_TOL_M = 1;

/** What the sim says lies under a rider out past an edge, or that another road takes him ('road'). */
type SimSays = { past: Past; floorY: number } | 'road' | 'held';
/** A rule under test: what lies under a rider `acrossM` past one side's band edge at (edge, s). */
type Rule = (edge: number, s: number, side: 'left' | 'right', acrossM: number) => SimSays;

interface Drawn {
  /** The highest drawn surface under the point (null: nothing), whether it is water, and how level it is. */
  y: number | null;
  water: boolean;
  up: number;
  name: string;
}

interface Net {
  net: RouteNetwork;
  road: RoadNetwork;
  config: SimConfig;
  drawnAt: (x: number, z: number, top: number) => Drawn;
}

const nets = new Map<string, Net>();
function netOf(id: string): Net {
  const net = routeNetworks().find((n) => n.id === id);
  if (!net) throw new Error(`no route network ${id}`);
  const key = `${net.pack}:${net.id}`;
  const known = nets.get(key);
  if (known) return known;
  const t = track(net);
  const network = Object.entries(networkFiles).find(
    ([p, n]) => n.id === net.id && packOf(p) === net.pack,
  )?.[1];
  if (!network) throw new Error(`no network ${key}`);
  // Every road some route on the network allows: the sim hands a rider onto any of them under him.
  const route: BakedRoute = {
    id: 'beyond',
    network: net.id,
    start: { road: t.roads[0]?.id ?? '', s: 20, dir: 1 },
    finish: { road: t.roads[0]?.id ?? '', s: 40 },
    mainPath: [t.roads[0]?.id ?? ''],
    allowedRoads: [...net.allowed],
    closed: false,
  };
  // Every tuning at its default: the ground beside the road on, the course's honest edges on.
  const config = gapSimConfig({ network, roads: t.roads }, { route, tuning: { 'ground.offRoad': 1 } });
  // The network's own water above the sea (Lake Samish), as the race builds the road with it.
  const backdrop = Object.entries(backdropFiles).find(
    ([p]) => packOf(p) === net.pack && p.endsWith(`/networks/${net.id}.json`),
  )?.[1];
  const floors = backdrop ? waterFloors(backdrop) : [];
  const waterAt = floors.length ? waterAtOf(floors) : undefined;
  const scene = buildRoadScene(t.road, look, t.dressing, { seed: 1, ...(waterAt ? { waterAt } : {}) });
  const index = new DownIndex(scene.group, SURFACES);
  scene.dispose();
  const drawnAt = (x: number, z: number, top: number): Drawn => {
    const hit = index.at(x, z, top);
    const lake = waterAt?.(x, z) ?? null;
    if (lake !== null && (hit === null || lake >= hit.y))
      return { y: lake, water: true, up: 1, name: 'lake' };
    if (!hit) return { y: null, water: false, up: 0, name: 'nothing' };
    return { y: hit.y, water: hit.name.startsWith('road-water'), up: hit.up, name: hit.name };
  };
  const out = { net, road: t.road, config, drawnAt };
  nets.set(key, out);
  return out;
}

/** The sim's own rule: a rider crossing the edge above what stands there, then `acrossM` past it, just above the deck. */
function simRule(n: Net): Rule {
  const road = n.road;
  const hw = BIKE_HALF_WIDTH_M;
  const limits = (edge: number, s: number) => {
    const lo = road.vergeAt(edge, s, 'left');
    const hi = road.vergeAt(edge, s, 'right');
    return {
      lo: lo.dOuter + hw,
      hi: hi.dOuter - hw,
      loEdge: lo.edge,
      hiEdge: hi.edge,
      loBandM: 0,
      hiBandM: 0,
    };
  };
  const edgeTop = (edge: number, s: number, side: 'left' | 'right') => courseEdgeTopAt(road, edge, s, side);
  return (edge, s, side, acrossM) => {
    const sign = side === 'right' ? 1 : -1;
    const v = road.vergeAt(edge, s, side);
    const deckY = road.surfaceHeight(edge, s, v.dOuter);
    const y = deckY + edgeTop(edge, s, side) + 0.5;
    // The crossing: the rider's centre just past its limit, above what stands at the edge.
    const at0 = { edge, s, d: v.dOuter - sign * hw + sign * 0.01, dir: 1 as const };
    const mark = overStep(n.config, at0, y, null, limits, hw, edgeTop, true).mark;
    if (!mark) return 'held';
    const at = { edge, s, d: v.dOuter + sign * acrossM, dir: 1 as const };
    const step = overStep(n.config, at, deckY + 0.3, mark, limits, hw, edgeTop, true);
    if (step.hand) return 'road';
    if (!step.mark || step.result !== 'past') return 'held';
    return { past: step.mark.past, floorY: step.mark.floorY };
  };
}

/** The old rule, the first control: what the road's tags say, decided at the crossing (ground at the deck's height). */
function tagsRule(n: Net): Rule {
  const sim = simRule(n);
  return (edge, s, side, acrossM) => {
    const says = sim(edge, s, side, acrossM);
    if (says === 'road' || says === 'held') return says;
    const road = n.road;
    const past = pastAt(road, edge, s, side);
    const deckY = road.surfaceHeight(edge, s, road.vergeAt(edge, s, side).dOuter);
    return { past, floorY: past === 'ground' ? deckY : waterLevelOf(road) };
  };
}

/** The second control: ground at the deck's height everywhere past the edge. */
function groundRule(n: Net): Rule {
  return (edge, s, side) => {
    const road = n.road;
    return { past: 'ground', floorY: road.surfaceHeight(edge, s, road.vergeAt(edge, s, side).dOuter) };
  };
}

interface Finding {
  ghostDrop: string[];
  ghostFloor: string[];
  floorOff: string[];
  /** Points looked at, by what the sim said (and those another road takes, or where nothing at all is drawn). */
  counts: Record<string, number>;
}

/** Runs the check on one network with a rule, on every edge (or those `only` keeps), from s0 to s1 where given. */
function check(
  n: Net,
  rule: Rule,
  only?: { edge: number; s0: number; s1: number; side?: 'left' | 'right' },
): Finding {
  const road = n.road;
  const f: Finding = { ghostDrop: [], ghostFloor: [], floorOff: [], counts: {} };
  const count = (k: string) => (f.counts[k] = (f.counts[k] ?? 0) + 1);
  for (const e of road.edges) {
    if (only && only.edge !== e.index) continue;
    // Between render's rows (every 2 m from 0), never on one: a point on a row lies on the seam between two quads.
    const s0 = only ? only.s0 : STEP_M / 2 + 1;
    const s1 = only ? only.s1 : e.length - 1;
    for (let s = s0; s <= s1; s += only ? 1 : STEP_M) {
      for (const side of ['left', 'right'] as const) {
        if (only?.side && only.side !== side) continue;
        const v = road.vergeAt(e.index, s, side);
        if (v.taper === true) continue;
        // A building front stays a wall to anything that does not know its buildings: nothing to fly over.
        if (!Number.isFinite(courseEdgeTopAt(road, e.index, s, side))) continue;
        // What stands at the edge to fly over (a barrier, a rail, a wall, the bluff's parapet), or the water's edge.
        const stands = v.edge === 'water' || (edgeTopAt(road, e.index, s, side) ?? 0) > 0;
        const tag = stands ? '[stands]' : '[ground-edge]';
        const sign = side === 'right' ? 1 : -1;
        const deckY = road.surfaceHeight(e.index, s, v.dOuter);
        const look = (across: number) => {
          const p = road.toWorld(e.index, s, v.dOuter + sign * across, 0);
          return n.drawnAt(p.x, p.z, Math.max(p.y, deckY) + 3);
        };
        /** The drawn surface's height there (-Infinity where nothing is drawn). */
        const yAt = (across: number) => look(across).y ?? -Infinity;
        for (const k of ACROSS_M) {
          const says = rule(e.index, s, side, k);
          if (says === 'road' || says === 'held') {
            count(says);
            continue;
          }
          count(says.past);
          const drawn = look(k);
          // A bike's width across the point (a top big enough to hold a bike, [decided]): drawn ground holds one
          // where it is about level and at one height under all of it; a hole lets one through only as wide.
          const across = [k - BIKE_M / 2, k + BIKE_M / 2].map(look);
          const holds =
            drawn.y !== null &&
            [drawn, ...across].every(
              (x) =>
                x.y !== null && !x.water && x.up >= LEVEL_UP && Math.abs(x.y - (drawn.y ?? 0)) <= BIKE_M / 2,
            );
          const hole = [k, k - BIKE_M / 2, k + BIKE_M / 2].every((x) => says.floorY > yAt(x) + FLOOR_TOL_M);
          if (drawn.y === null) {
            if (says.past === 'ground' && hole)
              f.ghostFloor.push(
                `${tag} ${n.net.id} ${e.id} s ${s} ${side} +${k}: sim ground at ${(says.floorY - deckY).toFixed(2)} m, nothing drawn`,
              );
            else count('nothing drawn');
            continue;
          }
          const where = `${tag} ${n.net.id} ${e.id} s ${s.toFixed(0)} ${side} +${k} m`;
          const what = `sim ${says.past} at ${(says.floorY - deckY).toFixed(2)} m, drawn ${drawn.water ? 'water' : 'ground'} at ${(drawn.y - deckY).toFixed(2)} m (${drawn.name}${holds ? '' : ', holds no bike'})`;
          if (says.floorY > drawn.y + FLOOR_TOL_M) {
            if (!hole) count('over a gap narrower than a bike');
            else if (says.past === 'ground') f.ghostFloor.push(`${where}: ${what}`);
            else f.floorOff.push(`${where}: ${what}`);
          } else if (says.floorY < drawn.y - FLOOR_TOL_M) {
            if (holds) f.ghostDrop.push(`${where}: ${what}`);
            else if (drawn.water) f.floorOff.push(`${where}: ${what}`);
            else count('passes a face or a lip');
          }
        }
      }
    }
  }
  return f;
}

/** The first few, and how many. */
const head = (xs: readonly string[], n = 4) =>
  `${xs.length}${xs.length ? ` (${xs.slice(0, n).join('; ')})` : ''}`;
const counted = (f: Finding) =>
  Object.entries(f.counts)
    .map(([k, c]) => `${k} ${c}`)
    .join(', ');

describe('what lies past an edge is what is drawn there (every route network)', () => {
  it('the land triangle beside a Lombard switchback is the physical floor at the same world point', () => {
    const n = netOf('osm-sf-lombard');
    const edge = n.road.edgeIndex('osm-sf-lombard-crooked');
    const f = check(n, simRule(n), { edge, s0: 151, s1: 151, side: 'right' });
    expect(f.counts['ground']).toBeGreaterThan(0);
    expect([...f.ghostDrop, ...f.ghostFloor, ...f.floorOff]).toEqual([]);
  });
  it("Chuckanut's bluff, where the live check's high fall sank: ground on the shelf, the cliff's drop past it", () => {
    const n = netOf('osm-pnw-chuckanut');
    const edge = n.road.edgeIndex('osm-chuckanut-cliffs');
    const sim = simRule(n);
    const at = (k: number) => sim(edge, 403.15, 'right', k);
    const deck = n.road.surfaceHeight(edge, 403.15, n.road.vergeAt(edge, 403.15, 'right').dOuter);
    print(
      `[beyond-drawn] cliffs s 403.15 right, deck ${deck.toFixed(2)}: ${ACROSS_M.map((k) => {
        const x = at(k);
        return `+${k} ${typeof x === 'string' ? x : `${x.past} ${(x.floorY - deck).toFixed(2)}`}`;
      }).join(', ')}`,
    );
    // The shelf: 6.6 m of grass at the road's height past the parapet (the band's edge, 4 m of dirt out).
    for (const k of [0.5, 2, 4, 6]) expect(at(k), `+${k} m`).toMatchObject({ past: 'ground' });
    for (const k of [0.5, 2, 4, 6])
      expect(Math.abs((at(k) as { floorY: number }).floorY - deck)).toBeLessThan(0.3);
    // Past its lip, the cliff to the sea: the 70 m drop the live check saw.
    for (const k of [7.5, 9, 12]) expect(at(k), `+${k} m`).toMatchObject({ past: 'drop', floorY: 0 });
    const f = check(n, sim, { edge, s0: 380, s1: 2400, side: 'right' });
    print(
      `[beyond-drawn] the bluff, every metre: ${counted(f)}; wrong ${head([...f.ghostDrop, ...f.ghostFloor, ...f.floorOff])}`,
    );
    expect(f.counts['ground']).toBeGreaterThan(1000);
    expect(f.counts['drop']).toBeGreaterThan(1000);
    expect([...f.ghostDrop, ...f.ghostFloor, ...f.floorOff]).toEqual([]);
  });

  it('control: the tags alone (the old rule) drop through the drawn shelf at Chuckanut', () => {
    const n = netOf('osm-pnw-chuckanut');
    const edge = n.road.edgeIndex('osm-chuckanut-cliffs');
    const f = check(n, tagsRule(n), { edge, s0: 380, s1: 480, side: 'right' });
    print(`[beyond-drawn] control, the tags at the bluff: ghost drops ${head(f.ghostDrop, 2)}`);
    expect(f.ghostDrop.length).toBeGreaterThan(100);
    expect(f.ghostDrop.some((x) => x.includes('s 403 right +0.5 m'))).toBe(true);
  });

  it('control: ground at the deck everywhere is a ghost floor over the Golden Gate and Seven Mile water', () => {
    for (const [id, road, s0] of [
      ['osm-sf-golden-gate', 'osm-sf-gg-bridge', 1300],
      ['osm-keys-seven-mile', 'osm-sm-bridge', 3000],
    ] as const) {
      const n = netOf(id);
      const f = check(n, groundRule(n), { edge: n.road.edgeIndex(road), s0, s1: s0 + 50 });
      print(`[beyond-drawn] control, ground everywhere on ${road}: ghost floors ${head(f.ghostFloor, 2)}`);
      expect(f.ghostFloor.length).toBeGreaterThan(100);
    }
  });

  it('every route network: the sim meets ground where ground is drawn, and water or a drop only where they are', () => {
    const found = new Set<string>();
    let points = 0;
    let wrong = 0;
    for (const net of routeNetworks()) {
      const n = netOf(net.id);
      const f = check(n, simRule(n));
      const looked = Object.values(f.counts).reduce((a, b) => a + b, 0);
      points += looked;
      const all = [...f.ghostDrop, ...f.ghostFloor, ...f.floorOff];
      wrong += all.length;
      // A finding reads `[site] network road s …`: its key is the network and the road.
      for (const x of all) found.add(x.split(' ').slice(1, 3).join('/'));
      print(
        `[beyond-drawn] ${net.id}: ${looked} points (${counted(f)}); ghost drops ${head(f.ghostDrop, 3)}; ghost floors ${head(f.ghostFloor, 3)}; floors off ${head(f.floorOff, 3)}`,
      );
    }
    print(
      `[beyond-drawn] ${routeNetworks().length} networks, ${points} points; ${wrong} wrong, on ${found.size} roads: ${[...found].join(', ')}`,
    );
    expect(points).toBeGreaterThan(100_000);
    expect(
      [...found],
      'a road where the sim meets what is not drawn there (fix it; never list it to pass)',
    ).toEqual([]);
    expect(wrong).toBe(0);
  }, 600_000);
});
