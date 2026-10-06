// Three more bands, one for each region (playtest 4, run C, task C8; the maintainer on the radio:
// "I'm surprised how good the music is lol feel free to make more for all regions :P", San Francisco
// his favourite, then the Keys). Like the bands before them each one is a whole sixteen-bar song with
// sections, not a loop, every melody is a seeded walk over chord tones and the scale (so every song is
// original by construction), and this file is pure; radio-rigs-trio.ts plays it.
//
// The Keys:
// - `son-band`: Cuban son, 92-116 bpm, for Key West's Cuban side. A 3-2 clave through the whole song,
//   a conga tumbao and a shaker, a bass that lands on the "and" of two and anticipates every chord, a
//   piano montuno (a three-three-two figure over the chord's tones), a trumpet that states a theme,
//   a brass call-and-response, a cowbell montuno, a percussion break and the theme again.
// The Pacific Northwest:
// - `dream-band`: motorik dream pop for the long grey rides, 124-146 bpm. A glassy arpeggio and a
//   pad for two bars, then the motorik drive (kick on one, three and the "and" of three, snare on
//   two and four, driving eighth hats) under a bass in eighths, a crest where a wall of chiming
//   chords and a soaring lead come in, a haze that drops the drums, and the crest again.
// San Francisco:
// - `beat-band`: Bay Area instrumental hip hop, 84-100 bpm. A boom-bap kick, a snare with a clap on
//   two and four, bouncing hats, an 808 that glides into its notes, a Rhodes chopping seventh chords,
//   and a whistling lead that glides between its notes over the hook.
import type { Composition, RadioNote } from './radio-compose';
import { phrase } from './radio-compose-extra';
import { chordPcs, common, drum, maj, min, refit, S, third, type Chord } from './radio-compose-regional';
import { finish, humanize, pick } from './radio-util';

export const TRIO_PRESETS = ['son-band', 'dream-band', 'beat-band'] as const;
export type TrioPreset = (typeof TRIO_PRESETS)[number];

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11];
const MAJOR_PENTA = [0, 2, 4, 7, 9];
const MINOR_PENTA = [0, 3, 5, 7, 10];

/** Composes one of the three bands; null for a name this file does not know. */
export function composeTrio(
  preset: string,
  params: Readonly<Record<string, unknown>>,
  seed: number,
): Composition | null {
  switch (preset) {
    case 'son-band':
      return composeSon(params, seed);
    case 'dream-band':
      return composeDream(params, seed);
    case 'beat-band':
      return composeBeat(params, seed);
    default:
      return null;
  }
}

/** The notes of a song that start in bar `b`. */
const inBar = (notes: readonly RadioNote[], b: number): RadioNote[] =>
  notes.filter((n) => Math.floor(n.step / S) === b);

/** A bass note folded down by octaves until it is at or under `max`, so it stays in the bass. */
const fold = (m: number, max: number): number => {
  let x = m;
  while (x > max) x -= 12;
  return x;
};

/** A copy of notes, `steps` later. */
const later = (notes: readonly RadioNote[], steps: number): RadioNote[] =>
  notes.map((n) => ({ ...n, step: n.step + steps }));

// ---------------------------------------------------------------------------------------------
// Son (the Keys)

export const SON_FORMS: Readonly<Record<string, readonly Chord[]>> = {
  // I IV V IV, i iv V i, I V IV I, i bVII bVI V.
  cayo: [maj(0), maj(5), maj(7), maj(5)],
  hueso: [min(0), min(5), maj(7), min(0)],
  guajira: [maj(0), maj(7), maj(5), maj(0)],
  malecon: [min(0), maj(-2), maj(-4), maj(7)],
};
type SonSection = 'intro' | 'tema' | 'coro' | 'montuno' | 'break';
/** The song, bar by bar [default]: sixteen bars. */
export const SON_PLAN: readonly SonSection[] = [
  'intro',
  'intro',
  'tema',
  'tema',
  'tema',
  'tema',
  'coro',
  'coro',
  'montuno',
  'montuno',
  'montuno',
  'montuno',
  'break',
  'break',
  'tema',
  'tema',
];
/** The piano montuno's steps in a bar: three, three, two, three, three, two. */
export const MONTUNO_STEPS: readonly number[] = [0, 3, 6, 8, 11, 14];
/** The montuno's notes, as indexes into [root, third, fifth, octave, octave + third, octave + fifth]. */
const MONTUNO_SHAPES: readonly (readonly number[])[] = [
  [1, 2, 4, 2, 3, 5],
  [0, 2, 1, 4, 2, 3],
  [1, 3, 2, 5, 4, 2],
];
/** Trumpet rhythms for a bar of sixteen steps; negative lengths are rests. */
const SON_THEMES: readonly (readonly number[])[] = [
  [-2, 4, 2, 8],
  [6, 2, 4, 4],
  [4, 4, 2, 2, 4],
  [-4, 6, 2, 4],
];
const SON_FILLS: readonly (readonly number[])[] = [
  [2, 2, 2, 2, 2, 2, 4],
  [-4, 2, 2, 2, 2, 4],
  [3, 3, 2, 2, 2, 4],
];

function composeSon(params: Readonly<Record<string, unknown>>, seed: number): Composition {
  const { r, bpm, key, form, prog } = common(
    params,
    seed,
    [92, 116],
    ['C', 'D', 'F', 'G', 'A', 'Bb'],
    SON_FORMS,
  );
  const minor = prog[0]!.minor;
  const shape = pick(r, MONTUNO_SHAPES);
  const notes: RadioNote[] = [];
  const bars = SON_PLAN.length;
  const lo = key + 24;
  const hi = key + 43;
  let prev = key + 31;
  const lead: RadioNote[][] = [];

  for (let bar = 0; bar < bars; bar++) {
    const sec = SON_PLAN[bar]!;
    const chord = prog[bar % prog.length]!;
    const next = prog[(bar + 1) % prog.length]!;
    const root = key + chord.root;
    const t = third(chord);
    const at = bar * S;
    const scale = minor ? (chord.root === 7 && !chord.minor ? HARMONIC_MINOR : AEOLIAN) : MAJOR;
    const playing = sec === 'tema' || sec === 'coro' || sec === 'montuno';
    // The bass and the shaker join the montuno over the intro's second bar.
    const joined = playing || bar === 1;

    // The 3-2 clave, through the whole song: three strikes in the even bars, two in the odd.
    for (const s of bar % 2 ? [4, 8] : [0, 6, 12])
      notes.push(drum(at + s, 'clave', humanize(r, s === 0 ? 0.85 : 0.7)));

    // The conga tumbao: a low drum and a high one (midi 60 and 72). The montuno and the break
    // fill the gaps, and the bar before the break and the last bar end on a run up the high drum.
    const tumbao: readonly (readonly [number, number, number])[] = [
      [4, 60, 0.5],
      [6, 72, 0.75],
      [8, 72, 0.7],
      [12, 60, 0.6],
      [14, 72, 0.75],
    ];
    for (const [s, m, v] of tumbao) notes.push(drum(at + s, 'conga', humanize(r, v), m));
    if (sec === 'montuno' || sec === 'break')
      for (const s of [2, 10]) notes.push(drum(at + s, 'conga', humanize(r, 0.35), 60));
    if (bar === 11 || bar === bars - 1)
      for (const s of [13, 15]) notes.push(drum(at + s, 'conga', humanize(r, 0.5 + 0.1 * (s - 12)), 72));

    // The shaker: eighths, the beat harder.
    if (joined)
      for (let s = 0; s < S; s += 2) notes.push(drum(at + s, 'tamb', humanize(r, s % 4 === 0 ? 0.5 : 0.3)));

    // The cowbell: quarters, and the off-beat pushes in the montuno.
    if (sec === 'montuno' || sec === 'break') {
      for (const s of [0, 4, 8, 12]) notes.push(drum(at + s, 'bell', humanize(r, 0.6)));
      if (sec === 'montuno') for (const s of [6, 14]) notes.push(drum(at + s, 'bell', humanize(r, 0.4)));
    }

    // The bass tumbao: it lands on the "and" of two and again on four, anticipating the next chord.
    if (joined) {
      const nextRoot = key + next.root;
      if (sec === 'montuno') {
        notes.push({ step: at, layer: 'bass', midi: fold(root, 52), len: 4, vel: humanize(r, 0.7) });
        notes.push({ step: at + 6, layer: 'bass', midi: fold(root + 12, 52), len: 2, vel: humanize(r, 0.8) });
        notes.push({ step: at + 10, layer: 'bass', midi: fold(root + 7, 52), len: 2, vel: humanize(r, 0.7) });
      } else {
        notes.push({ step: at + 6, layer: 'bass', midi: fold(root, 52), len: 4, vel: humanize(r, 0.85) });
      }
      notes.push({ step: at + 12, layer: 'bass', midi: fold(nextRoot, 52), len: 4, vel: humanize(r, 0.8) });
    }

    // The piano: the montuno in the intro and over the montuno; light chords on the pushes between.
    const tones = [0, t, 7, 12, 12 + t, 19];
    if (sec === 'intro' || sec === 'montuno') {
      MONTUNO_STEPS.forEach((s, k) =>
        notes.push({
          step: at + s,
          layer: 'ep',
          midi: root + 12 + tones[shape[k]!]!,
          len: 2,
          vel: humanize(r, k % 3 === 0 ? 0.8 : 0.6),
        }),
      );
    } else if (sec === 'tema' || sec === 'coro') {
      for (const s of [6, 14])
        [12 + t, 19, 24].forEach((iv) =>
          notes.push({ step: at + s, layer: 'ep', midi: root + iv, len: 2, vel: humanize(r, 0.5) }),
        );
    }

    // The brass: call and response over the coro, the break's hits, and the last chord.
    const hit = (s: number, len: number, vel: number) =>
      [24, 24 + t, 31].forEach((iv) =>
        notes.push({ step: at + s, layer: 'stab', midi: root + iv, len, vel: humanize(r, vel) }),
      );
    if (sec === 'coro') for (const s of bar % 2 ? [0, 4, 10, 14] : [0, 6, 8]) hit(s, 2, 0.8);
    if (bar === 13) for (const s of [0, 6, 12]) hit(s, 2, 0.9);
    if (bar === bars - 1) hit(0, 8, 0.9);

    // The trumpet: a theme (a call, its answer, the call again over the next chord, a new answer)
    // that comes back note for note at the end, and short licks over the montuno.
    let line: RadioNote[] = [];
    if (sec === 'tema') {
      if (bar >= 14) line = later(lead[bar - 12]!, 12 * S);
      else if (bar === 4) line = refit(lead[2]!, 2 * S, chord, key, scale, lo, hi);
      else {
        const made = phrase(
          r,
          at,
          bar % 2 ? pick(r, SON_THEMES.slice(2)) : pick(r, SON_THEMES.slice(0, 2)),
          chordPcs(chord),
          scale,
          key,
          prev,
          lo,
          hi,
          'lead',
          0.78,
          (s) => s % 8 === 0,
        );
        line = made.notes;
      }
      for (const n of line) if (n.len >= 6 && n.slide === undefined && r() < 0.4) n.slide = -2;
    } else if (sec === 'montuno' && bar % 2) {
      line = phrase(
        r,
        at,
        pick(r, SON_FILLS),
        chordPcs(chord),
        scale,
        key,
        prev,
        lo,
        hi,
        'lead',
        0.72,
        (s) => s % 8 === 0,
      ).notes;
    }
    lead[bar] = line;
    if (line.length) prev = line.at(-1)!.midi;
    notes.push(...line);
  }
  return finish({ preset: 'son-band', seed, bpm, key, form, stepsPerBeat: 4, stepsPerBar: S, bars }, notes);
}

// ---------------------------------------------------------------------------------------------
// Dream pop (the Pacific Northwest)

export const DREAM_FORMS: Readonly<Record<string, readonly Chord[]>> = {
  // IV I V vi, I bIII IV I, I iii IV V, vi IV I bVII.
  sunbreak: [maj(5), maj(0), maj(7), min(9)],
  overcast: [maj(0), maj(3), maj(5), maj(0)],
  cedar: [maj(0), min(4), maj(5), maj(7)],
  fogline: [min(9), maj(5), maj(0), maj(-2)],
};
type DreamSection = 'intro' | 'verse' | 'crest' | 'haze' | 'return';
/** The song, bar by bar [default]: sixteen bars. */
export const DREAM_PLAN: readonly DreamSection[] = [
  'intro',
  'intro',
  'verse',
  'verse',
  'verse',
  'verse',
  'crest',
  'crest',
  'crest',
  'crest',
  'haze',
  'haze',
  'return',
  'return',
  'return',
  'return',
];
/** The bass in eighths, as semitones over the chord's root. */
const DREAM_BASS: readonly (readonly number[])[] = [
  [0, 0, 12, 0, 0, 0, 12, 7],
  [0, 0, 0, 12, 0, 0, 7, 0],
  [0, 12, 0, 12, 0, 7, 0, 12],
];
const DREAM_LEAD: readonly (readonly number[])[] = [
  [8, 4, 4],
  [6, 2, 8],
  [4, 4, 8],
  [12, 4],
  [-4, 4, 8],
];

function composeDream(params: Readonly<Record<string, unknown>>, seed: number): Composition {
  const { r, bpm, key, form, prog } = common(
    params,
    seed,
    [124, 146],
    ['E', 'A', 'D', 'G', 'B', 'F#'],
    DREAM_FORMS,
  );
  const notes: RadioNote[] = [];
  const bassLine = pick(r, DREAM_BASS);
  const bars = DREAM_PLAN.length;
  const lo = key + 24;
  const hi = key + 43;
  let prev = key + 31;
  const chordAt = (bar: number) => prog[bar % prog.length]!;
  const hook: RadioNote[] = [];

  for (let bar = 0; bar < bars; bar++) {
    const sec = DREAM_PLAN[bar]!;
    const chord = chordAt(bar);
    const root = key + chord.root;
    const t = third(chord);
    const at = bar * S;
    const driving = sec === 'verse' || sec === 'crest' || sec === 'return';
    const big = sec === 'crest' || sec === 'return';

    // The pad: the chord with its ninth, all bar; it leads the intro and the haze.
    const hushed = sec === 'intro' || sec === 'haze';
    [12, 12 + t, 19, 26].forEach((iv) =>
      notes.push({ step: at, layer: 'pad', midi: root + iv, len: S, vel: hushed ? 0.7 : 0.4 }),
    );

    // The arpeggio: chord tones in eighths, an octave up on every other pass.
    const tones = [24, 24 + t, 31, 36, 31, 24 + t, 36, 31 + 5];
    for (let k = 0; k < 8; k++)
      notes.push({
        step: at + k * 2,
        layer: 'arp',
        midi: root + tones[k]!,
        len: 2,
        vel: humanize(r, (hushed ? 0.6 : big ? 0.32 : 0.42) * (k % 2 ? 0.75 : 1)),
      });

    // The bass: driving eighths from the second bar, out for the haze.
    if ((sec !== 'intro' || bar === 1) && sec !== 'haze')
      bassLine.forEach((iv, e) =>
        notes.push({
          step: at + e * 2,
          layer: 'bass',
          midi: fold(root + iv, 57),
          len: 2,
          vel: humanize(r, e % 2 === 0 ? 0.85 : 0.65),
        }),
      );

    // The motorik drive: kick on one, three and the "and" of three, snare on two and four, hats in
    // eighths. A fill into the crest and into the return; the haze keeps only a kick and a soft hat.
    if (driving) {
      if (bar === 6 || bar === 12) notes.push(drum(at, 'crash', 0.7, 0, 12));
      for (const s of [0, 8, 10]) notes.push(drum(at + s, 'kick', humanize(r, s === 10 ? 0.75 : 0.95)));
      for (const s of [4, 12]) notes.push(drum(at + s, 'snare', humanize(r, 0.85)));
      for (let s = 0; s < S; s += 2) notes.push(drum(at + s, 'hat', humanize(r, s % 4 === 0 ? 0.5 : 0.35)));
      notes.push(drum(at + 14, 'openhat', humanize(r, 0.45)));
      if (bar === 5) for (let s = 8; s < S; s++) notes.push(drum(at + s, 'snare', 0.4 + 0.05 * (s - 8)));
    } else if (sec === 'haze') {
      notes.push(drum(at, 'kick', humanize(r, 0.9)));
      for (const s of [4, 12]) notes.push(drum(at + s, 'hat', humanize(r, 0.3)));
      if (bar === 11) for (let s = 8; s < S; s++) notes.push(drum(at + s, 'snare', 0.4 + 0.05 * (s - 8)));
    }

    // The wall: chiming chords on every beat of the crest and the return.
    if (big)
      for (const s of [0, 4, 8, 12])
        [12, 19, 24, 24 + t, 31].forEach((iv, i) =>
          notes.push({
            step: at + s,
            layer: 'rhythm',
            midi: root + iv,
            len: 4,
            vel: humanize(r, s === 0 ? 0.6 : 0.45),
            strum: i,
          }),
        );

    // The lead: a hook over the crest's first two bars and an answer over the next two; the return
    // plays both again, six bars on, fitted to its own chords.
    if (sec === 'crest') {
      const line = phrase(
        r,
        at,
        pick(r, DREAM_LEAD),
        chordPcs(chord),
        MAJOR,
        key,
        prev,
        lo,
        hi,
        'lead',
        0.72,
        (s) => s % 8 === 0,
      );
      for (const n of line.notes) if (n.len >= 4 && r() < 0.6) n.slide = -2;
      hook.push(...line.notes);
      notes.push(...line.notes);
      prev = line.last;
    } else if (sec === 'return') {
      notes.push(
        ...refit(
          hook.filter((n) => Math.floor(n.step / S) === bar - 6),
          6 * S,
          chord,
          key,
          MAJOR,
          lo,
          hi,
        ),
      );
    }
  }
  return finish({ preset: 'dream-band', seed, bpm, key, form, stepsPerBeat: 4, stepsPerBar: S, bars }, notes);
}

// ---------------------------------------------------------------------------------------------
// Bay Area beats (San Francisco)

export const BEAT_FORMS: Readonly<Record<string, readonly Chord[]>> = {
  // i iv bVII i, i bVI bVII i, i i bVI bVII, I vi ii V.
  bart: [min(0), min(5), maj(-2), min(0)],
  sunset: [min(0), maj(-4), maj(-2), min(0)],
  hyphy: [min(0), min(0), maj(-4), maj(-2)],
  bayview: [maj(0), min(9), min(2), maj(7)],
};
type BeatSection = 'intro' | 'beat' | 'hook' | 'break' | 'return';
/** The song, bar by bar [default]: sixteen bars. */
export const BEAT_PLAN: readonly BeatSection[] = [
  'intro',
  'intro',
  'beat',
  'beat',
  'beat',
  'beat',
  'hook',
  'hook',
  'hook',
  'hook',
  'break',
  'break',
  'return',
  'return',
  'return',
  'return',
];
/** The 808's bar as [step, semitones over the root, length]. */
const BEAT_808: readonly (readonly (readonly [number, number, number])[])[] = [
  [
    [0, 0, 7],
    [8, 0, 2],
    [10, 10, 4],
  ],
  [
    [0, 0, 5],
    [6, 0, 3],
    [10, 7, 2],
    [12, 10, 4],
  ],
  [
    [0, 0, 10],
    [10, 7, 3],
    [14, 0, 2],
  ],
];
/** The Rhodes's chops in a bar of the beat: [step, length]. */
const BEAT_CHOPS: readonly (readonly (readonly [number, number])[])[] = [
  [
    [0, 6],
    [10, 4],
  ],
  [
    [0, 3],
    [6, 3],
    [10, 4],
  ],
  [
    [2, 4],
    [8, 6],
  ],
];
const BEAT_LEAD: readonly (readonly number[])[] = [
  [-2, 6, 2, 6],
  [4, 4, 8],
  [6, 2, 4, 4],
  [-4, 4, 4, 4],
];

function composeBeat(params: Readonly<Record<string, unknown>>, seed: number): Composition {
  const { r, bpm, key, form, prog } = common(
    params,
    seed,
    [84, 100],
    ['C', 'D', 'E', 'F#', 'G', 'A', 'Bb'],
    BEAT_FORMS,
  );
  const minor = prog[0]!.minor;
  const scale = minor ? MINOR_PENTA : MAJOR_PENTA;
  const notes: RadioNote[] = [];
  const bars = BEAT_PLAN.length;
  const bass808 = pick(r, BEAT_808);
  const chops = pick(r, BEAT_CHOPS);
  const lo = key + 31;
  const hi = key + 44;
  let prev = key + 36;
  const chordAt = (bar: number) => prog[bar % prog.length]!;
  const hook: RadioNote[] = [];

  for (let bar = 0; bar < bars; bar++) {
    const sec = BEAT_PLAN[bar]!;
    const chord = chordAt(bar);
    const root = key + chord.root;
    const t = third(chord);
    const at = bar * S;
    const drums = sec === 'beat' || sec === 'hook' || sec === 'return';

    // The Rhodes: a seventh chord with its ninth (no root: the 808 has it). Chops, and a held chord
    // through the break.
    const seventh = chord.minor ? 10 : 11;
    const voicing = [12 + t, 19, 12 + seventh, 26];
    const chordNotes = (s: number, len: number, vel: number) =>
      voicing.forEach((iv, i) =>
        notes.push({
          step: at + s,
          layer: 'ep',
          midi: root + iv,
          len,
          vel: humanize(r, vel * (i === 0 ? 1 : 0.8)),
        }),
      );
    if (sec === 'break') chordNotes(0, 12, 0.75);
    else for (const [s, len] of chops) chordNotes(s, len, s === 0 ? 0.75 : 0.6);

    // The hats: eighths, and sixteenths that bounce in and out.
    for (let s = 0; s < S; s++) {
      if (s % 2 === 0) notes.push(drum(at + s, 'hat', humanize(r, s % 4 === 0 ? 0.45 : 0.3)));
      else if (drums && r() < 0.35) notes.push(drum(at + s, 'hat', humanize(r, 0.18)));
    }

    if (drums) {
      // Boom-bap: the kick on one and the "and" of three (and the "and" of two every other bar), the
      // snare with a clap on two and four, a ghost snare now and then, an open hat before the turn.
      for (const s of bar % 2 ? [0, 6, 10] : [0, 10])
        notes.push(drum(at + s, 'kick', humanize(r, s === 0 ? 0.95 : 0.8)));
      if (r() < 0.35) notes.push(drum(at + 14, 'kick', humanize(r, 0.5)));
      for (const s of [4, 12]) {
        notes.push(drum(at + s, 'snare', humanize(r, 0.85)));
        notes.push(drum(at + s, 'clap', humanize(r, 0.7)));
      }
      if (r() < 0.3) notes.push(drum(at + 15, 'snare', humanize(r, 0.3)));
      notes.push(drum(at + 14, 'openhat', humanize(r, 0.4)));
      // A fill into the hook.
      if (bar === 5) for (let s = 12; s < S; s++) notes.push(drum(at + s, 'snare', 0.4 + 0.1 * (s - 12)));
    } else {
      // The intro and the break: the kick on one, no snare.
      notes.push(drum(at, 'kick', humanize(r, 0.9)));
    }

    // The 808: it glides into its notes (the slide is in semitones); a longer glide on the bar's first.
    bass808.forEach(([s, iv, len], i) =>
      notes.push({
        step: at + s,
        layer: 'bass',
        midi: fold(root + iv, 50),
        len,
        vel: humanize(r, i === 0 ? 0.95 : 0.8),
        ...(i === 0 || r() < 0.3 ? { slide: -3 } : {}),
      }),
    );

    // The whistle: a hook over the first two bars of the hook and an answer over the next two,
    // gliding into its long notes; the return plays both again, six bars on, fitted to its chords.
    if (sec === 'hook') {
      const line = phrase(
        r,
        at,
        pick(r, BEAT_LEAD),
        chordPcs(chord),
        scale,
        key,
        prev,
        lo,
        hi,
        'lead',
        0.72,
        (s) => s % 8 === 0,
      );
      for (const n of line.notes) if (n.len >= 4) n.slide = -2;
      hook.push(...line.notes);
      notes.push(...line.notes);
      prev = line.last;
    } else if (sec === 'return') {
      notes.push(...refit(inBar(hook, bar - 6), 6 * S, chord, key, scale, lo, hi));
    }
  }
  return finish({ preset: 'beat-band', seed, bpm, key, form, stepsPerBeat: 4, stepsPerBar: S, bars }, notes);
}
