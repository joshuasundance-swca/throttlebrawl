// Synthesized one-shot cues and the siren. Everything is made in code [decided: code-made sounds
// first]. Impacts start at full level on their first sample (no attack ramp), so a hit is heard
// on the tick its event arrives, which is the hit-stop tick. Each impact stacks a pitch-dropping
// body for weight with mid and high layers, since phone speakers play little below 200 Hz.
import type { CueId } from './cues';
import { noiseBuffer } from './engine-patch';

export interface PlayingCue {
  /** When the sound has fully decayed. */
  readonly endsAt: number;
  stop(): void;
  /** Called once, when the last source ends. */
  onEnded(cb: () => void): void;
}

export type CuePatch = (ctx: BaseAudioContext, out: AudioNode, t: number, gain: number) => PlayingCue;

const SILENT = 0.0001;

class Builder {
  readonly sources: AudioScheduledSourceNode[] = [];
  end: number;
  private readonly ctx: BaseAudioContext;
  private readonly out: GainNode;
  constructor(ctx: BaseAudioContext, dest: AudioNode, gain: number, t: number) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = gain;
    this.out.connect(dest);
    this.end = t;
  }

  /** A gain envelope: instant (or `attack`) rise to `peak`, exponential decay over `decay`. */
  private env(t: number, peak: number, decay: number, attack = 0): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(attack > 0 ? SILENT : peak, t);
    if (attack > 0) g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(SILENT, t + attack + decay);
    g.connect(this.out);
    this.end = Math.max(this.end, t + attack + decay);
    return g;
  }

  tone(type: OscillatorType, f0: number, f1: number, t: number, peak: number, decay: number, attack = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
    o.connect(this.env(t, peak, decay, attack));
    o.start(t);
    o.stop(t + attack + decay + 0.02);
    this.sources.push(o);
  }

  noise(
    filter: BiquadFilterType,
    f0: number,
    f1: number,
    q: number,
    t: number,
    peak: number,
    decay: number,
    attack = 0,
  ) {
    const n = this.ctx.createBufferSource();
    n.buffer = noiseBuffer(this.ctx);
    n.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
    n.connect(f).connect(this.env(t, peak, decay, attack));
    n.start(t);
    n.stop(t + attack + decay + 0.02);
    this.sources.push(n);
  }

  /** A held note with a short release: horns and jingles. */
  held(type: OscillatorType, hz: number, t: number, peak: number, hold: number, lowpassHz = 3000) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = hz;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lowpassHz;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(SILENT, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.012);
    g.gain.setValueAtTime(peak, t + hold);
    g.gain.exponentialRampToValueAtTime(SILENT, t + hold + 0.08);
    o.connect(f).connect(g).connect(this.out);
    o.start(t);
    o.stop(t + hold + 0.1);
    this.sources.push(o);
    this.end = Math.max(this.end, t + hold + 0.1);
  }

  done(): PlayingCue {
    const sources = this.sources;
    let remaining = sources.length;
    let cb: (() => void) | null = null;
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      cb?.();
    };
    for (const s of sources) {
      s.onended = () => {
        if (--remaining <= 0) fire();
      };
    }
    return {
      endsAt: this.end,
      stop: () => {
        const now = this.ctx.currentTime;
        this.out.gain.setTargetAtTime(0, now, 0.01);
        for (const s of sources) {
          try {
            s.stop(now + 0.05);
          } catch {
            // already stopped
          }
        }
        fire();
      },
      onEnded: (f) => {
        cb = f;
      },
    };
  }
}

const patch =
  (build: (b: Builder, t: number) => void): CuePatch =>
  (ctx, out, t, gain) => {
    const b = new Builder(ctx, out, gain, t);
    build(b, t);
    return b.done();
  };

export const CUE_PATCHES: Readonly<Record<CueId, CuePatch>> = {
  // A fist on leather: a pitch-dropping thump, a mid "thwack" and a bright smack.
  punch: patch((b, t) => {
    b.tone('sine', 160, 55, t, 0.9, 0.16);
    b.tone('triangle', 260, 120, t, 0.45, 0.1);
    b.noise('lowpass', 2800, 500, 0.8, t, 0.7, 0.09);
    b.noise('highpass', 3500, 3500, 0.7, t, 0.3, 0.015);
  }),
  // A boot: heavier and longer, with a crunch.
  kick: patch((b, t) => {
    b.tone('sine', 120, 42, t, 1, 0.24);
    b.tone('square', 190, 85, t, 0.28, 0.12);
    b.noise('bandpass', 1100, 450, 1.1, t, 0.85, 0.16);
    b.noise('highpass', 3000, 3000, 0.7, t, 0.3, 0.02);
  }),
  // A weapon: an inharmonic metal clang over a short thump.
  hit: patch((b, t) => {
    b.tone('sine', 130, 60, t, 0.6, 0.12);
    b.tone('sine', 523, 520, t, 0.35, 0.5);
    b.tone('sine', 1307, 1300, t, 0.25, 0.35);
    b.tone('sine', 2091, 2085, t, 0.18, 0.25);
    b.tone('sine', 2977, 2970, t, 0.12, 0.18);
    b.noise('highpass', 2000, 2000, 0.7, t, 0.4, 0.025);
  }),
  // A whiff: a quick noise sweep.
  miss: patch((b, t) => {
    b.noise('bandpass', 700, 2600, 2, t, 0.35, 0.16, 0.035);
  }),
  // Going down: a long roar that darkens, three thumps and a metal scrape.
  crash: patch((b, t) => {
    b.noise('lowpass', 3200, 280, 0.7, t, 0.9, 0.9);
    b.tone('sine', 95, 40, t, 1, 0.22);
    b.tone('sine', 85, 38, t + 0.13, 0.7, 0.2);
    b.tone('sine', 75, 35, t + 0.31, 0.45, 0.2);
    b.noise('bandpass', 3300, 2400, 4, t, 0.28, 0.7, 0.05);
  }),
  land: patch((b, t) => {
    b.tone('sine', 110, 48, t, 0.7, 0.14);
    b.noise('lowpass', 900, 300, 0.7, t, 0.45, 0.07);
  }),
  grab: patch((b, t) => {
    b.tone('triangle', 660, 990, t, 0.35, 0.09);
    b.tone('triangle', 1320, 1320, t + 0.05, 0.25, 0.08);
  }),
  // A car horn: a major-third pair of buzzy notes.
  horn: patch((b, t) => {
    b.held('sawtooth', 415, t, 0.28, 0.45, 2600);
    b.held('sawtooth', 523, t, 0.24, 0.45, 2600);
  }),
  // A truck horn: lower, longer, three notes.
  truckHorn: patch((b, t) => {
    b.held('sawtooth', 185, t, 0.3, 0.9, 2000);
    b.held('sawtooth', 233, t, 0.26, 0.9, 2000);
    b.held('sawtooth', 277, t, 0.22, 0.9, 2000);
  }),
  sirenWhoop: patch((b, t) => {
    b.tone('sawtooth', 520, 1400, t, 0.35, 0.45, 0.02);
  }),
  go: patch((b, t) => {
    b.held('square', 880, t, 0.25, 0.14, 4000);
  }),
  finish: patch((b, t) => {
    [523, 659, 784, 1047].forEach((hz, i) => b.held('square', hz, t + i * 0.1, 0.2, 0.09, 4000));
  }),
};

export interface SirenVoice {
  setLevel(level: number, at?: number): void;
  setDoppler(factor: number, at?: number): void;
  stop(): void;
  readonly level: () => number;
}

/** The cop's continuous wail: two buzzy oscillators swept by a slow sine. */
export function createSirenVoice(ctx: BaseAudioContext, out: AudioNode): SirenVoice {
  const level = ctx.createGain();
  level.gain.value = 0;
  level.connect(out);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3200;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 400;
  lp.connect(hp).connect(level);
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.45;
  const depth = ctx.createGain();
  depth.gain.value = 330;
  lfo.connect(depth);
  const oscs = (['sawtooth', 'square'] as const).map((type, i) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = 980;
    depth.connect(o.frequency);
    const g = ctx.createGain();
    g.gain.value = i === 0 ? 0.3 : 0.15;
    o.connect(g).connect(lp);
    return o;
  });
  lfo.start();
  for (const o of oscs) o.start();
  let lvl = 0;
  return {
    setLevel(v, at = ctx.currentTime) {
      lvl = v;
      level.gain.setTargetAtTime(v, at, 0.08);
    },
    setDoppler(factor, at = ctx.currentTime) {
      const cents = 1200 * Math.log2(Math.min(2, Math.max(0.5, factor)));
      for (const o of oscs) o.detune.setTargetAtTime(cents, at, 0.05);
    },
    stop() {
      const now = ctx.currentTime;
      level.gain.setTargetAtTime(0, now, 0.05);
      lfo.stop(now + 0.3);
      for (const o of oscs) o.stop(now + 0.3);
      lvl = 0;
    },
    level: () => lvl,
  };
}
