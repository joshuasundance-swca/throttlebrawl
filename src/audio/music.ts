// A crude original music loop, made in code (M1.md audio-1; [decided] one original score for M1
// and M2). A four-bar surf-rock figure in E minor at 150 bpm: drums, a picked bass and a
// tremolo-picked lead that comes in as `intensity` rises (the architecture's music-layer seam).
// Notes are scheduled a little ahead from the frame loop, so there are no timers to leak.
import { noiseBuffer } from './engine-patch';

const BPM = 150;
const STEP_S = 60 / BPM / 4; // sixteenth notes
const STEPS = 64; // four bars
const LOOKAHEAD_S = 0.25;

/** Semitones above E2 (82.41 Hz). Chords per bar: Em, C, D, B. */
const ROOTS = [0, -4, -2, -5];
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
// Lead: a tremolo-picked line (semitones above E3), one note per quarter.
const LEAD: readonly number[] = [7, 10, 12, 10, 3, 7, 8, 7, 5, 9, 10, 9, 6, 10, 11, 10];

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
    const s = i % 16;
    const bar = Math.floor(i / 16) % 4;
    const root = ROOTS[bar] ?? 0;
    // Drums.
    if (s === 0 || s === 8 || (intensity > 0.6 && s === 10)) osc('sine', 150, 45, t, 0.9, 0.18);
    if (s === 4 || s === 12) noise('bandpass', 1800, t, 0.5, 0.12);
    if (s % 2 === 0 || intensity > 0.5) noise('highpass', 7000, t, s % 4 === 2 ? 0.18 : 0.1, 0.03);
    // Bass (square, low-passed, so a phone still hears its upper harmonics).
    const b = BASS[s];
    if (b !== null && b !== undefined) osc('square', hz(root + b), hz(root + b), t, 0.28, STEP_S * 1.6, 900);
    // Lead: tremolo-picked sixteenths on the quarter-note line, above half intensity.
    if (intensity > 0.45) {
      const n = LEAD[bar * 4 + Math.floor(s / 4)] ?? 7;
      osc('sawtooth', hz(12 + root + n), hz(12 + root + n), t, 0.09 + 0.05 * intensity, STEP_S * 0.8, 2400);
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
