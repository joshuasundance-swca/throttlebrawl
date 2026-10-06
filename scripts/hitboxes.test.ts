// The hitbox audit (playtest 4, the maintainer, 2026-10-05: "I'd like all hitboxes on everything to
// make sense"): every collidable thing's sim box against the footprint of what is drawn for it, so a
// hit happens where it looks like it should. Never a box noticeably bigger than the drawn shape (no
// invisible berth round a truck), never noticeably smaller (no rider visibly inside a car).
//
// It lives under scripts/ because it reads both sides, the sim's own constants and the render's
// shapes, which no module may import together (docs/architecture.md, module map). The comparison is
// the drawn shape's bounding footprint in the thing's own frame (length along its heading, width
// across) against its sim box, side by side: each end and each side may differ by at most
// TOLERANCE_M. Parts a rider cannot touch are left out of a footprint: anything wholly above a
// rider's head (an umbrella, an awning) and wire-thin lines (a dog's lead).
//
// The table: HITBOX_TABLE=1 npx vitest run --project unit scripts/hitboxes.test.ts prints it.
import { readdirSync, readFileSync } from 'node:fs';
import { Box3, BufferGeometry, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HITBOX,
  HAZARD_OBJECT_HEIGHT_M,
  HEIGHT_TOLERANCE_M,
  hazardHeightM,
  hitboxOf,
  SET_PIECE_PROP_HEIGHT_M,
  SMASHABLE_HEIGHT_M,
  SMASHABLE_KINDS,
  TRAFFIC_HEIGHT_DEFAULT_M,
  trafficHeightM,
  type Hitbox,
  type SimTrafficTypeDef,
} from '../src/sim/api';
import { RIDER_CONTACT_HALF_WIDTH_M, RIDER_HALF_LENGTH_M } from '../src/sim/riders/contact';
import { FURNITURE, FURNITURE_KINDS, type FurnitureFoot, type FurnitureKind } from '../src/road';
import { HAZARD_REACH_D_M, LIGHT_HAZARD_OBJECTS } from '../src/sim/riders/features';
import { BIKE_RADIUS_M, BIKE_SPINE_HALF_M } from '../src/sim/riders/furniture';
import { MOVING } from '../src/sim/modifiers/moving';
import { extent, SET_PIECE } from '../src/sim/modifiers/setpieces';
import { PEDS } from '../src/sim/peds';
import { KIND_SPEC, SMASH } from '../src/sim/smash';
import { TRAFFIC } from '../src/sim/traffic';
import { partsFor, READ_SCALE } from '../src/render/event-props';
import {
  critterHeightM,
  FIGURE_HEIGHT_M,
  FIGURE_PARTS,
  oddityFigureFor,
  pedFigureFor,
} from '../src/render/figures';
import { mergeBoxes, type BoxPart } from '../src/render/geometry';
import { readGlb } from '../src/render/glb';
import type { ModelKind } from '../src/render/models';
import { bakeRepoModel } from '../src/render/model-files.test-util';
import { solidHazardModel } from '../src/render/pnw-places';
import { riderLookOf } from '../src/render/rider-looks';
import { bakePart, RIDER_BOX_M } from '../src/render/riders/bake';
import { BARRIER_OUT_M } from '../src/render/road-mesh';
import { smashableParts } from '../src/render/smashables';
import {
  ANIMAL_HEIGHT_M,
  isAnimalFigure,
  peopleFigureFor,
  TRAFFIC_FIGURE_HEIGHT_M,
  TRAFFIC_FIGURE_PARTS,
  trafficFigureFor,
} from '../src/render/traffic-figures';
import { RAILING_OUT_M } from '../src/render/verge';
import { bench as waterfrontBench, lamp as waterfrontLamp } from '../src/render/waterfront';
import { bakeVehicle, trafficModelRows } from '../src/render/vehicles';
import {
  CAR_PARTS,
  fitUnitFootprint,
  PED_PARTS,
  SHAPE_HEIGHT,
  shapeFor,
  TRUCK_PARTS,
} from '../src/render/views';

/** How far a drawn end or side may sit from its sim box's, m (the lane brief: "say 0.15 m per side"). */
const TOLERANCE_M = 0.15;
/**
 * The known exceptions, each with its reason and the most it may miss by, m. Every one waits on a
 * change bigger than a size: listed here so the table names them and they cannot grow unseen.
 */
const EXCEPTIONS: Readonly<Record<string, { upToM: number; why: string }>> = {
  'ramp trucks: staging-truck-west (osm-sm-old-road-back)': {
    upToM: 0.45,
    why: 'a 6 m wide staging truck: the ramp is drawn exactly the sim ramp, and the model trailer is 13% wider than its ramp (0.14 m a side on a 2 m truck, 0.41 m on a 6 m one)',
  },
  'ramp trucks: staging-truck-east (osm-sm-old-road)': {
    upToM: 0.45,
    why: 'as staging-truck-west',
  },
};
/**
 * The known height exceptions, each with its reason and the most it may miss by, m. The sim already
 * reads a solid hazard's `heightM` (sim/riders `hazardTop`), so correcting these two is a sim change
 * (a rider flying 2.05 to 2.4 m up clears the bear and the pile): the sim lane makes it with the
 * contact work, and takes them off this list.
 */
const HEIGHT_EXCEPTIONS: Readonly<Record<string, { upToM: number; why: string }>> = {
  'solid road hazards: bear (pnw-espresso-row, 1.10 x 1.10 m)': {
    upToM: 0.3,
    why: 'the file says 2.3 m, the carved bear stands 2.03 m (pnw-places.ts)',
  },
  'solid road hazards: log-pile (pnw-logging-spur, 28.00 x 3.80 m)': {
    upToM: 0.4,
    why: 'the file says 2.4 m, the pile is drawn 2.05 m high (pnw-places.ts)',
  },
};
const heightLimit = (r: Pick<Row, 'group' | 'thing'>): number =>
  HEIGHT_EXCEPTIONS[keyOf(r)]?.upToM ?? HEIGHT_TOLERANCE_M;
/** How far a sim height is from the drawn one, m. */
const heightGap = (r: Pick<Row, 'heights'>): number =>
  r.heights ? Math.abs(r.heights.sim - r.heights.drawn) : 0;
/**
 * Solid hazards with no model of their own: an invisible box standing in a landmark's drawing.
 */
const HAZARD_DRAWN_BY_LANDMARK: Readonly<Record<string, string>> = {
  'gate-post': 'the Dragon Gate pillars, drawn by the landmark model sf-landmarks#sf_dragon_gate',
};
const keyOf = (r: Pick<Row, 'group' | 'thing'>) => `${r.group}: ${r.thing}`;
const limitOf = (r: Pick<Row, 'group' | 'thing'>) => EXCEPTIONS[keyOf(r)]?.upToM ?? TOLERANCE_M;
/**
 * A part wholly above this is over a rider's head, m: a seated rider's helmet tops out near 1.8 m
 * (the tumble's rider box is 1.6 m tall), and 2.0 keeps an elk's head (1.8 m up) in
 * while leaving out a café umbrella (2.1 m up) and a coffee cart's awning (2.3 m).
 */
const OVERHEAD_M = 2.0;
/** A part thinner than this in two of its three sizes is a line (a lead, a wire), m. */
const WIRE_M = 0.05;
/**
 * A smashable part that reaches above this is a pole, a banner or a canopy over the thing, not the
 * thing, m: just over a seated rider's head (1.8 m). The café table's umbrella and the pop-up desk's
 * banner pole stand over their furniture; the firewood stand's sign board tops out at 2.005 m.
 */
const CANOPY_TOP_M = 1.95;
const PACKS = ['base', 'region-pnw', 'region-sf'] as const;

/** A footprint in a thing's own frame: z along its heading (front at -z), x across. */
interface Foot {
  z0: number;
  z1: number;
  x0: number;
  x1: number;
}
interface Row {
  group: string;
  thing: string;
  /** What touching it does to a rider. */
  outcome: string;
  /** The sim box: length along, width across, centred on the thing. */
  simL: number;
  simW: number;
  drawn: Foot;
  how: string;
  /** The sim's height for it and the drawn one, m, where it has one (the height contract). */
  heights?: { sim: number; drawn: number };
}

/** The largest gap between a drawn end or side and the sim box's, m (0 when they agree). */
function worst(r: Pick<Row, 'simL' | 'simW' | 'drawn'>): number {
  const { z0, z1, x0, x1 } = r.drawn;
  return Math.max(
    Math.abs(z0 + r.simL / 2),
    Math.abs(z1 - r.simL / 2),
    Math.abs(x0 + r.simW / 2),
    Math.abs(x1 - r.simW / 2),
  );
}

function footOf(box: Box3): Foot {
  return { z0: box.min.z, z1: box.max.z, x0: box.min.x, x1: box.max.x };
}

/** The footprint of box parts scaled per axis, leaving out overhead parts and wires. */
function partsFoot(parts: readonly BoxPart[], scale: readonly [number, number, number] = [1, 1, 1]): Foot {
  const all = new Box3();
  const m = new Matrix4().makeScale(scale[0], scale[1], scale[2]);
  for (const p of parts) {
    const g = mergeBoxes([p]);
    g.applyMatrix4(m);
    g.computeBoundingBox();
    const b = g.boundingBox as Box3;
    // Thin by the box's own sizes, before any turn (a lead held at a slant is still a lead).
    const own = [p.size[0] * scale[0], p.size[1] * scale[1], p.size[2] * scale[2]];
    const thin = own.filter((v) => v < WIRE_M).length >= 2;
    if (b.min.y >= OVERHEAD_M || thin) continue;
    all.union(b);
  }
  return footOf(all);
}

/** The footprint of a geometry's vertices below a rider's head, turned `turn` about y first. */
function geometryFoot(g: BufferGeometry, turn = 0, scale = 1): Foot {
  const pos = g.getAttribute('position');
  const box = new Box3();
  const v = new Vector3();
  const r = new Matrix4().makeRotationY(turn).scale(new Vector3(scale, scale, scale));
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(r);
    if (v.y < OVERHEAD_M) box.expandByPoint(v);
  }
  return footOf(box);
}

/**
 * The top of box parts, m, each scaled in y by `k` (a unit figure's instance scale). Wires are left
 * out, and so is any part that reaches above `canopyM` (a pole, a banner or an umbrella over a
 * thing, not the thing); a vehicle leaves nothing out, because everything on a truck is the truck.
 */
function partsTop(parts: readonly BoxPart[], k = 1, canopyM = Infinity): number {
  let top = 0;
  for (const p of parts) {
    if (p.size.filter((v) => v < WIRE_M).length >= 2) continue;
    const g = mergeBoxes([p]);
    g.computeBoundingBox();
    const b = g.boundingBox as Box3;
    if (b.max.y * k > canopyM) continue;
    top = Math.max(top, b.max.y * k);
  }
  return top;
}

/** The height of box parts from their lowest point to their highest, m (a log rolls about its middle). */
function partsSpan(parts: readonly BoxPart[]): number {
  const g = mergeBoxes(parts);
  g.computeBoundingBox();
  const b = g.boundingBox as Box3;
  return b.max.y - b.min.y;
}

/** The top of a geometry's vertices, m, scaled in y by `k`. */
function geometryTop(g: BufferGeometry, k = 1): number {
  g.computeBoundingBox();
  return (g.boundingBox as Box3).max.y * k;
}

function fileBuffer(path: string): ArrayBuffer {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

function jsonFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => `${dir}/${f}`);
  } catch {
    return [];
  }
}

// ---- the things ------------------------------------------------------------------------------

interface PackType extends Pick<SimTrafficTypeDef, 'category' | 'hazard' | 'lengthM' | 'widthM'> {
  contentId: string;
  /** The file's `heightM`, where it gives one (the height contract). */
  heightM?: number;
  /** The sidewalk lane's roadside class (`behaviour.roadside`), where the pack gives one. */
  roadside?: string;
}

function packTypes(): PackType[] {
  const out: PackType[] = [];
  for (const pack of PACKS)
    for (const f of jsonFiles(`packs/${pack}/traffic`)) {
      const t = JSON.parse(readFileSync(f, 'utf8')) as Omit<PackType, 'contentId' | 'roadside'> & {
        type: string;
        id: string;
        behaviour?: { roadside?: unknown };
      };
      const roadside = t.behaviour?.roadside;
      if (t.type !== 'traffic-type') continue;
      out.push({
        contentId: `${pack}:${t.id}`,
        category: t.category,
        hazard: t.hazard,
        lengthM: t.lengthM,
        widthM: t.widthM,
        ...(typeof t.heightM === 'number' ? { heightM: t.heightM } : {}),
        ...(typeof roadside === 'string' ? { roadside } : {}),
      });
    }
  return out;
}

/** What touching a traffic type does to a rider (sim/traffic contacts, sim/peds react). */
function trafficOutcome(t: PackType): string {
  // The roadside class decides it where a pack gives one (docs/content-packs.md, roadside classes).
  // The one rule for heavy things (playtest 4, #552 and "solid but forgiving"): the closing speed along
  // the contact's normal, a crash from `traffic.solidHitMps`, a graze or a slower hit a wobble.
  const rule = `closing speed: a crash from ${TRAFFIC.solidHitMps} m/s, else a wobble`;
  if (t.roadside === 'dodges') return 'none (dodges: gets out of the way)';
  if (t.roadside === 'yields') return `gets out of the way; if hit, ${rule}`;
  if (t.roadside === 'solid') return rule;
  const walker = t.category === 'pedestrian' || t.category === 'animal';
  if (walker) return t.hazard === 'big' ? `if hit, ${rule}` : 'none (it dives aside)';
  return rule;
}

/**
 * A unit figure's footprint after views.ts fits it into its unit box: the fit is worked out on the
 * whole merged figure, as the render does, and the same per-axis scale and shift moved onto the
 * footprint (which leaves out overhead parts and wires).
 */
function fittedUnit(parts: readonly BoxPart[], scale: readonly [number, number, number]): Foot {
  const g = mergeBoxes(parts);
  g.computeBoundingBox();
  const was = (g.boundingBox as Box3).clone();
  fitUnitFootprint(g);
  const now = g.boundingBox as Box3;
  const axis = (lo0: number, hi0: number, lo1: number, hi1: number) => {
    const k = (hi1 - lo1) / Math.max(1e-9, hi0 - lo0);
    return (v: number) => lo1 + (v - lo0) * k;
  };
  const fx = axis(was.min.x, was.max.x, now.min.x, now.max.x);
  const fz = axis(was.min.z, was.max.z, now.min.z, now.max.z);
  // The footprint is found in metres (a wire and a head height are metres), then put back in units.
  const m = partsFoot(parts, scale);
  const [w, , l] = scale;
  return { z0: fz(m.z0 / l), z1: fz(m.z1 / l), x0: fx(m.x0 / w), x1: fx(m.x1 / w) };
}

const CAR_W = 1.04; // views.ts CAR_PARTS and TRUCK_PARTS: the wheels stand 2% out each side.

/**
 * The footprint a traffic type draws with, in metres, the way views.ts picks its shape: a Blender
 * model scaled to the type's box, else a regional figure, an oddity figure, or the car or truck box
 * (vehicles); a person figure at its own size, or an animal figure scaled to the type (pedestrians).
 */
function trafficRows(): Row[] {
  const files: Record<string, unknown> = {};
  for (const pack of PACKS)
    files[pack] = JSON.parse(readFileSync(`packs/${pack}/assets/traffic-models.json`, 'utf8'));
  const models = trafficModelRows(files);
  const rows: Row[] = [];
  for (const t of packTypes()) {
    const def = t as unknown as SimTrafficTypeDef;
    const walker = t.category === 'pedestrian' || t.category === 'animal';
    // A scaled figure is fitted into its unit box first, as views.ts does (fitUnitFootprint).
    const unit = (parts: readonly BoxPart[], heightM: number) => {
      const f = fittedUnit(parts, [t.widthM, heightM, t.lengthM]);
      return { z0: f.z0 * t.lengthM, z1: f.z1 * t.lengthM, x0: f.x0 * t.widthM, x1: f.x1 * t.widthM };
    };
    let drawn: Foot;
    let how: string;
    let drawnH: number;
    const model = models.get(t.contentId)?.models[0];
    const fig = trafficFigureFor(t.contentId);
    const odd = oddityFigureFor(t.contentId);
    if (!walker && model) {
      const pack = PACKS.find((p) => {
        try {
          readFileSync(`packs/${p}/assets/${model}.glb`);
          return true;
        } catch {
          return false;
        }
      });
      const v = bakeVehicle(model, readGlb(fileBuffer(`packs/${pack}/assets/${model}.glb`)));
      const s = new Matrix4().makeScale(t.widthM / v.widthM, 1, t.lengthM / v.lengthM);
      const g = v.geometry.clone().applyMatrix4(s);
      drawn = geometryFoot(g);
      // views.ts: the model's height follows its width scale (a shorter truck is not a lower one).
      drawnH = geometryTop(v.geometry, t.widthM / v.widthM);
      how = `model ${model}`;
    } else if (!walker && fig) {
      drawn = unit(TRAFFIC_FIGURE_PARTS[fig], TRAFFIC_FIGURE_HEIGHT_M[fig]);
      drawnH = partsTop(TRAFFIC_FIGURE_PARTS[fig], TRAFFIC_FIGURE_HEIGHT_M[fig]);
      how = `figure ${fig}`;
    } else if (!walker && odd) {
      drawn = unit(FIGURE_PARTS[odd], FIGURE_HEIGHT_M[odd]);
      drawnH = partsTop(FIGURE_PARTS[odd], FIGURE_HEIGHT_M[odd]);
      how = `figure ${odd}`;
    } else if (!walker) {
      drawn = {
        z0: -t.lengthM / 2,
        z1: t.lengthM / 2,
        x0: (-t.widthM * CAR_W) / 2,
        x1: (t.widthM * CAR_W) / 2,
      };
      const shape = shapeFor(def, t.contentId);
      drawnH = partsTop(shape === 'truck' ? TRUCK_PARTS : CAR_PARTS, SHAPE_HEIGHT[shape]);
      how = 'car or truck box';
    } else {
      const people = peopleFigureFor(def, t.contentId, null);
      if (people && isAnimalFigure(people)) {
        drawn = unit(TRAFFIC_FIGURE_PARTS[people], ANIMAL_HEIGHT_M[people]);
        drawnH = partsTop(TRAFFIC_FIGURE_PARTS[people], ANIMAL_HEIGHT_M[people]);
        how = `figure ${people}`;
      } else if (people) {
        drawn = partsFoot(TRAFFIC_FIGURE_PARTS[people]);
        drawnH = partsTop(TRAFFIC_FIGURE_PARTS[people]);
        how = `figure ${people} (own size)`;
      } else {
        const ped = pedFigureFor(def, t.contentId);
        if (ped === 'person') {
          // views.ts PED_PARTS: the shirt is the widest (0.44 m), the hat the deepest (0.4 m).
          drawn = { z0: -0.2, z1: 0.2, x0: -0.22, x1: 0.22 };
          drawnH = partsTop(PED_PARTS);
          how = 'figure person (own size)';
        } else {
          const figH = ped === 'critter' ? critterHeightM(t.lengthM) : FIGURE_HEIGHT_M[ped];
          drawn = unit(FIGURE_PARTS[ped], figH);
          drawnH = partsTop(FIGURE_PARTS[ped], figH);
          how = `figure ${ped}`;
        }
      }
    }
    rows.push({
      group: walker ? 'pedestrians and animals' : 'traffic',
      thing: t.contentId,
      outcome: trafficOutcome(t),
      simL: t.lengthM,
      simW: t.widthM,
      drawn,
      how,
      heights: { sim: trafficHeightM(t), drawn: drawnH },
    });
  }
  return rows;
}

/** The files of one folder of a pack, parsed. */
function packFiles<T>(pack: string, folder: string): T[] {
  return jsonFiles(`packs/${pack}/${folder}`).map((f) => JSON.parse(readFileSync(f, 'utf8')) as T);
}

interface BikeFile {
  id: string;
  hitbox?: Hitbox;
}
interface RiderFile {
  id: string;
  role: string;
  bike: string;
  hitbox?: Hitbox;
  look?: unknown;
}

/**
 * Who rides each bike model, and in which contact box: the player on each bike file's own model
 * (the garage draws the model named like the bike), and every rider on the model its `look` names
 * (render's `riderLookOf`, the render's own choice), in the box its file gives, else its sim bike's,
 * else the default (`hitboxOf`). A model nobody rides keeps the default box, so it is still checked.
 */
function bikeOwners(): { model: string; box: Hitbox; owners: string[] }[] {
  const bikes = new Map<string, BikeFile>();
  const found = new Map<string, { model: string; box: Hitbox; owners: string[] }>();
  const add = (model: string, box: Hitbox, owner: string) => {
    const key = `${model}|${box.lengthM}x${box.widthM}`;
    const row = found.get(key) ?? { model, box, owners: [] };
    row.owners.push(owner);
    found.set(key, row);
  };
  for (const pack of PACKS)
    for (const b of packFiles<BikeFile>(pack, 'bikes')) {
      bikes.set(`${pack}:${b.id}`, b);
      add(b.id, hitboxOf(undefined, b.hitbox), `player on ${pack}:${b.id}`);
    }
  for (const pack of PACKS)
    for (const r of packFiles<RiderFile>(pack, 'riders')) {
      if (r.role === 'player-preset') continue;
      const bikeId = r.bike.includes(':') ? r.bike : `${pack}:${r.bike}`;
      const look = riderLookOf({
        contentId: `${pack}:${r.id}`,
        role: r.role === 'cop' ? 'cop' : r.role === 'extra' ? 'extra' : 'rival',
        bikeId,
        look: r.look,
      });
      add(
        look.bikeModel.replace(/^models\/bikes\//, ''),
        hitboxOf(r.hitbox, bikes.get(bikeId)?.hitbox),
        `${pack}:${r.id}`,
      );
    }
  // Every bike model is a row, ridden or not.
  for (const pack of PACKS)
    for (const f of jsonOrGlb(`packs/${pack}/assets/models/bikes`)) {
      const model = f.replace(/\.glb$/, '');
      if (![...found.values()].some((v) => v.model === model))
        add(model, DEFAULT_HITBOX, 'nobody (default box)');
    }
  return [...found.values()];
}

function jsonOrGlb(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.glb'));
  } catch {
    return [];
  }
}

/** Every bike model a rider rides, as baked (bake.ts fits it to the default box unless a file gives its own). */
function bikeRows(): Row[] {
  const rows: Row[] = [];
  for (const { model, box: hitbox, owners } of bikeOwners()) {
    const pack = PACKS.find((p) => jsonOrGlb(`packs/${p}/assets/models/bikes`).includes(`${model}.glb`));
    if (!pack) continue;
    const part = bakePart(readGlb(fileBuffer(`packs/${pack}/assets/models/bikes/${model}.glb`)), 'bike');
    const box = new Box3();
    const v = new Vector3();
    for (let i = 0; i + 2 < part.positions.length; i += 3) box.expandByPoint(v.fromArray(part.positions, i));
    rows.push({
      group: 'riders on bikes',
      thing: `${model} (${hitbox.lengthM} x ${hitbox.widthM} box: ${owners.join(', ')})`,
      outcome: 'rider vs rider: a shove; vs traffic, props: as theirs',
      simL: hitbox.lengthM,
      simW: hitbox.widthM,
      drawn: footOf(box),
      how: 'bike model (the rider on it not measured: rider models live in the dataset)',
    });
  }
  return rows;
}

/** Roadside smashables: the sim's box (x along the road, z across: they face the road) vs the parts. */
function smashRows(): Row[] {
  return SMASHABLE_KINDS.map((kind) => {
    const k = KIND_SPEC[kind];
    const f = partsFoot(smashableParts(kind));
    return {
      group: 'smashables',
      thing: kind,
      outcome: 'wobble and scrub (a crash when knocked into it)',
      simL: 2 * k.halfAlong,
      simW: 2 * k.halfAcross,
      // The model's x runs along the road.
      drawn: { z0: f.x0, z1: f.x1, x0: f.z0, x1: f.z1 },
      how: 'render/smashables.ts parts',
      // An umbrella or a banner over the thing is a canopy, not the thing (CANOPY_TOP_M).
      heights: { sim: SMASHABLE_HEIGHT_M[kind], drawn: partsTop(smashableParts(kind), 1, CANOPY_TOP_M) },
    };
  });
}

/** Set-piece props riders run through: the sim's extent vs the parts at their read-at-speed scale. */
function propRows(): Row[] {
  const rows: Row[] = [];
  for (const kind of ['cone', 'flare', 'barricade', 'hayBale'] as const) {
    const [hu, hd] = extent(kind);
    const k = READ_SCALE[kind] ?? 1;
    let f = partsFoot(partsFor(kind), [k, k, k]);
    if (kind === 'flare') {
      // The glow is what a rider sees of a flare; it is drawn round the stick at its own scale.
      const g = READ_SCALE['flareGlow'] ?? 1;
      const glow = partsFoot(partsFor('flareGlow'), [g, g, g]);
      f = {
        z0: Math.min(f.z0, glow.z0),
        z1: Math.max(f.z1, glow.z1),
        x0: Math.min(f.x0, glow.x0),
        x1: Math.max(f.x1, glow.x1),
      };
    }
    rows.push({
      group: 'set-piece props',
      thing: kind,
      outcome: kind === 'cone' || kind === 'flare' ? 'scrub only' : 'wobble and scrub',
      simL: 2 * hu,
      simW: 2 * hd,
      drawn: f,
      how: 'render/event-props.ts parts x READ_SCALE',
      heights: {
        sim: SET_PIECE_PROP_HEIGHT_M[kind],
        drawn: Math.max(
          partsTop(partsFor(kind), k),
          kind === 'flare' ? partsTop(partsFor('flareGlow'), READ_SCALE['flareGlow'] ?? 1) : 0,
        ),
      },
    });
  }
  const log = partsFoot(partsFor('log'));
  rows.push({
    group: 'set-piece props',
    thing: 'log (rolling off a log truck)',
    outcome: 'crash',
    simL: 2 * MOVING.logHalfDepthM,
    simW: 2 * MOVING.logHalfLenM,
    // A rolling log lies across the road: its length is the model's x.
    drawn: log,
    how: 'render/event-props.ts log',
    heights: { sim: SET_PIECE_PROP_HEIGHT_M.log, drawn: partsSpan(partsFor('log')) },
  });
  return rows;
}

interface Feature {
  kind: string;
  id: string;
  s0: number;
  s1: number;
  d0: number;
  d1: number;
  params?: Record<string, unknown>;
}

function roadFeatures(): { road: string; f: Feature }[] {
  const out: { road: string; f: Feature }[] = [];
  for (const pack of PACKS) {
    let regions: string[];
    try {
      regions = readdirSync(`packs/${pack}/regions`);
    } catch {
      continue;
    }
    for (const region of regions)
      for (const file of jsonFiles(`packs/${pack}/regions/${region}/roads`)) {
        const data = JSON.parse(readFileSync(file, 'utf8')) as { features?: Feature[] };
        for (const f of data.features ?? []) out.push({ road: file.slice(file.lastIndexOf('/') + 1, -5), f });
      }
  }
  return out;
}

/** Solid road hazards: the feature's box (the sim adds the rider's reach) vs the model drawn in it. */
function hazardRows(features: { road: string; f: Feature }[]): Row[] {
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const { road, f } of features) {
    if (f.kind !== 'hazard' || f.params?.['solid'] !== true) continue;
    const object = f.params?.['object'];
    const kind = typeof object === 'string' ? object : '';
    const w = Math.abs(f.d1 - f.d0);
    const len = Math.abs(f.s1 - f.s0);
    const h = Number(f.params?.['heightM'] ?? 1.5);
    // One row per object and size (to the decimetre): the logging spur alone has 93 stumps.
    const key = `${kind}:${w.toFixed(1)}:${len.toFixed(1)}:${h}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // The model's x runs across the road and z along it; the worst turn for a stump is its corner.
    const made = solidHazardModel(kind, { w, len, h, side: 1, v: 0 });
    if (!made) continue;
    const turn = kind === 'bear' ? 0 : made.turn;
    const foot = geometryFoot(made.geometry, turn);
    rows.push({
      group: 'solid road hazards',
      thing: `${kind} (${road}, ${len.toFixed(2)} x ${w.toFixed(2)} m)`,
      outcome: LIGHT_HAZARD_OBJECTS.includes(kind)
        ? 'light: ridden through with a wobble, never a crash'
        : `closing speed: a crash from ${TRAFFIC.solidHitMps} m/s square on, a graze or a side scrape a wobble`,
      simL: len,
      simW: w,
      drawn: foot,
      heights: {
        sim: hazardHeightM(kind, typeof f.params?.['heightM'] === 'number' ? f.params['heightM'] : undefined),
        drawn: geometryTop(made.geometry),
      },
      how:
        kind === 'stump'
          ? 'render/pnw-places.ts (round: the box corners stand past it)'
          : 'render/pnw-places.ts',
    });
  }
  return rows;
}

/** Parked ramp trucks: the feature's box vs the tow-truck model the road scene stands in it. */
async function rampTruckRows(features: { road: string; f: Feature }[]): Promise<Row[]> {
  const truck = await bakeRepoModel('truck');
  const ramp = truck.ramp;
  const g = truck.variants[0];
  if (!ramp || !g) throw new Error('the ramp truck model has no ramp measure');
  g.computeBoundingBox();
  const whole = g.boundingBox as Box3;
  const rows: Row[] = [];
  for (const { road, f } of features) {
    if (f.kind !== 'rampTruck') continue;
    const run = Number(f.params?.['rampLengthM'] ?? 11.5);
    const sx = Math.abs(f.d1 - f.d0) / ramp.widthM;
    const sz = run / ramp.runM;
    const len = Math.abs(f.s1 - f.s0);
    const w = Math.abs(f.d1 - f.d0);
    // The model's foot is at the feature's s0 and it runs +z; centre both on the box's middle.
    rows.push({
      group: 'ramp trucks',
      thing: `${f.id} (${road})`,
      outcome: 'ride the ramp; the body past the lip: crash, its sides: a scrape',
      simL: len,
      simW: w,
      drawn: {
        z0: whole.min.z * sz - len / 2,
        z1: whole.max.z * sz - len / 2,
        x0: whole.min.x * sx,
        x1: whole.max.x * sx,
      },
      how: 'tow-truck model, scaled as road-mesh.ts rampTruckMatrix',
    });
  }
  return rows;
}

/** The moving car carrier: its deck (the type's box) vs the lowered ramp drawn over it. */
function carrierRows(): Row[] {
  const types = packTypes().filter((t) => /car-carrier/.test(t.contentId));
  const up = new Set(TRAFFIC_FIGURE_PARTS.carCarrier.map((p) => JSON.stringify(p)));
  const rampOnly = TRAFFIC_FIGURE_PARTS.carCarrierRamp.filter((p) => !up.has(JSON.stringify(p)));
  return types.map((t) => {
    const f = partsFoot(rampOnly, [t.widthM, TRAFFIC_FIGURE_HEIGHT_M.carCarrierRamp, t.lengthM]);
    return {
      group: 'moving ramp truck',
      thing: `${t.contentId} ramp (the rear ${MOVING.rampRunM} m)`,
      outcome: 'ride the ramp up to the lip',
      simL: MOVING.rampRunM,
      simW: t.widthM,
      // Along, the slab's top runs the sim's run by construction (traffic-figures.ts CARRIER_RUN_M);
      // its bounds add the tilted slab's thickness, so only its width is compared.
      drawn: { ...f, z0: -MOVING.rampRunM / 2, z1: MOVING.rampRunM / 2 },
      how: 'figure carCarrierRamp (the ramp slab: its width)',
    };
  });
}

/**
 * The cross-section of a geometry over the heights `hs`: where its triangles cross each height, as a
 * footprint (a pole drawn as a cylinder has vertices only at its ends, so its vertices alone would
 * miss it). The street furniture's footprint is taken this way, from 0.1 m to its solid top or 1.95 m:
 * a tree pit's grate is under the wheels, a lamp's arm and a tree's crown over a rider's head.
 */
function sliceFoot(g: BufferGeometry, hs: readonly number[]): Foot {
  const pos = g.getAttribute('position');
  const index = g.getIndex();
  const n = index ? index.count : pos.count;
  const at = (i: number) => new Vector3().fromBufferAttribute(pos, index ? index.getX(i) : i);
  const box = new Box3();
  for (let t = 0; t + 2 < n; t += 3) {
    const tri = [at(t), at(t + 1), at(t + 2)] as const;
    for (const h of hs)
      for (const [p, q] of [
        [tri[0], tri[1]],
        [tri[1], tri[2]],
        [tri[2], tri[0]],
      ] as const) {
        if ((p.y - h) * (q.y - h) > 0 || p.y === q.y) continue;
        const k = (h - p.y) / (q.y - p.y);
        box.expandByPoint(new Vector3(p.x + (q.x - p.x) * k, h, p.z + (q.z - p.z) * k));
      }
  }
  return footOf(box);
}

/** The heights a street piece's footprint is taken over (`sliceFoot`). */
const sliceHeights = (topM: number) => [0.1, 0.25, 0.5, 0.8, 1.1, 1.4, 1.7, 1.95].filter((h) => h <= topM);

/** Where each piece of street furniture is drawn from: a model's variants, or a waterfront shape. */
const FURNITURE_DRAWN: Readonly<
  Record<FurnitureKind, { model: ModelKind; variants: readonly number[] } | 'lamp' | 'bench'>
> = {
  'street-tree': { model: 'sfRoadside', variants: [3] },
  board: { model: 'sfRoadside', variants: [6, 7, 8] },
  lamp: { model: 'sfRoadside', variants: [12] },
  meter: { model: 'sfRoadside', variants: [10] },
  bins: { model: 'sfRoadside', variants: [11] },
  hydrant: { model: 'sfRoadside', variants: [4] },
  scooter: { model: 'sfRoadside', variants: [5] },
  'planter-palm': { model: 'duvalKit', variants: [7] },
  'scooter-rack': { model: 'duvalKit', variants: [6] },
  frangipani: { model: 'keysIdentity', variants: [5] },
  'dt-lamp': { model: 'sfDowntown', variants: [7] },
  'dt-signal': { model: 'sfDowntown', variants: [8] },
  'dt-planter': { model: 'sfDowntown', variants: [9] },
  'dt-bench': { model: 'sfDowntown', variants: [10] },
  'dt-orb': { model: 'sfDowntown', variants: [11] },
  palm: { model: 'palms', variants: [0, 1, 2] },
  'wf-lamp': 'lamp',
  'wf-bench': 'bench',
  'parked-car': { model: 'sfRoadside', variants: [0, 1, 2] },
};

/**
 * Street furniture (playtest 4, "solid but forgiving"; road/furniture.ts): each kind's sim footprint (a
 * circle or a box round its own centre, in the model's frame) vs the drawn model's cross-section, centred
 * the same way. The model's z runs along the sim box's length here, its x across.
 */
async function furnitureRows(): Promise<Row[]> {
  const rows: Row[] = [];
  const models = new Map<ModelKind, Awaited<ReturnType<typeof bakeRepoModel>>>();
  for (const kind of FURNITURE_KINDS) {
    const spec = FURNITURE[kind];
    const drawn = FURNITURE_DRAWN[kind];
    const feet: readonly FurnitureFoot[] = spec.foot;
    const geometries: { v: number; g: BufferGeometry }[] = [];
    if (drawn === 'lamp') geometries.push({ v: 0, g: waterfrontLamp().geometry() });
    else if (drawn === 'bench') geometries.push({ v: 0, g: waterfrontBench().geometry() });
    else {
      let model = models.get(drawn.model);
      if (!model) models.set(drawn.model, (model = await bakeRepoModel(drawn.model)));
      for (const v of drawn.variants) {
        const g = model.variants[v];
        if (!g) throw new Error(`${drawn.model} has no variant ${v}`);
        geometries.push({ v, g });
      }
    }
    for (const { v, g } of geometries) {
      const foot = feet[Math.min(v, feet.length - 1)] ?? feet[0] ?? {};
      const cx = foot.cx ?? 0;
      const cz = foot.cz ?? 0;
      const f = sliceFoot(g, sliceHeights(spec.heightM));
      const hx = foot.r ?? foot.hx ?? 0;
      const hz = foot.r ?? foot.hz ?? 0;
      rows.push({
        group: 'street furniture',
        thing: `${kind}${geometries.length > 1 ? ` (variant ${v})` : ''}`,
        outcome:
          spec.cls === 'solid'
            ? `solid: closing speed, a crash from ${TRAFFIC.solidHitMps} m/s square on, a graze or side a wobble`
            : 'light: ridden through with a wobble, never a crash',
        simL: 2 * hz,
        simW: 2 * hx,
        drawn: { z0: f.z0 - cz, z1: f.z1 - cz, x0: f.x0 - cx, x1: f.x1 - cx },
        how: `${typeof drawn === 'string' ? `render/waterfront.ts ${drawn}()` : `${drawn.model}[${v}]`}, cross-section ${foot.r !== undefined ? '(a circle: its box)' : ''}`,
      });
    }
  }
  return rows;
}

/** Rails and walls: the sim's line (the lane edge) vs the drawn barrier's inner face. */
function barrierRows(): Row[] {
  // A barrier is a line, not a box: the rows hold a zero-length span along and the across offset.
  const line = (thing: string, face: number, how: string): Row => ({
    group: 'barriers and walls',
    thing,
    outcome: 'held at the line and scraping (a rail lets a tumbling body over)',
    simL: 0,
    simW: 0,
    drawn: { z0: 0, z1: 0, x0: 0, x1: face },
    how,
  });
  return [
    line('rail band and wall', BARRIER_OUT_M, 'road-mesh.ts BARRIER_OUT_M past the lane edge'),
    // The railing's kerb is 0.34 m deep, centred RAILING_OUT_M out.
    line('railing look (bridges)', RAILING_OUT_M - 0.17, 'verge.ts RAILING_OUT_M less the kerb half depth'),
  ];
}

/** Every row, sorted by group (the printed table). */
async function allRows(): Promise<Row[]> {
  const features = roadFeatures();
  return [
    ...trafficRows(),
    ...bikeRows(),
    ...smashRows(),
    ...propRows(),
    ...hazardRows(features),
    ...(await rampTruckRows(features)),
    ...(await furnitureRows()),
    ...carrierRows(),
    ...barrierRows(),
  ];
}

function table(rows: readonly Row[]): string {
  const f = (n: number) => n.toFixed(2);
  const lines = [
    '| group | thing | contact | sim L x W | drawn L x W | drawn centre (along, across) | worst end/side | drawn as |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const d = r.drawn;
    const w = worst(r);
    lines.push(
      `| ${r.group} | ${r.thing} | ${r.outcome} | ${f(r.simL)} x ${f(r.simW)} | ${f(d.z1 - d.z0)} x ${f(d.x1 - d.x0)} | ${f((d.z0 + d.z1) / 2)}, ${f((d.x0 + d.x1) / 2)} | ${f(w)}${w > limitOf(r) ? ' **over**' : EXCEPTIONS[keyOf(r)] ? ' (known: ' + (EXCEPTIONS[keyOf(r)]?.why ?? '') + ')' : ''} | ${r.how} |`,
    );
  }
  return lines.join('\n');
}

function heightTable(rows: readonly Row[]): string {
  const f = (n: number) => n.toFixed(2);
  const lines = ['| group | thing | sim height | drawn height | gap |', '|---|---|---|---|---|'];
  for (const r of rows)
    lines.push(
      `| ${r.group} | ${r.thing} | ${f(r.heights?.sim ?? 0)} | ${f(r.heights?.drawn ?? 0)} | ${f(heightGap(r))}${heightGap(r) > heightLimit(r) ? ' **over**' : heightGap(r) > HEIGHT_TOLERANCE_M ? ' (known)' : ''} |`,
    );
  return lines.join('\n');
}

describe('hitboxes match what is drawn (playtest 4)', () => {
  it('every rider-box constant is the same box, and the bikes are fitted to it', () => {
    const sims = [
      [TRAFFIC.riderLengthM, TRAFFIC.riderWidthM],
      [PEDS.riderLengthM, PEDS.riderWidthM],
      [SET_PIECE.riderLengthM, SET_PIECE.riderWidthM],
      [2 * SMASH.riderHalfLengthM, 2 * SMASH.riderHalfWidthM],
      [2 * RIDER_HALF_LENGTH_M, 2 * RIDER_CONTACT_HALF_WIDTH_M],
      [RIDER_BOX_M.lengthM, RIDER_BOX_M.widthM],
    ];
    for (const s of sims) expect(s).toEqual([2.0, 0.8]);
    expect([DEFAULT_HITBOX.lengthM, DEFAULT_HITBOX.widthM]).toEqual([2.0, 0.8]);
    // The capsule that meets the street furniture and the solid hazards is that box with round ends.
    expect(BIKE_SPINE_HALF_M + BIKE_RADIUS_M).toBe(RIDER_HALF_LENGTH_M);
    expect(BIKE_RADIUS_M).toBe(RIDER_CONTACT_HALF_WIDTH_M);
    // A ramp truck's side holds a rider's centre this far out: the rider's own half width.
    expect(Math.abs(HAZARD_REACH_D_M - RIDER_CONTACT_HALF_WIDTH_M)).toBeLessThanOrEqual(TOLERANCE_M);
  });

  it('every collidable thing is drawn within the tolerance of its sim box, each end and each side', async () => {
    const rows = await allRows();
    if (process.env['HITBOX_TABLE']) console.log(table(rows));
    // The audit found every group (an empty group would pass by finding nothing).
    const groups = new Set(rows.map((r) => r.group));
    expect([...groups].sort()).toEqual(
      [
        'barriers and walls',
        'moving ramp truck',
        'pedestrians and animals',
        'ramp trucks',
        'riders on bikes',
        'set-piece props',
        'smashables',
        'solid road hazards',
        'street furniture',
        'traffic',
      ].sort(),
    );
    expect(rows.length).toBeGreaterThan(100);
    const over = rows.filter((r) => worst(r) > limitOf(r)).map((r) => `${keyOf(r)} ${worst(r).toFixed(2)} m`);
    expect(over).toEqual([]);
    // An exception that no longer misses is taken off the list.
    const keys = new Set(rows.map(keyOf));
    for (const [k] of Object.entries(EXCEPTIONS)) expect(keys.has(k), `${k} is still a row`).toBe(true);
    const healed = rows.filter((r) => EXCEPTIONS[keyOf(r)] && worst(r) <= TOLERANCE_M).map(keyOf);
    expect(healed, 'exceptions within the tolerance now').toEqual([]);
  }, 60_000);

  it('the rule fails a box that is not what is drawn (negative controls)', () => {
    // An invisible berth: a 7.5 x 2.4 truck drawn exactly, in a box 0.4 m wider a side.
    const truck: Foot = { z0: -3.75, z1: 3.75, x0: -1.2, x1: 1.2 };
    expect(worst({ simL: 7.5, simW: 3.2, drawn: truck })).toBeGreaterThan(TOLERANCE_M);
    // Visible clipping: the same truck in a box 0.3 m short at each end.
    expect(worst({ simL: 6.9, simW: 2.4, drawn: truck })).toBeGreaterThan(TOLERANCE_M);
    // The cafe table's old box (0.6 x 0.6 half) against its chairs and table, as drawn.
    const cafe = partsFoot(smashableParts('cafe-table'));
    expect(
      worst({ simL: 1.2, simW: 1.2, drawn: { z0: cafe.x0, z1: cafe.x1, x0: cafe.z0, x1: cafe.z1 } }),
    ).toBeGreaterThan(TOLERANCE_M);
    // The old rail band, drawn 0.55 m past the line the sim holds riders at.
    expect(worst({ simL: 0, simW: 0, drawn: { z0: 0, z1: 0, x0: 0, x1: 0.55 } })).toBeGreaterThan(
      TOLERANCE_M,
    );
    // An unfitted chopper (2.59 m long) against the rider's 2.0 m box.
    expect(
      worst({ simL: 2, simW: 0.8, drawn: { z0: -1.32, z1: 1.27, x0: -0.49, x1: 0.49 } }),
    ).toBeGreaterThan(TOLERANCE_M);
  });

  it('every collidable thing is as tall as it is drawn, within the tolerance', async () => {
    const rows = (await allRows()).filter((r) => r.heights);
    if (process.env['HITBOX_TABLE']) console.log(heightTable(rows));
    // The audit found every group that has a height (an empty group would pass by finding nothing).
    expect([...new Set(rows.map((r) => r.group))].sort()).toEqual(
      ['pedestrians and animals', 'set-piece props', 'smashables', 'solid road hazards', 'traffic'].sort(),
    );
    expect(rows.length).toBeGreaterThan(100);
    const over = rows
      .filter((r) => heightGap(r) > heightLimit(r))
      .map((r) => `${keyOf(r)} ${heightGap(r).toFixed(2)} m`);
    expect(over).toEqual([]);
    // An exception is still a row, and one that no longer misses is taken off the list.
    const keys = new Set(rows.map(keyOf));
    for (const k of Object.keys(HEIGHT_EXCEPTIONS)) expect(keys.has(k), `${k} is still a row`).toBe(true);
    const healed = rows.filter((r) => HEIGHT_EXCEPTIONS[keyOf(r)] && heightGap(r) <= HEIGHT_TOLERANCE_M);
    expect(healed.map(keyOf), 'exceptions within the tolerance now').toEqual([]);
  }, 60_000);

  it('every solid hazard object is drawn by a model the audit measures, or is named here', () => {
    const objects = new Set(
      roadFeatures()
        .filter(({ f }) => f.kind === 'hazard' && f.params?.['solid'] === true)
        .map(({ f }) => String(f.params?.['object'])),
    );
    // A hazard with no model of its own is an invisible box standing in a landmark's drawing.
    const unmodelled = [...objects]
      .filter((o) => solidHazardModel(o, { w: 1, len: 1, h: 1, side: 1, v: 0 }) === null)
      .sort();
    expect(unmodelled).toEqual(Object.keys(HAZARD_DRAWN_BY_LANDMARK).sort());
    for (const o of objects)
      expect(HAZARD_OBJECT_HEIGHT_M[o], `${o} has a default height`).toBeGreaterThan(0);
  });

  it('a region item that gives a smashable its own height keeps it within the tolerance of its kind', () => {
    let items = 0;
    for (const pack of PACKS) {
      let regions: string[];
      try {
        regions = readdirSync(`packs/${pack}/regions`).filter((f) => !f.includes('.'));
      } catch {
        continue;
      }
      for (const region of regions) {
        const r = JSON.parse(readFileSync(`packs/${pack}/regions/${region}/region.json`, 'utf8')) as {
          smashables?: { id: string; kind: (typeof SMASHABLE_KINDS)[number]; heightM?: number }[];
        };
        for (const item of r.smashables ?? []) {
          items++;
          if (item.heightM === undefined) continue;
          const drawn = partsTop(smashableParts(item.kind), 1, CANOPY_TOP_M);
          expect(Math.abs(item.heightM - drawn), `${pack}:${region}#${item.id}`).toBeLessThanOrEqual(
            HEIGHT_TOLERANCE_M,
          );
        }
      }
    }
    expect(items).toBeGreaterThan(0);
  });

  it('a type that omits its height gets its category default, which is the median of the drawn ones', async () => {
    const all = await allRows();
    const categories = new Map<string, number[]>();
    for (const t of packTypes()) {
      const row = all.find((r) => r.thing === t.contentId && r.heights);
      if (!row?.heights) continue;
      categories.set(t.category, [...(categories.get(t.category) ?? []), row.heights.drawn]);
    }
    // Every category the packs ship is checked, and the default table has no other.
    expect([...categories.keys()].sort()).toEqual(Object.keys(TRAFFIC_HEIGHT_DEFAULT_M).sort());
    for (const [category, drawn] of categories) {
      const sorted = [...drawn].sort((a, b) => a - b);
      const mid = sorted.length >> 1;
      const median =
        sorted.length % 2
          ? (sorted[mid] as number)
          : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
      expect(TRAFFIC_HEIGHT_DEFAULT_M[category as keyof typeof TRAFFIC_HEIGHT_DEFAULT_M], category).toBe(
        Math.round(median * 10) / 10,
      );
    }
  });

  it('the height rule fails a height that is not what is drawn (negative controls)', async () => {
    const rows = (await allRows()).filter((r) => r.group === 'traffic' && r.heights);
    // The rule the sim has today: every vehicle is touched below one height (TRAFFIC.maxContactH).
    const flat = rows.filter(
      (r) => Math.abs(TRAFFIC.maxContactH - (r.heights?.drawn ?? 0)) > HEIGHT_TOLERANCE_M,
    );
    expect(flat.map((r) => r.thing)).toContain('base:box-truck');
    expect(flat.map((r) => r.thing)).toContain('region-pnw:log-truck');
    // The tumble's boxes: 1.5 m for a car and 3.2 m for a big hazard (sim/tumble CAR_HEIGHT_M, BIG_HEIGHT_M).
    const tumble = rows.filter((r) => {
      const big = packTypes().find((t) => t.contentId === r.thing)?.hazard === 'big';
      return Math.abs((big ? 3.2 : 1.5) - (r.heights?.drawn ?? 0)) > HEIGHT_TOLERANCE_M;
    });
    expect(tumble.map((r) => r.thing)).toContain('base:pickup-towing-boat');
    // A real row nudged 0.2 m off its drawing is over the line; 0.1 m is not.
    const truck = rows.find((r) => r.thing === 'base:box-truck');
    expect(truck?.heights).toBeDefined();
    const drawn = truck?.heights?.drawn ?? 0;
    expect(heightGap({ heights: { sim: drawn + 0.2, drawn } })).toBeGreaterThan(HEIGHT_TOLERANCE_M);
    expect(heightGap({ heights: { sim: drawn + 0.1, drawn } })).toBeLessThanOrEqual(HEIGHT_TOLERANCE_M);
  });
});
