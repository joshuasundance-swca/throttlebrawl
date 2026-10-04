// The road lint (M1 road-1; docs/content-packs.md, "Validation", the Roads bullet). It runs on any
// files in the baked road format, hand-authored or from the GIS pipeline, and the content lane's
// pack validator (tools/packs) calls it. It reports; it never throws. Every issue carries a file
// label and a JSON pointer, so an agent can fix it without searching.
//
// road-2 adds junctions with connector roads (continuity per connector row, split zones, the
// traffic rule for shortcut lanes) and the jump lint (ramps and gaps on straight enough road).
import { lanesPerDirection, MAX_LANES_PER_DIRECTION, resolveVerge } from './cross-section';
import {
  GAP_RESPAWNS,
  LANDMARK_DEFAULTS,
  rampTruckShape,
  readConnector,
  type BakedConnector,
  type BakedFeature,
  type BakedJunction,
  type BakedNetwork,
  type BakedRoad,
  type BakedRoute,
  type FeatureKind,
} from './types';

export type RoadLintRule =
  | 'samples'
  | 'curvature'
  | 'grade'
  | 'kappa-width'
  | 'features'
  | 'junction-ends'
  | 'lanes'
  | 'cross-section'
  | 'network'
  | 'connectors'
  | 'jump'
  | 'landmark-clear'
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
  /**
   * At a junction with connector roads, the ends it lists must lie within this of its point: the
   * connector roads span the junction, and continuity is checked along each of them instead.
   */
  junctionRadiusM: 60,
  /** A connector's end and the road end it joins must point the same way within this, radians (3°). */
  joinAngleRad: 0.0524,
  /**
   * Jump lint: the speed the expected flight is worked out at, m/s: the starter bike's top speed,
   * 100 mph since playtest 1 item 10 (M1's 85 mph was 38).
   */
  jumpSpeedMps: 44.7,
  /** Jump lint: the largest |kappa| allowed from a ramp's start to its expected landing (500 m radius). */
  jumpMaxKappa: 0.002,
  /** Jump lint: road checked past the end of a `gap` feature, metres. */
  gapRunOutM: 20,
} as const;

const GRAVITY = 9.81;

const FEATURE_KINDS: readonly FeatureKind[] = [
  'ramp',
  'gap',
  'hazard',
  'roadsideZone',
  'copSpawn',
  'raceMarker',
  'billboard',
  'boostPad',
  'rampTruck',
  'landmark',
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

/**
 * The cross-section rules (W-Q; interview, 2026-10-02: 4-6 lane highways, rails only on bridges and
 * drops): 1 to 3 drive lanes per direction on a two-way section, a median only between two
 * directions and no wider than the gap their lanes leave, and an explicit `rail` verge edge only
 * where a rail barrier stands on that side within the section.
 */
function lintCrossSection(
  road: BakedRoad,
  si: number,
  add: (rule: RoadLintRule, pointer: string, message: string) => void,
): void {
  const sec = road.laneSections[si];
  if (!sec) return;
  const at = `/laneSections/${si}`;
  const { forward, oncoming } = lanesPerDirection(sec.lanes);
  if (forward > MAX_LANES_PER_DIRECTION || oncoming > MAX_LANES_PER_DIRECTION) {
    add(
      'cross-section',
      `${at}/lanes`,
      `${forward} drive lanes forward and ${oncoming} oncoming: at most ${MAX_LANES_PER_DIRECTION} each way`,
    );
  }
  if (sec.median) {
    if (forward === 0 || oncoming === 0) {
      add('cross-section', `${at}/median`, 'a median needs drive lanes in both directions');
    } else {
      // The gap between the innermost lanes of the two directions (lane dCenterM decides it).
      let fwdLo = Infinity;
      let fwdHi = -Infinity;
      let oncLo = Infinity;
      let oncHi = -Infinity;
      for (const lane of sec.lanes) {
        if (lane.kind !== 'drive') continue;
        const a = lane.dCenterM - lane.widthM / 2;
        const b = lane.dCenterM + lane.widthM / 2;
        if (lane.direction === 1) {
          fwdLo = Math.min(fwdLo, a);
          fwdHi = Math.max(fwdHi, b);
        } else {
          oncLo = Math.min(oncLo, a);
          oncHi = Math.max(oncHi, b);
        }
      }
      const gap = fwdLo >= oncHi ? fwdLo - oncHi : oncLo - fwdHi;
      if (gap < sec.median.widthM - 0.05) {
        add(
          'cross-section',
          `${at}/median/widthM`,
          `median ${sec.median.widthM} m is wider than the ${Math.max(0, gap).toFixed(2)} m gap the lanes leave`,
        );
      }
    }
  }
  const next = road.laneSections[si + 1];
  const s0 = sec.s0;
  const s1 = next ? next.s0 : road.lengthM;
  for (const side of ['left', 'right'] as const) {
    const v = sec.verges?.[side];
    if (!v || v.edge !== 'rail') continue;
    const railed = (road.barriers ?? []).some(
      (b) => b.kind === 'rail' && (b.side === side || b.side === 'both') && b.s0 < s1 && b.s1 > s0,
    );
    if (!railed) {
      add(
        'cross-section',
        `${at}/verges/${side}/edge`,
        `a rail edge needs a rail barrier on the ${side} within ${s0}..${s1} (rails only on bridges and drops)`,
      );
    }
  }
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
    lintCrossSection(road, si, add);
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
  // A ramp lip is a deliberate kink in the profile, so its range (and two samples either side,
  // for the averaging) is left out; the jump rule below covers ramps.
  const lips = (road.features ?? []).filter((f) => f.kind === 'ramp');
  const nearLip = (s: number) => lips.some((f) => s >= f.s0 - 2 * sp && s <= f.s1 + 2 * sp);
  for (let i = 0; i <= last; i++) {
    if (nearLip(i * sp)) continue;
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
    // A solid hazard (run W-U) stands off the lanes: traffic and the rival AI never see one.
    if (f.kind === 'hazard' && f.params?.['solid'] === true) {
      for (const sec of sections) {
        const next = sections[sections.indexOf(sec) + 1];
        if (sec.s0 > f.s1 || (next && next.s0 <= f.s0)) continue;
        const lane = sec.lanes.find(
          (l) => f.d1 > l.dCenterM - l.widthM / 2 && f.d0 < l.dCenterM + l.widthM / 2,
        );
        if (lane) {
          add(
            'features',
            `/features/${i}`,
            `solid hazard ${f.id} stands on lane ${lane.id}; keep it off the lanes`,
          );
          break;
        }
      }
    }
  });
  (road.tags ?? []).forEach((t, i) => range(`/tags/${i}`, t.s0, t.s1));
  (road.barriers ?? []).forEach((b, i) => range(`/barriers/${i}`, b.s0, b.s1));
  lintPlaytest3(road, add);

  // Jumps: an airborne body bends with the road (docs/architecture.md, "Jumps, ramps and
  // airtime"), so a ramp, gap or ramp truck must sit on road that is nearly straight from its start
  // to where a bike at top speed would land.
  (road.features ?? []).forEach((f: BakedFeature, fi) => {
    if (f.kind !== 'ramp' && f.kind !== 'gap' && f.kind !== 'rampTruck') return;
    const s0 = Math.max(0, f.s0);
    const s1 = Math.min(L, expectedFlightEnd(f, last + 1, sp, y));
    const i0 = Math.floor(s0 / sp);
    const i1 = Math.min(last, Math.ceil(s1 / sp));
    let worst = 0;
    let at = i0;
    for (let i = i0; i <= i1; i++) {
      const k = kappa[i] as number;
      const a = k < 0 ? -k : k;
      if (a > worst) {
        worst = a;
        at = i;
      }
    }
    if (worst > ROAD_LINT.jumpMaxKappa) {
      add(
        'jump',
        `/features/${fi}`,
        `${f.kind} ${f.id} sits on a bend: |kappa| ${worst.toPrecision(3)} at s ${(at * sp).toFixed(1)} is over ${ROAD_LINT.jumpMaxKappa} between s ${s0.toFixed(1)} and its expected landing at s ${s1.toFixed(1)}`,
      );
    }
  });
  return out;
}

/** A param the feature gives that is not a finite number in (lo, hi] (lo exclusive), or null. */
function badNumber(f: BakedFeature, key: string, lo: number, hi: number, loInclusive = false): string | null {
  const p = f.params ?? {};
  if (!Object.hasOwn(p, key)) return null;
  const v = p[key];
  const ok = typeof v === 'number' && Number.isFinite(v) && (loInclusive ? v >= lo : v > lo) && v <= hi;
  return ok ? null : `${key} ${JSON.stringify(v)} is not a number in ${loInclusive ? '[' : '('}${lo}, ${hi}]`;
}

/**
 * Playtest 3's road rules (T3.1; docs/content-packs.md, "Gaps and landmarks", "Barriers"). The
 * readers in ./types.ts replace a bad gap or landmark param with its default rather than throw, so
 * the lint is where a typo surfaces:
 * - a `gap`'s `killDepthM` and `respawnPastM` are positive numbers, and `respawn` is `far` or `main`;
 * - a `landmark` names its `model`, its `yawDeg` is in [-180, 180], `scale` in (0, 4], `farM` above
 *   0; and its footprint lies wholly past the verge band on its side (rule `landmark-clear`) unless
 *   it is `overRoad` (a structure the road passes through or under: a bridge tower, a gantry);
 * - only a `wall` may be `jumpable`.
 */
function lintPlaytest3(
  road: BakedRoad,
  add: (rule: RoadLintRule, pointer: string, message: string) => void,
): void {
  (road.features ?? []).forEach((f: BakedFeature, i) => {
    const at = `/features/${i}`;
    if (f.kind === 'gap') {
      const p = f.params ?? {};
      for (const key of ['killDepthM', 'respawn', 'respawnPastM']) {
        if (key === 'respawn') {
          if (Object.hasOwn(p, key) && !GAP_RESPAWNS.some((k) => k === p[key])) {
            const list = GAP_RESPAWNS.join(', ');
            add(
              'features',
              `${at}/params/${key}`,
              `gap ${f.id}: respawn ${JSON.stringify(p[key])} is not one of ${list}`,
            );
          }
          continue;
        }
        const bad = badNumber(f, key, 0, Infinity);
        if (bad) add('features', `${at}/params/${key}`, `gap ${f.id}: ${bad}`);
      }
    }
    if (f.kind !== 'landmark') return;
    const model = f.params?.['model'];
    if (typeof model !== 'string' || model.length === 0) {
      add(
        'features',
        `${at}/params/model`,
        `landmark ${f.id} names no model (<asset id>#<node>): it draws nothing`,
      );
    }
    const checks: [string, number, number, boolean][] = [
      ['yawDeg', -180, 180, true],
      ['scale', 0, LANDMARK_DEFAULTS.maxScale, false],
      ['farM', 0, Infinity, false],
    ];
    for (const [key, lo, hi, loInclusive] of checks) {
      const bad = badNumber(f, key, lo, hi, loInclusive);
      if (bad) add('features', `${at}/params/${key}`, `landmark ${f.id}: ${bad}`);
    }
    if (f.params?.['overRoad'] !== true) landmarkClear(road, f, at, add);
  });
  (road.barriers ?? []).forEach((b, i) => {
    if (b.jumpable === true && b.kind !== 'wall') {
      add('features', `/barriers/${i}/jumpable`, `a ${b.kind} cannot be jumpable: only a wall may be`);
    }
  });
}

/**
 * `landmark-clear`: a landmark's footprint lies wholly past the outer edge of the verge band on its
 * side (the side its centre is on) over all of s0..s1, checked every sample, so the sim never meets
 * it and the props, smashables and scenes of the verge keep their ground.
 */
function landmarkClear(
  road: BakedRoad,
  f: BakedFeature,
  at: string,
  add: (rule: RoadLintRule, pointer: string, message: string) => void,
): void {
  const side = f.d0 + f.d1 >= 0 ? 'right' : 'left';
  const step = road.sampleSpacingM > 0 ? road.sampleSpacingM : 1;
  const sections = road.laneSections;
  for (let s = f.s0; ; s += step) {
    const sAt = s > f.s1 ? f.s1 : s;
    let sec = sections[0];
    for (const c of sections) if (c.s0 <= sAt) sec = c;
    if (!sec) return;
    const verge = resolveVerge(road, sec, side, sAt);
    const clear = side === 'right' ? f.d0 >= verge.dOuter : f.d1 <= verge.dOuter;
    if (!clear) {
      add(
        'landmark-clear',
        at,
        `landmark ${f.id} (d ${f.d0} to ${f.d1}) reaches the ${side} verge, which ends at d ${verge.dOuter.toFixed(2)}, at s ${sAt.toFixed(1)}: keep it past the verge, or mark a structure the road passes through overRoad`,
      );
      return;
    }
    if (sAt >= f.s1) return;
  }
}

/**
 * Where a jump's expected flight ends, in s: for a ramp, a bike leaving its highest sample at
 * ROAD_LINT.jumpSpeedMps with the slope just before it, flying until it meets the surface again;
 * for a ramp truck the same from its lip (its deck is not in the samples); for a gap, its end plus a
 * run-out. Clamped to the road.
 */
function expectedFlightEnd(f: BakedFeature, count: number, sp: number, y: readonly number[]): number {
  const L = (count - 1) * sp;
  if (f.kind === 'gap') return Math.min(L, f.s1 + ROAD_LINT.gapRunOutM);
  let lip: number;
  let slope: number;
  let yLip: number;
  if (f.kind === 'rampTruck') {
    const shape = rampTruckShape(f);
    lip = Math.min(count - 1, Math.round((f.s0 + shape.run) / sp));
    slope = shape.lip / shape.run;
    yLip = (y[lip] as number) + shape.lip;
  } else {
    const iA = Math.max(0, Math.floor(f.s0 / sp));
    const iB = Math.min(count - 1, Math.ceil(f.s1 / sp));
    lip = iA;
    for (let i = iA; i <= iB; i++) if ((y[i] as number) > (y[lip] as number)) lip = i;
    slope = lip > 0 ? ((y[lip] as number) - (y[lip - 1] as number)) / sp : 0;
    yLip = y[lip] as number;
  }
  const v = ROAD_LINT.jumpSpeedMps;
  for (let i = lip + 1; i < count; i++) {
    const dx = (i - lip) * sp;
    const t = dx / v;
    if (yLip + slope * dx - 0.5 * GRAVITY * t * t <= (y[i] as number)) return i * sp;
  }
  return L;
}

/** A road's end sample: position, and the unit horizontal direction of increasing s there. */
function endOf(road: BakedRoad, end: 'from' | 'to') {
  const xs = road.samples.data['x'];
  const ys = road.samples.data['y'];
  const zs = road.samples.data['z'];
  if (!xs || !ys || !zs || xs.length < 2) return null;
  const i = end === 'from' ? 0 : xs.length - 1;
  const k = end === 'from' ? 1 : xs.length - 2;
  const sign = end === 'from' ? 1 : -1;
  let tx = sign * ((xs[k] as number) - (xs[i] as number));
  let tz = sign * ((zs[k] as number) - (zs[i] as number));
  const len = Math.sqrt(tx * tx + tz * tz) || 1;
  tx /= len;
  tz /= len;
  return { i, x: xs[i] as number, y: (ys[i] as number) ?? 0, z: zs[i] as number, tx, tz };
}

/** Every lane on a road, all sections. */
function lanesOf(road: BakedRoad) {
  return road.laneSections.flatMap((s) => s.lanes);
}

/**
 * A connector's end must meet the road end it joins: on that end's cross-section (within
 * junctionTolM along the road and vertically, and inside its width) and pointing the same way.
 */
function joinCheck(
  c: BakedRoad,
  cEnd: 'from' | 'to',
  r: BakedRoad,
  rEnd: 'from' | 'to',
  report: (message: string) => void,
): void {
  const pc = endOf(c, cEnd);
  const pr = endOf(r, rEnd);
  if (!pc || !pr) return;
  const dx = pc.x - pr.x;
  const dz = pc.z - pr.z;
  const along = dx * pr.tx + dz * pr.tz;
  const lat = -dx * pr.tz + dz * pr.tx;
  let half = 0;
  for (const l of lanesOf(r)) {
    const lo = l.dCenterM - l.widthM / 2;
    const hi = l.dCenterM + l.widthM / 2;
    half = Math.max(half, lo < 0 ? -lo : lo, hi < 0 ? -hi : hi);
  }
  const dy = pc.y - pr.y;
  const tol = ROAD_LINT.junctionTolM;
  if (!(
    (along < 0 ? -along : along) <= tol &&
    (dy < 0 ? -dy : dy) <= tol &&
    (lat < 0 ? -lat : lat) <= half
  )) {
    report(
      `the ${cEnd} end of connector ${c.id} misses the ${rEnd} end of ${r.id}: ${along.toFixed(3)} m along, ${lat.toFixed(3)} m across (width ±${half} m), ${dy.toFixed(3)} m up`,
    );
    return;
  }
  // Joining a `from` end to a `to` end keeps the direction of s; to-to or from-from reverses it.
  const sigma = cEnd === rEnd ? -1 : 1;
  const cosLimit = 1 - (ROAD_LINT.joinAngleRad * ROAD_LINT.joinAngleRad) / 2;
  if (sigma * (pc.tx * pr.tx + pc.tz * pr.tz) < cosLimit) {
    report(`the ${cEnd} end of connector ${c.id} does not line up with the ${rEnd} end of ${r.id}`);
  }
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

  // Connector rows, read once. A connector road belongs to the one junction whose rows name it.
  const rowsOf = new Map<string, { row: BakedConnector; ji: number; ci: number }[]>();
  const junctionsNaming = new Map<string, Set<string>>();
  net.junctions.forEach((j, ji) =>
    j.connectors.forEach((raw, ci) => {
      const row = readConnector(raw);
      if (!row) {
        out.push({
          rule: 'connectors',
          file: netFile,
          pointer: `/junctions/${ji}/connectors/${ci}`,
          message:
            'a connector row needs id, road, from {road, end, lane} and to {road, end, lane}, and numbers s0, s1, d0, d1 in any splitZone',
        });
        return;
      }
      rowsOf.set(j.id, [...(rowsOf.get(j.id) ?? []), { row, ji, ci }]);
      junctionsNaming.set(row.road, new Set([...(junctionsNaming.get(row.road) ?? []), j.id]));
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
    const naming = junctionsNaming.get(road.id);
    if (naming) {
      // A connector road spans its junction: both its ends name it, and no junction lists them.
      const [only] = [...naming];
      if (naming.size !== 1 || road.from !== only || road.to !== only) {
        out.push({
          rule: 'connectors',
          file,
          pointer: '/from',
          message: `connector road ${road.id} must run from and to the one junction whose rows name it (${[...naming].join(', ')})`,
        });
      }
      for (const end of ['from', 'to'] as const) {
        if ((endCount.get(`${road.id}:${end}`) ?? 0) > 0) {
          out.push({
            rule: 'connectors',
            file: netFile,
            pointer: '/junctions',
            message: `the ${end} end of connector road ${road.id} is listed in a junction's ends; connector ends are joined by their rows instead`,
          });
        }
      }
      continue;
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
      const p = endOf(road, end);
      if (!p) continue;
      const dx = p.x - j.x;
      const dy = p.y - j.y;
      const dz = p.z - j.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const limit = rowsOf.has(j.id) ? ROAD_LINT.junctionRadiusM : ROAD_LINT.junctionTolM;
      if (!(dist <= limit)) {
        out.push({
          rule: 'junction-ends',
          file,
          pointer: `/samples/data/x/${p.i}`,
          message: `the ${end} end is ${dist.toFixed(3)} m from junction ${jid} (limit ${limit} m)`,
        });
      }
    }
  }

  // Each connector row: roads and lanes exist, the connector meets both road ends it joins, the
  // split zone sits at the end it leads out of, and traffic cannot reach a shortcut through it.
  for (const [jid, rows] of rowsOf) {
    const j = junctions.get(jid);
    for (const { row, ji, ci } of rows) {
      const ptr = `/junctions/${ji}/connectors/${ci}`;
      const add = (rule: RoadLintRule, pointer: string, message: string) =>
        out.push({ rule, file: netFile, pointer: `${ptr}${pointer}`, message });
      const c = byId.get(row.road);
      const a = byId.get(row.from.road);
      const b = byId.get(row.to.road);
      if (!c) add('connectors', '/road', `unknown connector road ${row.road}`);
      if (!a) add('connectors', '/from/road', `unknown road ${row.from.road}`);
      if (!b) add('connectors', '/to/road', `unknown road ${row.to.road}`);
      if (!c || !a || !b || !j) continue;
      for (const [side, e] of [
        ['from', row.from],
        ['to', row.to],
      ] as const) {
        if (!j.ends.some((x) => x.road === e.road && x.end === e.end))
          add('connectors', `/${side}`, `the ${e.end} end of ${e.road} is not one of junction ${jid}'s ends`);
        const r = side === 'from' ? a : b;
        if (!lanesOf(r).some((l) => l.id === e.lane))
          add('connectors', `/${side}/lane`, `road ${e.road} has no lane ${e.lane}`);
      }
      joinCheck(c, 'from', a, row.from.end, (m) => add('junction-ends', '/from', m));
      joinCheck(c, 'to', b, row.to.end, (m) => add('junction-ends', '/to', m));
      const z = row.splitZone;
      if (z) {
        const L = a.lengthM;
        const atEnd =
          row.from.end === 'to'
            ? Math.abs(z.s1 - L) <= ROAD_LINT.junctionTolM
            : Math.abs(z.s0) <= ROAD_LINT.junctionTolM;
        if (!(z.s0 >= 0 && z.s1 <= L && z.s0 < z.s1 && z.d0 < z.d1))
          add(
            'connectors',
            '/splitZone',
            `split zone s ${z.s0}–${z.s1}, d ${z.d0}–${z.d1} must lie inside ${a.id} (0–${L}) with s0 < s1 and d0 < d1`,
          );
        else if (!atEnd)
          add(
            'connectors',
            '/splitZone',
            `split zone must reach the ${row.from.end} end of ${a.id}, where the connector leaves`,
          );
      }
      const shortcut = (r: BakedRoad) => lanesOf(r).some((l) => l.kind === 'shortcut');
      if ((shortcut(a) || shortcut(b)) && lanesOf(c).some((l) => l.kind === 'drive')) {
        add(
          'connectors',
          '/road',
          `connector ${c.id} leads onto or off a shortcut road but carries a drive lane, so traffic could take it`,
        );
      }
    }
  }

  // How a road's `to` end leads into the next road's `from` end: a pass-through join, or a row.
  const joinOf = (a: string, b: string): { ok: boolean; via?: string } => {
    for (const j of net.junctions) {
      if (!j.ends.some((e) => e.road === a && e.end === 'to')) continue;
      const rows = rowsOf.get(j.id) ?? [];
      if (rows.length === 0) {
        if (j.ends.length === 2 && j.ends.some((e) => e.road === b && e.end === 'from')) return { ok: true };
        continue;
      }
      const r = rows.find(
        ({ row }) =>
          row.from.road === a &&
          row.from.end === 'to' &&
          row.to.road === b &&
          row.to.end === 'from' &&
          !row.splitZone,
      );
      if (r) return { ok: true, via: r.row.road };
    }
    return { ok: false };
  };

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
      if (prev === undefined) return;
      const join = joinOf(prev, r);
      if (!join.ok) add(`/mainPath/${i}`, `${prev} does not lead into ${r} at a junction`);
      else if (join.via !== undefined && !route.allowedRoads.includes(join.via))
        add(`/mainPath/${i}`, `the connector ${join.via} from ${prev} into ${r} is not in allowedRoads`);
    });
    // Playtest 3: traffic runs the main path, so a gap there would swallow it; gaps go on branches.
    route.mainPath.forEach((r, i) => {
      const hole = (byId.get(r)?.features ?? []).find((f) => f.kind === 'gap');
      if (hole)
        add(
          `/mainPath/${i}`,
          `road ${r} holds gap ${hole.id}: traffic runs the main path, so put gaps on branch roads`,
        );
    });
    if (route.mainPath[0] !== route.start.road)
      add('/start/road', 'the start is not on the first main-path road');
    if (route.mainPath[route.mainPath.length - 1] !== route.finish.road) {
      add('/finish/road', 'the finish is not on the last main-path road');
    }
    // W-Q: a named branch's roads are allowed roads off the main path, each in one branch only.
    const branchIds = new Set<string>();
    const branchOfRoad = new Map<string, string>();
    (route.branches ?? []).forEach((b, i) => {
      if (branchIds.has(b.id)) add(`/branches/${i}/id`, `branch ${b.id} is named twice`);
      branchIds.add(b.id);
      b.roads.forEach((r, k) => {
        const ptr = `/branches/${i}/roads/${k}`;
        if (!byId.has(r)) add(ptr, `unknown road ${r}`);
        else if (!route.allowedRoads.includes(r)) add(ptr, `branch road ${r} is not in allowedRoads`);
        if (route.mainPath.includes(r)) add(ptr, `branch road ${r} is on the main path`);
        const other = branchOfRoad.get(r);
        if (other !== undefined && other !== b.id) add(ptr, `road ${r} is in branches ${other} and ${b.id}`);
        branchOfRoad.set(r, b.id);
      });
    });
  }
  return out;
}
