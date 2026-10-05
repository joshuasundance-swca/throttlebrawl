// The regional bands (playtest 2, 2026-10-02: "There should be different stations and music in
// different regions"; and "The music is impressive lol", so the code-made direction stays). The
// Keys keep surf and rockabilly (radio-compose.ts); the Pacific Northwest and San Francisco get
// bands of their own, each with its own tempo range, grid, harmony and instruments, so a region
// is recognisable within a bar:
// - `grunge-band` and `folk-band` (Pacific Northwest): their progressions are here; since playtest 4
//   (P4-17, "PNW seems very simple and slow") their songs are radio-compose-pnw.ts's.
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
export type Chord = { root: number; minor: boolean };
export const maj = (root: number): Chord => ({ root, minor: false });
export const min = (root: number): Chord => ({ root, minor: true });

export const S = 16; // sixteenths per bar, every regional band
export const BARS = 8;

const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10];
const PHRYGIAN_DOMINANT = [0, 1, 4, 5, 7, 8, 10];

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

export const chordPcs = (c: Chord, extra: readonly number[] = []) =>
  [0, c.minor ? 3 : 4, 7, ...extra].map((iv) => (((c.root + iv) % 12) + 12) % 12);
export const third = (c: Chord) => (c.minor ? 3 : 4);

/**
 * Composes San Francisco's two regional presets; null for a name this file does not know (the
 * Pacific Northwest's `grunge-band` and `folk-band` are radio-compose-pnw.ts's).
 */
export function composeRegional(
  preset: string,
  params: Readonly<Record<string, unknown>>,
  seed: number,
): Composition | null {
  if (preset === 'synth-band') return composeSynth(params, seed);
  if (preset === 'psych-band') return composePsych(params, seed);
  return null;
}

export interface Common {
  r: Rand;
  bpm: number;
  key: number;
  form: string;
  prog: readonly Chord[];
}

export function common(
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

export const drum = (step: number, layer: RadioNote['layer'], vel: number, midi = 0, len = 1): RadioNote => ({
  step,
  layer,
  midi,
  len,
  vel,
});

/** A walking melody for a bar: chord tones on strong steps, scale steps between. */
export function melodyBar(
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

/**
 * A phrase moved `steps` on, over another chord (playtest 4: a call answered, a hook brought back):
 * its rhythm and contour kept, its strong steps (every half bar) moved to the nearest tone of the new
 * chord and the rest to the nearest note of the scale, inside [lo, hi].
 */
export function refit(
  notes: readonly RadioNote[],
  steps: number,
  chord: Chord,
  key: number,
  scale: readonly number[],
  lo: number,
  hi: number,
): RadioNote[] {
  return notes.map((n) => ({
    ...n,
    step: n.step + steps,
    midi: nearestOf((n.step % S) % 8 === 0 ? chordPcs(chord) : scale, key, n.midi, lo, hi),
  }));
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
