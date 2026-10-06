// The physical world's structures (the maintainer, 2026-10-06, [decided]: "consistent physics and gameplay is
// important here so players know what to expect and how to interact with the world"; then, to a road race in a
// physical world with honest edges, "Yeah that sounds good :)"). Everything a rider can reach is physical at its
// drawn shape: buildings to their roofline, roofs a rider lands on and rides, landmarks too
// (docs/architecture.md, "Physical world"). This module is the contract that work builds on:
//
// - A structure is ONE solid: an oriented box on the ground in world metres (its middle, its axis u and the
//   quarter turn of it, v = (-uz, ux), and half sizes along each), a base (the world height of its underside: the
//   ground under a building, the underside of a deck or a lintel over the road) and a roof over the base (flat, or
//   pitched from eaves on two sides up to a ridge along u or v). A building with a balcony over the pavement, or a
//   gate with posts and a lintel, is several structures.
// - The plan is every structure of a network for a seed (the race's: render's scenery seed is the race seed). The
//   layers a network needs (its tags and features say which, `STRUCTURE_LAYERS`) each have a planner, which loads
//   lazily (`load`, a dynamic import: never in the first load); the plan runs them in layer-name order, numbers
//   what they add, and is kept per network and seed. Render draws it, the sim meets it, so what is drawn is what
//   is hit (road/furniture.ts is the precedent). A network whose layers are not all planned has no plan: the sim
//   refuses to start (`requireStructures`) rather than ride a world with a piece missing.
// - A planner that places a model takes its box from `STRUCTURE_MODELS` by model id, the committed file's own box
//   (scripts/hitboxes.test.ts holds the two together), never from what has loaded.
//
// Pure + - * / and core math, like the rest of road/: the same network, seed and planners give the same plan.
// Nothing reads a plan yet (2026-10-06): the planners move here from render layer by layer.
import { cos, sin } from '../core';
import type { RoadNetwork } from './network';

/** What a structure is (the events and the docs name it; the physics is one rule for all of them). */
export type StructureClass = 'building' | 'landmark' | 'wall' | 'pier' | 'shed' | 'bridge';

/**
 * A footprint on the ground, world metres: its middle (x, z), its axis u (a unit vector) and v = (-uz, ux), and
 * its half sizes along each. It is a box whatever the road does beside it: a front that follows a bend is a run
 * of boxes.
 */
export interface StructureFoot {
  readonly x: number;
  readonly z: number;
  readonly ux: number;
  readonly uz: number;
  readonly hu: number;
  readonly hv: number;
}

/**
 * The roof, in metres over the base: flat at `topM`, or pitched from `eaveM` along the two sides parallel to the
 * ridge up to `ridgeM` on the ridge, which runs through the middle along the footprint's `u` or `v` axis.
 */
export type StructureRoof =
  | { readonly kind: 'flat'; readonly topM: number }
  | { readonly kind: 'pitched'; readonly eaveM: number; readonly ridgeM: number; readonly ridge: 'u' | 'v' };

/** A structure as a planner adds it. */
export interface StructureSpec {
  /** The planner's rule (render's names: `tower`, `pier-shed`), for tests, the docs and the debug report. */
  readonly rule: string;
  readonly cls: StructureClass;
  /** The model it draws (a `STRUCTURE_MODELS` id, or a landmark's `<kit>#<node>`), or null for a code-made one. */
  readonly model: string | null;
  /** Where it was placed from (the road position of its front's middle). */
  readonly edge: number;
  readonly s: number;
  readonly d: number;
  readonly foot: StructureFoot;
  /** World height of its underside, m. */
  readonly baseY: number;
  readonly roof: StructureRoof;
}

/** A structure as the plan holds it: numbered in the plan, and named by the layer that planned it. */
export interface Structure extends StructureSpec {
  readonly id: number;
  readonly layer: string;
}

/** Where a planner puts what it places. Returns the structure's id. */
export interface StructureSink {
  add(spec: StructureSpec): number;
}

/** One layer's planner: a pure function of the network and the seed (+ - * / and core math). */
export interface StructurePlanner {
  plan(road: RoadNetwork, seed: number, out: StructureSink): void;
}

/** A layer: what on a network asks for it (any of these tags or feature kinds on any road), and its planner. */
export interface StructureLayerSpec {
  readonly tags?: readonly string[];
  readonly features?: readonly string[];
  /** Loads the planner: a dynamic import of its own module, so it is a lazy chunk. */
  load(): Promise<StructurePlanner>;
}

/**
 * The layers, by name. Each port adds its row with its planner, `{ tags, load: () => import(...) }`, so a
 * network asks only for the planners that exist. Empty until the first port lands.
 */
export const STRUCTURE_LAYERS: Readonly<Record<string, StructureLayerSpec>> = {};

/** The plan: every structure, numbered, and a grid of the world for finding them. */
export interface StructurePlan {
  readonly items: readonly Structure[];
  /** The grid's square, m. */
  readonly cellM: number;
  /** The ids whose footprint's bounds touch each square (`i,j`), ascending. */
  readonly cells: ReadonlyMap<string, readonly number[]>;
}

/** A model's box in its own frame (+Z its front, +X its right, +Y up), m, at scale 1. */
export interface StructureModel {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly z0: number;
  readonly z1: number;
  /** What it is, in plain words. */
  readonly what: string;
}

const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, what: string) => ({
  x0,
  x1,
  y0,
  y1,
  z0,
  z1,
  what,
});

/**
 * Each placed model's box, by `<asset id>#<variant>`: the committed GLB's whole box (an overhang such as a
 * balcony included), exactly what render measures from the loaded model today, rounded to the centimetre and held
 * to the file by scripts/hitboxes.test.ts. Today's rows are the two layers whose lots render sizes from what has
 * loaded: downtown Portland (render/downtown.ts `pdxFootprint`) and Key West's Old Town fronts (render/roadside.ts,
 * a `Frontage` rule's model box). A port adds the rows of the models it places.
 */
export const STRUCTURE_MODELS = {
  // Downtown Portland (render/downtown.ts PDX), the kit's front at z 0, its body back along -z.
  'models/scenery/pdx-downtown#0': box(-7.5, 7.5, 0, 12, -14, 0, 'a cast-iron front'),
  'models/scenery/pdx-downtown#1': box(-15, 15, 0, 25, -22, 0, 'a brick loft'),
  'models/scenery/pdx-downtown#2': box(-15, 15, 0, 28, -22, 0, 'an office block'),
  'models/scenery/pdx-downtown#3': box(-15, 15, 0, 7, -24, 0, "a pink tower's base"),
  'models/scenery/pdx-downtown#4': box(-15, 15, 0, 14, -24, 0, "a pink tower's mid"),
  'models/scenery/pdx-downtown#5': box(-15, 15, 0, 8, -24, 0, "a pink tower's crown"),
  'models/scenery/pdx-downtown#6': box(-2.5, 5.6, 0, 3, -2.42, 0.8, 'a food cart and its table'),
  'models/scenery/pdx-downtown#7': box(-2.5, 5.6, 0, 3, -2.42, 0.8, 'a food cart and its table'),
  'models/scenery/pdx-downtown#8': box(-2.5, 5.6, 0, 3, -2.42, 0.8, 'a food cart and its table'),
  'models/scenery/pdx-downtown#9': box(-1.33, 1.4, 0, 1.6, -0.6, 0, 'a bike rack'),
  // Key West's Old Town (render/roadside.ts KEYS_KIT `oldtown-front`, `oldtown-back`): the balcony reaches +z.
  'models/scenery/duval-kit#0': box(-4.25, 4.25, 0, 9.01, -8.25, 2.13, 'a balconied shopfront'),
  'models/scenery/duval-kit#1': box(-5.75, 5.75, 0, 9.01, -8.25, 2.13, 'a balconied shopfront'),
  'models/scenery/duval-kit#2': box(-7.08, 7.08, 0, 8.9, -8, 2.13, 'a balconied shopfront'),
  'models/scenery/duval-kit#3': box(-3.75, 3.75, 0, 7.02, -7.25, 2.25, 'a conch house'),
  'models/scenery/duval-kit#4': box(-3.75, 3.75, 0, 7.02, -7.25, 2.25, 'a conch house'),
  'models/scenery/duval-kit#5': box(-7.3, 7.3, 0, 6, -14.3, 0.4, 'the corner bar'),
  // Old Town's open-fronted bars (render/roadside.ts KEYS_KIT `oldtown-bar`).
  'models/scenery/keys-identity#6': box(-7.2, 7.2, 0, 8, -7.2, 2.62, 'an open-fronted bar'),
  'models/scenery/keys-identity#7': box(-6.18, 6.18, 0, 5.5, -7, 3.1, 'an open-fronted bar'),
} as const satisfies Record<string, StructureModel>;

/** A model's box by id. An id with no row is a planner's bug: it throws, never guesses a size. */
export function structureModel(id: string): StructureModel {
  const m = (STRUCTURE_MODELS as Readonly<Record<string, StructureModel>>)[id];
  if (!m) throw new Error(`structures: no fixed box for model ${id} (add its row to STRUCTURE_MODELS)`);
  return m;
}

/**
 * Where a model's box stands when render places the model at (x, z), turned by `yaw` and scaled: three.js turns
 * the model's +Z to (sin yaw, cos yaw) and its +X to (cos yaw, -sin yaw). The footprint's u is the model's +X.
 */
export function modelFoot(
  m: StructureModel,
  at: { x: number; z: number; yaw: number; scale: number },
): StructureFoot {
  const sy = sin(at.yaw);
  const cy = cos(at.yaw);
  const mx = ((m.x0 + m.x1) / 2) * at.scale;
  const mz = ((m.z0 + m.z1) / 2) * at.scale;
  return {
    x: at.x + mx * cy + mz * sy,
    z: at.z - mx * sy + mz * cy,
    ux: cy,
    uz: -sy,
    hu: ((m.x1 - m.x0) / 2) * at.scale,
    hv: ((m.z1 - m.z0) / 2) * at.scale,
  };
}

/** A placed model as a structure's solid: its footprint, its base (the model's y0 over `y`) and a flat roof. */
export function modelSolid(
  id: string,
  at: { x: number; y: number; z: number; yaw: number; scale: number },
): Pick<StructureSpec, 'model' | 'foot' | 'baseY' | 'roof'> {
  const m = structureModel(id);
  return {
    model: id,
    foot: modelFoot(m, at),
    baseY: at.y + m.y0 * at.scale,
    roof: { kind: 'flat', topM: (m.y1 - m.y0) * at.scale },
  };
}

/** Whether a world point (x, z) lies on a footprint (its edges included). */
export function footContains(f: StructureFoot, x: number, z: number): boolean {
  const dx = x - f.x;
  const dz = z - f.z;
  const u = dx * f.ux + dz * f.uz;
  const v = dz * f.ux - dx * f.uz;
  return u <= f.hu && u >= -f.hu && v <= f.hv && v >= -f.hv;
}

/** The world height of a structure's top over (x, z), or null when the point is off its footprint. */
export function topAt(st: StructureSpec, x: number, z: number): number | null {
  const f = st.foot;
  if (!footContains(f, x, z)) return null;
  const roof = st.roof;
  if (roof.kind === 'flat') return st.baseY + roof.topM;
  const dx = x - f.x;
  const dz = z - f.z;
  // How far across from the ridge, as a share of the half size (0 on the ridge, 1 at the eaves).
  const across = roof.ridge === 'u' ? (dz * f.ux - dx * f.uz) / f.hv : (dx * f.ux + dz * f.uz) / f.hu;
  const t = across < 0 ? -across : across;
  return st.baseY + roof.ridgeM - (roof.ridgeM - roof.eaveM) * t;
}

/** The plan's grid square, m [default]: about a city lot, so a lookup reads a handful of ids. */
const CELL_M = 32;
const cellKey = (i: number, j: number) => `${i},${j}`;

/** The ids of the structures standing at a world point, ascending. */
export function structuresAt(plan: StructurePlan, x: number, z: number): Structure[] {
  const ids = plan.cells.get(cellKey(Math.floor(x / plan.cellM), Math.floor(z / plan.cellM)));
  if (!ids) return [];
  const out: Structure[] = [];
  for (const id of ids) {
    const st = plan.items[id];
    if (st && footContains(st.foot, x, z)) out.push(st);
  }
  return out;
}

/** The layers a network needs: any whose tags or feature kinds any of its roads carries, in name order. */
export function structureLayersFor(
  road: RoadNetwork,
  layers: Readonly<Record<string, StructureLayerSpec>> = STRUCTURE_LAYERS,
): string[] {
  const out: string[] = [];
  for (const name of Object.keys(layers).sort()) {
    const spec = layers[name];
    const tags = spec?.tags ?? [];
    const kinds = spec?.features ?? [];
    const needed = road.edges.some(
      (e) => e.tags.some((t) => tags.includes(t.tag)) || e.features.some((f) => kinds.includes(f.kind)),
    );
    if (needed) out.push(name);
  }
  return out;
}

const finite = (v: number) => typeof v === 'number' && Number.isFinite(v);

/** A planner's structure, checked: a bad one is the planner's bug, so it throws with its layer and rule. */
function checked(layer: string, s: StructureSpec): StructureSpec {
  const f = s.foot;
  const r = s.roof;
  const axis = f.ux * f.ux + f.uz * f.uz;
  const fine =
    [f.x, f.z, f.ux, f.uz, f.hu, f.hv, s.baseY, s.s, s.d].every(finite) &&
    f.hu > 0 &&
    f.hv > 0 &&
    axis > 1 - 1e-6 &&
    axis < 1 + 1e-6 &&
    (r.kind === 'flat'
      ? finite(r.topM) && r.topM > 0
      : finite(r.eaveM) && finite(r.ridgeM) && r.eaveM > 0 && r.ridgeM >= r.eaveM);
  if (!fine)
    throw new Error(`structures: layer ${layer} added a bad ${s.rule} (a footprint, base or roof is off)`);
  return s;
}

/** The grid of a plan's footprints: each id in every square its footprint's bounds touch. */
function cellsOf(items: readonly Structure[]): Map<string, number[]> {
  const cells = new Map<string, number[]>();
  for (const st of items) {
    const f = st.foot;
    const ax = f.ux < 0 ? -f.ux : f.ux;
    const az = f.uz < 0 ? -f.uz : f.uz;
    const ex = f.hu * ax + f.hv * az;
    const ez = f.hu * az + f.hv * ax;
    for (let i = Math.floor((f.x - ex) / CELL_M); i <= Math.floor((f.x + ex) / CELL_M); i++)
      for (let j = Math.floor((f.z - ez) / CELL_M); j <= Math.floor((f.z + ez) / CELL_M); j++) {
        const k = cellKey(i, j);
        const list = cells.get(k);
        if (list) list.push(st.id);
        else cells.set(k, [st.id]);
      }
  }
  return cells;
}

/** The plans, by network and seed (the registry render and the sim both read). */
const registry = new WeakMap<RoadNetwork, Map<number, StructurePlan>>();

/** The plan of a network that needs no layer. */
const EMPTY: StructurePlan = { items: [], cellM: CELL_M, cells: new Map() };

/** The kept plan of a network and seed, or null when it has not been planned. */
export function structuresOf(road: RoadNetwork, seed: number): StructurePlan | null {
  return registry.get(road)?.get(seed) ?? null;
}

/**
 * Plans a network's structures for a seed, once: every layer the network needs, in name order, by its planner
 * (`planners`, by layer name; those of layers it does not need are not run). Kept, so the second call returns the
 * same plan. Throws, keeping nothing, when a layer it needs has no planner.
 */
export function planStructures(
  road: RoadNetwork,
  seed: number,
  planners: Readonly<Record<string, StructurePlanner | undefined>>,
  layers: Readonly<Record<string, StructureLayerSpec>> = STRUCTURE_LAYERS,
): StructurePlan {
  const known = structuresOf(road, seed);
  if (known) return known;
  const needed = structureLayersFor(road, layers);
  const missing = needed.filter((name) => !planners[name]);
  if (missing.length > 0)
    throw new Error(
      `structures: network ${road.id} needs the layers ${missing.join(', ')}, which have no planner`,
    );
  const items: Structure[] = [];
  for (const layer of needed) {
    planners[layer]?.plan(road, seed, {
      add(spec) {
        const id = items.length;
        items.push({ ...checked(layer, spec), id, layer });
        return id;
      },
    });
  }
  const plan: StructurePlan = { items, cellM: CELL_M, cells: cellsOf(items) };
  let bySeed = registry.get(road);
  if (!bySeed) registry.set(road, (bySeed = new Map<number, StructurePlan>()));
  bySeed.set(seed, plan);
  return plan;
}

/** Loads the planners a network needs (lazy chunks) and plans it: what the app awaits before a race starts. */
export async function ensureStructures(
  road: RoadNetwork,
  seed: number,
  layers: Readonly<Record<string, StructureLayerSpec>> = STRUCTURE_LAYERS,
): Promise<StructurePlan> {
  const known = structuresOf(road, seed);
  if (known) return known;
  const needed = structureLayersFor(road, layers);
  const loaded = await Promise.all(
    needed.map((name): Promise<StructurePlanner | undefined> => {
      const spec = layers[name];
      return spec ? spec.load() : Promise.resolve(undefined);
    }),
  );
  const planners: Record<string, StructurePlanner | undefined> = {};
  needed.forEach((name, i) => (planners[name] = loaded[i]));
  return planStructures(road, seed, planners, layers);
}

/**
 * The plan the sim reads: the kept one, or the empty plan for a network that needs no layer. A network that needs
 * layers and has not been planned throws: the race waits for its world rather than ride with a piece missing.
 */
export function requireStructures(
  road: RoadNetwork,
  seed: number,
  layers: Readonly<Record<string, StructureLayerSpec>> = STRUCTURE_LAYERS,
): StructurePlan {
  const known = structuresOf(road, seed);
  if (known) return known;
  const needed = structureLayersFor(road, layers);
  if (needed.length === 0) return EMPTY;
  throw new Error(
    `structures: network ${road.id} at seed ${seed} is not planned (layers ${needed.join(', ')}); ensureStructures first`,
  );
}
