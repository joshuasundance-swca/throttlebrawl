// Six more bands (run W-Q "career and freedom", audio lane; interview 2026-10-02 round 6: "More
// code-made music only": more stations per region in clearly different genres, plus a hidden pirate
// station per region; and "The music is impressive", so the code-made direction stays). Like the
// others, every melody is a seeded random walk over chord tones and the scale, so every song is
// original by construction; this file is pure, radio-rigs-more.ts plays it.
//
// The Keys:
// - `island-band`: calypso, 100-124 bpm, major. Bass tumbao, congas, a shaker, offbeat nylon-guitar
//   chops and a steel-pan tune that answers itself.
// - `dub-band` (the Keys' pirate): 66-82 bpm, minor. One-drop (kick and rim on beat three only), a
//   deep melodic sub bass, offbeat skanks and a sparse melodica, all thrown into an echo.
// The Pacific Northwest:
// - `stoner-band`: 62-88 bpm. A two-bar fuzz riff on the minor pentatonic repeated until the wah
//   solo, over half-time drums and a doubled bass.
// - `ambient-band` (the Pacific Northwest's pirate): 54-68 bpm, no drums. Long maj7/add9 pads, a
//   drone, sparse bells and a breathy low line, drifting like fog off the sound.
// San Francisco:
// - `funk-band`: 104-122 bpm. A syncopated kit with ghost notes, a 16th-note slap-style bass, chicken
//   scratch guitar and a horn riff.
// - `chip-band` (San Francisco's pirate): 138-164 bpm, minor. A pulse lead, a pulse arpeggio, a
//   triangle bass and a noise kit, the sound of a game console.
import type { Composition, RadioNote } from './radio-compose';
import {
  BARS,
  common,
  chordPcs,
  drum,
  maj,
  melodyBar,
  min,
  S,
  third,
  type Chord,
} from './radio-compose-regional';
import { finish, humanize, nearestOf, oneOf, pick, scaleStep } from './radio-util';

export const MORE_PRESETS = [
  'island-band',
  'dub-band',
  'stoner-band',
  'ambient-band',
  'funk-band',
  'chip-band',
] as const;
export type MorePreset = (typeof MORE_PRESETS)[number];

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MAJOR_PENTA = [0, 2, 4, 7, 9];
const MINOR_PENTA = [0, 3, 5, 7, 10];
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];

export const ISLAND_FORMS: Readonly<Record<string, readonly Chord[]>> = {
  // I IV I V, I vi IV V, I V IV I, IV I V I.
  breeze: [maj(0), maj(5), maj(0), maj(7)],
  sunset: [maj(0), min(9), maj(5), maj(7)],
  carnival: [maj(0), maj(7), maj(5), maj(0)],
  tide: [maj(5), maj(0), maj(7), maj(0)],
};
export const DUB_FORMS: Readonly<Record<string, readonly Chord[]>> = {
  // i bVII i bVII, i iv i V, i bVI bVII i, bVII i bVI i.
  steady: [min(0), maj(-2), min(0), maj(-2)],
  roots: [min(0), min(5), min(0), maj(7)],
  dread: [min(0), maj(-4), maj(-2), min(0)],
  lion: [maj(-2), min(0), maj(-4), min(0)],
};
export const STONER_FORMS: Readonly<Record<string, readonly Chord[]>> = {
  // i bVI (the two-bar doom), i bV (the tritone), i bVII bVI bVII, i bIII bVII IV.
  doom: [min(0), maj(-4), min(0), maj(-4)],
  tritone: [min(0), maj(6), min(0), maj(6)],
  desert: [min(0), maj(-2), maj(-4), maj(-2)],
  haze: [min(0), maj(3), maj(-2), maj(5)],
};
export const AMBIENT_FORMS: Readonly<Record<string, readonly Chord[]>> = {
  // IV I IV I, I vi IV I, vi IV I IV, I IV vi IV: the lydian lean of a foghorn's far shore.
  fog: [maj(5), maj(0), maj(5), maj(0)],
  ferry: [maj(0), min(9), maj(5), maj(0)],
  moss: [min(9), maj(5), maj(0), maj(5)],
  tide: [maj(0), maj(5), min(9), maj(5)],
};
export const FUNK_FORMS: Readonly<Record<string, readonly Chord[]>> = {
  // i i IV i, i bVII i IV, i i bVII IV, i bIII IV i.
  vamp: [min(0), min(0), maj(5), min(0)],
  rush: [min(0), maj(-2), min(0), maj(5)],
  pocket: [min(0), min(0), maj(-2), maj(5)],
  mine: [min(0), maj(3), maj(5), min(0)],
};
export const CHIP_FORMS: Readonly<Record<string, readonly Chord[]>> = {
  // i bVI bIII bVII, i bII i V, i iv V i, bVI bVII i i.
  level: [min(0), maj(-4), maj(3), maj(-2)],
  boss: [min(0), maj(1), min(0), maj(7)],
  castle: [min(0), min(5), maj(7), min(0)],
  title: [maj(-4), maj(-2), min(0), min(0)],
};

/** Composes one of the six bands; null for a name this file does not know. */
export function composeMore(
  preset: string,
  params: Readonly<Record<string, unknown>>,
  seed: number,
): Composition | null {
  switch (preset) {
    case 'island-band':
      return composeIsland(params, seed);
    case 'dub-band':
      return composeDub(params, seed);
    case 'stoner-band':
      return composeStoner(params, seed);
    case 'ambient-band':
      return composeAmbient(params, seed);
    case 'funk-band':
      return composeFunk(params, seed);
    case 'chip-band':
      return composeChip(params, seed);
    default:
      return null;
  }
}

const base = (preset: MorePreset, seed: number, c: { bpm: number; key: number; form: string }) => ({
  preset,
  seed,
  bpm: c.bpm,
  key: c.key,
  form: c.form,
  stepsPerBeat: 4 as const,
  stepsPerBar: S,
  bars: BARS,
});

// ---------------------------------------------------------------------------------------------
// Island (calypso)

const ISLAND_RHYTHMS: readonly (readonly number[])[] = [
  [3, 3, 2, 3, 3, 2],
  [3, 3, 4, 3, 3],
  [2, 2, 4, 2, 2, 4],
  [6, 2, 4, 4],
  [4, 3, 3, 6],
];

function composeIsland(params: Readonly<Record<string, unknown>>, seed: number): Composition {
  const { r, bpm, key, form, prog } = common(
    params,
    seed,
    [100, 124],
    ['C', 'G', 'D', 'F', 'A'],
    ISLAND_FORMS,
  );
  const notes: RadioNote[] = [];
  const lo = key + 31;
  const hi = key + 48;
  let prev = key + 36 + 4;
  const tune: RadioNote[][] = [];

  for (let bar = 0; bar < BARS; bar++) {
    const chord = prog[bar % prog.length]!;
    const root = key + chord.root;
    const at = bar * S;
    const full = bar >= 2;
    const last = bar === BARS - 1;

    // Kick and congas: the boom-chick-a-boom pulse; the high congas fill the gaps.
    for (const s of [0, 6, 8, ...(bar % 2 ? [14] : [])]) notes.push(drum(at + s, 'kick', humanize(r, 0.85)));
    for (const s of [0, 6, 8, 14]) notes.push(drum(at + s, 'conga', humanize(r, 0.8), 60));
    for (const s of full ? [2, 4, 7, 10, 12, 15] : [4, 12])
      notes.push(drum(at + s, 'conga', humanize(r, s % 4 === 0 ? 0.85 : 0.6), 72));
    // The shaker: steady eighths, a lean on the beat.
    for (let s = 0; s < S; s += 2) notes.push(drum(at + s, 'tamb', humanize(r, s % 4 === 0 ? 0.55 : 0.35)));

    // Bass tumbao: root, the fifth on the "a" of two, root, and a leap.
    const next = prog[(bar + 1) % prog.length]!;
    notes.push({ step: at, layer: 'bass', midi: root, len: 5, vel: humanize(r, 0.9) });
    notes.push({ step: at + 6, layer: 'bass', midi: root + 7, len: 2, vel: humanize(r, 0.75) });
    notes.push({ step: at + 8, layer: 'bass', midi: root, len: 5, vel: humanize(r, 0.85) });
    notes.push({
      step: at + 14,
      layer: 'bass',
      midi:
        bar === BARS - 1 ? root : key + next.root + (next.root >= chord.root ? -1 : 1) + (r() < 0.5 ? 0 : 0),
      len: 2,
      vel: humanize(r, 0.7),
    });

    // Nylon-guitar chops on the offbeats, a ghost between.
    const voicing = [12, 16 - (chord.minor ? 1 : 0), 19, 24];
    for (const [s, v] of [
      [4, 0.65],
      [10, 0.4],
      [12, 0.65],
    ] as const) {
      voicing.forEach((iv, i) =>
        notes.push({ step: at + s, layer: 'rhythm', midi: root + iv, len: 2, vel: humanize(r, v), strum: i }),
      );
    }

    // The steel pan: a tune that answers itself (bars 2-3 call, 4-5 repeat, 6 answers, 7 lands home).
    if (bar === 4 || bar === 5) {
      tune.push(tune[bar - 4]!.map((n) => ({ ...n, step: n.step + 2 * S })));
      continue;
    }
    if (last) {
      const home = nearestOf([0, 4, 7], key, prev, lo, hi);
      tune.push([
        { step: at, layer: 'steel', midi: home, len: 3, vel: humanize(r, 0.85) },
        {
          step: at + 3,
          layer: 'steel',
          midi: home + 12 > hi ? home : home + 12,
          len: 3,
          vel: humanize(r, 0.7),
        },
        { step: at + 6, layer: 'steel', midi: home, len: 10, vel: humanize(r, 0.8) },
      ]);
      continue;
    }
    if (full) {
      const { notes: line, last: end } = melodyBar(
        r,
        at,
        pick(r, ISLAND_RHYTHMS),
        chord,
        key,
        MAJOR_PENTA,
        prev,
        lo,
        hi,
        'steel',
        0.75,
      );
      tune.push(line);
      prev = end;
    }
  }
  for (const b of tune) notes.push(...b);
  return finish(base('island-band', seed, { bpm, key, form }), notes);
}

// ---------------------------------------------------------------------------------------------
// Dub (the Keys' pirate)

const DUB_BASS: readonly (readonly [number, number, number])[][] = [
  // [step, interval above the root, length]
  [
    [0, 0, 5],
    [6, 0, 2],
    [8, 7, 4],
    [14, 10, 2],
  ],
  [
    [0, 0, 3],
    [4, 0, 2],
    [8, 5, 4],
    [12, 7, 4],
  ],
  [
    [0, 0, 6],
    [8, 0, 3],
    [11, 3, 2],
    [14, 5, 2],
  ],
];
const DUB_MELODICA: readonly (readonly number[])[] = [
  [8, 8],
  [12, -4],
  [4, 4, 8],
  [-4, 4, 8],
  [6, 2, 8],
];

function composeDub(params: Readonly<Record<string, unknown>>, seed: number): Composition {
  const { r, bpm, key, form, prog } = common(params, seed, [66, 82], ['A', 'D', 'E', 'G', 'C'], DUB_FORMS);
  const notes: RadioNote[] = [];
  const lo = key + 31;
  const hi = key + 46;
  let prev = key + 36;
  const bassLine = pick(r, DUB_BASS);

  for (let bar = 0; bar < BARS; bar++) {
    const chord = prog[bar % prog.length]!;
    const root = key + chord.root;
    const at = bar * S;
    const full = bar >= 1;
    const last = bar === BARS - 1;

    // One drop: the kick and the rim on beat three only; a hat on the eighths.
    notes.push(drum(at + 8, 'kick', humanize(r, 0.95)));
    notes.push(drum(at + 8, 'snare', humanize(r, 0.8)));
    for (let s = 0; s < S; s += 2) notes.push(drum(at + s, 'hat', humanize(r, s % 4 === 0 ? 0.5 : 0.3)));
    if (last) notes.push(drum(at + 14, 'snare', humanize(r, 0.6)));

    // The sub bass: a line over the chord root, held low.
    if (full) {
      for (const [s, iv, len] of bassLine) {
        notes.push({
          step: at + s,
          layer: 'bass',
          midi: root + iv,
          len,
          vel: humanize(r, s === 0 ? 0.95 : 0.8),
        });
      }
    }

    // The skank: short chord stabs on the offbeats (the "and" of every beat).
    for (const s of [2, 6, 10, 14]) {
      if (!full && s < 10) continue;
      [12, 12 + third(chord), 19].forEach((iv, i) =>
        notes.push({
          step: at + s,
          layer: 'skank',
          midi: root + iv,
          len: 1,
          vel: humanize(r, 0.6),
          strum: i,
        }),
      );
    }

    // The melodica: a sparse line in the second and fourth quarters of the song.
    if ((bar >= 2 && bar <= 3) || bar >= 6) {
      const { notes: line, last: end } = melodyBar(
        r,
        at,
        pick(r, DUB_MELODICA),
        chord,
        key,
        MINOR_PENTA,
        prev,
        lo,
        hi,
        'lead',
        0.65,
      );
      notes.push(...line);
      prev = end;
    }
  }
  return finish(base('dub-band', seed, { bpm, key, form }), notes);
}

// ---------------------------------------------------------------------------------------------
// Stoner

/** One riff step: where, how long, and the semitones above the chord's root. */
type Riff = readonly (readonly [number, number, number])[];
const STONER_RIFFS: readonly Riff[] = [
  [
    [0, 3, 0],
    [3, 1, 0],
    [4, 2, 3],
    [6, 2, 5],
    [8, 4, 0],
    [12, 2, 7],
    [14, 2, 6],
  ],
  [
    [0, 4, 0],
    [4, 2, 0],
    [6, 2, 3],
    [8, 3, 5],
    [11, 1, 3],
    [12, 4, 0],
  ],
  [
    [0, 2, 0],
    [2, 2, 0],
    [4, 4, 5],
    [8, 2, 3],
    [10, 2, 0],
    [12, 4, -2],
  ],
];

function composeStoner(params: Readonly<Record<string, unknown>>, seed: number): Composition {
  const { r, bpm, key, form, prog } = common(
    params,
    seed,
    [62, 88],
    ['C', 'D', 'E', 'F#', 'G'],
    STONER_FORMS,
  );
  const notes: RadioNote[] = [];
  const riff = pick(r, STONER_RIFFS);
  const lo = key + 31;
  const hi = key + 46;
  let prev = key + 36;

  for (let bar = 0; bar < BARS; bar++) {
    const chord = prog[bar % prog.length]!;
    const root = key + chord.root;
    const at = bar * S;
    const solo = bar >= 4 && bar <= 6;
    const last = bar === BARS - 1;

    // Half-time drums: the snare on three only, a tom roll to close.
    if (bar % 4 === 0) notes.push(drum(at, 'crash', 0.85, 0, 12));
    notes.push(drum(at, 'kick', humanize(r, 0.95)));
    notes.push(drum(at + 8, 'snare', humanize(r, 0.95)));
    for (const s of [3, 6, 10, 14]) if (r() < 0.55) notes.push(drum(at + s, 'kick', humanize(r, 0.8)));
    for (let s = 0; s < S; s += 4) notes.push(drum(at + s, 'hat', humanize(r, s % 8 === 0 ? 0.5 : 0.35)));
    if (last)
      for (let s = 12; s < S; s++) notes.push(drum(at + s, 'tom', humanize(r, 0.85), 52 - 2 * (s - 12)));

    // The riff, doubled by the bass an octave down; the riff goes quiet under the solo.
    for (const [s, len, iv] of riff) {
      if (last && s >= 12) continue;
      const m = root + 12 + iv;
      notes.push({ step: at + s, layer: 'bass', midi: root + iv, len, vel: humanize(r, 0.9) });
      notes.push({
        step: at + s,
        layer: 'rhythm',
        midi: m,
        len,
        vel: humanize(r, solo ? 0.5 : 0.9),
        strum: 0,
      });
      notes.push({
        step: at + s,
        layer: 'rhythm',
        midi: m + 7,
        len,
        vel: humanize(r, solo ? 0.5 : 0.85),
        strum: 1,
      });
    }

    // The wah solo: bent pentatonic lines over bars 4-6.
    if (solo) {
      const { notes: line, last: end } = melodyBar(
        r,
        at,
        pick(r, [
          [4, 2, 2, 8],
          [6, 2, 8],
          [2, 2, 4, 4, 4],
          [8, 4, 4],
        ]),
        chord,
        key,
        MINOR_PENTA,
        prev,
        key + 31,
        key + 46,
        'lead',
        0.8,
      );
      for (const n of line) if (n.len >= 4 && r() < 0.6) n.slide = -2;
      notes.push(...line);
      prev = end;
    }
  }
  void lo;
  void hi;
  return finish(base('stoner-band', seed, { bpm, key, form }), notes);
}

// ---------------------------------------------------------------------------------------------
// Ambient (the Pacific Northwest's pirate)

function composeAmbient(params: Readonly<Record<string, unknown>>, seed: number): Composition {
  const { r, bpm, key, form, prog } = common(
    params,
    seed,
    [54, 68],
    ['D', 'E', 'F', 'G', 'A', 'C'],
    AMBIENT_FORMS,
  );
  const notes: RadioNote[] = [];
  const lo = key + 38;
  const hi = key + 58;
  let prev = key + 48;

  for (let bar = 0; bar < BARS; bar++) {
    const chord = prog[bar % prog.length]!;
    const root = key + chord.root;
    const at = bar * S;

    // The drone and the pad: root and fifth held a whole bar; fifth, ninth and seventh over them.
    notes.push({ step: at, layer: 'bass', midi: root, len: S, vel: humanize(r, 0.75) });
    const seventh = chord.minor ? 10 : 11;
    [12 + 7, 24 + 2, 12 + third(chord), 12 + seventh].forEach((iv) =>
      notes.push({ step: at, layer: 'pad', midi: root + iv, len: S, vel: humanize(r, 0.5) }),
    );

    // Bells: a few notes a bar on the major pentatonic around the chord, never on the same step twice.
    const scale = chord.minor ? MINOR_PENTA : MAJOR_PENTA;
    const taken = new Set<number>();
    const count = 2 + Math.floor(r() * 3);
    for (let k = 0; k < count; k++) {
      let s = Math.floor(r() * 7) * 2;
      while (taken.has(s)) s = (s + 2) % S;
      taken.add(s);
      prev = Math.min(
        hi,
        Math.max(lo, scaleStep(scale, root, prev, (r() < 0.5 ? -1 : 1) * (1 + Math.floor(r() * 2)))),
      );
      notes.push({ step: at + s, layer: 'glock', midi: prev, len: 6, vel: humanize(r, 0.45) });
    }

    // A breathy low line, twice a loop: a long note that leans into the next chord.
    if (bar === 2 || bar === 6) {
      const m = nearestOf(chordPcs(chord), key, root + 19, root + 14, root + 26);
      notes.push({ step: at + 2, layer: 'lead', midi: m, len: 12, vel: humanize(r, 0.6), slide: -2 });
    }
  }
  return finish(base('ambient-band', seed, { bpm, key, form }), notes);
}

// ---------------------------------------------------------------------------------------------
// Funk

/** Chicken-scratch strokes (steps in the bar) and the horn riff's hits (step, length). */
const FUNK_SCRATCH: readonly (readonly number[])[] = [
  [0, 2, 3, 5, 6, 8, 10, 11, 13, 14],
  [1, 2, 4, 5, 7, 9, 10, 12, 13, 15],
  [0, 3, 4, 6, 7, 9, 11, 12, 14, 15],
];
const FUNK_HORNS: readonly (readonly (readonly [number, number])[])[] = [
  [
    [10, 2],
    [14, 2],
  ],
  [
    [3, 2],
    [6, 2],
    [10, 4],
  ],
  [
    [0, 3],
    [6, 2],
    [12, 2],
    [14, 2],
  ],
];

function composeFunk(params: Readonly<Record<string, unknown>>, seed: number): Composition {
  const { r, bpm, key, form, prog } = common(params, seed, [104, 122], ['E', 'A', 'D', 'G', 'C'], FUNK_FORMS);
  const notes: RadioNote[] = [];
  const scratch = pick(r, FUNK_SCRATCH);
  const horns = pick(r, FUNK_HORNS);
  const lo = key + 31;
  const hi = key + 46;
  let prev = key + 38;

  for (let bar = 0; bar < BARS; bar++) {
    const chord = prog[bar % prog.length]!;
    const root = key + chord.root;
    const at = bar * S;
    const full = bar >= 2;
    const last = bar === BARS - 1;

    // The kit: a syncopated kick, the snare on two and four with ghost notes, busy hats, an open hat.
    for (const s of [0, 3, 6, 10, ...(bar % 2 ? [14] : [])])
      notes.push(drum(at + s, 'kick', humanize(r, 0.9)));
    for (const s of [4, 12]) notes.push(drum(at + s, 'snare', humanize(r, 0.95)));
    for (const s of [7, 9, 15, 1]) if (r() < 0.6) notes.push(drum(at + s, 'snare', humanize(r, 0.25)));
    for (let s = 0; s < S; s++)
      notes.push(drum(at + s, 'hat', humanize(r, s % 4 === 0 ? 0.55 : s % 2 ? 0.25 : 0.4)));
    notes.push(drum(at + 14, 'openhat', humanize(r, 0.55)));
    if (last)
      for (let s = 12; s < S; s++) notes.push(drum(at + s, 'tom', humanize(r, 0.8), 55 - 2 * (s - 12)));

    // The slap-style bass: the root, an octave pop, a flat seventh, a pickup into the next bar.
    const next = prog[(bar + 1) % prog.length]!;
    const line: readonly (readonly [number, number, number])[] = [
      [0, 0, 2],
      [3, 12, 1],
      [6, 0, 2],
      [8, 0, 1],
      [10, 12, 1],
      [11, chord.minor ? 10 : 9, 1],
      [14, next.root - chord.root + (next.root >= chord.root ? -1 : 1), 2],
    ];
    for (const [s, iv, len] of line) {
      notes.push({
        step: at + s,
        layer: 'bass',
        midi: root + iv,
        len,
        vel: humanize(r, iv === 12 ? 0.6 : 0.9),
      });
    }

    // Chicken scratch: short muted strokes on a minor-seventh grip.
    const grip = [12, 12 + third(chord), 19, 22];
    for (const s of scratch) {
      if (!full && s % 2) continue;
      grip.forEach((iv, i) =>
        notes.push({
          step: at + s,
          layer: 'rhythm',
          midi: root + iv,
          len: 1,
          vel: humanize(r, s % 4 === 0 ? 0.55 : 0.4),
          strum: i,
        }),
      );
    }

    // The horns: a riff on the chord's triad plus seventh, from bar 4; the melody line closes the song.
    if (bar >= 4) {
      for (const [s, len] of horns) {
        [12, 12 + third(chord), 19, 22].forEach((iv) =>
          notes.push({ step: at + s, layer: 'stab', midi: root + iv, len, vel: humanize(r, 0.75) }),
        );
      }
    }
    if (bar === 3 || last) {
      const { notes: lineN, last: end } = melodyBar(
        r,
        at,
        [4, 2, 2, 8],
        chord,
        key,
        MINOR_PENTA,
        prev,
        lo,
        hi,
        'stab',
        0.7,
      );
      notes.push(...lineN);
      prev = end;
    }
  }
  return finish(base('funk-band', seed, { bpm, key, form }), notes);
}

// ---------------------------------------------------------------------------------------------
// Chip (San Francisco's pirate)

const CHIP_RHYTHMS: readonly (readonly number[])[] = [
  [2, 2, 2, 2, 4, 4],
  [4, 2, 2, 4, 4],
  [1, 1, 2, 2, 2, 4, 4],
  [3, 1, 2, 2, 4, 4],
  [8, 4, 4],
];

function composeChip(params: Readonly<Record<string, unknown>>, seed: number): Composition {
  const { r, bpm, key, form, prog } = common(params, seed, [138, 164], ['C', 'D', 'E', 'G', 'A'], CHIP_FORMS);
  const notes: RadioNote[] = [];
  const lo = key + 31;
  const hi = key + 55;
  let prev = key + 43;
  const hook: RadioNote[][] = [];
  const asc = oneOf(params['mode'], ['up', 'down']) ?? pick(r, ['up', 'down'] as const);

  for (let bar = 0; bar < BARS; bar++) {
    const chord = prog[bar % prog.length]!;
    const root = key + chord.root;
    const at = bar * S;
    const full = bar >= 1;
    const last = bar === BARS - 1;

    // The noise kit: kick on one and three, snare on two and four, hats on the eighths.
    for (const s of [0, 8, ...(bar % 2 ? [10] : [])]) notes.push(drum(at + s, 'kick', humanize(r, 0.9)));
    for (const s of [4, 12]) notes.push(drum(at + s, 'snare', humanize(r, 0.85)));
    for (let s = 0; s < S; s += 2) notes.push(drum(at + s, 'hat', humanize(r, s % 4 === 0 ? 0.5 : 0.35)));
    if (last)
      for (let s = 12; s < S; s++) notes.push(drum(at + s, 'snare', humanize(r, 0.6 + 0.1 * (s - 12))));

    // The triangle bass: eighths on the root and its octave, walking up on the last beat.
    for (let e = 0; e < 8; e++) {
      const iv = e % 2 ? 12 : 0;
      notes.push({
        step: at + e * 2,
        layer: 'bass',
        midi: root + iv,
        len: 2,
        vel: humanize(r, e % 2 ? 0.6 : 0.85),
      });
    }

    // The pulse arpeggio: sixteenths up (or down) the chord and back, from bar 1.
    if (full) {
      const tones = [0, third(chord), 7, 12];
      const order =
        asc === 'up'
          ? [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 1]
          : [3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 2];
      order.forEach((k, s) =>
        notes.push({
          step: at + s,
          layer: 'arp',
          midi: root + 12 + tones[k]!,
          len: 1,
          vel: humanize(r, s % 4 === 0 ? 0.5 : 0.35),
        }),
      );
    }

    // The lead: a hook in bars 2-3 that repeats in 6-7 a step higher.
    if (bar === 6 || bar === 7) {
      hook.push(hook[bar - 6]!.map((n) => ({ ...n, step: n.step + 4 * S, midi: Math.min(hi, n.midi + 2) })));
      continue;
    }
    if (bar >= 2 && bar <= 3) {
      const { notes: line, last: end } = melodyBar(
        r,
        at,
        pick(r, CHIP_RHYTHMS),
        chord,
        key,
        AEOLIAN,
        prev,
        lo,
        hi,
        'lead',
        0.75,
      );
      hook.push(line);
      prev = end;
    }
  }
  for (const b of hook) notes.push(...b);
  void MAJOR;
  return finish(base('chip-band', seed, { bpm, key, form }), notes);
}
