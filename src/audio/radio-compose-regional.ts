// The regional bands (playtest 2, 2026-10-02: "There should be different stations and music in
// different regions"; and "The music is impressive lol", so the code-made direction stays). The
// Keys keep surf and rockabilly (radio-compose.ts); the Pacific Northwest and San Francisco get
// bands of their own, each with its own tempo range, grid, harmony and instruments, so a region
// is recognisable within a bar:
// - `grunge-band` (Pacific Northwest): 92-132 bpm, a quiet verse (clean arpeggios, a sung-style
//   lead with slides) into a loud chorus (distorted power-chord chugs, open cymbals, bends), on
//   drop-tuned keys and heavy, modal or chromatic riffs.
// - `folk-band` (Pacific Northwest): 92-128 bpm in a major key. Foot stomps and claps, a
//   tambourine, a strummed acoustic guitar (down and up strokes), an upright bass, a glockenspiel
//   tune and, in the second half, banjo rolls.
// - `synth-band` (San Francisco): 98-126 bpm in a minor key. A drum machine (four on the floor,
//   claps, sixteenth hats, open hats), an octave-pumping saw bass, a held pad, a sixteenth arpeggio
//   and a gliding lead, all into a dotted-eighth echo.
// - `psych-band` (San Francisco): 100-130 bpm in a mode (Mixolydian, Dorian, Phrygian dominant or
//   a minor descent). A phased, tremolo organ, a melodic bass, ride and tambourine, and a fuzz
//   lead that bends, trills and runs up the scale.
//
// Like the Keys' bands, every melody is a seeded random walk over chord tones and the scale, so the
// songs are original by construction. Pure; radio-rigs.ts plays them.
import type { Composition, RadioNote } from './radio-compose';
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
  type Rand,
} from './radio-util';

export const REGIONAL_PRESETS = ['grunge-band', 'folk-band', 'synth-band', 'psych-band'] as const;
export type RegionalPreset = (typeof REGIONAL_PRESETS)[number];

/** A chord: its root in semitones from the key, and whether it is minor. */
type Chord = { root: number; minor: boolean };
const maj = (root: number): Chord => ({ root, minor: false });
const min = (root: number): Chord => ({ root, minor: true });

const S = 16; // sixteenths per bar, every regional band
const BARS = 8;

const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10];
const PHRYGIAN_DOMINANT = [0, 1, 4, 5, 7, 8, 10];
const MINOR_PENTA = [0, 3, 5, 7, 10];
const MAJOR_PENTA = [0, 2, 4, 7, 9];

export const GRUNGE_FORMS: Readonly<Record<string, readonly Chord[]>> = {
  // i bIII IV bV: the tritone at the end is the sludge.
  sludge: [min(0), maj(3), maj(5), maj(6)],
  // i i bVII bVI: the slow fall.
  drop: [min(0), min(0), maj(-2), maj(-4)],
  // i IV bIII bVII.
  heave: [min(0), maj(5), maj(3), maj(-2)],
  // i bII i bVII: chromatic grind.
  grind: [min(0), maj(1), min(0), maj(-2)],
};
export const FOLK_FORMS: Readonly<Record<string, readonly Chord[]>> = {
  // I V vi IV, I IV vi V, vi IV I V, I iii IV I.
  campfire: [maj(0), maj(7), min(9), maj(5)],
  lift: [maj(0), maj(5), min(9), maj(7)],
  rain: [min(9), maj(5), maj(0), maj(7)],
  hymn: [maj(0), min(4), maj(5), maj(0)],
};
export const SYNTH_FORMS: Readonly<Record<string, readonly Chord[]>> = {
  // i bVI bIII bVII, i bVII bVI bVII, bVI bVII i i, i bIII bVII iv.
  night: [min(0), maj(-4), maj(3), maj(-2)],
  drive: [min(0), maj(-2), maj(-4), maj(-2)],
  neon: [maj(-4), maj(-2), min(0), min(0)],
  pulse: [min(0), maj(3), maj(-2), min(5)],
};
export const PSYCH_FORMS: Readonly<Record<string, readonly Chord[]>> = {
  // I bVII IV I (Mixolydian), i IV i IV (Dorian), I bII I bII (Phrygian dominant), i bVII bVI V.
  mixo: [maj(0), maj(-2), maj(5), maj(0)],
  dorian: [min(0), maj(5), min(0), maj(5)],
  raga: [maj(0), maj(1), maj(0), maj(1)],
  descent: [min(0), maj(-2), maj(-4), maj(-5)],
};
const PSYCH_SCALES: Readonly<Record<string, readonly number[]>> = {
  mixo: MIXOLYDIAN,
  dorian: DORIAN,
  raga: PHRYGIAN_DOMINANT,
  descent: AEOLIAN,
};

const chordPcs = (c: Chord, extra: readonly number[] = []) =>
  [0, c.minor ? 3 : 4, 7, ...extra].map((iv) => (((c.root + iv) % 12) + 12) % 12);
const third = (c: Chord) => (c.minor ? 3 : 4);

/** Composes a regional preset; null for a name this file does not know. */
export function composeRegional(
  preset: string,
  params: Readonly<Record<string, unknown>>,
  seed: number,
): Composition | null {
  if (preset === 'grunge-band') return composeGrunge(params, seed);
  if (preset === 'folk-band') return composeFolk(params, seed);
  if (preset === 'synth-band') return composeSynth(params, seed);
  if (preset === 'psych-band') return composePsych(params, seed);
  return null;
}

interface Common {
  r: Rand;
  bpm: number;
  key: number;
  form: string;
  prog: readonly Chord[];
}

function common(
  params: Readonly<Record<string, unknown>>,
  seed: number,
  bpm: [number, number],
  keys: readonly string[],
  forms: Readonly<Record<string, readonly Chord[]>>,
): Common {
  const r = seededRandom(seed);
  const tempo = num(params['bpm'], bpm[0], bpm[1]) ?? bpm[0] + Math.floor(r() * (bpm[1] - bpm[0]));
  const keyName = typeof params['key'] === 'string' ? params['key'] : pick(r, keys);
  const key = keyRoot(keyName) ?? 40;
  const ids = Object.keys(forms);
  const form = oneOf(params['progression'], ids) ?? pick(r, ids);
  const prog = forms[form] ?? forms[ids[0]!]!;
  return { r, bpm: tempo, key, form, prog };
}

const drum = (step: number, layer: RadioNote['layer'], vel: number, midi = 0, len = 1): RadioNote => ({
  step,
  layer,
  midi,
  len,
  vel,
});

/** A walking melody for a bar: chord tones on strong steps, scale steps between. */
function melodyBar(
  r: Rand,
  at: number,
  rhythm: readonly number[],
  chord: Chord,
  key: number,
  scale: readonly number[],
  prev: number,
  lo: number,
  hi: number,
  layer: RadioNote['layer'],
  vel: number,
): { notes: RadioNote[]; last: number } {
  const out: RadioNote[] = [];
  let s = 0;
  let m = prev;
  const pcs = chordPcs(chord);
  for (const len of rhythm) {
    if (len < 0) {
      s -= len; // a rest
      continue;
    }
    if (s % 8 === 0) m = nearestOf(pcs, key, m + Math.round((r() - 0.5) * 5), lo, hi);
    else {
      const dir = m > hi - 3 ? -1 : m < lo + 3 ? 1 : r() < 0.5 ? -1 : 1;
      m = Math.min(hi, Math.max(lo, scaleStep(scale, key, m, dir * (r() < 0.75 ? 1 : 2))));
    }
    out.push({ step: at + s, layer, midi: m, len, vel: humanize(r, vel) });
    s += len;
  }
  return { notes: out, last: m };
}

// ---------------------------------------------------------------------------------------------
// Grunge

const GRUNGE_VERSE_RHYTHMS: readonly (readonly number[])[] = [
  [8, 8],
  [-4, 4, 8],
  [6, 2, 8],
  [-2, 6, 8],
  [12, 4],
];

function composeGrunge(params: Readonly<Record<string, unknown>>, seed: number): Composition {
  const { r, bpm, key, form, prog } = common(
    params,
    seed,
    [92, 132],
    ['D', 'E', 'C#', 'B', 'G', 'A'],
    GRUNGE_FORMS,
  );
  const notes: RadioNote[] = [];
  // The verse's sung-style lead: two bars written, the next two vary them.
  const lo = key + 19;
  const hi = key + 34;
  let prev = key + 24;
  const verseLead: RadioNote[][] = [];

  for (let bar = 0; bar < BARS; bar++) {
    const chord = prog[bar % prog.length]!;
    const next = prog[(bar + 1) % prog.length]!;
    const root = key + chord.root;
    const at = bar * S;
    const loud = bar >= 4;
    const last = bar === BARS - 1;

    // Drums: a half-time-feel verse, then the chorus hits hard with open cymbals.
    if (bar === 0 || bar === 4) notes.push(drum(at, 'crash', bar === 4 ? 0.9 : 0.5, 0, 12));
    for (let s = 0; s < S; s++) {
      if (last && s >= 12) {
        notes.push(drum(at + s, 'tom', humanize(r, 0.85), 50 - 3 * (s - 12)));
        continue;
      }
      const kick =
        s === 0 || s === 8 || (loud && (s === 3 || s === 10)) || (!loud && s === 11 && bar % 2 === 1);
      if (kick) notes.push(drum(at + s, 'kick', humanize(r, loud ? 0.95 : 0.8)));
      if (s === 4 || s === 12) notes.push(drum(at + s, 'snare', humanize(r, loud ? 0.95 : 0.6)));
      if (s % 2 === 0) {
        if (loud) notes.push(drum(at + s, 'openhat', humanize(r, s % 4 === 0 ? 0.6 : 0.45)));
        else notes.push(drum(at + s, 'hat', humanize(r, s % 4 === 0 ? 0.5 : 0.3)));
      }
    }

    // Bass: held roots in the verse, driving eighths with the guitar in the chorus.
    if (loud) {
      for (let e = 0; e < 8; e++) {
        if (last && e >= 6) break;
        let m = root;
        if (e === 7 && next.root !== chord.root) m = key + next.root + (next.root > chord.root ? -1 : 1);
        notes.push({
          step: at + e * 2,
          layer: 'bass',
          midi: m,
          len: 2,
          vel: humanize(r, e % 2 ? 0.75 : 0.95),
        });
      }
    } else {
      notes.push({ step: at, layer: 'bass', midi: root, len: 6, vel: humanize(r, 0.9) });
      notes.push({ step: at + 6, layer: 'bass', midi: root, len: 2, vel: humanize(r, 0.6) });
      notes.push({ step: at + 8, layer: 'bass', midi: root + 7, len: 6, vel: humanize(r, 0.8) });
    }

    if (loud) {
      // Power chords (root, fifth, octave) chugged on eighths, accents on the beat; the last bar rings.
      const shape = [12, 19, 24];
      const hits = last ? [0] : [0, 2, 4, 6, 8, 10, 12, 14];
      for (const s of hits) {
        const ring = last || s === 0 || s === 8;
        shape.forEach((iv, i) =>
          notes.push({
            step: at + s,
            layer: 'rhythm',
            midi: root + iv,
            len: last ? 12 : ring ? 2 : 1,
            vel: humanize(r, s % 4 === 0 ? 0.85 : 0.6),
            strum: i,
          }),
        );
      }
      // The chorus lead: long bent notes over the wall.
      if (bar === 5 || bar === 6) {
        const top = nearestOf(chordPcs(chord), key, key + 31 + (bar === 6 ? 2 : 0), key + 26, key + 38);
        notes.push({ step: at, layer: 'lead', midi: top, len: 8, vel: humanize(r, 0.8), slide: -2 });
        const down = scaleStep(MINOR_PENTA, key, top, -1);
        notes.push({ step: at + 8, layer: 'lead', midi: down, len: 6, vel: humanize(r, 0.7), slide: -1 });
      }
    } else {
      // Clean arpeggio: up through the chord and back, eighths.
      const arp = [12, 19, 24, 24 + third(chord), 24, 19, 12 + third(chord), 19];
      arp.forEach((iv, e) =>
        notes.push({
          step: at + e * 2,
          layer: 'arp',
          midi: root + iv,
          len: 3,
          vel: humanize(r, e === 0 ? 0.7 : 0.5),
        }),
      );
      // The sung line, in bars 1-3 (bar 3 echoes bar 1).
      if (bar === 3) verseLead.push(verseLead[0]!.map((n) => ({ ...n, step: n.step + 2 * S })));
      else if (bar > 0) {
        const { notes: line, last: end } = melodyBar(
          r,
          at,
          pick(r, GRUNGE_VERSE_RHYTHMS),
          chord,
          key,
          MINOR_PENTA,
          prev,
          lo,
          hi,
          'lead',
          0.6,
        );
        for (const n of line) if (r() < 0.4 && n.len >= 4) n.slide = -2;
        verseLead.push(line);
        prev = end;
      }
    }
  }
  for (const b of verseLead) notes.push(...b);
  return finish(
    { preset: 'grunge-band', seed, bpm, key, form, stepsPerBeat: 4, stepsPerBar: S, bars: BARS },
    notes,
  );
}

// ---------------------------------------------------------------------------------------------
// Indie folk

const FOLK_RHYTHMS: readonly (readonly number[])[] = [
  [4, 4, 8],
  [2, 2, 4, 8],
  [4, 2, 2, 4, 4],
  [6, 2, 4, 4],
  [8, 4, 4],
];
/** Down (true) and up strokes of the strum, on sixteenths. */
const STRUM: readonly [number, boolean][] = [
  [0, true],
  [4, true],
  [6, false],
  [10, false],
  [12, true],
  [14, false],
];

function composeFolk(params: Readonly<Record<string, unknown>>, seed: number): Composition {
  const { r, bpm, key, form, prog } = common(params, seed, [92, 128], ['G', 'C', 'D', 'A', 'F'], FOLK_FORMS);
  const notes: RadioNote[] = [];
  const lo = key + 31;
  const hi = key + 50;
  let prev = key + 36 + 4;
  const tune: RadioNote[][] = [];

  for (let bar = 0; bar < BARS; bar++) {
    const chord = prog[bar % prog.length]!;
    const root = key + chord.root;
    const at = bar * S;
    const full = bar >= 2;
    const last = bar === BARS - 1;

    // Stomp and clap, the tambourine joining after the intro.
    for (const s of [0, 8]) notes.push(drum(at + s, 'kick', humanize(r, 0.9)));
    if (full && bar % 2 === 1) notes.push(drum(at + 10, 'kick', humanize(r, 0.6)));
    for (const s of last ? [4, 12, 13, 14, 15] : [4, 12])
      notes.push(drum(at + s, 'clap', humanize(r, s > 12 ? 0.6 : 0.85)));
    if (full)
      for (let s = 0; s < S; s += 2) notes.push(drum(at + s, 'tamb', humanize(r, s % 4 === 2 ? 0.6 : 0.35)));

    // The strum: five strings, down strokes from the low string, up strokes from the high one.
    const voicing = [12, 19, 24, 24 + third(chord), 31];
    for (const [s, down] of STRUM) {
      voicing.forEach((iv, i) =>
        notes.push({
          step: at + s,
          layer: 'rhythm',
          midi: root + iv,
          len: 2,
          vel: humanize(r, down ? 0.62 : 0.42),
          strum: down ? i : voicing.length - 1 - i,
        }),
      );
    }

    // Upright bass: root and fifth, walking into the next chord.
    if (full) {
      const next = prog[(bar + 1) % prog.length]!;
      notes.push({ step: at, layer: 'bass', midi: root, len: 6, vel: humanize(r, 0.9) });
      notes.push({ step: at + 8, layer: 'bass', midi: root + 7, len: 4, vel: humanize(r, 0.8) });
      const approach = key + next.root + (next.root >= chord.root ? -2 : 2);
      notes.push({ step: at + 12, layer: 'bass', midi: approach, len: 4, vel: humanize(r, 0.7) });
    }

    // Banjo rolls in the second half: a forward roll over the chord.
    if (bar >= 4 && !last) {
      const roll = [24, 24 + third(chord), 31, 36];
      const order = [0, 1, 2, 0, 1, 2, 0, 3, 0, 1, 2, 0, 1, 2, 0, 3];
      order.forEach((k, s) =>
        notes.push({
          step: at + s,
          layer: 'arp',
          midi: root + roll[k]!,
          len: 1,
          vel: humanize(r, s % 4 === 0 ? 0.55 : 0.4),
        }),
      );
    }

    // The glockenspiel tune: call (bars 0-1), answer (2-3); 4-5 repeat the call, 6-7 answer anew.
    if (bar === 4 || bar === 5) {
      tune.push(tune[bar - 4]!.map((n) => ({ ...n, step: n.step + 4 * S })));
      continue;
    }
    if (last) {
      const home = nearestOf([0, 4, 7], key, prev, lo, hi);
      tune.push([{ step: at, layer: 'glock', midi: home, len: 12, vel: humanize(r, 0.75) }]);
      continue;
    }
    const { notes: line, last: end } = melodyBar(
      r,
      at,
      pick(r, FOLK_RHYTHMS),
      chord,
      key,
      MAJOR_PENTA,
      prev,
      lo,
      hi,
      'glock',
      0.75,
    );
    tune.push(line);
    prev = end;
  }
  for (const b of tune) notes.push(...b);
  return finish(
    { preset: 'folk-band', seed, bpm, key, form, stepsPerBeat: 4, stepsPerBar: S, bars: BARS },
    notes,
  );
}

// ---------------------------------------------------------------------------------------------
// Synth

const SYNTH_LEAD_RHYTHMS: readonly (readonly number[])[] = [
  [8, 8],
  [6, 6, 4],
  [4, 4, 8],
  [12, 4],
  [-4, 4, 8],
];

function composeSynth(params: Readonly<Record<string, unknown>>, seed: number): Composition {
  const { r, bpm, key, form, prog } = common(
    params,
    seed,
    [98, 126],
    ['A', 'E', 'F#', 'C#', 'D', 'B'],
    SYNTH_FORMS,
  );
  const notes: RadioNote[] = [];
  const arpShape = pick(r, ['up', 'updown', 'skip'] as const);
  const lo = key + 24;
  const hi = key + 41;
  let prev = key + 31;

  for (let bar = 0; bar < BARS; bar++) {
    const chord = prog[bar % prog.length]!;
    const root = key + chord.root;
    const at = bar * S;
    const last = bar === BARS - 1;

    // The drum machine: four on the floor, claps on two and four, hats, open hats in the back half.
    if (bar === 4) notes.push(drum(at, 'crash', 0.6, 0, 12));
    for (let s = 0; s < S; s++) {
      if (s % 4 === 0) notes.push(drum(at + s, 'kick', humanize(r, 0.95)));
      if (s === 4 || s === 12) notes.push(drum(at + s, 'clap', humanize(r, 0.85)));
      if (last && s >= 12) notes.push(drum(at + s, 'clap', humanize(r, 0.5 + 0.1 * (s - 12))));
      const hats = bar >= 2 ? true : s % 2 === 0;
      if (hats && s % 4 !== 2) notes.push(drum(at + s, 'hat', humanize(r, s % 2 === 0 ? 0.55 : 0.32)));
      if (bar >= 4 && s % 4 === 2) notes.push(drum(at + s, 'openhat', humanize(r, 0.5)));
    }

    // The bass pumps octaves on eighths.
    for (let e = 0; e < 8; e++)
      notes.push({
        step: at + e * 2,
        layer: 'bass',
        midi: root + (e % 2 ? 12 : 0),
        len: 2,
        vel: humanize(r, e % 2 ? 0.7 : 0.9),
      });

    // The pad holds the chord all bar.
    [12, 12 + third(chord), 19, 24].forEach((iv) =>
      notes.push({ step: at, layer: 'pad', midi: root + iv, len: S, vel: 0.55 }),
    );

    // The arpeggio, from bar 2.
    if (bar >= 2) {
      const tones = [24, 24 + third(chord), 31, 36];
      for (let s = 0; s < S; s++) {
        const k =
          arpShape === 'up'
            ? s % 4
            : arpShape === 'updown'
              ? [0, 1, 2, 3, 2, 1][s % 6]!
              : [0, 2, 1, 3][s % 4]!;
        notes.push({
          step: at + s,
          layer: 'arp',
          midi: root + tones[k]!,
          len: 1,
          vel: humanize(r, s % 4 === 0 ? 0.6 : 0.42),
        });
      }
    }

    // The lead glides in for the back half.
    if (bar >= 4) {
      const { notes: line, last: end } = melodyBar(
        r,
        at,
        pick(r, SYNTH_LEAD_RHYTHMS),
        chord,
        key,
        AEOLIAN,
        prev,
        lo,
        hi,
        'lead',
        0.7,
      );
      for (const n of line) if (r() < 0.35) n.slide = r() < 0.5 ? -2 : 2;
      notes.push(...line);
      prev = end;
    }
  }
  return finish(
    { preset: 'synth-band', seed, bpm, key, form, stepsPerBeat: 4, stepsPerBar: S, bars: BARS },
    notes,
  );
}

// ---------------------------------------------------------------------------------------------
// Psych

const PSYCH_RHYTHMS: readonly (readonly number[])[] = [
  [6, 2, 8],
  [4, 4, 4, 4],
  [2, 2, 4, 8],
  [8, 2, 2, 4],
  [12, 4],
];

function composePsych(params: Readonly<Record<string, unknown>>, seed: number): Composition {
  const { r, bpm, key, form, prog } = common(
    params,
    seed,
    [100, 130],
    ['E', 'A', 'D', 'G', 'B'],
    PSYCH_FORMS,
  );
  const scale = PSYCH_SCALES[form] ?? MIXOLYDIAN;
  const notes: RadioNote[] = [];
  const lo = key + 22;
  const hi = key + 41;
  let prev = key + 31;

  for (let bar = 0; bar < BARS; bar++) {
    const chord = prog[bar % prog.length]!;
    const next = prog[(bar + 1) % prog.length]!;
    const root = key + chord.root;
    const at = bar * S;
    const last = bar === BARS - 1;

    // Drums: a loose groove, ride eighths, tambourine sixteenths, a tom fill at the end.
    if (bar === 0 || bar === 4) notes.push(drum(at, 'crash', 0.6, 0, 12));
    for (let s = 0; s < S; s++) {
      if (last && s >= 8) {
        if (s % 2 === 0) notes.push(drum(at + s, 'tom', humanize(r, 0.8), 52 - (s - 8)));
        continue;
      }
      if (s === 0 || s === 6 || s === 8 || (bar % 2 === 1 && s === 14))
        notes.push(drum(at + s, 'kick', humanize(r, 0.88)));
      if (s === 4 || s === 12) notes.push(drum(at + s, 'snare', humanize(r, 0.85)));
      if (s % 2 === 0) notes.push(drum(at + s, 'ride', humanize(r, s % 4 === 0 ? 0.6 : 0.42)));
      notes.push(drum(at + s, 'tamb', humanize(r, s % 4 === 2 ? 0.5 : 0.22)));
    }

    // The melodic bass: root, octave, flat seven, fifth, with an approach into the next chord.
    const line = [0, 0, 12, 10, 7, 7, 5, 7];
    for (let e = 0; e < 8; e++) {
      if (last && e >= 4) break;
      let m = root + (line[e] ?? 0);
      if (e === 7 && next.root !== chord.root) m = key + next.root + (next.root > chord.root ? -1 : 1);
      notes.push({ step: at + e * 2, layer: 'bass', midi: m, len: 2, vel: humanize(r, e % 2 ? 0.7 : 0.9) });
    }

    // The organ holds the chord in half bars, the drone (the key's root) underneath.
    for (const s of last ? [0] : [0, 8]) {
      [12, 12 + third(chord), 19, 24].forEach((iv) =>
        notes.push({ step: at + s, layer: 'organ', midi: root + iv, len: 8, vel: humanize(r, 0.55) }),
      );
      notes.push({ step: at + s, layer: 'organ', midi: key, len: 8, vel: 0.35 });
    }

    // The fuzz lead: phrases in bars 2-3 and 6-7, a run up the mode in bar 5.
    if (bar === 5) {
      let m = nearestOf(chordPcs(chord), key, key + 26, lo, hi);
      for (let s = 0; s < S; s++) {
        notes.push({ step: at + s, layer: 'lead', midi: m, len: 1, vel: humanize(r, 0.7) });
        m = Math.min(hi, scaleStep(scale, key, m, 1));
      }
      prev = m;
    } else if (bar === 2 || bar === 3 || bar === 6 || bar === 7) {
      const { notes: phrase, last: end } = melodyBar(
        r,
        at,
        pick(r, PSYCH_RHYTHMS),
        chord,
        key,
        scale,
        prev,
        lo,
        hi,
        'lead',
        0.78,
      );
      const trills: RadioNote[] = [];
      for (const n of phrase) {
        // Bends into the long notes; a trill on a short one now and then.
        if (n.len >= 6 && r() < 0.6) n.slide = -2;
        else if (n.len === 2 && r() < 0.3) {
          n.len = 1;
          trills.push({ ...n, step: n.step + 1, midi: scaleStep(scale, key, n.midi, 1) });
        }
      }
      notes.push(...phrase, ...trills);
      prev = end;
    }
  }
  return finish(
    { preset: 'psych-band', seed, bpm, key, form, stepsPerBeat: 4, stepsPerBar: S, bars: BARS },
    notes,
  );
}
