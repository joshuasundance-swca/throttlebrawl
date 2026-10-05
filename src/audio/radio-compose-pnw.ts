// The Pacific Northwest's three dial bands, rewritten as whole songs (playtest 4, P4-17: "The more
// complex SF music is impressive probably my favorite I like Keys music too but PNW seems very simple
// and slow. It's not as good as the others even if I get the motivation and vibe."; the maintainer
// picked all four directions: driving garage and grunge, indie and folk with drive, rainy-night synth
// for Portland, and "the same vibe, more complex"). The vibe stays: the same instruments, keys and
// progressions. What changes is what made San Francisco's bands rich: faster tempos, sixteenth-note
// motion, parts that enter one by one, sections (a riff, a verse, a build, a chorus, a solo, a break)
// instead of one eight-bar loop, and melodies that answer and harmonise. Sixteen bars each. Pure; the
// rigs in radio-rigs.ts and radio-rigs-more.ts play them.
// - `grunge-band`: 112-148 bpm. A drop-tuned riff over sixteenth hats, a quiet verse (clean
//   arpeggios, a sung-style line), a two-bar build (ringing chords, a snare roll), a loud chorus of
//   chugged power chords whose hook comes back with a harmony, and the riff to close.
// - `folk-band`: 116-148 bpm. Strummed guitar and a stomp, a verse with the glockenspiel tune, a build,
//   then a driving chorus: four-on-the-floor stomp, sixteenth tambourine, banjo rolls, the hook, and a
//   tremolo-picked mandolin doubling it.
// - `stoner-band`: 100-126 bpm. The fuzz riff on a straight groove with busy hats, a half-time doom
//   break of ringing chords under a washing ride, a galloping wah solo that ends in a run, the riff
//   again and the doom to close.
import type { Composition, RadioNote } from './radio-compose';
import { STONER_FORMS } from './radio-compose-more';
import {
  BARS,
  chordPcs,
  common,
  drum,
  FOLK_FORMS,
  GRUNGE_FORMS,
  melodyBar,
  refit,
  S,
  third,
  type Chord,
} from './radio-compose-regional';
import { finish, humanize, nearestOf, pick, scaleStep } from './radio-util';

export const PNW_PRESETS = ['grunge-band', 'folk-band', 'stoner-band'] as const;

/** Composes one of the three rewritten bands; null for a name this file does not know. */
export function composePnw(
  preset: string,
  params: Readonly<Record<string, unknown>>,
  seed: number,
): Composition | null {
  if (preset === 'grunge-band') return composeGrunge(params, seed);
  if (preset === 'folk-band') return composeFolk(params, seed);
  if (preset === 'stoner-band') return composeStoner(params, seed);
  return null;
}

const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const MINOR_PENTA = [0, 3, 5, 7, 10];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MAJOR_PENTA = [0, 2, 4, 7, 9];

/** Every Pacific Northwest dial song is sixteen bars: twice the old loop. */
export const PNW_BARS = 2 * BARS;

/** A riff step: [step, length, semitones above the chord's root]. */
type Riff = readonly (readonly [number, number, number])[];

const base = (preset: string, seed: number, c: { bpm: number; key: number; form: string }) => ({
  preset: preset as Composition['preset'],
  seed,
  bpm: c.bpm,
  key: c.key,
  form: c.form,
  stepsPerBeat: 4 as const,
  stepsPerBar: S,
  bars: PNW_BARS,
});

/** A phrase moved `bars` bars on. */
const later = (notes: readonly RadioNote[], bars: number): RadioNote[] =>
  notes.map((n) => ({ ...n, step: n.step + bars * S }));

/** The bar a note starts in. */
const barOf = (n: RadioNote) => Math.floor(n.step / S);

/** A bass note into the next chord: a half step below or above its root. */
const approach = (key: number, chord: Chord, next: Chord) =>
  key + next.root + (next.root > chord.root ? -1 : 1);

// ---------------------------------------------------------------------------------------------
// Grunge

export type GrungeSection = 'riff' | 'verse' | 'pre' | 'chorus' | 'out';
export const GRUNGE_PLAN: readonly GrungeSection[] = [
  'riff',
  'riff',
  'verse',
  'verse',
  'verse',
  'verse',
  'pre',
  'pre',
  'chorus',
  'chorus',
  'chorus',
  'chorus',
  'chorus',
  'chorus',
  'out',
  'out',
];
const GRUNGE_RIFFS: readonly Riff[] = [
  [
    [0, 2, 0],
    [2, 1, 0],
    [3, 1, 0],
    [4, 2, 3],
    [6, 2, 0],
    [8, 1, 0],
    [9, 1, 0],
    [10, 2, 5],
    [12, 2, 6],
    [14, 2, 5],
  ],
  [
    [0, 3, 0],
    [3, 3, 0],
    [6, 2, 3],
    [8, 2, 0],
    [10, 2, -2],
    [12, 4, 0],
  ],
  [
    [0, 2, 0],
    [2, 2, 7],
    [4, 2, 6],
    [6, 2, 5],
    [8, 3, 0],
    [11, 1, 0],
    [12, 2, 3],
    [14, 2, 1],
  ],
];
const GRUNGE_VERSE_RHYTHMS: readonly (readonly number[])[] = [
  [8, 8],
  [-4, 4, 8],
  [6, 2, 8],
  [-2, 6, 8],
  [4, 4, 4, 4],
  [-4, 2, 2, 8],
];
const GRUNGE_HOOK_RHYTHMS: readonly (readonly number[])[] = [
  [8, 4, 4],
  [12, 4],
  [6, 2, 8],
  [4, 4, 8],
];
/** The clean guitar's arpeggio shapes over a chord (intervals over its root), eighths. */
const ARPS = (c: Chord): readonly (readonly number[])[] => [
  [12, 19, 24, 24 + third(c), 24, 19, 12 + third(c), 19],
  [12, 19, 24 + third(c), 31, 24 + third(c), 24, 19, 24 + third(c)],
];

export function composeGrunge(params: Readonly<Record<string, unknown>>, seed: number): Composition {
  const { r, bpm, key, form, prog } = common(
    params,
    seed,
    [112, 148],
    ['D', 'E', 'C#', 'B', 'G', 'A'],
    GRUNGE_FORMS,
  );
  const notes: RadioNote[] = [];
  const riff = pick(r, GRUNGE_RIFFS);
  const tonic = prog[0]!;
  const verseLo = key + 19;
  const verseHi = key + 34;
  let prev = key + 24;
  const verse: RadioNote[] = [];
  const hook: RadioNote[] = [];
  const bars = PNW_BARS;

  // The riff sits on the key; the verse and the chorus each walk the progression from its top; the
  // build leans on its last two chords.
  const chordOf = (bar: number): Chord => {
    const sec = GRUNGE_PLAN[bar % bars]!;
    const into = (bar % bars) - GRUNGE_PLAN.indexOf(sec);
    if (sec === 'riff' || sec === 'out') return tonic;
    if (sec === 'pre') return prog[2 + into]!;
    return prog[into % prog.length]!;
  };

  for (let bar = 0; bar < bars; bar++) {
    const sec = GRUNGE_PLAN[bar]!;
    const chord = chordOf(bar);
    const next = chordOf(bar + 1);
    const root = key + chord.root;
    const at = bar * S;
    const last = bar === bars - 1;

    // --- Drums ---
    if (bar === 0 || bar === 8 || bar === 10 || bar === 12 || bar === 14)
      notes.push(drum(at, 'crash', bar === 0 ? 0.6 : 0.9, 0, 12));
    if (sec === 'riff' || sec === 'out') {
      for (const [s] of riff)
        if (s % 2 === 0 && !(last && s >= 12))
          notes.push(drum(at + s, 'kick', humanize(r, s === 0 ? 0.95 : 0.8)));
      for (const s of [4, 12]) if (!(last && s >= 12)) notes.push(drum(at + s, 'snare', humanize(r, 0.9)));
      for (let s = 0; s < S; s++)
        if (!(last && s >= 12))
          notes.push(drum(at + s, 'hat', humanize(r, s % 2 ? 0.2 : s % 4 === 0 ? 0.5 : 0.32)));
      if (last)
        for (let s = 12; s < S; s++) notes.push(drum(at + s, 'tom', humanize(r, 0.85), 50 - 3 * (s - 12)));
    } else if (sec === 'verse') {
      for (const s of [0, 7, 8, ...(bar % 2 ? [11] : [])]) notes.push(drum(at + s, 'kick', humanize(r, 0.8)));
      for (const s of [4, 12]) notes.push(drum(at + s, 'snare', humanize(r, 0.65)));
      // Sixteenth hats: the eighths leaned on.
      for (let s = 0; s < S; s++)
        notes.push(drum(at + s, 'hat', humanize(r, s % 2 ? 0.2 : s % 4 === 0 ? 0.45 : 0.35)));
    } else if (sec === 'pre') {
      const roll = bar === 7;
      for (const s of roll ? [0, 4, 8, 12] : [0, 8]) notes.push(drum(at + s, 'kick', humanize(r, 0.9)));
      // The build: snare on two and four, eighths from the middle of bar 6, a sixteenth roll in bar 7.
      if (roll) for (let s = 0; s < S; s++) notes.push(drum(at + s, 'snare', humanize(r, 0.3 + 0.042 * s)));
      else
        for (const s of [4, 8, 10, 12, 14])
          notes.push(drum(at + s, 'snare', humanize(r, s < 8 ? 0.7 : 0.5 + 0.03 * s)));
      for (let s = 0; s < S; s += 2) notes.push(drum(at + s, 'hat', humanize(r, 0.4)));
    } else {
      const kicks = [0, 3, 8, 10, ...(bar % 2 ? [14] : [])];
      for (const s of kicks) notes.push(drum(at + s, 'kick', humanize(r, 0.95)));
      for (const s of [4, 12]) notes.push(drum(at + s, 'snare', humanize(r, 0.95)));
      if (bar === 13) for (const s of [13, 14, 15]) notes.push(drum(at + s, 'snare', humanize(r, 0.8)));
      for (let s = 0; s < S; s += 2)
        notes.push(drum(at + s, 'openhat', humanize(r, s % 4 === 0 ? 0.6 : 0.45)));
    }

    // --- Bass ---
    if (sec === 'riff' || sec === 'out') {
      for (const [s, len, iv] of riff) {
        if (last && s >= 12) continue;
        notes.push({ step: at + s, layer: 'bass', midi: root + iv, len, vel: humanize(r, 0.92) });
      }
    } else {
      // Driving eighths; an octave pop in the chorus, and an approach into the next chord.
      for (let e = 0; e < 8; e++) {
        let m = root + (sec === 'chorus' && e === 3 ? 12 : 0);
        if (e === 7 && next.root !== chord.root) m = approach(key, chord, next);
        const vel = sec === 'verse' ? (e % 2 ? 0.55 : 0.75) : e % 2 ? 0.75 : 0.95;
        notes.push({ step: at + e * 2, layer: 'bass', midi: m, len: 2, vel: humanize(r, vel) });
      }
    }

    // --- Guitars ---
    if (sec === 'riff' || sec === 'out') {
      // The riff in fifths, a drop-tuned dyad.
      for (const [s, len, iv] of riff) {
        if (last && s >= 12) continue;
        for (const [i, up] of [0, 7].entries())
          notes.push({
            step: at + s,
            layer: 'rhythm',
            midi: root + 12 + iv + up,
            len,
            vel: humanize(r, 0.85),
            strum: i,
          });
      }
    } else if (sec === 'verse') {
      // The clean arpeggio, its shape changing halfway through the verse.
      const shape = ARPS(chord)[bar < 4 ? 0 : 1]!;
      shape.forEach((iv, e) =>
        notes.push({
          step: at + e * 2,
          layer: 'arp',
          midi: root + iv,
          len: 3,
          vel: humanize(r, e === 0 ? 0.65 : 0.48),
        }),
      );
      // The sung line: bars 2 and 3 written, bar 4 echoes bar 2 over its own chord, bar 5 answers.
      if (bar === 4)
        verse.push(
          ...refit(
            verse.filter((n) => barOf(n) === 2),
            2 * S,
            chord,
            key,
            MINOR_PENTA,
            verseLo,
            verseHi,
          ),
        );
      else {
        const { notes: line, last: end } = melodyBar(
          r,
          at,
          pick(r, GRUNGE_VERSE_RHYTHMS),
          chord,
          key,
          MINOR_PENTA,
          prev,
          verseLo,
          verseHi,
          'lead',
          0.6,
        );
        for (const n of line) if (r() < 0.4 && n.len >= 4) n.slide = -2;
        verse.push(...line);
        prev = end;
      }
    } else if (sec === 'pre') {
      // Ringing chords on every beat, louder each time, and a long bent note over them.
      for (const s of [0, 4, 8, 12])
        [12, 19, 24].forEach((iv, i) =>
          notes.push({
            step: at + s,
            layer: 'rhythm',
            midi: root + iv,
            len: 4,
            vel: humanize(r, 0.5 + 0.03 * (s / 4 + (bar - 6) * 4)),
            strum: i,
          }),
        );
      if (bar === 6) {
        const top = nearestOf(chordPcs(chord), key, key + 31, key + 26, key + 38);
        notes.push({ step: at, layer: 'lead', midi: top, len: 12, vel: humanize(r, 0.7), slide: -2 });
        prev = top;
      }
    } else {
      // The chorus: power chords (root, fifth, octave) chugged on eighths, accents on the beat, and a
      // sixteenth "chug-a" into beats two and four.
      for (const s of [0, 2, 4, 6, 7, 8, 10, 12, 14, 15]) {
        const ring = s === 0 || s === 8;
        [12, 19, 24].forEach((iv, i) =>
          notes.push({
            step: at + s,
            layer: 'rhythm',
            midi: root + iv,
            len: ring ? 2 : 1,
            vel: humanize(r, s % 4 === 0 ? 0.85 : s % 2 ? 0.5 : 0.6),
            strum: i,
          }),
        );
      }
      // The hook: bars 8-9 written, 10-11 an answer, 12-13 the hook again (over the same chords)
      // with a harmony a third above.
      if (bar === 12 || bar === 13) {
        for (const n of hook.filter((h) => barOf(h) === bar - 4)) {
          const moved = { ...n, step: n.step + 4 * S };
          notes.push(moved, { ...moved, midi: scaleStep(AEOLIAN, key, n.midi, 2), vel: n.vel * 0.7 });
        }
      } else {
        const { notes: line, last: end } = melodyBar(
          r,
          at,
          bar === 11 ? [8, 8] : pick(r, GRUNGE_HOOK_RHYTHMS),
          chord,
          key,
          MINOR_PENTA,
          prev,
          key + 26,
          key + 41,
          'lead',
          0.82,
        );
        for (const n of line) if (n.len >= 4 && r() < 0.6) n.slide = -2;
        if (bar <= 9) hook.push(...line);
        notes.push(...line);
        prev = end;
      }
    }
  }
  notes.push(...verse);
  return finish(base('grunge-band', seed, { bpm, key, form }), notes);
}

// ---------------------------------------------------------------------------------------------
// Indie folk

export type FolkSection = 'intro' | 'verse' | 'build' | 'chorus' | 'outro';
export const FOLK_PLAN: readonly FolkSection[] = [
  'intro',
  'intro',
  'verse',
  'verse',
  'verse',
  'verse',
  'build',
  'build',
  'chorus',
  'chorus',
  'chorus',
  'chorus',
  'chorus',
  'chorus',
  'outro',
  'outro',
];
const FOLK_RHYTHMS: readonly (readonly number[])[] = [
  [4, 4, 8],
  [2, 2, 4, 8],
  [4, 2, 2, 4, 4],
  [6, 2, 4, 4],
  [8, 4, 4],
];
const FOLK_HOOKS: readonly (readonly number[])[] = [
  [4, 4, 4, 4],
  [2, 2, 4, 4, 4],
  [6, 2, 4, 4],
  [4, 2, 2, 8],
];
/** Down (true) and up strokes, on sixteenths: the verse's lilt (a quick up stroke into beats two and
 * four) and the chorus's eighths. */
const STRUM: readonly (readonly [number, boolean])[] = [
  [0, true],
  [3, false],
  [4, true],
  [6, false],
  [10, false],
  [11, false],
  [12, true],
  [14, false],
];
const STRUM_DRIVE: readonly (readonly [number, boolean])[] = [
  [0, true],
  [2, false],
  [4, true],
  [6, false],
  [8, true],
  [10, false],
  [12, true],
  [14, false],
];

export function composeFolk(params: Readonly<Record<string, unknown>>, seed: number): Composition {
  const { r, bpm, key, form, prog } = common(params, seed, [116, 148], ['G', 'C', 'D', 'A', 'F'], FOLK_FORMS);
  const notes: RadioNote[] = [];
  const lo = key + 31;
  const hi = key + 50;
  let prev = key + 36 + 4;
  const tune: RadioNote[] = [];
  const hook: RadioNote[] = [];
  const bars = PNW_BARS;

  // Each section walks the progression from its top; the build leans on its last two chords, and
  // the outro turns home.
  const chordOf = (bar: number): Chord => {
    const sec = FOLK_PLAN[bar % bars]!;
    const into = (bar % bars) - FOLK_PLAN.indexOf(sec);
    if (sec === 'build') return prog[2 + into]!;
    if (sec === 'outro') return prog[into === 0 ? 3 : 0]!;
    return prog[into % prog.length]!;
  };

  for (let bar = 0; bar < bars; bar++) {
    const sec = FOLK_PLAN[bar]!;
    const chord = chordOf(bar);
    const next = chordOf(bar + 1);
    const root = key + chord.root;
    const at = bar * S;
    const last = bar === bars - 1;
    const drive = sec === 'chorus';

    // --- Stomp, clap and tambourine ---
    const kicks =
      drive || sec === 'build'
        ? [0, 4, 8, 12]
        : last
          ? [0]
          : [0, 8, ...(sec === 'verse' && bar % 2 ? [10] : [])];
    // On every beat the stomp is lighter, so the driving chorus is not just louder than the verse.
    const stomp = kicks.length === 4 ? 0.8 : 0.95;
    for (const s of kicks) notes.push(drum(at + s, 'kick', humanize(r, s % 8 === 0 ? stomp : stomp - 0.12)));
    if (bar > 0) {
      const claps =
        bar === 7 ? [4, 8, 10, 12, 13, 14, 15] : bar === 13 ? [4, 12, 13, 14, 15] : last ? [4] : [4, 12];
      for (const s of claps)
        notes.push(
          drum(at + s, 'clap', humanize(r, s > 12 || (bar === 7 && s > 4) ? 0.55 + 0.03 * s : 0.85)),
        );
    }
    if (bar >= 3 && !last) {
      // Eighths in the verse, sixteenths from the build: the off-beat eighths leaned on.
      const step = drive || sec === 'build' ? 1 : 2;
      for (let s = 0; s < S; s += step)
        notes.push(drum(at + s, 'tamb', humanize(r, s % 4 === 2 ? 0.6 : s % 2 ? 0.22 : 0.35)));
    }

    // --- The strum: down strokes sweep all five strings from the low one; up strokes catch the top
    // three, from the high one ---
    const voicing = [12, 19, 24, 24 + third(chord), 31];
    for (const [s, down] of last ? [[0, true] as const] : drive || sec === 'build' ? STRUM_DRIVE : STRUM) {
      const strings = down ? voicing : voicing.slice(2);
      strings.forEach((iv, i) =>
        notes.push({
          step: at + s,
          layer: 'rhythm',
          midi: root + iv,
          len: last ? 12 : 2,
          vel: humanize(r, down ? (drive && s % 8 === 0 ? 0.68 : 0.6) : 0.42),
          strum: down ? i : strings.length - 1 - i,
        }),
      );
    }

    // --- The upright bass ---
    if (sec === 'verse' || sec === 'outro' || bar === 1) {
      // Root and fifth, walking into the next chord.
      notes.push({ step: at, layer: 'bass', midi: root, len: last ? 12 : 6, vel: humanize(r, 0.9) });
      if (!last) {
        notes.push({ step: at + 8, layer: 'bass', midi: root + 7, len: 4, vel: humanize(r, 0.8) });
        notes.push({
          step: at + 12,
          layer: 'bass',
          midi: key + next.root + (next.root >= chord.root ? -2 : 2),
          len: 4,
          vel: humanize(r, 0.7),
        });
      }
    } else if (bar > 1) {
      // Driving eighths: root, fifth and octave, an approach into the next chord.
      const line = [0, 0, 7, 0, 12, 0, 7, 0];
      for (let e = 0; e < 8; e++) {
        let m = root + line[e]!;
        if (e === 7 && next.root !== chord.root) m = approach(key, chord, next);
        notes.push({
          step: at + e * 2,
          layer: 'bass',
          midi: m,
          len: 2,
          vel: humanize(r, e % 2 ? 0.72 : 0.9),
        });
      }
    }

    // --- Banjo rolls: a forward roll over the chord in the chorus, a pickup in the last verse bar ---
    if (drive || bar === 5 || bar === 14) {
      const roll = [24, 24 + third(chord), 31, 36];
      const order = [0, 1, 2, 0, 1, 2, 0, 3, 0, 1, 2, 0, 1, 2, 0, 3];
      order.forEach((k, s) => {
        if (bar === 5 && s < 8) return;
        notes.push({
          step: at + s,
          layer: 'arp',
          midi: root + roll[k]!,
          len: 1,
          vel: humanize(r, s % 4 === 0 ? 0.55 : 0.4),
        });
      });
    }

    // --- The glockenspiel: the verse's tune (call, answer, the call again over its own chord, a new
    // answer), the chorus's hook (bars 8-9, an answer in 10-11, the hook again in 12-13 over the same
    // chords), and home at the end ---
    if (sec === 'verse') {
      if (bar === 4)
        tune.push(
          ...refit(
            tune.filter((n) => barOf(n) === 2),
            2 * S,
            chord,
            key,
            MAJOR_PENTA,
            lo,
            hi,
          ),
        );
      else {
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
          0.72,
        );
        tune.push(...line);
        prev = end;
      }
    } else if (drive) {
      if (bar === 12 || bar === 13)
        tune.push(
          ...later(
            hook.filter((n) => barOf(n) === bar - 4),
            4,
          ),
        );
      else {
        const { notes: line, last: end } = melodyBar(
          r,
          at,
          bar === 11 ? [4, 4, 8] : pick(r, FOLK_HOOKS),
          chord,
          key,
          bar >= 10 ? MAJOR : MAJOR_PENTA,
          prev,
          lo,
          hi,
          'glock',
          0.8,
        );
        if (bar <= 9) hook.push(...line);
        tune.push(...line);
        prev = end;
      }
    } else if (last) {
      tune.push({
        step: at,
        layer: 'glock',
        midi: nearestOf([0, 4, 7], key, prev, lo, hi),
        len: 12,
        vel: humanize(r, 0.75),
      });
    }
  }
  notes.push(...tune);
  // The mandolin: the second half of the chorus doubles the tune an octave down, tremolo-picked.
  for (const n of tune)
    if (barOf(n) >= 10 && barOf(n) <= 13)
      notes.push({ ...n, layer: 'lead', midi: n.midi - 12, vel: n.vel * 0.75, trem: true });
  return finish(base('folk-band', seed, { bpm, key, form }), notes);
}

// ---------------------------------------------------------------------------------------------
// Stoner

export type StonerSection = 'riff' | 'doom' | 'solo';
export const STONER_PLAN: readonly StonerSection[] = [
  'riff',
  'riff',
  'riff',
  'riff',
  'doom',
  'doom',
  'solo',
  'solo',
  'solo',
  'solo',
  'solo',
  'solo',
  'riff',
  'riff',
  'doom',
  'doom',
];
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
    [4, 3, 5],
    [7, 1, 5],
    [8, 2, 3],
    [10, 2, 0],
    [12, 3, -2],
    [15, 1, 0],
  ],
];
const STONER_SOLO: readonly (readonly number[])[] = [
  [4, 2, 2, 8],
  [6, 2, 8],
  [2, 2, 4, 4, 4],
  [8, 4, 4],
  [2, 2, 2, 2, 8],
];

export function composeStoner(params: Readonly<Record<string, unknown>>, seed: number): Composition {
  const { r, bpm, key, form, prog } = common(
    params,
    seed,
    [100, 126],
    ['C', 'D', 'E', 'F#', 'G'],
    STONER_FORMS,
  );
  const notes: RadioNote[] = [];
  const riff = pick(r, STONER_RIFFS);
  const lo = key + 31;
  const hi = key + 46;
  let prev = key + 36;
  const bars = PNW_BARS;

  for (let bar = 0; bar < bars; bar++) {
    const sec = STONER_PLAN[bar]!;
    const chord = prog[bar % prog.length]!;
    const root = key + chord.root;
    const at = bar * S;
    const last = bar === bars - 1;

    if (sec === 'doom') {
      // Half time: the snare on three only, ringing chords, the bass held under them.
      notes.push(drum(at, 'crash', 0.85, 0, 12));
      notes.push(drum(at, 'kick', humanize(r, 0.95)));
      if (r() < 0.5) notes.push(drum(at + 10, 'kick', humanize(r, 0.8)));
      notes.push(drum(at + 8, 'snare', humanize(r, 0.95)));
      for (let s = 0; s < S; s += 2)
        if (!(last && s >= 12)) notes.push(drum(at + s, 'ride', humanize(r, s % 8 === 0 ? 0.6 : 0.4)));
      if (last)
        for (let s = 12; s < S; s++) notes.push(drum(at + s, 'tom', humanize(r, 0.85), 52 - 2 * (s - 12)));
      for (const s of last ? [0] : [0, 8]) {
        notes.push({ step: at + s, layer: 'bass', midi: root, len: last ? 12 : 8, vel: humanize(r, 0.95) });
        [12, 19, 24].forEach((iv, i) =>
          notes.push({
            step: at + s,
            layer: 'rhythm',
            midi: root + iv,
            len: last ? 12 : 8,
            vel: humanize(r, 0.85),
            strum: i,
          }),
        );
      }
      continue;
    }

    const solo = sec === 'solo';
    // The riff's groove: kick on the one and with the riff, the snare on two and four, eighth hats;
    // under the solo the kick gallops and the ride takes the eighths.
    if (bar === 0 || bar === 12) notes.push(drum(at, 'crash', 0.85, 0, 12));
    if (solo) {
      for (const s of [0, 2, 3, 8, 10, 11])
        notes.push(drum(at + s, 'kick', humanize(r, s % 8 === 0 ? 0.95 : 0.75)));
      for (let s = 0; s < S; s += 2) notes.push(drum(at + s, 'ride', humanize(r, s % 4 === 0 ? 0.6 : 0.42)));
      for (let s = 1; s < S; s += 2) notes.push(drum(at + s, 'hat', humanize(r, 0.2)));
    } else {
      notes.push(drum(at, 'kick', humanize(r, 0.95)));
      for (const [s] of riff)
        if (s > 0 && s % 2 === 0 && r() < 0.55) notes.push(drum(at + s, 'kick', humanize(r, 0.8)));
      // Busy sixteenth hats, the eighths leaned on.
      for (let s = 0; s < S; s++)
        notes.push(drum(at + s, 'hat', humanize(r, s % 2 ? 0.18 : s % 4 === 0 ? 0.5 : 0.32)));
    }
    for (const s of [4, 12]) notes.push(drum(at + s, 'snare', humanize(r, 0.92)));
    if (bar === 11 || bar === 13)
      for (const s of [13, 14, 15]) notes.push(drum(at + s, 'snare', humanize(r, 0.7)));

    // The riff, doubled by the bass an octave down; it goes quiet under the solo.
    for (const [s, len, iv] of riff) {
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

    // The wah solo: bent pentatonic lines, then a sixteenth run up the scale into the riff's return.
    if (solo) {
      if (bar === 11) {
        let m = nearestOf(chordPcs(chord), key, prev - 5, lo, hi);
        for (let s = 0; s < S; s++) {
          notes.push({
            step: at + s,
            layer: 'lead',
            midi: m,
            len: 1,
            vel: humanize(r, s % 4 === 0 ? 0.85 : 0.65),
          });
          m = Math.min(hi, scaleStep(MINOR_PENTA, key, m, 1));
        }
        prev = m;
      } else {
        const { notes: line, last: end } = melodyBar(
          r,
          at,
          pick(r, STONER_SOLO),
          chord,
          key,
          MINOR_PENTA,
          prev,
          lo,
          hi,
          'lead',
          0.8,
        );
        for (const n of line) if (n.len >= 4 && r() < 0.6) n.slide = -2;
        notes.push(...line);
        prev = end;
      }
    }
  }
  return finish(base('stoner-band', seed, { bpm, key, form }), notes);
}
