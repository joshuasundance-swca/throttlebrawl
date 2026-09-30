// The road lint (M1 road-1; docs/content-packs.md, "Validation", the Roads bullet). It runs on any
// files in the baked road format, hand-authored or from the GIS pipeline, and the content lane's
// pack validator (tools/packs) calls it. It reports; it never throws. Every issue carries a file
// label and a JSON pointer, so an agent can fix it without searching.
//
// This file has type-only imports, so Node's type stripping can load it directly as well as Vite.
import type { BakedFeature, BakedJunction, BakedNetwork, BakedRoad, BakedRoute, FeatureKind } from './types';

export type RoadLintRule =
  | 'samples'
  | 'curvature'
  | 'grade'
  | 'kappa-width'
  | 'features'
  | 'junction-ends'
  | 'lanes'
  | 'network'
  | 'route';

export interface RoadLintIssue {
  rule: RoadLintRule;
  /** The caller's label for the file, `road:<id>` style by default. */
  file: string;
  /** JSON pointer into that file. */
  pointer: string;
  message: string;
}

export interface RoadLintInput {
  network: BakedNetwork;
  roads: readonly BakedRoad[];
  routes?: readonly BakedRoute[] | undefined;
}

export type RoadFileLabel = (kind: 'network' | 'road' | 'route', id: string) => string;

/** Limits, in one place. */
export const ROAD_LINT = {
  /** Stored spacing range, metres (the format's rule). */
  minSpacingM: 1,
  maxSpacingM: 10,
  /** Sample chords may differ from the stated spacing by this fraction. */
  chordTolerance: 0.02,
  /** |kappa| · dMax must stay below this (the curved-road kinematics clamp). */
  maxKappaWidth: 0.5,
  /** Curvature from positions vs stored kappa, after a 5-sample average: absolute + relative. */
  kappaAbsTol: 1e-3,
  kappaRelTol: 0.1,
  /** Grade from elevations vs stored grade, after the same average. */
  gradeAbsTol: 0.01,
  /** A road's end samples must lie within this of their junctions, metres. */
  junctionTolM: 0.5,
} as const;

const FEATURE_KINDS: readonly FeatureKind[] = [
  'ramp',
  'gap',
  'hazard',
  'roadsideZone',
  'copSpawn',
  'raceMarker',
  'billboard',
];
const REQUIRED_COLUMNS = ['x', 'y', 'z', 'kappa', 'grade'] as const;

const defaultLabel: RoadFileLabel = (kind, id) => `${kind}:${id}`;

/** 5-sample centred average (ends use what exists). */
function smooth(v: readonly number[], i: number, lo: number, hi: number): number {
  let sum = 0;
  let n = 0;
  for (let k = i - 2; k <= i + 2; k++) {
    if (k < lo || k > hi) continue;
    sum += v[k] as number;
    n++;
  }
  return sum / n;
}

/** Lints one road on its own: samples, curvature, grade, width, lanes, features. */
export function lintRoad(road: BakedRoad, label: RoadFileLabel = defaultLabel): RoadLintIssue[] {
  const out: RoadLintIssue[] = [];
  const file = label('road', road.id);
  const add = (rule: RoadLintRule, pointer: string, message: string) =>
    out.push({ rule, file, pointer, message });

  // Lanes first: the width rule needs them.
  const sections = road.laneSections;
  if (sections.length === 0) add('lanes', '/laneSections', 'needs at least one lane section');
  sections.forEach((sec, si) => {
    if (si === 0 && sec.s0 !== 0)
      add('lanes', `/laneSections/0/s0`, `first section starts at ${sec.s0}, not 0`);
    const prev = sections[si - 1];
    if (prev && sec.s0 <= prev.s0)
      add('lanes', `/laneSections/${si}/s0`, 'sections must start in increasing s');
    if (sec.s0 < 0 || sec.s0 > road.lengthM)
      add('lanes', `/laneSections/${si}/s0`, `s0 ${sec.s0} is off the road`);
    if (sec.lanes.length === 0)
      add('lanes', `/laneSections/${si}/lanes`, 'a section needs at least one lane');
    sec.lanes.forEach((lane, li) => {
      if (!(lane.widthM > 0))
        add('lanes', `/laneSections/${si}/lanes/${li}/widthM`, `width ${lane.widthM} must be > 0`);
    });
  });

  // Samples: count == n + 1, spacing · n == length, columns present and equal length.
  const L = road.lengthM;
  const sp = road.sampleSpacingM;
  if (!(L > 0)) add('samples', '/lengthM', `length ${L} must be > 0`);
  if (!(sp >= ROAD_LINT.minSpacingM && sp <= ROAD_LINT.maxSpacingM)) {
    add(
      'samples',
      '/sampleSpacingM',
      `spacing ${sp} m is outside ${ROAD_LINT.minSpacingM}–${ROAD_LINT.maxSpacingM} m`,
    );
  }
  const n = Math.round(L / sp);
  const diff = sp * n - L;
  if ((diff < 0 ? -diff : diff) >= 1e-6) {
    add(
      'samples',
      '/sampleSpacingM',
      `spacing ${sp} × ${n} intervals is not the length ${L} (off by ${diff})`,
    );
  }
  const data = road.samples.data;
  let columnsOk = true;
  for (const c of REQUIRED_COLUMNS) {
    const col = data[c];
    if (!col) {
      add('samples', `/samples/data/${c}`, `column ${c} is missing`);
      columnsOk = false;
    } else if (col.length !== n + 1) {
      add('samples', `/samples/data/${c}`, `${col.length} samples; ${L} m at ${sp} m needs ${n + 1}`);
      columnsOk = false;
    } else if (!col.every(Number.isFinite)) {
      add('samples', `/samples/data/${c}`, `column ${c} has a value that is not a finite number`);
      columnsOk = false;
    }
  }
  const bank = data['bankRad'];
  if (bank && bank.length !== n + 1)
    add('samples', '/samples/data/bankRad', `${bank.length} samples, needs ${n + 1}`);
  if (!columnsOk) return out; // The geometric rules below need every column.

  const x = data['x'] as readonly number[];
  const y = data['y'] as readonly number[];
  const z = data['z'] as readonly number[];
  const kappa = data['kappa'] as readonly number[];
  const grade = data['grade'] as readonly number[];
  const last = n;

  // Chords: consecutive samples sit one horizontal spacing apart (arc length on a gentle curve).
  let badChord = -1;
  for (let i = 1; i <= last && badChord < 0; i++) {
    const dx = (x[i] as number) - (x[i - 1] as number);
    const dz = (z[i] as number) - (z[i - 1] as number);
    const chord = Math.sqrt(dx * dx + dz * dz);
    const err = chord - sp;
    if ((err < 0 ? -err : err) > ROAD_LINT.chordTolerance * sp) badChord = i;
  }
  if (badChord > 0) {
    add(
      'samples',
      `/samples/data/x/${badChord}`,
      `samples ${badChord - 1} and ${badChord} are not ${sp} m apart`,
    );
  }

  // Curvature from positions: the signed three-point (Menger) curvature, positive for a right
  // turn in this frame (x east, z south), with sqrt only.
  const kPos = new Array<number>(last + 1).fill(0);
  for (let i = 1; i < last; i++) {
    const ax = x[i - 1] as number;
    const az = z[i - 1] as number;
    const bx = x[i] as number;
    const bz = z[i] as number;
    const cx = x[i + 1] as number;
    const cz = z[i + 1] as number;
    const cross = (bx - ax) * (cz - bz) - (bz - az) * (cx - bx);
    const ab = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
    const bc = Math.sqrt((cx - bx) * (cx - bx) + (cz - bz) * (cz - bz));
    const ac = Math.sqrt((cx - ax) * (cx - ax) + (cz - az) * (cz - az));
    const den = ab * bc * ac;
    kPos[i] = den > 0 ? (2 * cross) / den : 0;
  }
  for (let i = 1; i < last; i++) {
    const fromPos = smooth(kPos, i, 1, last - 1);
    const stored = smooth(kappa, i, 1, last - 1);
    const err = fromPos - stored;
    const tol = ROAD_LINT.kappaAbsTol + ROAD_LINT.kappaRelTol * (stored < 0 ? -stored : stored);
    if ((err < 0 ? -err : err) > tol) {
      add(
        'curvature',
        `/samples/data/kappa/${i}`,
        `kappa ${stored.toPrecision(4)} disagrees with the positions (${fromPos.toPrecision(4)}) at s ${(i * sp).toFixed(1)}`,
      );
      break;
    }
  }

  // Grade from elevations.
  const gPos = new Array<number>(last + 1).fill(0);
  for (let i = 0; i <= last; i++) {
    const a = i === 0 ? 0 : i - 1;
    const b = i === last ? last : i + 1;
    gPos[i] = ((y[b] as number) - (y[a] as number)) / ((b - a) * sp);
  }
  for (let i = 0; i <= last; i++) {
    const err = smooth(gPos, i, 0, last) - smooth(grade, i, 0, last);
    if ((err < 0 ? -err : err) > ROAD_LINT.gradeAbsTol) {
      add(
        'grade',
        `/samples/data/grade/${i}`,
        `grade disagrees with the elevations at s ${(i * sp).toFixed(1)}`,
      );
      break;
    }
  }

  // |kappa| · dMax < 0.5, per sample, against the section covering it.
  for (let i = 0; i <= last; i++) {
    const s = i * sp;
    let sec = sections[0];
    for (const c of sections) if (c.s0 <= s) sec = c;
    let dMax = 0;
    for (const lane of sec?.lanes ?? []) {
      const lo = lane.dCenterM - lane.widthM / 2;
      const hi = lane.dCenterM + lane.widthM / 2;
      dMax = Math.max(dMax, lo < 0 ? -lo : lo, hi < 0 ? -hi : hi);
    }
    const k = kappa[i] as number;
    if ((k < 0 ? -k : k) * dMax >= ROAD_LINT.maxKappaWidth) {
      add(
        'kappa-width',
        `/samples/data/kappa/${i}`,
        `|kappa| ${k} × dMax ${dMax} m reaches ${ROAD_LINT.maxKappaWidth} at s ${s.toFixed(1)}`,
      );
      break;
    }
  }

  // Ranges inside the road.
  const range = (pointer: string, s0: number, s1: number) => {
    if (!(s0 >= 0 && s1 <= L && s0 <= s1)) add('features', pointer, `range ${s0}–${s1} is not inside 0–${L}`);
  };
  (road.features ?? []).forEach((f: BakedFeature, i) => {
    range(`/features/${i}`, f.s0, f.s1);
    if (!(f.d0 <= f.d1)) add('features', `/features/${i}/d0`, `d0 ${f.d0} is past d1 ${f.d1}`);
    if (!FEATURE_KINDS.includes(f.kind as FeatureKind))
      add('features', `/features/${i}/kind`, `unknown feature kind ${f.kind}`);
  });
  (road.tags ?? []).forEach((t, i) => range(`/tags/${i}`, t.s0, t.s1));
  (road.barriers ?? []).forEach((b, i) => range(`/barriers/${i}`, b.s0, b.s1));
  return out;
}

/** Lints a network, its roads and its routes together. */
export function lintRoadNetwork(input: RoadLintInput, label: RoadFileLabel = defaultLabel): RoadLintIssue[] {
  const out: RoadLintIssue[] = [];
  const net = input.network;
  const netFile = label('network', net.id);
  const byId = new Map(input.roads.map((r) => [r.id, r]));
  const junctions = new Map<string, BakedJunction>(net.junctions.map((j) => [j.id, j]));

  net.roads.forEach((id, i) => {
    if (!byId.has(id))
      out.push({ rule: 'network', file: netFile, pointer: `/roads/${i}`, message: `road ${id} has no file` });
  });
  // Each road end is listed by exactly one junction.
  const endCount = new Map<string, number>();
  net.junctions.forEach((j, ji) =>
    j.ends.forEach((e, ei) => {
      const key = `${e.road}:${e.end}`;
      endCount.set(key, (endCount.get(key) ?? 0) + 1);
      if (!byId.has(e.road)) {
        out.push({
          rule: 'network',
          file: netFile,
          pointer: `/junctions/${ji}/ends/${ei}`,
          message: `unknown road ${e.road}`,
        });
      }
    }),
  );

  for (const road of input.roads) {
    const file = label('road', road.id);
    out.push(...lintRoad(road, label));
    if (road.network !== undefined && road.network !== net.id) {
      out.push({
        rule: 'network',
        file,
        pointer: '/network',
        message: `names network ${road.network}, not ${net.id}`,
      });
    }
    if (!net.roads.includes(road.id)) {
      out.push({
        rule: 'network',
        file: netFile,
        pointer: '/roads',
        message: `road ${road.id} is not listed`,
      });
    }
    for (const end of ['from', 'to'] as const) {
      const jid = road[end];
      const j = junctions.get(jid);
      if (!j) {
        out.push({ rule: 'network', file, pointer: `/${end}`, message: `junction ${jid} does not exist` });
        continue;
      }
      const count = endCount.get(`${road.id}:${end}`) ?? 0;
      const listed = j.ends.some((e) => e.road === road.id && e.end === end);
      if (!listed || count !== 1) {
        out.push({
          rule: 'network',
          file: netFile,
          pointer: `/junctions/${net.junctions.indexOf(j)}/ends`,
          message: `the ${end} end of ${road.id} must be listed by exactly its junction ${jid} (found ${count})`,
        });
      }
      const xs = road.samples.data['x'];
      const ys = road.samples.data['y'];
      const zs = road.samples.data['z'];
      if (!xs || !ys || !zs || xs.length === 0) continue;
      const i = end === 'from' ? 0 : xs.length - 1;
      const dx = (xs[i] as number) - j.x;
      const dy = (ys[i] as number) - j.y;
      const dz = (zs[i] as number) - j.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (!(dist <= ROAD_LINT.junctionTolM)) {
        out.push({
          rule: 'junction-ends',
          file,
          pointer: `/samples/data/x/${i}`,
          message: `the ${end} end is ${dist.toFixed(3)} m from junction ${jid} (limit ${ROAD_LINT.junctionTolM} m)`,
        });
      }
    }
  }

  // Which road ends meet at a junction (pass-through joins and connector ends alike).
  const meets = (a: string, b: string): boolean =>
    net.junctions.some(
      (j) =>
        j.ends.some((e) => e.road === a && e.end === 'to') &&
        (j.ends.some((e) => e.road === b && e.end === 'from') ||
          j.connectors.some((c) => {
            const cc = c as { from?: { road?: string }; to?: { road?: string } };
            return cc.from?.road === a && cc.to?.road === b;
          })),
    );

  for (const route of input.routes ?? []) {
    const file = label('route', route.id);
    const add = (pointer: string, message: string) => out.push({ rule: 'route', file, pointer, message });
    if (route.network !== net.id) add('/network', `names network ${route.network}, not ${net.id}`);
    const onRoad = (pointer: string, r: string, s: number) => {
      const road = byId.get(r);
      if (!road) {
        add(pointer, `unknown road ${r}`);
        return;
      }
      if (!route.allowedRoads.includes(r)) add(pointer, `road ${r} is not in allowedRoads`);
      if (!(s >= 0 && s <= road.lengthM)) add(`${pointer}/s`, `s ${s} is off road ${r} (0–${road.lengthM})`);
    };
    onRoad('/start', route.start.road, route.start.s);
    onRoad('/finish', route.finish.road, route.finish.s);
    (route.checkpoints ?? []).forEach((c, i) => onRoad(`/checkpoints/${i}`, c.road, c.s));
    route.allowedRoads.forEach((r, i) => {
      if (!byId.has(r)) add(`/allowedRoads/${i}`, `unknown road ${r}`);
    });
    route.mainPath.forEach((r, i) => {
      if (!route.allowedRoads.includes(r))
        add(`/mainPath/${i}`, `${r} is on the main path but not in allowedRoads`);
      const prev = route.mainPath[i - 1];
      if (prev !== undefined && !meets(prev, r))
        add(`/mainPath/${i}`, `${prev} does not lead into ${r} at a junction`);
    });
    if (route.mainPath[0] !== route.start.road)
      add('/start/road', 'the start is not on the first main-path road');
    if (route.mainPath[route.mainPath.length - 1] !== route.finish.road) {
      add('/finish/road', 'the finish is not on the last main-path road');
    }
  }
  return out;
}
