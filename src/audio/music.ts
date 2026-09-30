// The one original score, made in code ([decided] one original score for M1 and M2). M1 had a
// four-bar surf-rock figure; M2 (audio-2) makes it a fuller loop: sixteen bars of E-minor surf
// rock at 150 bpm in four phrases (the verse, the verse again with a fill, a bridge and a
// turnaround with a tom fill back to the top), with a crash cymbal on each section.
//
// Layers come in with `intensity` (the architecture's music-layer seam; the app sets it from the
// player's speed): drums and the picked bass always, rhythm-guitar chord stabs above 0.25, the
// tremolo-picked lead above 0.45, and the extra kick, open hats and stab pushes above 0.7.
//
// The score is a pure function of the step (`scoreAt`), so tests can read it without audio.
// Notes are scheduled a little ahead from the frame loop, so there are no timers to leak.
import { noiseBuffer } from './engine-patch';

const BPM = 150;
const STEP_S = 60 / BPM / 4; // sixteenth notes
/** Bars in the loop, and sixteenth-note steps. */
export const LOOP_BARS = 16;
const STEPS = LOOP_BARS * 16;
const LOOKAHEAD_S = 0.25;

/** Intensity at which each layer comes in. */
export const LAYER_AT = { stabs: 0.25, lead: 0.45, drive: 0.7 } as const;

/** Semitones above E2 (82.41 Hz) and the chord's quality, per bar. */
type Chord = { root: number; minor: boolean };
const em: Chord = { root: 0, minor: true };
const c: Chord = { root: -4, minor: false };
const d: Chord = { root: -2, minor: false };
const b: Chord = { root: -5, minor: false };
const am: Chord = { root: 5, minor: true };
/** Verse, verse, bridge, turnaround. */
const CHORDS: readonly Chord[] = [em, c, d, b, em, c, d, b, am, c, em, b, c, d, em, em];
const E2 = 82.41;
const hz = (semi: number) => E2 * 2 ** (semi / 12);

// Bass: root, octave and fifth on a driving eighth-note figure (per bar, 16 steps; null = rest).
const BASS: readonly (number | null)[] = [
  0,
  null,
  0,
  12,
  null,
  0,
  7,
  null,
  0,
  null,
  0,
  12,
  null,
  7,
  10,
  null,
];
// The bridge walks instead of pumping.
const BASS_BRIDGE: readonly (number | null)[] = [
  0,
  null,
  0,
  null,
  3,
  null,
  5,
  null,
  7,
  null,
  7,
  null,
  5,
  null,
  3,
  null,
];
// Lead: tremolo-picked lines (semitones above E3 relative to the bar's root), one note per quarter.
const LEAD_VERSE: readonly number[] = [7, 10, 12, 10, 3, 7, 8, 7, 5, 9, 10, 9, 6, 10, 11, 10];
const LEAD_BRIDGE: readonly number[] = [12, 15, 17, 15, 11, 12, 16, 12, 12, 10, 7, 10, 11, 13, 15, 13];
const LEAD_TURN: readonly number[] = [11, 12, 16, 12, 12, 14, 18, 14, 7, 10, 12, 15, 12, 10, 7, 3];

export interface Note {
  layer: 'kick' | 'snare' | 'hat' | 'crash' | 'tom' | 'bass' | 'stab' | 'lead';
  /** Frequency, Hz (0 for pure noise). */
  hz: number;
}

/** What the score plays on loop step `i` at this intensity (0..1). Pure, for tests. */
export function scoreAt(i: number, intensity: number): Note[] {
  const step = ((i % STEPS) + STEPS) % STEPS;
  const s = step % 16;
  const bar = Math.floor(step / 16);
  const chord = CHORDS[bar] ?? em;
  const phrase = Math.floor(bar / 4);
  const fillBar = bar === 7 || bar === 15;
  const out: Note[] = [];
  // Drums. The last half of bars 8 and 16 is a fill: snare rolls, then toms falling to the top.
  if (fillBar && s >= 8) {
    if (bar === 7) out.push({ layer: 'snare', hz: 0 });
    else out.push({ layer: 'tom', hz: 260 - (s - 8) * 18 });
  } else {
    if (s === 0 || s === 8 || (intensity > LAYER_AT.drive && (s === 10 || s === 14)))
      out.push({ layer: 'kick', hz: 150 });
    if (s === 4 || s === 12) out.push({ layer: 'snare', hz: 0 });
    if (s % 2 === 0 || intensity > LAYER_AT.drive) out.push({ layer: 'hat', hz: s % 4 === 2 ? 1 : 0 });
  }
  if (s === 0 && (bar === 0 || bar === 8) && intensity > LAYER_AT.stabs) out.push({ layer: 'crash', hz: 0 });
  // Bass (square, low-passed, so a phone still hears its upper harmonics).
  const bn = (phrase === 2 ? BASS_BRIDGE : BASS)[s];
  if (bn !== null && bn !== undefined) out.push({ layer: 'bass', hz: hz(chord.root + bn) });
  // Rhythm-guitar stabs on the off-beats: a short triad an octave up.
  const stabHere = s === 6 || s === 14 || (intensity > LAYER_AT.drive && (s === 3 || s === 11));
  if (intensity > LAYER_AT.stabs && stabHere && !(fillBar && s >= 8)) {
    for (const iv of [0, chord.minor ? 3 : 4, 7]) out.push({ layer: 'stab', hz: hz(12 + chord.root + iv) });
  }
  // Lead: tremolo-picked sixteenths on the quarter-note line.
  if (intensity > LAYER_AT.lead) {
    const line = phrase === 2 ? LEAD_BRIDGE : phrase === 3 ? LEAD_TURN : LEAD_VERSE;
    const n = line[(bar % 4) * 4 + Math.floor(s / 4)] ?? 7;
    out.push({ layer: 'lead', hz: hz(12 + chord.root + n) });
  }
  return out;
}

export interface MusicLoop {
  /** Schedules notes up to a little past `now`; call every frame. */
  pump(now: number, playing: boolean, intensity: number): void;
  readonly playing: () => boolean;
}

export function createMusic(ctx: BaseAudioContext, out: AudioNode): MusicLoop {
  let on = false;
  let step = 0;
  let next = 0;
  const bus = ctx.createGain();
  bus.gain.value = 0;
  bus.connect(out);

  const env = (t: number, peak: number, decay: number) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    g.connect(bus);
    return g;
  };
  const osc = (
    type: OscillatorType,
    f0: number,
    f1: number,
    t: number,
    peak: number,
    decay: number,
    lp?: number,
  ) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + decay);
    const g = env(t, peak, decay);
    if (lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      o.connect(f).connect(g);
    } else o.connect(g);
    o.start(t);
    o.stop(t + decay + 0.02);
  };
  const noise = (type: BiquadFilterType, f: number, t: number, peak: number, decay: number) => {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(ctx);
    n.loop = true;
    const bq = ctx.createBiquadFilter();
    bq.type = type;
    bq.frequency.value = f;
    n.connect(bq).connect(env(t, peak, decay));
    n.start(t, (step * 0.137) % 0.9);
    n.stop(t + decay + 0.02);
  };

  const play = (i: number, t: number, intensity: number) => {
    for (const note of scoreAt(i, intensity)) {
      switch (note.layer) {
        case 'kick':
          osc('sine', note.hz, 45, t, 0.9, 0.18);
          break;
        case 'snare':
          noise('bandpass', 1800, t, 0.5, 0.12);
          break;
        case 'hat':
          noise('highpass', 7000, t, note.hz === 1 ? 0.18 : 0.1, 0.03);
          break;
        case 'crash':
          noise('highpass', 5000, t, 0.22, 0.9);
          break;
        case 'tom':
          osc('sine', note.hz, note.hz * 0.6, t, 0.6, 0.14);
          break;
        case 'bass':
          osc('square', note.hz, note.hz, t, 0.28, STEP_S * 1.6, 900);
          break;
        case 'stab':
          osc('sawtooth', note.hz, note.hz, t, 0.06, STEP_S * 1.4, 1800);
          break;
        case 'lead':
          osc('sawtooth', note.hz, note.hz, t, 0.09 + 0.05 * intensity, STEP_S * 0.8, 2400);
          break;
      }
    }
  };

  return {
    pump(now, playing, intensity) {
      const level = playing ? 0.5 : 0;
      if (playing !== on) {
        on = playing;
        bus.gain.setTargetAtTime(level, now, playing ? 0.05 : 0.3);
        if (playing) {
          step = 0;
          next = now + 0.05;
        }
      }
      if (!on) return;
      // After a suspend (the page was hidden), restart the bar instead of catching up.
      if (next < now - 0.1) next = now + 0.05;
      const i = Math.min(1, Math.max(0, intensity));
      while (next < now + LOOKAHEAD_S) {
        play(step, next, i);
        step = (step + 1) % STEPS;
        next += STEP_S;
      }
    },
    playing: () => on,
  };
}
