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
import { SMASHABLE_KINDS, type SimTrafficTypeDef } from '../src/sim/api';
import { RIDER_CONTACT_HALF_WIDTH_M, RIDER_HALF_LENGTH_M } from '../src/sim/riders/contact';
import { HAZARD_REACH_D_M, HAZARD_REACH_S_M } from '../src/sim/riders/features';
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
import { bakeRepoModel } from '../src/render/model-files.test-util';
import { solidHazardModel } from '../src/render/pnw-places';
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
import { bakeVehicle, trafficModelRows } from '../src/render/vehicles';
import { fitUnitFootprint } from '../src/render/views';

/** How far a drawn end or side may sit from its sim box's, m (the lane brief: "say 0.15 m per side"). */
const TOLERANCE_M = 0.15;
/**
 * The known exceptions, each with its reason and the most it may miss by, m. Every one waits on a
 * change bigger than a size: listed here so the table names them and they cannot grow unseen.
 */
const EXCEPTIONS: Readonly<Record<string, { upToM: number; why: string }>> = {
  'riders on bikes: lawnmower': {
    upToM: 0.2,
    why: 'shorter and wider than the shared 2.0 x 0.8 rider box: no one scale fits both; needs a per-bike box (a bike pack field: a contract change)',
  },
  'riders on bikes: parking-trike': {
    upToM: 0.2,
    why: 'as the lawnmower: a trike is wider and shorter than the rider box',
  },
  'ramp trucks: staging-truck-west (osm-sm-old-road-back)': {
    upToM: 0.45,
    why: 'a 6 m wide staging truck: the ramp is drawn exactly the sim ramp, and the model trailer is 13% wider than its ramp (0.14 m a side on a 2 m truck, 0.41 m on a 6 m one)',
  },
  'ramp trucks: staging-truck-east (osm-sm-old-road)': {
    upToM: 0.45,
    why: 'as staging-truck-west',
  },
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
        ...(typeof roadside === 'string' ? { roadside } : {}),
      });
    }
  return out;
}

/** What touching a traffic type does to a rider (sim/traffic contacts, sim/peds react). */
function trafficOutcome(t: PackType): string {
  // The roadside class decides it where a pack gives one (docs/content-packs.md, roadside classes).
  if (t.roadside === 'dodges') return 'none (dodges: gets out of the way)';
  if (t.roadside === 'yields') return 'crash if hit (yields)';
  if (t.roadside === 'solid') return 'crash (solid: does not move)';
  const walker = t.category === 'pedestrian' || t.category === 'animal';
  if (walker) return t.hazard === 'big' ? 'crash' : 'none (it dives aside)';
  // Today's traffic rule (sim/traffic contacts): a big vehicle crashes on any touch; the rest wobble,
  // or crash end-on at `traffic.solidHitMps` closing or more.
  return t.hazard === 'big' ? 'crash' : `wobble (crash end-on at ${TRAFFIC.solidHitMps} m/s+)`;
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
      how = `model ${model}`;
    } else if (!walker && fig) {
      drawn = unit(TRAFFIC_FIGURE_PARTS[fig], TRAFFIC_FIGURE_HEIGHT_M[fig]);
      how = `figure ${fig}`;
    } else if (!walker && odd) {
      drawn = unit(FIGURE_PARTS[odd], FIGURE_HEIGHT_M[odd]);
      how = `figure ${odd}`;
    } else if (!walker) {
      drawn = {
        z0: -t.lengthM / 2,
        z1: t.lengthM / 2,
        x0: (-t.widthM * CAR_W) / 2,
        x1: (t.widthM * CAR_W) / 2,
      };
      how = 'car or truck box';
    } else {
      const people = peopleFigureFor(def, t.contentId, null);
      if (people && isAnimalFigure(people)) {
        drawn = unit(TRAFFIC_FIGURE_PARTS[people], ANIMAL_HEIGHT_M[people]);
        how = `figure ${people}`;
      } else if (people) {
        drawn = partsFoot(TRAFFIC_FIGURE_PARTS[people]);
        how = `figure ${people} (own size)`;
      } else {
        const ped = pedFigureFor(def, t.contentId);
        if (ped === 'person') {
          // views.ts PED_PARTS: the shirt is the widest (0.44 m), the hat the deepest (0.4 m).
          drawn = { z0: -0.2, z1: 0.2, x0: -0.22, x1: 0.22 };
          how = 'figure person (own size)';
        } else {
          drawn = unit(
            FIGURE_PARTS[ped],
            ped === 'critter' ? critterHeightM(t.lengthM) : FIGURE_HEIGHT_M[ped],
          );
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
    });
  }
  return rows;
}

/** Every bike model a rider rides, as baked (bake.ts fits it to the rider's box). */
function bikeRows(): Row[] {
  const rows: Row[] = [];
  for (const pack of PACKS) {
    let names: string[];
    try {
      names = readdirSync(`packs/${pack}/assets/models/bikes`).filter((f) => f.endsWith('.glb'));
    } catch {
      continue;
    }
    for (const f of names) {
      const part = bakePart(readGlb(fileBuffer(`packs/${pack}/assets/models/bikes/${f}`)), 'bike');
      const box = new Box3();
      const v = new Vector3();
      for (let i = 0; i + 2 < part.positions.length; i += 3)
        box.expandByPoint(v.fromArray(part.positions, i));
      rows.push({
        group: 'riders on bikes',
        thing: f.replace(/\.glb$/, ''),
        outcome: 'rider vs rider: a shove; vs traffic, props: as theirs',
        simL: TRAFFIC.riderLengthM,
        simW: TRAFFIC.riderWidthM,
        drawn: footOf(box),
        how: 'bike model (the rider on it not measured: rider models live in the dataset)',
      });
    }
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
      outcome: 'crash head-on at speed, a scrape from the side',
      simL: len,
      simW: w,
      drawn: foot,
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
    // A solid hazard stops a rider's centre this far out of its box: the rider's own half box.
    expect(Math.abs(HAZARD_REACH_S_M - RIDER_HALF_LENGTH_M)).toBeLessThanOrEqual(TOLERANCE_M);
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
});
