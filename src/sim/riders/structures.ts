// Structures are solid (the maintainer, 2026-10-06, [decided]: a road race in a physical world with honest
// edges, "consistent physics and gameplay is important here so players know what to expect and how to
// interact with the world"; "I've been high enough to land on buildings but the wall prevented it"). The
// road's structures plan (src/road/structures.ts: every building, landmark, wall, pier and shed render draws
// beside the road, each an oriented box with a base and a roof) is what a rider meets, the same rule for the
// player, the rivals and the cops:
// - its walls are solid from its base up to its roof: a rider whose body (feet to head, RIDER_BODY_HEIGHT_M)
//   reaches into that span meets it by the one contact rule for heavy fixed things (sim/traffic/contact-rule.ts:
//   the closing speed along the contact's normal, square on at speed a crash, a glance a wobble), on the ground
//   and in the air. Its top less than a kerb (KERB_M) over the rider's feet is a step he rides onto, no wall;
// - its roof is a support (sim/riders/supports.ts, the ride-the-roof model): a top that holds the bike is
//   ground a rider lands on through land() and rides, and riding off its edge is a take-off; a pitched roof is
//   a slope (its rise along the bike's heading is the grade he rides, lands and takes off on); a top too small
//   to hold the bike is met from above by the closing-speed rule;
// - a gap between structures is open: nothing is there. A crack narrower than the bike (the 5 cm between two
//   Mission fronts) is bridged by its wheels;
// - where a structure stands at a building front's `hard` verge edge, that edge's wall at any height gives way
//   to the structure (road/beyond.ts `frontTagAt`: a rider in the air above the band's edge flies on and meets
//   the building itself; one held at the edge on the ground meets it by the one rule); where none stands (a gap
//   in the frontage) it is open in the air and the band's edge on the ground. Fronts whose buildings are not in
//   the plan yet (the row houses) stay the wall at any height they were;
// - on a roof a rider may be past his band's sideways limit: the band's edge does not hold him up there.
// Geometry: a structure is a box in world metres; the contact meets it as a footprint in the rider's own road
// frame (`localShape`), laid out from the frame where the rider is (exact at the rider, so exact where the bike
// meets it), so the capsule rules of the street furniture (sim/riders/furniture.ts) serve it unchanged.
// Determinism: + - * / and sqrt; ids ascending; the plan is the road's (src/road/structures.ts), kept per
// network and seed, made from the road data and the seed only. `riders.structures` absent or 0 (every recording
// made before) rides the old rules, and the per-rider state is created only at the first contact, so a race that
// never meets a structure hashes as before.
import type { TuningParamDecl } from '../../core';
import {
  footContains,
  frontTagAt,
  raceStructures,
  STRUCTURE_LAYERS,
  topAt,
  type FurnitureShape,
  type RoadNetwork,
  type Structure,
  type StructurePlan,
  type VergeSide,
} from '../../road';
import type { SimConfig } from '../types';
import { systemState, type World } from '../world';
import { RIDER_BODY_HEIGHT_M } from './contact';
import { KERB_M } from './features';

/** The switch: the plan's structures are solid and their tops are ground (1), or the old rules (0). */
export const STRUCTURES_KEY = 'riders.structures';

export const STRUCTURES_TUNING: readonly TuningParamDecl[] = [
  {
    // The maintainer, 2026-10-06 ([decided]): everything a rider can reach is physical at its drawn shape,
    // buildings to their roofline, roofs a rider lands on and rides. On by default; a race whose tuning leaves
    // it out (every recording made before) rides the old rules: no structure, a building front a wall at any
    // height.
    id: STRUCTURES_KEY,
    group: 'crashes',
    label: 'Buildings and landmarks are solid, roofs are ground (0 off, 1 on)',
    default: 1,
    min: 0,
    max: 1,
    step: 1,
    unit: '',
    affectsSim: true,
    system: true,
  },
];

/** Whether this race's riders meet the plan's structures. */
export function structuresOn(params: Readonly<Record<string, number>>): boolean {
  return (params[STRUCTURES_KEY] ?? 0) >= 0.5;
}

/** The race's plan, once per config (a race's config never changes). */
const plans = new WeakMap<SimConfig, StructurePlan>();

/**
 * The structures this race's riders meet, or null with the switch off. The road's plan for the race's network
 * and seed (road/structures.ts `raceStructures`: it throws when the network's planners have not loaded, so a
 * race never rides a world with a piece missing).
 */
export function racePlanOf(world: World, config: SimConfig): StructurePlan | null {
  if (!structuresOn(world.params)) return null;
  let plan = plans.get(config);
  if (!plan) {
    plan = raceStructures(config.road, config.seed);
    plans.set(config, plan);
  }
  return plan.items.length > 0 ? plan : null;
}

/** The building-front tags whose buildings are in the plan: some layer asks for them. */
const PLANNED_FRONTS: ReadonlySet<string> = new Set(
  Object.values(STRUCTURE_LAYERS).flatMap((layer) => [...(layer.tags ?? [])]),
);

/**
 * Whether one side's band edge at (edge, s) is a building front whose buildings are in the plan (so in the air
 * it is no wall: the buildings themselves are; road/beyond.ts `frontTagAt`).
 */
export function plannedFrontAt(road: RoadNetwork, edge: number, s: number, side: VergeSide): boolean {
  const tag = frontTagAt(road, edge, s, side);
  return tag !== null && PLANNED_FRONTS.has(tag);
}

/** The finder's square, m [default]: a few street pieces across, so a lookup reads a handful of ids. */
const NEAR_CELL_M = 8;
/** A cell's key: (i, j) packed into one number (each within ±32767 squares, ±262 km). */
const keyOf = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);

/** A plan's finder: each structure's world bounds' half sizes, and the ids in each square they touch. */
interface Finder {
  ex: Float64Array;
  ez: Float64Array;
  cells: Map<number, number[]>;
}

const finders = new WeakMap<StructurePlan, Finder>();

function finderOf(plan: StructurePlan): Finder {
  const known = finders.get(plan);
  if (known) return known;
  const n = plan.items.length;
  const ex = new Float64Array(n);
  const ez = new Float64Array(n);
  const cells = new Map<number, number[]>();
  for (const st of plan.items) {
    const f = st.foot;
    const ax = f.ux < 0 ? -f.ux : f.ux;
    const az = f.uz < 0 ? -f.uz : f.uz;
    const bx = f.hu * ax + f.hv * az;
    const bz = f.hu * az + f.hv * ax;
    ex[st.id] = bx;
    ez[st.id] = bz;
    for (let i = Math.floor((f.x - bx) / NEAR_CELL_M); i <= Math.floor((f.x + bx) / NEAR_CELL_M); i++)
      for (let j = Math.floor((f.z - bz) / NEAR_CELL_M); j <= Math.floor((f.z + bz) / NEAR_CELL_M); j++) {
        const k = keyOf(i, j);
        const list = cells.get(k);
        if (list) list.push(st.id);
        else cells.set(k, [st.id]);
      }
  }
  const finder = { ex, ez, cells };
  finders.set(plan, finder);
  return finder;
}

/** The structures whose footprint's world bounds come within `r` of (x, z), ascending id. */
export function structuresNear(plan: StructurePlan, x: number, z: number, r: number): Structure[] {
  const fd = finderOf(plan);
  const ids: number[] = [];
  for (let i = Math.floor((x - r) / NEAR_CELL_M); i <= Math.floor((x + r) / NEAR_CELL_M); i++)
    for (let j = Math.floor((z - r) / NEAR_CELL_M); j <= Math.floor((z + r) / NEAR_CELL_M); j++) {
      const list = fd.cells.get(keyOf(i, j));
      if (!list) continue;
      for (const id of list) {
        const st = plan.items[id];
        if (!st) continue;
        const dx = x - st.foot.x;
        const dz = z - st.foot.z;
        if ((dx < 0 ? -dx : dx) > (fd.ex[id] ?? 0) + r || (dz < 0 ? -dz : dz) > (fd.ez[id] ?? 0) + r)
          continue;
        ids.push(id);
      }
    }
  ids.sort((a, b) => a - b);
  const out: Structure[] = [];
  let last = -1;
  for (const id of ids) {
    if (id === last) continue;
    last = id;
    const st = plan.items[id];
    if (st) out.push(st);
  }
  return out;
}

/** The structures whose footprint holds the world point (x, z), ascending id. */
export function structuresOver(plan: StructurePlan, x: number, z: number): Structure[] {
  return structuresNear(plan, x, z, 0).filter((st) => footContains(st.foot, x, z));
}

/**
 * A structure's footprint in a rider's road frame at (edge, s, d): its middle and axis taken along and across
 * the road as they run where the rider is. Exact at the rider (where the bike meets it); a box far along a bend
 * from him is laid out straight, which no contact this tick reaches.
 */
export function localShape(
  road: RoadNetwork,
  edge: number,
  s: number,
  d: number,
  st: Structure,
): FurnitureShape {
  const p = road.toWorld(edge, s, d, 0);
  const f = road.frameAt(edge, s);
  // Along the road (tx, tz); across it, toward +d, (-tz, tx).
  const rx = st.foot.x - p.x;
  const rz = st.foot.z - p.z;
  const us = st.foot.ux * f.tx + st.foot.uz * f.tz;
  const ud = -st.foot.ux * f.tz + st.foot.uz * f.tx;
  const as = us < 0 ? -us : us;
  const ad = ud < 0 ? -ud : ud;
  return {
    s: s + rx * f.tx + rz * f.tz,
    d: d - rx * f.tz + rz * f.tx,
    r: 0,
    hu: st.foot.hu,
    hv: st.foot.hv,
    us,
    ud,
    reachS: st.foot.hu * as + st.foot.hv * ad,
    reachD: st.foot.hu * ad + st.foot.hv * as,
  };
}

/** The nearest point of a footprint to a world point (the point itself when it is on it). */
export function nearestOn(st: Structure, x: number, z: number): { x: number; z: number } {
  const f = st.foot;
  const dx = x - f.x;
  const dz = z - f.z;
  let u = dx * f.ux + dz * f.uz;
  let v = dz * f.ux - dx * f.uz;
  u = u > f.hu ? f.hu : u < -f.hu ? -f.hu : u;
  v = v > f.hv ? f.hv : v < -f.hv ? -f.hv : v;
  return { x: f.x + u * f.ux - v * f.uz, z: f.z + u * f.uz + v * f.ux };
}

/** A structure's top's world height at the point of its footprint nearest (x, z). */
export function topNear(st: Structure, x: number, z: number): number {
  const p = nearestOn(st, x, z);
  return topAt(st, p.x, p.z) ?? st.baseY;
}

/** How far into a footprint the top's rise is read, either way along the heading, m. */
const GRADE_STEP_M = 0.25;

/**
 * A structure's top's rise per metre along a world heading (hx, hz) at (x, z): 0 on a flat roof, the pitch on a
 * pitched one (up toward its ridge, down past it), read either side within the footprint.
 */
export function topGrade(st: Structure, x: number, z: number, hx: number, hz: number): number {
  if (st.roof.kind === 'flat') return 0;
  const a = nearestOn(st, x - hx * GRADE_STEP_M, z - hz * GRADE_STEP_M);
  const b = nearestOn(st, x + hx * GRADE_STEP_M, z + hz * GRADE_STEP_M);
  const run = (b.x - a.x) * hx + (b.z - a.z) * hz;
  if (run < 1e-6) return 0;
  return ((topAt(st, b.x, b.z) ?? 0) - (topAt(st, a.x, a.z) ?? 0)) / run;
}

/** A structure standing in a road's ridable band at a rider's height: what the rival AI and the cops steer round. */
export interface BandPiece {
  /** Its id in the plan. */
  id: number;
  /** Its footprint's middle on the edge (s, d) and its reach along and across, m. */
  s: number;
  d: number;
  reachS: number;
  reachD: number;
}

const bands = new WeakMap<SimConfig, readonly (readonly BandPiece[])[]>();

/**
 * The structures standing in each edge's ridable band (between its two verge bands' outer edges) from the
 * road up to a rider's head (a balcony's posts, a porch, a café table, a bike rack, a gate's pillar), by edge,
 * sorted by s: the rival AI and the cops see them as they see the solid street furniture (sim/ai/sense.ts
 * `furnitureSeen`). Each is laid out on the edge it was placed from, by its own placement. Once per race.
 */
export function bandPiecesOf(world: World, config: SimConfig): readonly (readonly BandPiece[])[] {
  const known = bands.get(config);
  if (known) return known;
  const plan = racePlanOf(world, config);
  const road = config.road;
  const out: BandPiece[][] = road.edges.map(() => []);
  for (const st of plan?.items ?? []) {
    const e = road.edges[st.edge];
    if (!e) continue;
    const s = st.s < 0 ? 0 : st.s > e.length ? e.length : st.s;
    const shape = localShape(road, st.edge, s, 0, st);
    if (shape.s < 0 || shape.s > e.length) continue;
    const left = road.vergeAt(st.edge, shape.s, 'left').dOuter;
    const right = road.vergeAt(st.edge, shape.s, 'right').dOuter;
    if (shape.d + shape.reachD < left || shape.d - shape.reachD > right) continue;
    const ground = road.surfaceHeight(st.edge, shape.s, shape.d);
    // Over his head (a balcony, a lintel), or no more than a kerb up (a step he rides onto): no obstacle.
    if (st.baseY >= ground + RIDER_BODY_HEIGHT_M || topNear(st, st.foot.x, st.foot.z) <= ground + KERB_M)
      continue;
    out[st.edge]?.push({ id: st.id, s: shape.s, d: shape.d, reachS: shape.reachS, reachD: shape.reachD });
  }
  for (const list of out) list.sort((a, b) => a.s - b.s || a.id - b.id);
  bands.set(config, out);
  return out;
}

/** A top a crashed body can rest on is at least this wide each way, m (a bike's width; a post's top is not). */
const BODY_TOP_M = 0.8;

/**
 * The structures' tops a crashed body comes down on (sim/tumble: a crash on a roof stays on the roof): the
 * highest top over a world point (x, z) at or under `y`, world m, or null; none with the switch off.
 */
export function bodyTopsOf(
  world: World,
  config: SimConfig,
): ((x: number, z: number, y: number) => number | null) | undefined {
  const plan = racePlanOf(world, config);
  if (!plan) return undefined;
  return (x, z, y) => {
    let best: number | null = null;
    for (const st of structuresOver(plan, x, z)) {
      if (2 * st.foot.hu < BODY_TOP_M || 2 * st.foot.hv < BODY_TOP_M) continue;
      const t = topAt(st, x, z);
      if (t !== null && t <= y && (best === null || t > best)) best = t;
    }
    return best;
  };
}

/** A structure as a contact's piece: itself and its footprint in the rider's frame. */
export interface StructurePiece {
  st: Structure;
  shape: FurnitureShape;
}

/** The per-rider state: the structure each rider touched last tick (its id + 1, 0 for none), by entity id. */
export interface StructureTouchState {
  touch: number[];
}

/** The state key (created only at a rider's first contact with a structure). */
export const STRUCTURE_STATE_KEY = 'structures';

/** The structure a rider touched last tick (its id + 1), or 0. Never writes. */
export function touchedOf(world: World, id: number): number {
  return (world.systems[STRUCTURE_STATE_KEY] as StructureTouchState | undefined)?.touch[id] ?? 0;
}

/** Notes the structure a rider touches this tick (its id + 1, 0 for none); writes only when it changes. */
export function noteTouch(world: World, id: number, touched: number): void {
  if (touchedOf(world, id) === touched) return;
  systemState<StructureTouchState>(world, STRUCTURE_STATE_KEY, () => ({ touch: [] })).touch[id] = touched;
}
