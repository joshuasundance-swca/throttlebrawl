// Four more bands (playtest 4, P4-17: "The more complex SF music is impressive probably my favorite I
// like Keys music too but PNW seems very simple and slow"; the maintainer picked all four directions
// for the Pacific Northwest and added "feel free to make more for all regions"). Each one is a whole
// song with sections, not one eight-bar loop: an intro, parts that enter one by one, a break and a
// return, like San Francisco's bands at their best. Like every composer here, each melody is a seeded
// walk over chord tones and the scale, so every song is original by construction; this file is pure,
// radio-rigs-extra.ts plays it.
//
// The Pacific Northwest:
// - `garage-band`: driving garage rock, 148-184 bpm. A combo organ riff, a fuzz guitar chopping
//   eighths, a tambourine and a floor tom, a stop-time break with guitar fills, a fuzz solo that ends
//   in a rave-up, and the chorus hook to close.
// - `darkwave-band`: rainy-night synth for Portland, 98-120 bpm in a minor key. Rain on the glass, a
//   string-machine pad and a glassy electric piano for a bar, then a sixteenth sequencer bass, then a
//   drum machine with a gated snare, then a lead with a hook that comes back after a breakdown.
// The Keys:
// - `swamp-band`: swamp blues, 84-108 bpm in a 12/8 shuffle. A harmonica that calls and a slide
//   guitar that answers, then trades for a slide solo; a tremolo guitar pulsing with the tempo, a
//   washboard, a foot stomp, a walking bass and a turnaround at the end of each chorus.
// San Francisco:
// - `jazz-band`: a swinging jazz combo, 132-184 bpm. A ride cymbal's swing, a walking bass with
//   chromatic approaches, an electric piano comping rootless voicings on the off-beats, and a muted
//   horn that plays a head over ii-V changes, then a bebop solo of swung eighths and triplet runs.
import type { Composition, RadioNote } from './radio-compose';
import { chordPcs, common, drum, maj, min, refit, S, third, type Chord } from './radio-compose-regional';
import { finish, humanize, nearestOf, pick, scaleStep, type Rand } from './radio-util';

export const EXTRA_PRESETS = ['garage-band', 'darkwave-band', 'swamp-band', 'jazz-band'] as const;
export type ExtraPreset = (typeof EXTRA_PRESETS)[number];

const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10];
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11];
const MAJOR_PENTA = [0, 2, 4, 7, 9];
const MINOR_PENTA = [0, 3, 5, 7, 10];
/** The blues scale: the minor pentatonic plus the flat fifth. */
const BLUES = [0, 3, 5, 6, 7, 10];

/** Composes one of the four bands; null for a name this file does not know. */
export function composeExtra(
  preset: string,
  params: Readonly<Record<string, unknown>>,
  seed: number,
): Composition | null {
  switch (preset) {
    case 'garage-band':
      return composeGarage(params, seed);
    case 'darkwave-band':
      return composeDarkwave(params, seed);
    case 'swamp-band':
      return composeSwamp(params, seed);
    case 'jazz-band':
      return composeJazz(params, seed);
    default:
      return null;
  }
}

/** A walk of `n` scale steps, kept inside [lo, hi]. */
function walk(scale: readonly number[], key: number, from: number, n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, scaleStep(scale, key, from, n)));
}

/**
 * A phrase over one bar of `stepsPerBar` steps: chord tones on the strong steps (`strong`), scale
 * steps between; negative lengths are rests. Returns its notes and the last pitch.
 */
function phrase(
  r: Rand,
  at: number,
  rhythm: readonly number[],
  pcs: readonly number[],
  scale: readonly number[],
  key: number,
  prev: number,
  lo: number,
  hi: number,
  layer: RadioNote['layer'],
  vel: number,
  strong: (s: number) => boolean,
): { notes: RadioNote[]; last: number } {
  const out: RadioNote[] = [];
  let s = 0;
  let m = prev;
  for (const len of rhythm) {
    if (len < 0) {
      s -= len;
      continue;
    }
    if (strong(s)) m = nearestOf(pcs, key, m + Math.round((r() - 0.5) * 5), lo, hi);
    else {
      const dir = m > hi - 3 ? -1 : m < lo + 3 ? 1 : r() < 0.5 ? -1 : 1;
      m = walk(scale, key, m, dir * (r() < 0.75 ? 1 : 2), lo, hi);
    }
    out.push({ step: at + s, layer, midi: m, len, vel: humanize(r, vel) });
    s += len;
  }
  return { notes: out, last: m };
}

const shift = (notes: readonly RadioNote[], steps: number, semis = 0): RadioNote[] =>
  notes.map((n) => ({ ...n, step: n.step + steps, midi: n.midi + semis }));

/** A copy of a note without its slide. */
function plain(n: RadioNote): RadioNote {
  const { slide: _slide, ...rest } = n;
  return rest;
}

/** A pitch class, 0-11. */
const pc = (m: number) => ((m % 12) + 12) % 12;

/** The form ids of a table whose bars are not plain chords, for `common`'s pick. */
const formIds = (forms: Readonly<Record<string, unknown>>): Record<string, readonly Chord[]> =>
  Object.fromEntries(Object.keys(forms).map((k) => [k, []]));

// ---------------------------------------------------------------------------------------------
// Garage (the Pacific Northwest)

export const GARAGE_FORMS: Readonly<Record<string, readonly Chord[]>> = {
  // I bVII IV I, I IV v IV, I bIII IV I, i bVII bVI bVII.
  stomp: [maj(0), maj(-2), maj(5), maj(0)],
  louie: [maj(0), maj(5), min(7), maj(5)],
  creep: [maj(0), maj(3), maj(5), maj(0)],
  dirt: [min(0), maj(-2), maj(-4), maj(-2)],
};
type GarageSection = 'intro' | 'verse' | 'chorus' | 'break' | 'solo' | 'outro';
/** The song, bar by bar [default]: sixteen bars. */
export const GARAGE_PLAN: readonly GarageSection[] = [
  'intro',
  'intro',
  'verse',
  'verse',
  'verse',
  'verse',
  'chorus',
  'chorus',
  'chorus',
  'chorus',
  'break',
  'break',
  'solo',
  'solo',
  'outro',
  'outro',
];
const GARAGE_RIFFS: readonly (readonly number[])[] = [
  [2, 2, 2, 2, 4, 2, 2],
  [3, 3, 2, 2, 2, 4],
  [2, 2, 4, 2, 2, 4],
  [4, 2, 2, 3, 3, 2],
];
const GARAGE_HOOKS: readonly (readonly number[])[] = [
  [4, 4, 8],
  [2, 2, 4, 8],
  [6, 2, 4, 4],
  [4, 2, 2, 8],
];

function composeGarage(params: Readonly<Record<string, unknown>>, seed: number): Composition {
  const { r, bpm, key, form, prog } = common(
    params,
    seed,
    [148, 184],
    ['E', 'A', 'D', 'G', 'C'],
    GARAGE_FORMS,
  );
  const notes: RadioNote[] = [];
  const minor = prog[0]!.minor;
  const scale = minor ? MINOR_PENTA : MIXOLYDIAN;
  const bars = GARAGE_PLAN.length;
  // The organ's riff: one bar, written once, played in the intro and under the solo.
  const riffLo = key + 24;
  const riffHi = key + 38;
  const riff = phrase(
    r,
    0,
    pick(r, GARAGE_RIFFS),
    chordPcs(prog[0]!),
    minor ? MINOR_PENTA : MAJOR_PENTA,
    key,
    key + 31,
    riffLo,
    riffHi,
    'organ',
    0.7,
    (s) => s === 0 || s === 8,
  ).notes;
  // The chorus hook: two bars, sung by the organ over the band.
  let prev = key + 31;
  const hook: RadioNote[] = [];
  for (let b = 0; b < 2; b++) {
    const chord = prog[b % prog.length]!;
    const line = phrase(
      r,
      b * S,
      pick(r, GARAGE_HOOKS),
      chordPcs(chord),
      scale,
      key,
      prev,
      key + 26,
      key + 41,
      'organ',
      0.75,
      (s) => s % 8 === 0,
    );
    hook.push(...line.notes);
    prev = line.last;
  }

  // Each section walks the progression from its top (the intro stays on the key); the break leans on
  // the progression's last two chords.
  const chordOf = (bar: number): Chord => {
    const sec = GARAGE_PLAN[bar % bars]!;
    const into = (bar % bars) - GARAGE_PLAN.indexOf(sec);
    if (sec === 'intro') return prog[0]!;
    if (sec === 'break') return prog[2 + into]!;
    return prog[into % prog.length]!;
  };

  for (let bar = 0; bar < bars; bar++) {
    const sec = GARAGE_PLAN[bar]!;
    const chord = chordOf(bar);
    const next = chordOf(bar + 1);
    const root = key + chord.root;
    const at = bar * S;
    const last = bar === bars - 1;
    const loud = sec === 'chorus' || sec === 'outro';

    // Drums. The intro opens on the floor tom; the break is stop-time.
    if (bar === 1 || bar === 6 || bar === 14) notes.push(drum(at, 'crash', 0.8, 0, 12));
    if (sec === 'break') {
      for (const s of [0, 6]) {
        notes.push(drum(at + s, 'kick', humanize(r, 0.95)));
        notes.push(drum(at + s, 'crash', 0.6, 0, 8));
      }
      for (let s = 0; s < S; s += 2) notes.push(drum(at + s, 'hat', humanize(r, s % 4 === 0 ? 0.5 : 0.3)));
    } else if (bar === 0) {
      for (let s = 0; s < S; s += 2)
        notes.push(drum(at + s, 'tom', humanize(r, s % 4 === 0 ? 0.7 : 0.45), 45));
      for (let s = 0; s < S; s += 2) notes.push(drum(at + s, 'tamb', humanize(r, s % 4 === 2 ? 0.6 : 0.35)));
    } else {
      const kicks = loud ? [0, 6, 8, 14] : [0, 8, 10, ...(bar % 2 ? [6] : [])];
      for (const s of kicks) if (!(last && s >= 12)) notes.push(drum(at + s, 'kick', humanize(r, 0.9)));
      for (const s of [4, 12]) if (!(last && s >= 12)) notes.push(drum(at + s, 'snare', humanize(r, 0.9)));
      // The tambourine shakes eighths, sixteenths when it is loud; the hats ride the eighths.
      for (let s = 0; s < S; s += loud ? 1 : 2)
        notes.push(drum(at + s, 'tamb', humanize(r, s % 4 === 2 ? 0.6 : s % 2 ? 0.22 : 0.38)));
      for (let s = 0; s < S; s += 2)
        if (!loud) notes.push(drum(at + s, 'hat', humanize(r, s % 4 === 0 ? 0.5 : 0.3)));
      if (bar % 4 === 3 && !last)
        for (const s of [12, 13, 14, 15])
          notes.push(drum(at + s, 'snare', humanize(r, 0.5 + 0.1 * (s - 12))));
      if (last)
        for (let s = 12; s < S; s++) notes.push(drum(at + s, 'tom', humanize(r, 0.85), 50 - 3 * (s - 12)));
    }

    // Bass: picked eighths with an approach into the next chord; the octave on the off-beats when loud.
    if (bar > 0) {
      for (let e = 0; e < 8; e++) {
        if (sec === 'break' && e !== 0 && e !== 3) continue;
        if (last && e >= 6) break;
        let m = root + (loud && e % 2 ? 12 : 0);
        if (e === 7 && next.root !== chord.root) m = key + next.root + (next.root > chord.root ? -1 : 1);
        notes.push({
          step: at + e * 2,
          layer: 'bass',
          midi: m,
          len: 2,
          vel: humanize(r, e % 2 ? 0.72 : 0.92),
        });
      }
    }

    // The fuzz guitar: palm-muted eighth chops in the verse and solo (root, fifth and octave), open
    // chords with the third in the chorus.
    const grip = (open: boolean) => (open ? [12, 19, 24, 24 + third(chord)] : [12, 19, 24]);
    const strike = (s: number, len: number, vel: number) =>
      grip(len >= 3).forEach((iv, i) =>
        notes.push({ step: at + s, layer: 'rhythm', midi: root + iv, len, vel: humanize(r, vel), strum: i }),
      );
    if (sec === 'verse' || sec === 'solo') {
      for (let s = 0; s < S; s += 2)
        strike(s, s === 0 || s === 6 || s === 10 ? 2 : 1, s % 4 === 0 ? 0.7 : 0.5);
    } else if (loud) {
      for (const s of last ? [0, 4, 8] : [0, 6, 8, 14])
        strike(s, s % 8 === 0 ? 6 : 2, s % 8 === 0 ? 0.8 : 0.65);
    } else if (sec === 'break') {
      for (const s of [0, 6]) strike(s, 3, 0.85);
    } else if (bar === 1) {
      for (let s = 0; s < S; s += 2) strike(s, 1, s % 4 === 0 ? 0.65 : 0.45);
    }

    // The organ: the riff in the intro and under the solo, off-beat stabs in the verse, the hook in
    // the chorus and the outro.
    if (sec === 'intro' || sec === 'solo') notes.push(...shift(riff, at, chord.root));
    else if (sec === 'verse') {
      for (const s of [2, 6, 10, 14])
        [12, 12 + third(chord), 19].forEach((iv) =>
          notes.push({ step: at + s, layer: 'organ', midi: root + iv, len: 1, vel: humanize(r, 0.5) }),
        );
    } else if (loud) {
      // The hook, fitted to this bar's chord; the second time through the chorus a harmony a third
      // below joins it.
      const b = (bar - GARAGE_PLAN.indexOf(sec)) % 2;
      const harmony = sec === 'chorus' && bar >= 8;
      const line = refit(
        hook.filter((h) => Math.floor(h.step / S) === b),
        at - b * S,
        chord,
        key,
        scale,
        key + 26,
        key + 41,
      );
      for (const n of line) {
        if (last) n.len = Math.min(n.len, 4);
        notes.push(n);
        if (harmony) notes.push({ ...n, midi: scaleStep(scale, key, n.midi, -2), vel: n.vel * 0.7 });
      }
    }

    // The fuzz lead: fills in the break's gaps, then the solo with bends, double stops and a rave-up.
    if (sec === 'break') {
      const fill = phrase(
        r,
        at + 8,
        pick(r, [
          [2, 2, 2, 2],
          [1, 1, 2, 4],
          [2, 1, 1, 4],
        ]),
        chordPcs(chord),
        MINOR_PENTA,
        key,
        prev,
        key + 24,
        key + 38,
        'lead',
        0.8,
        (s) => s === 0,
      );
      notes.push(...fill.notes);
      prev = fill.last;
    } else if (sec === 'solo') {
      if (bar === 13) {
        // The rave-up: one note picked in sixteenths, a step higher each beat.
        let m = nearestOf(chordPcs(chord), key, prev, key + 26, key + 36);
        for (let s = 0; s < S; s++) {
          if (s > 0 && s % 4 === 0) m = walk(MINOR_PENTA, key, m, 1, key + 26, key + 40);
          notes.push({
            step: at + s,
            layer: 'lead',
            midi: m,
            len: 1,
            vel: humanize(r, s % 4 === 0 ? 0.85 : 0.65),
          });
        }
        prev = m;
      } else {
        const line = phrase(
          r,
          at,
          pick(r, [
            [4, 2, 2, 8],
            [6, 2, 8],
            [2, 2, 4, 4, 4],
          ]),
          chordPcs(chord),
          MINOR_PENTA,
          key,
          prev,
          key + 24,
          key + 38,
          'lead',
          0.85,
          (s) => s % 8 === 0,
        );
        for (const n of line.notes) {
          if (n.len >= 4) n.slide = -2;
          // A double stop: the note and a fourth above, on the long ones.
          if (n.len >= 6) notes.push({ ...plain(n), midi: n.midi + 5, vel: n.vel * 0.8 });
        }
        notes.push(...line.notes);
        prev = line.last;
      }
    }
  }
  return finish(
    { preset: 'garage-band', seed, bpm, key, form, stepsPerBeat: 4, stepsPerBar: S, bars },
    notes,
  );
}

// ---------------------------------------------------------------------------------------------
// Darkwave (the Pacific Northwest: Portland on a rainy night)

export const DARKWAVE_FORMS: Readonly<Record<string, readonly Chord[]>> = {
  // i iv bVI bVII, i bVII v bVI, bVI bIII bVII i, i bVI iv V.
  bridges: [min(0), min(5), maj(-4), maj(-2)],
  overpass: [min(0), maj(-2), min(7), maj(-4)],
  rainline: [maj(-4), maj(3), maj(-2), min(0)],
  sodium: [min(0), maj(-4), min(5), maj(7)],
};
type DarkSection = 'intro' | 'bass' | 'verse' | 'hook' | 'break' | 'return';
export const DARKWAVE_PLAN: readonly DarkSection[] = [
  'intro',
  'bass',
  'verse',
  'verse',
  'verse',
  'verse',
  'verse',
  'verse',
  'hook',
  'hook',
  'hook',
  'hook',
  'break',
  'break',
  'return',
  'return',
];
const SEQ_BASS: readonly (readonly number[])[] = [
  [0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 0, 12],
  [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 0, 12, 0, 12],
  [0, 0, 0, 12, 0, 0, 7, 0, 0, 0, 0, 12, 0, 7, 10, 12],
];
const DARK_LEAD: readonly (readonly number[])[] = [
  [8, 4, 4],
  [4, 4, 8],
  [6, 6, 4],
  [-4, 4, 8],
  [4, 2, 2, 8],
];

function composeDarkwave(params: Readonly<Record<string, unknown>>, seed: number): Composition {
  const { r, bpm, key, form, prog } = common(
    params,
    seed,
    [98, 120],
    ['A', 'E', 'D', 'F#', 'B', 'C#'],
    DARKWAVE_FORMS,
  );
  const notes: RadioNote[] = [];
  const bass = pick(r, SEQ_BASS);
  const bars = DARKWAVE_PLAN.length;
  const lo = key + 26;
  const hi = key + 43;
  let prev = key + 31;
  const hook: RadioNote[] = [];

  for (let bar = 0; bar < bars; bar++) {
    const sec = DARKWAVE_PLAN[bar]!;
    // Each section walks the progression from its top, so the hook comes back over its own chords.
    const chord = prog[(bar - DARKWAVE_PLAN.indexOf(sec)) % prog.length]!;
    const root = key + chord.root;
    const at = bar * S;
    const last = bar === bars - 1;
    const drums = sec === 'verse' || sec === 'hook' || sec === 'return';
    const scale = chord.root === 7 && !chord.minor ? HARMONIC_MINOR : AEOLIAN;

    // Rain on the glass: a soft bed all bar, and a few drops (their pitch is the drop's size).
    notes.push({ step: at, layer: 'rain', midi: 0, len: S, vel: sec === 'intro' ? 0.7 : 0.45 });
    const drops = 3 + Math.floor(r() * 4);
    for (let k = 0; k < drops; k++)
      notes.push({
        step: at + Math.floor(r() * S),
        layer: 'rain',
        midi: 84 + Math.floor(r() * 16),
        len: 1,
        vel: humanize(r, 0.5),
      });

    // The string-machine pad: the chord with its ninth, held all bar, fuller while it leads.
    const alone = sec === 'intro' || sec === 'bass';
    [12, 12 + third(chord), 19, 26].forEach((iv) =>
      notes.push({ step: at, layer: 'pad', midi: root + iv, len: S, vel: alone ? 0.75 : 0.5 }),
    );

    // The electric piano: a broken chord in eighths over the first bars, then off-beat chords.
    if (alone) {
      [12, 19, 26, 24 + third(chord), 31, 24 + third(chord), 26, 19].forEach((iv, k) =>
        notes.push({
          step: at + k * 2,
          layer: 'ep',
          midi: root + iv,
          len: 4,
          vel: humanize(r, k % 2 ? 0.6 : 0.8),
        }),
      );
    } else if (sec !== 'break') {
      for (const s of bar % 2 ? [6, 10, 14] : [6, 14])
        [12, 12 + third(chord), 19, 22].forEach((iv) =>
          notes.push({ step: at + s, layer: 'ep', midi: root + iv, len: 2, vel: humanize(r, 0.5) }),
        );
    }

    // The sequencer bass: sixteenths from bar 2, the filter opening with the velocity.
    if (sec !== 'intro') {
      const open = sec === 'bass' ? 0.45 : sec === 'break' ? 0.55 : 0.8;
      bass.forEach((iv, s) =>
        notes.push({
          step: at + s,
          layer: 'bass',
          midi: root + iv,
          len: 1,
          vel: humanize(r, s % 4 === 0 ? open : open * 0.75),
        }),
      );
    }

    // The drum machine: kick and a gated snare, sixteenth hats, an open hat in the hook.
    if (drums) {
      if (bar === 8 || bar === 14) notes.push(drum(at, 'crash', 0.6, 0, 12));
      for (const s of [0, 8, ...(bar % 2 ? [6, 10] : [])])
        notes.push(drum(at + s, 'kick', humanize(r, 0.95)));
      for (const s of [4, 12]) notes.push(drum(at + s, 'snare', humanize(r, 0.9)));
      for (let s = 0; s < S; s++)
        if (!(last && s >= 12))
          notes.push(drum(at + s, 'hat', humanize(r, s % 4 === 2 ? 0.5 : s % 2 ? 0.2 : 0.35)));
      if (sec !== 'verse') notes.push(drum(at + 14, 'openhat', humanize(r, 0.5)));
      if (last)
        for (let s = 12; s < S; s++) notes.push(drum(at + s, 'snare', humanize(r, 0.45 + 0.12 * (s - 12))));
    } else if (sec === 'break') {
      notes.push(drum(at, 'kick', humanize(r, 0.9)));
      for (let s = 2; s < S; s += 4) notes.push(drum(at + s, 'hat', humanize(r, 0.35)));
    }

    // The glassy arpeggio: sixteenths in the hook and the break.
    if (sec === 'hook' || sec === 'break') {
      const tones = [24, 24 + third(chord), 31, 36];
      for (let s = 0; s < S; s++)
        notes.push({
          step: at + s,
          layer: 'arp',
          midi: root + tones[[0, 1, 2, 3, 2, 1][s % 6]!]!,
          len: 1,
          vel: humanize(r, s % 4 === 0 ? 0.42 : 0.28),
        });
    }

    // The lead: a hook in bars 8-9, an answer in 10-11, long sliding notes over the break, then the
    // hook again.
    if (sec === 'hook') {
      const line = phrase(
        r,
        at,
        pick(r, DARK_LEAD),
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
      for (const n of line.notes) if (n.len >= 6 && r() < 0.5) n.slide = -2;
      if (bar <= 9) hook.push(...line.notes);
      notes.push(...line.notes);
      prev = line.last;
    } else if (sec === 'break') {
      const m = nearestOf(chordPcs(chord, [10]), key, prev, lo, hi);
      notes.push({ step: at, layer: 'lead', midi: m, len: 12, vel: humanize(r, 0.6), slide: -2 });
      prev = m;
    } else if (sec === 'return') {
      // The hook of bars 8-9, six bars on, fitted to these bars' chords.
      notes.push(
        ...refit(
          hook.filter((n) => Math.floor(n.step / S) === bar - 6),
          6 * S,
          chord,
          key,
          scale,
          lo,
          hi,
        ),
      );
    }
  }
  return finish(
    { preset: 'darkwave-band', seed, bpm, key, form, stepsPerBeat: 4, stepsPerBar: S, bars },
    notes,
  );
}

// ---------------------------------------------------------------------------------------------
// Swamp blues (the Keys)

/** Bars of a blues as [degree, minor] (0 = I, 5 = IV, 7 = V, 8 = bVI). */
export const SWAMP_FORMS: Readonly<Record<string, readonly (readonly [number, boolean])[]>> = {
  twelve: [0, 0, 0, 0, 5, 5, 0, 0, 7, 5, 0, 7].map((d) => [d, false] as const),
  quick: [0, 5, 0, 0, 5, 5, 0, 0, 7, 5, 0, 7].map((d) => [d, false] as const),
  minor: [0, 0, 0, 0, 5, 5, 0, 0, 8, 7, 0, 7].map((d) => [d, d === 0 || d === 5] as const),
  stomp: [0, 0, 5, 0, 7, 5, 0, 7].map((d) => [d, false] as const),
};
/** Twelve steps a bar: triplet eighths, four beats. */
const T = 12;
/** Swung-eighth positions in a triplet bar. */
const SWING = [0, 2, 3, 5, 6, 8, 9, 11];
const SWAMP_LICKS: readonly (readonly number[])[] = [
  [3, 3, 6],
  [2, 1, 3, 6],
  [6, 2, 1, 3],
  [-3, 3, 3, 3],
  [2, 1, 2, 1, 6],
];

function composeSwamp(params: Readonly<Record<string, unknown>>, seed: number): Composition {
  const { r, bpm, key, form } = common(
    params,
    seed,
    [84, 108],
    ['E', 'A', 'G', 'D', 'C'],
    formIds(SWAMP_FORMS),
  );
  const degrees = SWAMP_FORMS[form] ?? SWAMP_FORMS['twelve']!;
  const chorus = degrees.length;
  // Two choruses: the harmonica calls and the slide answers, then the slide solos.
  const bars = chorus * 2;
  const notes: RadioNote[] = [];
  let harp = key + 31;
  let slide = key + 26;

  for (let bar = 0; bar < bars; bar++) {
    const b = bar % chorus;
    const [deg, isMinor] = degrees[b]!;
    const [nextDeg] = degrees[(b + 1) % chorus]!;
    const root = key + deg;
    const at = bar * T;
    const second = bar >= chorus;
    const turn = b === chorus - 1;
    const call = Math.floor(b / 2) % 2 === 0;
    const chord: Chord = { root: deg, minor: isMinor };

    // The foot stomp on one and three (a pickup now and then), a laid-back snare on two and four.
    for (const s of [0, 6, ...(b % 2 ? [11] : [])])
      notes.push(drum(at + s, 'kick', humanize(r, s === 11 ? 0.55 : 0.9)));
    for (const s of [3, 9]) notes.push(drum(at + s, 'snare', humanize(r, 0.75)));
    if (turn) for (const s of [10, 11]) notes.push(drum(at + s, 'snare', humanize(r, 0.6)));
    // The washboard: every triplet, the beat hardest, from the second bar.
    if (bar > 0)
      for (let s = 0; s < T; s++)
        notes.push(drum(at + s, 'scrape', humanize(r, s % 3 === 0 ? 0.7 : s % 3 === 2 ? 0.45 : 0.25)));

    // The walking bass: quarter notes up the chord and down, with a pickup into the next bar.
    const line = bar % 2 === 0 ? [0, 4 - (isMinor ? 1 : 0), 7, 9] : [10, 9, 7, 4 - (isMinor ? 1 : 0)];
    line.forEach((iv, k) =>
      notes.push({
        step: at + k * 3,
        layer: 'bass',
        midi: root + iv,
        len: 2,
        vel: humanize(r, k % 2 ? 0.8 : 0.95),
      }),
    );
    if (nextDeg !== deg)
      notes.push({ step: at + 11, layer: 'bass', midi: key + nextDeg - 1, len: 1, vel: humanize(r, 0.7) });

    // The tremolo guitar: the chord's dominant seventh held half a bar, pulsing with the tempo (the rig).
    const seventh = [12, 12 + third(chord), 19, 22].map((iv) => root + iv);
    for (const s of second ? [0, 9] : [0, 6]) {
      seventh.forEach((m, i) =>
        notes.push({
          step: at + s,
          layer: 'rhythm',
          midi: m,
          len: second && s === 9 ? 3 : 6,
          vel: humanize(r, 0.55),
          strum: i,
        }),
      );
    }

    // The turnaround: a chromatic walk down to the five.
    if (turn) {
      [10, 9, 8, 7].forEach((iv, k) => {
        const n: RadioNote = {
          step: at + k * 3,
          layer: 'lead',
          midi: key + 12 + iv,
          len: 2,
          vel: humanize(r, 0.7),
        };
        if (k === 0) n.slide = -2;
        notes.push(n);
      });
      continue;
    }

    const pcs = chordPcs(chord, [10]);
    // Who leads this bar: in the first chorus the harmonica calls for two bars and the slide answers
    // for two; in the second the slide solos and the harmonica fills every fourth bar.
    const harpBar = second ? b % 4 === 3 : call;
    if (harpBar) {
      const lick = phrase(
        r,
        at,
        second ? [-6, 2, 1, 3] : pick(r, SWAMP_LICKS),
        pcs,
        BLUES,
        key,
        harp,
        key + 26,
        key + 41,
        'harp',
        0.75,
        (s) => s % 6 === 0,
      );
      for (const n of lick.notes) if (n.len >= 3 && r() < 0.6) n.slide = -1;
      // A warble on the long note: the note and the one above it, alternating triplets.
      const long = lick.notes.find((n) => n.len >= 6);
      if (long) {
        const up = walk(BLUES, key, long.midi, 1, key + 26, key + 43);
        long.len = 1;
        for (let k = 1; k < 6; k++)
          lick.notes.push({
            ...plain(long),
            step: long.step + k,
            midi: k % 2 ? up : long.midi,
            vel: long.vel * 0.85,
          });
      }
      notes.push(...lick.notes);
      harp = lick.last;
    } else {
      // The slide guitar: answers in the first chorus, the solo in the second; every note slides in.
      const ans = phrase(
        r,
        at,
        pick(
          r,
          second
            ? [
                [3, 3, 3, 3],
                [2, 1, 3, 6],
                [6, 3, 3],
                [1, 1, 1, 3, 6],
              ]
            : SWAMP_LICKS,
        ),
        pcs,
        BLUES,
        key,
        slide,
        key + 19,
        key + 36,
        'lead',
        0.8,
        (s) => s % 6 === 0,
      );
      for (const n of ans.notes) n.slide = r() < 0.5 ? -3 : r() < 0.5 ? -5 : 2;
      notes.push(...ans.notes);
      slide = ans.last;
    }
  }
  return finish({ preset: 'swamp-band', seed, bpm, key, form, stepsPerBeat: 3, stepsPerBar: T, bars }, notes);
}

// ---------------------------------------------------------------------------------------------
// Jazz (San Francisco)

type Quality = 'maj7' | 'm7' | '7' | 'm7b5' | 'dim7' | 'alt';
type JChord = { root: number; q: Quality };
const J = (root: number, q: Quality): JChord => ({ root, q });
/** Each bar's chords (one or two, two beats each). */
export const JAZZ_FORMS: Readonly<Record<string, readonly (readonly JChord[])[]>> = {
  // I vi | ii V | iii VI | ii V | I I7 | IV #iv dim | iii VI | ii V.
  rhythm: [
    [J(0, 'maj7'), J(9, 'm7')],
    [J(2, 'm7'), J(7, '7')],
    [J(4, 'm7'), J(9, '7')],
    [J(2, 'm7'), J(7, '7')],
    [J(0, 'maj7'), J(0, '7')],
    [J(5, 'maj7'), J(6, 'dim7')],
    [J(4, 'm7'), J(9, '7')],
    [J(2, 'm7'), J(7, 'alt')],
  ],
  // A minor ii-V-i and its relative major: iv7 bVII7 bIIImaj7 bVImaj7 ii(b5) V(alt) i i.
  autumn: [
    [J(5, 'm7')],
    [J(10, '7')],
    [J(3, 'maj7')],
    [J(8, 'maj7')],
    [J(2, 'm7b5')],
    [J(7, 'alt')],
    [J(0, 'm7')],
    [J(0, 'm7')],
  ],
  // A jazz blues: I7 IV7 I7 (v I7) IV7 #iv dim I7 VI7 ii7 V7 (I VI) (ii V).
  blues: [
    [J(0, '7')],
    [J(5, '7')],
    [J(0, '7')],
    [J(7, 'm7'), J(0, '7')],
    [J(5, '7')],
    [J(6, 'dim7')],
    [J(0, '7')],
    [J(9, '7')],
    [J(2, 'm7')],
    [J(7, '7')],
    [J(0, '7'), J(9, '7')],
    [J(2, 'm7'), J(7, '7')],
  ],
  // A modal vamp: Dorian on the root, then a half step up, and home.
  modal: [
    [J(0, 'm7')],
    [J(0, 'm7')],
    [J(0, 'm7')],
    [J(0, 'm7')],
    [J(1, 'm7')],
    [J(1, 'm7')],
    [J(0, 'm7')],
    [J(0, 'm7')],
  ],
};
/** Chord tones (from the root) per quality, and the rootless voicing the piano plays. */
const QUALITY: Readonly<Record<Quality, { tones: number[]; voicing: number[]; scale: number[] }>> = {
  maj7: { tones: [0, 4, 7, 11], voicing: [4, 7, 11, 14], scale: [0, 2, 4, 5, 7, 9, 11] },
  m7: { tones: [0, 3, 7, 10], voicing: [3, 7, 10, 14], scale: [0, 2, 3, 5, 7, 9, 10] },
  '7': { tones: [0, 4, 7, 10], voicing: [4, 9, 10, 14], scale: [0, 2, 4, 5, 7, 9, 10] },
  m7b5: { tones: [0, 3, 6, 10], voicing: [3, 6, 10, 14], scale: [0, 1, 3, 5, 6, 8, 10] },
  dim7: { tones: [0, 3, 6, 9], voicing: [3, 6, 9, 14], scale: [0, 2, 3, 5, 6, 8, 9, 11] },
  alt: { tones: [0, 4, 8, 10], voicing: [4, 8, 10, 13], scale: [0, 1, 3, 4, 6, 8, 10] },
};
/** Comping rhythms on the triplet grid: the Charleston, its reverse, pushes and anticipations. */
const COMPS: readonly (readonly number[])[] = [
  [0, 5],
  [2, 8],
  [5, 11],
  [3, 9],
  [0, 8],
  [5, 9],
];
const HEAD_RHYTHMS: readonly (readonly number[])[] = [
  [3, 3, 6],
  [2, 1, 3, 6],
  [-3, 2, 1, 6],
  [6, 2, 1, 3],
  [2, 1, 2, 1, 6],
];

function composeJazz(params: Readonly<Record<string, unknown>>, seed: number): Composition {
  const { r, bpm, key, form } = common(
    params,
    seed,
    [132, 184],
    ['F', 'C', 'G', 'D', 'A#', 'D#'],
    formIds(JAZZ_FORMS),
  );
  const changes = JAZZ_FORMS[form] ?? JAZZ_FORMS['rhythm']!;
  const chorus = changes.length;
  // The head, then a chorus of solo.
  const bars = chorus * 2;
  const notes: RadioNote[] = [];
  const chordAt = (bar: number, beat: number): JChord => {
    const cs = changes[bar % chorus]!;
    return cs.length === 1 ? cs[0]! : cs[beat < 2 ? 0 : 1]!;
  };
  /** A chord's own root (absolute), its tones as pitch classes and its scale (from its root). */
  const of = (c: JChord) => {
    const root = key + c.root;
    return {
      root,
      tones: QUALITY[c.q].tones.map((t) => pc(root + t)),
      rel: QUALITY[c.q].tones,
      scale: QUALITY[c.q].scale,
    };
  };
  const lo = key + 22;
  const hi = key + 41;
  const head: RadioNote[] = [];
  let prev = key + 31;
  let walkNote = key;

  for (let bar = 0; bar < bars; bar++) {
    const at = bar * T;
    const b = bar % chorus;
    const solo = bar >= chorus;
    const last = bar === bars - 1;
    const split = changes[b]!.length === 2;

    // The ride's swing (ding, ding-a, ding, ding-a), the hat's foot on two and four, a feathered kick,
    // the snare's chatter on the triplets, and a bomb to set up each chorus.
    for (const s of [0, 3, 5, 6, 9, 11])
      notes.push(drum(at + s, 'ride', humanize(r, s === 5 || s === 11 ? 0.45 : 0.7)));
    for (const s of [3, 9]) notes.push(drum(at + s, 'hat', humanize(r, 0.6)));
    for (const s of [0, 3, 6, 9]) notes.push(drum(at + s, 'kick', humanize(r, 0.25)));
    for (let s = 1; s < T; s += 1)
      if (s % 3 !== 0 && r() < 0.18) notes.push(drum(at + s, 'snare', humanize(r, 0.22)));
    if (b === chorus - 1) {
      notes.push(drum(at + 11, 'kick', humanize(r, 0.8)));
      notes.push(drum(at + 11, 'snare', humanize(r, 0.6)));
    }

    // The walking bass: the root on each new chord, chord tones between, and a half step into the
    // next chord's root on the beat before it.
    for (let beat = 0; beat < 4; beat++) {
      const c = of(chordAt(bar, beat));
      const nextC = of(beat === 3 ? chordAt(bar + 1, 0) : chordAt(bar, beat + 1));
      let m: number;
      if (beat === 0 || (split && beat === 2)) m = nearestOf([pc(c.root)], 0, walkNote, key - 2, key + 12);
      else if (beat === 3 || (split && beat === 1))
        m = nearestOf([pc(nextC.root)], 0, walkNote, key - 1, key + 11) + (r() < 0.5 ? -1 : 1);
      else m = nearestOf(c.tones.slice(1), 0, walkNote + (r() < 0.5 ? 4 : -4), key - 2, key + 12);
      walkNote = m;
      notes.push({
        step: at + beat * 3,
        layer: 'bass',
        midi: m,
        len: 3,
        vel: humanize(r, beat % 2 ? 0.8 : 0.9),
      });
    }

    // The piano comps rootless voicings on a rhythm per bar, near middle C.
    for (const s of last ? [0] : pick(r, COMPS)) {
      const c = chordAt(bar, Math.floor(s / 3));
      const v = QUALITY[c.q].voicing.map((iv) => key + 12 + c.root + iv);
      while (v[0]! > key + 22) for (let i = 0; i < v.length; i++) v[i]! -= 12;
      for (const m of v)
        notes.push({ step: at + s, layer: 'ep', midi: m, len: s % 3 === 0 ? 3 : 2, vel: humanize(r, 0.5) });
    }

    // The horn: the head (an eight-bar melody whose bars 4-5 echo bars 0-1 over their own chords),
    // then the solo.
    if (!solo) {
      if (chorus === 8 && (b === 4 || b === 5)) {
        for (const n of head.filter((h) => Math.floor(h.step / T) === b - 4)) {
          // Chord tones on the strong beats (one and three), the chord's scale between.
          const s = n.step % T;
          const c = of(chordAt(bar, Math.floor(s / 3)));
          notes.push({
            ...n,
            step: at + s,
            midi: nearestOf(s % 6 === 0 ? c.rel : c.scale, c.root, n.midi, lo, hi),
          });
        }
        continue;
      }
      const c = of(chordAt(bar, 0));
      const line = phrase(
        r,
        at,
        b === chorus - 1 ? [6, -6] : pick(r, HEAD_RHYTHMS),
        c.rel,
        c.scale,
        c.root,
        prev,
        lo,
        hi,
        'lead',
        0.72,
        (s) => s % 6 === 0,
      );
      head.push(...line.notes);
      notes.push(...line.notes);
      prev = line.last;
    } else {
      // The solo: swung eighths (the off-beat leaned on), a breath now and then, a triplet run now
      // and then, each beat aimed at a chord tone.
      if (b % 2 === 1 && r() < 0.5) {
        // A breath, then a pickup into the next bar.
        for (const s of [8, 9, 11]) {
          const c = of(chordAt(bar, Math.floor(s / 3)));
          prev = walk(c.scale, c.root, prev, 1, lo, hi);
          notes.push({
            step: at + s,
            layer: 'lead',
            midi: prev,
            len: s === 8 ? 1 : 2,
            vel: humanize(r, s === 11 ? 0.8 : 0.65),
          });
        }
        continue;
      }
      const run = r() < 0.3;
      const slots = run ? [0, 1, 2, 3, 5, 6, 8, 9, 11] : SWING;
      let dir = prev > key + 34 ? -1 : 1;
      for (const s of slots) {
        const c = of(chordAt(bar, Math.floor(s / 3)));
        if (s % 3 === 0) prev = nearestOf(c.tones, 0, prev + dir * 2, lo, hi);
        else prev = walk(c.scale, c.root, prev, dir, lo, hi);
        if (prev >= hi - 1) dir = -1;
        if (prev <= lo + 1) dir = 1;
        if (r() < 0.15) dir = -dir;
        notes.push({
          step: at + s,
          layer: 'lead',
          midi: prev,
          len: run && s < 3 ? 1 : 2,
          vel: humanize(r, s % 3 === 0 ? 0.62 : 0.78),
        });
      }
    }
  }
  return finish({ preset: 'jazz-band', seed, bpm, key, form, stepsPerBeat: 3, stepsPerBar: T, bars }, notes);
}
