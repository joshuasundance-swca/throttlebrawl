// Radio tracks written as code (M4 radio-1, the code-made route): a station track's `procedural`
// preset plus its params and a seed become a short loop of notes. Pure and seeded, so the same
// track always plays the same song, and tests read it without audio. radio-synth.ts plays it.
//
// Two presets, each a small band:
// - `surf-trio`: straight sixteenths at 140-175 bpm in a minor or Phrygian-dominant key. A drum
//   beat (or the rolling floor-tom one), picked eighth-note bass, offbeat chord stabs or ringing
//   strums, a tremolo-picked lead line (call and response, the second half ending on a chromatic
//   run down), and sometimes the "drop": a tremolo-picked slide down the low string at the top.
//   The synth drenches the guitars in a spring reverb.
// - `rockabilly-trio`: a shuffle (triplet eighths) at 150-205 bpm over a 12-bar or 8-bar blues.
//   Boom-chick drums with a shuffled ride, a slapped upright bass (walking quarters with the
//   slap's click on the offbeats, or a boogie line), boogie double-stops or dominant-seventh chops,
//   and a twangy lead that plays licks in the call bars, bends the minor third up to the major,
//   doubles in sixths, and plays the classic chromatic turnaround. The synth adds a slapback echo.
//
// Six more (run W-Q, interview 2026-10-02 round 6) are in radio-compose-more.ts: `island-band` and
// `dub-band` for the Keys, `stoner-band` and `ambient-band` for the Pacific Northwest, `funk-band` and
// `chip-band` for San Francisco; the second of each pair is the region's hidden pirate station.
//
// Four more, one sound per region (playtest 2, 2026-10-02: "There should be different stations and
// music in different regions"), are in radio-compose-regional.ts: `grunge-band` and `folk-band` for
// the Pacific Northwest, `synth-band` and `psych-band` for San Francisco.
//
// Every melody here is generated from the seed (random walks on the scale over chord tones), so
// the songs are original by construction; no existing tune is transcribed.
import { composeMore, MORE_PRESETS } from './radio-compose-more';
import { composeRegional, REGIONAL_PRESETS } from './radio-compose-regional';
import type { RadioGenre } from './radio-synth';
import {
  finish,
  humanize,
  keyRoot,
  nearestOf,
  num,
  oneOf,
  pick,
  scaleStep,
  seededRandom,
} from './radio-util';

export { hashString, keyRoot, seededRandom, trackSeed } from './radio-util';

export const RADIO_PRESETS = ['surf-trio', 'rockabilly-trio', ...REGIONAL_PRESETS, ...MORE_PRESETS] as const;
export type RadioPreset = (typeof RADIO_PRESETS)[number];

export type RadioLayer =
  | 'kick'
  | 'snare'
  | 'brush'
  | 'hat'
  | 'ride'
  | 'crash'
  | 'tom'
  | 'bass'
  | 'slap'
  | 'rhythm'
  | 'lead'
  | 'gliss'
  // The regional bands' parts (radio-compose-regional.ts); each rig voices them its own way.
  | 'clap'
  | 'tamb'
  | 'openhat'
  | 'pad'
  | 'arp'
  | 'organ'
  | 'glock'
  // The newer bands' parts (radio-compose-more.ts).
  | 'conga'
  | 'steel'
  | 'skank'
  | 'stab';

export interface RadioNote {
  /** Grid step in the loop (sixteenths for surf, triplet eighths for rockabilly). */
  step: number;
  layer: RadioLayer;
  /** MIDI note (drums: a pitch hint, used by toms). */
  midi: number;
  /** Length in steps. */
  len: number;
  /** 0..1. */
  vel: number;
  /** Tremolo picked: the synth re-picks it on every half step. */
  trem?: boolean;
  /** Semitones the note slides from: -1 bends up from a semitone below; a gliss slides down. */
  slide?: number;
  /** A chord tone's place in a strum (0 = first string hit). */
  strum?: number;
}

export interface Composition {
  preset: RadioPreset;
  seed: number;
  bpm: number;
  /** The key's root as a bass-register MIDI note. */
  key: number;
  /** Progression or form id. */
  form: string;
  stepsPerBeat: 3 | 4;
  stepsPerBar: number;
  bars: number;
  steps: number;
  /** Seconds per step. */
  stepS: number;
  /** Sorted by step. */
  notes: readonly RadioNote[];
  /**
   * A medley (run W-U, Pivot FM): parts played once each, one after another, each on its own band.
   * The top-level fields then mirror the first part. Absent for an ordinary song.
   */
  medley?: readonly MedleyPart[];
}

/** One part of a medley: a song cut to a few bars, and the band that plays it. */
export interface MedleyPart {
  genre: RadioGenre;
  comp: Composition;
}

/** A station track's `procedural` field (docs/content-packs.md, "Radio stations"). */
export interface ProceduralSpec {
  preset: string;
  params?: Readonly<Record<string, unknown>>;
}

/** Composes a track. Unknown presets return null (the station skips the track). */
export function composeTrack(spec: ProceduralSpec, seed: number): Composition | null {
  const params = spec.params ?? {};
  if (spec.preset === 'surf-trio') return composeSurf(params, seed >>> 0);
  if (spec.preset === 'rockabilly-trio') return composeRockabilly(params, seed >>> 0);
  return composeRegional(spec.preset, params, seed >>> 0) ?? composeMore(spec.preset, params, seed >>> 0);
}

// ---------------------------------------------------------------------------------------------
// Surf

type Chord = { root: number; minor: boolean };
const SURF_PROGRESSIONS: Readonly<Record<string, readonly Chord[]>> = {
  // i bVII bVI V: the Andalusian cadence, the most surf of all moves.
  andalusian: [
    { root: 0, minor: true },
    { root: -2, minor: false },
    { root: -4, minor: false },
    { root: -5, minor: false },
  ],
  // i i bVI bVII: the stomp.
  stomp: [
    { root: 0, minor: true },
    { root: 0, minor: true },
    { root: -4, minor: false },
    { root: -2, minor: false },
  ],
  // I bII I bII over Phrygian dominant: the exotic-scale surf sound.
  phrygian: [
    { root: 0, minor: false },
    { root: 1, minor: false },
    { root: 0, minor: false },
    { root: 1, minor: false },
  ],
  // i iv V i.
  minor: [
    { root: 0, minor: true },
    { root: 5, minor: true },
    { root: -5, minor: false },
    { root: 0, minor: true },
  ],
};
export const SURF_FORMS = Object.keys(SURF_PROGRESSIONS);

const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11];
const PHRYGIAN_DOMINANT = [0, 1, 4, 5, 7, 8, 10];
/** Lead rhythms per bar, in sixteenths. */
const SURF_RHYTHMS: readonly (readonly number[])[] = [
  [4, 4, 4, 4],
  [8, 4, 4],
  [4, 4, 8],
  [2, 2, 4, 8],
  [6, 2, 8],
  [4, 2, 2, 8],
  [12, 4],
];

function composeSurf(params: Readonly<Record<string, unknown>>, seed: number): Composition {
  const r = seededRandom(seed);
  const bpm = num(params['bpm'], 140, 175) ?? 140 + Math.floor(r() * 30);
  const keyName = typeof params['key'] === 'string' ? params['key'] : pick(r, ['E', 'A', 'D', 'G', 'B']);
  const key = keyRoot(keyName) ?? 40;
  const form = oneOf(params['progression'], SURF_FORMS) ?? pick(r, SURF_FORMS);
  const prog = SURF_PROGRESSIONS[form] ?? SURF_PROGRESSIONS['andalusian']!;
  const drums =
    oneOf(params['drums'], ['four', 'drive', 'toms'] as const) ?? pick(r, ['four', 'drive', 'toms']);
  const bassStyle = pick(r, ['pump', 'root5', 'walk'] as const);
  const rhythmStyle = pick(r, ['stab', 'strum'] as const);
  const gliss = typeof params['drop'] === 'boolean' ? params['drop'] : r() < 0.6;
  const bars = 8;
  const S = 16;
  const notes: RadioNote[] = [];
  const keyScale = form === 'phrygian' ? PHRYGIAN_DOMINANT : AEOLIAN;

  for (let bar = 0; bar < bars; bar++) {
    const chord = prog[bar % prog.length]!;
    const next = prog[(bar + 1) % prog.length]!;
    const at = bar * S;
    const last = bar === bars - 1;
    // Drums. The last bar's second half is a falling floor-tom roll back to the top.
    if (bar === 0 || bar === 4) notes.push({ step: at, layer: 'crash', midi: 0, len: 8, vel: 0.7 });
    for (let s = 0; s < S; s++) {
      if (last && s >= 8) {
        notes.push({ step: at + s, layer: 'tom', midi: 52 - (s - 8), len: 1, vel: humanize(r, 0.8) });
        continue;
      }
      const kick = s === 0 || s === 8 || (drums === 'drive' && (s === 6 || s === 10 || s === 14));
      if (kick) notes.push({ step: at + s, layer: 'kick', midi: 0, len: 1, vel: humanize(r, 0.9) });
      if (s === 4 || s === 12)
        notes.push({ step: at + s, layer: 'snare', midi: 0, len: 1, vel: humanize(r, 0.85) });
      if (drums === 'toms') {
        if (s % 2 === 0)
          notes.push({
            step: at + s,
            layer: 'tom',
            midi: 45,
            len: 1,
            vel: humanize(r, s % 4 === 0 ? 0.55 : 0.4),
          });
        if (s % 4 === 2) notes.push({ step: at + s, layer: 'hat', midi: 0, len: 1, vel: humanize(r, 0.5) });
      } else if (s % 2 === 0) {
        notes.push({
          step: at + s,
          layer: 'hat',
          midi: 0,
          len: 1,
          vel: humanize(r, s % 4 === 0 ? 0.7 : 0.45),
        });
      }
    }
    // Bass: picked eighths, with a chromatic approach into the next chord.
    const root = key + chord.root;
    const shape =
      bassStyle === 'pump'
        ? [0, 0, 0, 0, 0, 0, 0, 12]
        : bassStyle === 'root5'
          ? [0, 0, 7, 7, 0, 0, 12, 7]
          : [0, 7, 12, 7, 0, 7, chord.minor ? 10 : 11, 7];
    for (let e = 0; e < 8; e++) {
      let m = root + (shape[e] ?? 0);
      if (e === 7 && next.root !== chord.root) m = key + next.root + (next.root > chord.root ? -1 : 1);
      notes.push({
        step: at + e * 2,
        layer: 'bass',
        midi: m,
        len: 2,
        vel: humanize(r, e % 2 === 0 ? 0.9 : 0.7),
      });
    }
    // Rhythm guitar.
    const triad = [12, chord.minor ? 15 : 16, 19, 24].map((iv) => root + iv);
    if (rhythmStyle === 'stab') {
      for (const s of [2, 6, 10, 14]) {
        if (last && s >= 8) continue;
        triad.forEach((m, i) =>
          notes.push({ step: at + s, layer: 'rhythm', midi: m, len: 1, vel: humanize(r, 0.6), strum: i }),
        );
      }
    } else {
      for (const s of last ? [0] : [0, 8]) {
        triad.forEach((m, i) =>
          notes.push({ step: at + s, layer: 'rhythm', midi: m, len: 6, vel: humanize(r, 0.5), strum: i }),
        );
      }
    }
  }

  // The drop: a tremolo-picked slide down the low string, over the first half bar.
  if (gliss)
    notes.push({ step: 0, layer: 'gliss', midi: key + 36, len: 8, vel: 0.85, slide: -24, trem: true });

  // Lead: call (bars 0-1), response (2-3); bars 4-5 repeat the call, 6-7 answer it differently and
  // end on a chromatic run down into the top.
  const lo = key + 19;
  const hi = key + 41;
  const leadBars: RadioNote[][] = [];
  let prev = key + 24 + 7;
  for (let bar = 0; bar < bars; bar++) {
    const chord = prog[bar % prog.length]!;
    if (bar === 4 || bar === 5) {
      leadBars.push(leadBars[bar - 4]!.map((n) => ({ ...n, step: n.step + 4 * S })));
      continue;
    }
    const at = bar * S;
    const out: RadioNote[] = [];
    const chordPcs = [0, chord.minor ? 3 : 4, 7].map((iv) => (((chord.root + iv) % 12) + 12) % 12);
    const scale =
      form === 'phrygian'
        ? keyScale
        : !chord.minor && (((chord.root % 12) + 12) % 12 === 7 || chord.root === -5)
          ? HARMONIC_MINOR
          : keyScale;
    if (bar === bars - 1) {
      // Two beats of melody, then a chromatic sixteenth run down to the key's root.
      const top = nearestOf(chordPcs, key, prev, lo, hi);
      out.push({ step: at, layer: 'lead', midi: top, len: 8, vel: humanize(r, 0.85), trem: true });
      const start = key + 24 + 7;
      for (let k = 0; k < 8; k++)
        out.push({ step: at + 8 + k, layer: 'lead', midi: start - k, len: 1, vel: humanize(r, 0.75) });
      prev = start - 7;
      leadBars.push(out);
      continue;
    }
    const rhythm = pick(r, SURF_RHYTHMS);
    let s = 0;
    for (const len of rhythm) {
      if (!(gliss && bar === 0 && s < 8)) {
        let m: number;
        if (s % 8 === 0) m = nearestOf(chordPcs, key, prev + Math.round((r() - 0.5) * 6), lo, hi);
        else {
          const dir = prev > hi - 4 ? -1 : prev < lo + 4 ? 1 : r() < 0.5 ? -1 : 1;
          m = scaleStep(scale, key, prev, dir * (r() < 0.7 ? 1 : 2));
        }
        m = Math.min(hi, Math.max(lo, m));
        out.push({ step: at + s, layer: 'lead', midi: m, len, vel: humanize(r, 0.8), trem: len >= 4 });
        prev = m;
      }
      s += len;
    }
    leadBars.push(out);
  }
  for (const b of leadBars) notes.push(...b);

  return finish({ preset: 'surf-trio', seed, bpm, key, form, stepsPerBeat: 4, stepsPerBar: S, bars }, notes);
}

// ---------------------------------------------------------------------------------------------
// Rockabilly

/** Bars of a blues form as scale degrees (0 = I, 5 = IV, 7 = V). */
const ROCKABILLY_FORMS: Readonly<Record<string, readonly number[]>> = {
  twelve: [0, 0, 0, 0, 5, 5, 0, 0, 7, 5, 0, 7],
  quick: [0, 5, 0, 0, 5, 5, 0, 0, 7, 5, 0, 7],
  eight: [0, 0, 5, 5, 0, 7, 0, 7],
};
export const ROCKABILLY_FORMS_IDS = Object.keys(ROCKABILLY_FORMS);

/** The blues scale the licks use: major pentatonic plus the minor third and flat seventh. */
const BLUES_MAJOR = [0, 2, 3, 4, 7, 9, 10];
/** Swung-eighth positions in a 12-step (triplet) bar. */
const SWING = [0, 2, 3, 5, 6, 8, 9, 11];

function composeRockabilly(params: Readonly<Record<string, unknown>>, seed: number): Composition {
  const r = seededRandom(seed);
  const bpm = num(params['bpm'], 150, 205) ?? 160 + Math.floor(r() * 40);
  const keyName = typeof params['key'] === 'string' ? params['key'] : pick(r, ['E', 'A', 'G', 'C', 'D']);
  const key = keyRoot(keyName) ?? 40;
  const form = oneOf(params['form'], ROCKABILLY_FORMS_IDS) ?? pick(r, ROCKABILLY_FORMS_IDS);
  const degrees = ROCKABILLY_FORMS[form] ?? ROCKABILLY_FORMS['twelve']!;
  const band = oneOf(params['band'], ['slap', 'boogie'] as const) ?? pick(r, ['slap', 'boogie'] as const);
  const bars = degrees.length;
  const S = 12;
  const notes: RadioNote[] = [];

  // The licks: two call licks, the second used over the IV (blues licks sit on the key).
  const lo = key + 22;
  const hi = key + 41;
  const makeLick = (): RadioNote[] => {
    const out: RadioNote[] = [];
    let m = nearestOf([0, 4, 7], key, key + 24 + Math.floor(r() * 7), lo, hi);
    const count = 4 + Math.floor(r() * 4);
    const slots = [...SWING, ...SWING.map((p) => p + S)].filter(() => r() < 0.75).slice(0, count);
    if (slots.length === 0) slots.push(0);
    for (let i = 0; i < slots.length; i++) {
      const step = slots[i]!;
      const nextStep = slots[i + 1] ?? 2 * S;
      const dir = m > hi - 4 ? -1 : m < lo + 4 ? 1 : r() < 0.55 ? -1 : 1;
      m = i === 0 ? m : scaleStep(BLUES_MAJOR, key, m, dir * (r() < 0.75 ? 1 : 2));
      const pc = (((m - key) % 12) + 12) % 12;
      const note: RadioNote = {
        step,
        layer: 'lead',
        midi: m,
        len: Math.min(4, nextStep - step),
        vel: humanize(r, 0.8),
      };
      // The rockabilly bend: the minor third pushed up to the major.
      if (pc === 3) {
        note.midi = m + 1;
        note.slide = -1;
        m = m + 1;
      }
      out.push(note);
      // Sixths: the lick doubled a major sixth below, now and then.
      if (r() < 0.3)
        out.push({ step, layer: 'lead', midi: note.midi - 9, len: note.len, vel: note.vel * 0.8 });
    }
    // The last note rings into the next bar.
    const tail = out.at(-1);
    if (tail) tail.len = Math.max(tail.len, 2 * S - tail.step);
    return out;
  };
  const callA = makeLick();
  const callB = makeLick();
  const callBars = bars === 12 ? [0, 4, 8] : [0, 4];

  for (let bar = 0; bar < bars; bar++) {
    const deg = degrees[bar] ?? 0;
    const root = key + deg;
    const at = bar * S;
    const last = bar === bars - 1;
    // Drums: boom-chick with a shuffled ride; the last bar's back half is a triplet snare fill.
    if (bar === 0) notes.push({ step: at, layer: 'crash', midi: 0, len: 6, vel: 0.6 });
    for (const s of SWING) {
      if (last && s >= 6) continue;
      notes.push({
        step: at + s,
        layer: 'ride',
        midi: 0,
        len: 1,
        vel: humanize(r, s % 3 === 0 ? 0.7 : 0.45),
      });
    }
    notes.push({ step: at, layer: 'kick', midi: 0, len: 1, vel: humanize(r, 0.9) });
    notes.push({ step: at + 6, layer: 'kick', midi: 0, len: 1, vel: humanize(r, 0.8) });
    notes.push({ step: at + 3, layer: 'snare', midi: 0, len: 1, vel: humanize(r, 0.85) });
    if (last) {
      for (let s = 6; s < 12; s++)
        notes.push({
          step: at + s,
          layer: 'snare',
          midi: 0,
          len: 1,
          vel: humanize(r, 0.45 + 0.08 * (s - 6)),
        });
    } else {
      notes.push({ step: at + 9, layer: 'snare', midi: 0, len: 1, vel: humanize(r, 0.9) });
      notes.push({ step: at + 9, layer: 'brush', midi: 0, len: 2, vel: humanize(r, 0.5) });
    }

    // Bass.
    if (band === 'slap') {
      // Walking quarters (up the chord, then down), with the slap's click on every offbeat.
      const walk = bar % 2 === 0 ? [0, 4, 7, 9] : [10, 9, 7, 4];
      walk.forEach((iv, b) =>
        notes.push({ step: at + b * 3, layer: 'bass', midi: root + iv, len: 2, vel: humanize(r, 0.95) }),
      );
      for (let b = 0; b < 4; b++)
        notes.push({
          step: at + b * 3 + 2,
          layer: 'slap',
          midi: 0,
          len: 1,
          vel: humanize(r, b % 2 ? 0.9 : 0.6),
        });
    } else {
      // The boogie line on swung eighths: root, third, fifth, sixth, flat seven and back.
      const line = [0, 4, 7, 9, 10, 9, 7, 4];
      SWING.forEach((p, i) =>
        notes.push({
          step: at + p,
          layer: 'bass',
          midi: root + (line[i] ?? 0),
          len: p % 3 === 0 ? 2 : 1,
          vel: humanize(r, p % 3 === 0 ? 0.95 : 0.7),
        }),
      );
      for (const p of [3, 9])
        notes.push({ step: at + p + 2, layer: 'slap', midi: 0, len: 1, vel: humanize(r, 0.7) });
    }

    // Rhythm guitar.
    if (band === 'slap') {
      // Boogie double-stops: root with the fifth, then the sixth, on swung eighths.
      SWING.forEach((p) => {
        const beat = Math.floor(p / 3);
        const top = beat % 2 === 0 ? 7 : 9;
        const len = p % 3 === 0 ? 2 : 1;
        const vel = humanize(r, p % 3 === 0 ? 0.6 : 0.45);
        notes.push({ step: at + p, layer: 'rhythm', midi: root + 12, len, vel, strum: 0 });
        notes.push({ step: at + p, layer: 'rhythm', midi: root + 12 + top, len, vel, strum: 1 });
      });
    } else {
      // Dominant-seventh chops on the backbeat.
      for (const p of last ? [3] : [3, 9]) {
        [12, 16, 19, 22].forEach((iv, i) =>
          notes.push({
            step: at + p,
            layer: 'rhythm',
            midi: root + iv,
            len: 1,
            vel: humanize(r, 0.6),
            strum: i,
          }),
        );
      }
    }

    // Lead: the calls, and the turnaround in the last bar.
    const callIdx = callBars.indexOf(bar);
    if (callIdx >= 0) {
      const lick = callIdx === 2 ? callB : callIdx === 1 ? (bars === 12 ? callA : callB) : callA;
      for (const n of lick) notes.push({ ...n, step: n.step + at });
    }
    if (last) {
      // Fixed top root against a chromatic inner voice falling from the flat seventh to the fifth.
      [10, 9, 8, 7].forEach((iv, i) => {
        notes.push({ step: at + i * 3, layer: 'lead', midi: key + 24, len: 2, vel: humanize(r, 0.75) });
        notes.push({ step: at + i * 3, layer: 'lead', midi: key + 12 + iv, len: 2, vel: humanize(r, 0.7) });
      });
    }
  }

  return finish(
    { preset: 'rockabilly-trio', seed, bpm, key, form, stepsPerBeat: 3, stepsPerBar: S, bars },
    notes,
  );
}
