// sim/riders/course.ts: the course's honest edges (the maintainer, 2026-10-06, [decided]: a road race in a physical
// world with honest edges, "consistent physics and gameplay is important here so players know what to expect and
// how to interact with the world"; then "Yeah that sounds good :)"). docs/product-spec.md, "World frame";
// docs/architecture.md, "Physical world".
//
// The course is the road, its ground band, any structure top and another road of the race (road/course.ts
// `courseAt`, the contract's one query). Past it is out of bounds, and crossing into it has one consequence, the
// same everywhere: a quick reset with the time penalty and the respawn on the road where the rider left it,
// through the overboard path (sim/tumble). Never an invisible wall:
// - on the ground, a band's edge holds a rider only where something is drawn there (road/beyond.ts
//   `drawnEdgeAt`: a barrier, a rail, the water's edge, a drawn parapet, guard rail or bulwark, a building, the
//   ferns or a fence, a deck's edge over a drop). Where nothing is (a `soft` edge, where the ground just runs on;
//   a gap in a row of planned buildings; a hard edge nothing names, with ground past it) the edge is open: a rider
//   whose centre crosses it onto another road the race allows is handed onto that road, and anywhere else he is
//   out (`groundEdgeOpen`, `leaveCourse`);
// - in the air, every edge is cleared above what is drawn there (road/beyond.ts `courseEdgeTopAt`), and a rider
//   out past his road's edge who comes down where the course query says is out (the lot behind a block, between
//   buildings below their roofs, ground past the verge, past a drop or into water) is out the same way
//   (sim/riders/gap.ts `overFall`); a road the race allows under him takes him over, and a structure's top that
//   holds the bike is ground he lands on (sim/riders/supports.ts), as before;
// - guides stay guides: a bridge's taper, a split's guide span and a staging road's edge turn a rider along with
//   no event and no speed lost (they lead him on along the course; they stop nothing).
// The switch, `riders.courseEdges`: on by default; a race whose tuning leaves it out (every recording made
// before) rides the old rules (every edge holds; ground past the edge in the air comes down at the band's edge),
// and so does one with the ground beside the road off (`ground.offRoad` 0: the M1 wall at the lanes). Pure + - * / over the road's queries, no random draw; the crash is the over-the-
// barrier one (`cause: 'over'`, `past: 'ground'`), so no state is made until a rider leaves the course.
import { cos, sin, type TuningParamDecl, type VergeEdge } from '../../core';
import {
  courseAt,
  drawnEdgeAt,
  lanesNear,
  type CourseSpot,
  type RoadNetwork,
  type RoadPos,
  type StructurePlan,
  type VergeSide,
} from '../../road';
import { offRoadOn } from '../ground';
import type { SimConfig } from '../types';
import { emit, type Mover, type World } from '../world';
import { KERB_M } from './features';
import { handYaw } from './gap';
import { racePlanOf } from './structures';

/** The switch: the course's edges are honest (1), or the old rules (0). */
export const COURSE_EDGES_KEY = 'riders.courseEdges';

export const COURSE_TUNING: readonly TuningParamDecl[] = [
  {
    // The maintainer, 2026-10-06 ([decided]): the course has edges, and crossing one always shows its
    // consequence, a quick reset with the time penalty; never an invisible wall. On by default; a race whose
    // tuning leaves it out (every recording made before) rides the old rules.
    id: COURSE_EDGES_KEY,
    group: 'crashes',
    label: 'Past the course is a reset, never an invisible wall (0 off, 1 on)',
    default: 1,
    min: 0,
    max: 1,
    step: 1,
    unit: '',
    affectsSim: true,
    system: true,
  },
];

/**
 * Whether this race's course has honest edges: the switch on, and the ground beside the road with it (with
 * `ground.offRoad` off a rider is held at the lanes by the M1 wall, exactly as before: there is no band to be
 * honest about).
 */
export function courseEdgesOn(params: Readonly<Record<string, number>>): boolean {
  return (params[COURSE_EDGES_KEY] ?? 0) >= 0.5 && offRoadOn(params);
}

/** No structures (the switch `riders.structures` off, or none planned on this network). */
const NO_PLAN: StructurePlan = { items: [], cellM: 32, cells: new Map() };
const OUT: CourseSpot = { kind: 'out' };

/**
 * What a rider at a road position (his own edge, s and d, perhaps past the band) and world height `y` would come
 * down on (road/course.ts `courseAt`, over the structures this race's riders meet): a road this race does not
 * allow is no part of its course, so it is out too.
 */
export function courseSpotOf(
  world: World,
  config: SimConfig,
  at: { readonly edge: number; readonly s: number; readonly d: number },
  y: number,
): CourseSpot {
  const spot = courseAt(config.road, racePlanOf(world, config) ?? NO_PLAN, at, y);
  return spot.kind === 'road' && !config.route.allows(spot.edge) ? OUT : spot;
}

/**
 * Whether one side's band edge at (edge, s) is open to a rider on the ground (nothing drawn there: past it is out
 * of bounds), with the switch on. `kind` is the riding limits' edge kind there: a broken fence's yard ends `soft`
 * (the fence is down, nothing stands), so it is open too. A building front is the caller's: whether a building
 * stands at the rider (sim/riders/index.ts, the structures plan).
 */
export function groundEdgeOpen(
  road: RoadNetwork,
  edge: number,
  s: number,
  side: VergeSide,
  kind: VergeEdge,
): boolean {
  if (kind === 'soft') return true;
  if (kind !== 'hard') return false;
  return drawnEdgeAt(road, edge, s, side) === null;
}

/**
 * Where render stands each kind of edge kit past a band's line and how far it keeps it off another road's lanes
 * (render/verge.ts, road-mesh.ts; polish J2: a piece that would stand in another road's lanes is left out), m:
 * `out` past the line, `clear` round it, looked for `along` either way every `step`. A fence panel (2 m, on the
 * line, 0.2 m clear: the panel the point is on, `panel`); a rail, a guard rail or a wall (on the line, 0.3 m clear,
 * probed every metre); a fern clump (up to 0.75 m out and 0.6 m along its spot, 3.5 m apart, 0.9 of its size, up
 * to 1.35, clear) or a hedge panel (0.45 m out, 0.4 m clear): within 2 m either way, 0.5 m out, 1.22 m clear.
 * Soft ground and the water's edge stand no kit: a hair past the line.
 */
const KIT: Readonly<
  Record<VergeEdge, { out: number; clear: number; along: number; step: number; panel?: true }>
> = {
  soft: { out: 0.05, clear: 0, along: 0, step: 1 },
  water: { out: 0.05, clear: 0, along: 0, step: 1 },
  fence: { out: 0, clear: 0.2, along: 0, step: 0.5, panel: true },
  rail: { out: 0.05, clear: 0.3, along: 1, step: 1 },
  hard: { out: 0.05, clear: 0.3, along: 1, step: 1 },
  brush: { out: 0.5, clear: 1.22, along: 2, step: 1 },
};
/**
 * The tags whose band's hard edge render draws as a barrier look along it (render/barrier-looks.ts
 * BARRIER_LOOK_BY_TAG's `edge` rows: the interstate's shoulder guard rail), and how far it keeps that look off a
 * ramp's line, m (render/verge.ts LOOK_RAMP_CLEAR_M): a ramp (a connector road with no such tag, a branch's in and
 * out) crosses the shoulder there, and the rail opens for it. tests/sim/no-invisible-walls.test.ts holds both to
 * render's.
 */
export const EDGE_LOOK_TAGS: ReadonlySet<string> = new Set(['interstate']);
export const RAMP_CLEAR_M = 6;

/** Each network's ramps' centre-line samples, world x and z. */
const rampSamples = new WeakMap<RoadNetwork, { x: number; z: number }[]>();

function rampsOf(road: RoadNetwork): { x: number; z: number }[] {
  const known = rampSamples.get(road);
  if (known) return known;
  const out: { x: number; z: number }[] = [];
  for (const e of road.edges) {
    if (!e.isConnector || e.tags.some((t) => EDGE_LOOK_TAGS.has(t.tag))) continue;
    for (let i = 0; i < e.count; i++) out.push({ x: e.x[i] ?? 0, z: e.z[i] ?? 0 });
  }
  rampSamples.set(road, out);
  return out;
}

/** Whether a ramp's centre line comes within RAMP_CLEAR_M of a world point. */
function nearRamp(road: RoadNetwork, x: number, z: number): boolean {
  for (const p of rampsOf(road)) {
    const dx = p.x - x;
    const dz = p.z - z;
    if (dx * dx + dz * dz < RAMP_CLEAR_M * RAMP_CLEAR_M) return true;
  }
  return false;
}

/** A fence panel's length along the road, m (render/verge.ts FENCE_SEG_M): panels start every 2 m from s 0. */
const FENCE_PANEL_M = 2;

/**
 * Whether another road's lanes lie past one side's band line at (edge, s) where render leaves that edge's `kind` of
 * kit out (road/course.ts `lanesNear`, render's own rule, on the map as render's: a fern under an overpass is left
 * out as one beside a slip road): a junction's mouth, the branches beside a split, a slip road leaving. Nothing is
 * drawn there, so the edge holds nothing: a rider across the line is handed onto that road where it is level with
 * him and the race allows it, and is out anywhere else (`leaveCourse`).
 */
export function roadPastLine(
  config: SimConfig,
  edge: number,
  s: number,
  side: 1 | -1,
  kind: VergeEdge,
): boolean {
  const road = config.road;
  const kit = KIT[kind];
  const vside = side > 0 ? 'right' : 'left';
  const length = road.edges[edge]?.length ?? 0;
  const at = (sa: number) => {
    const u = sa < 0 ? 0 : sa > length ? length : sa;
    return road.toWorld(edge, u, road.vergeAt(edge, u, vside).dOuter + side * kit.out, 0);
  };
  if (kit.panel) {
    // The panel the point is on, looked along at its ends and three points between, as render looks.
    const s0 = Math.floor(s / FENCE_PANEL_M) * FENCE_PANEL_M;
    const a = at(s0);
    const b = at(s0 + FENCE_PANEL_M);
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      if (lanesNear(road, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, edge, kit.clear)) return true;
    }
    return false;
  }
  for (let d = -kit.along; d <= kit.along + 1e-9; d += kit.step) {
    const p = at(s + d);
    if (lanesNear(road, p.x, p.z, edge, kit.clear)) return true;
  }
  // A shoulder's drawn rail opens where a ramp crosses it (render/verge.ts: an edge look keeps off a ramp's line).
  if (kind === 'hard' && !road.barrierAt(edge, s, vside)) {
    const e = road.edges[edge];
    const looked = e?.tags.some(
      (t) => EDGE_LOOK_TAGS.has(t.tag) && s >= t.s0 && s <= t.s1 && (t.side === 'both' || t.side === vside),
    );
    if (looked) {
      for (let d = -1; d <= 1; d += 1) {
        const p = at(s + d);
        if (nearRamp(road, p.x, p.z)) return true;
      }
    }
  }
  return false;
}

/**
 * A rider whose centre crossed an open edge (`side` of the road, at its riding limit `limit`), with his feet at
 * world height `feet`: on another road the race allows, level with him (a junction's mouth, a sibling branch's
 * band), he is handed onto it, his world position and heading kept; on a structure's top within a kerb of his feet
 * he rides on (it is course); anywhere else he is out of bounds: a `crash` with `cause: 'over'`, `overboard`, `past: 'ground'`
 * and the crossing (`crossEdge`, `crossS`, `crossD`), which sim/tumble turns into the quick reset (the penalty,
 * then the respawn on the road at the crossing). Returns true when he is out.
 */
export function leaveCourse(
  world: World,
  config: SimConfig,
  m: Mover,
  side: 1 | -1,
  limit: number,
  feet: number,
): boolean {
  const pos = m.pos;
  const spot = courseSpotOf(world, config, pos, feet + KERB_M);
  // Level with him (no more than a kerb down): a structure's top he rides on, another road he is handed onto.
  // Lower than that he went off an edge onto nothing drawn: out, as off any edge.
  if (spot.kind === 'top' && spot.y >= feet - KERB_M) return false;
  if (spot.kind === 'road' && spot.y >= feet - KERB_M) {
    handOnto(config.road, m, spot);
    return false;
  }
  emit(world, 'crash', m.id, {
    cause: 'over',
    overboard: true,
    past: 'ground',
    dropM: 0,
    high: false,
    floorY: feet,
    side,
    speed: m.speed,
    yaw: m.yaw,
    depthM: 0,
    crossEdge: pos.edge,
    crossS: pos.s,
    crossD: limit,
  });
  return true;
}

/**
 * Hands a rider onto another road under him (`to`: its edge, s and d), keeping his world position and heading: his
 * travel along it is the way along it closest to his heading.
 */
function handOnto(road: RoadNetwork, m: Mover, to: { edge: number; s: number; d: number }): void {
  const from = m.pos;
  const a = road.frameAt(from.edge, from.s);
  const b = road.frameAt(to.edge, to.s);
  // His heading in the world: his road's travel turned by his yaw toward his right (sim/tumble's forward).
  const tx = a.tx * from.dir;
  const tz = a.tz * from.dir;
  const c = cos(m.yaw);
  const sn = sin(m.yaw);
  const hx = c * tx - sn * tz;
  const hz = c * tz + sn * tx;
  const dir: 1 | -1 = hx * b.tx + hz * b.tz >= 0 ? 1 : -1;
  const next: RoadPos = { edge: to.edge, s: to.s, d: to.d, dir };
  m.yaw = handYaw(road, from, next, m.yaw);
  m.pos.edge = next.edge;
  m.pos.s = next.s;
  m.pos.d = next.d;
  m.pos.dir = next.dir;
}
